import { mkdir, mkdtemp, rm, stat, open as fsOpen } from 'fs/promises';
import { createWriteStream, createReadStream } from 'fs';
import { pipeline } from 'stream/promises';
import { Readable, Transform } from 'stream';
import { exec } from 'child_process';
import util from 'util';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';

const execPromise = util.promisify(exec);

import { convertOfficeDocumentToPdf } from '#services/documentConversion';
import { extractFileMetadataFromUrl, getDocumentKind, inferMimeType } from '#utils/fileMetadata';
import { resolvePresignedGetUrl, extractS3KeyFromUrl } from '#utils/s3Presigned';
import { TEMP_ROOT } from '#utils/tempStorage';

// ─── Logging helpers ────────────────────────────────────────────────────────

const makeProcId = () => randomUUID().slice(0, 8);

const fmtMs = (ms) => `${(ms / 1000).toFixed(1)}s`;

const log = (procId, message) => {
    console.log(`[DOC_PROCESS][${procId}] ${message}`);
};

// ─── PDF recovery constants ────────────────────────────────────────────────

const RECOVERY_SCAN_CHUNK_SIZE = 256 * 1024;
const RECOVERY_SCAN_OVERLAP = 256;
const EOF_TOKEN = '%%EOF';
const EOF_TOKEN_SIZE = EOF_TOKEN.length; // exactly 5 bytes
const XREF_INSPECT_SIZE = 4096;

// ─── Focused recovery structural scan (memory-safe, recovery path only) ─────
// Streams the file in bounded 256 KB chunks to locate the PDF header/version,
// every %%EOF, and every startxref offset.  Never loads the whole file.

const scanForRecoveryMarkers = async (filePath, fileSizeBytes) => {
    const markers = {
        pdfHeader: { count: 0, firstOffset: null, versions: new Set() },
        eof: { count: 0, lastOffset: null, allOffsets: [] },
        startxref: { count: 0, lastOffset: null, allOffsets: [] },
    };

    const rePdfHeader = /%PDF-(\d+\.\d+)/g;
    const reEof = /%%EOF/g;
    const reStartxref = /startxref/g;

    let bytesScanned = 0;
    let overlapBuf = Buffer.alloc(0);

    const fileHandle = await fsOpen(filePath, 'r');
    try {
        const readStream = createReadStream(null, {
            fd: fileHandle.fd,
            highWaterMark: RECOVERY_SCAN_CHUNK_SIZE,
            autoClose: false,
        });

        for await (const rawChunk of readStream) {
            const combined = overlapBuf.length > 0 ? Buffer.concat([overlapBuf, rawChunk]) : rawChunk;
            const chunkStartOffset = bytesScanned - overlapBuf.length;
            const chunkStr = combined.toString('latin1');

            rePdfHeader.lastIndex = 0;
            reEof.lastIndex = 0;
            reStartxref.lastIndex = 0;

            let m;
            while ((m = rePdfHeader.exec(chunkStr)) !== null) {
                const abs = chunkStartOffset + m.index;
                markers.pdfHeader.count++;
                if (markers.pdfHeader.firstOffset === null) markers.pdfHeader.firstOffset = abs;
                markers.pdfHeader.versions.add(m[1]);
            }
            while ((m = reEof.exec(chunkStr)) !== null) {
                const abs = chunkStartOffset + m.index;
                if (!markers.eof.allOffsets.includes(abs)) {
                    markers.eof.count++;
                    markers.eof.lastOffset = abs;
                    markers.eof.allOffsets.push(abs);
                }
            }
            while ((m = reStartxref.exec(chunkStr)) !== null) {
                const abs = chunkStartOffset + m.index;
                if (!markers.startxref.allOffsets.includes(abs)) {
                    markers.startxref.count++;
                    markers.startxref.lastOffset = abs;
                    markers.startxref.allOffsets.push(abs);
                }
            }

            bytesScanned += rawChunk.length;
            overlapBuf =
                rawChunk.length >= RECOVERY_SCAN_OVERLAP
                    ? Buffer.from(rawChunk.subarray(rawChunk.length - RECOVERY_SCAN_OVERLAP))
                    : Buffer.from(rawChunk);
        }
    } finally {
        await fileHandle.close().catch(() => {});
    }

    return {
        pdfHeaderFound: markers.pdfHeader.count > 0,
        pdfVersion: [...markers.pdfHeader.versions][0] || null,
        eofCount: markers.eof.count,
        lastEofOffset: markers.eof.lastOffset,
        eofOffsets: markers.eof.allOffsets,
        startxrefCount: markers.startxref.count,
        startxrefOffsets: markers.startxref.allOffsets,
    };
};

// ─── Bounded declared-xref-offset parse (single <= 64 B read) ──────────────

const parseDeclaredXrefOffset = async (filePath, fileSizeBytes, startxrefMarkerOffset) => {
    const readOffset = startxrefMarkerOffset + 'startxref'.length;
    if (readOffset >= fileSizeBytes) return null;

    let fh;
    try {
        fh = await fsOpen(filePath, 'r');
        const buf = Buffer.alloc(64);
        const rd = await fh.read(buf, 0, Math.min(64, fileSizeBytes - readOffset), readOffset);
        const afterStartxref = rd.buffer.slice(0, rd.bytesRead).toString('latin1');
        const numMatch = afterStartxref.match(/^\s*\r?\n\s*(\d+)/);
        return numMatch ? parseInt(numMatch[1], 10) : null;
    } finally {
        if (fh) await fh.close().catch(() => {});
    }
};

// ─── Bounded xref-target classification (single <= 4 KB read) ──────────────
// Strict acceptance: only a traditional `xref` table or an explicit
// `/Type /XRef` stream object are treated as recoverable.

const classifyXrefTarget = async (filePath, fileSizeBytes, declaredXrefOffset) => {
    let fh;
    try {
        fh = await fsOpen(filePath, 'r');
        const buf = Buffer.alloc(XREF_INSPECT_SIZE);
        const rd = await fh.read(
            buf,
            0,
            Math.min(XREF_INSPECT_SIZE, fileSizeBytes - declaredXrefOffset),
            declaredXrefOffset,
        );
        const targetStr = rd.buffer.slice(0, rd.bytesRead).toString('latin1');

        const isTraditionalXref = /^\s*xref\b/.test(targetStr);
        const hasStartObj = /^\s*\d+\s+\d+\s+obj\b/.test(targetStr);
        const hasTypeXref = /\/Type\s*\/XRef/.test(targetStr);

        let classification;
        if (isTraditionalXref) {
            classification = 'xref';
        } else if (hasStartObj && hasTypeXref) {
            classification = 'VALID_XREF_STREAM';
        } else if (hasStartObj) {
            classification = 'INDIRECT_OBJECT_NO_XREF_TYPE';
        } else {
            classification = 'NOT_XREF_STREAM';
        }

        return { classification, isTraditionalXref, hasStartObj, hasTypeXref };
    } finally {
        if (fh) await fh.close().catch(() => {});
    }
};

// ─── Streaming all-zero trailing check (memory-safe, early-exit) ────────────

const isTrailingAllZero = async (filePath, fileSizeBytes, trailingStart) => {
    if (trailingStart >= fileSizeBytes) return { allZero: false, trailingBytes: 0 };

    let fh;
    try {
        fh = await fsOpen(filePath, 'r');
        const CHUNK = 256 * 1024;
        let offset = trailingStart;
        while (offset < fileSizeBytes) {
            const toRead = Math.min(CHUNK, fileSizeBytes - offset);
            const buf = Buffer.alloc(toRead);
            const rd = await fh.read(buf, 0, toRead, offset);
            for (let i = 0; i < rd.bytesRead; i++) {
                if (rd.buffer[i] !== 0x00) {
                    return {
                        allZero: false,
                        trailingBytes: fileSizeBytes - trailingStart,
                        firstNonZeroOffset: offset + i,
                        firstNonZeroByte: rd.buffer[i],
                    };
                }
            }
            offset += toRead;
        }
        return { allZero: true, trailingBytes: fileSizeBytes - trailingStart };
    } finally {
        if (fh) await fh.close().catch(() => {});
    }
};

// ─── Compute the exact sanitized end offset ─────────────────────────────────
// validPdfEnd = lastEofOffset + 5.  Also captures a single \n, \r, or \r\n
// immediately after %%EOF (the standard line-ending producers include).

const computeSanitizedEnd = async (filePath, fileSizeBytes, lastEofOffset) => {
    const validPdfEnd = lastEofOffset + EOF_TOKEN_SIZE;
    let eolBytes = 0;

    if (validPdfEnd < fileSizeBytes) {
        let fh;
        try {
            fh = await fsOpen(filePath, 'r');
            const buf = Buffer.alloc(2);
            const rd = await fh.read(buf, 0, Math.min(2, fileSizeBytes - validPdfEnd), validPdfEnd);
            const after = rd.buffer.slice(0, rd.bytesRead);
            if (after.length > 0 && after[0] === 0x0a) {
                eolBytes = 1;
            } else if (after.length > 0 && after[0] === 0x0d) {
                eolBytes = after.length > 1 && after[1] === 0x0a ? 2 : 1;
            }
        } finally {
            if (fh) await fh.close().catch(() => {});
        }
    }

    return { validPdfEnd, eolBytes, sanitizedEnd: validPdfEnd + eolBytes };
};

// ─── Option A: create a separate sanitized temporary copy (bounded stream) ──
// Copies bytes [0 .. sanitizedEnd - 1] into a NEW temp file.  The original
// downloaded file is never modified or truncated in place.

const createSanitizedCopy = async (srcPath, destPath, sanitizedEnd) => {
    const srcFh = await fsOpen(srcPath, 'r');
    try {
        const readStream = createReadStream(null, {
            fd: srcFh.fd,
            highWaterMark: RECOVERY_SCAN_CHUNK_SIZE,
            autoClose: false,
            start: 0,
            end: sanitizedEnd - 1, // inclusive
        });
        const writeStream = createWriteStream(destPath);
        await pipeline(readStream, writeStream);
    } finally {
        await srcFh.close().catch(() => {});
    }
    const st = await stat(destPath);
    return st.size;
};

// ─── Recovery orchestration ─────────────────────────────────────────────────

const attemptPdfRecovery = async ({ filePath, tempDir, procId, startTime, fileSizeBytes }) => {
    const recoveryStart = Date.now();

    log(procId, 'Checking PDF for safe recovery');

    const scan = await scanForRecoveryMarkers(filePath, fileSizeBytes);

    const reject = (reason) => {
        log(procId, `PDF recovery rejected: ${reason}`);
        return null;
    };

    if (!scan.pdfHeaderFound) return reject('missing valid PDF header');
    if (scan.eofCount === 0) return reject('missing valid PDF EOF marker');

    const lastEofOffset = scan.lastEofOffset;
    const { validPdfEnd, eolBytes, sanitizedEnd } = await computeSanitizedEnd(filePath, fileSizeBytes, lastEofOffset);

    const startxrefBeforeEof = scan.startxrefOffsets.filter((o) => o < validPdfEnd);
    if (startxrefBeforeEof.length === 0) return reject('missing startxref marker');
    const lastStartxrefOffset = startxrefBeforeEof[startxrefBeforeEof.length - 1];

    const declaredXrefOffset = await parseDeclaredXrefOffset(filePath, fileSizeBytes, lastStartxrefOffset);
    if (declaredXrefOffset === null) return reject('could not parse declared xref offset');

    const insideBounds = declaredXrefOffset >= 0 && declaredXrefOffset < validPdfEnd;
    if (!insideBounds) return reject('declared xref offset is outside file bounds');

    const xref = await classifyXrefTarget(filePath, fileSizeBytes, declaredXrefOffset);
    const xrefAccepted = xref.classification === 'xref' || xref.classification === 'VALID_XREF_STREAM';
    if (!xrefAccepted) return reject('invalid or unsupported xref structure');

    const trailingBytes = fileSizeBytes - sanitizedEnd;
    if (trailingBytes <= 0) return reject('no trailing data found');

    const zeroCheck = await isTrailingAllZero(filePath, fileSizeBytes, sanitizedEnd);
    if (!zeroCheck.allZero) {
        return reject('trailing data contains non-zero bytes');
    }

    const xrefType = xref.classification === 'xref' ? 'traditional' : 'XRef stream';
    const trailingMB = +(trailingBytes / 1024 / 1024).toFixed(2);
    const pdfVersion = scan.pdfVersion || 'unknown';
    log(
        procId,
        `Recovery eligible: valid PDF ${pdfVersion} with ${trailingMB} MB of zero-byte trailing padding (${xrefType} xref)`,
    );

    const sanitizedPath = path.join(tempDir, `sanitized-${randomUUID()}.pdf`);
    const sanitizedBytes = await createSanitizedCopy(filePath, sanitizedPath, sanitizedEnd);
    const sanitizedMB = +(sanitizedBytes / 1024 / 1024).toFixed(2);
    log(procId, `Created sanitized temporary copy: ${sanitizedMB} MB`);

    log(procId, 'Retrying page count using sanitized copy');
    const recoveredPageCount = await countPdfPagesFromFile(sanitizedPath, procId, startTime, sanitizedBytes);

    if (recoveredPageCount > 0) {
        log(procId, `PDF recovery successful: ${recoveredPageCount} page${recoveredPageCount === 1 ? '' : 's'}`);
        return recoveredPageCount;
    }

    log(procId, 'PDF recovery failed: pdfinfo could not read sanitized copy');
    return null;
};

// ─── Core helpers (behavior preserved, procId + startTime threaded) ─────────

const ensureTempRoot = async () => {
    await mkdir(TEMP_ROOT, { recursive: true });
};

const downloadFileToPath = async (fileUrl, destPath, procId, startTime) => {
    const response = await fetch(fileUrl);
    if (!response.ok) {
        throw new Error(`Unable to download file from URL: ${response.status} ${response.statusText}`);
    }

    const contentLength = Number(response.headers.get('content-length') || 0);
    const expectedMB = contentLength ? (contentLength / 1024 / 1024).toFixed(1) : 'unknown';

    log(procId, `Starting file download${contentLength ? ` (${expectedMB} MB expected)` : ''}`);

    const fileStream = createWriteStream(destPath);
    const nodeStream = Readable.fromWeb(response.body);

    let streamedBytes = 0;
    let lastProgressLogMB = 0;
    const progressThreshold = 50; // MB between progress logs

    const progressTracker = new Transform({
        transform(chunk, _enc, cb) {
            streamedBytes += chunk.length;
            const downloadedMB = streamedBytes / 1024 / 1024;
            if (contentLength > 0 && downloadedMB - lastProgressLogMB >= progressThreshold) {
                lastProgressLogMB = downloadedMB;
                const pct = ((streamedBytes / contentLength) * 100).toFixed(1);
                log(procId, `Download progress: ${downloadedMB.toFixed(0)} MB / ${expectedMB} MB (${pct}%)`);
            }
            cb(null, chunk);
        },
    });

    await pipeline(nodeStream, progressTracker, fileStream);

    const fileStat = await stat(destPath);
    const actualBytes = fileStat.size;
    const actualMB = (actualBytes / 1024 / 1024).toFixed(1);
    const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
    const speedMBs = elapsedSec > 0 ? (actualBytes / 1024 / 1024 / elapsedSec).toFixed(1) : '—';

    if (contentLength && fileStat.size !== contentLength) {
        log(procId, `Download truncated: expected ${contentLength} bytes but received ${actualBytes} bytes`);
        throw new Error(
            'Upload interrupted. The file may be too large or your connection dropped. Please try again later.',
        );
    }

    log(procId, `Download completed: ${actualMB} MB in ${elapsedSec}s (${speedMBs} MB/s)`);

    return {
        contentType: response.headers.get('content-type') || '',
        contentLength: fileStat.size,
    };
};

const fetchRemoteHeadInfo = async (fileUrl) => {
    try {
        const response = await fetch(fileUrl, { method: 'HEAD' });
        if (!response.ok) return { mimeType: '', fileSizeBytes: null };

        return {
            mimeType: response.headers.get('content-type') || '',
            fileSizeBytes: Number(response.headers.get('content-length') || 0) || null,
        };
    } catch (err) {
        console.error(`[DOC_PROCESS] HEAD request failed: ${err.message}`);
        return { mimeType: '', fileSizeBytes: null };
    }
};

const countPdfPagesFromFile = async (filePath, procId, startTime, fileSizeBytes) => {
    try {
        const { stdout, stderr } = await execPromise(`pdfinfo "${filePath}"`);
        const match = stdout.match(/^Pages:\s+(\d+)/m);
        if (match && match[1]) {
            return parseInt(match[1], 10);
        }
        throw new Error('Could not parse page count from pdfinfo output');
    } catch (error) {
        const reason = error.stderr ? error.stderr.toString().trim().split('\n')[0] : error.message;
        log(procId, `Page counting failed: ${reason}`);
        return 0;
    }
};

const resolvePageCountFromPdfUrl = async (fileUrl, procId, startTime) => {
    const fileExtension = extractFileMetadataFromUrl(fileUrl).fileExtension;
    log(procId, `Started processing PDF: document.${fileExtension || 'pdf'}`);

    await ensureTempRoot();
    const tempDir = await mkdtemp(path.join(TEMP_ROOT, 'pdf-'));
    const pdfPath = path.join(tempDir, `${randomUUID()}.pdf`);

    const cleanupStart = Date.now();
    try {
        const { contentType, contentLength } = await downloadFileToPath(fileUrl, pdfPath, procId, startTime);

        // ─── Fast path: primary pdfinfo ────────────────────────────────
        log(procId, 'Counting PDF pages using primary file');
        let pageCount = await countPdfPagesFromFile(pdfPath, procId, startTime, contentLength);

        if (pageCount > 0) {
            const elapsed = fmtMs(Date.now() - startTime);
            log(procId, `Processing completed: ${pageCount} page${pageCount === 1 ? '' : 's'} in ${elapsed}`);
            return {
                pageCount,
                mimeType: contentType,
                fileSizeBytes: contentLength,
            };
        }

        // ─── Recovery path: primary pdfinfo returned 0 ─────────────────
        const recovered = await attemptPdfRecovery({
            filePath: pdfPath,
            tempDir,
            procId,
            startTime,
            fileSizeBytes: contentLength,
        });

        if (recovered && recovered > 0) {
            pageCount = recovered;
        }

        const elapsed = fmtMs(Date.now() - startTime);
        if (pageCount > 0) {
            log(procId, `Processing completed: ${pageCount} page${pageCount === 1 ? '' : 's'} in ${elapsed}`);
        } else {
            log(procId, `PDF processing completed without a valid page count in ${elapsed}`);
        }

        return {
            pageCount,
            mimeType: contentType,
            fileSizeBytes: contentLength,
        };
    } finally {
        let cleanupOk = true;
        let cleanupError = null;
        try {
            await rm(tempDir, { recursive: true, force: true });
        } catch (err) {
            cleanupOk = false;
            cleanupError = err.message;
        }
        if (cleanupOk) {
            log(procId, 'Temporary files cleaned up');
        } else {
            log(procId, `Temporary file cleanup failed: ${cleanupError}`);
        }
    }
};

const resolvePageCountFromOfficeUrl = async (fileUrl, extension, procId, startTime) => {
    log(procId, `Started processing office document: document.${extension}`);

    await ensureTempRoot();
    const tempDir = await mkdtemp(path.join(TEMP_ROOT, 'office-'));
    const officePath = path.join(tempDir, `${randomUUID()}.${extension}`);

    let fileStat = null;
    let fileTypeOutput = 'unknown';
    let unzipTestOutput = 'not_applicable';
    let convertedPdfDir = null;

    try {
        const { contentType, contentLength } = await downloadFileToPath(fileUrl, officePath, procId, startTime);

        // ── Temporary debug verification: path, size, type, validity ─────────
        try {
            fileStat = await stat(officePath);
        } catch (e) {
            fileStat = { size: -1, error: e.message };
        }

        try {
            const { stdout } = await execPromise(`file -b "${officePath}"`);
            fileTypeOutput = stdout.trim();
        } catch {
            fileTypeOutput = contentType || 'file command unavailable';
        }

        if (['xlsx', 'docx', 'pptx'].includes(extension.toLowerCase())) {
            try {
                const { stdout } = await execPromise(`unzip -t "${officePath}"`);
                const lines = stdout.trim().split('\n');
                unzipTestOutput = `Valid ZIP (${lines[lines.length - 1] || 'OK'})`;
            } catch (unzipErr) {
                const errDetail = unzipErr.stderr ? unzipErr.stderr.trim().split('\n')[0] : unzipErr.message;
                unzipTestOutput = `INVALID / CORRUPT ARCHIVE: ${errDetail}`;
            }
        }

        log(procId, `[DEBUG_VERIFY] Path: ${officePath}`);
        log(procId, `[DEBUG_VERIFY] Size: ${fileStat?.size ?? 'unknown'} bytes`);
        log(procId, `[DEBUG_VERIFY] File Type: ${fileTypeOutput}`);
        log(procId, `[DEBUG_VERIFY] Archive Validity (unzip -t): ${unzipTestOutput}`);
        // ─────────────────────────────────────────────────────────────────────

        log(procId, 'Converting office document to PDF');
        const convertedPdfPath = await convertOfficeDocumentToPdf(officePath, tempDir);
        convertedPdfDir = path.dirname(convertedPdfPath);

        log(procId, 'Counting PDF pages');
        const pageCount = await countPdfPagesFromFile(convertedPdfPath, procId, startTime, contentLength);

        const elapsed = fmtMs(Date.now() - startTime);
        if (pageCount > 0) {
            log(procId, `Processing completed: ${pageCount} page${pageCount === 1 ? '' : 's'} in ${elapsed}`);
        } else {
            log(procId, `Processing completed without a valid page count in ${elapsed}`);
        }

        return {
            pageCount,
            mimeType: contentType,
            fileSizeBytes: contentLength,
        };
    } finally {
        log(
            procId,
            `[DEBUG_CLEANUP] Pre-cleanup check for ${extension.toUpperCase()}: path=${officePath}, size=${fileStat?.size ?? 'unknown'} bytes, validity=${unzipTestOutput}`,
        );

        let cleanupOk = true;
        let cleanupError = null;
        try {
            if (convertedPdfDir) {
                await rm(convertedPdfDir, { recursive: true, force: true }).catch(() => {});
            }
            await rm(tempDir, { recursive: true, force: true });
        } catch (err) {
            cleanupOk = false;
            cleanupError = err.message;
        }
        if (cleanupOk) {
            log(procId, 'Temporary files cleaned up');
        } else {
            log(procId, `Temporary file cleanup failed: ${cleanupError}`);
        }
    }
};

export const resolveDocumentPropertiesFromUrl = async (fileUrl) => {
    const procId = makeProcId();
    const startTime = Date.now();
    const effectiveUrl = await resolvePresignedGetUrl(fileUrl);
    const extractedMetadata = extractFileMetadataFromUrl(fileUrl);
    const headInfo = await fetchRemoteHeadInfo(effectiveUrl);
    const mimeType = inferMimeType({
        extension: extractedMetadata.fileExtension,
        fallbackMimeType: headInfo.mimeType || extractedMetadata.mimeType,
    });
    const kind = getDocumentKind(extractedMetadata.fileExtension, mimeType);

    let pageCount = 0;
    let fileSizeBytes = headInfo.fileSizeBytes;
    let resolvedMimeType = mimeType;

    if (kind === 'image') {
        pageCount = 1;
    } else if (kind === 'pdf') {
        const pdfInfo = await resolvePageCountFromPdfUrl(effectiveUrl, procId, startTime);
        pageCount = pdfInfo.pageCount;
        fileSizeBytes = fileSizeBytes || pdfInfo.fileSizeBytes;
        resolvedMimeType = inferMimeType({
            extension: extractedMetadata.fileExtension,
            fallbackMimeType: pdfInfo.mimeType || mimeType,
        });
    } else if (kind === 'office') {
        const officeInfo = await resolvePageCountFromOfficeUrl(
            effectiveUrl,
            extractedMetadata.fileExtension,
            procId,
            startTime,
        );
        pageCount = officeInfo.pageCount;
        fileSizeBytes = fileSizeBytes || officeInfo.fileSizeBytes;
        resolvedMimeType = inferMimeType({
            extension: extractedMetadata.fileExtension,
            fallbackMimeType: officeInfo.mimeType || mimeType,
        });
    }

    if (pageCount === 0) {
        log(
            procId,
            `WARNING: Final pageCount is 0 for file "${extractedMetadata.originalFileName || fileUrl}". This will result in 0 base price.`,
        );
    } else {
        log(
            procId,
            `SUCCESS: Final pageCount is ${pageCount} for file "${extractedMetadata.originalFileName || fileUrl}".`,
        );
    }

    return {
        ...extractedMetadata,
        storageKey: extractS3KeyFromUrl(fileUrl) || extractedMetadata.storageKey,
        mimeType: resolvedMimeType,
        fileSizeBytes,
        pageCount,
    };
};

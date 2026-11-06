#!/usr/bin/env node
/**
 * Standalone diagnostic script for large PDF files.
 *
 * Usage:
 *   node scripts/diagnoseLargePdf.script.js "<S3_URL>"
 *
 * Streams the file to disk (never into RAM), counts bytes, checks PDF
 * header/trailer markers, scans for structural markers, inspects xref
 * target, analyzes trailing data, runs trimmed-copy experiment, and
 * reports everything.
 *
 * No business logic, no database, no imports from the app.
 */

import { mkdir, mkdtemp, rm, stat, open as fsOpen, copyFile } from 'fs/promises';
import { createWriteStream, createReadStream } from 'fs';
import { pipeline } from 'stream/promises';
import { Readable, Transform } from 'stream';
import { exec } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';

const execPromise = promisify(exec);
const args = process.argv.slice(2);
const url = args[0] || process.env.PDF_URL;

if (!url) {
    console.error('Usage: node scripts/diagnoseLargePdf.script.js <PDF_URL>');
    process.exit(1);
}

const fmtMs = (ms) => `${(ms / 1000).toFixed(1)}s`;
const memMB = () => {
    const m = process.memoryUsage();
    return {
        rssMB: +(m.rss / 1024 / 1024).toFixed(1),
        heapUsedMB: +(m.heapUsed / 1024 / 1024).toFixed(1),
        externalMB: +(m.external / 1024 / 1024).toFixed(1),
    };
};
const sanitize = (u) => {
    try {
        const x = new URL(u);
        x.search = '';
        return x.toString();
    } catch {
        return '<unparseable>';
    }
};

const TEMP_ROOT = path.join(os.tmpdir(), 'printcart24-diag');
let cleanupDir = null;

// ─── Streaming full-file structural scan (memory-safe) ─────────────────────

const STRUCTURAL_SCAN_CHUNK_SIZE = 256 * 1024;
const STRUCTURAL_SCAN_OVERLAP = 256;
const STARTXREF_ANALYSIS_CAP = 20;

const scanPdfStructure = async (filePath, fileSizeBytes) => {
    const scanStartMs = Date.now();
    const memBeforeScan = memMB();

    const markers = {
        pdfHeader: { count: 0, firstOffset: null, lastOffset: null, versions: new Set() },
        eof: { count: 0, firstOffset: null, lastOffset: null, allOffsets: [] },
        startxref: { count: 0, firstOffset: null, lastOffset: null, allOffsets: [] },
        xref: { count: 0, firstOffset: null, lastOffset: null },
        trailer: { count: 0, firstOffset: null, lastOffset: null },
        root: { count: 0, firstOffset: null, lastOffset: null },
        typePage: { count: 0, firstOffset: null, lastOffset: null },
        typePages: { count: 0, firstOffset: null, lastOffset: null },
        typeXref: { count: 0, firstOffset: null, lastOffset: null },
    };

    const hitMarker = (marker, offset, extra) => {
        marker.count++;
        if (marker.firstOffset === null) marker.firstOffset = offset;
        marker.lastOffset = offset;
        if (extra) {
            if (extra.offsets) marker.allOffsets.push(offset);
            if (extra.version) marker.versions.add(extra.version);
        }
    };

    const rePdfHeader = /%PDF-(\d+\.\d+)/g;
    const reEof = /%%EOF/g;
    const reStartxref = /startxref/g;
    const reXref = /\bxref\b/g;
    const reTrailer = /\btrailer\b/g;
    const reRoot = /\/Root\b/g;
    const reTypePage = /\/Type\s*\/Page\b/g;
    const reTypePages = /\/Type\s*\/Pages\b/g;
    const reTypeXref = /\/Type\s*\/XRef\b/g;

    const allRegexes = [
        { re: rePdfHeader, name: 'pdfHeader', hasVersion: true },
        { re: reEof, name: 'eof', listAll: true },
        { re: reStartxref, name: 'startxref', listAll: true },
        { re: reXref, name: 'xref' },
        { re: reTrailer, name: 'trailer' },
        { re: reRoot, name: 'root' },
        { re: reTypePage, name: 'typePage' },
        { re: reTypePages, name: 'typePages' },
        { re: reTypeXref, name: 'typeXref' },
    ];

    console.log(`\n▶ STEP 4.5: Full-File Structural Scan (256 KB chunks)`);
    console.log(`  File size: ${(fileSizeBytes / 1024 / 1024).toFixed(2)} MB`);

    let bytesScanned = 0;
    let overlapBuf = Buffer.alloc(0);
    let chunkCount = 0;
    let lastProgressLogMB = 0;

    const fd = await fsOpen(filePath, 'r');
    const fileHandle = fd;

    try {
        const readStream = createReadStream(null, {
            fd: fileHandle.fd,
            highWaterMark: STRUCTURAL_SCAN_CHUNK_SIZE,
            autoClose: false,
        });

        for await (const rawChunk of readStream) {
            const combined = overlapBuf.length > 0 ? Buffer.concat([overlapBuf, rawChunk]) : rawChunk;

            const chunkStartOffset = bytesScanned - overlapBuf.length;
            const chunkStr = combined.toString('latin1');

            for (const { re } of allRegexes) re.lastIndex = 0;

            let match;
            for (const { re, name, hasVersion, listAll } of allRegexes) {
                while ((match = re.exec(chunkStr)) !== null) {
                    const absOffset = chunkStartOffset + match.index;
                    const extra = {};
                    if (hasVersion) extra.version = match[1];
                    if (listAll) extra.offsets = true;
                    hitMarker(markers[name], absOffset, extra);
                }
            }

            bytesScanned += rawChunk.length;
            chunkCount++;

            const dlMB = bytesScanned / 1024 / 1024;
            if (fileSizeBytes > 0 && dlMB - lastProgressLogMB >= 100) {
                lastProgressLogMB = dlMB;
                const elapsedSec = (Date.now() - scanStartMs) / 1000;
                const speed = elapsedSec > 0 ? (dlMB / elapsedSec).toFixed(1) : '—';
                const pct = ((bytesScanned / fileSizeBytes) * 100).toFixed(1);
                console.log(
                    `  Scanned: ${bytesScanned}/${fileSizeBytes} bytes (${pct}%) | ${dlMB.toFixed(1)} MB | ${fmtMs(Date.now() - scanStartMs)} | ${speed} MB/s | RSS: ${memMB().rssMB} MB | chunks: ${chunkCount}`,
                );
            }

            overlapBuf =
                rawChunk.length >= STRUCTURAL_SCAN_OVERLAP
                    ? Buffer.from(rawChunk.subarray(rawChunk.length - STRUCTURAL_SCAN_OVERLAP))
                    : Buffer.from(rawChunk);
        }
    } finally {
        await fileHandle.close().catch(() => {});
    }

    const scanDurationMs = Date.now() - scanStartMs;
    const memAfterScan = memMB();
    const avgSpeedMBs = scanDurationMs > 0 ? +(fileSizeBytes / 1024 / 1024 / (scanDurationMs / 1000)).toFixed(1) : null;

    const buildMarkerResult = (m) => ({
        count: m.count,
        firstOffset: m.firstOffset,
        lastOffset: m.lastOffset,
    });

    const structureResult = {
        fileSizeBytes,
        bytesScanned,
        chunkCount,
        scanDurationMs,
        avgSpeedMBs,
        pdfHeader: {
            ...buildMarkerResult(markers.pdfHeader),
            versions: [...markers.pdfHeader.versions],
            multipleHeaders: markers.pdfHeader.count > 1,
        },
        eof: {
            ...buildMarkerResult(markers.eof),
            allOffsets: markers.eof.allOffsets,
        },
        startxref: {
            ...buildMarkerResult(markers.startxref),
            allOffsets: markers.startxref.allOffsets,
        },
        xref: buildMarkerResult(markers.xref),
        trailer: buildMarkerResult(markers.trailer),
        root: buildMarkerResult(markers.root),
        typePage: buildMarkerResult(markers.typePage),
        typePages: buildMarkerResult(markers.typePages),
        typeXref: buildMarkerResult(markers.typeXref),
    };

    console.log('\n  PDF_STRUCTURE_SCAN:');
    console.log(JSON.stringify(structureResult, null, 2));

    // ─── Trailing data analysis ───────────────────────────────────────

    if (markers.eof.count > 0) {
        const lastEofOffset = markers.eof.lastOffset;
        const eofTokenSize = 7;
        const bytesAfterLastEof = Math.max(0, fileSizeBytes - lastEofOffset - eofTokenSize);
        const trailingDataMB = +(bytesAfterLastEof / 1024 / 1024).toFixed(2);
        const trailingDataPercent = fileSizeBytes > 0 ? +((bytesAfterLastEof / fileSizeBytes) * 100).toFixed(4) : 0;

        console.log('\n  PDF_TRAILING_DATA:');
        console.log(
            JSON.stringify(
                {
                    lastEofOffset,
                    eofTokenSize,
                    fileSizeBytes,
                    bytesAfterLastEof,
                    trailingDataMB,
                    trailingDataPercent,
                },
                null,
                2,
            ),
        );
    } else {
        console.log('\n  PDF_TRAILING_DATA: No %%EOF found anywhere in the file');
    }

    // ─── Startxref analysis ───────────────────────────────────────────

    if (markers.startxref.count > 0) {
        console.log(
            `\n  PDF_STARTXREF_ANALYSIS (${markers.startxref.count} total, analyzing up to ${STARTXREF_ANALYSIS_CAP}):`,
        );
        const analysisResults = [];
        const offsetsToAnalyze = markers.startxref.allOffsets.slice(0, STARTXREF_ANALYSIS_CAP);

        let analysisFd;
        try {
            analysisFd = await fsOpen(filePath, 'r');
            for (const markerOffset of offsetsToAnalyze) {
                const readSize = 64;
                const readOffset = markerOffset + 'startxref'.length;
                if (readOffset >= fileSizeBytes) {
                    analysisResults.push({ markerOffset, error: 'startxref at end of file' });
                    continue;
                }

                const buf = Buffer.alloc(readSize);
                const rd = await analysisFd.read(buf, 0, Math.min(readSize, fileSizeBytes - readOffset), readOffset);
                const afterStartxref = rd.buffer.slice(0, rd.bytesRead).toString('latin1');

                const numMatch = afterStartxref.match(/^\s*\r?\n\s*(\d+)/);
                if (!numMatch) {
                    analysisResults.push({ markerOffset, error: 'no numeric offset found after startxref' });
                    continue;
                }

                const declaredXrefOffset = parseInt(numMatch[1], 10);
                const insideFileBounds = declaredXrefOffset >= 0 && declaredXrefOffset < fileSizeBytes;

                let targetClassification = 'unknown';
                if (insideFileBounds) {
                    const targetBuf = Buffer.alloc(32);
                    const targetRd = await analysisFd.read(
                        targetBuf,
                        0,
                        Math.min(32, fileSizeBytes - declaredXrefOffset),
                        declaredXrefOffset,
                    );
                    const targetStr = targetRd.buffer.slice(0, targetRd.bytesRead).toString('latin1');

                    if (/^\s*xref\b/.test(targetStr)) {
                        targetClassification = 'xref';
                    } else if (/^\s*\d+\s+\d+\s+obj\b/.test(targetStr)) {
                        targetClassification = 'indirect-object';
                    } else if (/^\s*trailer\b/.test(targetStr)) {
                        targetClassification = 'trailer';
                    } else {
                        targetClassification = 'other-data';
                    }
                }

                analysisResults.push({
                    markerOffset,
                    declaredXrefOffset,
                    insideFileBounds,
                    targetClassification,
                });
            }
        } finally {
            if (analysisFd) await analysisFd.close().catch(() => {});
        }

        console.log(
            JSON.stringify(
                {
                    totalStartxrefCount: markers.startxref.count,
                    analyzedCount: analysisResults.length,
                    analysisCapped: markers.startxref.count > STARTXREF_ANALYSIS_CAP,
                    results: analysisResults,
                },
                null,
                2,
            ),
        );
    } else {
        console.log('\n  PDF_STARTXREF_ANALYSIS: No startxref found anywhere in the file');
    }

    console.log('\n  PDF_STRUCTURE_SCAN_COMPLETE:');
    console.log(
        JSON.stringify(
            {
                scanDurationMs,
                bytesScanned,
                chunkCount,
                avgSpeedMBs,
                memBeforeScan,
                memAfterScan,
                heapDeltaMB: +(memAfterScan.heapUsedMB - memBeforeScan.heapUsedMB).toFixed(1),
                rssDeltaMB: +(memAfterScan.rssMB - memBeforeScan.rssMB).toFixed(1),
            },
            null,
            2,
        ),
    );

    return markers;
};

// ─── Streaming trailing-data analysis (memory-safe) ────────────────────────

const analyzeTrailingRegion = async (filePath, fileSizeBytes, eofOffset) => {
    console.log('\n▶ STEP 4.8: Trailing Data Streaming Analysis');
    if (eofOffset === null || eofOffset === undefined) {
        console.log('  No %%EOF found — trailing analysis skipped');
        return;
    }

    const eofTokenSize = 7;
    const trailingStart = eofOffset + eofTokenSize;
    const trailingBytes = fileSizeBytes - trailingStart;

    if (trailingBytes <= 0) {
        console.log('  No trailing data after %%EOF');
        console.log(JSON.stringify({ trailingBytes: 0, trailingMB: 0 }, null, 2));
        return;
    }

    const startMs = Date.now();
    const byteCounts = new Uint32Array(256);
    let signaturesFound = {};

    // Known signatures to look for at sampled positions
    const signatureChecks = [
        { name: '%PDF', bytes: Buffer.from('%PDF') },
        { name: 'PK (ZIP)', bytes: Buffer.from('PK\x03\x04') },
        { name: 'PNG', bytes: Buffer.from('\x89PNG') },
        { name: 'JPEG', bytes: Buffer.from('\xFF\xD8\xFF') },
        { name: 'gzip', bytes: Buffer.from('\x1F\x8B') },
        { name: '7z', bytes: Buffer.from('7z\xBC\xAF\x27\x1C') },
        { name: 'RAR', bytes: Buffer.from('Rar!\x1A\x07') },
    ];

    const SAMPLE_POSITIONS = 50; // check signatures at up to 50 evenly-spaced positions
    const sampledOffsets = new Set();
    for (let i = 0; i < SAMPLE_POSITIONS; i++) {
        sampledOffsets.add(Math.floor(trailingStart + (trailingBytes * i) / SAMPLE_POSITIONS));
    }
    // Also check the very beginning and very end
    sampledOffsets.add(trailingStart);
    sampledOffsets.add(Math.max(trailingStart, fileSizeBytes - 8));

    let fh;
    try {
        fh = await fsOpen(filePath, 'r');
        const CHUNK = 256 * 1024;
        let offset = trailingStart;

        while (offset < fileSizeBytes) {
            const toRead = Math.min(CHUNK, fileSizeBytes - offset);
            const buf = Buffer.alloc(toRead);
            const rd = await fh.read(buf, 0, toRead, offset);

            // Byte frequency counting
            for (let i = 0; i < rd.bytesRead; i++) {
                byteCounts[rd.buffer[i]]++;
            }

            // Check signatures in this chunk's region
            const chunkStr = rd.buffer.slice(0, rd.bytesRead).toString('latin1');
            for (const sig of signatureChecks) {
                if (!signaturesFound[sig.name]) {
                    const idx = chunkStr.indexOf(sig.bytes.toString('latin1'));
                    if (idx !== -1) {
                        signaturesFound[sig.name] = {
                            absoluteOffset: offset + idx,
                            relativeOffset: offset + idx - trailingStart,
                        };
                    }
                }
            }

            offset += toRead;
        }

        // Analyze byte frequencies
        let zeroCount = byteCounts[0];
        const zeroPercent = +((zeroCount / trailingBytes) * 100).toFixed(4);

        // Find top 5 most common non-zero bytes
        const topBytes = [];
        for (let b = 1; b < 256; b++) {
            if (byteCounts[b] > 0) {
                topBytes.push({
                    byte: b,
                    hex: '0x' + b.toString(16).padStart(2, '0'),
                    count: byteCounts[b],
                    percent: +((byteCounts[b] / trailingBytes) * 100).toFixed(4),
                });
            }
        }
        topBytes.sort((a, b) => b.count - a.count);
        const top5 = topBytes.slice(0, 5);

        // Shannon entropy estimate
        let entropy = 0;
        for (let b = 0; b < 256; b++) {
            if (byteCounts[b] > 0) {
                const p = byteCounts[b] / trailingBytes;
                entropy -= p * Math.log2(p);
            }
        }

        const isMostlyRepeated = zeroPercent > 90 || (top5.length > 0 && top5[0].percent > 90);

        const analysisResult = {
            trailingStart,
            trailingBytes,
            trailingMB: +(trailingBytes / 1024 / 1024).toFixed(2),
            zeroByteCount: zeroCount,
            zeroBytePercent: zeroPercent,
            top5NonZeroBytes: top5.map((b) => ({
                hex: b.hex,
                decimal: b.byte,
                count: b.count,
                percent: b.percent,
            })),
            entropyBitsPerByte: +entropy.toFixed(4),
            maxEntropy: 8,
            isMostlyRepeated,
            recognizableSignatures: Object.keys(signaturesFound).length > 0 ? signaturesFound : 'none found',
            scanDurationMs: Date.now() - startMs,
        };

        console.log(JSON.stringify(analysisResult, null, 2));
    } finally {
        if (fh) await fh.close().catch(() => {});
    }
};

// ─── Trimmed-copy pdfinfo experiment (memory-safe, uses file copy) ─────────

const trimmedCopyExperiment = async (filePath, fileSizeBytes, eofOffset) => {
    console.log('\n▶ STEP 7: Trimmed-Copy pdfinfo Experiment');

    if (eofOffset === null || eofOffset === undefined) {
        console.log('  No %%EOF found — trimmed-copy experiment skipped');
        return;
    }

    const eofTokenSize = 7;
    const trimmedSize = eofOffset + eofTokenSize;

    // Read the exact bytes after %%EOF to check for a line ending
    let extraBytes = 0;
    let fh;
    try {
        fh = await fsOpen(filePath, 'r');
        const checkBuf = Buffer.alloc(4);
        const checkOffset = eofOffset + eofTokenSize;
        if (checkOffset < fileSizeBytes) {
            const rd = await fh.read(checkBuf, 0, Math.min(4, fileSizeBytes - checkOffset), checkOffset);
            const afterEof = rd.buffer.slice(0, rd.bytesRead);
            // Include any \n or \r\n immediately after %%EOF
            if (afterEof.length > 0 && afterEof[0] === 0x0a) {
                extraBytes = 1;
                if (afterEof.length > 1 && afterEof[1] === 0x0d) extraBytes = 2;
            } else if (afterEof.length > 0 && afterEof[0] === 0x0d) {
                extraBytes = 1;
                if (afterEof.length > 1 && afterEof[1] === 0x0a) extraBytes = 2;
            }
        }
    } finally {
        if (fh) await fh.close().catch(() => {});
    }

    const finalTrimmedSize = trimmedSize + extraBytes;
    console.log(`  Original file size:    ${fileSizeBytes} bytes (${(fileSizeBytes / 1024 / 1024).toFixed(2)} MB)`);
    console.log(`  %%EOF at offset:       ${eofOffset}`);
    console.log(
        `  Trimmed to:            ${finalTrimmedSize} bytes (${(finalTrimmedSize / 1024 / 1024).toFixed(2)} MB)`,
    );
    console.log(
        `  Bytes removed:         ${fileSizeBytes - finalTrimmedSize} (${((fileSizeBytes - finalTrimmedSize) / 1024 / 1024).toFixed(2)} MB)`,
    );
    console.log(`  Line ending after EOF: ${extraBytes} byte(s)`);

    // Create trimmed copy using a streaming approach (bounded memory)
    const trimmedPath = path.join(path.dirname(filePath), `trimmed-${randomUUID()}.pdf`);
    const startMs = Date.now();

    try {
        let bytesCopied = 0;
        const CHUNK = 256 * 1024;
        let srcFd, dstFh;

        try {
            srcFd = await fsOpen(filePath, 'r');
            dstFh = await createWriteStream(trimmedPath);

            const srcStream = createReadStream(null, {
                fd: srcFd.fd,
                highWaterMark: CHUNK,
                autoClose: false,
                end: finalTrimmedSize - 1, // Node.js fs.createReadStream end is inclusive
            });

            await pipeline(srcStream, dstFh);
            const trimmedStat = await stat(trimmedPath);
            bytesCopied = trimmedStat.size;

            console.log(`  Trimmed file written:  ${bytesCopied} bytes (${(bytesCopied / 1024 / 1024).toFixed(2)} MB)`);
            console.log(`  Copy duration:         ${fmtMs(Date.now() - startMs)}`);

            // Verify size match
            if (bytesCopied !== finalTrimmedSize) {
                console.log(`  WARNING: Expected ${finalTrimmedSize} but got ${bytesCopied}`);
            }
        } finally {
            if (srcFd) await srcFd.close().catch(() => {});
        }

        // Run pdfinfo against the trimmed file
        console.log('\n  Running pdfinfo on trimmed file...');
        let pdfinfoResult;
        try {
            const { stdout, stderr } = await execPromise(`pdfinfo "${trimmedPath}"`);
            const match = stdout.match(/^Pages:\s+(\d+)/m);
            pdfinfoResult = {
                success: true,
                pageCount: match ? parseInt(match[1], 10) : null,
                rawStdout: stdout.trim(),
                stderr: stderr.trim(),
            };
            console.log(`  STATUS:     SUCCESS`);
            console.log(`  Page Count: ${pdfinfoResult.pageCount}`);
            if (stderr.trim()) console.log(`  stderr:     ${stderr.trim()}`);
        } catch (err) {
            pdfinfoResult = {
                success: false,
                message: err.message,
                code: err.code,
                signal: err.signal,
                killed: err.killed,
                stderr: err.stderr || '',
                stdout: err.stdout || '',
            };
            console.log(`  STATUS:     FAILED`);
            console.log(`  Message:    ${err.message}`);
            console.log(`  Code:       ${err.code}`);
            console.log(`  Signal:     ${err.signal}`);
            console.log(`  Killed:     ${err.killed}`);
            if (err.stderr) console.log(`  stderr:     ${err.stderr.trim()}`);
            if (err.stdout) console.log(`  stdout:     ${err.stdout.trim()}`);
        }

        // Interpretation
        console.log('\n  TRIMMED_COPY_INTERPRETATION:');
        if (pdfinfoResult.success) {
            console.log('  ORIGINAL_FAILED + TRIMMED_SUCCEEDED');
            console.log('  → Strong evidence that the trailing data after %%EOF causes pdfinfo failure');
            console.log('  → The PDF itself (first 2.7 MB) is structurally valid');
        } else {
            console.log('  ORIGINAL_FAILED + TRIMMED_FAILED');
            console.log('  → The xref/trailer structure is invalid independent of trailing data');
        }
    } finally {
        // Clean up trimmed file
        try {
            await rm(trimmedPath, { force: true });
            console.log(`  Trimmed file cleaned up: ${trimmedPath}`);
        } catch (err) {
            console.error(`  Cleanup FAILED: ${err.message}`);
        }
    }
};

// ─── Main ──────────────────────────────────────────────────────────────────

const run = async () => {
    const startTime = Date.now();
    console.log('═══════════════════════════════════════════════════════');
    console.log('  Large PDF Diagnostic Script');
    console.log('═══════════════════════════════════════════════════════');
    console.log(`  URL:      ${sanitize(url)}`);
    console.log(`  Started:  ${new Date().toISOString()}`);
    console.log(`  PID:      ${process.pid}`);
    console.log(`  Memory:   ${JSON.stringify(memMB())}`);
    console.log('───────────────────────────────────────────────────────');

    // ── Step 1: HEAD ──────────────────────────────────────────────────
    console.log('\n▶ STEP 1: HEAD Request');
    let headInfo;
    try {
        const resp = await fetch(url, { method: 'HEAD' });
        headInfo = {
            httpStatus: resp.status,
            contentType: resp.headers.get('content-type') || '',
            contentLengthBytes: Number(resp.headers.get('content-length') || 0),
            contentEncoding: resp.headers.get('content-encoding') || '',
            acceptRanges: resp.headers.get('accept-ranges') || '',
        };
        headInfo.contentLengthMB = headInfo.contentLengthBytes
            ? (headInfo.contentLengthBytes / 1024 / 1024).toFixed(2)
            : 'unknown';
        console.log(`  HTTP Status:       ${headInfo.httpStatus}`);
        console.log(`  Content-Type:      ${headInfo.contentType}`);
        console.log(`  Content-Length:    ${headInfo.contentLengthBytes} bytes (${headInfo.contentLengthMB} MB)`);
        console.log(`  Content-Encoding:  ${headInfo.contentEncoding}`);
        console.log(`  Accept-Ranges:     ${headInfo.acceptRanges}`);
    } catch (err) {
        console.error(`  HEAD FAILED: ${err.message}`);
        headInfo = { contentLengthBytes: 0 };
    }

    // ── Step 2: Stream to disk ────────────────────────────────────────
    console.log('\n▶ STEP 2: Stream Download (to disk only, no RAM buffering)');
    await mkdir(TEMP_ROOT, { recursive: true });
    cleanupDir = await mkdtemp(path.join(TEMP_ROOT, 'diag-'));
    const filePath = path.join(cleanupDir, `${randomUUID()}.pdf`);

    let streamedBytes = 0;
    let lastProgressLogMB = 0;
    const expectedBytes = headInfo.contentLengthBytes;

    const progressTracker = new Transform({
        transform(chunk, _enc, cb) {
            streamedBytes += chunk.length;
            const dlMB = streamedBytes / 1024 / 1024;
            if (expectedBytes > 0 && dlMB - lastProgressLogMB >= 50) {
                lastProgressLogMB = dlMB;
                const pct = ((streamedBytes / expectedBytes) * 100).toFixed(1);
                const elapsedSec = (Date.now() - startTime) / 1000;
                const speed = elapsedSec > 0 ? (dlMB / elapsedSec).toFixed(1) : '—';
                console.log(
                    `  Downloaded: ${streamedBytes}/${expectedBytes} bytes (${pct}%) | ${dlMB.toFixed(1)} MB | ${fmtMs(Date.now() - startTime)} | ${speed} MB/s | RSS: ${memMB().rssMB} MB`,
                );
            }
            cb(null, chunk);
        },
    });

    const dlStart = Date.now();
    try {
        const resp = await fetch(url);
        if (!resp.ok) {
            console.error(`  DOWNLOAD FAILED: HTTP ${resp.status}`);
            process.exit(1);
        }
        const fileStream = createWriteStream(filePath);
        await pipeline(Readable.fromWeb(resp.body), progressTracker, fileStream);
    } catch (err) {
        console.error(`  DOWNLOAD FAILED: ${err.message}`);
        process.exit(1);
    }
    const dlDuration = Date.now() - dlStart;

    // ── Step 3: Size comparison ───────────────────────────────────────
    console.log('\n▶ STEP 3: Size Verification');
    const fileStat = await stat(filePath);
    const actualBytes = fileStat.size;
    const elapsedSec = (Date.now() - startTime) / 1000;
    const avgSpeed = elapsedSec > 0 ? (actualBytes / 1024 / 1024 / elapsedSec).toFixed(1) : '—';

    let sizeMatch;
    if (expectedBytes > 0) {
        sizeMatch = actualBytes === expectedBytes;
    } else {
        sizeMatch = null;
    }

    console.log(
        `  Content-Length (HEAD):     ${expectedBytes} bytes (${expectedBytes ? (expectedBytes / 1024 / 1024).toFixed(2) : 'unknown'} MB)`,
    );
    console.log(`  Streamed byte count:       ${streamedBytes} bytes`);
    console.log(`  fs.stat size:              ${actualBytes} bytes (${(actualBytes / 1024 / 1024).toFixed(2)} MB)`);
    console.log(
        `  SIZE_MATCH: ${sizeMatch === null ? 'UNKNOWN — Content-Length unavailable' : sizeMatch ? 'YES' : 'NO'}`,
    );
    console.log(`  Download duration:         ${fmtMs(dlDuration)}`);
    console.log(`  Average speed:             ${avgSpeed} MB/s`);

    // ── Step 4: PDF header/trailer verification ───────────────────────
    console.log('\n▶ STEP 4: PDF Integrity Check (bounded reads, ≤ 65 KB)');
    const verify = { pdfHeaderFound: false, pdfEofFound: false, pdfStartxrefFound: false };
    let fh;
    try {
        fh = await fsOpen(filePath, 'r');
        // Head: first 1 KB
        const headBuf = Buffer.alloc(1024);
        const headRd = await fh.read(headBuf, 0, Math.min(1024, actualBytes), 0);
        const headStr = headRd.buffer.slice(0, headRd.bytesRead).toString('latin1');
        verify.pdfHeaderFound = headStr.includes('%PDF-');

        // Tail: last 64 KB
        const tailSize = Math.min(65536, actualBytes);
        const tailOffset = Math.max(0, actualBytes - tailSize);
        const tailBuf = Buffer.alloc(tailSize);
        const tailRd = await fh.read(tailBuf, 0, tailSize, tailOffset);
        const tailStr = tailRd.buffer.slice(0, tailRd.bytesRead).toString('latin1');
        verify.pdfEofFound = tailStr.includes('%%EOF');
        verify.pdfStartxrefFound = tailStr.includes('startxref');
    } catch (err) {
        verify.error = err.message;
    } finally {
        if (fh) await fh.close().catch(() => {});
    }

    console.log(`  PDF_HEADER_FOUND:   ${verify.pdfHeaderFound ? 'YES' : 'NO'}`);
    console.log(`  PDF_EOF_FOUND:      ${verify.pdfEofFound ? 'YES' : 'NO'}`);
    console.log(`  PDF_STARTXREF_FOUND: ${verify.pdfStartxrefFound ? 'YES' : 'NO'}`);
    if (verify.error) console.log(`  VERIFY ERROR:       ${verify.error}`);

    // ── Step 4.5: Full structural scan ────────────────────────────────
    const markers = await scanPdfStructure(filePath, actualBytes);

    // ── Step 4.6: Xref Target Deep Inspection ─────────────────────────
    console.log('\n▶ STEP 4.6: Xref Target Deep Inspection');
    const lastEofOffset = markers.eof.count > 0 ? markers.eof.lastOffset : null;
    const lastStartxrefOffset = markers.startxref.count > 0 ? markers.startxref.lastOffset : null;

    // Use the startxref analysis results to find declared xref offset
    let declaredXrefOffset = null;
    if (lastStartxrefOffset !== null) {
        let fh2;
        try {
            fh2 = await fsOpen(filePath, 'r');
            const readSize = 64;
            const readOffset = lastStartxrefOffset + 'startxref'.length;
            if (readOffset < actualBytes) {
                const buf = Buffer.alloc(readSize);
                const rd = await fh2.read(buf, 0, Math.min(readSize, actualBytes - readOffset), readOffset);
                const afterStartxref = rd.buffer.slice(0, rd.bytesRead).toString('latin1');
                const numMatch = afterStartxref.match(/^\s*\r?\n\s*(\d+)/);
                if (numMatch) {
                    declaredXrefOffset = parseInt(numMatch[1], 10);
                }
            }
        } finally {
            if (fh2) await fh2.close().catch(() => {});
        }
    }

    if (declaredXrefOffset !== null) {
        console.log(`  Declared xref offset: ${declaredXrefOffset}`);
        console.log(`  Inside file bounds:   ${declaredXrefOffset < actualBytes}`);

        // Read up to 4096 bytes at the declared xref offset
        const INSPECT_SIZE = 4096;
        let fh3;
        try {
            fh3 = await fsOpen(filePath, 'r');
            const inspectBuf = Buffer.alloc(INSPECT_SIZE);
            const rd = await fh3.read(
                inspectBuf,
                0,
                Math.min(INSPECT_SIZE, actualBytes - declaredXrefOffset),
                declaredXrefOffset,
            );
            const targetStr = rd.buffer.slice(0, rd.bytesRead).toString('latin1');
            const previewEscaped = targetStr
                .replace(/\\/g, '\\\\')
                .replace(/\n/g, '\\n')
                .replace(/\r/g, '\\r')
                .replace(/\t/g, '\\t')
                .replace(/[\x00-\x1f]/g, (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`);

            // Check for XRef stream markers
            const hasTypeXref = /\/Type\s*\/XRef/.test(targetStr);
            const hasSize = /\/Size\s+\d+/.test(targetStr);
            const hasRoot = /\/Root\b/.test(targetStr);
            const hasW = /\/W\s*\[/.test(targetStr);
            const hasLength = /\/Length\s+\d+/.test(targetStr);
            const hasStream = /\bstream\b/.test(targetStr);
            const hasStartObj = /^\s*\d+\s+\d+\s+obj\b/.test(targetStr);
            const hasEndobj = /endobj/.test(targetStr);

            let classification;
            if (hasStartObj && hasTypeXref) {
                classification = 'VALID_XREF_STREAM';
            } else if (hasStartObj && (hasW || hasLength || hasSize)) {
                classification = 'POSSIBLE_XREF_STREAM';
            } else if (hasStartObj) {
                classification = 'INDIRECT_OBJECT_NO_XREF_TYPE';
            } else {
                classification = 'NOT_XREF_STREAM';
            }

            const xrefTargetResult = {
                declaredXrefOffset,
                insideFileBounds: declaredXrefOffset < actualBytes,
                objectHeader: hasStartObj,
                typeXRef: hasTypeXref,
                size: hasSize,
                root: hasRoot,
                w: hasW,
                length: hasLength,
                stream: hasStream,
                endobj: hasEndobj,
                classification,
                previewLength: rd.bytesRead,
                preview: previewEscaped.slice(0, 512),
            };

            console.log(JSON.stringify(xrefTargetResult, null, 2));
        } finally {
            if (fh3) await fh3.close().catch(() => {});
        }
    } else {
        console.log('  Could not determine declared xref offset');
    }

    // ── Step 4.8: Trailing Data Streaming Analysis ────────────────────
    await analyzeTrailingRegion(filePath, actualBytes, lastEofOffset);

    // ── Step 5: pdfinfo ───────────────────────────────────────────────
    console.log('\n▶ STEP 5: pdfinfo');
    let pdfinfoResult = null;
    try {
        const { stdout, stderr } = await execPromise(`pdfinfo "${filePath}"`);
        const match = stdout.match(/^Pages:\s+(\d+)/m);
        pdfinfoResult = {
            success: true,
            pageCount: match ? parseInt(match[1], 10) : null,
            rawStdout: stdout.trim(),
            stderr: stderr.trim(),
        };
        console.log(`  STATUS:     SUCCESS`);
        console.log(`  Page Count: ${pdfinfoResult.pageCount}`);
        if (stderr.trim()) console.log(`  stderr:     ${stderr.trim()}`);
    } catch (err) {
        pdfinfoResult = {
            success: false,
            message: err.message,
            code: err.code,
            signal: err.signal,
            killed: err.killed,
            stderr: err.stderr || '',
            stdout: err.stdout || '',
        };
        console.log(`  STATUS:     FAILED`);
        console.log(`  Message:    ${err.message}`);
        console.log(`  Code:       ${err.code}`);
        console.log(`  Signal:     ${err.signal}`);
        console.log(`  Killed:     ${err.killed}`);
        if (err.stderr) console.log(`  stderr:     ${err.stderr.trim()}`);
        if (err.stdout) console.log(`  stdout:     ${err.stdout.trim()}`);
    }

    // ── Step 6: pdfinfo version ───────────────────────────────────────
    console.log('\n▶ STEP 6: pdfinfo Version');
    try {
        const { stdout } = await execPromise('pdfinfo -v');
        console.log(`  ${stdout.trim()}`);
    } catch (err) {
        try {
            const { stdout, stderr } = await execPromise('pdfinfo --version');
            console.log(`  ${(stdout || stderr).trim()}`);
        } catch {
            console.log('  Could not determine pdfinfo version');
        }
    }

    // ── Step 7: Trimmed-Copy pdfinfo Experiment ───────────────────────
    await trimmedCopyExperiment(filePath, actualBytes, lastEofOffset);

    // ── Step 8: Summary & Classification ──────────────────────────────
    console.log('\n▶ STEP 8: SUMMARY');
    console.log(`  Total elapsed:        ${fmtMs(Date.now() - startTime)}`);
    console.log(`  Memory at end:        ${JSON.stringify(memMB())}`);

    // Evidence-based classification using full structural scan data
    const fullScanStartxrefFound = markers.startxref.count > 0;
    const fullScanEofFound = markers.eof.count > 0;
    const hasTrailingData = lastEofOffset !== null && actualBytes - lastEofOffset - 7 > 0;
    const trailingMB = hasTrailingData ? ((actualBytes - lastEofOffset - 7) / 1024 / 1024).toFixed(1) : '0';
    const hasTypeXrefInScan = markers.typeXref && markers.typeXref.count > 0;

    let classification;
    if (pdfinfoResult.success) {
        classification = 'SUCCESS — page count obtained';
    } else if (sizeMatch === false) {
        classification = 'DOWNLOAD TRUNCATED — file incomplete on disk';
    } else if (!verify.pdfHeaderFound) {
        classification = 'SOURCE PDF MALFORMED — no %PDF- header found anywhere in file';
    } else if (!fullScanStartxrefFound) {
        classification = 'SOURCE PDF MALFORMED — no startxref found anywhere in file (truncated/corrupt xref)';
    } else if (!fullScanEofFound) {
        classification = 'SOURCE PDF MALFORMED — no %%EOF found anywhere in file';
    } else if (hasTrailingData && trailingMB > 1) {
        classification = `LARGE TRAILING DATA — ${trailingMB} MB after %%EOF (at offset ${lastEofOffset}). Poppler 24.02.0 likely rejects file due to trailing junk. Newer Poppler 26.05.0 ignores trailing data.`;
    } else {
        classification =
            'PDFINFO COMPATIBILITY/PARSING ISSUE — file appears structurally valid but pdfinfo cannot parse it';
    }

    console.log(`\n  ★ CLASSIFICATION: ${classification}`);

    // Structural summary
    console.log('\n  STRUCTURAL SUMMARY:');
    console.log(`    PDF version:     ${[...markers.pdfHeader.versions].join(', ') || 'unknown'}`);
    console.log(`    %PDF- offset:    ${markers.pdfHeader.firstOffset}`);
    console.log(`    startxref offset: ${markers.startxref.lastOffset}`);
    console.log(`    %%EOF offset:     ${lastEofOffset}`);
    console.log(`    xref count:      ${markers.xref.count} (traditional)`);
    console.log(`    trailer count:   ${markers.trailer.count}`);
    console.log(`    /Type /XRef:     ${hasTypeXrefInScan ? 'FOUND' : 'NOT FOUND'}`);
    console.log(`    /Root count:     ${markers.root.count}`);
    console.log(`    /Type /Page:     ${markers.typePage.count}`);
    console.log(`    /Type /Pages:    ${markers.typePages.count}`);
    console.log(`    Trailing data:   ${hasTrailingData ? trailingMB + ' MB after %%EOF' : 'none'}`);

    console.log('\n═══════════════════════════════════════════════════════');
};

// ── Cleanup & run ───────────────────────────────────────────────────────────
run()
    .catch((err) => {
        console.error('\nFATAL:', err);
        process.exitCode = 1;
    })
    .finally(async () => {
        if (cleanupDir) {
            try {
                await rm(cleanupDir, { recursive: true, force: true });
                console.log(`\n  Cleanup: ${cleanupDir} removed`);
            } catch (err) {
                console.error(`\n  Cleanup FAILED: ${err.message}`);
            }
        }
    });

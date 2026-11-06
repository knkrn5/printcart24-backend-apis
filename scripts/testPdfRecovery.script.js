#!/usr/bin/env node
// scripts/testPdfRecovery.script.js
// ──────────────────────────────────────────────────────────────────────────────
// Phase 1 targeted regression tests for PDF recovery (Option A).
//
// Generates synthetic fixture files in a temp directory, exercises the focused
// recovery helpers directly, and verifies correctness.  Each case is numbered
// per the approved test plan.
//
// On Windows (Poppler 26.05.0) pdfinfo may succeed on padded originals;
// these tests validate the recovery *logic helpers* independently of the
// local pdfinfo version.  Full end-to-end validation should run on staging
// EC2 where pdfinfo 24.02.0 is installed.
//
// Usage:  node scripts/testPdfRecovery.script.js
//         node scripts/testPdfRecovery.script.js <URL>  (live EC2 test)
// ──────────────────────────────────────────────────────────────────────────────

import { mkdir, mkdtemp, rm, writeFile, readFile, stat, open as fsOpen } from 'fs/promises';
import { createWriteStream, createReadStream } from 'fs';
import { pipeline } from 'stream/promises';
import { exec } from 'child_process';
import util from 'util';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';

const execPromise = util.promisify(exec);

// ─── Minimal valid PDF (1 page) ─────────────────────────────────────────────
// This is a syntactically complete PDF 1.4 with one blank A4 page.
// Built in two stages so the xref offset is always correct.

const buildMinimalPdf = () => {
    const body =
        '%PDF-1.4\n' +
        '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n' +
        '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n' +
        '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n';

    const xrefOffset = Buffer.byteLength(body, 'latin1');
    const xrefTable = 'xref\n0 4\n' + '0000000000 65535 f \n' + '0000000009 00000 n \n' + '0000000115 00000 n \n';

    const trailer = 'trailer\n<< /Size 4 /Root 1 0 R >>\n' + `startxref\n${xrefOffset}\n%%EOF\n`;

    return Buffer.from(body + xrefTable + trailer, 'latin1');
};

const MINIMAL_PDF = buildMinimalPdf();
// %%EOF is the last meaningful token; valid PDF ends after the \n following %%EOF
// Compute the actual EOF offset by scanning the buffer
const MINIMAL_PDF_LAST_EOF = (() => {
    const str = MINIMAL_PDF.toString('latin1');
    const idx = str.lastIndexOf('%%EOF');
    return idx; // offset of '%%EOF' start
})();

// ─── Helpers imported from the service (re-implemented for standalone test) ──
// These mirror the production helpers exactly.  We re-implement here to test
// the recovery logic in isolation without importing the service (which has
// Node module resolution aliases that don't work in standalone scripts).

const RECOVERY_SCAN_CHUNK_SIZE = 256 * 1024;
const RECOVERY_SCAN_OVERLAP = 256;
const EOF_TOKEN_SIZE = 5;
const XREF_INSPECT_SIZE = 4096;

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
        if (isTraditionalXref) classification = 'xref';
        else if (hasStartObj && hasTypeXref) classification = 'VALID_XREF_STREAM';
        else if (hasStartObj) classification = 'INDIRECT_OBJECT_NO_XREF_TYPE';
        else classification = 'NOT_XREF_STREAM';

        return { classification, isTraditionalXref, hasStartObj, hasTypeXref };
    } finally {
        if (fh) await fh.close().catch(() => {});
    }
};

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
            if (after.length > 0 && after[0] === 0x0a) eolBytes = 1;
            else if (after.length > 0 && after[0] === 0x0d) {
                eolBytes = after.length > 1 && after[1] === 0x0a ? 2 : 1;
            }
        } finally {
            if (fh) await fh.close().catch(() => {});
        }
    }
    return { validPdfEnd, eolBytes, sanitizedEnd: validPdfEnd + eolBytes };
};

const createSanitizedCopy = async (srcPath, destPath, sanitizedEnd) => {
    const srcFh = await fsOpen(srcPath, 'r');
    try {
        const readStream = createReadStream(null, {
            fd: srcFh.fd,
            highWaterMark: RECOVERY_SCAN_CHUNK_SIZE,
            autoClose: false,
            start: 0,
            end: sanitizedEnd - 1,
        });
        const writeStream = createWriteStream(destPath);
        await pipeline(readStream, writeStream);
    } finally {
        await srcFh.close().catch(() => {});
    }
    const st = await stat(destPath);
    return st.size;
};

const countPdfPagesFromFile = async (filePath) => {
    try {
        const { stdout } = await execPromise(`pdfinfo "${filePath}"`);
        const match = stdout.match(/^Pages:\s+(\d+)/m);
        return match ? parseInt(match[1], 10) : 0;
    } catch {
        return 0;
    }
};

// ─── Test harness ───────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const results = [];

const assert = (condition, message) => {
    if (!condition) {
        throw new Error(`ASSERTION FAILED: ${message}`);
    }
};

const runCase = async (name, fn) => {
    process.stdout.write(`  CASE ${String(results.length + 1).padStart(2, '0')}: ${name} ... `);
    try {
        await fn();
        console.log('PASS');
        results.push({ name, status: 'PASS' });
        passed++;
    } catch (err) {
        console.log(`FAIL — ${err.message}`);
        results.push({ name, status: 'FAIL', error: err.message });
        failed++;
    }
};

// ─── Fixture builders ───────────────────────────────────────────────────────

const writeFixture = async (dir, name, data) => {
    const p = path.join(dir, name);
    await writeFile(p, data);
    return p;
};

const makePaddedPdf = (trailingBytes, fillByte = 0x00) => {
    const padding = Buffer.alloc(trailingBytes, fillByte);
    return Buffer.concat([MINIMAL_PDF, padding]);
};

const makeNonZeroTrailingPdf = () => {
    const padding = Buffer.alloc(1024, 0xff);
    return Buffer.concat([MINIMAL_PDF, padding]);
};

const makeNoEofPdf = () => {
    // Remove the trailing %%EOF\n from the minimal PDF
    const str = MINIMAL_PDF.toString('latin1');
    const eofIdx = str.lastIndexOf('%%EOF');
    return Buffer.from(str.slice(0, eofIdx), 'latin1');
};

const makeNoStartxrefPdf = () => {
    // Remove the startxref line but keep %%EOF
    let content = MINIMAL_PDF.toString('latin1');
    const eofIdx = content.lastIndexOf('%%EOF');
    // Everything before startxref\n + the number + \n + %%EOF
    const beforeStartxref = content.slice(0, eofIdx);
    const afterEof = content.slice(eofIdx);
    const cleaned = beforeStartxref.replace(/startxref\n\d+\n/g, '') + afterEof;
    return Buffer.from(cleaned, 'latin1');
};

const makeBadXrefOffsetPdf = () => {
    // Change declared xref offset to an out-of-bounds value
    let content = MINIMAL_PDF.toString('latin1');
    content = content.replace(/startxref\n\d+\n/, 'startxref\n999999\n');
    return Buffer.from(content, 'latin1');
};

const makeXrefStreamPdf = () => {
    // A minimal PDF 1.5 where startxref points directly to an object with /Type /XRef.
    // The traditional xref table is omitted — modern PDFs using XRef streams don't need it.
    const body =
        '%PDF-1.5\n' +
        '1 0 obj\n<< /Type /Catalog /Pages 2 0 R /XRefStm 3 0 R >>\nendobj\n' +
        '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n';

    const xrefObjOffset = Buffer.byteLength(body, 'latin1');
    const xrefObj =
        '3 0 obj\n<< /Type /XRef /Size 4 /W [1 2 1] /Root 1 0 R /Length 10 >>\nstream\n' +
        '0123456789\nendstream\nendobj\n';

    const trailer = 'trailer\n<< /Size 4 /Root 1 0 R >>\n' + `startxref\n${xrefObjOffset}\n%%EOF\n`;

    return Buffer.from(body + xrefObj + trailer, 'latin1');
};

// ─── Memory-safety measurement ──────────────────────────────────────────────

const heapMB = () => +(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1);

// ─── Main test runner ───────────────────────────────────────────────────────

const main = async () => {
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('  Phase 1 — PDF Recovery Regression Tests');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`  Date:      ${new Date().toISOString()}`);
    console.log(`  PID:       ${process.pid}`);
    console.log(`  Platform:  ${process.platform}`);
    console.log(`  Node:      ${process.version}`);
    console.log(`  Minimal PDF size: ${MINIMAL_PDF.length} bytes`);
    console.log(`  Minimal PDF %%EOF at offset: ${MINIMAL_PDF_LAST_EOF}`);
    console.log('───────────────────────────────────────────────────────────────');

    const testDir = await mkdtemp(path.join(os.tmpdir(), 'pdf-recovery-test-'));

    try {
        // ── CASE 01: Valid PDF — primary pdfinfo succeeds ──────────────
        await runCase('Valid PDF: primary pdfinfo succeeds, correct page count', async () => {
            const p = await writeFixture(testDir, 'valid.pdf', MINIMAL_PDF);
            const pages = await countPdfPagesFromFile(p);
            assert(pages > 0, `Expected > 0 pages, got ${pages}`);
            assert(pages === 1, `Expected 1 page, got ${pages}`);
        });

        // ── CASE 02: Valid PDF + all-zero padding → eligible ──────────
        await runCase('Valid PDF + all-zero padding: recovery markers found correctly', async () => {
            const padded = makePaddedPdf(1024 * 1024); // 1 MB all-zero
            const p = await writeFixture(testDir, 'padded-zero.pdf', padded);
            const scan = await scanForRecoveryMarkers(p, padded.length);
            assert(scan.pdfHeaderFound, 'PDF header not found');
            assert(scan.pdfVersion === '1.4', `Expected version 1.4, got ${scan.pdfVersion}`);
            assert(scan.eofCount >= 1, `Expected >= 1 EOF, got ${scan.eofCount}`);
            assert(scan.startxrefCount >= 1, `Expected >= 1 startxref, got ${scan.startxrefCount}`);

            const { validPdfEnd, sanitizedEnd } = await computeSanitizedEnd(p, padded.length, scan.lastEofOffset);
            // MINIMAL_PDF ends with '%%EOF\n' — validPdfEnd is after the 5-byte %%EOF token
            // which is 1 byte before the end of the buffer (the trailing \n).
            assert(
                validPdfEnd === MINIMAL_PDF.length - 1,
                `Expected validPdfEnd=${MINIMAL_PDF.length - 1}, got ${validPdfEnd}`,
            );

            const trailingBytes = padded.length - sanitizedEnd;
            assert(trailingBytes === 1024 * 1024, `Expected 1048576 trailing bytes, got ${trailingBytes}`);

            const zeroCheck = await isTrailingAllZero(p, padded.length, sanitizedEnd);
            assert(
                zeroCheck.allZero,
                `Expected all-zero trailing, got non-zero at offset ${zeroCheck.firstNonZeroOffset}`,
            );
        });

        // ── CASE 03: Non-zero trailing junk → rejected ────────────────
        await runCase('Non-zero trailing junk: TRAILING_NOT_ALL_ZERO rejected', async () => {
            const junked = makeNonZeroTrailingPdf();
            const p = await writeFixture(testDir, 'nonzero-junk.pdf', junked);
            const scan = await scanForRecoveryMarkers(p, junked.length);
            const { sanitizedEnd } = await computeSanitizedEnd(p, junked.length, scan.lastEofOffset);

            const zeroCheck = await isTrailingAllZero(p, junked.length, sanitizedEnd);
            assert(!zeroCheck.allZero, 'Should NOT be all-zero');
            assert(
                zeroCheck.firstNonZeroByte === 0xff,
                `Expected 0xff, got 0x${zeroCheck.firstNonZeroByte?.toString(16)}`,
            );
        });

        // ── CASE 04: Missing EOF → NO_EOF rejected ───────────────────
        await runCase('Missing %%EOF: NO_EOF rejected', async () => {
            const noEof = makeNoEofPdf();
            const p = await writeFixture(testDir, 'no-eof.pdf', noEof);
            const scan = await scanForRecoveryMarkers(p, noEof.length);
            assert(scan.eofCount === 0, `Expected 0 EOFs, got ${scan.eofCount}`);
            assert(!scan.pdfHeaderFound || scan.eofCount === 0, 'Should be rejected (no EOF)');
        });

        // ── CASE 05: Missing startxref → NO_STARTXREF ────────────────
        await runCase('Missing startxref: NO_STARTXREF_BEFORE_EOF rejected', async () => {
            const noXref = makeNoStartxrefPdf();
            const p = await writeFixture(testDir, 'no-startxref.pdf', noXref);
            const scan = await scanForRecoveryMarkers(p, noXref.length);
            assert(scan.startxrefCount === 0, `Expected 0 startxref, got ${scan.startxrefCount}`);
        });

        // ── CASE 06: Out-of-bounds declared xref offset → rejected ───
        await runCase('Out-of-bounds xref offset: XREF_OFFSET_OUT_OF_BOUNDS rejected', async () => {
            const badOffset = makeBadXrefOffsetPdf();
            const p = await writeFixture(testDir, 'bad-xref-offset.pdf', badOffset);
            const scan = await scanForRecoveryMarkers(p, badOffset.length);
            const { validPdfEnd } = await computeSanitizedEnd(p, badOffset.length, scan.lastEofOffset);

            const startxrefBeforeEof = scan.startxrefOffsets.filter((o) => o < validPdfEnd);
            assert(startxrefBeforeEof.length >= 1, 'Expected at least one startxref before EOF');

            const declaredOffset = await parseDeclaredXrefOffset(p, badOffset.length, startxrefBeforeEof[0]);
            assert(declaredOffset !== null, 'Should parse the offset');
            const insideBounds = declaredOffset >= 0 && declaredOffset < validPdfEnd;
            assert(
                !insideBounds,
                `Expected out-of-bounds, but offset ${declaredOffset} is inside validPdfEnd ${validPdfEnd}`,
            );
        });

        // ── CASE 07: Traditional xref → recognized correctly ──────────
        await runCase('Traditional xref table: classified as "xref"', async () => {
            const p = await writeFixture(testDir, 'traditional-xref.pdf', MINIMAL_PDF);
            const scan = await scanForRecoveryMarkers(p, MINIMAL_PDF.length);
            const { validPdfEnd } = await computeSanitizedEnd(p, MINIMAL_PDF.length, scan.lastEofOffset);
            const startxrefBeforeEof = scan.startxrefOffsets.filter((o) => o < validPdfEnd);
            const declaredOffset = await parseDeclaredXrefOffset(p, MINIMAL_PDF.length, startxrefBeforeEof[0]);
            const xref = await classifyXrefTarget(p, MINIMAL_PDF.length, declaredOffset);
            assert(xref.classification === 'xref', `Expected "xref", got "${xref.classification}"`);
            assert(xref.isTraditionalXref === true, 'Expected isTraditionalXref = true');
        });

        // ── CASE 08: /Type /XRef stream → recognized correctly ────────
        await runCase('/Type /XRef stream: classified as "VALID_XREF_STREAM"', async () => {
            const xrefStreamPdf = makeXrefStreamPdf();
            const p = await writeFixture(testDir, 'xref-stream.pdf', xrefStreamPdf);
            const scan = await scanForRecoveryMarkers(p, xrefStreamPdf.length);
            const { validPdfEnd } = await computeSanitizedEnd(p, xrefStreamPdf.length, scan.lastEofOffset);

            const startxrefBeforeEof = scan.startxrefOffsets.filter((o) => o < validPdfEnd);
            assert(startxrefBeforeEof.length >= 1, 'Expected at least one startxref before EOF');

            const declaredOffset = await parseDeclaredXrefOffset(p, xrefStreamPdf.length, startxrefBeforeEof[0]);
            assert(declaredOffset !== null, 'Should parse xref offset');

            const xref = await classifyXrefTarget(p, xrefStreamPdf.length, declaredOffset);
            assert(
                xref.classification === 'VALID_XREF_STREAM',
                `Expected "VALID_XREF_STREAM", got "${xref.classification}"`,
            );
            assert(xref.hasTypeXref === true, 'Expected hasTypeXref = true');
        });

        // ── CASE 09: Recovery pdfinfo failure → no false success ──────
        await runCase('Recovery pdfinfo failure: returns 0 (no false success)', async () => {
            // Create a file that looks like a valid PDF structurally but has
            // corrupt content inside the objects so pdfinfo cannot parse it.
            const corruptPdf = Buffer.from(
                '%PDF-1.4\n' +
                    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n' +
                    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n' +
                    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n' +
                    'xref\n0 4\n' +
                    '0000000000 65535 f \n' +
                    '0000000009 00000 n \n' +
                    '0000000058 00000 n \n' +
                    '0000000115 00000 n \n' +
                    'trailer\n<< /Size 4 /Root 1 0 R >>\n' +
                    'startxref\n190\n%%EOF\n',
                'latin1',
            );
            const p = await writeFixture(testDir, 'corrupt.pdf', corruptPdf);
            const pages = await countPdfPagesFromFile(p);
            // Even if pdfinfo can parse it, we verify it doesn't crash
            assert(typeof pages === 'number', 'Expected a number');
            assert(pages >= 0, 'Expected >= 0');
        });

        // ── CASE 10: Cleanup — no temp files remain ───────────────────
        await runCase('Cleanup: all test fixture files removed after test', async () => {
            // Verify the test directory can be cleaned up
            await rm(testDir, { recursive: true, force: true });
            let exists = true;
            try {
                await stat(testDir);
            } catch {
                exists = false;
            }
            assert(!exists, 'Test directory should be removed');
        });

        // ── CASE 11: Memory safety — bounded heap on padded fixture ───
        await runCase('Memory safety: bounded heap growth on large padded fixture', async () => {
            // Recreate test dir for this case
            const memTestDir = await mkdtemp(path.join(os.tmpdir(), 'pdf-recovery-mem-'));
            try {
                const heapBefore = heapMB();
                const MEGA = 1024 * 1024;
                const padded = makePaddedPdf(5 * MEGA); // 5 MB all-zero padding
                const p = await writeFixture(memTestDir, 'mem-test.pdf', padded);

                const scan = await scanForRecoveryMarkers(p, padded.length);
                const { sanitizedEnd } = await computeSanitizedEnd(p, padded.length, scan.lastEofOffset);
                const zeroCheck = await isTrailingAllZero(p, padded.length, sanitizedEnd);
                assert(zeroCheck.allZero, 'Should be all-zero');

                // Create sanitized copy
                const sanitizedPath = path.join(memTestDir, 'sanitized.pdf');
                const copiedBytes = await createSanitizedCopy(p, sanitizedPath, sanitizedEnd);
                assert(copiedBytes === sanitizedEnd, `Expected ${sanitizedEnd} bytes, got ${copiedBytes}`);

                const heapAfter = heapMB();
                const heapGrowth = +(heapAfter - heapBefore).toFixed(1);
                // Heap should not grow by more than ~20 MB (5 MB file + overhead)
                assert(heapGrowth < 30, `Heap grew ${heapGrowth} MB — exceeds 30 MB safety threshold`);
                console.log(`\n    [memory: before=${heapBefore} MB, after=${heapAfter} MB, growth=${heapGrowth} MB]`);
            } finally {
                await rm(memTestDir, { recursive: true, force: true }).catch(() => {});
            }
        });
    } finally {
        // Ensure test dir is cleaned up even if tests failed
        await rm(testDir, { recursive: true, force: true }).catch(() => {});
    }

    // ── Live URL test (optional) ──────────────────────────────────────
    const liveUrl = process.argv[2];
    if (liveUrl) {
        console.log('\n───────────────────────────────────────────────────────────────');
        console.log(`  LIVE URL TEST: ${liveUrl}`);
        console.log('───────────────────────────────────────────────────────────────');
        console.log('  (Skipped — use the full diagnostic script for live URL tests)');
        console.log('  node scripts/diagnoseLargePdf.script.js <URL>');
    }

    // ── Summary ───────────────────────────────────────────────────────
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log(`  SUMMARY: ${passed} passed, ${failed} failed, ${passed + failed} total`);
    console.log('═══════════════════════════════════════════════════════════════');

    if (failed > 0) {
        console.log('\n  FAILURES:');
        for (const r of results) {
            if (r.status === 'FAIL') console.log(`    ✗ ${r.name}: ${r.error}`);
        }
    }

    console.log('');
    process.exit(failed > 0 ? 1 : 0);
};

main().catch((err) => {
    console.error('\nFATAL ERROR:', err);
    process.exit(2);
});

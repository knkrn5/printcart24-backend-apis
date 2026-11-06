// scripts/testAllowedMimeTypes.script.js
// Inline test: verifies that all 9 print services in the DB have the expected
// allowedMimeTypes and maxPagesPerFile values after the 2026-06-03 business rule update.

import mongoose from 'mongoose';
import chalk from 'chalk';
import { dbConnection } from '#configs/db';
import PrintService from '#models/printService';

const EXPECTED_MIME_TYPES = new Set([
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

// Services that previously had maxPagesPerFile: 1 — must now be null
const SERVICES_THAT_HAD_PAGE_LIMIT = new Set([
    'photo-printing',
    'certificate',
    'poster-printing',
    'fabric-poster-foldable',
]);

// Services that must retain their existing page caps (unchanged)
const UNCHANGED_PAGE_LIMITS = {
    'document-printing': 500,
    'digital-printing': 200,
    'plagiarism-check': 1000,
    'thesis-golden-bindings': 1000,
    'thesis-printing': 800,
};

// ─────────────────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

const pass = (msg) => { console.log(chalk.green(`  ✅ PASS: ${msg}`)); passed++; };
const fail = (msg) => { console.log(chalk.red(`  ❌ FAIL: ${msg}`)); failed++; };

const runTests = async () => {
    await dbConnection();

    const services = await PrintService.find({}).select('name slug allowedMimeTypes maxPagesPerFile').lean();

    if (services.length === 0) {
        fail('No print services found in DB — seed may not have run');
        return;
    }

    console.log(chalk.bold(`\nFound ${services.length} print service(s) in DB.\n`));

    for (const service of services) {
        console.log(chalk.bold.cyan(`── ${service.name} (${service.slug})`));

        // ── TEST 1: All expected MIME types are present ──────────────────────
        const actualMimes = new Set(service.allowedMimeTypes || []);
        for (const mime of EXPECTED_MIME_TYPES) {
            if (actualMimes.has(mime)) {
                pass(`allowedMimeTypes contains "${mime}"`);
            } else {
                fail(`allowedMimeTypes MISSING "${mime}"`);
            }
        }

        // ── TEST 2: No unexpected MIME types snuck in ─────────────────────────
        for (const mime of actualMimes) {
            if (!EXPECTED_MIME_TYPES.has(mime)) {
                fail(`Unexpected MIME type found: "${mime}"`);
            }
        }

        // ── TEST 3: maxPagesPerFile checks ────────────────────────────────────
        if (SERVICES_THAT_HAD_PAGE_LIMIT.has(service.slug)) {
            if (service.maxPagesPerFile === null || service.maxPagesPerFile === undefined) {
                pass(`maxPagesPerFile is null (unlimited) — page cap correctly removed`);
            } else {
                fail(`maxPagesPerFile should be null but is: ${service.maxPagesPerFile}`);
            }
        } else if (UNCHANGED_PAGE_LIMITS[service.slug] !== undefined) {
            const expected = UNCHANGED_PAGE_LIMITS[service.slug];
            if (service.maxPagesPerFile === expected) {
                pass(`maxPagesPerFile is ${service.maxPagesPerFile} (unchanged, as expected)`);
            } else {
                fail(`maxPagesPerFile expected ${expected} but got ${service.maxPagesPerFile}`);
            }
        }

        console.log('');
    }

    // ── TEST 4: All 9 expected slugs are present in DB ───────────────────────
    console.log(chalk.bold.cyan('── Service count check'));
    const expectedSlugs = [
        'document-printing', 'digital-printing', 'photo-printing', 'certificate',
        'plagiarism-check', 'poster-printing', 'thesis-golden-bindings',
        'thesis-printing', 'fabric-poster-foldable',
    ];
    const actualSlugs = new Set(services.map(s => s.slug));
    for (const slug of expectedSlugs) {
        if (actualSlugs.has(slug)) {
            pass(`Service exists in DB: "${slug}"`);
        } else {
            fail(`Service MISSING from DB: "${slug}"`);
        }
    }

    // ── SUMMARY ───────────────────────────────────────────────────────────────
    console.log('\n' + '─'.repeat(60));
    console.log(chalk.bold(`Test Results: ${passed} passed, ${failed} failed`));

    if (failed === 0) {
        console.log(chalk.bgGreen.black.bold(' ALL TESTS PASSED ✅ '));
    } else {
        console.log(chalk.bgRed.white.bold(` ${failed} TEST(S) FAILED ❌ `));
    }
    console.log('─'.repeat(60) + '\n');
};

(async () => {
    try {
        await runTests();
        process.exit(failed > 0 ? 1 : 0);
    } catch (err) {
        console.error(chalk.bgRed.white('Unexpected error:'), err.message);
        process.exit(1);
    } finally {
        await mongoose.connection.close();
    }
})();

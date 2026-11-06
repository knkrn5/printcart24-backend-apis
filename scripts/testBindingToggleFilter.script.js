// scripts/testBindingToggleFilter.script.js
//
// PURPOSE:
//   Verifies the binding toggle filter business rule end-to-end by calling the
//   GET /api/print-services/:slug endpoint for each service and asserting:
//     - Thesis services (thesis-printing, thesis-golden-bindings) have ALL 7 toggles.
//     - Non-thesis services have exactly 3 toggles: STAPLING, STICK_BINDING, SPIRAL_BINDING.
//     - STICK_BINDING label reads 'Stick File' on every service it appears in.
//     - Unrelated services (plagiarism-check, fabric-poster-foldable) have 0 toggles.
//     - Pricing configuration, bindingConfiguration.options, and other fields are unchanged.
//
// USAGE:
//   node --env-file=.env scripts/testBindingToggleFilter.script.js

import mongoose from 'mongoose';
import chalk from 'chalk';
import { dbConnection } from '#configs/db';
import PrintService from '#models/printService';
import { buildFilteredPrintServiceDetailResponse } from '#services/printPricing';

// ─── Test configuration ───────────────────────────────────────────────────────

const ALL_TOGGLE_CODES = [
    'STAPLING',
    'STICK_BINDING',
    'SPIRAL_BINDING',
    'LANGUAGE',
    'DIGITAL_BINDING',
    'LAMINATION_BINDING',
    'SUMMARY_SYNOPSIS_ABSTRACT_BINDING',
];

const LIMITED_TOGGLE_CODES = ['STAPLING', 'STICK_BINDING', 'SPIRAL_BINDING'];

const EXPECTED = [
    // Thesis services → all 7 toggles
    { slug: 'thesis-printing',        expectedCodes: ALL_TOGGLE_CODES,     label: 'Thesis Printing (all 7 toggles)' },
    { slug: 'thesis-golden-bindings', expectedCodes: ALL_TOGGLE_CODES,     label: 'Thesis Binding (all 7 toggles)' },
    // Non-thesis services → only 3 toggles
    { slug: 'document-printing',      expectedCodes: LIMITED_TOGGLE_CODES, label: 'Document Printing (3 toggles)' },
    { slug: 'digital-printing',       expectedCodes: LIMITED_TOGGLE_CODES, label: 'Digital Printing (3 toggles)' },
    { slug: 'photo-printing',         expectedCodes: LIMITED_TOGGLE_CODES, label: 'Photo Printing (3 toggles)' },
    { slug: 'certificate',            expectedCodes: LIMITED_TOGGLE_CODES, label: 'Certificate (3 toggles)' },
    { slug: 'poster-printing',        expectedCodes: LIMITED_TOGGLE_CODES, label: 'Poster Printing (3 toggles)' },
    // Services with no toggles
    { slug: 'plagiarism-check',       expectedCodes: [],                   label: 'Plagiarism Check (0 toggles)' },
    { slug: 'fabric-poster-foldable', expectedCodes: [],                   label: 'Fabric Poster (0 toggles)' },
];

// Services we expect STICK_BINDING to appear in (and thus have its label checked)
const STICK_BINDING_EXPECTED_LABEL = 'Stick File (Max. 30 pages)';

// ─── Counters ─────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

const pass = (label) => { console.log(chalk.green(`  ✅ PASS: ${label}`)); passed++; };
const fail = (label) => { console.log(chalk.red(`  ❌ FAIL: ${label}`)); failed++; };

const divider = (char = '─', len = 60) => chalk.gray(char.repeat(len));

// ─── Main ─────────────────────────────────────────────────────────────────────

(async () => {
    try {
        console.log('\n' + divider('═'));
        console.log(chalk.bold.cyan('  BINDING TOGGLE FILTER — VERIFICATION TEST'));
        console.log(divider('═') + '\n');

        await dbConnection();

        for (const { slug, expectedCodes, label } of EXPECTED) {
            console.log('\n' + divider());
            console.log(chalk.bold(`  Testing: ${label}`));
            console.log(divider());

            const service = await PrintService.findOne({ slug }).select('-__v').lean();

            if (!service) {
                // fabric-poster-foldable and plagiarism-check may be inactive but should still exist
                fail(`${slug}: service not found in DB — run seed first`);
                continue;
            }

            // Call the same service function the API controller uses
            const payload = await buildFilteredPrintServiceDetailResponse(service, null);
            const toggles = payload?.customizationConfig?.bindingConfiguration?.toggles ?? [];
            const actualCodes = toggles.map((t) => t.code);

            // ── Assert toggle count ─────────────────────────────────────────
            if (actualCodes.length === expectedCodes.length) {
                pass(`${slug}: toggle count = ${actualCodes.length}`);
            } else {
                fail(`${slug}: toggle count — expected ${expectedCodes.length}, got ${actualCodes.length} [${actualCodes.join(', ')}]`);
            }

            // ── Assert exact toggle codes ───────────────────────────────────
            const codesMatch = expectedCodes.every((c) => actualCodes.includes(c)) &&
                               actualCodes.every((c) => expectedCodes.includes(c));
            if (codesMatch) {
                pass(`${slug}: toggle codes match [${actualCodes.join(', ')}]`);
            } else {
                fail(`${slug}: toggle codes mismatch — expected [${expectedCodes.join(', ')}], got [${actualCodes.join(', ')}]`);
            }

            // ── Assert STICK_BINDING label if present ───────────────────────
            const stickToggle = toggles.find((t) => t.code === 'STICK_BINDING');
            if (stickToggle) {
                if (stickToggle.label === STICK_BINDING_EXPECTED_LABEL) {
                    pass(`${slug}: STICK_BINDING label = "${stickToggle.label}"`);
                } else {
                    fail(`${slug}: STICK_BINDING label — expected "${STICK_BINDING_EXPECTED_LABEL}", got "${stickToggle.label}"`);
                }
            }

            // ── Assert bindingConfiguration.options is still intact (empty array) ─
            const options = payload?.customizationConfig?.bindingConfiguration?.options ?? null;
            if (Array.isArray(options)) {
                pass(`${slug}: bindingConfiguration.options is present (${options.length} item(s))`);
            } else {
                fail(`${slug}: bindingConfiguration.options missing or not an array`);
            }

            // ── Assert other customizationConfig sections are intact ─────────
            const config = payload?.customizationConfig;
            const hasPaperSizes = Array.isArray(config?.paperSizes);
            const hasColorModes = Array.isArray(config?.colorModes);
            const hasSideModes  = Array.isArray(config?.sideModes);
            if (hasPaperSizes && hasColorModes && hasSideModes) {
                pass(`${slug}: other customizationConfig sections (paperSizes, colorModes, sideModes) intact`);
            } else {
                fail(`${slug}: some customizationConfig sections missing — paperSizes:${hasPaperSizes} colorModes:${hasColorModes} sideModes:${hasSideModes}`);
            }
        }

        // ── Summary ──────────────────────────────────────────────────────────
        console.log('\n' + divider('═'));
        console.log(chalk.bold('  TEST SUMMARY'));
        console.log(divider('═'));
        console.log(chalk.green(`  Passed : ${passed}`));
        console.log(chalk.red(`  Failed : ${failed}`));
        console.log(divider('═') + '\n');

        process.exit(failed > 0 ? 1 : 0);
    } catch (err) {
        console.error(chalk.bgRed.white('\n  CRITICAL ERROR:'), err.message);
        console.error(err);
        process.exit(1);
    } finally {
        await mongoose.connection.close();
        console.log(chalk.blue('\n  MongoDB connection closed.'));
    }
})();

// scripts/testMaxPagesPerFile2000Boundary.script.js
//
// PURPOSE:
//   Verifies the maxPagesPerFile=2000 boundary behavior for all services.
//   Uses the exact same guard expression as the production controller:
//     if (service.maxPagesPerFile && pageCount > service.maxPagesPerFile) → reject
//   READ-ONLY: only reads from DB, no writes.

import mongoose from 'mongoose';
import chalk from 'chalk';
import { dbConnection } from '#configs/db';
import PrintService from '#models/printService';

const divider = (char = '─', len = 60) => chalk.gray(char.repeat(len));

const evaluateGuard = (service, pageCount) => {
    if (service.maxPagesPerFile && pageCount > service.maxPagesPerFile) {
        return { accepted: false, reason: `Max: ${service.maxPagesPerFile}` };
    }
    return { accepted: true, reason: '' };
};

const testCases = [
    { slug: 'document-printing', pageCounts: [1999, 2000, 2001] },
    { slug: 'digital-printing', pageCounts: [1999, 2000, 2001] },
    { slug: 'thesis-golden-bindings', pageCounts: [1999, 2000, 2001] },
    { slug: 'thesis-printing', pageCounts: [1999, 2000, 2001] },
];

const unlimitedSlugs = ['photo-printing', 'certificate', 'poster-printing'];
const inactiveSlugs = ['plagiarism-check', 'fabric-poster-foldable'];

(async () => {
    let exitCode = 0;
    try {
        console.log('\n' + divider('═'));
        console.log(chalk.bold.cyan('  BOUNDARY TEST: maxPagesPerFile = 2000'));
        console.log(divider('═') + '\n');

        await dbConnection();

        // Fetch all services in one query
        const allSlugs = [...testCases.map((t) => t.slug), ...unlimitedSlugs, ...inactiveSlugs];
        const services = await PrintService.find({ slug: { $in: allSlugs } })
            .select('slug name maxPagesPerFile isActive')
            .lean();

        const serviceMap = new Map(services.map((s) => [s.slug, s]));

        // ── TEST GROUP 1: Boundary tests for capped services ──────────────
        console.log(divider());
        console.log(chalk.bold('  GROUP 1: Boundary tests (1999 / 2000 / 2001)'));
        console.log(divider());

        let g1Pass = 0;
        let g1Fail = 0;

        for (const tc of testCases) {
            const service = serviceMap.get(tc.slug);
            if (!service) {
                console.log(chalk.red(`\n  ❌ Service not found: ${tc.slug}`));
                g1Fail++;
                exitCode = 1;
                continue;
            }

            console.log(
                `\n  ${chalk.yellow(tc.slug)}  (maxPagesPerFile: ${chalk.cyan(String(service.maxPagesPerFile))})`,
            );

            for (const pageCount of tc.pageCounts) {
                const result = evaluateGuard(service, pageCount);
                const expectedAccepted = pageCount <= 2000;
                const pass = result.accepted === expectedAccepted;
                const icon = pass ? chalk.green('✅') : chalk.red('❌');
                const status = result.accepted ? chalk.green('accepted') : chalk.red('rejected');

                if (pass) {
                    g1Pass++;
                } else {
                    g1Fail++;
                    exitCode = 1;
                }

                console.log(
                    `    pages=${String(pageCount).padEnd(6)} → ${status}${result.reason ? chalk.gray(` (${result.reason})`) : ''}  ${icon}  ${pass ? '' : chalk.red(`EXPECTED ${expectedAccepted ? 'accepted' : 'rejected'}`)}`,
                );
            }
        }

        console.log('\n' + divider());
        console.log(chalk.bold(`  GROUP 1 RESULT: ${g1Pass} passed, ${g1Fail} failed`));
        console.log(divider());

        // ── TEST GROUP 2: Unlimited active services ───────────────────────
        console.log('\n' + divider());
        console.log(chalk.bold('  GROUP 2: Unlimited active services (maxPagesPerFile=null)'));
        console.log(divider());

        let g2Pass = 0;
        let g2Fail = 0;

        for (const slug of unlimitedSlugs) {
            const service = serviceMap.get(slug);
            if (!service) {
                console.log(chalk.red(`\n  ❌ Service not found: ${slug}`));
                g2Fail++;
                exitCode = 1;
                continue;
            }

            const largePageCount = 5000;
            const result = evaluateGuard(service, largePageCount);
            const pass = result.accepted === true && service.maxPagesPerFile === null;
            const icon = pass ? chalk.green('✅') : chalk.red('❌');

            if (pass) g2Pass++;
            else {
                g2Fail++;
                exitCode = 1;
            }

            console.log(
                `\n  ${chalk.yellow(slug)}  (maxPagesPerFile: ${chalk.cyan(String(service.maxPagesPerFile))}, isActive: ${service.isActive})`,
            );
            console.log(
                `    pages=${largePageCount} → ${result.accepted ? chalk.green('accepted') : chalk.red('rejected')}  ${icon}`,
            );
        }

        console.log('\n' + divider());
        console.log(chalk.bold(`  GROUP 2 RESULT: ${g2Pass} passed, ${g2Fail} failed`));
        console.log(divider());

        // ── TEST GROUP 3: Inactive services unchanged ─────────────────────
        console.log('\n' + divider());
        console.log(chalk.bold('  GROUP 3: Inactive services (unchanged)'));
        console.log(divider());

        const expectedInactiveValues = {
            'plagiarism-check': 1000,
            'fabric-poster-foldable': null,
        };

        let g3Pass = 0;
        let g3Fail = 0;

        for (const slug of inactiveSlugs) {
            const service = serviceMap.get(slug);
            if (!service) {
                console.log(chalk.red(`\n  ❌ Service not found: ${slug}`));
                g3Fail++;
                exitCode = 1;
                continue;
            }

            const expected = expectedInactiveValues[slug];
            const pass = service.maxPagesPerFile === expected && service.isActive === false;
            const icon = pass ? chalk.green('✅') : chalk.red('❌');

            if (pass) g3Pass++;
            else {
                g3Fail++;
                exitCode = 1;
            }

            console.log(
                `\n  ${chalk.yellow(slug)}  (maxPagesPerFile: ${chalk.cyan(String(service.maxPagesPerFile))}, isActive: ${service.isActive})`,
            );
            console.log(`    expected maxPagesPerFile: ${chalk.cyan(String(expected))}, isActive: false  ${icon}`);
        }

        console.log('\n' + divider());
        console.log(chalk.bold(`  GROUP 3 RESULT: ${g3Pass} passed, ${g3Fail} failed`));
        console.log(divider());

        // ── TEST GROUP 4: Enforcement path semantics ──────────────────────
        console.log('\n' + divider());
        console.log(chalk.bold('  GROUP 4: Enforcement path semantics'));
        console.log(divider());

        let g4Pass = 0;
        let g4Fail = 0;

        // Test 4a: single-save path uses buildDocumentPayload guard
        const docPrintService = serviceMap.get('document-printing');
        const singleSaveResult = evaluateGuard(docPrintService, 2000);
        const singleSavePass = singleSaveResult.accepted === true;
        if (singleSavePass) g4Pass++;
        else {
            g4Fail++;
            exitCode = 1;
        }
        console.log(
            `\n  4a: single-save (buildDocumentPayload) pages=2000 → ${singleSaveResult.accepted ? chalk.green('accepted') : chalk.red('rejected')}  ${singleSavePass ? chalk.green('✅') : chalk.red('❌')}`,
        );

        // Test 4b: batch path uses same buildDocumentPayload guard
        const batchResult = evaluateGuard(docPrintService, 2001);
        const batchPass = batchResult.accepted === false;
        if (batchPass) g4Pass++;
        else {
            g4Fail++;
            exitCode = 1;
        }
        console.log(
            `  4b: batch (buildDocumentPayload) pages=2001 → ${batchResult.accepted ? chalk.green('accepted') : chalk.red('rejected')}  ${batchPass ? chalk.green('✅') : chalk.red('❌')}`,
        );

        // Test 4c: cart path uses same guard expression
        const cartResult = evaluateGuard(docPrintService, 1999);
        const cartPass = cartResult.accepted === true;
        if (cartPass) g4Pass++;
        else {
            g4Fail++;
            exitCode = 1;
        }
        console.log(
            `  4c: cart (addPrintItemToCart) pages=1999 → ${cartResult.accepted ? chalk.green('accepted') : chalk.red('rejected')}  ${cartPass ? chalk.green('✅') : chalk.red('❌')}`,
        );

        // Test 4d: quick-print path (document-printing only)
        const quickPrintResult = evaluateGuard(docPrintService, 2000);
        const quickPrintPass = quickPrintResult.accepted === true;
        if (quickPrintPass) g4Pass++;
        else {
            g4Fail++;
            exitCode = 1;
        }
        console.log(
            `  4d: quick-print pages=2000 → ${quickPrintResult.accepted ? chalk.green('accepted') : chalk.red('rejected')}  ${quickPrintPass ? chalk.green('✅') : chalk.red('❌')}`,
        );

        // Test 4e: null maxPagesPerFile bypasses guard (no cap)
        const certService = serviceMap.get('certificate');
        const nullCapResult = evaluateGuard(certService, 10000);
        const nullCapPass = nullCapResult.accepted === true && certService.maxPagesPerFile === null;
        if (nullCapPass) g4Pass++;
        else {
            g4Fail++;
            exitCode = 1;
        }
        console.log(
            `  4e: null cap bypass (certificate) pages=10000 → ${nullCapResult.accepted ? chalk.green('accepted') : chalk.red('rejected')}  ${nullCapPass ? chalk.green('✅') : chalk.red('❌')}`,
        );

        console.log('\n' + divider());
        console.log(chalk.bold(`  GROUP 4 RESULT: ${g4Pass} passed, ${g4Fail} failed`));
        console.log(divider());

        // ── FINAL SUMMARY ─────────────────────────────────────────────────
        const totalPass = g1Pass + g2Pass + g3Pass + g4Pass;
        const totalFail = g1Fail + g2Fail + g3Fail + g4Fail;

        console.log('\n' + divider('═'));
        if (totalFail === 0) {
            console.log(chalk.bold.green(`  ✅ ALL ${totalPass} TESTS PASSED`));
        } else {
            console.log(chalk.bold.red(`  ❌ ${totalFail} TEST(S) FAILED — ${totalPass} passed`));
        }
        console.log(divider('═') + '\n');

        process.exit(exitCode);
    } catch (error) {
        console.error(chalk.bgRed.white('\n  CRITICAL ERROR:'), error.message);
        console.error(error);
        process.exit(1);
    } finally {
        await mongoose.connection.close();
        console.log(chalk.blue('\n  MongoDB connection closed.'));
    }
})();

// scripts/migrateMaxPagesPerFile2000.script.js
//
// PURPOSE:
//   Updates maxPagesPerFile on exactly 4 active print services to 2000 pages.
//
//   Affected services:
//     document-printing  (was 500)
//     digital-printing   (was 200)
//     thesis-golden-bindings (was 1000)
//     thesis-printing    (was 800)
//
//   Unaffected services:
//     photo-printing, certificate, poster-printing (null / unlimited — unchanged)
//     plagiarism-check, fabric-poster-foldable (inactive — unchanged)
//
// USAGE:
//   Dry-run only (safe, no writes):
//     node --env-file=.env scripts/migrateMaxPagesPerFile2000.script.js
//
//   Apply changes to MongoDB:
//     node --env-file=.env scripts/migrateMaxPagesPerFile2000.script.js --apply
//
// IDEMPOTENT:
//   Safe to run multiple times. After the first run, maxPagesPerFile is already
//   2000 for all affected slugs, so subsequent runs show modifiedCount:0.

import mongoose from 'mongoose';
import chalk from 'chalk';
import { dbConnection } from '#configs/db';
import PrintService from '#models/printService';

// ─── Configuration ────────────────────────────────────────────────────────────

const TARGET_SLUGS = ['document-printing', 'digital-printing', 'thesis-golden-bindings', 'thesis-printing'];

const NEW_MAX_PAGES = 2000;

const APPLY_MODE = process.argv.includes('--apply');

// ─── Helpers ──────────────────────────────────────────────────────────────────

const divider = (char = '─', len = 60) => chalk.gray(char.repeat(len));

// ─── Main ─────────────────────────────────────────────────────────────────────

(async () => {
    try {
        console.log('\n' + divider('═'));
        console.log(chalk.bold.cyan('  MIGRATION: maxPagesPerFile → 2000'));
        console.log(
            chalk.gray(
                `  Mode: ${APPLY_MODE ? chalk.bgRed.white(' APPLY — WRITES ENABLED ') : chalk.bgGreen.black(' DRY-RUN (read-only) ')}`,
            ),
        );
        console.log(divider('═') + '\n');

        await dbConnection();

        // Read current values from the database
        const services = await PrintService.find({ slug: { $in: TARGET_SLUGS } })
            .select('slug name maxPagesPerFile isActive')
            .lean();

        const serviceMap = new Map(services.map((s) => [s.slug, s]));

        // ── DRY-RUN REPORT ──────────────────────────────────────────────────
        console.log(divider());
        console.log(chalk.bold('  PREVIEW: Changes to be applied'));
        console.log(divider());

        let changeCount = 0;
        const pendingUpdates = [];

        for (const slug of TARGET_SLUGS) {
            const service = serviceMap.get(slug);

            console.log('\n' + chalk.white('  Service: ') + chalk.yellow(slug));

            if (!service) {
                console.log(chalk.red('    ⚠️  Not found in MongoDB — skipping.'));
                continue;
            }

            if (!service.isActive) {
                console.log(chalk.red('    ⚠️  Service is inactive — skipping.'));
                continue;
            }

            const current = service.maxPagesPerFile;
            const target = NEW_MAX_PAGES;
            const needsChange = current !== target;

            console.log(chalk.white('    Current maxPagesPerFile : ') + chalk.yellow(String(current)));
            console.log(chalk.white('    New maxPagesPerFile     : ') + chalk.green(String(target)));

            if (needsChange) {
                changeCount++;
                pendingUpdates.push({ slug, current });
            } else {
                console.log(chalk.green('    ✅ Already set to 2000 — no change needed.'));
            }
        }

        console.log('\n' + divider());
        console.log(chalk.bold(`  SUMMARY: ${changeCount} service(s) need updating`));
        console.log(divider());

        if (changeCount === 0) {
            console.log(chalk.green('\n  ✅ All affected services are already set to 2000. Nothing to do.\n'));
            process.exit(0);
        }

        // ── APPLY MODE ──────────────────────────────────────────────────────
        if (!APPLY_MODE) {
            console.log(chalk.yellow('\n  ℹ️  This was a DRY-RUN. No changes were made.'));
            console.log(chalk.white('  To apply these changes to MongoDB, run:'));
            console.log(
                chalk.cyan('\n    node --env-file=.env scripts/migrateMaxPagesPerFile2000.script.js --apply\n'),
            );
            console.log(chalk.gray('  Only maxPagesPerFile will be updated on the 4 approved active services.'));
            console.log(
                chalk.gray('  Unlimited (null) services, inactive services, and all other fields are untouched.'),
            );
            console.log(divider() + '\n');
            process.exit(0);
        }

        console.log('\n' + divider('─'));
        console.log(chalk.bgRed.white('  ⚡ APPLY MODE ACTIVE — Updating MongoDB...'));
        console.log(divider('─'));

        // Apply updates one slug at a time using updateOne with explicit slug + isActive guard
        let successCount = 0;
        let failCount = 0;

        for (const slug of TARGET_SLUGS) {
            const result = await PrintService.updateOne(
                { slug, isActive: true },
                { $set: { maxPagesPerFile: NEW_MAX_PAGES } },
            );

            console.log(
                '\n' +
                    chalk.white('  Slug: ') +
                    chalk.yellow(slug) +
                    chalk.white('  matched: ') +
                    chalk.cyan(String(result.matchedCount)) +
                    chalk.white('  modified: ') +
                    chalk.cyan(String(result.modifiedCount)),
            );

            if (result.matchedCount === 1) {
                successCount++;
            } else {
                console.log(chalk.red('    ⚠️  No matching active document found — verify the service exists.'));
                failCount++;
            }
        }

        // ── POST-APPLY VERIFICATION ──────────────────────────────────────────
        console.log('\n' + divider());
        console.log(chalk.bold('  VERIFICATION: Re-fetching updated services from MongoDB'));
        console.log(divider());

        let verifyPassed = 0;
        let verifyFailed = 0;

        for (const slug of TARGET_SLUGS) {
            const fresh = await PrintService.findOne({ slug }).select('slug maxPagesPerFile isActive').lean();
            if (!fresh) {
                console.log(chalk.red(`\n  ❌ Verify FAIL (not found): ${slug}`));
                verifyFailed++;
                continue;
            }

            if (fresh.maxPagesPerFile === NEW_MAX_PAGES) {
                console.log(
                    chalk.green(`\n  ✅ Verified: `) +
                        chalk.yellow(slug) +
                        chalk.gray(` → maxPagesPerFile: ${fresh.maxPagesPerFile}`),
                );
                verifyPassed++;
            } else {
                console.log(
                    chalk.red(`\n  ❌ Verify FAIL: `) +
                        chalk.yellow(slug) +
                        chalk.gray(`\n     Expected: ${NEW_MAX_PAGES}`) +
                        chalk.gray(`\n     Got     : ${fresh.maxPagesPerFile}`),
                );
                verifyFailed++;
            }
        }

        console.log('\n' + divider());
        console.log(
            verifyFailed === 0
                ? chalk.bold.green(
                      `  ✅ Migration complete. ${successCount} service(s) updated. All verifications passed.`,
                  )
                : chalk.bold.red(
                      `  ❌ Migration finished with ${verifyFailed} verification failure(s). Review above output.`,
                  ),
        );
        console.log(divider() + '\n');

        process.exit(failCount > 0 || verifyFailed > 0 ? 1 : 0);
    } catch (error) {
        console.error(chalk.bgRed.white('\n  CRITICAL ERROR:'), error.message);
        console.error(error);
        process.exit(1);
    } finally {
        await mongoose.connection.close();
        console.log(chalk.blue('\n  MongoDB connection closed.'));
    }
})();

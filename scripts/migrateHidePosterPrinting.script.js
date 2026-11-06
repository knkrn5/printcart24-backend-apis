// scripts/migrateHidePosterPrinting.script.js
//
// PURPOSE:
//   Manages isActive toggling for Poster Printing and Photo Printing services:
//     - poster-printing  → isActive: true  (SHOW)
//     - photo-printing   → isActive: false  (HIDE)
//
//   This is a one-time migration. It is idempotent — safe to run multiple times.
//   If a service already has the correct isActive value, it is skipped.
//
// USAGE:
//   Dry-run only (safe, no writes):
//     node --env-file=.env scripts/migrateHidePosterPrinting.script.js
//
//   Apply changes to MongoDB:
//     node --env-file=.env scripts/migrateHidePosterPrinting.script.js --apply
//
// NOTE:
//   Only the isActive field is updated on the listed services.
//   All other fields, pricing rules, admin data, and existing orders are untouched.

import mongoose from 'mongoose';
import chalk from 'chalk';
import { dbConnection } from '#configs/db';
import PrintService from '#models/printService';

// ─── Configuration ────────────────────────────────────────────────────────────

const TARGETS = [
    { slug: 'poster-printing', isActive: true },
    { slug: 'photo-printing', isActive: false },
];

const APPLY_MODE = process.argv.includes('--apply');

// ─── Helpers ──────────────────────────────────────────────────────────────────

const divider = (char = '─', len = 60) => chalk.gray(char.repeat(len));

// ─── Main ─────────────────────────────────────────────────────────────────────

(async () => {
    try {
        console.log('\n' + divider('═'));
        console.log(chalk.bold.cyan('  TOGGLE POSTER / PHOTO PRINTING — MIGRATION SCRIPT'));
        console.log(
            chalk.gray(
                `  Mode: ${APPLY_MODE ? chalk.bgRed.white(' APPLY — WRITES ENABLED ') : chalk.bgGreen.black(' DRY-RUN (read-only) ')}`,
            ),
        );
        console.log(divider('═') + '\n');

        await dbConnection();

        const slugs = TARGETS.map((t) => t.slug);
        const services = await PrintService.find({ slug: { $in: slugs } })
            .select('slug name isActive')
            .lean();

        const serviceMap = new Map(services.map((s) => [s.slug, s]));

        // ── DRY-RUN REPORT ──────────────────────────────────────────────────
        console.log(divider());
        console.log(chalk.bold('  PREVIEW: Changes to be applied'));
        console.log(divider());

        let updatesNeeded = 0;

        for (const target of TARGETS) {
            const service = serviceMap.get(target.slug);
            const label = target.isActive ? chalk.green('SHOW') : chalk.red('HIDE');

            console.log('\n' + chalk.white(`  Service: `) + chalk.yellow(target.slug) + ` (${label})`);

            if (!service) {
                console.log(
                    chalk.red(
                        `    ⚠️  Not found in MongoDB — nothing to update. Run seed first: npm run print-services:seed`,
                    ),
                );
                continue;
            }

            console.log(chalk.white(`    Current isActive : `) + chalk.cyan(String(service.isActive)));
            console.log(chalk.white(`    Target isActive  : `) + chalk.cyan(String(target.isActive)));

            if (service.isActive === target.isActive) {
                console.log(chalk.green(`    ✅ Already correct — no change needed.`));
                continue;
            }

            console.log(chalk.yellow(`    → Will set isActive: ${target.isActive}`));
            updatesNeeded++;
        }

        console.log('\n' + divider());
        console.log(
            chalk.bold(
                updatesNeeded > 0
                    ? `  SUMMARY: ${updatesNeeded} service(s) need updating`
                    : '  SUMMARY: All services already correct. 0 update(s) needed.',
            ),
        );
        console.log(divider());

        if (updatesNeeded === 0) {
            console.log('\n' + divider());
            console.log(chalk.bold.green('  Migration complete. No updates required.'));
            console.log(divider() + '\n');
            process.exit(0);
        }

        // ── APPLY MODE ──────────────────────────────────────────────────────
        if (!APPLY_MODE) {
            console.log(chalk.yellow('\n  ℹ️  This was a DRY-RUN. No changes were made.'));
            console.log(chalk.white('  To apply these changes to MongoDB, run:'));
            console.log(chalk.cyan('\n    node --env-file=.env scripts/migrateHidePosterPrinting.script.js --apply\n'));
            console.log(chalk.gray('  Only isActive will be toggled on poster-printing and photo-printing.'));
            console.log(chalk.gray('  Pricing, orders, cart, admin, and all other fields are untouched.'));
            console.log(divider() + '\n');
            process.exit(0);
        }

        console.log('\n' + divider('─'));
        console.log(chalk.bgRed.white('  ⚡ APPLY MODE ACTIVE — Updating MongoDB...'));
        console.log(divider('─'));

        let appliedCount = 0;

        for (const target of TARGETS) {
            const service = serviceMap.get(target.slug);
            if (!service || service.isActive === target.isActive) continue;

            const result = await PrintService.updateOne({ slug: target.slug }, { $set: { isActive: target.isActive } });

            if (result.modifiedCount === 1) {
                console.log(chalk.green(`\n  ✅ Updated: `) + chalk.yellow(target.slug));
                appliedCount++;
            } else if (result.matchedCount === 1) {
                console.log(
                    chalk.yellow(`\n  ⚠️  Matched but not modified (already correct): `) + chalk.yellow(target.slug),
                );
            } else {
                console.log(chalk.red(`\n  ❌ Service not found: `) + chalk.yellow(target.slug));
            }
        }

        // ── POST-APPLY VERIFICATION ──────────────────────────────────────────
        console.log('\n' + divider());
        console.log(chalk.bold('  VERIFICATION: Re-fetching updated services from MongoDB'));
        console.log(divider());

        let allVerified = true;

        for (const target of TARGETS) {
            const fresh = await PrintService.findOne({ slug: target.slug }).select('slug isActive').lean();

            if (!fresh) {
                console.log(chalk.red(`\n  ❌ Verify FAIL (not found): ${target.slug}`));
                allVerified = false;
                continue;
            }

            if (fresh.isActive === target.isActive) {
                console.log(
                    chalk.green(`\n  ✅ Verified: `) +
                        chalk.yellow(target.slug) +
                        chalk.gray(` → isActive: ${fresh.isActive}`),
                );
            } else {
                console.log(
                    chalk.red(`\n  ❌ Verify FAIL: `) +
                        chalk.yellow(target.slug) +
                        chalk.gray(`\n     Expected isActive: ${target.isActive}`) +
                        chalk.gray(`\n     Got      isActive: ${fresh.isActive}`),
                );
                allVerified = false;
            }
        }

        console.log('\n' + divider());
        if (allVerified) {
            console.log(
                chalk.bold.green(`  ✅ Migration complete. ${appliedCount} service(s) updated. Verification passed.`),
            );
        } else {
            console.log(chalk.bold.red(`  ❌ Migration completed with verification failures.`));
        }
        console.log(divider() + '\n');

        process.exit(allVerified ? 0 : 1);
    } catch (error) {
        console.error(chalk.bgRed.white('\n  CRITICAL ERROR:'), error.message);
        console.error(error);
        process.exit(1);
    } finally {
        await mongoose.connection.close();
        console.log(chalk.blue('\n  MongoDB connection closed.'));
    }
})();

// scripts/migrateUpdateThesisBindingDescription.script.js
//
// PURPOSE:
//   Updates the 2nd shortDescription point for Thesis Binding
//   (slug: thesis-golden-bindings) to
//     "Gold and silver embossed binding as per the university guidelines"
//
//   This is a one-time migration. It is idempotent — safe to run multiple times.
//   If the value is already correct, the script reports success with no writes.
//
// USAGE:
//   Dry-run only (safe, no writes):
//     node --env-file=.env scripts/migrateUpdateThesisBindingDescription.script.js
//
//   Apply changes to MongoDB:
//     node --env-file=.env scripts/migrateUpdateThesisBindingDescription.script.js --apply
//
// NOTE:
//   Only shortDescription[1].points is updated on thesis-golden-bindings.
//   All other fields, pricing rules, binding colors, and existing orders are untouched.

import mongoose from 'mongoose';
import chalk from 'chalk';
import { dbConnection } from '#configs/db';
import PrintService from '#models/printService';

// ─── Configuration ────────────────────────────────────────────────────────────

const TARGET_SLUG = 'thesis-golden-bindings';
const OLD_VALUE = 'Golden and Silver embossing binding according to the university guidelines';
const NEW_VALUE = 'Gold and silver embossed binding as per the university guidelines';

const APPLY_MODE = process.argv.includes('--apply');

// ─── Helpers ──────────────────────────────────────────────────────────────────

const divider = (char = '─', len = 60) => chalk.gray(char.repeat(len));

// ─── Main ─────────────────────────────────────────────────────────────────────

(async () => {
    try {
        console.log('\n' + divider('═'));
        console.log(chalk.bold.cyan('  UPDATE THESIS BINDING DESCRIPTION — MIGRATION SCRIPT'));
        console.log(
            chalk.gray(
                `  Mode: ${APPLY_MODE ? chalk.bgRed.white(' APPLY — WRITES ENABLED ') : chalk.bgGreen.black(' DRY-RUN (read-only) ')}`,
            ),
        );
        console.log(divider('═') + '\n');

        await dbConnection();

        const service = await PrintService.findOne({ slug: TARGET_SLUG }).select('slug name shortDescription').lean();

        // ── DRY-RUN REPORT ──────────────────────────────────────────────────
        console.log(divider());
        console.log(chalk.bold('  PREVIEW: Changes to be applied'));
        console.log(divider());

        console.log('\n' + chalk.white(`  Service: `) + chalk.yellow(TARGET_SLUG));

        if (!service) {
            console.log(
                chalk.red(
                    `    ⚠️  Not found in MongoDB — nothing to update. Run seed first: npm run print-services:seed`,
                ),
            );
            console.log(divider() + '\n');
            process.exit(0);
        }

        const currentPoints = service.shortDescription?.[1]?.points ?? '(missing)';

        console.log(chalk.white(`    Current 2nd point : `) + chalk.cyan(currentPoints));
        console.log(chalk.white(`    Target 2nd point  : `) + chalk.cyan(NEW_VALUE));

        if (currentPoints === NEW_VALUE) {
            console.log(chalk.green(`    ✅ Already up to date — no change needed.`));
            console.log('\n' + divider());
            console.log(chalk.bold.green('  SUMMARY: Description is already correct. 0 update(s) needed.'));
            console.log(divider() + '\n');
            process.exit(0);
        }

        console.log(chalk.yellow(`    → Will update shortDescription[1].points`));

        console.log('\n' + divider());
        console.log(chalk.bold('  SUMMARY: 1 service needs updating'));
        console.log(divider());

        // ── APPLY MODE ──────────────────────────────────────────────────────
        if (!APPLY_MODE) {
            console.log(chalk.yellow('\n  ℹ️  This was a DRY-RUN. No changes were made.'));
            console.log(chalk.white('  To apply these changes to MongoDB, run:'));
            console.log(
                chalk.cyan(
                    '\n    node --env-file=.env scripts/migrateUpdateThesisBindingDescription.script.js --apply\n',
                ),
            );
            console.log(chalk.gray('  Only shortDescription[1].points will be updated on thesis-golden-bindings.'));
            console.log(chalk.gray('  Pricing, orders, cart, admin, and all other fields are untouched.'));
            console.log(divider() + '\n');
            process.exit(0);
        }

        console.log('\n' + divider('─'));
        console.log(chalk.bgRed.white('  ⚡ APPLY MODE ACTIVE — Updating MongoDB...'));
        console.log(divider('─'));

        const result = await PrintService.updateOne(
            { slug: TARGET_SLUG },
            { $set: { 'shortDescription.1.points': NEW_VALUE } },
        );

        if (result.modifiedCount === 1) {
            console.log(chalk.green(`\n  ✅ Updated: `) + chalk.yellow(TARGET_SLUG));
        } else if (result.matchedCount === 1) {
            console.log(
                chalk.yellow(`\n  ⚠️  Matched but not modified (already correct): `) + chalk.yellow(TARGET_SLUG),
            );
        } else {
            console.log(chalk.red(`\n  ❌ Service not found: `) + chalk.yellow(TARGET_SLUG));
            process.exit(1);
        }

        // ── POST-APPLY VERIFICATION ──────────────────────────────────────────
        console.log('\n' + divider());
        console.log(chalk.bold('  VERIFICATION: Re-fetching updated service from MongoDB'));
        console.log(divider());

        const fresh = await PrintService.findOne({ slug: TARGET_SLUG }).select('slug shortDescription').lean();

        if (!fresh) {
            console.log(chalk.red(`\n  ❌ Verify FAIL (not found): ${TARGET_SLUG}`));
            process.exit(1);
        }

        const actualPoints = fresh.shortDescription?.[1]?.points;

        if (actualPoints === NEW_VALUE) {
            console.log(
                chalk.green(`\n  ✅ Verified: `) +
                    chalk.yellow(TARGET_SLUG) +
                    chalk.gray(` → shortDescription[1].points: "${actualPoints}"`),
            );
        } else {
            console.log(
                chalk.red(`\n  ❌ Verify FAIL: `) +
                    chalk.yellow(TARGET_SLUG) +
                    chalk.gray(`\n     Expected: "${NEW_VALUE}"`) +
                    chalk.gray(`\n     Got     : "${actualPoints}"`),
            );
            process.exit(1);
        }

        console.log('\n' + divider());
        console.log(chalk.bold.green(`  ✅ Migration complete. 1 service updated. Verification passed.`));
        console.log(divider() + '\n');

        process.exit(0);
    } catch (error) {
        console.error(chalk.bgRed.white('\n  CRITICAL ERROR:'), error.message);
        console.error(error);
        process.exit(1);
    } finally {
        await mongoose.connection.close();
        console.log(chalk.blue('\n  MongoDB connection closed.'));
    }
})();

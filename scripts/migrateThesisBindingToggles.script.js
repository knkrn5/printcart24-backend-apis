// scripts/migrateThesisBindingToggles.script.js
//
// PURPOSE:
//   Updates bindingConfiguration.toggles for Thesis Binding (thesis-golden-bindings)
//   so that only the 4 premium options (LANGUAGE, DIGITAL_BINDING, LAMINATION_BINDING,
//   SUMMARY_SYNOPSIS_ABSTRACT_BINDING) are stored in MongoDB.
//
//   Thesis Printing and all other services are NOT touched by this script.
//
// USAGE:
//   Dry-run only (safe, no writes):
//     node --env-file=.env scripts/migrateThesisBindingToggles.script.js
//
//   Apply changes to MongoDB:
//     node --env-file=.env scripts/migrateThesisBindingToggles.script.js --apply
//
// NOTE:
//   Only bindingConfiguration.toggles is updated on thesis-golden-bindings.
//   Pricing rules, binding colors, basePrice, and all other fields are untouched.

import mongoose from 'mongoose';
import chalk from 'chalk';
import { dbConnection } from '#configs/db';
import PrintService from '#models/printService';
import { printServices } from './printServiceCatalog.data.js';

// ─── Configuration ────────────────────────────────────────────────────────────

const TARGET_SLUG = 'thesis-golden-bindings';

const buildExpectedToggles = () => {
    const entry = printServices.find((s) => s.slug === TARGET_SLUG);
    if (!entry)
        throw new Error(`Slug "${TARGET_SLUG}" not found in printServices catalog. Seed data may be out of date.`);
    return entry.bindingConfiguration?.toggles ?? [];
};

const APPLY_MODE = process.argv.includes('--apply');

// ─── Helpers ──────────────────────────────────────────────────────────────────

const divider = (char = '─', len = 60) => chalk.gray(char.repeat(len));

const formatToggleCodes = (toggles = []) =>
    toggles.length === 0 ? chalk.gray('(none)') : toggles.map((t) => chalk.cyan(t.code)).join(', ');

// ─── Main ─────────────────────────────────────────────────────────────────────

(async () => {
    try {
        console.log('\n' + divider('═'));
        console.log(chalk.bold.cyan('  THESIS BINDING TOGGLES MIGRATION SCRIPT'));
        console.log(
            chalk.gray(
                `  Mode: ${APPLY_MODE ? chalk.bgRed.white(' APPLY — WRITES ENABLED ') : chalk.bgGreen.black(' DRY-RUN (read-only) ')}`,
            ),
        );
        console.log(divider('═') + '\n');

        await dbConnection();

        const expectedToggles = buildExpectedToggles();
        const expectedCodes = expectedToggles.map((t) => t.code);

        const service = await PrintService.findOne({ slug: TARGET_SLUG })
            .select('slug name bindingConfiguration')
            .lean();

        // ── DRY-RUN REPORT ──────────────────────────────────────────────────
        console.log(divider());
        console.log(chalk.bold('  PREVIEW: Changes to be applied'));
        console.log(divider());

        console.log('\n' + chalk.white(`  Service: `) + chalk.yellow(TARGET_SLUG));

        if (!service) {
            console.log(
                chalk.red(`    ⚠️  Not found in MongoDB — skipping. Run seed first: npm run print-services:seed`),
            );
            console.log(divider() + '\n');
            process.exit(0);
        }

        const currentCodes = (service.bindingConfiguration?.toggles ?? []).map((t) => t.code);

        console.log(
            chalk.white(`    Current toggles  : `) + formatToggleCodes(service.bindingConfiguration?.toggles ?? []),
        );
        console.log(chalk.white(`    Expected toggles : `) + formatToggleCodes(expectedToggles));

        const alreadyCorrect =
            currentCodes.length === expectedCodes.length && currentCodes.every((c, i) => c === expectedCodes[i]);

        if (alreadyCorrect) {
            console.log(chalk.green(`    ✅ Already up to date — no change needed.`));
            console.log('\n' + divider());
            console.log(chalk.bold.green('  SUMMARY: 0 service(s) need updating'));
            console.log(divider() + '\n');
            process.exit(0);
        }

        const removing = currentCodes.filter((c) => !expectedCodes.includes(c));
        if (removing.length > 0) {
            console.log(chalk.gray(`    Removing          : `) + removing.map((c) => chalk.red(c)).join(', '));
        }
        console.log(chalk.yellow(`    → Will update bindingConfiguration.toggles`));

        console.log('\n' + divider());
        console.log(chalk.bold('  SUMMARY: 1 service needs updating'));
        console.log(divider());

        // ── APPLY MODE ──────────────────────────────────────────────────────
        if (!APPLY_MODE) {
            console.log(chalk.yellow('\n  ℹ️  This was a DRY-RUN. No changes were made.'));
            console.log(chalk.white('  To apply these changes to MongoDB, run:'));
            console.log(
                chalk.cyan('\n    node --env-file=.env scripts/migrateThesisBindingToggles.script.js --apply\n'),
            );
            console.log(chalk.gray('  Only bindingConfiguration.toggles will be updated on thesis-golden-bindings.'));
            console.log(chalk.gray('  Pricing rules, binding colors, basePrice, and all other fields are untouched.'));
            console.log(divider() + '\n');
            process.exit(0);
        }

        console.log('\n' + divider('─'));
        console.log(chalk.bgRed.white('  ⚡ APPLY MODE ACTIVE — Updating MongoDB...'));
        console.log(divider('─'));

        const result = await PrintService.updateOne(
            { _id: service._id },
            { $set: { 'bindingConfiguration.toggles': expectedToggles } },
        );

        if (result.modifiedCount === 1) {
            console.log(chalk.green(`\n  ✅ Updated: `) + chalk.yellow(TARGET_SLUG));
        } else {
            console.log(chalk.red(`\n  ❌ Update had no effect for: `) + chalk.yellow(TARGET_SLUG));
            process.exit(1);
        }

        // ── POST-APPLY VERIFICATION ──────────────────────────────────────────
        console.log('\n' + divider());
        console.log(chalk.bold('  VERIFICATION: Re-fetching updated service from MongoDB'));
        console.log(divider());

        const fresh = await PrintService.findOne({ slug: TARGET_SLUG }).select('slug bindingConfiguration').lean();

        if (!fresh) {
            console.log(chalk.red(`\n  ❌ Verify FAIL (not found): ${TARGET_SLUG}`));
            process.exit(1);
        }

        const actualCodes = (fresh.bindingConfiguration?.toggles ?? []).map((t) => t.code);
        const match =
            actualCodes.length === expectedCodes.length && actualCodes.every((c, i) => c === expectedCodes[i]);

        if (match) {
            console.log(
                chalk.green(`\n  ✅ Verified: `) +
                    chalk.yellow(TARGET_SLUG) +
                    chalk.gray(` → [${actualCodes.join(', ')}]`),
            );
        } else {
            console.log(
                chalk.red(`\n  ❌ Verify FAIL: `) +
                    chalk.yellow(TARGET_SLUG) +
                    chalk.gray(`\n     Expected: [${expectedCodes.join(', ')}]`) +
                    chalk.gray(`\n     Got     : [${actualCodes.join(', ')}]`),
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

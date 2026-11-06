// scripts/migrateBindingToggles.script.js
//
// PURPOSE:
//   Updates bindingConfiguration.toggles for non-thesis print services so that
//   only the 3 limited binding toggles (STAPLING, STICK_BINDING, SPIRAL_BINDING)
//   are stored in MongoDB — matching the business rule in the updated seed data.
//
//   Thesis services (thesis-printing, thesis-golden-bindings) keep all 7 toggles
//   and are NOT touched by this script.
//
// USAGE:
//   Dry-run only (safe, no writes):
//     node --env-file=.env scripts/migrateBindingToggles.script.js
//
//   Apply changes to MongoDB:
//     node --env-file=.env scripts/migrateBindingToggles.script.js --apply
//
// NOTE:
//   Only bindingConfiguration.toggles is updated on the affected services.
//   Pricing rules, bindingConfiguration.options, pricingModel, basePrice, and
//   all other fields are completely untouched.

import mongoose from 'mongoose';
import chalk from 'chalk';
import { dbConnection } from '#configs/db';
import PrintService from '#models/printService';
import { printServices } from './printServiceCatalog.data.js';

// ─── Configuration ────────────────────────────────────────────────────────────

// Slugs that must be updated (non-thesis services with all 7 toggles currently)
const AFFECTED_SLUGS = [
    'document-printing',
    'digital-printing',
    'photo-printing',
    'certificate',
    'poster-printing',
];

// Build the expected toggles for each affected slug by looking up the catalog.
// This is the same data the seeder would write — single source of truth.
const buildExpectedToggles = () => {
    const map = new Map();
    for (const slug of AFFECTED_SLUGS) {
        const entry = printServices.find((s) => s.slug === slug);
        if (!entry) throw new Error(`Slug "${slug}" not found in printServices catalog. Seed data may be out of date.`);
        map.set(slug, entry.bindingConfiguration?.toggles ?? []);
    }
    return map;
};

const APPLY_MODE = process.argv.includes('--apply');

// ─── Helpers ──────────────────────────────────────────────────────────────────

const divider = (char = '─', len = 60) => chalk.gray(char.repeat(len));

const formatToggleCodes = (toggles = []) =>
    toggles.length === 0
        ? chalk.gray('(none)')
        : toggles.map((t) => chalk.cyan(t.code)).join(', ');

// ─── Main ─────────────────────────────────────────────────────────────────────

(async () => {
    try {
        console.log('\n' + divider('═'));
        console.log(chalk.bold.cyan('  BINDING TOGGLES MIGRATION SCRIPT'));
        console.log(
            chalk.gray(
                `  Mode: ${APPLY_MODE ? chalk.bgRed.white(' APPLY — WRITES ENABLED ') : chalk.bgGreen.black(' DRY-RUN (read-only) ')}`,
            ),
        );
        console.log(divider('═') + '\n');

        await dbConnection();

        const expectedTogglesMap = buildExpectedToggles();

        // Fetch all affected services from MongoDB in one query
        const services = await PrintService.find({ slug: { $in: AFFECTED_SLUGS } })
            .select('slug name bindingConfiguration')
            .lean();

        const found = new Map(services.map((s) => [s.slug, s]));

        // ── DRY-RUN REPORT ──────────────────────────────────────────────────
        console.log(divider());
        console.log(chalk.bold('  PREVIEW: Changes to be applied'));
        console.log(divider());

        let changeCount = 0;
        const pendingUpdates = [];

        for (const slug of AFFECTED_SLUGS) {
            const service = found.get(slug);
            const expectedToggles = expectedTogglesMap.get(slug);

            console.log('\n' + chalk.white(`  Service: `) + chalk.yellow(slug));

            if (!service) {
                console.log(chalk.red(`    ⚠️  Not found in MongoDB — skipping. Run seed first: npm run print-services:seed`));
                continue;
            }

            const currentCodes = (service.bindingConfiguration?.toggles ?? []).map((t) => t.code);
            const expectedCodes = expectedToggles.map((t) => t.code);

            console.log(chalk.white(`    Current toggles  : `) + formatToggleCodes(service.bindingConfiguration?.toggles ?? []));
            console.log(chalk.white(`    Expected toggles : `) + formatToggleCodes(expectedToggles));

            const alreadyCorrect =
                currentCodes.length === expectedCodes.length &&
                currentCodes.every((c, i) => c === expectedCodes[i]);

            if (alreadyCorrect) {
                console.log(chalk.green(`    ✅ Already up to date — no change needed.`));
            } else {
                const removing = currentCodes.filter((c) => !expectedCodes.includes(c));
                if (removing.length > 0) {
                    console.log(chalk.gray(`    Removing          : `) + removing.map((c) => chalk.red(c)).join(', '));
                }
                console.log(chalk.yellow(`    → Will update bindingConfiguration.toggles`));
                changeCount++;
                pendingUpdates.push({ slug, serviceId: service._id, expectedToggles });
            }
        }

        console.log('\n' + divider());
        console.log(chalk.bold(`  SUMMARY: ${changeCount} service(s) need updating`));
        console.log(divider());

        if (changeCount === 0) {
            console.log(chalk.green('\n  ✅ All affected services are already up to date. Nothing to do.\n'));
            process.exit(0);
        }

        // ── APPLY MODE ──────────────────────────────────────────────────────
        if (!APPLY_MODE) {
            console.log(chalk.yellow('\n  ℹ️  This was a DRY-RUN. No changes were made.'));
            console.log(chalk.white('  To apply these changes to MongoDB, run:'));
            console.log(chalk.cyan('\n    node --env-file=.env scripts/migrateBindingToggles.script.js --apply\n'));
            console.log(chalk.gray('  Only bindingConfiguration.toggles will be updated on each affected service.'));
            console.log(chalk.gray('  Pricing rules, options, basePrice, and all other fields are untouched.'));
            console.log(divider() + '\n');
            process.exit(0);
        }

        console.log('\n' + divider('─'));
        console.log(chalk.bgRed.white('  ⚡ APPLY MODE ACTIVE — Updating MongoDB...'));
        console.log(divider('─'));

        let successCount = 0;
        let failCount = 0;

        for (const { slug, serviceId, expectedToggles } of pendingUpdates) {
            const result = await PrintService.updateOne(
                { _id: serviceId },
                { $set: { 'bindingConfiguration.toggles': expectedToggles } },
            );

            if (result.modifiedCount === 1) {
                console.log(chalk.green(`\n  ✅ Updated: `) + chalk.yellow(slug));
                successCount++;
            } else {
                console.log(chalk.red(`\n  ❌ Update had no effect for: `) + chalk.yellow(slug));
                failCount++;
            }
        }

        // ── POST-APPLY VERIFICATION ──────────────────────────────────────────
        console.log('\n' + divider());
        console.log(chalk.bold('  VERIFICATION: Re-fetching updated services from MongoDB'));
        console.log(divider());

        let verifyPassed = 0;
        let verifyFailed = 0;

        for (const slug of AFFECTED_SLUGS) {
            const expectedToggles = expectedTogglesMap.get(slug);
            const expectedCodes = expectedToggles.map((t) => t.code);

            const fresh = await PrintService.findOne({ slug }).select('slug bindingConfiguration').lean();
            if (!fresh) {
                console.log(chalk.red(`\n  ❌ Verify FAIL (not found): ${slug}`));
                verifyFailed++;
                continue;
            }

            const actualCodes = (fresh.bindingConfiguration?.toggles ?? []).map((t) => t.code);
            const match =
                actualCodes.length === expectedCodes.length &&
                actualCodes.every((c, i) => c === expectedCodes[i]);

            if (match) {
                console.log(
                    chalk.green(`\n  ✅ Verified: `) +
                        chalk.yellow(slug) +
                        chalk.gray(` → [${actualCodes.join(', ')}]`),
                );
                verifyPassed++;
            } else {
                console.log(
                    chalk.red(`\n  ❌ Verify FAIL: `) +
                        chalk.yellow(slug) +
                        chalk.gray(`\n     Expected: [${expectedCodes.join(', ')}]`) +
                        chalk.gray(`\n     Got     : [${actualCodes.join(', ')}]`),
                );
                verifyFailed++;
            }
        }

        console.log('\n' + divider());
        console.log(
            verifyFailed === 0
                ? chalk.bold.green(`  ✅ Migration complete. ${successCount} service(s) updated. All verifications passed.`)
                : chalk.bold.red(`  ❌ Migration finished with ${verifyFailed} verification failure(s). Review above output.`),
        );
        console.log(divider() + '\n');

        process.exit(verifyFailed > 0 || failCount > 0 ? 1 : 0);
    } catch (error) {
        console.error(chalk.bgRed.white('\n  CRITICAL ERROR:'), error.message);
        console.error(error);
        process.exit(1);
    } finally {
        await mongoose.connection.close();
        console.log(chalk.blue('\n  MongoDB connection closed.'));
    }
})();

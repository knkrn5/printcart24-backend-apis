// scripts/migrateRenameDigitalBindingLabel.script.js
//
// PURPOSE:
//   Updates the display label for the DIGITAL_BINDING toggle from
//     "Digital Binding"
//   to
//     "Gold and Silver Embossed Binding"
//
//   across ALL print services that contain a bindingConfiguration.toggles entry
//   with code === 'DIGITAL_BINDING'.
//
//   This is a one-time migration. It is idempotent — safe to run multiple times.
//   If the label is already correct, the script reports success with no writes.
//
//   Existing historical orders and cart records are NOT touched. Only the
//   label field inside bindingConfiguration.toggles on PrintService documents
//   is updated.
//
// USAGE:
//   Dry-run only (safe, no writes):
//     node --env-file=.env scripts/migrateRenameDigitalBindingLabel.script.js
//
//   Apply changes to MongoDB:
//     node --env-file=.env scripts/migrateRenameDigitalBindingLabel.script.js --apply
//
// NOTE:
//   Only bindingConfiguration.toggles[].label is updated where code === 'DIGITAL_BINDING'.
//   The code, pricing, descriptions, and all other fields are untouched.

import mongoose from 'mongoose';
import chalk from 'chalk';
import { dbConnection } from '#configs/db';
import PrintService from '#models/printService';

// ─── Configuration ────────────────────────────────────────────────────────────

const TARGET_CODE = 'DIGITAL_BINDING';
const OLD_LABEL = 'Digital Binding';
const NEW_LABEL = 'Gold and Silver Embossed Binding';

const APPLY_MODE = process.argv.includes('--apply');

// ─── Helpers ──────────────────────────────────────────────────────────────────

const divider = (char = '─', len = 60) => chalk.gray(char.repeat(len));

// ─── Main ─────────────────────────────────────────────────────────────────────

(async () => {
    try {
        console.log('\n' + divider('═'));
        console.log(chalk.bold.cyan('  RENAME DIGITAL_BINDING LABEL — MIGRATION SCRIPT'));
        console.log(
            chalk.gray(
                `  Mode: ${APPLY_MODE ? chalk.bgRed.white(' APPLY — WRITES ENABLED ') : chalk.bgGreen.black(' DRY-RUN (read-only) ')}`,
            ),
        );
        console.log(divider('═') + '\n');

        await dbConnection();

        // Find ALL services that contain a toggle with code DIGITAL_BINDING
        const services = await PrintService.find({
            'bindingConfiguration.toggles.code': TARGET_CODE,
        })
            .select('slug name bindingConfiguration.toggles')
            .lean();

        // ── DRY-RUN REPORT ──────────────────────────────────────────────────
        console.log(divider());
        console.log(chalk.bold('  PREVIEW: Changes to be applied'));
        console.log(divider());

        console.log(chalk.white(`  Target code   : `) + chalk.cyan(TARGET_CODE));
        console.log(chalk.white(`  Current label : `) + chalk.cyan(OLD_LABEL));
        console.log(chalk.white(`  Target label  : `) + chalk.cyan(NEW_LABEL));

        if (services.length === 0) {
            console.log(chalk.red(`\n  ⚠️  No services found with toggle code "${TARGET_CODE}" — nothing to update.`));
            console.log(divider() + '\n');
            process.exit(0);
        }

        const needsUpdate = [];

        for (const service of services) {
            const toggles = service.bindingConfiguration?.toggles || [];
            const toggle = toggles.find((t) => t.code === TARGET_CODE);

            if (!toggle) continue;

            console.log(
                `\n  ${chalk.yellow(service.slug)} ` +
                    chalk.gray(`(${service.name})`) +
                    `\n    Current label: ${toggle.label === OLD_LABEL ? chalk.cyan(toggle.label) : chalk.cyan(toggle.label)}` +
                    `\n    Target label : ${chalk.cyan(NEW_LABEL)}`,
            );

            if (toggle.label !== NEW_LABEL) {
                needsUpdate.push(service.slug);
            } else {
                console.log(chalk.gray(`    ✅ Already correct — no change needed.`));
            }
        }

        console.log('\n' + divider());
        console.log(
            chalk.bold(`  SUMMARY: ${needsUpdate.length} service(s) need updating out of ${services.length} found`),
        );
        console.log(divider());

        if (needsUpdate.length === 0) {
            console.log(chalk.green('\n  ✅ All labels are already up to date.'));
            console.log(divider() + '\n');
            process.exit(0);
        }

        // ── APPLY MODE ──────────────────────────────────────────────────────
        if (!APPLY_MODE) {
            console.log(chalk.yellow('\n  ℹ️  This was a DRY-RUN. No changes were made.'));
            console.log(chalk.white('  To apply these changes to MongoDB, run:'));
            console.log(
                chalk.cyan('\n    node --env-file=.env scripts/migrateRenameDigitalBindingLabel.script.js --apply\n'),
            );
            console.log(
                chalk.gray(
                    '  Only bindingConfiguration.toggles[].label (where code === DIGITAL_BINDING) will be updated.',
                ),
            );
            console.log(chalk.gray('  Codes, pricing, descriptions, orders, and all other fields are untouched.'));
            console.log(divider() + '\n');
            process.exit(0);
        }

        console.log('\n' + divider('─'));
        console.log(chalk.bgRed.white('  ⚡ APPLY MODE ACTIVE — Updating MongoDB...'));
        console.log(divider('─'));

        let totalModified = 0;
        const updatedSlugs = [];

        for (const slug of needsUpdate) {
            const result = await PrintService.updateOne(
                { slug, 'bindingConfiguration.toggles.code': TARGET_CODE },
                { $set: { 'bindingConfiguration.toggles.$.label': NEW_LABEL } },
            );

            if (result.modifiedCount === 1) {
                console.log(chalk.green(`  ✅ Updated: `) + chalk.yellow(slug));
                totalModified += 1;
                updatedSlugs.push(slug);
            } else if (result.matchedCount === 1) {
                console.log(chalk.yellow(`  ⚠️  Matched but not modified (already correct): `) + chalk.yellow(slug));
            } else {
                console.log(chalk.red(`  ❌ Not found: `) + chalk.yellow(slug));
            }
        }

        // ── POST-APPLY VERIFICATION ──────────────────────────────────────────
        console.log('\n' + divider());
        console.log(chalk.bold('  VERIFICATION: Re-fetching updated services from MongoDB'));
        console.log(divider());

        let verifyPass = true;

        for (const slug of updatedSlugs) {
            const fresh = await PrintService.findOne({ slug }).select('slug bindingConfiguration.toggles').lean();

            if (!fresh) {
                console.log(chalk.red(`  ❌ Verify FAIL (not found): ${slug}`));
                verifyPass = false;
                continue;
            }

            const toggle = fresh.bindingConfiguration?.toggles?.find((t) => t.code === TARGET_CODE);

            if (!toggle) {
                console.log(chalk.red(`  ❌ Verify FAIL (toggle missing): ${slug}`));
                verifyPass = false;
                continue;
            }

            if (toggle.label === NEW_LABEL) {
                console.log(
                    chalk.green(`  ✅ Verified: `) + chalk.yellow(slug) + chalk.gray(` → label: "${toggle.label}"`),
                );
            } else {
                console.log(
                    chalk.red(`  ❌ Verify FAIL: `) +
                        chalk.yellow(slug) +
                        chalk.gray(`\n     Expected: "${NEW_LABEL}"`) +
                        chalk.gray(`\n     Got     : "${toggle.label}"`),
                );
                verifyPass = false;
            }
        }

        console.log('\n' + divider());
        if (verifyPass) {
            console.log(
                chalk.bold.green(`  ✅ Migration complete. ${totalModified} service(s) updated. Verification passed.`),
            );
        } else {
            console.log(chalk.bold.red(`  ❌ Migration completed with verification failures.`));
            process.exit(1);
        }
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

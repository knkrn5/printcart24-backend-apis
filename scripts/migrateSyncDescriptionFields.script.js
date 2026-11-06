// scripts/migrateSyncDescriptionFields.script.js
//
// PURPOSE:
//   Synchronizes shortDescription and detailDescriptions for all 6 active print
//   services so that both fields contain identical content.
//
//   shortDescription is the source of truth (array of { points: string }).
//   detailDescriptions is synchronized to match (array of strings).
//
//   This is a one-time migration. It is idempotent — safe to run multiple times.
//   Services already in sync are skipped with no writes.
//
// USAGE:
//   Dry-run only (safe, no writes):
//     node --env-file=.env scripts/migrateSyncDescriptionFields.script.js
//
//   Apply changes to MongoDB:
//     node --env-file=.env scripts/migrateSyncDescriptionFields.script.js --apply
//
// NOTE:
//   Only shortDescription and detailDescriptions are updated on the listed active
//   services. All other fields, pricing, orders, cart, admin, and inactive services
//   are untouched.

import mongoose from 'mongoose';
import chalk from 'chalk';
import { dbConnection } from '#configs/db';
import PrintService from '#models/printService';

// ─── Configuration ────────────────────────────────────────────────────────────
// Source of truth: shortDescription points. detailDescriptions is derived to match.

const TARGETS = [
    {
        slug: 'document-printing',
        shortDescription: [
            { points: 'Standard A4/A3 page printing' },
            { points: 'High-contrast text and diagrams' },
            { points: 'Supports both Single and Double-sided pages' },
        ],
    },
    {
        slug: 'digital-printing',
        shortDescription: [
            { points: 'Vibrant color prints' },
            { points: 'Perfect for flyers, marketing assets, and portfolios' },
            { points: 'Heavy-duty paper configurations available' },
        ],
    },
    {
        slug: 'certificate',
        shortDescription: [
            { points: 'Printed on Premium Matte Sheet (250 GSM)' },
            { points: 'Starting at just ₹15 per print' },
            { points: 'Volume discount: ₹12 per print when ordering >100 prints' },
            { points: 'Designed for institutional awards, workshops, and diplomas' },
        ],
    },
    {
        slug: 'poster-printing',
        shortDescription: [
            { points: 'Large-format high fidelity prints (A2, A1, A0)' },
            { points: 'Vibrant color saturation' },
            { points: 'Premium heavy-duty poster sheets' },
        ],
    },
    {
        slug: 'thesis-golden-bindings',
        shortDescription: [
            { points: 'Elegant hardcover with metallic foil text (Gold/Silver)' },
            { points: 'Gold and silver embossed binding as per the university guidelines' },
            { points: 'Highly durable stitching and binding' },
            { points: 'Binding color options: Black, Mehroon, Blue, Green' },
        ],
    },
    {
        slug: 'thesis-printing',
        shortDescription: [
            { points: 'Standard academic thesis paper layout' },
            { points: 'Fast execution for submission deadlines' },
        ],
    },
];

// Derive detailDescriptions from shortDescription (single source of truth)
const TARGETS_WITH_DETAILS = TARGETS.map((t) => ({
    ...t,
    detailDescriptions: t.shortDescription.map((p) => p.points),
}));

const APPLY_MODE = process.argv.includes('--apply');

// ─── Helpers ──────────────────────────────────────────────────────────────────

const divider = (char = '─', len = 60) => chalk.gray(char.repeat(len));

const deepEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ─── Main ─────────────────────────────────────────────────────────────────────

(async () => {
    try {
        console.log('\n' + divider('═'));
        console.log(chalk.bold.cyan('  SYNC shortDescription + detailDescriptions — MIGRATION SCRIPT'));
        console.log(
            chalk.gray(
                `  Mode: ${APPLY_MODE ? chalk.bgRed.white(' APPLY — WRITES ENABLED ') : chalk.bgGreen.black(' DRY-RUN (read-only) ')}`,
            ),
        );
        console.log(divider('═') + '\n');

        await dbConnection();

        const slugs = TARGETS_WITH_DETAILS.map((t) => t.slug);
        const services = await PrintService.find({ slug: { $in: slugs } })
            .select('slug name shortDescription detailDescriptions')
            .lean();

        const serviceMap = new Map(services.map((s) => [s.slug, s]));

        // ── DRY-RUN REPORT ──────────────────────────────────────────────────
        console.log(divider());
        console.log(chalk.bold('  PREVIEW: Changes to be applied'));
        console.log(divider());

        let updatesNeeded = 0;

        for (const target of TARGETS_WITH_DETAILS) {
            const service = serviceMap.get(target.slug);

            console.log('\n' + chalk.white(`  Service: `) + chalk.yellow(target.slug));

            if (!service) {
                console.log(
                    chalk.red(
                        `    ⚠️  Not found in MongoDB — nothing to update. Run seed first: npm run print-services:seed`,
                    ),
                );
                continue;
            }

            const currentSD = service.shortDescription || [];
            const currentDD = service.detailDescriptions || [];
            const sdMatch = deepEqual(currentSD, target.shortDescription);
            const ddMatch = deepEqual(currentDD, target.detailDescriptions);

            console.log(
                chalk.white(`    shortDescription match  : `) + (sdMatch ? chalk.green('yes') : chalk.red('no')),
            );
            console.log(
                chalk.white(`    detailDescriptions match: `) + (ddMatch ? chalk.green('yes') : chalk.red('no')),
            );

            if (sdMatch && ddMatch) {
                console.log(chalk.green(`    ✅ Already in sync — no change needed.`));
                continue;
            }

            if (!sdMatch) {
                console.log(chalk.white(`    Current shortDescription : `) + chalk.gray(JSON.stringify(currentSD)));
                console.log(
                    chalk.white(`    Target  shortDescription : `) +
                        chalk.cyan(JSON.stringify(target.shortDescription)),
                );
            }
            if (!ddMatch) {
                console.log(chalk.white(`    Current detailDescriptions: `) + chalk.gray(JSON.stringify(currentDD)));
                console.log(
                    chalk.white(`    Target  detailDescriptions: `) +
                        chalk.cyan(JSON.stringify(target.detailDescriptions)),
                );
            }

            console.log(chalk.yellow(`    → Will update shortDescription and detailDescriptions`));
            updatesNeeded++;
        }

        console.log('\n' + divider());
        console.log(
            chalk.bold(
                updatesNeeded > 0
                    ? `  SUMMARY: ${updatesNeeded} service(s) need updating`
                    : '  SUMMARY: All services already in sync. 0 update(s) needed.',
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
            console.log(
                chalk.cyan('\n    node --env-file=.env scripts/migrateSyncDescriptionFields.script.js --apply\n'),
            );
            console.log(chalk.gray('  Only shortDescription and detailDescriptions are updated on active services.'));
            console.log(chalk.gray('  Pricing, orders, cart, admin, and all other fields are untouched.'));
            console.log(divider() + '\n');
            process.exit(0);
        }

        console.log('\n' + divider('─'));
        console.log(chalk.bgRed.white('  ⚡ APPLY MODE ACTIVE — Updating MongoDB...'));
        console.log(divider('─'));

        let appliedCount = 0;

        for (const target of TARGETS_WITH_DETAILS) {
            const service = serviceMap.get(target.slug);
            if (!service) continue;

            const currentSD = service.shortDescription || [];
            const currentDD = service.detailDescriptions || [];
            if (deepEqual(currentSD, target.shortDescription) && deepEqual(currentDD, target.detailDescriptions)) {
                continue;
            }

            const result = await PrintService.updateOne(
                { slug: target.slug },
                {
                    $set: {
                        shortDescription: target.shortDescription,
                        detailDescriptions: target.detailDescriptions,
                    },
                },
            );

            if (result.modifiedCount === 1 || result.matchedCount === 1) {
                console.log(chalk.green(`\n  ✅ Updated: `) + chalk.yellow(target.slug));
                appliedCount++;
            } else {
                console.log(chalk.red(`\n  ❌ Service not found: `) + chalk.yellow(target.slug));
            }
        }

        // ── POST-APPLY VERIFICATION ──────────────────────────────────────────
        console.log('\n' + divider());
        console.log(chalk.bold('  VERIFICATION: Re-fetching updated services from MongoDB'));
        console.log(divider());

        let allVerified = true;

        for (const target of TARGETS_WITH_DETAILS) {
            const fresh = await PrintService.findOne({ slug: target.slug })
                .select('slug shortDescription detailDescriptions')
                .lean();

            if (!fresh) {
                console.log(chalk.red(`\n  ❌ Verify FAIL (not found): ${target.slug}`));
                allVerified = false;
                continue;
            }

            const sdOk = deepEqual(fresh.shortDescription, target.shortDescription);
            const ddOk = deepEqual(fresh.detailDescriptions, target.detailDescriptions);

            if (sdOk && ddOk) {
                console.log(
                    chalk.green(`\n  ✅ Verified: `) +
                        chalk.yellow(target.slug) +
                        chalk.gray(
                            ` → shortDescription (${fresh.shortDescription.length} pts), detailDescriptions (${fresh.detailDescriptions.length} pts) match`,
                        ),
                );
            } else {
                console.log(chalk.red(`\n  ❌ Verify FAIL: `) + chalk.yellow(target.slug));
                if (!sdOk) {
                    console.log(chalk.red(`     shortDescription mismatch`));
                    console.log(chalk.gray(`       Expected: ${JSON.stringify(target.shortDescription)}`));
                    console.log(chalk.gray(`       Got     : ${JSON.stringify(fresh.shortDescription)}`));
                }
                if (!ddOk) {
                    console.log(chalk.red(`     detailDescriptions mismatch`));
                    console.log(chalk.gray(`       Expected: ${JSON.stringify(target.detailDescriptions)}`));
                    console.log(chalk.gray(`       Got     : ${JSON.stringify(fresh.detailDescriptions)}`));
                }
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

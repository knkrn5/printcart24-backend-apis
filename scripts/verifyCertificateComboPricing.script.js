// scripts/verifyCertificateComboPricing.script.js
//
// Run this against any database to confirm Certificate's pricing is unchanged.
// It computes the price for all 4 colorMode x pageBucket combinations via the real
// resolvePrintPricing() function, and compares each against the known-correct values.
// Read-only — makes no changes to any collection.
import mongoose from 'mongoose';
import chalk from 'chalk';
import { dbConnection } from '#configs/db';
import PrintService from '#models/printService';
import { resolvePrintPricing } from '#services/printPricing';

const SERVICE_SLUG = 'certificate';

const PROBES = [
    { colorMode: 'BW', totalPages: 50, bucket: 'PAGES_LTE_100', expected: 15 },
    { colorMode: 'BW', totalPages: 150, bucket: 'PAGES_GT_100', expected: 12 },
    { colorMode: 'COLOR', totalPages: 50, bucket: 'PAGES_LTE_100', expected: 30 },
    { colorMode: 'COLOR', totalPages: 150, bucket: 'PAGES_GT_100', expected: 24 },
];

const run = async () => {
    try {
        await dbConnection();
        console.log(chalk.cyan(`\nConnected to: ${mongoose.connection.host} / ${mongoose.connection.name}`));

        const service = await PrintService.findOne({ slug: SERVICE_SLUG }).lean();
        if (!service) {
            console.error(chalk.red(`Service "${SERVICE_SLUG}" not found.`));
            process.exit(1);
        }

        let allOk = true;
        console.log(chalk.bold('\n--- Verifying all 4 combinations ---'));

        const activeColorCodes = new Set(
            (service.supportedColorModes || []).filter((o) => o.isActive !== false).map((o) => o.code),
        );

        for (const probe of PROBES) {
            if (!activeColorCodes.has(probe.colorMode)) {
                console.log(chalk.gray(`  ${probe.colorMode}|${probe.bucket} => INACTIVE (preserved for future use)`));
                continue;
            }

            const { priceSummary } = await resolvePrintPricing({
                service,
                customization: { colorMode: probe.colorMode, copies: 1 },
                totalPages: probe.totalPages,
                documentCount: 1,
            });

            const perPage = Math.round((priceSummary.baseAmount / probe.totalPages) * 100) / 100;
            const ok = perPage === probe.expected;
            if (!ok) allOk = false;

            const key = `${probe.colorMode}|${probe.bucket}`.padEnd(25);
            const line = `  ${key} => ${String(perPage).padEnd(6)} (expected ${probe.expected})`;
            console.log(ok ? chalk.green(`${line} OK`) : chalk.bgRed.white(`${line} MISMATCH`));
        }

        if (!allOk) {
            console.error(chalk.bgRed.white('\nFAIL: one or more combinations did not match the expected price.'));
            process.exit(1);
        }

        console.log(chalk.bold.green('\nPASS: all active combinations match the expected prices exactly.\n'));
        process.exit(0);
    } catch (error) {
        console.error(chalk.bgRed.white('Error during verification:'), error.message, error);
        process.exit(1);
    } finally {
        await mongoose.connection.close();
        console.log(chalk.blue('MongoDB connection closed.'));
    }
};

run();

// scripts/verifyThesisPrintingComboPricing.script.js
//
// Run this against any database to confirm Thesis Printing's pricing is unchanged.
// It computes the price for all 4 colorMode x sideMode combinations via the real
// resolvePrintPricing() function, and compares each against the known-correct values.
// Read-only — makes no changes to any collection.
import mongoose from 'mongoose';
import chalk from 'chalk';
import { dbConnection } from '#configs/db';
import PrintService from '#models/printService';
import { resolvePrintPricing } from '#services/printPricing';

const SERVICE_SLUG = 'thesis-printing';

const PROBES = [
    { colorMode: 'BW', sideMode: 'SINGLE', expected: 3 },
    { colorMode: 'BW', sideMode: 'DOUBLE', expected: 6 },
    { colorMode: 'COLOR', sideMode: 'SINGLE', expected: 10 },
    { colorMode: 'COLOR', sideMode: 'DOUBLE', expected: 20 },
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

        for (const probe of PROBES) {
            const { priceSummary } = await resolvePrintPricing({
                service,
                customization: { colorMode: probe.colorMode, sideMode: probe.sideMode, copies: 1 },
                totalPages: 1,
                documentCount: 1,
            });

            const got = priceSummary.baseAmount;
            const ok = got === probe.expected;
            if (!ok) allOk = false;

            const key = `${probe.colorMode}|${probe.sideMode}`.padEnd(20);
            const line = `  ${key} => ${String(got).padEnd(6)} (expected ${probe.expected})`;
            console.log(ok ? chalk.green(`${line} OK`) : chalk.bgRed.white(`${line} MISMATCH`));
        }

        if (!allOk) {
            console.error(chalk.bgRed.white('\nFAIL: one or more combinations did not match the expected price.'));
            process.exit(1);
        }

        console.log(chalk.bold.green('\nPASS: all 4 combinations match the expected prices exactly.\n'));
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

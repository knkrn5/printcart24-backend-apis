// scripts/verifyPosterPrintingComboPricing.script.js
//
// Run this against any database to confirm Poster Printing's pricing is unchanged.
// It computes the price for all 9 paperQuality x paperSize combinations via the real
// resolvePrintPricing() function, and compares each against the known-correct values.
// Read-only — makes no changes to any collection.
import mongoose from 'mongoose';
import chalk from 'chalk';
import { dbConnection } from '#configs/db';
import PrintService from '#models/printService';
import { resolvePrintPricing } from '#services/printPricing';

const SERVICE_SLUG = 'poster-printing';

// colorMode is required by the service's own quality/color compatibility validation —
// not an independent pricing dimension here, so each probe uses the only valid color
// for its quality.
const COLOR_FOR_QUALITY = { POSTER_STANDARD: 'BW', GLOSSY: 'COLOR', FABRIC: 'COLOR' };

const PROBES = [
    { paperQuality: 'POSTER_STANDARD', paperSize: 'A2', expected: 60 },
    { paperQuality: 'POSTER_STANDARD', paperSize: 'A1', expected: 75 },
    { paperQuality: 'POSTER_STANDARD', paperSize: 'A0', expected: 100 },
    { paperQuality: 'GLOSSY', paperSize: 'A2', expected: 250 },
    { paperQuality: 'GLOSSY', paperSize: 'A1', expected: 500 },
    { paperQuality: 'GLOSSY', paperSize: 'A0', expected: 900 },
    { paperQuality: 'FABRIC', paperSize: 'A2', expected: 400 },
    { paperQuality: 'FABRIC', paperSize: 'A1', expected: 600 },
    { paperQuality: 'FABRIC', paperSize: 'A0', expected: 1500 },
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
        console.log(chalk.bold('\n--- Verifying all 9 combinations ---'));

        for (const probe of PROBES) {
            const { priceSummary } = await resolvePrintPricing({
                service,
                customization: {
                    colorMode: COLOR_FOR_QUALITY[probe.paperQuality],
                    paperSize: probe.paperSize,
                    paperQuality: probe.paperQuality,
                    sideMode: 'SINGLE',
                    copies: 1,
                },
                totalPages: 1,
                documentCount: 1,
            });

            const got = priceSummary.baseAmount;
            const ok = got === probe.expected;
            if (!ok) allOk = false;

            const key = `${probe.paperQuality}|${probe.paperSize}`.padEnd(25);
            const line = `  ${key} => ${String(got).padEnd(6)} (expected ${probe.expected})`;
            console.log(ok ? chalk.green(`${line} OK`) : chalk.bgRed.white(`${line} MISMATCH`));
        }

        if (!allOk) {
            console.error(chalk.bgRed.white('\nFAIL: one or more combinations did not match the expected price.'));
            process.exit(1);
        }

        console.log(chalk.bold.green('\nPASS: all 9 combinations match the expected prices exactly.\n'));
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

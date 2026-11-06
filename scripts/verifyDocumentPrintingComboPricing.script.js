// scripts/verifyDocumentPrintingComboPricing.script.js
//
// Run this against any database (including a separate one you manage) to confirm
// Document Printing's pricing is unchanged after the comboPricing swap. It computes
// the price for all 8 colorMode x paperSize x paperQuality combinations, both
// Single and Double sided (16 cases total), via the real resolvePrintPricing()
// function, and compares each against the known-correct values.
//
// Read-only — makes no changes to any collection.
import mongoose from 'mongoose';
import chalk from 'chalk';
import { dbConnection } from '#configs/db';
import PrintService from '#models/printService';
import { resolvePrintPricing } from '#services/printPricing';

const SERVICE_SLUG = 'document-printing';

// The known-correct price table — same values as originally hardcoded in
// services/printPricing.service.js, and the same values seedDocumentPrintingComboPricing
// .script.js writes into comboPricing. This script passes whether comboPricing has
// been seeded on this database yet (falls back to identical hardcoded logic) or not.
const EXPECTED = {
    'BW|A4|STANDARD_70_75_GSM|SINGLE': 1.5,
    'BW|A4|STANDARD_70_75_GSM|DOUBLE': 3,
    'BW|A4|SPECIAL_100_GSM|SINGLE': 3,
    'BW|A4|SPECIAL_100_GSM|DOUBLE': 6,
    'BW|A3|STANDARD_70_75_GSM|SINGLE': 6,
    'BW|A3|STANDARD_70_75_GSM|DOUBLE': 12,
    'BW|A3|SPECIAL_100_GSM|SINGLE': 8,
    'BW|A3|SPECIAL_100_GSM|DOUBLE': 16,
    'COLOR|A4|STANDARD_70_75_GSM|SINGLE': 8,
    'COLOR|A4|STANDARD_70_75_GSM|DOUBLE': 16,
    'COLOR|A4|SPECIAL_100_GSM|SINGLE': 16,
    'COLOR|A4|SPECIAL_100_GSM|DOUBLE': 32,
    'COLOR|A3|STANDARD_70_75_GSM|SINGLE': 20,
    'COLOR|A3|STANDARD_70_75_GSM|DOUBLE': 40,
    'COLOR|A3|SPECIAL_100_GSM|SINGLE': 40,
    'COLOR|A3|SPECIAL_100_GSM|DOUBLE': 80,
};

const COLOR_MODES = ['BW', 'COLOR'];
const PAPER_SIZES = ['A4', 'A3'];
const PAPER_QUALITIES = ['STANDARD_70_75_GSM', 'SPECIAL_100_GSM'];
const SIDE_MODES = ['SINGLE', 'DOUBLE'];

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
        console.log(chalk.bold('\n--- Verifying all 16 combinations ---'));

        for (const colorMode of COLOR_MODES) {
            for (const paperSize of PAPER_SIZES) {
                for (const paperQuality of PAPER_QUALITIES) {
                    for (const sideMode of SIDE_MODES) {
                        const { priceSummary } = await resolvePrintPricing({
                            service,
                            customization: { colorMode, paperSize, paperQuality, sideMode, copies: 1 },
                            totalPages: 1,
                            documentCount: 1,
                        });

                        const key = `${colorMode}|${paperSize}|${paperQuality}|${sideMode}`;
                        const got = priceSummary.baseAmount;
                        const expected = EXPECTED[key];
                        const ok = got === expected;
                        if (!ok) allOk = false;

                        const line = `  ${key.padEnd(45)} => ${String(got).padEnd(6)} (expected ${expected})`;
                        console.log(ok ? chalk.green(`${line} OK`) : chalk.bgRed.white(`${line} MISMATCH`));
                    }
                }
            }
        }

        if (!allOk) {
            console.error(chalk.bgRed.white('\nFAIL: one or more combinations did not match the expected price.'));
            process.exit(1);
        }

        console.log(chalk.bold.green('\nPASS: all 16 combinations match the expected prices exactly.\n'));
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

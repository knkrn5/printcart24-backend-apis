// scripts/seedDocumentPrintingComboPricing.script.js
//
// Phase 1 of moving Document Printing's hardcoded pricing into the database.
//
// This script ONLY copies today's existing hardcoded prices (from
// services/printPricing.service.js, the document-printing override block)
// into PrintServicePricing.comboPricing. It does NOT change how checkout
// calculates prices — that override block still uses its own hardcoded
// numbers until a separate, verified change switches it to read this field.
// Safe to run any number of times: it only ever touches the comboPricing
// field on the existing document, never basePricing/optionPricing/currency.
import mongoose from 'mongoose';
import chalk from 'chalk';
import { dbConnection } from '#configs/db';
import PrintService from '#models/printService';
import PrintServicePricing from '#models/printServicePricing';
import { getEffectivePricingConfig } from '#services/printPricing';

const SERVICE_SLUG = 'document-printing';

// Must exactly match the literals in services/printPricing.service.js
// (the document-printing block, ~lines 441-455) at the time this was written.
const COMBO_PRICES = [
    { colorMode: 'BW', paperSize: 'A4', paperQuality: 'STANDARD_70_75_GSM', unitPrice: 1.5 },
    { colorMode: 'BW', paperSize: 'A4', paperQuality: 'SPECIAL_100_GSM', unitPrice: 3 },
    { colorMode: 'BW', paperSize: 'A3', paperQuality: 'STANDARD_70_75_GSM', unitPrice: 6 },
    { colorMode: 'BW', paperSize: 'A3', paperQuality: 'SPECIAL_100_GSM', unitPrice: 8 },
    { colorMode: 'COLOR', paperSize: 'A4', paperQuality: 'STANDARD_70_75_GSM', unitPrice: 8 },
    { colorMode: 'COLOR', paperSize: 'A4', paperQuality: 'SPECIAL_100_GSM', unitPrice: 16 },
    { colorMode: 'COLOR', paperSize: 'A3', paperQuality: 'STANDARD_70_75_GSM', unitPrice: 20 },
    { colorMode: 'COLOR', paperSize: 'A3', paperQuality: 'SPECIAL_100_GSM', unitPrice: 40 },
].map((entry) => ({ ...entry, isActive: true }));

const run = async () => {
    try {
        await dbConnection();
        console.log(chalk.cyan(`\nConnected to: ${mongoose.connection.host} / ${mongoose.connection.name}`));
        console.log(chalk.cyan(`Looking up service "${SERVICE_SLUG}"...`));

        const service = await PrintService.findOne({ slug: SERVICE_SLUG }).lean();
        if (!service) {
            console.error(chalk.red(`Service "${SERVICE_SLUG}" not found. Run "npm run print-services:seed" first.`));
            process.exit(1);
        }

        // Only used if no PrintServicePricing document exists yet for this service —
        // gives a correct baseline instead of relying on schema defaults. If a document
        // already exists, this is ignored and only comboPricing is touched below.
        const fallback = await getEffectivePricingConfig(service);

        const result = await PrintServicePricing.findOneAndUpdate(
            { service: service._id },
            {
                $set: { comboPricing: COMBO_PRICES },
                $setOnInsert: {
                    service: service._id,
                    currency: fallback.currency || service.currency || 'INR',
                    basePricing: fallback.basePricing,
                    optionPricing: fallback.optionPricing || [],
                    isActive: true,
                },
            },
            { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
        );

        console.log(chalk.green(`\ncomboPricing set for "${SERVICE_SLUG}" (${COMBO_PRICES.length} combinations).`));
        console.log(chalk.bold.green('--- VERIFICATION ---'));
        result.comboPricing.forEach((entry) => {
            console.log(
                `  ${entry.colorMode} + ${entry.paperSize} + ${entry.paperQuality} => ${chalk.yellow(entry.unitPrice)}`,
            );
        });
        console.log(
            chalk.bold.green(
                '\nDone. Checkout pricing is unchanged by this script — it only populated storage for the admin panel.\n',
            ),
        );

        process.exit(0);
    } catch (error) {
        console.error(chalk.bgRed.white('Error seeding document-printing combo pricing:'), error.message, error);
        process.exit(1);
    } finally {
        await mongoose.connection.close();
        console.log(chalk.blue('MongoDB connection closed.'));
    }
};

run();

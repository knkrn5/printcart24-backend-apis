// scripts/seedThesisPrintingComboPricing.script.js
//
// Phase 1 of moving Thesis Printing's hardcoded pricing into the database.
//
// This script ONLY copies today's existing hardcoded prices (from
// services/printPricing.service.js, the thesis-printing override block) into
// PrintServicePricing.comboPricing. It does NOT change how checkout calculates
// prices — that override block already prefers a stored comboPricing row when one
// exists for the exact (colorMode, sideMode) combination, falling back to the
// original hardcoded numbers otherwise. Safe to run any number of times: it only
// ever touches the comboPricing field on the existing document, never
// basePricing/optionPricing/currency.
import mongoose from 'mongoose';
import chalk from 'chalk';
import { dbConnection } from '#configs/db';
import PrintService from '#models/printService';
import PrintServicePricing from '#models/printServicePricing';
import { getEffectivePricingConfig } from '#services/printPricing';

const SERVICE_SLUG = 'thesis-printing';

// Must exactly match the literals in services/printPricing.service.js
// (the thesis-printing block) at the time this was written.
const COMBO_PRICES = [
    { colorMode: 'BW', sideMode: 'SINGLE', unitPrice: 3 },
    { colorMode: 'BW', sideMode: 'DOUBLE', unitPrice: 6 },
    { colorMode: 'COLOR', sideMode: 'SINGLE', unitPrice: 10 },
    { colorMode: 'COLOR', sideMode: 'DOUBLE', unitPrice: 20 },
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
            console.log(`  ${entry.colorMode} + ${entry.sideMode} => ${chalk.yellow(entry.unitPrice)}`);
        });
        console.log(
            chalk.bold.green(
                '\nDone. Checkout pricing is unchanged by this script — it only populated storage for the admin panel.\n',
            ),
        );

        process.exit(0);
    } catch (error) {
        console.error(chalk.bgRed.white('Error seeding thesis-printing combo pricing:'), error.message, error);
        process.exit(1);
    } finally {
        await mongoose.connection.close();
        console.log(chalk.blue('MongoDB connection closed.'));
    }
};

run();

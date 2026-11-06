// scripts/seedCertificateComboPricing.script.js
//
// Phase 1 of moving Certificate's hardcoded pricing into the database.
//
// This script ONLY copies today's existing hardcoded prices (from
// services/printPricing.service.js, the certificate override block) into
// PrintServicePricing.comboPricing. It does NOT change how checkout calculates
// prices — that override block already prefers a stored comboPricing row when one
// exists for the exact (colorMode, pageBucket) combination, falling back to the
// original hardcoded numbers otherwise. Safe to run any number of times: it only
// ever touches the comboPricing field on the existing document, never
// basePricing/optionPricing/currency.
import mongoose from 'mongoose';
import chalk from 'chalk';
import { dbConnection } from '#configs/db';
import PrintService from '#models/printService';
import PrintServicePricing from '#models/printServicePricing';
import { getEffectivePricingConfig } from '#services/printPricing';

const SERVICE_SLUG = 'certificate';

// Must exactly match the literals in services/printPricing.service.js
// (the certificate block) at the time this was written: bwUnitPrice = pages > 100
// ? 12 : 15, doubled for COLOR.
const COMBO_PRICES = [
    { colorMode: 'BW', pageBucket: 'PAGES_LTE_100', unitPrice: 15 },
    { colorMode: 'BW', pageBucket: 'PAGES_GT_100', unitPrice: 12 },
    { colorMode: 'COLOR', pageBucket: 'PAGES_LTE_100', unitPrice: 30 },
    { colorMode: 'COLOR', pageBucket: 'PAGES_GT_100', unitPrice: 24 },
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
            console.log(`  ${entry.colorMode} + ${entry.pageBucket} => ${chalk.yellow(entry.unitPrice)}`);
        });
        console.log(
            chalk.bold.green(
                '\nDone. Checkout pricing is unchanged by this script — it only populated storage for the admin panel.\n',
            ),
        );

        process.exit(0);
    } catch (error) {
        console.error(chalk.bgRed.white('Error seeding certificate combo pricing:'), error.message, error);
        process.exit(1);
    } finally {
        await mongoose.connection.close();
        console.log(chalk.blue('MongoDB connection closed.'));
    }
};

run();

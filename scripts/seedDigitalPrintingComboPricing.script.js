// scripts/seedDigitalPrintingComboPricing.script.js
//
// Populates PrintServicePricing.comboPricing for Digital Printing with initial baseline values
// across all 8 (colorMode x paperSize x paperQuality) combinations:
//   - BW + A4 + (70-75 GSM / 100 GSM) => ₹10
//   - BW + A3 + (70-75 GSM / 100 GSM) => ₹14
//   - COLOR + A4 + (70-75 GSM / 100 GSM) => ₹15
//   - COLOR + A3 + (70-75 GSM / 100 GSM) => ₹19
//
// Safe to run any number of times: it merges into comboPricing and does not wipe out
// basePricing or optionPricing. Admin can then edit each combination independently.

import mongoose from 'mongoose';
import chalk from 'chalk';
import { dbConnection } from '#configs/db';
import PrintService from '#models/printService';
import PrintServicePricing from '#models/printServicePricing';
import { getEffectivePricingConfig } from '#services/printPricing';

const SERVICE_SLUG = 'digital-printing';

const COMBO_PRICES = [
    { colorMode: 'BW', paperSize: 'A4', paperQuality: '70_75_GSM', unitPrice: 10 },
    { colorMode: 'BW', paperSize: 'A4', paperQuality: '100_GSM', unitPrice: 10 },
    { colorMode: 'BW', paperSize: 'A3', paperQuality: '70_75_GSM', unitPrice: 14 },
    { colorMode: 'BW', paperSize: 'A3', paperQuality: '100_GSM', unitPrice: 14 },
    { colorMode: 'COLOR', paperSize: 'A4', paperQuality: '70_75_GSM', unitPrice: 15 },
    { colorMode: 'COLOR', paperSize: 'A4', paperQuality: '100_GSM', unitPrice: 15 },
    { colorMode: 'COLOR', paperSize: 'A3', paperQuality: '70_75_GSM', unitPrice: 19 },
    { colorMode: 'COLOR', paperSize: 'A3', paperQuality: '100_GSM', unitPrice: 19 },
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
            console.log(`  ${entry.colorMode} + ${entry.paperSize} + ${entry.paperQuality} => ${chalk.yellow(entry.unitPrice)}`);
        });
        console.log(chalk.bold.green('\nDone. Seeded comboPricing successfully.\n'));

        process.exit(0);
    } catch (error) {
        console.error(chalk.bgRed.white('Error seeding digital printing combo pricing:'), error.message, error);
        process.exit(1);
    } finally {
        await mongoose.connection.close();
        console.log(chalk.blue('MongoDB connection closed.'));
    }
};

run();

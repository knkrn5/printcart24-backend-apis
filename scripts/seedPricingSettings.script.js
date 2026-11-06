// scripts/seedPricingSettings.script.js
import mongoose from 'mongoose';
import chalk from 'chalk';
import env from '#configs/env';
import { dbConnection } from '#configs/db';
import PricingSetting from '#models/pricingSetting';
import { DEFAULT_PRICING_SETTINGS } from '#services/pricingSetting';

(async () => {
    try {
        console.log(chalk.blue('=== Seeding Global Pricing Settings ==='));
        await dbConnection();

        let settings = await PricingSetting.findOne();
        if (!settings) {
            console.log(chalk.yellow('No pricing settings found. Creating baseline default document...'));
            settings = await PricingSetting.create({
                platformFee: DEFAULT_PRICING_SETTINGS.platformFee,
                deliveryFee: DEFAULT_PRICING_SETTINGS.deliveryFee,
                gstPercentage: DEFAULT_PRICING_SETTINGS.gstPercentage,
                sameDayRepeatDiscountPercentage: DEFAULT_PRICING_SETTINGS.sameDayRepeatDiscountPercentage,
            });
            console.log(chalk.green('✔ Baseline pricing settings created successfully:'));
        } else {
            console.log(chalk.cyan('ℹ Existing pricing settings document found:'));
        }

        console.log(
            JSON.stringify(
                {
                    _id: settings._id,
                    platformFee: settings.platformFee,
                    deliveryFee: settings.deliveryFee,
                    gstPercentage: settings.gstPercentage,
                    sameDayRepeatDiscountPercentage: settings.sameDayRepeatDiscountPercentage,
                    updatedAt: settings.updatedAt,
                },
                null,
                2,
            ),
        );

        console.log(chalk.bold.green('\n✅ Pricing settings seeding finished successfully!'));
        process.exit(0);
    } catch (error) {
        console.error(chalk.bgRed.white('\n✖ Seeding failed:'), error);
        process.exit(1);
    } finally {
        await mongoose.connection.close();
        console.log(chalk.blue('MongoDB connection closed.'));
    }
})();

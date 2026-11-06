// scripts/seedPrintServicePricing.script.js
import mongoose from 'mongoose';
import chalk from 'chalk';

import { dbConnection } from '#configs/db';
import PrintService from '#models/printService';
import PrintServicePricing from '#models/printServicePricing';
import { printServicePricingProfiles } from './printServiceCatalog.data.js';

(async () => {
    try {
        await dbConnection();

        const services = await PrintService.find({
            slug: { $in: printServicePricingProfiles.map((profile) => profile.slug) },
        }).select('_id slug');

        const serviceIdBySlug = new Map(services.map((service) => [service.slug, service._id]));

        const missingSlugs = printServicePricingProfiles
            .map((profile) => profile.slug)
            .filter((slug) => !serviceIdBySlug.has(slug));

        if (missingSlugs.length > 0) {
            throw new Error(`Seed services first. Missing services for slugs: ${missingSlugs.join(', ')}`);
        }

        // 1. Delete pricing profiles that are no longer present in the local active catalog list
        const activeServiceIds = Array.from(serviceIdBySlug.values());
        await PrintServicePricing.deleteMany({ service: { $nin: activeServiceIds } });

        // 2. Build bulk operations that update only the fields this script manages
        //    (currency/basePricing/optionPricing/isActive). Using $set instead of a
        //    full replaceOne preserves any other field on the document — notably
        //    comboPricing (managed separately, e.g. by seedDocumentPrintingComboPricing.script.js)
        //    and updatedBy (the admin audit trail) — so re-running this script never
        //    silently wipes admin-managed data outside its own scope.
        const bulkOperations = printServicePricingProfiles.map((profile) => ({
            updateOne: {
                filter: { service: serviceIdBySlug.get(profile.slug) },
                update: {
                    $set: {
                        service: serviceIdBySlug.get(profile.slug),
                        currency: profile.currency,
                        basePricing: profile.basePricing,
                        optionPricing: profile.optionPricing,
                        isActive: true,
                    },
                },
                upsert: true,
            },
        }));

        const result = await PrintServicePricing.bulkWrite(bulkOperations, { ordered: false });

        console.log(chalk.green(`Seeded ${printServicePricingProfiles.length} print service pricing profiles.`));
        console.log(
            chalk.blue(
                `Bulk result -> matched: ${result.matchedCount || 0}, inserted: ${result.insertedCount || 0}, modified: ${result.modifiedCount || 0}, upserted: ${result.upsertedCount || 0}`,
            ),
        );

        process.exit(0);
    } catch (error) {
        console.error(chalk.bgRed.white('Error during print service pricing seeding:'), error.message, error);
        process.exit(1);
    } finally {
        await mongoose.connection.close();
        console.log(chalk.blue('MongoDB connection closed.'));
    }
})();

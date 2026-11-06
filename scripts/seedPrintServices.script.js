import mongoose from 'mongoose';
import chalk from 'chalk';

import { dbConnection } from '#configs/db';
import PrintService from '#models/printService';
import { printServices } from './printServiceCatalog.data.js';

(async () => {
    try {
        await dbConnection();

        // 1. Delete services that are no longer present in the local catalog array
        const activeSlugs = printServices.map((service) => service.slug);
        await PrintService.deleteMany({ slug: { $nin: activeSlugs } });

        // 2. Build replaceOne bulk operations to completely overwrite existing documents
        const bulkOperations = printServices.map((service) => ({
            replaceOne: {
                filter: { slug: service.slug },
                replacement: { gstPercentage: 18, ...service },
                upsert: true,
            },
        }));

        const result = await PrintService.bulkWrite(bulkOperations, { ordered: false });

        console.log(chalk.green(`Seeded ${printServices.length} print services.`));
        console.log(
            chalk.blue(
                `Bulk result -> matched: ${result.matchedCount || 0}, inserted: ${result.insertedCount || 0}, modified: ${result.modifiedCount || 0}, upserted: ${result.upsertedCount || 0}`,
            ),
        );
        console.log(chalk.yellow('Run pricing seed after this: npm run print-service-pricing:seed'));

        process.exit(0);
    } catch (error) {
        console.error(chalk.bgRed.white('Error during print service seeding:'), error.message, error);
        process.exit(1);
    } finally {
        await mongoose.connection.close();
        console.log(chalk.blue('MongoDB connection closed.'));
    }
})();

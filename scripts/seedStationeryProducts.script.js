import mongoose from 'mongoose';
import chalk from 'chalk';

import { dbConnection } from '#configs/db';
import StationeryProduct from '#models/stationeryProduct';
import { stationeryProducts } from './stationeryCatalog.data.js';

(async () => {
    try {
        await dbConnection();

        const bulkOperations = stationeryProducts.map((product) => ({
            updateOne: {
                filter: { name: product.name },
                update: { $set: product },
                upsert: true,
            },
        }));

        const result = await StationeryProduct.bulkWrite(bulkOperations, { ordered: false });

        console.log(chalk.green(`Seeded ${stationeryProducts.length} stationery products.`));
        console.log(
            chalk.blue(
                `Bulk result -> inserted: ${result.insertedCount || 0}, modified: ${result.modifiedCount || 0}, upserted: ${result.upsertedCount || 0}`,
            ),
        );

        process.exit(0);
    } catch (error) {
        console.error(chalk.bgRed.white('Error during stationery product seeding:'), error.message, error);
        process.exit(1);
    } finally {
        await mongoose.connection.close();
        console.log(chalk.blue('MongoDB connection closed.'));
    }
})();

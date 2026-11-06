// scripts/updateAtlasDocumentPrintingPrice.script.js
import mongoose from 'mongoose';
import chalk from 'chalk';
import { dbConnection } from '#configs/db';
import PrintService from '#models/printService';
import PrintServicePricing from '#models/printServicePricing';

const SERVICE_SLUG = 'document-printing';
const NEW_PRICE = 1.5;

const run = async () => {
    try {
        await dbConnection();

        console.log(chalk.cyan(`\nConnected to: ${mongoose.connection.host} / ${mongoose.connection.name}`));
        console.log(chalk.cyan(`Looking up service "${SERVICE_SLUG}"...`));

        const service = await PrintService.findOne({ slug: SERVICE_SLUG });
        if (!service) {
            console.error(chalk.red(`Service "${SERVICE_SLUG}" not found.`));
            process.exit(1);
        }

        console.log(`Current PrintService basePrice: ${chalk.yellow(service.basePrice)}`);

        // 1. Update PrintService
        const serviceRes = await PrintService.updateOne(
            { slug: SERVICE_SLUG },
            { $set: { basePrice: NEW_PRICE } }
        );
        console.log(chalk.green(`PrintService updated -> matched: ${serviceRes.matchedCount}, modified: ${serviceRes.modifiedCount}`));

        // 2. Update PrintServicePricing
        const pricingRes = await PrintServicePricing.updateOne(
            { service: service._id },
            { $set: { 'basePricing.unitPrice': NEW_PRICE } }
        );
        console.log(chalk.green(`PrintServicePricing updated -> matched: ${pricingRes.matchedCount}, modified: ${pricingRes.modifiedCount}`));

        // 3. Verify
        const updatedService = await PrintService.findOne({ slug: SERVICE_SLUG }).lean();
        const updatedPricing = await PrintServicePricing.findOne({ service: service._id }).lean();

        console.log(chalk.bold.green('\n--- VERIFICATION AFTER UPDATE ---'));
        console.log(`PrintService.basePrice: ${chalk.bold.yellow(updatedService.basePrice)}`);
        console.log(`PrintServicePricing.basePricing.unitPrice: ${chalk.bold.yellow(updatedPricing?.basePricing?.unitPrice)}`);
        console.log(chalk.bold.green('Update completed successfully.\n'));

        process.exit(0);
    } catch (err) {
        console.error(chalk.red('Error during Atlas update:'), err.message, err);
        process.exit(1);
    } finally {
        await mongoose.connection.close();
    }
};

run();

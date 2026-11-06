import mongoose from 'mongoose';
import { dbConnection } from '#configs/db';
import PrintService from '#models/printService';

const SERVICE_SLUG = 'document-printing';
const OPTION_CODE = 'STANDARD_70_75_GSM';
const NEW_LABEL = '70-75 GSM';

const run = async () => {
    try {
        await dbConnection();

        const service = await PrintService.findOne({ slug: SERVICE_SLUG });
        if (!service) {
            console.error(`Service "${SERVICE_SLUG}" not found.`);
            process.exit(1);
        }

        const option = service.supportedPaperQualities.find((o) => o.code === OPTION_CODE);
        if (!option) {
            console.error(`Option "${OPTION_CODE}" not found in supportedPaperQualities for "${SERVICE_SLUG}".`);
            process.exit(1);
        }

        console.log('--- BEFORE ---');
        console.log(
            JSON.stringify(
                service.supportedPaperQualities.map((o) => ({ code: o.code, label: o.label })),
                null,
                2,
            ),
        );

        const result = await PrintService.updateOne(
            { slug: SERVICE_SLUG, 'supportedPaperQualities.code': OPTION_CODE },
            { $set: { 'supportedPaperQualities.$.label': NEW_LABEL } },
        );

        if (result.modifiedCount === 0) {
            console.warn('No document was modified. The label may already be up to date.');
        }

        const updated = await PrintService.findOne({ slug: SERVICE_SLUG });
        console.log('\n--- AFTER ---');
        console.log(
            JSON.stringify(
                updated.supportedPaperQualities.map((o) => ({ code: o.code, label: o.label })),
                null,
                2,
            ),
        );

        console.log('\nDone.');
        process.exit(0);
    } catch (error) {
        console.error('Error:', error.message);
        process.exit(1);
    } finally {
        await mongoose.connection.close();
    }
};

run();

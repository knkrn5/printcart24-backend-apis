// scripts/updateDigitalPrintingPaperQualities.js
// Targeted $set — only updates supportedPaperQualities on the digital-printing service.
// Does NOT use replaceOne; other fields on the document are untouched.
import mongoose from 'mongoose';
import { dbConnection } from '#configs/db';
import PrintService from '#models/printService';

const SERVICE_SLUG = 'digital-printing';
const NEW_PAPER_QUALITIES = [
    { code: '70_75_GSM', label: '70-75 GSM', isDefault: true, isActive: true, colorModeFilter: ['BW'] },
    { code: '100_GSM', label: '100 GSM', isDefault: false, isActive: true, colorModeFilter: ['COLOR'] },
];

const run = async () => {
    try {
        await dbConnection();

        const service = await PrintService.findOne({ slug: SERVICE_SLUG });
        if (!service) {
            console.error(`Service "${SERVICE_SLUG}" not found.`);
            process.exit(1);
        }

        console.log('--- BEFORE ---');
        console.log(
            JSON.stringify(
                service.supportedPaperQualities.map((o) => ({
                    code: o.code,
                    label: o.label,
                    isDefault: o.isDefault,
                    isActive: o.isActive,
                    colorModeFilter: o.colorModeFilter,
                })),
                null,
                2,
            ),
        );

        const result = await PrintService.updateOne(
            { slug: SERVICE_SLUG },
            { $set: { supportedPaperQualities: NEW_PAPER_QUALITIES } },
        );

        if (result.modifiedCount === 0) {
            console.warn('No document was modified. The data may already be up to date.');
        }

        const updated = await PrintService.findOne({ slug: SERVICE_SLUG });
        console.log('\n--- AFTER ---');
        console.log(
            JSON.stringify(
                updated.supportedPaperQualities.map((o) => ({
                    code: o.code,
                    label: o.label,
                    isDefault: o.isDefault,
                    isActive: o.isActive,
                    colorModeFilter: o.colorModeFilter,
                })),
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

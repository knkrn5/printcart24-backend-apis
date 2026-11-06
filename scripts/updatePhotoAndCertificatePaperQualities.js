// scripts/updatePhotoAndCertificatePaperQualities.js
// Targeted $set — only updates supportedPaperQualities on photo-printing and certificate.
// Does NOT use replaceOne; other fields on each document are untouched.
import mongoose from 'mongoose';
import { dbConnection } from '#configs/db';
import PrintService from '#models/printService';

const UPDATES = [
    {
        slug: 'photo-printing',
        paperQualities: [{ code: '300_GSM_ART_CARD', label: '300 GSM Art Card', isDefault: true, isActive: true }],
    },
    {
        slug: 'certificate',
        paperQualities: [{ code: 'MATT_SHEET_250_GSM', label: 'Matt Sheet(250GSM)', isDefault: true, isActive: true }],
    },
];

const run = async () => {
    try {
        await dbConnection();

        for (const { slug, paperQualities } of UPDATES) {
            const service = await PrintService.findOne({ slug });
            if (!service) {
                console.error(`Service "${slug}" not found — skipping.`);
                continue;
            }

            console.log(`\n=== ${slug} BEFORE ===`);
            console.log(JSON.stringify(service.supportedPaperQualities, null, 2));

            const result = await PrintService.updateOne(
                { slug },
                { $set: { supportedPaperQualities: paperQualities } },
            );

            if (result.modifiedCount === 0) {
                console.warn('No document was modified. The data may already be up to date.');
            }

            const updated = await PrintService.findOne({ slug });
            console.log(`\n=== ${slug} AFTER ===`);
            console.log(JSON.stringify(updated.supportedPaperQualities, null, 2));
        }

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

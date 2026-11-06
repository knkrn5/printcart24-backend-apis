import { dbConnection } from '#configs/db';
import PrintService from '#models/printService';
import mongoose from 'mongoose';

const run = async () => {
    try {
        await dbConnection();
        const services = await PrintService.find().lean();
        for (const s of services) {
            console.log(`Service: ${s.slug} (${s.name})`);
            const langToggle = s.bindingConfiguration?.toggles?.find(t => t.code === 'LANGUAGE');
            if (langToggle) {
                console.log('  Language Toggle found:');
                console.dir(langToggle, { depth: null });
            }
        }
        await mongoose.connection.close();
    } catch (err) {
        console.error('Error:', err);
    }
};

run();

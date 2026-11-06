import { dbConnection } from '#configs/db';
import PrintService from '#models/printService';
import mongoose from 'mongoose';

const run = async () => {
    try {
        await dbConnection();
        const service = await PrintService.findOne({ slug: 'thesis-printing' }).lean();
        if (!service) {
            console.log('thesis-printing service not found.');
        } else {
            console.log('thesis-printing binding configuration:');
            console.dir(service.bindingConfiguration, { depth: null });
        }
        await mongoose.connection.close();
    } catch (err) {
        console.error('Error:', err);
    }
};

run();

// scripts/diagnoseDbIds.script.js
import mongoose from 'mongoose';
import { dbConnection } from '#configs/db';
import PrintService from '#models/printService';

(async () => {
    try {
        await dbConnection();
        const service = await PrintService.findOne({ slug: 'thesis-printing' }).lean();
        console.log('DATABASE VALUE:');
        console.log(JSON.stringify(service?.bindingConfiguration, null, 2));
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    } finally {
        await mongoose.connection.close();
    }
})();

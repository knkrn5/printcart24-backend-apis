// scripts/migrateCertificateColorMode.script.js
//
// PURPOSE:
//   Restores isActive: true on the 'BW' option in supportedColorModes for 'certificate'
//   so that existing client apps querying GET /api/print-services/certificate?section=colorModes
//   continue to receive both color modes, while the admin combo pricing controller
//   specifically displays only the COLOR combinations.

import mongoose from 'mongoose';
import chalk from 'chalk';
import { dbConnection } from '#configs/db';
import PrintService from '#models/printService';

const SERVICE_SLUG = 'certificate';

(async () => {
    try {
        await dbConnection();

        const service = await PrintService.findOne({ slug: SERVICE_SLUG });
        if (!service) {
            console.error(chalk.red(`Service "${SERVICE_SLUG}" not found.`));
            process.exit(1);
        }

        await PrintService.updateOne(
            { _id: service._id, 'supportedColorModes.code': 'BW' },
            { $set: { 'supportedColorModes.$.isActive': true } }
        );

        const updated = await PrintService.findOne({ slug: SERVICE_SLUG }).lean();
        console.log(chalk.green('Updated supportedColorModes in MongoDB:'));
        console.log(JSON.stringify(updated.supportedColorModes.map(c => ({ code: c.code, label: c.label, isActive: c.isActive })), null, 2));

        process.exit(0);
    } catch (error) {
        console.error(chalk.red('Error:'), error);
        process.exit(1);
    } finally {
        await mongoose.connection.close();
    }
})();

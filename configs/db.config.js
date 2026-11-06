// configs/db.config.js
import chalk from 'chalk';
import mongoose from 'mongoose';
import env from '#configs/env';
import dns from 'dns';

const dbURL = env.DB_URL;

export const dbConnection = async () => {
    try {
        if (env.FORCE_GOOGLE_DNS === 'true') {
            // Force Google DNS for some Windows machines
            dns.setServers(['8.8.8.8', '8.8.4.4']);
        }
        // Global Mongoose config before connection
        mongoose.set('toJSON', { virtuals: false, versionKey: false });

        await mongoose.connect(dbURL);
        const { host, name } = mongoose.connection;
        console.log(chalk.bgGreen(`Database connected to Host: ${host}, Database: ${name}`));
    } catch (error) {
        console.error(chalk.bgRed('Database connection failed:', error));
        throw new Error(`Failed to connect to database: ${error.message}`);
    }
};

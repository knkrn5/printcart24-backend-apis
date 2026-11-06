// scripts/initializeAdmin.script.js
import mongoose from 'mongoose';
import chalk from 'chalk';

import env from '#configs/env';
import Admin from '#models/admin';
import { dbConnection } from '#configs/db';

/* -------------------------------------------------------
    Initialize Admin
------------------------------------------------------- */
(async () => {
    try {
        // 1. Ensure DB connection
        await dbConnection();

        // 2. Read credentials from ENV
        const { SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD, SUPER_ADMIN_MOBILE, SUPER_ADMIN_NAME } = env;

        if (!SUPER_ADMIN_EMAIL || !SUPER_ADMIN_PASSWORD || !SUPER_ADMIN_MOBILE) {
            console.error(chalk.bgRed.white('CRITICAL: SUPER_ADMIN_EMAIL / PASSWORD / MOBILE missing in env'));
            process.exit(1);
        }

        // 3. Check if SUPER ADMIN already exists
        const existingSuperAdmin = await Admin.findOne({
            $or: [{ role: 'SUPER_ADMIN' }, { email: SUPER_ADMIN_EMAIL }],
        });

        if (existingSuperAdmin) {
            console.log(chalk.yellow(`Super Admin already exists → ${existingSuperAdmin.email}`));
            process.exit(0);
        }

        // 4. Create Bootstrap Admin
        const superAdmin = await Admin.create({
            fullName: SUPER_ADMIN_NAME || 'System Administrator',
            email: SUPER_ADMIN_EMAIL,
            password: SUPER_ADMIN_PASSWORD,
            phone: SUPER_ADMIN_MOBILE,
            profilePicture: env.SUPER_ADMIN_IMAGE_URL || '',
            role: 'SUPER_ADMIN',
            isActive: true,
            isEmailVerified: true,
            isMobileVerified: true,
        });

        console.log(chalk.green(`\n✅ Super Admin created successfully → ${superAdmin.email}`));

        process.exit(0);
    } catch (error) {
        console.error(chalk.bgRed.white('Error during initializing admin creation:'), error.message, error);
        process.exit(1);
    } finally {
        // 5. Always close DB connection
        await mongoose.connection.close();
        console.log(chalk.blue('MongoDB connection closed.'));
    }
})();

// scripts/migrateDeletedUsersCredentials.script.js
import mongoose from 'mongoose';
import chalk from 'chalk';

import { dbConnection } from '#configs/db';
import User from '#models/user';

(async () => {
    try {
        console.log(chalk.bold.yellow('Starting migration to anonymize existing soft-deleted accounts...'));

        // 1. Connect to Database
        await dbConnection();
        console.log(chalk.green('Database connected.'));

        // 2. Query for soft-deleted users whose credentials are not yet anonymized
        const filter = {
            isDeleted: true,
            $or: [
                { phone: { $exists: true, $ne: null, $not: /^deleted_/ } },
                { email: { $exists: true, $ne: null, $not: /^deleted_/ } },
                { googleId: { $exists: true, $ne: null, $not: /^deleted_/ } }
            ]
        };

        const usersToMigrate = await User.find(filter);
        console.log(`Found ${chalk.cyan(usersToMigrate.length)} user(s) requiring migration.`);

        let migratedCount = 0;

        for (const user of usersToMigrate) {
            const userId = user._id;
            let updated = false;

            if (user.phone && !user.phone.startsWith('deleted_')) {
                user.phone = `deleted_${userId}_${user.phone}`;
                updated = true;
            }
            if (user.email && !user.email.startsWith('deleted_')) {
                user.email = `deleted_${userId}_${user.email}`;
                updated = true;
            }
            if (user.googleId && !user.googleId.startsWith('deleted_')) {
                user.googleId = `deleted_${userId}_${user.googleId}`;
                updated = true;
            }

            if (updated) {
                user.fcmToken = ''; // also clear FCM token for security
                await user.save();
                migratedCount++;
                console.log(chalk.green(`  Migrated user ID: ${userId}`));
            }
        }

        console.log(chalk.bold.green(`\nMigration completed. Successfully updated ${migratedCount} user(s).`));
        process.exit(0);
    } catch (error) {
        console.error(chalk.red('\nError during migration:'), error);
        process.exit(1);
    } finally {
        await mongoose.connection.close();
        console.log(chalk.blue('MongoDB connection closed.'));
    }
})();

// scripts/migrateOldNotifications.script.js
import mongoose from 'mongoose';
import chalk from 'chalk';
import { dbConnection } from '#configs/db';
import Notification from '#models/notification';

(async () => {
    try {
        console.log(chalk.yellow('Connecting to database...'));
        await dbConnection();
        console.log(chalk.green('Database connected successfully.'));

        // Fetch all notifications bypassing schema casting temporarily using lean
        const notifications = await Notification.find({}).lean();
        console.log(chalk.blue(`Found ${notifications.length} notifications to check.`));

        let updateCount = 0;

        for (const doc of notifications) {
            const rawRecipient = doc.recipient;
            let needsUpdate = false;
            let updatedRecipient = [];

            // Case A: recipient is null, undefined, or missing -> set to empty array []
            if (rawRecipient === null || rawRecipient === undefined) {
                updatedRecipient = [];
                needsUpdate = true;
            }
            // Case B: recipient is a single ObjectId (not an array) -> wrap in array [ObjectId]
            else if (!Array.isArray(rawRecipient)) {
                updatedRecipient = [rawRecipient];
                needsUpdate = true;
            }

            if (needsUpdate) {
                await Notification.updateOne(
                    { _id: doc._id },
                    { $set: { recipient: updatedRecipient } }
                );
                updateCount++;
            }
        }

        console.log(chalk.green(`\n✅ Migration completed! Updated ${updateCount} old notifications to the new array schema.`));
    } catch (error) {
        console.error(chalk.red('❌ Migration failed:'), error);
    } finally {
        await mongoose.connection.close();
        console.log(chalk.blue('Database connection closed.'));
        process.exit(0);
    }
})();

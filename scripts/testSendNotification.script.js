// scripts/testSendNotification.script.js
import mongoose from 'mongoose';
import chalk from 'chalk';
import { dbConnection } from '#configs/db';
import User from '#models/user';
import Notification from '#models/notification';
import { sendPushNotification } from '#utils/firebase';
import { NOTIFICATION_ICON_URL } from '#constants/notification';

const printUsageAndExit = () => {
    console.log(chalk.red('\n❌ ERROR: Invalid or missing arguments.'));
    console.log(chalk.cyan('\n👉 Usage:'));
    console.log('  node --env-file=.env scripts/testSendNotification.script.js <category> <recipient>');
    console.log(chalk.cyan('\n👉 Parameters:'));
    console.log('  <category>  : "general" or "promotional" (case-insensitive)');
    console.log('  <recipient> : A valid MongoDB User ID or "all" (to broadcast to all users)');
    console.log(chalk.cyan('\n👉 Examples:'));
    console.log('  1. Send a General notification to a specific user:');
    console.log('     node --env-file=.env scripts/testSendNotification.script.js general 60d5ec49b2f7e32400f5c123');
    console.log('  2. Send a Promotional notification to all users:');
    console.log('     node --env-file=.env scripts/testSendNotification.script.js promotional all\n');
    process.exit(1);
};

(async () => {
    const args = process.argv.slice(2);
    if (args.length < 2) {
        printUsageAndExit();
    }

    const categoryInput = args[0].toUpperCase();
    const recipientInput = args[1];

    if (categoryInput !== 'GENERAL' && categoryInput !== 'PROMOTIONAL') {
        console.error(chalk.red(`\n❌ ERROR: Invalid category "${args[0]}". Must be "general" or "promotional".`));
        printUsageAndExit();
    }

    // Define notification details based on category
    let title = '';
    let body = '';

    if (categoryInput === 'GENERAL') {
        title = 'System Maintenance Notice';
        body =
            'Hello! Our servers will undergo a brief maintenance on Sunday at 2 AM IST. App features will be briefly offline.';
    } else {
        title = 'Diwali Dhamaka 2026! 🪔';
        body =
            'Celebrate Diwali with PrintCampus! Get flat 25% off on all document printing and spiral bindings. Use code: DIWALI25.';
    }

    try {
        console.log(chalk.yellow('Connecting to database...'));
        await dbConnection();
        console.log(chalk.green('Database connected successfully.'));

        const metadata = {
            category: categoryInput,
            type: categoryInput, // mapped to maintain consistency with existing order push notification structure
            imageUrl: NOTIFICATION_ICON_URL,
        };

        if (recipientInput.toLowerCase() === 'all') {
            console.log(chalk.yellow(`Preparing broadcast push for category: ${categoryInput}...`));

            // Find all active users with FCM tokens
            const users = await User.find({
                isDeleted: false,
                isActive: true,
                fcmToken: { $ne: null, $ne: '' },
            })
                .select('fcmToken')
                .lean();

            if (users.length === 0) {
                console.log(chalk.red('❌ No users found with a valid fcmToken.'));
                process.exit(0);
            }

            const tokens = users.map((u) => u.fcmToken);
            console.log(chalk.yellow(`Sending multicast push notification to ${tokens.length} users...`));

            // Create notification records in DB (broadcast uses recipient: [])
            const notification = await Notification.create({
                title,
                body,
                type: 'PUSH',
                category: categoryInput,
                recipient: [],
                imageUrl: NOTIFICATION_ICON_URL,
                sentBy: null, // system generated or admin
            });

            metadata.notificationId = notification._id.toString();

            const result = await sendPushNotification(tokens, title, body, metadata);
            console.log(chalk.green(`\n✅ Broadcast completed!`));
            console.log(chalk.blue(`   Successful dispatches: ${result.successCount}`));
            console.log(chalk.red(`   Failed dispatches: ${result.failureCount}`));
        } else {
            // Single recipient validation
            if (!mongoose.Types.ObjectId.isValid(recipientInput)) {
                console.error(chalk.red(`\n❌ ERROR: "${recipientInput}" is not a valid MongoDB ObjectId.`));
                printUsageAndExit();
            }

            console.log(chalk.yellow(`Fetching user details for recipient: ${recipientInput}...`));
            const user = await User.findOne({ _id: recipientInput, isDeleted: false }).select('fcmToken fullName');

            if (!user) {
                console.error(chalk.red(`❌ ERROR: User with ID ${recipientInput} not found or is deleted.`));
                process.exit(1);
            }

            if (!user.fcmToken) {
                console.error(chalk.red(`❌ ERROR: User "${user.fullName}" does not have a registered FCM token.`));
                process.exit(1);
            }

            console.log(chalk.yellow(`Sending notification to user: "${user.fullName}"...`));

            const notification = await Notification.create({
                title,
                body,
                type: 'PUSH',
                category: categoryInput,
                recipient: [user._id],
                imageUrl: NOTIFICATION_ICON_URL,
                sentBy: null,
            });

            metadata.notificationId = notification._id.toString();

            const result = await sendPushNotification(user.fcmToken, title, body, metadata);
            if (result.successCount > 0) {
                console.log(chalk.green(`\n✅ Push notification successfully sent to ${user.fullName}!`));
            } else {
                console.log(chalk.red(`\n❌ Push notification failed to send to ${user.fullName}.`));
            }
        }
    } catch (error) {
        console.error(chalk.red('❌ Script execution failed:'), error);
    } finally {
        await mongoose.connection.close();
        console.log(chalk.blue('Database connection closed.'));
        process.exit(0);
    }
})();

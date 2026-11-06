// scripts/testNewUserNotificationsVisibility.script.js
import mongoose from 'mongoose';
import chalk from 'chalk';
import { dbConnection } from '#configs/db';
import User from '#models/user';
import Notification from '#models/notification';
import { getUserNotifications } from '#controllers/notification';

const makeMockResponse = () => {
    const res = {};
    res.status = (code) => {
        res.statusCode = code;
        return res;
    };
    res.json = (data) => {
        res.body = data;
        return res;
    };
    return res;
};

(async () => {
    try {
        console.log(chalk.yellow('Connecting to database...'));
        await dbConnection();
        console.log(chalk.green('Database connected successfully.'));

        // Clean up any test users/notifications
        console.log(chalk.blue('Cleaning up previous test records...'));
        await User.deleteMany({ email: /test-visibility/ });
        await Notification.deleteMany({ title: /Test Visibility/ });

        // 1. Create two test users (simulating active users)
        console.log(chalk.blue('Creating User A and User B...'));
        const userA = await User.create({
            firstName: 'Test',
            lastName: 'UserA',
            fullName: 'Test UserA',
            phone: '1111111111',
            email: 'test-visibility-a@example.com',
            isActive: true,
            isDeleted: false,
        });

        const userB = await User.create({
            firstName: 'Test',
            lastName: 'UserB',
            fullName: 'Test UserB',
            phone: '2222222222',
            email: 'test-visibility-b@example.com',
            isActive: true,
            isDeleted: false,
        });

        // 2. Create notifications
        console.log(chalk.blue('Creating notifications...'));
        
        // Notification 1: Targeted ONLY to User A
        const notifTargetedA = await Notification.create({
            title: 'Test Visibility: Targeted A',
            body: 'Visible only to User A',
            type: 'IN_APP',
            category: 'GENERAL',
            recipient: [userA._id],
        });

        // Notification 2: Broadcast (All Users) created BEFORE User C exists
        const notifBroadcastOld = await Notification.create({
            title: 'Test Visibility: Old Broadcast',
            body: 'Broadcast sent before User C creation',
            type: 'IN_APP',
            category: 'GENERAL',
            recipient: [],
            createdAt: new Date(Date.now() - 3600000), // 1 hour ago
        });

        // 3. Test if User B (active user) sees User A's targeted notification
        console.log(chalk.yellow('\nChecking if User B sees User A\'s targeted notification...'));
        let req = {
            query: { page: 1, limit: 10 },
            user: { id: userB._id.toString() }
        };
        let res = makeMockResponse();
        await getUserNotifications(req, res);

        const userBNotifications = res.body.data;
        const seesTargetedA = userBNotifications.some(n => n._id.toString() === notifTargetedA._id.toString());
        console.log(`User B fetched ${userBNotifications.length} notifications.`);
        if (seesTargetedA) {
            console.log(chalk.red('❌ BUG: User B sees a notification targeted only to User A!'));
        } else {
            console.log(chalk.green('✓ CORRECT: User B does NOT see User A\'s targeted notification.'));
        }

        // 4. Create a new user C (registered JUST NOW)
        console.log(chalk.blue('\nCreating new User C (just now)...'));
        const userC = await User.create({
            firstName: 'Test',
            lastName: 'UserC',
            fullName: 'Test UserC',
            phone: '3333333333',
            email: 'test-visibility-c@example.com',
            isActive: true,
            isDeleted: false,
        });

        // 5. Test if newly created User C sees the old broadcast notification
        console.log(chalk.yellow('\nChecking if new User C sees old broadcast notification sent before registration...'));
        req = {
            query: { page: 1, limit: 10 },
            user: { id: userC._id.toString() }
        };
        res = makeMockResponse();
        await getUserNotifications(req, res);

        const userCNotifications = res.body.data;
        const seesOldBroadcast = userCNotifications.some(n => n._id.toString() === notifBroadcastOld._id.toString());
        console.log(`User C fetched ${userCNotifications.length} notifications.`);
        if (seesOldBroadcast) {
            console.log(chalk.red('⚠️ NOTICE: New User C sees the old broadcast notification created before their registration.'));
        } else {
            console.log(chalk.green('✓ CORRECT: New User C does NOT see old broadcast notifications.'));
        }

        // Clean up
        console.log(chalk.blue('\nCleaning up test records...'));
        await User.deleteMany({ email: /test-visibility/ });
        await Notification.deleteMany({ title: /Test Visibility/ });

    } catch (error) {
        console.error(chalk.red('❌ Script failed:'), error);
    } finally {
        await mongoose.connection.close();
        console.log(chalk.blue('Database connection closed.'));
    }
})();

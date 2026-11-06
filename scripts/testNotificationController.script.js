// scripts/testNotificationController.script.js
import mongoose from 'mongoose';
import chalk from 'chalk';
import { dbConnection } from '#configs/db';
import { adminSendNotification, adminGetNotifications } from '#controllers/notification';
import User from '#models/user';
import Admin from '#models/admin';
import Notification from '#models/notification';

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

const assert = (condition, message) => {
    if (!condition) {
        throw new Error(`Assertion Failed: ${message}`);
    }
    console.log(chalk.green(`[PASS] ${message}`));
};

(async () => {
    try {
        console.log(chalk.yellow('Connecting to database...'));
        await dbConnection();
        console.log(chalk.green('Database connected successfully.'));

        // Clean up test notifications
        await Notification.deleteMany({ title: /Test Notification/ });
        console.log(chalk.blue('Cleaned up previous test notifications.'));

        // Fetch two active users
        const users = await User.find({ isDeleted: false, isActive: true }).limit(2).lean();
        if (users.length < 2) {
            console.log(chalk.red('❌ Test requires at least 2 active users in the DB. Please create them first.'));
            process.exit(1);
        }

        const user1Id = users[0]._id.toString();
        const user2Id = users[1]._id.toString();
        console.log(chalk.blue(`Using User 1: "${users[0].fullName}" (${user1Id})`));
        console.log(chalk.blue(`Using User 2: "${users[1].fullName}" (${user2Id})`));

        const mockAdminId = new mongoose.Types.ObjectId().toString();

        // 1. Test validation failure (missing title/body)
        console.log(chalk.yellow('\n--- Test 1: Validation Failure ---'));
        let req = {
            body: {
                type: 'IN_APP',
                category: 'GENERAL'
            },
            user: { id: mockAdminId }
        };
        let res = makeMockResponse();
        await adminSendNotification(req, res);
        assert(res.statusCode === 400, `Expected status 400, got ${res.statusCode}`);
        assert(res.body.status === false, 'Response status should be false');

        // 2. Test user not found (invalid recipient ID)
        console.log(chalk.yellow('\n--- Test 2: User Not Found (recipientId) ---'));
        const fakeUserId = new mongoose.Types.ObjectId().toString();
        req = {
            body: {
                title: 'Test Notification: Fake User',
                body: 'This is a test notification body',
                type: 'IN_APP',
                category: 'GENERAL',
                recipientId: fakeUserId
            },
            user: { id: mockAdminId }
        };
        res = makeMockResponse();
        await adminSendNotification(req, res);
        assert(res.statusCode === 404, `Expected status 404, got ${res.statusCode}`);
        assert(res.body.message.includes('One or more recipient users'), 'Expected user not found error message');

        // 3. Test targeted notification (single recipientId)
        console.log(chalk.yellow('\n--- Test 3: Targeted Single Recipient ---'));
        req = {
            body: {
                title: 'Test Notification: Single User',
                body: 'This is a test notification body',
                type: 'IN_APP',
                category: 'GENERAL',
                recipientId: user1Id
            },
            user: { id: mockAdminId }
        };
        res = makeMockResponse();
        await adminSendNotification(req, res);
        assert(res.statusCode === 201, `Expected status 201, got ${res.statusCode}`);
        assert(res.body.status === true, 'Response status should be true');
        assert(Array.isArray(res.body.data.recipient), 'Expected recipient field to be an array');
        assert(res.body.data.recipient[0]._id.toString() === user1Id, 'Recipient ID should match user1Id');

        // 4. Test targeted notification (multiple recipientIds)
        console.log(chalk.yellow('\n--- Test 4: Targeted Multiple Recipients ---'));
        req = {
            body: {
                title: 'Test Notification: Multiple Users',
                body: 'This is a test notification body',
                type: 'IN_APP',
                category: 'GENERAL',
                recipientIds: [user1Id, user2Id]
            },
            user: { id: mockAdminId }
        };
        res = makeMockResponse();
        await adminSendNotification(req, res);
        assert(res.statusCode === 201, `Expected status 201, got ${res.statusCode}`);
        assert(typeof res.body.data === 'object' && !Array.isArray(res.body.data), 'Expected single object in response data for multi-recipient');
        assert(Array.isArray(res.body.data.recipient), 'Expected recipient field to be an array');
        assert(res.body.data.recipient.length === 2, `Expected 2 recipient objects, got ${res.body.data.recipient.length}`);
        
        // Verify created DB records
        const records = await Notification.find({ recipient: { $all: [user1Id, user2Id] }, title: 'Test Notification: Multiple Users' });
        assert(records.length === 1, `Expected 1 record in database, found ${records.length}`);
        assert(records[0].recipient.length === 2, 'Expected recipient array of size 2');

        // 5. Test broadcast (no recipientId/recipientIds)
        console.log(chalk.yellow('\n--- Test 5: Broadcast to All ---'));
        req = {
            body: {
                title: 'Test Notification: Broadcast',
                body: 'This is a test notification body',
                type: 'IN_APP',
                category: 'GENERAL'
            },
            user: { id: mockAdminId }
        };
        res = makeMockResponse();
        await adminSendNotification(req, res);
        assert(res.statusCode === 201, `Expected status 201, got ${res.statusCode}`);
        assert(Array.isArray(res.body.data.recipient) && res.body.data.recipient.length === 0, 'Recipient should be an empty array for broadcast');

        const broadcastRecord = await Notification.findOne({ title: 'Test Notification: Broadcast' });
        assert(broadcastRecord !== null, 'Broadcast record should exist in the database');
        assert(Array.isArray(broadcastRecord.recipient) && broadcastRecord.recipient.length === 0, 'Recipient array in broadcast record must be empty');

        // 6. Test Listing Filters (Exclude system-generated notifications)
        console.log(chalk.yellow('\n--- Test 6: Get Admin Notifications List (Exclude system-generated) ---'));
        
        // Clear all previous notifications to have a clean slate for this test
        await Notification.deleteMany({});

        // Create an admin-sent notification
        await Notification.create({
            title: 'Test Notification: Admin Sent',
            body: 'Body',
            type: 'IN_APP',
            category: 'GENERAL',
            recipient: [],
            sentBy: mockAdminId
        });

        // Create a system-generated notification (sentBy: null)
        await Notification.create({
            title: 'Test Notification: System Sent',
            body: 'Body',
            type: 'IN_APP',
            category: 'ORDER_NOTIFICATION',
            recipient: [new mongoose.Types.ObjectId()],
            sentBy: null
        });

        req = {
            query: {
                page: 1,
                limit: 10
            }
        };
        res = makeMockResponse();
        await adminGetNotifications(req, res);
        
        assert(res.statusCode === 200, `Expected status 200, got ${res.statusCode}`);
        assert(res.body.status === true, 'Response status should be true');
        assert(res.body.count === 1, `Expected count to be 1 (system notification excluded), got ${res.body.count}`);
        assert(res.body.data[0].title === 'Test Notification: Admin Sent', `Expected returned title to be "Test Notification: Admin Sent", got "${res.body.data[0].title}"`);

        console.log(chalk.bold.green('\n🎉 ALL CONTROLLER INTEGRATION TESTS PASSED SUCCESSFULLY!'));
    } catch (error) {
        console.error(chalk.red('\n❌ TEST SUITE FAILED:'), error);
        process.exit(1);
    } finally {
        await mongoose.connection.close();
        console.log(chalk.blue('Database connection closed.'));
        process.exit(0);
    }
})();

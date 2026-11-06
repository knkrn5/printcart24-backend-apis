// scripts/testGoogleLoginFlow.script.js
import mongoose from 'mongoose';
import chalk from 'chalk';
import env from '#configs/env';
import User from '#models/user';
import { dbConnection } from '#configs/db';
import { adminListUsers, adminGetUserById } from '../controllers/users.controller.js';

(async () => {
    try {
        console.log(chalk.blue('Connecting to Database...'));
        await dbConnection();

        const testEmail = 'test_google_no_phone@example.com';
        const testUid = 'test-google-uid-123456';

        // 1. Clean up existing test user if any
        await User.deleteOne({ email: testEmail });
        console.log(chalk.yellow(`Cleaned up previous test user with email ${testEmail}`));

        // 2. Simulate User Registration without phone number (like googleLogin controller)
        console.log(chalk.blue('Simulating user signup without phone number...'));
        const userData = {
            firstName: 'Test',
            lastName: 'Google User',
            email: testEmail,
            googleId: testUid,
            profilePicture: 'https://example.com/photo.jpg',
            authProvider: 'GOOGLE',
            isEmailVerified: true,
        };

        const user = await User.create(userData);
        console.log(chalk.green(`User created successfully with ID: ${user._id}`));

        // Helper to construct a mock Express response object
        const createMockResponse = () => {
            const res = {
                statusCode: 200,
                jsonPayload: null,
                status(code) {
                    this.statusCode = code;
                    return this;
                },
                send(body) {
                    this.jsonPayload = body;
                    return this;
                },
                json(body) {
                    this.jsonPayload = body;
                    return this;
                }
            };
            return res;
        };

        // 3. Test adminListUsers controller on the new user
        console.log(chalk.blue('\nInvoking adminListUsers controller...'));
        const reqGetUsers = {
            query: {
                search: 'test_google_no_phone',
                page: '1',
                limit: '10'
            }
        };
        const resGetUsers = createMockResponse();

        await adminListUsers(reqGetUsers, resGetUsers);

        const returnedUsers = resGetUsers.jsonPayload?.data?.users || [];
        const matchedUser = returnedUsers.find(u => u._id.toString() === user._id.toString());
        
        console.log('adminListUsers Response Status:', resGetUsers.statusCode);
        if (matchedUser) {
            console.log(chalk.green('Matched user found in users list!'));
            console.log('Returned fullPhone:', JSON.stringify(matchedUser.fullPhone));
            if (matchedUser.fullPhone === '') {
                console.log(chalk.bgGreen.black(' PASS: fullPhone is empty string! '));
            } else {
                console.log(chalk.bgRed.white(` FAIL: fullPhone is ${JSON.stringify(matchedUser.fullPhone)} `));
            }
        } else {
            console.log(chalk.red('FAIL: Test user not found in the returned users list. Full response payload:'), resGetUsers.jsonPayload);
        }

        // 4. Test adminGetUserById controller on the new user
        console.log(chalk.blue('\nInvoking adminGetUserById controller...'));
        const reqGetUserById = {
            params: {
                userId: user._id.toString()
            }
        };
        const resGetUserById = createMockResponse();

        await adminGetUserById(reqGetUserById, resGetUserById);

        console.log('adminGetUserById Response Status:', resGetUserById.statusCode);
        const singleUserData = resGetUserById.jsonPayload?.data?.user;
        if (singleUserData) {
            console.log('Returned fullPhone for single user:', JSON.stringify(singleUserData.fullPhone));
            if (singleUserData.fullPhone === '') {
                console.log(chalk.bgGreen.black(' PASS: fullPhone is empty string! '));
            } else {
                console.log(chalk.bgRed.white(` FAIL: fullPhone is ${JSON.stringify(singleUserData.fullPhone)} `));
            }
        } else {
            console.log(chalk.red('FAIL: Response data is empty or user not found. Payload:'), resGetUserById.jsonPayload);
        }

        // Clean up
        await User.deleteOne({ _id: user._id });
        console.log(chalk.yellow(`\nCleaned up test user ${testEmail}`));

    } catch (error) {
        console.error(chalk.red('Error running Google Login test flow:'), error);
    } finally {
        await mongoose.connection.close();
        console.log(chalk.blue('Database connection closed.'));
    }
})();

// scripts/testAccountDeletionRecreation.script.js
import mongoose from 'mongoose';
import chalk from 'chalk';

// Set OTP verification bypass before dynamically importing configurations and controllers
process.env.DISABLE_OTP_VERIFICATION = 'true';

// Dynamic imports to allow runtime configuration setup
const { dbConnection } = await import('#configs/db');
const User = (await import('#models/user')).default;
const { deleteAccount, verifyOtp, googleLogin } = await import('#controllers/auth');
const { adminSoftDeleteUser } = await import('#controllers/users');

// Mock response factory to intercept controller outputs
const mockResponse = () => {
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

// Test asserts
let passed = 0;
let failed = 0;

function assert(label, condition, details = null) {
    if (condition) {
        console.log(chalk.green(`  ✅ PASS: ${label}`));
        passed++;
    } else {
        console.log(chalk.red(`  ❌ FAIL: ${label}`));
        if (details) {
            console.log(chalk.gray(`     Details: ${JSON.stringify(details, null, 2)}`));
        }
        failed++;
    }
}

function printSection(title) {
    console.log(chalk.bold.blue(`\n=== ${title} ===`));
}

(async () => {
    try {
        console.log(chalk.bold.yellow('Starting Account Deletion & Recreation Test Suite...'));

        // 1. Connect to Database
        await dbConnection();
        console.log(chalk.green('Database connected.'));

        // 2. Clean up any previous test remnants
        console.log('Cleaning up test data...');
        await User.deleteMany({
            $or: [
                { phone: '8888888888' },
                { phone: /^deleted_.*_8888888888$/ },
                { email: 'testdelete@example.com' },
                { email: /^deleted_.*_testdelete@example.com$/ }
            ]
        });

        /* =========================================================================
           SCENARIO 1: OTP Signup -> Self Deletion -> OTP Recreation
           ========================================================================= */
        printSection('SCENARIO 1: OTP Self-Deletion & Recreation Flow');

        // Step 1.1: Register a new user via verifyOtp
        console.log('Registering user via verifyOtp...');
        const req1 = {
            body: {
                countryCode: '+91',
                phone: '8888888888',
                otp: '123456'
            }
        };
        const res1 = mockResponse();
        await verifyOtp(req1, res1);

        assert('Registration request succeeded with HTTP 200', res1.statusCode === 200, res1.body);
        
        let user1 = await User.findOne({ phone: '8888888888' });
        assert('User exists in database', !!user1);
        assert('User profile is initially incomplete', user1.isProfileComplete === false);

        // Onboard the user by filling details
        console.log('Completing user profile details...');
        user1.firstName = 'Test';
        user1.lastName = 'User';
        user1.isProfileComplete = true;
        await user1.save();

        // Step 1.2: Delete the user account
        console.log('Deleting user account...');
        const req2 = { user: { id: user1._id } };
        const res2 = mockResponse();
        await deleteAccount(req2, res2);

        assert('Account deletion request succeeded with HTTP 200', res2.statusCode === 200, res2.body);

        // Verify soft-deleted state and credential anonymization in DB
        let deletedUser1 = await User.findById(user1._id);
        assert('User record is retained in DB', !!deletedUser1);
        assert('User isActive is false', deletedUser1.isActive === false);
        assert('User isDeleted is true', deletedUser1.isDeleted === true);
        assert('Phone number is anonymized with prefix', deletedUser1.phone.startsWith(`deleted_${user1._id}_`));

        // Step 1.3: Re-register with the same phone number
        console.log('Re-registering with the same phone number...');
        const req3 = {
            body: {
                countryCode: '+91',
                phone: '8888888888',
                otp: '123456'
            }
        };
        const res3 = mockResponse();
        await verifyOtp(req3, res3);

        assert('Re-registration request succeeded with HTTP 200', res3.statusCode === 200, res3.body);

        let user2 = await User.findOne({ phone: '8888888888' });
        assert('A new user record is created', !!user2);
        assert('New user has a different _id from deleted user', user2._id.toString() !== user1._id.toString());
        assert('New user profile is incomplete (must onboarding again)', user2.isProfileComplete === false);
        assert('New user has empty first name', !user2.firstName);

        // Clean up scenario 1 users to reuse phone
        await User.deleteMany({
            $or: [
                { phone: '8888888888' },
                { phone: /^deleted_.*_8888888888$/ }
            ]
        });

        /* =========================================================================
           SCENARIO 2: OTP Signup -> Admin Deletion -> OTP Recreation
           ========================================================================= */
        printSection('SCENARIO 2: Admin-Initiated Deletion & Recreation Flow');

        // Step 2.1: Register a new user via verifyOtp
        console.log('Registering user via verifyOtp...');
        const req4 = {
            body: {
                countryCode: '+91',
                phone: '8888888888',
                otp: '123456'
            }
        };
        const res4 = mockResponse();
        await verifyOtp(req4, res4);
        assert('Registration request succeeded', res4.statusCode === 200, res4.body);

        let user3 = await User.findOne({ phone: '8888888888' });
        user3.firstName = 'AdminDeleted';
        user3.lastName = 'User';
        user3.isProfileComplete = true;
        await user3.save();

        // Step 2.2: Admin soft-deletes the user
        console.log('Admin soft-deleting user...');
        const req5 = {
            params: { userId: user3._id.toString() }
        };
        const res5 = mockResponse();
        await adminSoftDeleteUser(req5, res5);
        assert('Admin deletion request succeeded with HTTP 200', res5.statusCode === 200, res5.body);

        // Verify credentials in DB
        let deletedUser3 = await User.findById(user3._id);
        assert('User isActive is false', deletedUser3.isActive === false);
        assert('User isDeleted is true', deletedUser3.isDeleted === true);
        assert('Phone number is anonymized by admin deletion', deletedUser3.phone.startsWith(`deleted_${user3._id}_`));

        // Step 2.3: Re-register with the same phone number
        console.log('Re-registering after admin deletion...');
        const req6 = {
            body: {
                countryCode: '+91',
                phone: '8888888888',
                otp: '123456'
            }
        };
        const res6 = mockResponse();
        await verifyOtp(req6, res6);
        assert('Re-registration request succeeded', res6.statusCode === 200, res6.body);

        let user4 = await User.findOne({ phone: '8888888888' });
        assert('A new user record is created after admin delete', !!user4);
        assert('New user has different _id from admin deleted user', user4._id.toString() !== user3._id.toString());
        assert('New user profile is incomplete', user4.isProfileComplete === false);

        // Clean up scenario 2 users to reuse phone
        await User.deleteMany({
            $or: [
                { phone: '8888888888' },
                { phone: /^deleted_.*_8888888888$/ }
            ]
        });


        /* =========================================================================
           SCENARIO 3: Google Login -> Self Deletion -> Google Recreation
           ========================================================================= */
        printSection('SCENARIO 3: Google Login Deletion & Recreation Flow');

        // Step 3.1: Sign up / Log in user via googleLogin
        console.log('Logging in via googleLogin...');
        const reqG1 = {
            body: {
                uid: 'test_google_delete',
                displayName: 'Google User',
                email: 'testdelete@example.com',
                phoneNumber: '+918888888888'
            }
        };
        const resG1 = mockResponse();
        await googleLogin(reqG1, resG1);
        assert('Google registration request succeeded with HTTP 200', resG1.statusCode === 200, resG1.body);

        let googleUser1 = await User.findOne({ email: 'testdelete@example.com' });
        assert('Google user exists in DB', !!googleUser1);
        assert('Google UID matches', googleUser1.googleId === 'test_google_delete');

        // Step 3.2: Delete Google user account
        console.log('Deleting Google account...');
        const reqG2 = { user: { id: googleUser1._id } };
        const resG2 = mockResponse();
        await deleteAccount(reqG2, resG2);
        assert('Google account deletion succeeded', resG2.statusCode === 200, resG2.body);

        // Verify credentials in DB
        let deletedGoogleUser1 = await User.findById(googleUser1._id);
        assert('Google user isDeleted is true', deletedGoogleUser1.isDeleted === true);
        assert('Google email is anonymized', deletedGoogleUser1.email.startsWith(`deleted_${googleUser1._id}_`));
        assert('Google UID is anonymized', deletedGoogleUser1.googleId.startsWith(`deleted_${googleUser1._id}_`));

        // Step 3.3: Log in again using the same Google account details
        console.log('Logging in again via googleLogin (with same email/uid)...');
        const reqG3 = {
            body: {
                uid: 'test_google_delete',
                displayName: 'Google User',
                email: 'testdelete@example.com',
                phoneNumber: '+918888888888'
            }
        };
        const resG3 = mockResponse();
        await googleLogin(reqG3, resG3);
        assert('Google re-login succeeded with HTTP 200', resG3.statusCode === 200, resG3.body);

        let googleUser2 = await User.findOne({ email: 'testdelete@example.com' });
        assert('A new Google user record is created', !!googleUser2);
        assert('New Google user has different _id', googleUser2._id.toString() !== googleUser1._id.toString());
        assert('New Google user has googleId restored', googleUser2.googleId === 'test_google_delete');


        // final clean up
        console.log('\nCleaning up all test remnants...');
        await User.deleteMany({
            $or: [
                { phone: '8888888888' },
                { phone: /^deleted_.*_8888888888$/ },
                { email: 'testdelete@example.com' },
                { email: /^deleted_.*_testdelete@example.com$/ }
            ]
        });

        printSection('TEST RUN SUMMARY');
        console.log(chalk.bold.green(`  Passed: ${passed}`));
        console.log(chalk.bold.red(`  Failed: ${failed}`));

        process.exit(failed > 0 ? 1 : 0);
    } catch (error) {
        console.error(chalk.red('\nUnexpected error during test execution:'), error);
        process.exit(1);
    } finally {
        await mongoose.connection.close();
        console.log(chalk.blue('MongoDB connection closed.'));
    }
})();

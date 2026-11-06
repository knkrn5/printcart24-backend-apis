// scratch/test-otp.js
import { dbConnection } from '#configs/db';
import env from '#configs/env';
import { verifyOtp } from '#controllers/auth';
import Otp from '#models/otp';
import mongoose from 'mongoose';
import { hashOtp } from '#utils/generalHelper';

const makeMockRes = () => {
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

const runTests = async () => {
    console.log('Connecting to database...');
    await dbConnection();
    console.log('Connected to database.');

    const phone = '9876543210';
    const countryCode = '+91';
    const fullPhone = `${countryCode}${phone}`;

    // Clean up any existing OTP and User for test phone number
    await Otp.deleteMany({ phone: fullPhone });

    console.log(`\n--- RUNNING SCENARIO: DISABLE_OTP_VERIFICATION = ${env.DISABLE_OTP_VERIFICATION} ---`);

    if (env.DISABLE_OTP_VERIFICATION) {
        // Bypass Mode Verification
        // 1.1 Test with NO OTP
        {
            const req = {
                body: {
                    phone,
                    countryCode,
                }
            };
            const res = makeMockRes();
            await verifyOtp(req, res);
            console.log(`Test 1.1 (No OTP field): Status = ${res.statusCode}, Response = ${JSON.stringify(res.body)}`);
        }

        // 1.2 Test with invalid 6-digit OTP
        {
            const req = {
                body: {
                    phone,
                    countryCode,
                    otp: '999999'
                }
            };
            const res = makeMockRes();
            await verifyOtp(req, res);
            console.log(`Test 1.2 (Invalid OTP field): Status = ${res.statusCode}, Response = ${JSON.stringify(res.body)}`);
        }
    } else {
        // Strict Mode Verification
        // 2.1 Test with NO OTP
        {
            const req = {
                body: {
                    phone,
                    countryCode,
                }
            };
            const res = makeMockRes();
            await verifyOtp(req, res);
            console.log(`Test 2.1 (No OTP field): Status = ${res.statusCode}, Response = ${JSON.stringify(res.body)}`);
        }

        // 2.2 Test with invalid 6-digit OTP
        {
            const req = {
                body: {
                    phone,
                    countryCode,
                    otp: '999999'
                }
            };
            const res = makeMockRes();
            await verifyOtp(req, res);
            console.log(`Test 2.2 (Invalid OTP field): Status = ${res.statusCode}, Response = ${JSON.stringify(res.body)}`);
        }

        // 2.3 Test with Bypass Code (123456)
        {
            const req = {
                body: {
                    phone,
                    countryCode,
                    otp: '123456'
                }
            };
            const res = makeMockRes();
            await verifyOtp(req, res);
            console.log(`Test 2.3 (Bypass OTP 123456): Status = ${res.statusCode}, Response = ${JSON.stringify(res.body)}`);
        }

        // 2.4 Test with Actual Valid OTP from DB
        {
            const actualOtp = '654321';
            const otpHash = hashOtp(actualOtp);
            await Otp.create({
                phone: fullPhone,
                otpHash,
                expiresAt: new Date(Date.now() + 5 * 60 * 1000)
            });

            const req = {
                body: {
                    phone,
                    countryCode,
                    otp: actualOtp
                }
            };
            const res = makeMockRes();
            await verifyOtp(req, res);
            console.log(`Test 2.4 (Actual Valid OTP): Status = ${res.statusCode}, Response = ${JSON.stringify(res.body)}`);
        }
    }

    console.log('\nClosing database connection...');
    await mongoose.connection.close();
    console.log('Database connection closed.');
};

runTests().catch(err => {
    console.error('Test run failed:', err);
    mongoose.connection.close();
});

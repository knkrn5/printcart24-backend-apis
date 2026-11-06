// services/otp.service.js
import env from '#configs/env';
import Otp from '#models/otp';
import { generateOTP, hashOtp } from '#utils/generalHelper';
import { sendOTP } from '#services/sms';
import chalk from 'chalk';

export const OTP_EXPIRY_MINUTES = 5;
const RESEND_COOLDOWN_SECONDS = 30;

/**
 * Send OTP to the user
 * @param {string} phone - Phone number of the user
 * @returns {Promise<boolean>} - True if OTP was sent successfully
 */
export const sendOtpService = async (phone) => {
    // 1. Check recent OTP (rate limit only for active OTP)
    const recentOtp = await Otp.findOne({ phone }).sort({ createdAt: -1 });

    if (recentOtp && recentOtp.expiresAt > new Date()) {
        const diff = (Date.now() - new Date(recentOtp.createdAt).getTime()) / 1000;

        if (diff < RESEND_COOLDOWN_SECONDS) {
            const error = new Error(
                `Please wait ${Math.ceil(RESEND_COOLDOWN_SECONDS - diff)} seconds before requesting another OTP`,
            );
            error.status = 403;
            throw error;
        }
    }

    // 2. Generate OTP
    const otp = generateOTP(6);
    const otpHash = hashOtp(otp);

    // 3. Ensure only one OTP exists per phone
    await Otp.deleteMany({ phone });

    // 4. Save OTP
    await Otp.create({
        phone,
        otpHash,
        expiresAt: new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000),
    });

    // 5. Log only in non-production
    if (env.NODE_ENV !== 'production') {
        console.log(chalk.white(`✅ OTP for ${phone}: [${otp}]`));
    }

    // 6. Deliver OTP via SMS provider
    await sendOTP(phone, otp, { expiryMinutes: OTP_EXPIRY_MINUTES });

    return true;
};

/**
 * Verify OTP sent to the user
 * @param {string} phone
 * @param {string} otp
 * @returns {Promise<boolean>}
 */
export const verifyOtpService = async (phone, otp) => {
    // 0. Defensive validation
    if (!phone || !otp) {
        throw new Error('Phone and OTP are required');
    }

    // 🔓 DEV BYPASS (strictly controlled)
    const isBypassAllowed = env.OTP_BYPASS_ENABLED === 'true' && env.NODE_ENV !== 'production';

    if (isBypassAllowed && otp === String(env.OTP_BYPASS_CODE)) {
        await Otp.deleteMany({ phone }); // cleanup to prevent reuse confusion
        console.log(`⚠️  OTP bypass used for ${phone}`);
        return true;
    }

    // 1. Fetch latest OTP
    const existingOtp = await Otp.findOne({ phone }).sort({ createdAt: -1 });

    // 2. Validate existence + expiry together (no info leakage)
    if (!existingOtp || existingOtp.expiresAt < new Date()) {
        throw new Error('Invalid or expired OTP');
    }

    // 3. Hash comparison
    const incomingHash = hashOtp(otp);

    if (incomingHash !== existingOtp.otpHash) {
        throw new Error('Invalid OTP');
    }

    // 4. Cleanup (prevent reuse)
    await Otp.deleteMany({ phone });

    return true;
};

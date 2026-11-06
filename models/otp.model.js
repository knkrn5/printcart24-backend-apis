// models/otp.model.js
import mongoose, { Schema } from 'mongoose';

const otpSchema = new Schema(
    {
        phone: {
            type: String,
            required: true,
        },

        email: String,

        otpHash: {
            type: String,
            required: true,
        },

        expiresAt: {
            type: Date,
            required: true,
        },
    },
    {
        timestamps: true,
        collection: 'otps',
    },
);

// TTL Index: Automatically delete OTP document after expiry
otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
otpSchema.index({ phone: 1 });
otpSchema.index({ email: 1 }, { sparse: true }); // sparse: true allows null values

const Otp = mongoose.model('Otp', otpSchema);
export default Otp;

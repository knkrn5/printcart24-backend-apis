// models/partner.model.js
import mongoose, { Schema } from 'mongoose';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import env from '#configs/env';

const partnerSchema = new Schema(
    {
        firstName: {
            type: String,
            required: true,
            trim: true,
        },
        lastName: {
            type: String,
            trim: true,
            default: '',
        },
        fullName: {
            type: String,
            trim: true,
        },
        email: {
            type: String,
            required: true,
            lowercase: true,
            trim: true,
        },
        password: {
            type: String,
            required: true,
            select: false,
        },
        countryCode: {
            type: String,
            default: '+91',
            trim: true,
        },
        phone: {
            type: String,
            trim: true,
        },
        profilePicture: {
            type: String,
            default: '',
            trim: true,
        },
        gender: {
            type: String,
            enum: ['', 'Male', 'Female', 'Other'],
            default: '',
        },
        role: {
            type: String,
            enum: ['rider'],
            default: 'rider',
        },
        accountStatus: {
            type: String,
            enum: ['PENDING', 'ACTIVE', 'INACTIVE', 'REJECTED'],
            default: 'PENDING',
        },
        isPhoneVerified: {
            type: Boolean,
            default: false,
        },
        isEmailVerified: {
            type: Boolean,
            default: false,
        },
        isActive: {
            type: Boolean,
            default: true,
        },
        isOnline: {
            type: Boolean,
            default: false,
            index: true,
        },
        isDeleted: {
            type: Boolean,
            default: false,
        },
        fid: {
            type: String,
            trim: true,
            default: '',
            select: false,
        },
        fcmToken: {
            type: String,
            trim: true,
            default: '',
            select: false,
        },
        fidStatus: {
            type: String,
            enum: ['active', 'invalid'],
            default: 'active',
            select: false,
        },
        fidUpdatedAt: {
            type: Date,
            default: null,
            select: false,
        },
    },
    {
        timestamps: true,
        collection: 'partners',
    },
);

// Indexes
partnerSchema.index({ email: 1 }, { unique: true });
partnerSchema.index({ phone: 1 }, { unique: true, sparse: true });
partnerSchema.index({ fcmToken: 1 }, { sparse: true });
partnerSchema.index({ fid: 1 }, { sparse: true });

// Pre-save hook to hash password and compute fullName
partnerSchema.pre('save', async function () {
    if (this.isModified('firstName') || this.isModified('lastName') || this.isNew) {
        this.fullName = `${this.firstName || ''} ${this.lastName || ''}`.trim();
    }
    if (this.isModified('password')) {
        this.password = await bcrypt.hash(this.password, 12);
    }
});

// Compare password method
partnerSchema.methods.comparePassword = async function (candidatePassword) {
    return await bcrypt.compare(candidatePassword, this.password);
};

// Generate JWT access token
partnerSchema.methods.generateAccessToken = function () {
    const payload = {
        id: this._id,
        role: this.role,
        accountStatus: this.accountStatus,
    };
    return jwt.sign(payload, env.ACCESS_TOKEN_SECRET);
};

const Partner = mongoose.model('Partner', partnerSchema);

// Sync indexes to ensure MongoDB updates existing non-sparse index to sparse
Partner.syncIndexes().catch((err) => {
    console.error('Partner syncIndexes error:', err.message);
});

export default Partner;

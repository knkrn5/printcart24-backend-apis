// models/admin.model.js
import env from '#configs/env';
import mongoose, { Schema } from 'mongoose';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';

const adminSchema = new Schema(
    {
        fullName: {
            type: String,
            required: true,
        },

        email: {
            type: String,
            required: true,
        },

        phone: {
            type: String,
            required: true,
        },

        profilePicture: {
            type: String,
            default: '',
        },

        isEmailVerified: {
            type: Boolean,
            default: false,
        },

        isMobileVerified: {
            type: Boolean,
            default: false,
        },

        password: {
            type: String,
            required: true,
        },

        role: {
            type: String,
            enum: ['SUPER_ADMIN', 'MANAGER', 'OPERATOR'],
            default: 'OPERATOR',
        },

        permissions: [
            {
                type: String,
                // e.g. 'manage_orders', 'manage_products'
            },
        ],

        isActive: {
            type: Boolean,
            default: true,
        },

        isDeleted: {
            type: Boolean,
            default: false,
        },

        lastLoginAt: Date,
    },
    {
        timestamps: true,
        collection: 'admins',
    },
);

// Indexes
adminSchema.index({ email: 1 }, { unique: true }); // unique email with faster lookup
adminSchema.index({ mobile: 1 }, { unique: true, sparse: true }); // sparse: true allows null values

// Pre save hook to encrypt password if modified
adminSchema.pre('save', async function () {
    if (this.isModified('password')) {
        this.password = await bcrypt.hash(this.password, 12);
    }
});

// Generate Access Token for Admin users
adminSchema.methods.generateAccessToken = function () {
    const payload = {
        id: this._id,
        role: this.role,
    };

    const options = {
        expiresIn: env.ACCESS_TOKEN_EXPIRY,
    };

    return jwt.sign(payload, env.ACCESS_TOKEN_SECRET, options);
};

// Compare Admin Password
adminSchema.methods.comparePassword = async function (adminPassword) {
    return await bcrypt.compare(adminPassword, this.password);
};

const Admin = mongoose.model('Admin', adminSchema);
export default Admin;

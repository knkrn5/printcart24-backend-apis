// models/user.model.js
import mongoose, { Schema } from 'mongoose';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import env from '#configs/env';
import { ADDRESS_TYPE_VALUES } from '#constants/location';

const accessToken = env.ACCESS_TOKEN_SECRET;

const addressSchema = new Schema({
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, trim: true, default: '' },
    countryCode: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    fullAddress: { type: String, required: true, trim: true },
    city: { type: String, required: true, trim: true },
    citySlug: { type: String, required: true, trim: true, lowercase: true },
    state: { type: String, required: true, trim: true },
    stateCode: { type: String, required: true, trim: true, uppercase: true },
    pincode: { type: String, required: true, trim: true },
    addressType: {
        type: String,
        enum: ADDRESS_TYPE_VALUES,
        default: 'HOME',
    },
    latitude: {
        type: Number,
        default: 0,
    },
    longitude: {
        type: Number,
        default: 0,
    },
    isDefault: {
        type: Boolean,
        default: false,
    },
});

const userSchema = new Schema(
    {
        firstName: {
            type: String,
            trim: true,
        },

        lastName: {
            type: String,
            trim: true,
        },
        fullName: {
            type: String,
            trim: true,
        },

        countryCode: String, // e.g. +91, +1
        phone: String, // e.g. 9876543210

        email: {
            type: String,
            lowercase: true,
            trim: true,
            default: undefined,
        },

        password: {
            type: String, // optional (only if you later allow password login)
        },

        profilePicture: {
            type: String,
            default: '',
        },

        gender: {
            type: String,
            enum: ['', 'Male', 'Female', 'Other'],
            default: '',
        },

        isProfileComplete: {
            type: Boolean,
            default: false,
        },

        authProvider: {
            type: String,
            enum: ['PHONE', 'GOOGLE', 'APPLE'],
            default: 'PHONE',
        },

        googleId: String,
        appleId: String,

        isPhoneVerified: {
            type: Boolean,
            default: false,
        },

        isEmailVerified: {
            type: Boolean,
            default: false,
        },

        addresses: [addressSchema],

        role: {
            type: String,
            enum: ['STUDENT'],
            default: 'STUDENT',
        },

        isActive: {
            type: Boolean,
            default: true,
        },

        isDeleted: {
            type: Boolean,
            default: false,
        },

        fcmToken: {
            type: String,
            default: '',
        },
    },
    {
        timestamps: true,
        collection: 'users',
    },
);

// Virtual fullName removed - replaced by persistent 'fullName' field for indexed search.

// if countryCode & phone is set, then set fullPhone
userSchema.virtual('fullPhone').get(function () {
    // Check if countryCode & phone is set
    if (this.countryCode && this.phone) {
        // trim countryCode & phone
        this.countryCode = this.countryCode.trim();
        this.phone = this.phone.trim();
        // return merged countryCode & phone
        return `${this.countryCode}${this.phone}`;
    }
    // else return empty string
    return '';
});

// Indexes
userSchema.index({ phone: 1 }, { unique: true, sparse: true }); // allows null if using google login
userSchema.index({ email: 1 }, { unique: true, sparse: true });
userSchema.index({ googleId: 1 }, { sparse: true });
userSchema.index({ appleId: 1 }, { sparse: true });
userSchema.index({ fullName: 1 }, { collation: { locale: 'en', strength: 2 } });
userSchema.index({ fcmToken: 1 }, { sparse: true });

// Pre-save hook to encrypt password and set fullName
userSchema.pre('save', async function () {
    if (this.isModified('firstName') || this.isModified('lastName') || this.isNew) {
        this.fullName = `${this.firstName || ''} ${this.lastName || ''}`.trim();
    }

    if (this.isModified('password')) {
        this.password = await bcrypt.hash(this.password, 12);
    }
});

// Middleware to sync fullName on updates
userSchema.pre('findOneAndUpdate', async function () {
    const update = this.getUpdate();
    const $set = update.$set || update;

    // If either name field is being updated
    if ($set.firstName !== undefined || $set.lastName !== undefined) {
        // If both are present in the update, we can compute fullName immediately
        if ($set.firstName !== undefined && $set.lastName !== undefined) {
            $set.fullName = `${$set.firstName} ${$set.lastName}`.trim();
        } else {
            // If only one is updated, we need the current document to get the other part
            // To avoid excessive queries, we only do this if it's a name update
            const docToUpdate = await this.model.findOne(this.getQuery()).select('firstName lastName');
            if (docToUpdate) {
                const fname = $set.firstName !== undefined ? $set.firstName : docToUpdate.firstName || '';
                const lname = $set.lastName !== undefined ? $set.lastName : docToUpdate.lastName || '';
                $set.fullName = `${fname} ${lname}`.trim();
            }
        }
    }
});

// Generate Access Token
userSchema.methods.generateAccessToken = function () {
    const payload = {
        id: this._id,
        role: this.role,
    };

    return jwt.sign(payload, accessToken); // no expiry is set for users
};

// Compare User Password
userSchema.methods.comparePassword = async function (userPassword) {
    return await bcrypt.compare(userPassword, this.password);
};

const User = mongoose.model('User', userSchema);
export default User;

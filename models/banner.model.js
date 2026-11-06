// models/banner.model.js
import mongoose, { Schema } from 'mongoose';

const bannerSchema = new Schema(
    {
        page: {
            type: String,
            required: true,
            enum: ['HOME'],
            default: 'HOME',
            uppercase: true,
            trim: true,
        },

        type: {
            type: String,
            required: true,
            enum: ['PRIMARY', 'CAROUSEL'],
            uppercase: true,
        },

        s3Url: {
            type: String,
            required: true,
            trim: true,
        },

        redirectUrl: {
            type: String,
            trim: true,
            default: null,
        },

        rank: {
            type: Number,
            default: 0, // used mainly for carousel ordering
        },

        isActive: {
            type: Boolean,
            default: true,
        },

        isDeleted: {
            type: Boolean,
            default: false,
        },

        createdBy: {
            type: Schema.Types.ObjectId,
            ref: 'Admin',
            default: null,
        },

        updatedBy: {
            type: Schema.Types.ObjectId,
            ref: 'Admin',
            default: null,
        },
    },
    {
        timestamps: true,
        collection: 'banners',
    },
);

// (Index removed as PRIMARY banner implementation is no longer active)

// ✅ 2. Fast query index for listing banners
bannerSchema.index({ page: 1, isDeleted: 1, isActive: 1 });

// ✅ 3. Sorting optimization (carousel ranking)
bannerSchema.index({ page: 1, type: 1, rank: 1 });

const Banner = mongoose.model('Banner', bannerSchema);

export default Banner;

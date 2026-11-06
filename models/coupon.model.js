// models/coupon.model.js
import mongoose, { Schema } from 'mongoose';

const couponSchema = new Schema(
    {
        code: {
            type: String,
            required: true,
            trim: true,
            uppercase: true,
        },
        title: {
            type: String,
            required: true,
            trim: true,
        },
        description: {
            type: String,
            default: '',
            trim: true,
        },
        discountType: {
            type: String,
            enum: ['FIXED', 'PERCENT', 'FREE_DELIVERY'],
            required: true,
        },
        discountValue: {
            type: Number,
            default: 0,
            min: 0,
        },
        maxDiscountAmount: {
            type: Number,
            default: null,
            min: 0,
        },
        minOrderValue: {
            type: Number,
            default: 0,
            min: 0,
        },
        applicableServiceTypes: {
            type: [String],
            default: [],
        },
        applicableServices: {
            type: [
                {
                    type: Schema.Types.ObjectId,
                    ref: 'PrintService',
                },
            ],
            default: [],
        },
        firstOrderOnly: {
            type: Boolean,
            default: false,
        },
        usageLimit: {
            type: Number,
            default: null,
            min: 1,
        },
        usageLimitPerUser: {
            type: Number,
            default: 1,
            min: 1,
        },
        timesRedeemed: {
            type: Number,
            default: 0,
            min: 0,
        },
        validFrom: {
            type: Date,
            default: null,
        },
        validUntil: {
            type: Date,
            default: null,
        },
        isActive: {
            type: Boolean,
            default: true,
        },
        autoApply: {
            type: Boolean,
            default: false,
        },
    },
    {
        timestamps: true,
        collection: 'coupons',
    },
);

couponSchema.index({ code: 1 }, { unique: true });
couponSchema.index({ isActive: 1, validFrom: 1, validUntil: 1 });

const Coupon = mongoose.model('Coupon', couponSchema);

export default Coupon;

// models/cart.model.js
import mongoose, { Schema } from 'mongoose';

const cartItemSchema = new Schema(
    {
        service: {
            type: Schema.Types.ObjectId,
            ref: 'PrintService',
            required: true,
        },
        serviceSnapshot: {
            name: {
                type: String,
                required: true,
                trim: true,
            },
            slug: {
                type: String,
                required: true,
                trim: true,
            },
            serviceType: {
                type: String,
                required: true,
                trim: true,
            },
        },
        document: {
            type: Schema.Types.ObjectId,
            ref: 'PrintDocument',
            default: null,
        },
        addedAt: {
            type: Date,
            default: Date.now,
        },
        updatedAt: {
            type: Date,
            default: Date.now,
        },
    },
    {
        _id: true,
    },
);

const appliedCouponSchema = new Schema(
    {
        coupon: {
            type: Schema.Types.ObjectId,
            ref: 'Coupon',
            default: null,
        },
        code: {
            type: String,
            default: '',
            trim: true,
            uppercase: true,
        },
        discountType: {
            type: String,
            enum: ['FIXED', 'PERCENT', 'FREE_DELIVERY', ''],
            default: '',
        },
        discountAmount: {
            type: Number,
            default: 0,
            min: 0,
        },
    },
    { _id: false },
);

const cartStationeryItemSchema = new Schema(
    {
        stationery: {
            type: Schema.Types.ObjectId,
            ref: 'StationeryProduct',
            required: true,
        },
        itemSnapshot: {
            name: {
                type: String,
                required: true,
                trim: true,
            },
            brand: {
                type: String,
                default: '',
                trim: true,
            },
            productType: {
                type: String,
                default: 'STATIONERY',
            },
            thumbnailUrl: {
                type: String,
                default: '',
                trim: true,
            },
        },
        quantity: {
            type: Number,
            default: 1,
            min: 1,
        },
        addedAt: {
            type: Date,
            default: Date.now,
        },
        updatedAt: {
            type: Date,
            default: Date.now,
        },
    },
    { _id: true },
);

const cartSchema = new Schema(
    {
        user: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        status: {
            type: String,
            enum: ['ACTIVE', 'PROCESSING', 'CHECKED_OUT', 'INACTIVE'],
            default: 'ACTIVE',
        },
        items: {
            type: [cartItemSchema],
            default: [],
        },
        stationeryItems: {
            type: [cartStationeryItemSchema],
            default: [],
        },
        deliveryMode: {
            type: String,
            enum: ['DELIVERY', 'PICKUP'],
            default: 'DELIVERY',
        },
        selectedAddressId: {
            type: Schema.Types.ObjectId,
            default: null,
        },
        paymentMethod: {
            type: String,
            enum: ['', 'ONLINE', 'UPI', 'NET_BANKING', 'NETBANKING', 'CARD', 'COD', 'WALLET', 'EMI', 'PAYLATER', 'BANK_TRANSFER'],
            default: '',
        },
        appliedCoupon: {
            type: appliedCouponSchema,
            default: () => ({}),
        },
        notes: {
            type: String,
            default: '',
            trim: true,
        },
        pendingPaymentContext: {
            razorpayOrderId: { type: String, default: null },
            addressId: { type: Schema.Types.ObjectId, default: null },
            deliveryMode: { type: String, enum: ['DELIVERY', 'PICKUP', ''], default: '' },
            couponCode: { type: String, default: '' },
            frozenPricing: { type: Schema.Types.Mixed, default: null },
        },
    },

    {
        timestamps: true,
        collection: 'carts',
    },
);

cartSchema.index({ user: 1, updatedAt: -1 });
cartSchema.index({ user: 1, status: 1 }, { unique: true, partialFilterExpression: { status: 'ACTIVE' } });

const Cart = mongoose.model('Cart', cartSchema);

export default Cart;

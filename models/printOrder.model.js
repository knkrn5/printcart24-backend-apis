// models/printOrder.model.js
import mongoose, { Schema } from 'mongoose';
import moment from 'moment-timezone';
import { ADDRESS_TYPE_VALUES } from '#constants/location';
import { generateOrderNumberCandidate } from '#utils/orderNumber';

const addressSnapshotSchema = new Schema(
    {
        addressId: {
            type: Schema.Types.ObjectId,
            default: null,
        },
        firstName: {
            type: String,
            default: '',
            trim: true,
        },
        lastName: {
            type: String,
            default: '',
            trim: true,
        },
        countryCode: {
            type: String,
            default: '',
            trim: true,
        },
        phone: {
            type: String,
            default: '',
            trim: true,
        },
        fullAddress: {
            type: String,
            default: '',
            trim: true,
        },
        city: {
            type: String,
            default: '',
            trim: true,
        },
        citySlug: {
            type: String,
            default: '',
            trim: true,
            lowercase: true,
        },
        state: {
            type: String,
            default: '',
            trim: true,
        },
        stateCode: {
            type: String,
            default: '',
            trim: true,
            uppercase: true,
        },
        pincode: {
            type: String,
            default: '',
            trim: true,
        },
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
    },
    { _id: false },
);

const selectedAddOnSchema = new Schema(
    {
        group: {
            type: String,
            default: '',
            trim: true,
            uppercase: true,
        },
        code: {
            type: String,
            default: '',
            trim: true,
            uppercase: true,
        },
        label: {
            type: String,
            default: '',
            trim: true,
        },
        pricingModel: {
            type: String,
            enum: ['FLAT', 'PER_PAGE', 'PER_COPY', 'PER_ITEM', 'CUSTOM'],
            default: 'FLAT',
        },
        unitPrice: {
            type: Number,
            default: 0,
            min: 0,
        },
        quantity: {
            type: Number,
            default: 1,
            min: 0,
        },
        totalAmount: {
            type: Number,
            default: 0,
            min: 0,
        },
        optionId: {
            type: Number,
            default: null,
        },
        subOptionId: {
            type: Number,
            default: null,
        },
        subOptionCode: {
            type: String,
            default: '',
            trim: true,
        },
        subOptionLabel: {
            type: String,
            default: '',
            trim: true,
        },
    },
    { _id: false },
);

const selectedBindingSchema = new Schema(
    {
        code: {
            type: String,
            default: '',
            trim: true,
            uppercase: true,
        },
        label: {
            type: String,
            default: '',
            trim: true,
        },
        pricingModel: {
            type: String,
            enum: ['FLAT', 'PER_PAGE', 'PER_100_PAGES', 'SLAB', 'CUSTOM'],
            default: 'FLAT',
        },
        unitPrice: {
            type: Number,
            default: 0,
            min: 0,
        },
        totalAmount: {
            type: Number,
            default: 0,
            min: 0,
        },
    },
    { _id: false },
);

const orderedDocumentSchema = new Schema(
    {
        document: {
            type: Schema.Types.ObjectId,
            ref: 'PrintDocument',
            default: null,
        },
        originalFileName: {
            type: String,
            default: '',
            trim: true,
        },
        fileUrl: {
            type: String,
            default: '',
            trim: true,
        },
        pageCount: {
            type: Number,
            default: 0,
            min: 0,
        },
    },
    { _id: false },
);

const orderedItemSchema = new Schema(
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
            type: orderedDocumentSchema,
            default: () => ({}),
        },
        customization: {
            copies: {
                type: Number,
                default: 1,
                min: 1,
            },
            orientation: {
                type: String,
                default: '',
                trim: true,
            },
            paperSize: {
                type: String,
                default: '',
                trim: true,
            },
            colorMode: {
                type: String,
                default: '',
                trim: true,
            },
            sideMode: {
                type: String,
                default: '',
                trim: true,
            },
            paperQuality: {
                type: String,
                default: '',
                trim: true,
            },
            stickBindingEnabled: {
                type: Boolean,
                default: false,
            },
            spiralBindingEnabled: {
                type: Boolean,
                default: false,
            },
            staplingEnabled: {
                type: Boolean,
                default: false,
            },
            bookletOptionCodes: {
                type: [String],
                default: [],
            },
            selectedBinding: {
                type: selectedBindingSchema,
                default: () => ({}),
            },
            selectedAddOns: {
                type: [selectedAddOnSchema],
                default: [],
            },
            notes: {
                type: String,
                default: '',
                trim: true,
            },
            selectedBindingColorCode: {
                type: String,
                default: '',
                trim: true,
                uppercase: true,
            },
        },
        priceSummary: {
            baseAmount: {
                type: Number,
                default: 0,
                min: 0,
            },
            addOnAmount: {
                type: Number,
                default: 0,
                min: 0,
            },
            taxAmount: {
                type: Number,
                default: 0,
                min: 0,
            },
            totalAmount: {
                type: Number,
                default: 0,
                min: 0,
            },
        },
    },
    { _id: false },
);

const orderedStationeryItemSchema = new Schema(
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
            },
        },
        quantity: {
            type: Number,
            default: 1,
            min: 1,
        },
        priceSummary: {
            unitPrice: {
                type: Number,
                default: 0,
                min: 0,
            },
            taxableAmount: {
                type: Number,
                default: 0,
                min: 0,
            },
            taxAmount: {
                type: Number,
                default: 0,
                min: 0,
            },
            totalAmount: {
                type: Number,
                default: 0,
                min: 0,
            },
        },
    },
    { _id: false },
);

const orderPriceSummarySchema = new Schema(
    {
        itemTotal: {
            type: Number,
            default: 0,
            min: 0,
        },
        addOnTotal: {
            type: Number,
            default: 0,
            min: 0,
        },
        taxAmount: {
            type: Number,
            default: 0,
            min: 0,
        },
        deliveryFee: {
            type: Number,
            default: 0,
            min: 0,
        },
        discountAmount: {
            type: Number,
            default: 0,
            min: 0,
        },
        platformFee: {
            type: Number,
            default: 0,
            min: 0,
        },
        grandTotal: {
            type: Number,
            default: 0,
            min: 0,
        },
        currency: {
            type: String,
            default: 'INR',
            uppercase: true,
            trim: true,
        },
    },
    { _id: false },
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

const statusHistoryEntrySchema = new Schema(
    {
        status: {
            type: String,
            enum: ['RECEIVED', 'PROCESSED', 'DISPATCHED', 'DELIVERED', 'CANCELLED', 'FAILED', 'REATTEMPT'],
            required: true,
        },
        changedBy: {
            type: Schema.Types.ObjectId,
            ref: 'Admin',
            default: null,
        },
        note: {
            type: String,
            default: '',
            trim: true,
        },
        changedAt: {
            type: Date,
            default: Date.now,
        },
    },
    { _id: false },
);

const orderLocationSchema = new Schema(
    {
        latitude: {
            type: Number,
            default: null,
        },
        longitude: {
            type: Number,
            default: null,
        },
        updatedAt: {
            type: Date,
            default: null,
        },
    },
    { _id: false },
);

const printOrderSchema = new Schema(
    {
        orderNumber: {
            type: String,
            required: true,
            trim: true,
            uppercase: true,
        },
        user: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        cart: {
            type: Schema.Types.ObjectId,
            ref: 'Cart',
            default: null,
        },
        items: {
            type: [orderedItemSchema],
            default: [],
        },
        stationeryItems: {
            type: [orderedStationeryItemSchema],
            default: [],
        },
        deliveryMode: {
            type: String,
            enum: ['DELIVERY', 'PICKUP'],
            default: 'DELIVERY',
        },
        assignedPartner: {
            type: Schema.Types.ObjectId,
            ref: 'Partner',
            default: null,
            index: true,
        },
        assignedAt: {
            type: Date,
            default: null,
        },
        currentLocation: {
            type: orderLocationSchema,
            default: () => ({ latitude: null, longitude: null, updatedAt: null }),
        },
        deliveryAddress: {
            type: addressSnapshotSchema,
            default: () => ({}),
        },
        appliedCoupon: {
            type: appliedCouponSchema,
            default: () => ({}),
        },
        priceSummary: {
            type: orderPriceSummarySchema,
            default: () => ({}),
        },
        orderStatus: {
            type: String,
            enum: ['RECEIVED', 'PROCESSED', 'DISPATCHED', 'DELIVERED', 'CANCELLED', 'FAILED', 'REATTEMPT'],
            default: 'RECEIVED',
        },
        statusHistory: {
            type: [statusHistoryEntrySchema],
            default: [],
        },
        paymentStatus: {
            type: String,
            enum: ['PENDING', 'INITIATED', 'FAILED', 'PAID', 'REFUNDED'],
            default: 'PENDING',
        },
        paymentMethod: {
            type: String,
            enum: ['', 'ONLINE', 'UPI', 'NET_BANKING', 'NETBANKING', 'CARD', 'COD', 'WALLET', 'EMI', 'PAYLATER', 'BANK_TRANSFER'],
            default: '',
        },
        paymentReference: {
            type: String,
            default: '',
            trim: true,
        },
        paymentAttemptedAt: {
            type: Date,
            default: null,
        },
        paidAt: {
            type: Date,
            default: null,
        },
        estimatedDeliveryAt: {
            type: Date,
            default: null,
        },
        razorpayOrderId: {
            type: String,
            default: '',
            index: true,
        },
        razorpayPaymentId: {
            type: String,
            default: '',
        },
        razorpaySignature: {
            type: String,
            default: '',
        },
        webhookProcessed: {
            type: Boolean,
            default: false,
        },
        refund: {
            status: {
                type: String,
                enum: ['NOT_APPLICABLE', 'PROCESSING', 'PROCESSED', 'FAILED'],
                default: 'NOT_APPLICABLE',
            },
            razorpayRefundId: {
                type: String,
                default: '',
                trim: true,
            },
            amount: {
                type: Number,
                default: 0,
                min: 0,
            },
            initiatedAt: {
                type: Date,
                default: null,
            },
            processedAt: {
                type: Date,
                default: null,
            },
            failureReason: {
                type: String,
                default: '',
                trim: true,
            },
        },
    },
    {
        timestamps: true,
        collection: 'print_orders',
    },
);

printOrderSchema.pre('validate', async function () {
    if (!this.isNew || this.orderNumber) return;

    const startOfDay = moment().tz('Asia/Kolkata').startOf('day').toDate();
    const endOfDay = moment().tz('Asia/Kolkata').endOf('day').toDate();

    const todayCount = await this.constructor.countDocuments({
        createdAt: { $gte: startOfDay, $lte: endOfDay },
    });

    for (let attempt = 0; attempt < 5; attempt += 1) {
        const candidate = generateOrderNumberCandidate(new Date(), todayCount + 1 + attempt);
        const existingOrder = await this.constructor.exists({ orderNumber: candidate });

        if (!existingOrder) {
            this.orderNumber = candidate;
            return;
        }
    }

    throw new Error('Unable to generate a unique order number.');
});

printOrderSchema.index({ orderNumber: 1 }, { unique: true });
printOrderSchema.index({ user: 1, createdAt: -1 });
printOrderSchema.index({ orderStatus: 1, paymentStatus: 1, createdAt: -1 });

const PrintOrder = mongoose.model('PrintOrder', printOrderSchema);

export default PrintOrder;

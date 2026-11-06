// models/printServicePricing.model.js
import mongoose, { Schema } from 'mongoose';

const basePricingSchema = new Schema(
    {
        calculationType: {
            type: String,
            enum: ['FLAT', 'PER_PAGE', 'PER_COPY', 'PER_SHEET', 'PER_ITEM', 'PER_DOCUMENT', 'PER_100_PAGES'],
            default: 'FLAT',
        },
        unitPrice: {
            type: Number,
            default: 0,
            min: 0,
        },
        isTaxable: {
            type: Boolean,
            default: true,
        },
        isActive: {
            type: Boolean,
            default: true,
        },
    },
    { _id: false },
);

const optionPricingSchema = new Schema(
    {
        group: {
            type: String,
            enum: [
                'COLOR_MODE',
                'PAPER_SIZE',
                'PAPER_QUALITY',
                'ORIENTATION',
                'SIDE_MODE',
                'BINDING_TOGGLE',
                'BINDING_OPTION',
                'BOOKLET_OPTION',
            ],
            required: true,
            trim: true,
        },
        code: {
            type: String,
            required: true,
            trim: true,
            uppercase: true,
        },
        label: {
            type: String,
            required: true,
            trim: true,
        },
        calculationType: {
            type: String,
            enum: ['FLAT', 'PER_PAGE', 'PER_COPY', 'PER_SHEET', 'PER_ITEM', 'PER_DOCUMENT', 'PER_100_PAGES'],
            default: 'FLAT',
        },
        unitPrice: {
            type: Number,
            default: 0,
            min: 0,
        },
        minPages: {
            type: Number,
            default: null,
            min: 0,
        },
        maxPages: {
            type: Number,
            default: null,
            min: 0,
        },
        slabSize: {
            type: Number,
            default: null,
            min: 1,
        },
        isTaxable: {
            type: Boolean,
            default: true,
        },
        isActive: {
            type: Boolean,
            default: true,
        },
    },
    { _id: false },
);

// Stores the price for one combination-dependent value (e.g. Document Printing's
// colorMode+paperSize+paperQuality lookup, or Thesis Printing's colorMode+sideMode).
// Not read by the generic optionPricing resolver — only by the specific
// combination-based override for the service it belongs to. Unused dimensions
// for a given service stay null.
const comboPricingEntrySchema = new Schema(
    {
        colorMode: { type: String, default: null, uppercase: true, trim: true },
        paperSize: { type: String, default: null, uppercase: true, trim: true },
        paperQuality: { type: String, default: null, uppercase: true, trim: true },
        sideMode: { type: String, default: null, uppercase: true, trim: true },
        pageBucket: { type: String, default: null, uppercase: true, trim: true },
        unitPrice: {
            type: Number,
            required: true,
            min: 0,
        },
        isActive: {
            type: Boolean,
            default: true,
        },
    },
    { _id: false },
);

const printServicePricingSchema = new Schema(
    {
        service: {
            type: Schema.Types.ObjectId,
            ref: 'PrintService',
            required: true,
        },
        currency: {
            type: String,
            default: 'INR',
            uppercase: true,
            trim: true,
        },
        basePricing: {
            type: basePricingSchema,
            default: () => ({}),
        },
        optionPricing: {
            type: [optionPricingSchema],
            default: [],
        },
        comboPricing: {
            type: [comboPricingEntrySchema],
            default: [],
        },
        updatedBy: {
            type: Schema.Types.ObjectId,
            ref: 'Admin',
            default: null,
        },
        isActive: {
            type: Boolean,
            default: true,
        },
    },
    {
        timestamps: true,
        collection: 'print_service_pricing',
    },
);

printServicePricingSchema.index({ service: 1 }, { unique: true });

const PrintServicePricing = mongoose.model('PrintServicePricing', printServicePricingSchema);

export default PrintServicePricing;

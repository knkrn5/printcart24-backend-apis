// models/printService.model.js
import mongoose, { Schema } from 'mongoose';

const subOptionSchema = new Schema(
    {
        id: {
            type: Number,
            default: null,
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
        price: {
            type: Number,
            default: 0,
            min: 0,
        },
        minPages: {
            type: Number,
            default: null,
        },
        maxPages: {
            type: Number,
            default: null,
        },
    },
    { _id: false },
);

const optionValueSchema = new Schema(
    {
        id: {
            type: Number,
            default: null,
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
        description: {
            type: String,
            default: '',
            trim: true,
        },
        price: {
            type: Number,
            default: 0,
            min: 0,
        },
        hasSubOptions: {
            type: Boolean,
            default: false,
        },
        subOptions: {
            type: [subOptionSchema],
            default: [],
        },
        sortOrder: {
            type: Number,
            default: 0,
        },
        isDefault: {
            type: Boolean,
            default: false,
        },
        isActive: {
            type: Boolean,
            default: true,
        },
        colorModeFilter: {
            type: [String],
            default: [],
        },
    },
    { _id: false },
);

const sliderImageSchema = new Schema(
    {
        s3Url: {
            type: String,
            required: true,
            trim: true,
        },
    },
    { _id: false }
);

const shortDescriptionPointSchema = new Schema(
    {
        points: {
            type: String,
            required: true,
            trim: true,
        },
    },
    { _id: false }
);

const copiesConfigSchema = new Schema(
    {
        min: {
            type: Number,
            default: 1,
            min: 1,
        },
        max: {
            type: Number,
            default: null,
            min: 1,
        },
        default: {
            type: Number,
            default: 1,
            min: 1,
        },
    },
    { _id: false },
);

const bindingOptionSchema = new Schema(
    {
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
        description: {
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
        minPages: {
            type: Number,
            default: 0,
            min: 0,
        },
        maxPages: {
            type: Number,
            default: null,
            min: 0,
        },
        isDefault: {
            type: Boolean,
            default: false,
        },
        isRecommended: {
            type: Boolean,
            default: false,
        },
        isActive: {
            type: Boolean,
            default: true,
        },
    },
    { _id: false },
);

const pricingRuleSchema = new Schema(
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
            default: 'BOOKLET_OPTION',
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
            enum: ['FLAT', 'PER_PAGE', 'PER_COPY', 'PER_SHEET', 'PER_ITEM', 'PERCENT', 'PER_DOCUMENT', 'PER_100_PAGES'],
            default: 'FLAT',
        },
        amount: {
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
        isOptional: {
            type: Boolean,
            default: false,
        },
        isActive: {
            type: Boolean,
            default: true,
        },
    },
    { _id: false },
);

const taxRuleSchema = new Schema(
    {
        taxName: {
            type: String,
            required: true,
            trim: true,
        },
        taxType: {
            type: String,
            enum: ['GST', 'CGST', 'SGST', 'IGST', 'CESS', 'OTHER'],
            required: true,
        },
        rate: {
            type: Number,
            required: true,
            min: 0,
        },
        isInclusive: {
            type: Boolean,
            default: false,
        },
        appliesTo: {
            type: [String],
            default: ['BASE_PRICE'],
        },
    },
    { _id: false },
);

const printServiceSchema = new Schema(
    {
        name: {
            type: String,
            required: true,
            trim: true,
        },
        slug: {
            type: String,
            required: true,
            trim: true,
            lowercase: true,
        },
        serviceType: {
            type: String,
            enum: ['DOCUMENT_PRINT', 'DOCUMENT_BINDING', 'PHOTO_PRINT', 'PHOTO_FRAME', 'CUSTOM'],
            required: true,
        },
        shortDescription: {
            type: [shortDescriptionPointSchema],
            default: [],
        },
        sliderImages: {
            type: [sliderImageSchema],
            default: [],
        },
        description: {
            type: String,
            default: '',
            trim: true,
        },
        badgeLabel: {
            type: String,
            default: '',
            trim: true,
        },
        iconUrl: {
            type: String,
            default: '',
            trim: true,
        },
        thumbnailUrl: {
            type: String,
            default: '',
            trim: true,
        },
        listImageUrl: {
            type: String,
            default: '',
            trim: true,
        },
        detailImageUrl: {
            type: String,
            default: '',
            trim: true,
        },
        detailDescriptions: {
            type: [String],
            default: [],
        },
        bgColor: {
            type: String,
            default: '',
            trim: true,
        },
        allowsMultipleFiles: {
            type: Boolean,
            default: false,
        },
        maxFilesPerItem: {
            type: Number,
            default: 1,
            min: 1,
        },
        maxPagesPerFile: {
            type: Number,
            default: null,
            min: 1,
        },
        allowedMimeTypes: {
            type: [String],
            default: [],
        },
        supportedOrientations: {
            type: [optionValueSchema],
            default: [],
        },
        supportedPaperSizes: {
            type: [optionValueSchema],
            default: [],
        },
        supportedColorModes: {
            type: [optionValueSchema],
            default: [],
        },
        supportedSideModes: {
            type: [optionValueSchema],
            default: [],
        },
        supportedPaperQualities: {
            type: [optionValueSchema],
            default: [],
        },
        supportedBindingColors: {
            type: [optionValueSchema],
            default: [],
        },
        copiesConfig: {
            type: copiesConfigSchema,
            default: () => ({}),
        },
        supportedAddOns: {
            type: [pricingRuleSchema],
            default: [],
        },
        bindingOptions: {
            type: [bindingOptionSchema],
            default: [],
        },
        bindingConfiguration: {
            toggles: {
                type: [optionValueSchema],
                default: [],
            },
            options: {
                type: [bindingOptionSchema],
                default: [],
            },
        },
        bookletOptions: {
            type: [optionValueSchema],
            default: [],
        },
        pricingModel: {
            type: String,
            enum: ['PER_PAGE', 'PER_SHEET', 'PER_ITEM', 'CUSTOM'],
            default: 'PER_PAGE',
        },
        basePrice: {
            type: Number,
            default: 0,
            min: 0,
        },
        gstPercentage: {
            type: Number,
            default: 18,
            min: 0,
            max: 100,
        },
        currency: {
            type: String,
            default: 'INR',
            uppercase: true,
            trim: true,
        },
        pricingRules: {
            type: [pricingRuleSchema],
            default: [],
        },
        taxRules: {
            type: [taxRuleSchema],
            default: [],
        },
        estimatedDeliveryMinutes: {
            type: Number,
            default: 0,
            min: 0,
        },
        supportsDelivery: {
            type: Boolean,
            default: true,
        },
        supportsPickup: {
            type: Boolean,
            default: false,
        },
        sortOrder: {
            type: Number,
            default: 0,
        },
        isActive: {
            type: Boolean,
            default: true,
        },
        deliveryNote: {
            type: String,
            default: '',
            trim: true,
        },
    },
    {
        timestamps: true,
        collection: 'print_services',
    },
);

printServiceSchema.index({ slug: 1 }, { unique: true });
printServiceSchema.index({ serviceType: 1, isActive: 1, sortOrder: 1 });

const PrintService = mongoose.model('PrintService', printServiceSchema);

export default PrintService;

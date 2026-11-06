// models/printDocument.model.js
import mongoose, { Schema } from 'mongoose';

const previewAssetSchema = new Schema(
    {
        pageNumber: {
            type: Number,
            required: true,
            min: 1,
        },
        previewUrl: {
            type: String,
            required: true,
            trim: true,
        },
    },
    { _id: false },
);

const optionSelectionSchema = new Schema(
    {
        optionId: {
            type: Number,
            required: true,
        },
        subOptionId: {
            type: Number,
            default: null,
        },
    },
    { _id: false },
);

const documentCustomizationSchema = new Schema(
    {
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
            default: 'SINGLE',
            trim: true,
        },
        paperQuality: {
            type: String,
            default: '',
            trim: true,
        },
        bindingSelections: {
            type: [optionSelectionSchema],
            default: [],
        },
        selectedBindingColorCode: {
            type: String,
            default: '',
            trim: true,
            uppercase: true,
        },
        bookletOptionCodes: {
            type: String,
            default: '',
            trim: true,
            uppercase: true,
        },
        notes: {
            type: String,
            default: '',
            trim: true,
        },
        completedAt: {
            type: Date,
            default: null,
        },
    },
    { _id: false },
);

const printDocumentSchema = new Schema(
    {
        user: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        service: {
            type: Schema.Types.ObjectId,
            ref: 'PrintService',
            default: null,
        },
        originalFileName: {
            type: String,
            trim: true,
            default: '',
        },
        fileExtension: {
            type: String,
            default: '',
            trim: true,
            lowercase: true,
        },
        mimeType: {
            type: String,
            required: true,
            trim: true,
        },
        fileSizeBytes: {
            type: Number,
            min: 0,
        },
        pageCount: {
            type: Number,
            default: 0,
            min: 0,
        },
        storageProvider: {
            type: String,
            enum: ['S3', 'LOCAL', 'OTHER'],
            default: 'S3',
        },
        storageKey: {
            type: String,
            default: '',
            trim: true,
        },
        fileUrl: {
            type: String,
            required: true,
            trim: true,
        },
        previewAssets: {
            type: [previewAssetSchema],
            default: [],
        },
        checksum: {
            type: String,
            default: '',
            trim: true,
        },
        uploadStatus: {
            type: String,
            enum: ['UPLOADED', 'PROCESSING', 'READY', 'FAILED'],
            default: 'UPLOADED',
        },
        processingError: {
            type: String,
            default: '',
            trim: true,
        },
        customization: {
            type: documentCustomizationSchema,
            default: () => ({}),
        },
        cartStatus: {
            type: String,
            enum: ['AVAILABLE', 'IN_CART', 'REMOVED', 'ORDERED'],
            default: 'AVAILABLE',
        },
        isDeleted: {
            type: Boolean,
            default: false,
        },
    },
    {
        timestamps: true,
        collection: 'print_documents',
    },
);

printDocumentSchema.index({ user: 1, createdAt: -1 });
printDocumentSchema.index({ checksum: 1 }, { sparse: true });
printDocumentSchema.index({ uploadStatus: 1, isDeleted: 1 });
printDocumentSchema.index({ user: 1, cartStatus: 1, isDeleted: 1 });

const PrintDocument = mongoose.model('PrintDocument', printDocumentSchema);

export default PrintDocument;

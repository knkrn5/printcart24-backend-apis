// models/printCustomization.model.js
import mongoose, { Schema } from 'mongoose';

/**
 * printCustomizationSchema
 *
 * A short-lived "editing session" document created when a user taps Edit
 * on an in-cart print item. It is keyed on cartItemId (the _id of the
 * cart sub-document) so there is always at most one active session per item.
 *
 * Lifecycle:
 *   PENDING  — user is viewing / changing customization options
 *   COMPLETED — user confirmed → POST /cart/items/print with cartItemId was called
 *
 * Stale PENDING sessions are auto-deleted by MongoDB TTL index on expiresAt.
 */

const customizationSessionSchema = new Schema(
    {
        copies: { type: Number, default: 1, min: 1 },
        orientation: { type: String, default: '', trim: true },
        paperSize: { type: String, default: '', trim: true },
        colorMode: { type: String, default: '', trim: true },
        sideMode: { type: String, default: '', trim: true },
        paperQuality: { type: String, default: '', trim: true },
        staplingEnabled: { type: Boolean, default: false },
        stickBindingEnabled: { type: Boolean, default: false },
        spiralBindingEnabled: { type: Boolean, default: false },
        selectedBindingCode: { type: String, default: '', trim: true, uppercase: true },
        selectedBindingColorCode: { type: String, default: '', trim: true, uppercase: true },
        bookletOptionCodes: { type: String, default: '', trim: true, uppercase: true },
        notes: { type: String, default: '', trim: true },
    },
    { _id: false },
);

const printCustomizationSchema = new Schema(
    {
        user: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        // _id of the cart sub-document (items[]._ id from the Cart collection)
        cartItemId: {
            type: Schema.Types.ObjectId,
            required: true,
        },
        // The PrintDocument being re-customized
        documentId: {
            type: Schema.Types.ObjectId,
            ref: 'PrintDocument',
            required: true,
        },
        // Service context — UI needs this to load the right options
        serviceId: {
            type: Schema.Types.ObjectId,
            ref: 'PrintService',
            required: true,
        },
        // Pre-filled with the existing PrintDocument.customization values
        customization: {
            type: customizationSessionSchema,
            default: () => ({}),
        },
        status: {
            type: String,
            enum: ['PENDING', 'COMPLETED'],
            default: 'PENDING',
        },
        // TTL — MongoDB will auto-delete documents after this timestamp
        expiresAt: {
            type: Date,
            required: true,
        },
    },
    {
        timestamps: true,
        collection: 'print_customizations',
    },
);

// One active session per cart item (upsert overwrites stale PENDING sessions)
printCustomizationSchema.index({ cartItemId: 1 }, { unique: true });

// TTL index — MongoDB auto-deletes expired sessions
printCustomizationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Fast lookup by user
printCustomizationSchema.index({ user: 1, status: 1 });

const PrintCustomization = mongoose.model('PrintCustomization', printCustomizationSchema);

export default PrintCustomization;

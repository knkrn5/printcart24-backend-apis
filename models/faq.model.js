// models/faq.model.js
import mongoose, { Schema } from 'mongoose';

const faqSchema = new Schema(
    {
        /** The question text */
        question: {
            type: String,
            required: true,
            trim: true,
            unique: true,
        },

        /** The answer text (can be HTML/Markdown if needed) */
        answer: {
            type: String,
            required: true,
            trim: true,
        },

        /** Category for grouping FAQs */
        category: {
            type: String,
            default: 'General',
        },

        /** Sorting order for display */
        order: {
            type: Number,
            default: 0,
        },

        /** Visibility toggle */
        isActive: {
            type: Boolean,
            default: true,
        },

        /** Soft delete flag */
        isDeleted: {
            type: Boolean,
            default: false,
        },

        /** Admin who created the FAQ */
        createdBy: {
            type: Schema.Types.ObjectId,
            ref: 'Admin',
            default: null,
        },

        /** Admin who last updated the FAQ */
        updatedBy: {
            type: Schema.Types.ObjectId,
            ref: 'Admin',
            default: null,
        },
    },
    {
        timestamps: true,
        collection: 'faqs',
    },
);

// ─── Indexes ─────────────────────────────────────────────────────────────────
faqSchema.index({ order: -1 });
faqSchema.index({ isActive: 1, isDeleted: 1 });
faqSchema.index({ question: 'text' }); // Enable text search for questions

const Faq = mongoose.model('Faq', faqSchema);

export default Faq;

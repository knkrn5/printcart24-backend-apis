// models/cmsContent.model.js
import mongoose, { Schema } from 'mongoose';

const cmsContentSchema = new Schema(
    {
        title: {
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
        content: {
            type: String, // Storing HTML string
            required: true,
        },
        imageUrl: {
            type: String,
            default: '',
        },
        createdBy: {
            type: Schema.Types.ObjectId,
            ref: 'Admin',
        },
        updatedBy: {
            type: Schema.Types.ObjectId,
            ref: 'Admin',
        },
    },
    {
        timestamps: true,
        collection: 'cms_contents',
    },
);

// Index for slugs
cmsContentSchema.index({ slug: 1 });

const CmsContent = mongoose.model('cms_contents', cmsContentSchema);

export default CmsContent;

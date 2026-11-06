// models/stationeryProduct.model.js
import mongoose, { Schema } from 'mongoose';

const stationeryProductSchema = new Schema(
    {
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

        description: {
            type: String,
            default: '',
        },

        thumbnailUrl: String,
        bgColor: {
            type: String,
            default: '',
            trim: true,
        },

        itemPrice: {
            type: Number,
            required: true,
            min: 0,
        },

        stock: {
            type: Number,
            default: 0,
            min: 0,
        },

        isActive: {
            type: Boolean,
            default: true,
        },
    },
    {
        timestamps: true,
        collection: 'stationery_products',
    },
);
// indexes
stationeryProductSchema.index({ isActive: 1, _id: -1 });
stationeryProductSchema.index({ name: 1, brand: 1 }, { unique: true });

const StationeryProduct = mongoose.model('StationeryProduct', stationeryProductSchema);
export default StationeryProduct;

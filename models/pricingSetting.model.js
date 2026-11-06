// models/pricingSetting.model.js
import mongoose, { Schema } from 'mongoose';

const pricingSettingSchema = new Schema(
    {
        platformFee: {
            type: Number,
            required: true,
            default: 10,
            min: 0,
        },
        deliveryFee: {
            type: Number,
            required: true,
            default: 0,
            min: 0,
        },
        gstPercentage: {
            type: Number,
            required: true,
            default: 18,
            min: 0,
            max: 100,
        },
        sameDayRepeatDiscountPercentage: {
            type: Number,
            required: true,
            default: 5,
            min: 0,
            max: 100,
        },
        updatedBy: {
            type: Schema.Types.ObjectId,
            ref: 'Admin',
            default: null,
        },
    },
    {
        timestamps: true,
        collection: 'pricingsettings',
    },
);

const PricingSetting = mongoose.model('PricingSetting', pricingSettingSchema);

export default PricingSetting;

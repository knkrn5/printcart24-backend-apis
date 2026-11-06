// services/pricingSetting.service.js
import PricingSetting from '#models/pricingSetting';
import env from '#configs/env';

export const DEFAULT_PRICING_SETTINGS = {
    platformFee: Number(env.FIXED_PLATFORM_FEE) || 10,
    deliveryFee: 0,
    gstPercentage: 18,
    sameDayRepeatDiscountPercentage: 5,
};

export async function getPricingSettings() {
    const settings = await PricingSetting.findOne().lean();
    if (!settings) {
        return { ...DEFAULT_PRICING_SETTINGS };
    }
    return {
        platformFee: settings.platformFee ?? DEFAULT_PRICING_SETTINGS.platformFee,
        deliveryFee: settings.deliveryFee ?? DEFAULT_PRICING_SETTINGS.deliveryFee,
        gstPercentage: settings.gstPercentage ?? DEFAULT_PRICING_SETTINGS.gstPercentage,
        sameDayRepeatDiscountPercentage:
            settings.sameDayRepeatDiscountPercentage ?? DEFAULT_PRICING_SETTINGS.sameDayRepeatDiscountPercentage,
    };
}

export async function updatePricingSettings(updates, adminId = null) {
    const setFields = {
        platformFee: Number(updates.platformFee),
        deliveryFee: Number(updates.deliveryFee),
        gstPercentage: Number(updates.gstPercentage),
        sameDayRepeatDiscountPercentage: Number(updates.sameDayRepeatDiscountPercentage),
    };
    if (adminId) {
        setFields.updatedBy = adminId;
    }

    const updated = await PricingSetting.findOneAndUpdate(
        {},
        { $set: setFields },
        { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
    ).lean();

    return {
        platformFee: updated.platformFee,
        deliveryFee: updated.deliveryFee,
        gstPercentage: updated.gstPercentage,
        sameDayRepeatDiscountPercentage: updated.sameDayRepeatDiscountPercentage,
    };
}

// controllers/pricingSetting.controller.js
import httpStatus from 'http-status';
import { sendResponse } from '#utils/generalHelper';
import { getPricingSettings, updatePricingSettings } from '#services/pricingSetting';
import { updatePricingSettingsSchema } from '#validations/admin';

export const adminGetPricingSettings = async (req, res) => {
    const data = await getPricingSettings();
    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        data,
        message: 'Pricing settings fetched successfully',
    });
};

export const adminUpdatePricingSettings = async (req, res) => {
    const { error, value } = updatePricingSettingsSchema.validate(req.body);
    if (error) {
        return sendResponse({
            res,
            statusCode: httpStatus.BAD_REQUEST,
            message: error.details[0].message,
        });
    }

    const data = await updatePricingSettings(value, req.user?.id);
    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        data,
        message: 'Pricing settings updated successfully',
    });
};

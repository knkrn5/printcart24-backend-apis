// controllers/support.controller.js
import httpStatus from 'http-status';
import { sendResponse } from '#utils/generalHelper';
import env from '#configs/env';

/**
 * Get Help and Support contact details
 * @route GET /api/support
 * @access Public
 */
export const getSupportDetails = async (req, res) => {
    const supportDetails = {
        whatsappNumber: env.SUPPORT_WHATSAPP_NUMBER || null,
        callNumber: env.SUPPORT_CALL_NUMBER || null,
        email: env.SUPPORT_EMAIL || null,
    };

    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        data: supportDetails,
        message: 'Support contact details retrieved successfully.',
    });
};

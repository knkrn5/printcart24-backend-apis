import httpStatus from 'http-status';
import { sendResponse } from '#utils/generalHelper';
import Faq from '#models/faq';
import {
    adminFaqIdSchema,
    upsertFaqSchema,
    adminListFaqsQuerySchema,
} from '#validations/faq';

/**
 * Create a new FAQ (Admin Only)
 * @route POST /api/admin/faqs
 */
export const adminCreateFaq = async (req, res) => {
    const { error, value } = upsertFaqSchema.validate(req.body);
    if (error) {
        return sendResponse({
            res,
            statusCode: httpStatus.BAD_REQUEST,
            message: error.details[0].message,
        });
    }

    const { question, answer } = value;

    // Check duplicate question
    const existing = await Faq.findOne({ question, isDeleted: false });
    if (existing) {
        return sendResponse({
            res,
            statusCode: httpStatus.CONFLICT,
            message: 'An FAQ with this question already exists.',
        });
    }

    // Determine max order dynamically so that new ones have highest order
    const lastFaq = await Faq.findOne({ isDeleted: false })
        .sort({ order: -1 })
        .select('order')
        .lean();
    const nextOrder = lastFaq ? lastFaq.order + 1 : 1;

    const faq = await Faq.create({
        question,
        answer,
        order: nextOrder,
        createdBy: req.user.id,
        updatedBy: req.user.id,
    });

    return sendResponse({
        res,
        statusCode: httpStatus.CREATED,
        data: faq,
        message: 'FAQ created successfully.',
    });
};

/**
 * Update an existing FAQ (Admin Only)
 * @route PUT /api/admin/faqs/:faqId
 */
export const adminUpdateFaq = async (req, res) => {
    const { error: paramsError, value: paramsValue } = adminFaqIdSchema.validate(req.params);
    if (paramsError) {
        return sendResponse({
            res,
            statusCode: httpStatus.BAD_REQUEST,
            message: paramsError.details[0].message,
        });
    }

    const { error, value } = upsertFaqSchema.validate(req.body);
    if (error) {
        return sendResponse({
            res,
            statusCode: httpStatus.BAD_REQUEST,
            message: error.details[0].message,
        });
    }

    const { question, answer } = value;
    const { faqId } = paramsValue;

    // Check duplicate question for other FAQs
    const existing = await Faq.findOne({
        question,
        isDeleted: false,
        _id: { $ne: faqId },
    });
    if (existing) {
        return sendResponse({
            res,
            statusCode: httpStatus.CONFLICT,
            message: 'Another FAQ with this question already exists.',
        });
    }

    const faq = await Faq.findOneAndUpdate(
        { _id: faqId, isDeleted: false },
        {
            $set: {
                question,
                answer,
                updatedBy: req.user.id,
            },
        },
        { returnDocument: 'after' }
    );

    if (!faq) {
        return sendResponse({
            res,
            statusCode: httpStatus.NOT_FOUND,
            message: 'FAQ not found.',
        });
    }

    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        data: faq,
        message: 'FAQ updated successfully.',
    });
};

/**
 * List all FAQs (Admin Only)
 * @route GET /api/admin/faqs
 */
export const adminListFaqs = async (req, res) => {
    const { error, value } = adminListFaqsQuerySchema.validate(req.query);
    if (error) {
        return sendResponse({
            res,
            statusCode: httpStatus.BAD_REQUEST,
            message: error.details[0].message,
        });
    }

    const { page, limit, status, search } = value;
    const skip = (page - 1) * limit;

    const query = { isDeleted: false };

    if (status === 1) {
        query.isActive = true;
    } else if (status === 2) {
        query.isActive = false;
    }

    if (search) {
        query.$or = [
            { question: { $regex: search, $options: 'i' } },
            { answer: { $regex: search, $options: 'i' } },
        ];
    }

    const [faqs, count, totalCounts, activeCounts, inactiveCounts] = await Promise.all([
        Faq.find(query)
            .sort({ order: -1 })
            .skip(skip)
            .limit(limit)
            .lean(),
        Faq.countDocuments(query),
        Faq.countDocuments({ isDeleted: false }),
        Faq.countDocuments({ isDeleted: false, isActive: true }),
        Faq.countDocuments({ isDeleted: false, isActive: false }),
    ]);

    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        data: {
            faqs,
            faqCounts: {
                total: totalCounts,
                active: activeCounts,
                inactive: inactiveCounts,
            },
            count,
        },
        message: 'FAQs fetched successfully.',
    });
};

/**
 * Get single FAQ details (Admin Only)
 * @route GET /api/admin/faqs/:faqId
 */
export const adminGetFaqById = async (req, res) => {
    const { error, value } = adminFaqIdSchema.validate(req.params);
    if (error) {
        return sendResponse({
            res,
            statusCode: httpStatus.BAD_REQUEST,
            message: error.details[0].message,
        });
    }

    const faq = await Faq.findOne({ _id: value.faqId, isDeleted: false }).lean();
    if (!faq) {
        return sendResponse({
            res,
            statusCode: httpStatus.NOT_FOUND,
            message: 'FAQ not found.',
        });
    }

    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        data: faq,
        message: 'FAQ details fetched successfully.',
    });
};

/**
 * Soft-delete an FAQ (Admin Only)
 * @route DELETE /api/admin/faqs/:faqId
 */
export const adminDeleteFaq = async (req, res) => {
    const { error, value } = adminFaqIdSchema.validate(req.params);
    if (error) {
        return sendResponse({
            res,
            statusCode: httpStatus.BAD_REQUEST,
            message: error.details[0].message,
        });
    }

    const faq = await Faq.findOneAndUpdate(
        { _id: value.faqId, isDeleted: false },
        {
            $set: {
                isDeleted: true,
                updatedBy: req.user.id,
            },
        },
        { returnDocument: 'after' }
    );

    if (!faq) {
        return sendResponse({
            res,
            statusCode: httpStatus.NOT_FOUND,
            message: 'FAQ not found.',
        });
    }

    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        message: 'FAQ deleted successfully.',
    });
};

/**
 * Toggle active status (Admin Only)
 * @route PATCH /api/admin/faqs/:faqId/status
 */
export const adminUpdateFaqStatus = async (req, res) => {
    const { error, value } = adminFaqIdSchema.validate(req.params);
    if (error) {
        return sendResponse({
            res,
            statusCode: httpStatus.BAD_REQUEST,
            message: error.details[0].message,
        });
    }

    const { faqId } = value;

    const faq = await Faq.findOne({ _id: faqId, isDeleted: false }).select('isActive');
    if (!faq) {
        return sendResponse({
            res,
            statusCode: httpStatus.NOT_FOUND,
            message: 'FAQ not found.',
        });
    }

    const newStatus = !faq.isActive;
    faq.isActive = newStatus;
    faq.updatedBy = req.user.id;
    await faq.save();

    const statusLabel = newStatus ? 'activated' : 'deactivated';

    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        message: `FAQ ${statusLabel} successfully.`,
        data: {
            _id: faq._id,
            isActive: faq.isActive,
            updatedAt: faq.updatedAt,
        },
    });
};

/**
 * Public listing of active FAQs (Users/App)
 * @route GET /api/faqs
 */
export const listActiveFaqs = async (req, res) => {
    const faqs = await Faq.find({ isDeleted: false, isActive: true })
        .sort({ order: -1 })
        .select('question answer category order')
        .lean();

    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        data: {
            data: faqs,
            count: faqs.length,
        },
        message: 'FAQs fetched successfully.',
    });
};

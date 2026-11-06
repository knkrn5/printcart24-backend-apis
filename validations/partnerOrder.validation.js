// validations/partnerOrder.validation.js
import Joi from 'joi';
import { isValidObjectId } from '#utils/generalHelper';

const objectIdValidator = (value, helpers) => {
    if (!isValidObjectId(value)) {
        return helpers.error('any.invalid');
    }
    return value;
};

export const listRiderOrdersQuerySchema = Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(10),
    orderStatus: Joi.alternatives()
        .try(
            Joi.string().trim().uppercase().valid('PROCESSED', 'DISPATCHED', 'DELIVERED', 'FAILED', ''),
            Joi.number().valid(2, 3, 4, 6),
            Joi.string().trim().valid('2', '3', '4', '6'),
        )
        .optional()
        .label('orderStatus')
        .messages({
            'alternatives.match': '"orderStatus" must be one of [PROCESSED, DISPATCHED, DELIVERED, FAILED]',
            'alternatives.types': '"orderStatus" must be one of [PROCESSED, DISPATCHED, DELIVERED, FAILED]',
            'any.only': '"orderStatus" must be one of [PROCESSED, DISPATCHED, DELIVERED, FAILED]',
        }),
    search: Joi.string().trim().allow('').optional(),
});

export const riderDashboardQuerySchema = Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(10),
    search: Joi.string().trim().allow('').optional(),
});

export const getRiderOrderByIdParamsSchema = Joi.object({
    orderId: Joi.string().custom(objectIdValidator, 'ObjectId validation').required().label('Order ID'),
});

export const updateRiderOrderStatusSchema = Joi.object({
    orderStatus: Joi.alternatives()
        .try(
            Joi.string().trim().uppercase().valid('DISPATCHED', 'DELIVERED', 'FAILED'),
            Joi.number().valid(3, 4, 6),
            Joi.string().trim().valid('3', '4', '6'),
        )
        .required()
        .label('Order Status')
        .messages({
            'alternatives.match': '"Order Status" must be one of [DISPATCHED, DELIVERED, FAILED]',
            'alternatives.types': '"Order Status" must be one of [DISPATCHED, DELIVERED, FAILED]',
            'any.only': '"Order Status" must be one of [DISPATCHED, DELIVERED, FAILED]',
            'any.required': '"Order Status" is required',
        }),
    note: Joi.string().trim().allow('').optional(),
    reason: Joi.string().trim().allow('').optional(),
});

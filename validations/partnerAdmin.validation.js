// validations/partnerAdmin.validation.js
import Joi from 'joi';
import { isValidObjectId } from '#utils/generalHelper';

const objectIdValidator = (value, helpers) => {
    if (!isValidObjectId(value)) {
        return helpers.error('any.invalid');
    }
    return value;
};

export const adminListPartnersQuerySchema = Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(10),
    search: Joi.string().trim().allow('').optional(),
    accountStatus: Joi.string().trim().uppercase().valid('ALL', 'PENDING', 'ACTIVE', 'INACTIVE', 'REJECTED').default('ALL'),
    isOnline: Joi.boolean().optional(),
    orderId: Joi.string()
        .trim()
        .allow('')
        .custom((value, helpers) => {
            if (!value) return value;
            return objectIdValidator(value, helpers);
        }, 'ObjectId validation')
        .optional()
        .label('Order ID'),
});

export const adminPartnerParamsSchema = Joi.object({
    partnerId: Joi.string().custom(objectIdValidator, 'ObjectId validation').required().label('Partner ID'),
});

export const adminUpdatePartnerStatusSchema = Joi.object({
    accountStatus: Joi.string().trim().uppercase().valid('PENDING', 'ACTIVE', 'INACTIVE', 'REJECTED').required().label('Account Status'),
});

export const adminOrderParamsSchema = Joi.object({
    orderId: Joi.string().custom(objectIdValidator, 'ObjectId validation').required().label('Order ID'),
});

export const adminAssignOrderPartnerSchema = Joi.object({
    partnerId: Joi.string().custom(objectIdValidator, 'ObjectId validation').required().label('Partner ID'),
});


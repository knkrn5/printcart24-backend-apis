import Joi from 'joi';
import { isValidObjectId } from '#utils/generalHelper';

const objectIdValidator = (value, helpers) => {
    if (!isValidObjectId(value)) {
        return helpers.error('any.invalid');
    }
    return value;
};

// validUntil must be at least tomorrow (start of tomorrow UTC)
const validUntilFutureValidator = (value, helpers) => {
    const startOfTomorrow = new Date();
    startOfTomorrow.setHours(0, 0, 0, 0);
    startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);

    if (value < startOfTomorrow) {
        return helpers.message('"End Date" must be greater than "Start Date".');
    }
    return value;
};

export const adminListCouponsQuerySchema = Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(10),
    status: Joi.number().valid(1, 2).optional().label('Status'),
    search: Joi.string().trim().optional().allow('').label('Search'),
}).unknown(false);

export const adminCouponIdSchema = Joi.object({
    couponId: Joi.string().custom(objectIdValidator, 'ObjectId validation').required().label('Coupon ID'),
});

export const upsertCouponSchema = Joi.object({
    couponId: Joi.string().custom(objectIdValidator, 'ObjectId validation').optional().label('Coupon ID'),
    code: Joi.string()
        .trim()
        .uppercase()
        .alphanum()
        .when('couponId', { is: Joi.exist(), then: Joi.optional(), otherwise: Joi.required() })
        .label('Coupon Code'),
    title: Joi.string()
        .trim()
        .when('couponId', { is: Joi.exist(), then: Joi.optional(), otherwise: Joi.required() })
        .label('Title'),
    description: Joi.string().trim().allow('').optional().label('Description'),
    discountType: Joi.string()
        .valid('FIXED', 'PERCENT', 'FREE_DELIVERY')
        .when('couponId', { is: Joi.exist(), then: Joi.optional(), otherwise: Joi.required() })
        .label('Discount Type'),
    discountValue: Joi.number()
        .min(0)
        .when('couponId', { is: Joi.exist(), then: Joi.optional(), otherwise: Joi.required() })
        .label('Discount Value'),
    maxDiscountAmount: Joi.number().min(0).allow(null).optional().label('Max Discount Amount'),
    minOrderValue: Joi.number().min(0).optional().label('Min Order Value'),
    applicableServiceTypes: Joi.array().items(Joi.string()).optional().label('Applicable Service Types'),
    applicableServices: Joi.array()
        .items(Joi.string().custom(objectIdValidator))
        .optional()
        .label('Applicable Services'),
    firstOrderOnly: Joi.boolean().optional().label('First Order Only'),
    usageLimit: Joi.number().min(1).allow(null).optional().label('Usage Limit'),
    usageLimitPerUser: Joi.number().min(1).optional().label('Usage Limit Per User'),
    validFrom: Joi.date().allow(null).optional().label('Valid From'),
    validUntil: Joi.date().allow(null).optional().custom(validUntilFutureValidator).label('Valid Until'),
    isActive: Joi.boolean().optional().label('Is Active'),
    autoApply: Joi.boolean().optional().label('Auto Apply'),
})
    .min(1)
    .custom((value, helpers) => {
        if (value.validFrom && value.validUntil && value.validFrom >= value.validUntil) {
            return helpers.message('"Start Date" must be before "End Date".');
        }
        return value;
    });

export const applyCouponSchema = Joi.object({
    code: Joi.string().trim().uppercase().required().label('Code'),
});

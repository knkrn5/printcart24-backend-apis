import Joi from 'joi';
import { isValidObjectId } from '#utils/generalHelper';

const objectIdValidator = (value, helpers) => {
    if (!isValidObjectId(value)) {
        return helpers.error('any.invalid');
    }

    return value;
};

export const getOrderByIdParamsSchema = Joi.object({
    orderId: Joi.string().custom(objectIdValidator, 'ObjectId validation').required().label('Order id'),
});

export const listOrdersQuerySchema = Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(10),
    orderStatus: Joi.number().valid(1, 2, 3, 4, 5).optional().label('Order status'),
}).unknown(false);

// ─── Admin Order Validations ────────────────────────────────────────────────

export const adminOrderParamsSchema = Joi.object({
    orderId: Joi.string().custom(objectIdValidator, 'ObjectId validation').required().label('Order id'),
});

export const adminListOrdersQuerySchema = Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(10),
    status: Joi.alternatives()
        .try(
            Joi.number().valid(1, 2, 3, 4, 5, 6, 7),
            Joi.string().valid('RECEIVED', 'PROCESSED', 'DISPATCHED', 'DELIVERED', 'CANCELLED', 'FAILED', 'REATTEMPT'),
        )
        .optional()
        .label('Order status'),
    paymentStatus: Joi.string()
        .trim()
        .uppercase()
        .valid('PENDING', 'INITIATED', 'FAILED', 'PAID', 'REFUNDED')
        .optional()
        .label('Payment status'),
    search: Joi.string().trim().optional().allow('').label('Search'),
    sortBy: Joi.string().valid('createdAt', 'updatedAt', 'orderStatus').default('createdAt').label('Sort by'),
    sortOrder: Joi.string().valid('asc', 'desc').default('desc').label('Sort order'),
}).unknown(false);

export const adminUpdateOrderStatusSchema = Joi.object({
    orderStatus: Joi.number().valid(1, 2, 3, 4, 5, 6, 7).required().label('Order status'),
});

export const verifyPaymentSchema = Joi.object({
    razorpay_payment_id: Joi.string().required().label('Payment ID'),
    razorpay_order_id: Joi.string().required().label('Order ID'),
    razorpay_signature: Joi.string().required().label('Signature'),
}).unknown(false);

export const placeOrderBodySchema = Joi.object({
    deliveryMode: Joi.string().valid('DELIVERY', 'PICKUP').required().label('Delivery mode'),
    addressId: Joi.string()
        .custom(objectIdValidator)
        .when('deliveryMode', {
            is: 'DELIVERY',
            then: Joi.required(),
            otherwise: Joi.optional().allow(null, ''),
        })
        .label('Address ID'),
    couponCode: Joi.string().optional().allow('', null).default('').label('Coupon code'),
});



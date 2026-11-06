// validations/cart.validation.js
import Joi from 'joi';
import { isValidObjectId } from '#utils/generalHelper';

const objectIdValidator = (value, helpers) => {
    if (!isValidObjectId(value)) {
        return helpers.error('any.invalid');
    }

    return value;
};

export const addPrintItemSchema = Joi.object({
    serviceId: Joi.string().hex().length(24).required(),
    documentIds: Joi.array().items(Joi.string().hex().length(24)).min(1).required(),
    // Optional — present only when re-saving a customization for an existing cart item.
    // When provided, the existing cart item is updated in-place instead of adding a new one.
    cartItemId: Joi.string().hex().length(24).optional(),
});

export const addStationeryItemSchema = Joi.object({
    productId: Joi.string().custom(objectIdValidator, 'ObjectId validation').required(),
    quantity: Joi.number().integer().min(0).default(1).optional(),
});

export const updateCartItemCopiesSchema = Joi.object({
    action: Joi.string().valid('increment', 'decrement').required(),
}).unknown(false);


// validations/user.validation.js
import Joi from 'joi';
import { isValidObjectId } from '#utils/generalHelper';

const objectIdValidator = (value, helpers) => {
    if (!isValidObjectId(value)) {
        return helpers.error('any.invalid');
    }
    return value;
};

// ─── Admin User Validations ──────────────────────────────────────────────────

export const adminUserParamsSchema = Joi.object({
    userId: Joi.string().custom(objectIdValidator, 'ObjectId validation').required().label('User id'),
});

export const adminListUsersQuerySchema = Joi.object({
    page: Joi.number().integer().min(1).empty('').default(1),
    limit: Joi.number().integer().min(1).max(100).empty('').default(10),
    search: Joi.string().trim().optional().allow('').label('Search'),
    status: Joi.number().valid(1, 2).empty('').optional().label('Status (1 = active, 2 = inactive)'),
}).unknown(false);



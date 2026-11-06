import Joi from 'joi';
import { isValidObjectId } from '#utils/generalHelper';

const objectIdValidator = (value, helpers) => {
    if (!isValidObjectId(value)) {
        return helpers.error('any.invalid');
    }
    return value;
};

export const adminFaqIdSchema = Joi.object({
    faqId: Joi.string().custom(objectIdValidator, 'ObjectId validation').required().label('FAQ ID'),
});

export const upsertFaqSchema = Joi.object({
    question: Joi.string().trim().required().label('Question'),
    answer: Joi.string().trim().required().label('Answer'),
});

export const adminListFaqsQuerySchema = Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(10),
    status: Joi.number().valid(1, 2).optional().label('Status'), // 1 = Active, 2 = Inactive
    search: Joi.string().trim().optional().allow('').label('Search'),
}).unknown(false);

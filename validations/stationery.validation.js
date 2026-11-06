import Joi from 'joi';
import { isValidObjectId } from '#utils/generalHelper';

const objectIdValidator = (value, helpers) => {
    if (!isValidObjectId(value)) {
        return helpers.error('any.invalid');
    }

    return value;
};

export const listStationeryProductsQuerySchema = Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(10),
    brand: Joi.string().trim().optional().label('Brand'),
    search: Joi.string().trim().optional().allow('').label('Search'),
    minPrice: Joi.number().min(0).optional().label('Minimum price'),
    maxPrice: Joi.number().min(0).optional().label('Maximum price'),
    sortBy: Joi.string().valid('createdAt', 'itemPrice', 'name').default('createdAt').label('Sort by'),
    sortOrder: Joi.string().valid('asc', 'desc').default('desc').label('Sort order'),
}).unknown(false);

export const getStationeryProductParamsSchema = Joi.object({
    productId: Joi.string().custom(objectIdValidator, 'ObjectId validation').required().label('Product id'),
});

export const adminStationeryProductParamsSchema = Joi.object({
    productId: Joi.string().custom(objectIdValidator, 'ObjectId validation').required().label('Product id'),
});

export const adminListStationeryProductsQuerySchema = Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(10),
    status: Joi.number().valid(1, 2).optional().label('Status'),
    search: Joi.string().trim().optional().allow('').label('Search'),
}).unknown(false);

export const upsertStationeryProductSchema = Joi.object({
    productId: Joi.string().custom(objectIdValidator, 'ObjectId validation').optional().label('Product Id'),
    name: Joi.string()
        .trim()
        .when('productId', { is: Joi.exist(), then: Joi.optional(), otherwise: Joi.required() })
        .label('Name'),
    brand: Joi.string().trim().allow('').optional().label('Brand'),
    description: Joi.string().trim().allow('').optional().label('Description'),
    thumbnailUrl: Joi.string().trim().allow('').optional().label('Thumbnail URL'),
    itemPrice: Joi.number()
        .min(0)
        .when('productId', { is: Joi.exist(), then: Joi.optional(), otherwise: Joi.required() })
        .label('Item price'),
    stock: Joi.number().integer().min(0).optional().label('Stock'),
    isActive: Joi.boolean().optional().label('Active status'),
}).min(1);

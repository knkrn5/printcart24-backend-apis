// validations/banner.validation.js
import Joi from 'joi';

const bannerItemSchema = Joi.object({
    s3Url: Joi.string().trim().allow('').required().label('Banner image url'),

    redirectUrl: Joi.string().trim().uri().allow('', null).optional().label('Redirect URL'),

    rank: Joi.number().integer().min(0).optional().label('Rank'),

    isActive: Joi.boolean().optional().label('Banner status'),

    isDeleted: Joi.boolean().optional().label('Delete flag'),
});

export const upsertHomeBannerSchema = Joi.object({
    type: Joi.string().valid('CAROUSEL').required(),

    bannerItem: bannerItemSchema.required(),

    bannerId: Joi.string().optional(), // only for carousel update
});

export const toggleBannerStatusSchema = Joi.object({
    bannerId: Joi.string().hex().length(24).required(),
});

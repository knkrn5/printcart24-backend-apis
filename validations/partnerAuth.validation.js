// validations/partnerAuth.validation.js
import Joi from 'joi';
import { normalizeGender } from '#utils/generalHelper';

const PHONE_REGEX = /^[6-9]\d{9}$/;
const COUNTRY_CODE_REGEX = /^[+][0-9]{1,3}$/;

export const partnerRegisterSchema = Joi.object({
    firstName: Joi.string().trim().required().label('First name'),
    lastName: Joi.string().trim().allow('').optional().label('Last name'),
    email: Joi.string().trim().lowercase().email().required().label('Email').messages({
        'string.email': 'Please enter a valid email address',
    }),
    password: Joi.string().min(8).required().label('Password').messages({
        'string.min': 'Password must be at least 8 characters long',
    }),
    phone: Joi.string().trim().pattern(PHONE_REGEX).optional().label('Phone number').messages({
        'string.pattern.base': 'Please enter a valid 10-digit phone number',
    }),
    countryCode: Joi.string().trim().pattern(COUNTRY_CODE_REGEX).optional().default('+91').label('Country code').messages({
        'string.pattern.base': 'Invalid country code',
    }),
    profilePicture: Joi.string().trim().allow('').optional().label('Profile picture'),
    gender: Joi.string()
        .trim()
        .allow('')
        .custom((value, helpers) => {
            const normalized = normalizeGender(value);
            if (normalized === null) {
                return helpers.error('any.only');
            }
            return normalized;
        })
        .optional()
        .label('Gender')
        .messages({
            'any.only': 'Please select a valid gender',
        }),
});

export const partnerLoginSchema = Joi.object({
    email: Joi.string().trim().lowercase().email().required().label('Email').messages({
        'string.email': 'Please enter a valid email address',
    }),
    password: Joi.string().required().label('Password'),
});

export const updatePartnerProfileSchema = Joi.object({
    firstName: Joi.string().trim().optional().label('First name'),
    lastName: Joi.string().trim().allow('').optional().label('Last name'),
    phone: Joi.string().trim().pattern(PHONE_REGEX).optional().label('Phone number').messages({
        'string.pattern.base': 'Please enter a valid 10-digit phone number',
    }),
    countryCode: Joi.string().trim().pattern(COUNTRY_CODE_REGEX).optional().label('Country code').messages({
        'string.pattern.base': 'Invalid country code',
    }),
    profilePicture: Joi.string().trim().allow('').optional().label('Profile picture'),
    gender: Joi.string()
        .trim()
        .allow('')
        .custom((value, helpers) => {
            const normalized = normalizeGender(value);
            if (normalized === null) {
                return helpers.error('any.only');
            }
            return normalized;
        })
        .optional()
        .label('Gender')
        .messages({
            'any.only': 'Please select a valid gender',
        }),
})
    .min(1)
    .messages({ 'object.min': 'At least one field is required to update profile' });

export const updatePartnerFidSchema = Joi.object({
    fid: Joi.string().trim().required().label('FID token'),
});

export const updatePartnerFcmTokenSchema = Joi.object({
    fcmToken: Joi.string().trim().required().label('FCM token'),
});



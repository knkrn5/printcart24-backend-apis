// validations/auth.validation.js
import { isValidObjectId, normalizeGender } from '#utils/generalHelper';
import Joi from 'joi';
import { ADDRESS_TYPE_VALUES, CITY_SLUG_REGEX, STATE_CODE_REGEX } from '#constants/location';

/**
 * Joi custom validator for Mongo ObjectId using mongoose
 */
const objectIdValidator = (value, helpers) => {
    if (!isValidObjectId(value)) {
        return helpers.error('any.invalid');
    }
    return value;
};

/**
 * Indian mobile (10 digits, starts 6-9, no country code)
 */
const PHONE_REGEX = /^[6-9]\d{9}$/;

/**
 * Country code (+ followed by 1-3 digits)
 */
const COUNTRY_CODE_REGEX = /^[+][0-9]{1,3}$/;

export const sendOtpSchema = Joi.object({
    countryCode: Joi.string().pattern(COUNTRY_CODE_REGEX).required().label('Country code').messages({
        'string.pattern.base': 'Invalid country code',
    }),

    phone: Joi.string().pattern(PHONE_REGEX).required().label('Phone').messages({
        'string.pattern.base': 'Invalid phone number',
    }),
});

// --- Verify OTP ---
export const verifyOtpSchema = Joi.object({
    countryCode: Joi.string().pattern(COUNTRY_CODE_REGEX).required().label('Country code').messages({
        'string.pattern.base': 'Invalid country code',
    }),
    phone: Joi.string().pattern(PHONE_REGEX).required().label('Phone').messages({
        'string.pattern.base': 'Invalid phone number',
    }),
    otp: Joi.string()
        .pattern(/^\d{6}$/)
        .optional()
        .label('OTP')
        .messages({
            'string.pattern.base': 'OTP should be a 6-digit number',
        }),
});

const addressSchema = Joi.object({
    firstName: Joi.string().trim().required().label('First name'),
    lastName: Joi.string().trim().allow('').optional().label('Last name'),
    countryCode: Joi.string().pattern(COUNTRY_CODE_REGEX).required().label('Country code').messages({
        'string.pattern.base': 'Invalid country code',
    }),
    phone: Joi.string().pattern(PHONE_REGEX).required().label('Phone').messages({
        'string.pattern.base': 'Invalid phone number',
    }),
    fullAddress: Joi.string().trim().required().label('Full address'),
    city: Joi.string().trim().allow('').label('City'),
    citySlug: Joi.string().trim().lowercase().pattern(CITY_SLUG_REGEX).required().label('City slug').messages({
        'string.pattern.base': 'Invalid city slug',
    }),
    state: Joi.string().trim().allow('').label('State'),
    stateCode: Joi.string().trim().uppercase().pattern(STATE_CODE_REGEX).required().label('State code').messages({
        'string.pattern.base': 'Invalid state code',
    }),
    pincode: Joi.string().trim().required().label('Pincode'),
    addressType: Joi.string()
        .valid(...ADDRESS_TYPE_VALUES)
        .required()
        .label('Address type'),
    isDefault: Joi.boolean().label('Default address'),
});

export const updateProfileSchema = Joi.object({
    firstName: Joi.string().trim().label('First name'),
    lastName: Joi.string().trim().allow('').label('Last name'),
    email: Joi.string().trim().lowercase().email().allow('').label('Email').messages({
        'string.email': 'Please enter a valid email address',
    }),
    profilePicture: Joi.string().trim().allow('').label('Profile picture'),
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
        .label('Gender')
        .messages({
            'any.only': 'Please select a valid gender',
        }),
    countryCode: Joi.string().pattern(COUNTRY_CODE_REGEX).label('Country code').messages({
        'string.pattern.base': 'Invalid country code',
    }),
    phone: Joi.string().pattern(PHONE_REGEX).label('Phone').messages({
        'string.pattern.base': 'Invalid phone number',
    }),
}).min(1);

export const googleLoginSchema = Joi.object({
    uid: Joi.string().required().label('UID'),
    displayName: Joi.string().allow('').optional().label('Display name'),
    email: Joi.string().email().required().label('Email'),
    phoneNumber: Joi.string().allow('').optional().label('Phone number'),
    photoUrl: Joi.string().allow('').optional().label('Photo URL'),
});

export const appleLoginSchema = Joi.object({
    uid: Joi.string().required().label('UID'),
    displayName: Joi.string().trim().allow('', null).optional().label('Display name'),
    email: Joi.string().trim().lowercase().email().allow('', null).optional().label('Email').messages({
        'string.email': 'Please enter a valid email address',
    }),
    phoneNumber: Joi.string().trim().allow('', null).optional().label('Phone number'),
    photoUrl: Joi.string().trim().allow('', null).optional().label('Photo URL'),
});

export const createAddressSchema = addressSchema;

export const updateAddressSchema = Joi.object({
    firstName: Joi.string().trim().label('First name'),
    lastName: Joi.string().trim().allow('').optional().label('Last name'),
    countryCode: Joi.string().pattern(COUNTRY_CODE_REGEX).label('Country code').messages({
        'string.pattern.base': 'Invalid country code',
    }),
    phone: Joi.string().pattern(PHONE_REGEX).label('Phone').messages({
        'string.pattern.base': 'Invalid phone number',
    }),
    fullAddress: Joi.string().trim().label('Full address'),
    city: Joi.string().trim().allow('').label('City'),
    citySlug: Joi.string().trim().lowercase().pattern(CITY_SLUG_REGEX).label('City slug').messages({
        'string.pattern.base': 'Invalid city slug',
    }),
    state: Joi.string().trim().allow('').label('State'),
    stateCode: Joi.string().trim().uppercase().pattern(STATE_CODE_REGEX).label('State code').messages({
        'string.pattern.base': 'Invalid state code',
    }),
    pincode: Joi.string().trim().label('Pincode'),
    addressType: Joi.string()
        .valid(...ADDRESS_TYPE_VALUES)
        .label('Address type'),
    isDefault: Joi.boolean().label('Default address'),
}).min(1);

export const addressIdParamSchema = Joi.object({
    addressId: Joi.string().custom(objectIdValidator, 'ObjectId validation').required().label('Address id').messages({
        'string.pattern.base': 'Invalid address id',
    }),
});

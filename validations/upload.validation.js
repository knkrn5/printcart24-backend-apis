// validations/upload.validation.js
import Joi from 'joi';
import { FOLDER_NAME_REGEX } from '#constants/upload';

export const uploadBodySchema = Joi.object({
    folderName: Joi.string()
        .trim()
        .pattern(FOLDER_NAME_REGEX)
        .required()
        .label('Folder name')
        .messages({
            'string.pattern.base': 'Folder name must be 1-64 characters and contain only letters, numbers, hyphens, and underscores',
            'any.required': 'folderName is required',
            'string.empty': 'folderName is required',
        }),
}).unknown(true);

export const publicUploadBodySchema = Joi.object({
    folderName: Joi.string()
        .trim()
        .pattern(FOLDER_NAME_REGEX)
        .required()
        .label('Folder name')
        .messages({
            'string.pattern.base': 'Folder name must be 1-64 characters and contain only letters, numbers, hyphens, and underscores',
            'any.required': 'folderName is required',
            'string.empty': 'folderName is required',
        }),
    fileName: Joi.string()
        .trim()
        .optional()
        .allow('', null)
        .label('File name'),
}).unknown(true);

export const presignedUploadBodySchema = Joi.object({
    folderName: Joi.string()
        .trim()
        .pattern(FOLDER_NAME_REGEX)
        .default('assets')
        .optional()
        .label('Folder name')
        .messages({
            'string.pattern.base': 'Folder name must be 1-64 characters and contain only letters, numbers, hyphens, and underscores',
        }),
    fileName: Joi.string()
        .trim()
        .required()
        .label('File name')
        .messages({
            'any.required': 'fileName is required',
            'string.empty': 'fileName cannot be empty',
        }),
    contentType: Joi.string()
        .trim()
        .required()
        .label('Content type')
        .messages({
            'any.required': 'contentType is required',
            'string.empty': 'contentType is required',
        }),
}).required().messages({
    'any.required': 'Request body is required',
});

export const presignedGetBodySchema = Joi.object({
    key: Joi.string()
        .trim()
        .required()
        .max(1024)
        .custom((value, helpers) => {
            const trimmed = value.trim();
            if (trimmed.includes('..')) {
                return helpers.message('Path traversal characters (..) are not allowed in key');
            }
            if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
                try {
                    new URL(trimmed);
                    return trimmed;
                } catch {
                    return helpers.message('Invalid URL format for key');
                }
            }
            if (!/^[a-zA-Z0-9_\-./]+$/.test(trimmed)) {
                return helpers.message('Key contains invalid characters');
            }
            return trimmed;
        })
        .label('S3 key')
        .messages({
            'any.required': 'S3 key is required',
            'string.empty': 'S3 key cannot be empty',
        }),
    expiresIn: Joi.number()
        .integer()
        .min(60)
        .max(604800)
        .default(900)
        .optional()
        .label('Expiration seconds')
        .messages({
            'number.min': 'expiresIn must be at least 60 seconds (1 minute)',
            'number.max': 'expiresIn cannot exceed 604800 seconds (7 days)',
        }),
}).required().messages({
    'any.required': 'Request body is required',
});



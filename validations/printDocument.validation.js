// validations/printDocument.validation.js
import Joi from 'joi';

const optionSelectionJoiSchema = Joi.object({
    optionId: Joi.number().required(),
    subOptionId: Joi.number().allow(null, 'null').optional(),
});

const documentCustomizationSchema = Joi.object({
    copies: Joi.number().min(1).default(1),
    orientation: Joi.string().allow('', null).optional(),
    paperSize: Joi.string().allow('', null).optional(),
    colorMode: Joi.string().allow('', null).optional(),
    sideMode: Joi.string().allow('', null).optional(),
    paperQuality: Joi.string().allow('', null).optional(),
    bindingSelections: Joi.array().items(optionSelectionJoiSchema).default([]),
    selectedBindingColorCode: Joi.string().allow('', null).optional(),
    bookletOptionCodes: Joi.string().allow('', null).optional(),
    notes: Joi.string().allow('', null).optional(),
});

// Only these protocols are accepted for file URLs.
const ALLOWED_FILE_URL_PROTOCOLS = new Set(['https:', 'http:']);

// Regex for validating an S3 key:
// Standard S3 key: 1 to 1024 chars, no leading slash, allowed characters, no '..' traversal, valid extension
const S3_KEY_REGEX = /^[a-zA-Z0-9_\-./]+$/;

export const sanitizeUrl = (value, helpers) => {
    if (!value) return value;
    const trimmed = typeof value === 'string' ? value.trim() : '';
    if (!trimmed) {
        return helpers ? helpers.error('any.invalid') : null;
    }

    // 1. If it starts with http:// or https://, validate and normalize as an HTTP(S) URL
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
        try {
            const parsed = new URL(trimmed);

            if (!ALLOWED_FILE_URL_PROTOCOLS.has(parsed.protocol)) {
                return helpers ? helpers.error('string.uri') : null;
            }

            // Normalize literal square brackets [ and ] strictly within the URL pathname segment
            if (parsed.pathname.includes('[') || parsed.pathname.includes(']')) {
                parsed.pathname = parsed.pathname.replace(/\[/g, '%5B').replace(/\]/g, '%5D');
            }

            return parsed.toString();
        } catch {
            return helpers ? helpers.error('string.uri') : null;
        }
    }

    // 2. Explicitly reject forbidden URL schemes like javascript:, data:, file:, ftp:, etc.
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
        return helpers ? helpers.error('string.uri') : null;
    }

    // 3. Otherwise validate as an S3 object key
    if (trimmed.length > 1024 || trimmed.startsWith('/') || trimmed.includes('..')) {
        return helpers ? helpers.error('any.invalid') : null;
    }

    if (!S3_KEY_REGEX.test(trimmed)) {
        return helpers ? helpers.error('any.invalid') : null;
    }

    if (!/\.[a-zA-Z0-9]+$/.test(trimmed)) {
        return helpers ? helpers.error('any.invalid') : null;
    }

    return trimmed;
};

const singleDocumentSchema = Joi.object({
    fileExtension: Joi.string().allow('', null).trim().optional(),
    mimeType: Joi.string().trim().optional(),
    fileSizeBytes: Joi.number().min(0).allow('', null).optional(),
    pageCount: Joi.number().min(0).optional(),
    fileUrl: Joi.string().custom(sanitizeUrl).required().label('File url'),
    service: Joi.string().hex().length(24).allow(null, '').optional(),
    customization: documentCustomizationSchema.default({}),
});

export const createDocumentSchema = singleDocumentSchema;

export const batchCreateDocumentsSchema = Joi.object({
    serviceId: Joi.string().hex().length(24).allow(null, '').optional(),
    documents: Joi.array()
        .items(
            singleDocumentSchema.keys({
                clientDocumentKey: Joi.string().trim().allow('', null).optional(),
            }),
        )
        .min(1)
        .required()
        .messages({
            'array.min': 'Upload at least 1 doc to proceed to customization',
        }),
});

export const updateDocumentCustomizationSchema = Joi.object({
    copies: Joi.number().min(1).optional(),
    orientation: Joi.string().allow('', null).optional(),
    paperSize: Joi.string().allow('', null).optional(),
    colorMode: Joi.string().allow('', null).optional(),
    sideMode: Joi.string().allow('', null).optional(),
    paperQuality: Joi.string().allow('', null).optional(),
    bindingSelections: Joi.array().items(optionSelectionJoiSchema).optional(),
    selectedBindingColorCode: Joi.string().allow('', null).optional(),
    bookletOptionCodes: Joi.string().allow('', null).optional(),
    notes: Joi.string().allow('', null).optional(),
}).min(1);

const getActiveOptionCodes = (options = []) =>
    options
        .filter((option) => option?.isActive !== false)
        .map((option) => String(option.code || '').trim())
        .filter(Boolean);

const getToggleId = (toggle) => {
    if (!toggle) return null;
    const val = toggle.get ? toggle.get('id') : toggle.id;
    return val !== undefined && val !== null ? val : null;
};

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

const buildAllowedOptionsMessage = (field, allowedCodes = []) =>
    allowedCodes.length > 0
        ? `${field} supports only these options: ${allowedCodes.join(', ')}`
        : `${field} is not supported for this print service`;

export const validateDocumentCustomizationAgainstService = ({ customization = {}, service = null }) => {
    if (!service) {
        return 'Print service not found for this document';
    }

    const supportedCodeFields = [
        ['orientation', getActiveOptionCodes(service.supportedOrientations)],
        ['paperSize', getActiveOptionCodes(service.supportedPaperSizes)],
        ['colorMode', getActiveOptionCodes(service.supportedColorModes)],
        ['sideMode', getActiveOptionCodes(service.supportedSideModes)],
        ['paperQuality', getActiveOptionCodes(service.supportedPaperQualities)],
        [
            'selectedBindingCode',
            getActiveOptionCodes(service.bindingConfiguration?.options || service.bindingOptions || []),
        ],
        ['selectedBindingColorCode', getActiveOptionCodes(service.supportedBindingColors || [])],
    ];

    for (const [field, allowedCodes] of supportedCodeFields) {
        if (!hasOwn(customization, field)) continue;

        const value = String(customization[field] || '').trim();
        if (!value) continue;

        if (!allowedCodes.includes(value)) {
            customization[field] = '';
        }
    }

    if (hasOwn(customization, 'bookletOptionCodes')) {
        const rawValue = customization.bookletOptionCodes;
        const requestedCodes = Array.isArray(rawValue)
            ? rawValue
            : String(rawValue || '')
                  .split(',')
                  .map((entry) => entry.trim())
                  .filter(Boolean);
        const allowedCodes = getActiveOptionCodes(service.bookletOptions || []);

        const invalidCode = requestedCodes.find((code) => !allowedCodes.includes(code));
        if (invalidCode) {
            return buildAllowedOptionsMessage('bookletOptionCodes', allowedCodes);
        }
    }

    const copiesConfig = service.copiesConfig || {};
    if (hasOwn(customization, 'copies')) {
        const copies = Number(customization.copies) || 0;
        const minCopies = Number(copiesConfig.min) || 1;
        const maxCopies = copiesConfig.max ? Number(copiesConfig.max) : null;

        if (copies < minCopies || (maxCopies !== null && copies > maxCopies)) {
            return maxCopies !== null
                ? `copies must be between ${minCopies} and ${maxCopies} for this print service`
                : `copies must be at least ${minCopies} for this print service`;
        }
    }

    if (hasOwn(customization, 'bindingSelections')) {
        const selections = customization.bindingSelections || [];
        const toggles = service.bindingConfiguration?.toggles || [];

        for (const selection of selections) {
            const toggle = toggles.find((t) => getToggleId(t) === selection.optionId && t.isActive !== false);
            if (!toggle) {
                return `Option ID ${selection.optionId} is not supported for this print service`;
            }

            if (toggle.hasSubOptions) {
                const isPageSlab = toggle.subOptions?.some((so) => so.minPages !== null || so.maxPages !== null);

                if (!isPageSlab) {
                    if (selection.subOptionId === undefined || selection.subOptionId === null) {
                        return `subOptionId is required for option ID ${selection.optionId}`;
                    }
                    const subOption = (toggle.subOptions || []).find(
                        (so) => getToggleId(so) === selection.subOptionId && so.isActive !== false,
                    );
                    if (!subOption) {
                        return `subOptionId ${selection.subOptionId} is not valid for option ID ${selection.optionId}`;
                    }
                }
            }
        }
    }

    return null;
};

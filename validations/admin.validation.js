// validations/admin.validation.js
import Joi from 'joi';

export const adminLoginSchema = Joi.object({
    email: Joi.string().email().required().label('Email'),
    password: Joi.string().required().label('Password'),
});

export const updateAdminProfileSchema = Joi.object({
    fullName: Joi.string().trim().optional().label('Full name'),
    phone: Joi.string().trim().optional().label('Phone'),
    email: Joi.string()
        .pattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/) // allow valid email formats e.g. johndoe@me.com
        .trim()
        .lowercase()
        .email()
        .optional()
        .label('Email'),
    profilePicture: Joi.string().trim().optional().allow('').label('Profile picture'),
})
    .min(1)
    .messages({ 'object.min': 'At least one field is required' }); // At least one field required

export const changePasswordSchema = Joi.object({
    oldPassword: Joi.string().required().label('Old password'),
    newPassword: Joi.string().min(6).required().label('New password'),
});

const pricingRowSchema = Joi.object({
    group: Joi.string()
        .valid(
            'COLOR_MODE',
            'PAPER_SIZE',
            'PAPER_QUALITY',
            'ORIENTATION',
            'SIDE_MODE',
            'BINDING_TOGGLE',
            'BINDING_OPTION',
            'BOOKLET_OPTION',
        )
        .required(),
    code: Joi.string().trim().uppercase().required(),
    label: Joi.string().trim().required(),
    calculationType: Joi.string()
        .valid('FLAT', 'PER_PAGE', 'PER_COPY', 'PER_SHEET', 'PER_ITEM', 'PER_DOCUMENT', 'PER_100_PAGES')
        .required(),
    unitPrice: Joi.number().min(0).required(),
    minPages: Joi.number().min(0).allow(null).default(null),
    maxPages: Joi.number().min(0).allow(null).default(null),
    slabSize: Joi.number().min(1).allow(null).default(null),
    isTaxable: Joi.boolean().default(true),
    isActive: Joi.boolean().default(true),
});

export const upsertPrintServicePricingSchema = Joi.object({
    currency: Joi.string().trim().uppercase().length(3).default('INR'),
    basePricing: Joi.object({
        calculationType: Joi.string()
            .valid('FLAT', 'PER_PAGE', 'PER_COPY', 'PER_SHEET', 'PER_ITEM', 'PER_DOCUMENT', 'PER_100_PAGES')
            .required(),
        unitPrice: Joi.number().min(0).required(),
        isTaxable: Joi.boolean().default(true),
        isActive: Joi.boolean().default(true),
    }).required(),
    optionPricing: Joi.array().items(pricingRowSchema).default([]),
});

// Accepts the same {code, label} shape the GET .../customizations response returns for
// each combination dimension — `label` (and any other field a client echoes back, e.g.
// isDefault/colorModeFilter) is accepted but never used; only `code` is read downstream.
const comboDimensionSchema = Joi.object({
    code: Joi.string().trim().uppercase().required(),
    label: Joi.string().trim().optional(),
}).unknown(true);

// Each combo dimension is optional at the schema level since different services use
// different subsets (Document Printing: colorMode+paperSize+paperQuality; Certificate:
// colorMode+pageBucket; Poster Printing: paperQuality+paperSize; Thesis Printing:
// colorMode+sideMode) — the controller enforces which ones are actually required for
// the specific service being updated.
const combinationRowSchema = Joi.object({
    colorMode: comboDimensionSchema.optional(),
    paperSize: comboDimensionSchema.optional(),
    paperQuality: comboDimensionSchema.optional(),
    sideMode: comboDimensionSchema.optional(),
    pageBucket: comboDimensionSchema.optional(),
    price: Joi.number().min(0).required(),
}).unknown(true);

// Top-level .unknown(true) so the UI can send back the full GET .../customizations
// response verbatim (e.g. its "service" key) without having to strip anything first —
// matches the GET/PUT symmetry design; only combinationPricing/bindingConfiguration
// are actually read.
export const updateCombinationPricingSchema = Joi.object({
    // Both allow(null) so a service whose GET response has "combinationPricing": null
    // (a non-combo service) can be sent back verbatim without a validation crash — the
    // controller gives a clearer "not supported for this service" message in that case
    // instead of a raw schema error.
    gstPercentage: Joi.number().min(0).max(100).optional(),
    combinationPricing: Joi.object({
        combinations: Joi.array().items(combinationRowSchema).min(1).required(),
    })
        .allow(null)
        .optional(),
    bindingConfiguration: Joi.object({
        toggles: Joi.array(),
    })
        .allow(null)
        .optional(),
})
    .unknown(true)
    .or('combinationPricing', 'bindingConfiguration', 'gstPercentage')
    .messages({ 'object.missing': 'At least one of combinationPricing, bindingConfiguration, or gstPercentage is required' });

const sharedBindingToggleSubOptionSchema = Joi.object({
    code: Joi.string().trim().uppercase().required(),
    price: Joi.number().min(0).required(),
}).unknown(true);

const sharedBindingToggleSchema = Joi.object({
    code: Joi.string().trim().uppercase().required(),
    price: Joi.number().min(0).optional(),
    subOptions: Joi.array().items(sharedBindingToggleSubOptionSchema).optional(),
}).unknown(true);

// Same GET/PUT symmetry as updateCombinationPricingSchema — accepts what
// GET /print-services/binding-toggles returns, edited, sent back verbatim.
export const updateSharedBindingTogglePricingSchema = Joi.object({
    toggles: Joi.array().items(sharedBindingToggleSchema).min(1).required(),
}).unknown(true);

export const updatePricingSettingsSchema = Joi.object({
    platformFee: Joi.number().min(0).required(),
    deliveryFee: Joi.number().min(0).required(),
    gstPercentage: Joi.number().min(0).max(100).required(),
    sameDayRepeatDiscountPercentage: Joi.number().min(0).max(100).required(),
}).unknown(true);


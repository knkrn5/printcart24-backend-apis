// scripts/printServiceCatalog.data.js

// ─────────────────────────────────────────────────────────────────────────────
// BUSINESS RULE (2026-06-03): All formats allowed across all print services.
// To revert a specific service back to its original restricted list, replace
// ALL_ALLOWED_MIME_TYPES with the original array shown in the comment above
// that service's allowedMimeTypes line, then run: npm run print-services:seed
// ─────────────────────────────────────────────────────────────────────────────
export const ALL_ALLOWED_MIME_TYPES = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.oasis.opendocument.text',
    'application/vnd.oasis.opendocument.spreadsheet',
    'application/vnd.oasis.opendocument.presentation',
    'application/rtf',
    'text/rtf',
    'text/plain',
    'text/csv',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/bmp',
    'image/tiff',
    'image/svg+xml',
];

// ─────────────────────────────────────────────────────────────────────────────
// BUSINESS RULE (2026-06-03): No per-file page cap for services that previously
// enforced maxPagesPerFile: 1. To revert, replace MAX_PAGES_UNLIMITED with 1
// on the affected service and re-run: npm run print-services:seed
// ─────────────────────────────────────────────────────────────────────────────
const MAX_PAGES_UNLIMITED = null; // was: 1
const createOption = (code, label, overrides = {}) => ({
    code,
    label,
    description: '',
    sortOrder: 0,
    isDefault: false,
    isActive: true,
    ...overrides,
});

const createBindingOption = (code, label, overrides = {}) => ({
    code,
    label,
    description: '',
    pricingModel: 'FLAT',
    unitPrice: 0,
    minPages: 0,
    maxPages: null,
    isDefault: false,
    isRecommended: false,
    isActive: true,
    ...overrides,
});

const createPricingRule = (group, code, label, calculationType, amount, overrides = {}) => ({
    group,
    code,
    label,
    calculationType,
    amount,
    isTaxable: true,
    isOptional: true,
    isActive: true,
    ...overrides,
});

const baseColorModes = [
    createOption('BW', 'Black & White', { isDefault: true, sortOrder: 1 }),
    createOption('COLOR', 'Color', { sortOrder: 2 }),
];

const bindingColorOptions = [
    createOption('BLACK', 'Black', { isDefault: true, sortOrder: 1 }),
    createOption('MAROON', 'Maroon', { sortOrder: 2 }),
    createOption('BLUE', 'Blue', { sortOrder: 3 }),
    createOption('GREEN', 'Green', { sortOrder: 4 }),
    createOption('RED', 'Red', { sortOrder: 5 }),
];

const basePaperSizes = [
    createOption('A4', 'A4', { isDefault: true, sortOrder: 1 }),
    createOption('A3', 'A3', { sortOrder: 2 }),
    createOption('A2', 'A2 Poster Size', { sortOrder: 3 }),
    createOption('A1', 'A1 Poster Size', { sortOrder: 4 }),
    createOption('A0', 'A0 Poster Size', { sortOrder: 5 }),
];

const basePaperQualities = [];

const documentPaperQualityOptions = [
    createOption('STANDARD_70_75_GSM', '70-75 GSM', { isDefault: true, sortOrder: 1 }),
    createOption('SPECIAL_100_GSM', 'Special Paper (100 GSM)', { sortOrder: 2 }),
];

const posterPaperQualityOptions = [
    createOption('POSTER_STANDARD', 'Normal Sheet', { isDefault: true, sortOrder: 1, colorModeFilter: ['BW'] }),
    createOption('GLOSSY', 'Glossy', { sortOrder: 2, colorModeFilter: ['COLOR'] }),
    createOption('FABRIC', 'Fabric Poster', { sortOrder: 3, colorModeFilter: ['COLOR'] }),
];

const thesisPaperQualityOptions = [
    createOption('SPECIAL_100_GSM', 'Special Paper (100 GSM)', { isDefault: true, sortOrder: 1 }),
    createOption('BOND_100_GSM', 'Bond Paper (100 GSM)', { sortOrder: 2 }),
];

const digitalPrintingPaperQualityOptions = [
    createOption('70_75_GSM', '70-75 GSM', { isDefault: true, sortOrder: 1, colorModeFilter: ['BW'] }),
    createOption('100_GSM', '100 GSM', { sortOrder: 2, colorModeFilter: ['COLOR'] }),
];

const photoPrintingPaperQualityOptions = [
    createOption('300_GSM_ART_CARD', '300 GSM Art Card', { isDefault: true, sortOrder: 1 }),
];

const certificatePaperQualityOptions = [
    createOption('MATT_SHEET_250_GSM', 'Matt Sheet(250GSM)', { isDefault: true, sortOrder: 1 }),
];

const baseOrientations = [
    createOption('PORTRAIT', 'Portrait', { isDefault: true, sortOrder: 1 }),
    createOption('LANDSCAPE', 'Landscape', { sortOrder: 2 }),
];

const baseSideModes = [
    createOption('SINGLE', 'Single Sided', { isDefault: true, sortOrder: 1 }),
    createOption('DOUBLE', 'Double Sided', { sortOrder: 2 }),
];

const bindingToggles = [
    createOption('STAPLING', 'Stapling', {
        id: 1,
        description: 'Pages are stapled together for simple documents.',
        price: 0,
        hasSubOptions: true,
        subOptions: [
            { id: 1, code: 'STAPLING_SLAB_1', label: 'Upto 100 pages', price: 0.8, minPages: 0, maxPages: 100 },
            { id: 2, code: 'STAPLING_SLAB_2', label: 'Above 100 pages', price: 1.0, minPages: 101, maxPages: null },
        ],
        sortOrder: 1,
    }),
    createOption('STICK_BINDING', 'Stick File (Max. 30 pages)', {
        id: 2,
        description: 'Pages are glued at the spine for a clean book-style finish.',
        price: 25,
        hasSubOptions: false,
        subOptions: [],
        sortOrder: 2,
    }),
    createOption('SPIRAL_BINDING', 'Spiral Binding', {
        id: 3,
        description: 'Pages are bound with a spiral coil for easy page turning.',
        price: 0,
        hasSubOptions: true,
        subOptions: [
            { id: 1, code: 'SPIRAL_SLAB_1', label: 'Upto 100 pages', price: 30, minPages: 0, maxPages: 100 },
            { id: 2, code: 'SPIRAL_SLAB_2', label: 'Above 100 pages', price: 60, minPages: 101, maxPages: null },
        ],
        sortOrder: 3,
    }),
    createOption('LANGUAGE', 'Language', {
        id: 4,
        description: 'Select text printing language.',
        price: 0,
        hasSubOptions: true,
        subOptions: [
            { id: 1, code: 'LANG_ENGLISH', label: 'English', price: 500, minPages: null, maxPages: null },
            { id: 2, code: 'LANG_HINDI', label: 'Hindi', price: 1200, minPages: null, maxPages: null },
        ],
        sortOrder: 4,
    }),
    createOption('DIGITAL_BINDING', 'Gold and Silver Embossed Binding', {
        id: 5,
        description: 'Premium digital binding finish.',
        price: 350,
        hasSubOptions: false,
        subOptions: [],
        sortOrder: 5,
    }),
    createOption('LAMINATION_BINDING', 'Lamination Binding', {
        id: 6,
        description: 'Lamination of the cover sheet.',
        price: 400,
        hasSubOptions: false,
        subOptions: [],
        sortOrder: 6,
    }),
    createOption('SUMMARY_SYNOPSIS_ABSTRACT_BINDING', 'Summary, Synopsis, Abstract Binding', {
        id: 7,
        description: 'Specialized binding for summary, synopsis or abstract papers.',
        price: 0,
        hasSubOptions: true,
        subOptions: [
            { id: 1, code: 'SUMMARY_TAPE', label: 'Tape Binding', price: 40, minPages: null, maxPages: null },
            { id: 2, code: 'SUMMARY_SPIRAL', label: 'Spiral Binding', price: 35, minPages: null, maxPages: null },
        ],
        sortOrder: 7,
    }),
];

// Codes allowed for non-thesis services — single source of truth
const LIMITED_BINDING_TOGGLE_CODES = ['STAPLING', 'STICK_BINDING', 'SPIRAL_BINDING'];
// Derived by filtering bindingToggles so labels/prices stay in sync automatically
const limitedBindingToggles = bindingToggles.filter((t) => LIMITED_BINDING_TOGGLE_CODES.includes(t.code));

// Codes allowed for Thesis Binding only (options 4–7)
const THESIS_BINDING_TOGGLE_CODES = [
    'LANGUAGE',
    'DIGITAL_BINDING',
    'LAMINATION_BINDING',
    'SUMMARY_SYNOPSIS_ABSTRACT_BINDING',
];
const thesisBindingToggles = bindingToggles.filter((t) => THESIS_BINDING_TOGGLE_CODES.includes(t.code));

const bindingOptions = [];

const bookletOptions = [
    createOption('COVER_PAGE', 'Cover Page', { sortOrder: 1 }),
    createOption('TRANSPARENT_FRONT_COVER', 'Transparent Front Cover', { sortOrder: 2 }),
    createOption('CUSTOM_COVER_PRINT', 'Custom Cover Print', { sortOrder: 3 }),
    createOption('LAMINATION', 'Lamination', { sortOrder: 4 }),
];

const commonPricingRules = [
    createPricingRule('COLOR_MODE', 'BW', 'Black & White', 'PER_PAGE', 0),
    createPricingRule('COLOR_MODE', 'COLOR', 'Color', 'PER_PAGE', 5),
    createPricingRule('PAPER_SIZE', 'A4', 'A4', 'PER_PAGE', 0),
    createPricingRule('PAPER_SIZE', 'A3', 'A3', 'PER_PAGE', 4),
    createPricingRule('PAPER_SIZE', 'A2', 'A2 Poster Size', 'PER_PAGE', 80),
    createPricingRule('PAPER_SIZE', 'A1', 'A1 Poster Size', 'PER_PAGE', 150),
    createPricingRule('PAPER_SIZE', 'A0', 'A0 Poster Size', 'PER_PAGE', 250),

    createPricingRule('ORIENTATION', 'PORTRAIT', 'Portrait', 'FLAT', 0),
    createPricingRule('ORIENTATION', 'LANDSCAPE', 'Landscape', 'FLAT', 0),
    createPricingRule('SIDE_MODE', 'SINGLE', 'Single Sided', 'PER_PAGE', 0),
    createPricingRule('SIDE_MODE', 'DOUBLE', 'Double Sided', 'PER_PAGE', 1),
    createPricingRule('BINDING_TOGGLE', 'STAPLING', 'Stapling', 'FLAT', 5),
    createPricingRule('BINDING_TOGGLE', 'STICK_BINDING', 'Stick Binding', 'FLAT', 25),
    createPricingRule('BINDING_TOGGLE', 'SPIRAL_BINDING', 'Spiral Binding', 'FLAT', 35),
    createPricingRule('BOOKLET_OPTION', 'COVER_PAGE', 'Cover Page', 'FLAT', 10),
    createPricingRule('BOOKLET_OPTION', 'TRANSPARENT_FRONT_COVER', 'Transparent Front Cover', 'FLAT', 15),
    createPricingRule('BOOKLET_OPTION', 'CUSTOM_COVER_PRINT', 'Custom Cover Print', 'FLAT', 20),
    createPricingRule('BOOKLET_OPTION', 'LAMINATION', 'Lamination', 'PER_PAGE', 30),
];

const bindingOptionPricing = bindingOptions.map((option) =>
    createPricingRule(
        'BINDING_OPTION',
        option.code,
        option.label,
        option.pricingModel === 'PER_100_PAGES' ? 'PER_100_PAGES' : option.pricingModel,
        option.unitPrice,
        {
            minPages: option.minPages,
            maxPages: option.maxPages,
            slabSize: option.pricingModel === 'PER_100_PAGES' ? 100 : null,
            isActive: option.isActive,
        },
    ),
);

const baseCustomizationConfig = {
    supportedOrientations: baseOrientations,
    supportedPaperSizes: basePaperSizes,
    supportedColorModes: baseColorModes,
    supportedSideModes: baseSideModes,
    supportedPaperQualities: [],
    copiesConfig: {
        min: 1,
        max: 500,
        default: 1,
    },
    bindingConfiguration: {
        toggles: bindingToggles,
        options: bindingOptions,
    },
    bookletOptions,
    bindingOptions,
    supportedAddOns: [],
    pricingRules: [...commonPricingRules, ...bindingOptionPricing],
};

// Specialized custom configs to avoid inappropriate options for specific services
const documentCustomizationConfig = {
    supportedOrientations: baseOrientations,
    supportedPaperSizes: [
        createOption('A4', 'A4', { isDefault: true, sortOrder: 1 }),
        createOption('A3', 'A3', { sortOrder: 2 }),
    ],
    supportedColorModes: baseColorModes,
    supportedSideModes: baseSideModes,
    supportedPaperQualities: [], // No paper quality for digital-printing
    copiesConfig: {
        min: 1,
        max: 500,
        default: 1,
    },
    bindingConfiguration: {
        toggles: limitedBindingToggles,
        options: bindingOptions,
    },
    bookletOptions,
    bindingOptions,
    supportedAddOns: [],
    pricingRules: [...commonPricingRules, ...bindingOptionPricing],
};

const photoCustomizationConfig = {
    supportedOrientations: baseOrientations,
    supportedPaperSizes: [createOption('A4', 'A4', { isDefault: true, sortOrder: 1 })],
    supportedColorModes: [
        createOption('COLOR', 'Color', { isDefault: true, sortOrder: 1 }),
        createOption('BW', 'Black & White', { sortOrder: 2 }),
    ],
    supportedSideModes: [createOption('SINGLE', 'Single Sided', { isDefault: true, sortOrder: 1 })],
    supportedPaperQualities: photoPrintingPaperQualityOptions,
    copiesConfig: {
        min: 1,
        max: 500,
        default: 1,
    },
    bindingConfiguration: {
        toggles: limitedBindingToggles,
        options: bindingOptions,
    },
    bookletOptions: [],
    bindingOptions,
    supportedAddOns: [],
    pricingRules: [
        createPricingRule('COLOR_MODE', 'COLOR', 'Color', 'PER_PAGE', 0),
        createPricingRule('COLOR_MODE', 'BW', 'Black & White', 'PER_PAGE', 0),
        createPricingRule('PAPER_SIZE', 'A4', 'A4', 'PER_PAGE', 0),
        createPricingRule('SIDE_MODE', 'SINGLE', 'Single Sided', 'PER_PAGE', 0),
        createPricingRule('ORIENTATION', 'PORTRAIT', 'Portrait', 'FLAT', 0),
        createPricingRule('ORIENTATION', 'LANDSCAPE', 'Landscape', 'FLAT', 0),
    ],
};

const certificateCustomizationConfig = {
    supportedOrientations: baseOrientations,
    supportedPaperSizes: [createOption('A4', 'A4', { isDefault: true, sortOrder: 1 })],
    supportedColorModes: [
        createOption('COLOR', 'Color', { isDefault: true, sortOrder: 1 }),
        createOption('BW', 'Black & White', { sortOrder: 2 }),
    ],
    supportedSideModes: [createOption('SINGLE', 'Single Sided', { isDefault: true, sortOrder: 1 })],
    supportedPaperQualities: certificatePaperQualityOptions,
    copiesConfig: {
        min: 1,
        max: 500,
        default: 1,
    },
    bindingConfiguration: {
        toggles: limitedBindingToggles,
        options: bindingOptions,
    },
    bookletOptions: [],
    bindingOptions,
    supportedAddOns: [],
    pricingRules: [
        createPricingRule('COLOR_MODE', 'COLOR', 'Color', 'PER_PAGE', 0),
        createPricingRule('COLOR_MODE', 'BW', 'Black & White', 'PER_PAGE', 0),
        createPricingRule('PAPER_SIZE', 'A4', 'A4', 'PER_PAGE', 0),
        createPricingRule('SIDE_MODE', 'SINGLE', 'Single Sided', 'PER_PAGE', 0),
        createPricingRule('ORIENTATION', 'PORTRAIT', 'Portrait', 'FLAT', 0),
        createPricingRule('ORIENTATION', 'LANDSCAPE', 'Landscape', 'FLAT', 0),
    ],
};

const plagiarismCustomizationConfig = {
    supportedOrientations: baseOrientations,
    supportedPaperSizes: [createOption('A4', 'A4', { isDefault: true, sortOrder: 1 })],
    supportedColorModes: baseColorModes,
    supportedSideModes: baseSideModes,
    supportedPaperQualities: [],
    copiesConfig: {
        min: 1,
        max: 500,
        default: 1,
    },
    bindingConfiguration: {
        toggles: [],
        options: [],
    },
    bookletOptions: [],
    bindingOptions: [],
    supportedAddOns: [],
    pricingRules: [
        createPricingRule('COLOR_MODE', 'BW', 'Black & White', 'PER_PAGE', 0),
        createPricingRule('COLOR_MODE', 'COLOR', 'Color', 'PER_PAGE', 5),
        createPricingRule('PAPER_SIZE', 'A4', 'A4', 'PER_PAGE', 0),
        createPricingRule('ORIENTATION', 'PORTRAIT', 'Portrait', 'FLAT', 0),
        createPricingRule('ORIENTATION', 'LANDSCAPE', 'Landscape', 'FLAT', 0),
        createPricingRule('SIDE_MODE', 'SINGLE', 'Single Sided', 'PER_PAGE', 0),
        createPricingRule('SIDE_MODE', 'DOUBLE', 'Double Sided', 'PER_PAGE', 1),
    ],
};

const posterCustomizationConfig = {
    supportedOrientations: baseOrientations,
    supportedPaperSizes: [
        createOption('A2', 'A2 Poster Size', { isDefault: true, sortOrder: 1 }),
        createOption('A1', 'A1 Poster Size', { sortOrder: 2 }),
        createOption('A0', 'A0 Poster Size', { sortOrder: 3 }),
    ],
    supportedColorModes: [
        createOption('COLOR', 'Color', { isDefault: true, sortOrder: 1 }),
        createOption('BW', 'Black & White', { sortOrder: 2 }),
    ],
    supportedSideModes: [createOption('SINGLE', 'Single Sided', { isDefault: true, sortOrder: 1 })],
    supportedPaperQualities: posterPaperQualityOptions,
    copiesConfig: {
        min: 1,
        max: 500,
        default: 1,
    },
    bindingConfiguration: {
        toggles: limitedBindingToggles,
        options: bindingOptions,
    },
    bookletOptions: [],
    bindingOptions,
    supportedAddOns: [],
    pricingRules: [
        createPricingRule('COLOR_MODE', 'COLOR', 'Color', 'PER_PAGE', 0),
        createPricingRule('COLOR_MODE', 'BW', 'Black & White', 'PER_PAGE', 0),
        createPricingRule('ORIENTATION', 'PORTRAIT', 'Portrait', 'FLAT', 0),
        createPricingRule('ORIENTATION', 'LANDSCAPE', 'Landscape', 'FLAT', 0),
        createPricingRule('SIDE_MODE', 'SINGLE', 'Single Sided', 'PER_PAGE', 0),
        createPricingRule('PAPER_SIZE', 'A2', 'A2 Poster Size', 'PER_PAGE', 0),
        createPricingRule('PAPER_SIZE', 'A1', 'A1 Poster Size', 'PER_PAGE', 150),
        createPricingRule('PAPER_SIZE', 'A0', 'A0 Poster Size', 'PER_PAGE', 650),
        createPricingRule('PAPER_QUALITY', 'POSTER_STANDARD', 'Normal Sheet', 'PER_PAGE', 0),
        createPricingRule('PAPER_QUALITY', 'GLOSSY', 'Glossy', 'PER_PAGE', 0),
        createPricingRule('PAPER_QUALITY', 'FABRIC', 'Fabric Poster', 'PER_PAGE', 0),
    ],
};

const thesisCustomizationConfig = {
    supportedOrientations: baseOrientations,
    supportedPaperSizes: [createOption('A4', 'A4', { isDefault: true, sortOrder: 1 })],
    supportedColorModes: baseColorModes,
    supportedSideModes: baseSideModes,
    supportedPaperQualities: [],
    copiesConfig: {
        min: 1,
        max: 500,
        default: 1,
    },
    bindingConfiguration: {
        toggles: bindingToggles,
        options: bindingOptions,
    },
    bookletOptions: [],
    bindingOptions,
    supportedAddOns: [],
    pricingRules: [
        createPricingRule('COLOR_MODE', 'BW', 'Black & White', 'PER_PAGE', 0),
        createPricingRule('COLOR_MODE', 'COLOR', 'Color', 'PER_PAGE', 5),
        createPricingRule('PAPER_SIZE', 'A4', 'A4', 'PER_PAGE', 0),
        createPricingRule('ORIENTATION', 'PORTRAIT', 'Portrait', 'FLAT', 0),
        createPricingRule('ORIENTATION', 'LANDSCAPE', 'Landscape', 'FLAT', 0),
        createPricingRule('SIDE_MODE', 'SINGLE', 'Single Sided', 'PER_PAGE', 0),
        createPricingRule('SIDE_MODE', 'DOUBLE', 'Double Sided', 'PER_PAGE', 1),
        createPricingRule('BINDING_TOGGLE', 'STAPLING', 'Stapling', 'FLAT', 5),
        createPricingRule('BINDING_TOGGLE', 'STICK_BINDING', 'Stick Binding', 'FLAT', 25),
        createPricingRule('BINDING_TOGGLE', 'SPIRAL_BINDING', 'Spiral Binding', 'FLAT', 35),
        ...bindingOptionPricing,
    ],
};

export const printServices = [
    {
        name: 'Document Printing',
        slug: 'document-printing',
        serviceType: 'DOCUMENT_PRINT',
        shortDescription: [
            { points: 'Standard A4/A3 page printing' },
            { points: 'High-contrast text and diagrams' },
            { points: 'Supports both Single and Double-sided pages' },
        ],
        sliderImages: [
            {
                s3Url: 'https://cdn.printcampus.in/printcart24/print-services/image_2_1790141001707.png',
            },
            {
                s3Url: 'https://cdn.printcampus.in/printcart24/print-services/image_3_1790141022560.png',
            },
            {
                s3Url: 'https://cdn.printcampus.in/printcart24/print-services/image_2_1790141043053.png',
            },
        ],
        description: 'High-quality printing for standard documents, perfect for files, projects, and everyday needs.',
        badgeLabel: 'DOC PRINTING',
        bgColor: '#F5FFB1',
        thumbnailUrl: '',
        listImageUrl: 'https://cdn.printcampus.in/printcart24/print-services/documentprinting_1790141099274.png',
        detailImageUrl: 'https://cdn.printcampus.in/printcart24/print-services/documentprinting_1790141099274.png',
        detailDescriptions: [
            'Standard A4/A3 page printing',
            'High-contrast text and diagrams',
            'Supports both Single and Double-sided pages',
        ],
        allowsMultipleFiles: true,
        maxFilesPerItem: 10,
        maxPagesPerFile: 2000,
        // allowedMimeTypes (original): ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
        allowedMimeTypes: ALL_ALLOWED_MIME_TYPES,
        pricingModel: 'PER_PAGE',
        basePrice: 1.5,
        currency: 'INR',
        estimatedDeliveryMinutes: 120,
        supportsDelivery: true,
        supportsPickup: true,
        sortOrder: 1,
        isActive: true,
        deliveryNote: 'We will deliver your order in same day.',
        ...documentCustomizationConfig,
        // BUSINESS RULE: Document Printing paper quality options (digital-printing intentionally excluded)
        supportedPaperQualities: documentPaperQualityOptions,
        pricingRules: [
            ...documentCustomizationConfig.pricingRules,
            createPricingRule('PAPER_QUALITY', 'STANDARD_70_75_GSM', 'Standard Paper (70-75 GSM)', 'PER_PAGE', 0),
            createPricingRule('PAPER_QUALITY', 'SPECIAL_100_GSM', 'Special Paper (100 GSM)', 'PER_PAGE', 0),
        ],
    },
    {
        name: 'Digital Printing',
        slug: 'digital-printing',
        serviceType: 'DOCUMENT_PRINT',
        shortDescription: [
            { points: 'Vibrant color prints' },
            { points: 'Perfect for flyers, marketing assets, and portfolios' },
            { points: 'Heavy-duty paper configurations available' },
        ],
        sliderImages: [
            {
                s3Url: 'https://cdn.printcampus.in/printcart24/print-services/image_2_1790141432169.png',
            },
        ],
        description: 'Vibrant and professional digital prints for presentations, creative sheets, and designs.',
        badgeLabel: 'DIGITAL PRINTING',
        bgColor: '#FFE8AE',
        thumbnailUrl: '',
        listImageUrl: 'https://cdn.printcampus.in/printcart24/print-services/digitalprinting_1790141461514.png',
        detailImageUrl: 'https://cdn.printcampus.in/printcart24/print-services/digitalprinting_1790141461514.png',
        detailDescriptions: [
            'Vibrant color prints',
            'Perfect for flyers, marketing assets, and portfolios',
            'Heavy-duty paper configurations available',
        ],
        allowsMultipleFiles: true,
        maxFilesPerItem: 10,
        maxPagesPerFile: 2000,
        // allowedMimeTypes (original): ['application/pdf', 'image/jpeg', 'image/png']
        allowedMimeTypes: ALL_ALLOWED_MIME_TYPES,
        pricingModel: 'PER_PAGE',
        basePrice: 10,
        currency: 'INR',
        estimatedDeliveryMinutes: 180,
        supportsDelivery: true,
        supportsPickup: true,
        sortOrder: 2,
        isActive: true,
        deliveryNote: 'We will deliver your order in same day.',
        ...documentCustomizationConfig,
        supportedPaperQualities: digitalPrintingPaperQualityOptions,
    },
    {
        name: 'Photo Printing',
        slug: 'photo-printing',
        serviceType: 'PHOTO_FRAME',
        shortDescription: [
            { points: 'High-resolution glossy photo prints' },
            { points: 'Ideal for picture frames and albums' },
            { points: 'Accurate color grading' },
        ],
        sliderImages: [
            {
                s3Url: 'https://appsinvo-stag-dev.s3.ap-south-1.amazonaws.com/printcart24/images/print-slider/image_(2)_1779712227519.png',
            },
        ],
        description: 'Vibrant, high-resolution photo printing to preserve your best memories on glossy paper.',
        badgeLabel: 'PHOTO PRINTING',
        bgColor: '#AEFFF2',
        thumbnailUrl: '',
        listImageUrl:
            'https://appsinvo-stag-dev.s3.ap-south-1.amazonaws.com/printcart24/images/print-services/photoprinting_1779710744156.png',
        detailImageUrl:
            'https://appsinvo-stag-dev.s3.ap-south-1.amazonaws.com/printcart24/images/print-services/photoprinting_1779710744156.png',
        detailDescriptions: [
            'Printed on glossy photo paper',
            'Vibrant and accurate colors',
            'Multiple sizes available',
        ],
        allowsMultipleFiles: true,
        maxFilesPerItem: 20,
        // maxPagesPerFile (original): 1
        maxPagesPerFile: MAX_PAGES_UNLIMITED,
        // allowedMimeTypes (original): ['image/jpeg', 'image/png', 'image/webp']
        allowedMimeTypes: ALL_ALLOWED_MIME_TYPES,
        pricingModel: 'PER_ITEM',
        basePrice: 49,
        currency: 'INR',
        estimatedDeliveryMinutes: 240,
        supportsDelivery: true,
        supportsPickup: true,
        sortOrder: 3,
        isActive: false,
        deliveryNote: 'We will deliver your order in same day.',
        ...photoCustomizationConfig,
    },
    {
        name: 'Certificate',
        slug: 'certificate',
        serviceType: 'DOCUMENT_PRINT',
        shortDescription: [
            { points: 'Printed on Premium Matte Sheet (250 GSM)' },
            { points: 'Starting at just ₹15 per print' },
            { points: 'Volume discount: ₹12 per print when ordering >100 prints' },
            { points: 'Designed for institutional awards, workshops, and diplomas' },
        ],
        sliderImages: [
            {
                s3Url: 'https://cdn.printcampus.in/printcart24/print-services/image_2_1790141610214.png',
            },
        ],
        description: 'Premium print quality on thick cardstock (up to 300 GSM) for achievements and awards.',
        badgeLabel: 'CERTIFICATES',
        bgColor: '#D4FFAE',
        thumbnailUrl: '',
        listImageUrl: 'https://cdn.printcampus.in/printcart24/print-services/certificate_1790141673146.png',
        detailImageUrl: 'https://cdn.printcampus.in/printcart24/print-services/certificate_1790141673146.png',
        detailDescriptions: [
            'Printed on Premium Matte Sheet (250 GSM)',
            'Starting at just ₹15 per print',
            'Volume discount: ₹12 per print when ordering >100 prints',
            'Designed for institutional awards, workshops, and diplomas',
        ],
        allowsMultipleFiles: true,
        maxFilesPerItem: 20,
        // maxPagesPerFile (original): 1
        maxPagesPerFile: MAX_PAGES_UNLIMITED,
        // allowedMimeTypes (original): ['application/pdf', 'image/jpeg', 'image/png']
        allowedMimeTypes: ALL_ALLOWED_MIME_TYPES,
        pricingModel: 'PER_PAGE',
        basePrice: 15,
        currency: 'INR',
        estimatedDeliveryMinutes: 120,
        supportsDelivery: true,
        supportsPickup: true,
        sortOrder: 4,
        isActive: true,
        deliveryNote: 'We will deliver your order in same day.',
        ...certificateCustomizationConfig,
    },
    {
        name: 'Plagiarism Check',
        slug: 'plagiarism-check',
        serviceType: 'CUSTOM',
        shortDescription: [
            { points: 'Full academic plagiarism validation checks' },
            { points: 'Similarity scan report generated' },
            { points: 'Fast digital copy delivery' },
        ],
        sliderImages: [],
        description: 'Get your thesis, assignment, or paper scanned for plagiarism and receive a detailed report.',
        badgeLabel: 'PLAGIARISM CHECK',
        bgColor: '#FFC1C1',
        thumbnailUrl: '',
        listImageUrl:
            'https://appsinvo-stag-dev.s3.ap-south-1.amazonaws.com/printcart24/images/print-services/plagiarismcheck_1779710744479.png',
        detailImageUrl:
            'https://appsinvo-stag-dev.s3.ap-south-1.amazonaws.com/printcart24/images/print-services/plagiarismcheck_1779710744479.png',
        detailDescriptions: [
            'Detailed similarity percentage report',
            'Academic & journal database checks',
            'Quick online report delivery',
        ],
        allowsMultipleFiles: false,
        maxFilesPerItem: 1,
        maxPagesPerFile: 1000,
        // allowedMimeTypes (original): ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
        allowedMimeTypes: ALL_ALLOWED_MIME_TYPES,
        pricingModel: 'PER_PAGE',
        basePrice: 2,
        currency: 'INR',
        estimatedDeliveryMinutes: 60,
        supportsDelivery: false,
        supportsPickup: false,
        sortOrder: 5,
        isActive: false,
        deliveryNote: 'We will deliver your order in same day.',
        ...plagiarismCustomizationConfig,
    },
    {
        name: 'Poster Printing',
        slug: 'poster-printing',
        serviceType: 'DOCUMENT_PRINT',
        shortDescription: [
            { points: 'Large-format high fidelity prints (A2, A1, A0)' },
            { points: 'Vibrant color saturation' },
            { points: 'Premium heavy-duty poster sheets' },
        ],
        sliderImages: [
            {
                s3Url: 'https://cdn.printcampus.in/printcart24/print-services/image_2_1790142399897.png',
            },
        ],
        description: 'Bring your designs and banners to life with large format high-resolution printing.',
        badgeLabel: 'POSTERS',
        bgColor: '#B1DDFF',
        thumbnailUrl: '',
        listImageUrl: 'https://cdn.printcampus.in/printcart24/print-services/posterprinting_1790142432214.png',
        detailImageUrl: 'https://cdn.printcampus.in/printcart24/print-services/posterprinting_1790142432214.png',
        detailDescriptions: [
            'Large-format high fidelity prints (A2, A1, A0)',
            'Vibrant color saturation',
            'Premium heavy-duty poster sheets',
        ],
        allowsMultipleFiles: true,
        maxFilesPerItem: 5,
        // maxPagesPerFile (original): 1
        maxPagesPerFile: MAX_PAGES_UNLIMITED,
        // allowedMimeTypes (original): ['application/pdf', 'image/jpeg', 'image/png']
        allowedMimeTypes: ALL_ALLOWED_MIME_TYPES,
        pricingModel: 'PER_PAGE',
        basePrice: 250,
        currency: 'INR',
        estimatedDeliveryMinutes: 180,
        supportsDelivery: true,
        supportsPickup: true,
        sortOrder: 6,
        isActive: true,
        deliveryNote: 'We will deliver your order in same day.',
        ...posterCustomizationConfig,
    },
    {
        name: 'Thesis Binding',
        slug: 'thesis-golden-bindings',
        serviceType: 'DOCUMENT_BINDING',
        shortDescription: [
            { points: 'Elegant hardcover with metallic foil text (Gold/Silver)' },
            { points: 'Gold and silver embossed binding as per the university guidelines' },
            { points: 'Highly durable stitching and binding' },
            { points: 'Binding color options: Black, Mehroon, Blue, Green' },
        ],
        sliderImages: [
            {
                s3Url: 'https://cdn.printcampus.in/printcart24/print-services/image_2_1790142570017.png',
            },
            {
                s3Url: 'https://cdn.printcampus.in/printcart24/print-services/image_3_1790142588454.png',
            },
        ],
        description: 'University-standard hardcover bindings with gold/silver embossing on the front and spine.',
        badgeLabel: 'GOLD THESIS',
        bgColor: '#FFE8AE',
        thumbnailUrl: '',
        listImageUrl: 'https://cdn.printcampus.in/printcart24/print-services/thesisgoldenbindings_1790142625543.png',
        detailImageUrl: 'https://cdn.printcampus.in/printcart24/print-services/thesisgoldenbindings_1790142625543.png',
        detailDescriptions: [
            'Elegant hardcover with metallic foil text (Gold/Silver)',
            'Gold and silver embossed binding as per the university guidelines',
            'Highly durable stitching and binding',
            'Binding color options: Black, Mehroon, Blue, Green',
        ],
        allowsMultipleFiles: false,
        maxFilesPerItem: 1,
        maxPagesPerFile: 2000,
        // allowedMimeTypes (original): ['application/pdf']
        allowedMimeTypes: ALL_ALLOWED_MIME_TYPES,
        pricingModel: 'PER_ITEM',
        basePrice: 600,
        currency: 'INR',
        estimatedDeliveryMinutes: 1440,
        supportsDelivery: true,
        supportsPickup: true,
        sortOrder: 7,
        isActive: true,
        deliveryNote: 'We will deliver your order in 2 days.',
        ...thesisCustomizationConfig,
        // Thesis Binding uses only 4 premium options (LANGUAGE, DIGITAL_BINDING, LAMINATION_BINDING, SUMMARY_SYNOPSIS_ABSTRACT_BINDING)
        bindingConfiguration: {
            ...thesisCustomizationConfig.bindingConfiguration,
            toggles: thesisBindingToggles,
        },
        // Binding color is exclusive to Thesis Golden Bindings — not in shared thesisCustomizationConfig
        supportedBindingColors: bindingColorOptions,
    },
    {
        name: 'Thesis Printing',
        slug: 'thesis-printing',
        serviceType: 'DOCUMENT_BINDING',
        shortDescription: [
            { points: 'Standard academic thesis paper layout' },
            { points: 'Fast execution for submission deadlines' },
        ],
        sliderImages: [
            {
                s3Url: 'https://cdn.printcampus.in/printcart24/print-services/image_2_1790142798037.png',
            },
            {
                s3Url: 'https://cdn.printcampus.in/printcart24/print-services/image_3_1790142817007.png',
            },
        ],
        description: 'Standard academic thesis printing with options for soft covers, spiral coils, or comb binding.',
        badgeLabel: 'THESIS PRINT',
        bgColor: '#B1DDFF',
        thumbnailUrl: '',
        listImageUrl: 'https://cdn.printcampus.in/printcart24/print-services/thesisprinting_1790142842711.png',
        detailImageUrl: 'https://cdn.printcampus.in/printcart24/print-services/thesisprinting_1790142842711.png',
        detailDescriptions: ['Standard academic thesis paper layout', 'Fast execution for submission deadlines'],
        allowsMultipleFiles: false,
        maxFilesPerItem: 1,
        maxPagesPerFile: 2000,
        // allowedMimeTypes (original): ['application/pdf']
        allowedMimeTypes: ALL_ALLOWED_MIME_TYPES,
        pricingModel: 'PER_ITEM',
        basePrice: 300,
        currency: 'INR',
        estimatedDeliveryMinutes: 720,
        supportsDelivery: true,
        supportsPickup: true,
        sortOrder: 8,
        isActive: true,
        deliveryNote: 'We will deliver your order in 2 days.',
        ...thesisCustomizationConfig,
        // BUSINESS RULE: Thesis Printing paper quality options (thesis-golden-bindings intentionally excluded)
        supportedPaperQualities: thesisPaperQualityOptions,
        pricingRules: [
            ...thesisCustomizationConfig.pricingRules,
            createPricingRule('PAPER_QUALITY', 'SPECIAL_100_GSM', 'Special Paper (100 GSM)', 'PER_PAGE', 0),
            createPricingRule('PAPER_QUALITY', 'BOND_100_GSM', 'Bond Paper (100 GSM)', 'PER_PAGE', 0),
        ],
    },
    {
        name: 'Fabric Poster (Foldable)',
        slug: 'fabric-poster-foldable',
        serviceType: 'DOCUMENT_PRINT',
        shortDescription: [
            { points: 'Printed on premium foldable fabric canvas' },
            { points: 'Crease-resistant, lightweight, and easy to pack' },
            { points: 'Perfect for conference travel, exhibitions, and research presentations' },
            { points: 'Available in A2 (₹600), A1 (₹900), and A0 (₹1700)' },
        ],
        sliderImages: [
            {
                s3Url: 'https://appsinvo-stag-dev.s3.ap-south-1.amazonaws.com/printcart24/images/print-slider/image_(2)_1779712356168.png',
            },
        ],
        description:
            'Crease-resistant fabric posters designed for academics, researchers, and professionals who travel.',
        badgeLabel: 'FABRIC POSTER',
        bgColor: '#E1BEE7',
        thumbnailUrl: '',
        listImageUrl:
            'https://appsinvo-stag-dev.s3.ap-south-1.amazonaws.com/printcart24/images/print-services/posterprinting_1779710744886.png',
        detailImageUrl:
            'https://appsinvo-stag-dev.s3.ap-south-1.amazonaws.com/printcart24/images/print-services/posterprinting_1779710744886.png',
        detailDescriptions: [
            'Durable crease-free fabric canvas',
            'Saves luggage space (foldable/rollable)',
            'Vibrant sublimation print colors',
        ],
        allowsMultipleFiles: true,
        maxFilesPerItem: 3,
        // maxPagesPerFile (original): 1
        maxPagesPerFile: MAX_PAGES_UNLIMITED,
        // allowedMimeTypes (original): ['application/pdf', 'image/jpeg', 'image/png']
        allowedMimeTypes: ALL_ALLOWED_MIME_TYPES,
        pricingModel: 'PER_PAGE',
        basePrice: 600,
        currency: 'INR',
        estimatedDeliveryMinutes: 180,
        supportsDelivery: true,
        supportsPickup: true,
        sortOrder: 11,
        isActive: false,
        deliveryNote: 'We will deliver your order in same day.',
        supportedOrientations: baseOrientations,
        supportedPaperSizes: [
            createOption('A2', 'A2 Poster Size', { isDefault: true, sortOrder: 1 }),
            createOption('A1', 'A1 Poster Size', { sortOrder: 2 }),
            createOption('A0', 'A0 Poster Size', { sortOrder: 3 }),
        ],
        supportedColorModes: [
            createOption('COLOR', 'Color', { isDefault: true, sortOrder: 1 }),
            createOption('BW', 'Black & White', { sortOrder: 2 }),
        ],
        supportedSideModes: [createOption('SINGLE', 'Single Sided', { isDefault: true, sortOrder: 1 })],
        supportedPaperQualities: [],
        copiesConfig: {
            min: 1,
            max: 500,
            default: 1,
        },
        bindingConfiguration: {
            toggles: [],
            options: [],
        },
        bookletOptions: [],
        bindingOptions: [],
        supportedAddOns: [],
        pricingRules: [
            createPricingRule('COLOR_MODE', 'COLOR', 'Color', 'PER_PAGE', 0),
            createPricingRule('COLOR_MODE', 'BW', 'Black & White', 'PER_PAGE', 0),
            createPricingRule('ORIENTATION', 'PORTRAIT', 'Portrait', 'FLAT', 0),
            createPricingRule('ORIENTATION', 'LANDSCAPE', 'Landscape', 'FLAT', 0),
            createPricingRule('SIDE_MODE', 'SINGLE', 'Single Sided', 'PER_PAGE', 0),
            createPricingRule('PAPER_SIZE', 'A2', 'A2 Poster Size', 'PER_PAGE', 0),
            createPricingRule('PAPER_SIZE', 'A1', 'A1 Poster Size', 'PER_PAGE', 300),
            createPricingRule('PAPER_SIZE', 'A0', 'A0 Poster Size', 'PER_PAGE', 1100),
        ],
    },
];

export const printServicePricingProfiles = printServices.map((service) => ({
    slug: service.slug,
    currency: service.currency,
    basePricing: {
        calculationType:
            service.pricingModel === 'CUSTOM'
                ? 'FLAT'
                : service.pricingModel === 'PER_ITEM'
                  ? 'PER_ITEM'
                  : service.pricingModel,
        unitPrice: service.basePrice,
        isTaxable: true,
        isActive: true,
    },
    optionPricing: service.pricingRules.map((rule) => ({
        group: rule.group,
        code: rule.code,
        label: rule.label,
        calculationType: rule.calculationType,
        unitPrice: rule.amount,
        minPages: rule.minPages ?? null,
        maxPages: rule.maxPages ?? null,
        slabSize: rule.slabSize ?? null,
        isTaxable: rule.isTaxable !== false,
        isActive: rule.isActive !== false,
    })),
}));

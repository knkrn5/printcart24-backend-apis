// services/printPricing.service.js
import PrintServicePricing from '#models/printServicePricing';
import { BINDING_SAMPLE_IMAGES } from '#utils/constants';

const CALCULATION_TYPES = ['FLAT', 'PER_PAGE', 'PER_COPY', 'PER_SHEET', 'PER_ITEM', 'PER_DOCUMENT', 'PER_100_PAGES'];

const GROUP_FIELD_MAP = {
    COLOR_MODE: 'supportedColorModes',
    PAPER_SIZE: 'supportedPaperSizes',
    PAPER_QUALITY: 'supportedPaperQualities',
    ORIENTATION: 'supportedOrientations',
    SIDE_MODE: 'supportedSideModes',
    BINDING_COLOR: 'supportedBindingColors',
    BINDING_TOGGLE: 'bindingConfiguration.toggles',
    BINDING_OPTION: 'bindingConfiguration.options',
    BOOKLET_OPTION: 'bookletOptions',
};

const SECTION_CONFIG = {
    colorModes: {
        customizationKey: 'colorModes',
    },
    paperSizes: {
        customizationKey: 'paperSizes',
    },
    paperQualities: {
        customizationKey: 'paperQualities',
    },
    orientations: {
        customizationKey: 'orientations',
    },
    sideModes: {
        customizationKey: 'sideModes',
    },
    binding: {
        customizationKey: 'bindingConfiguration',
    },
    bindingConfiguration: {
        customizationKey: 'bindingConfiguration',
    },
    booklet: {
        customizationKey: 'bookletOptions',
    },
    bookletOptions: {
        customizationKey: 'bookletOptions',
    },
    bindingColors: {
        customizationKey: 'bindingColors',
    },
    poster: {
        customizationKeys: ['paperSizes', 'paperQualities'],
    },
};

const getNestedValue = (obj, path, fallback = []) => {
    return path.split('.').reduce((acc, key) => acc?.[key], obj) ?? fallback;
};

const normalizeOptionValue = (option = {}) => ({
    code: option.code || '',
    label: option.label || '',
});

const normalizePaperQualityOption = (option = {}) => ({
    code: option.code || '',
    label: option.label || '',
    isDefault: option.isDefault === true,
    colorModeFilter: Array.isArray(option.colorModeFilter) ? option.colorModeFilter : [],
});

const getToggleId = (toggle) => {
    if (!toggle) return null;
    const val = toggle.get ? toggle.get('id') : toggle.id;
    return val !== undefined && val !== null ? val : null;
};

const normalizeToggleValue = (toggle = {}) => {
    const images = (BINDING_SAMPLE_IMAGES[toggle.code] || []).map((url) => ({ s3Url: url }));
    const norm = {
        id: getToggleId(toggle),
        code: toggle.code || '',
        label: toggle.label || '',
        description: toggle.description || '',
        price: toggle.price || 0,
        hasSubOptions: Boolean(toggle.hasSubOptions),
        sampleImages: images,
        sampleImage: images[0]?.s3Url || '',
    };
    if (toggle.hasSubOptions && toggle.subOptions) {
        norm.subOptions = toggle.subOptions.map((so) => {
            const soImages = (BINDING_SAMPLE_IMAGES[so.code] || []).map((url) => ({ s3Url: url }));
            return {
                id: getToggleId(so),
                code: so.code || '',
                label: so.label || '',
                price: so.price || 0,
                minPages: so.minPages !== undefined ? so.minPages : null,
                maxPages: so.maxPages !== undefined ? so.maxPages : null,
                sampleImages: soImages,
                sampleImage: soImages[0]?.s3Url || '',
            };
        });
    }
    return norm;
};

const normalizeBindingOption = (option = {}) => ({
    code: option.code || '',
    label: option.label || '',
    pricingModel: option.pricingModel || 'FLAT',
    unitPrice: option.unitPrice || 0,
    minPages: option.minPages ?? null,
    maxPages: option.maxPages ?? null,
});

const formatUnitPrice = (unitPrice = 0) => {
    const numericPrice = Number(unitPrice) || 0;
    return Number.isInteger(numericPrice) ? String(numericPrice) : numericPrice.toFixed(2).replace(/\.?0+$/, '');
};

const buildPriceLabel = (pricingModel = 'FLAT', unitPrice = 0) => {
    const formattedPrice = formatUnitPrice(unitPrice);
    return `₹ ${formattedPrice}`;
};

const buildBindingOptionDisplay = (option = {}) => {
    const priceLabel = buildPriceLabel(option.pricingModel, option.unitPrice);

    return {
        code: option.code || '',
        label: (option.label || '').replace(/\bpgs\b/gi, 'pages'),
        priceLabel,
    };
};

const filterActiveOptions = (options = [], normalizer = normalizeOptionValue) => {
    return options.filter((option) => option?.isActive !== false).map(normalizer);
};

/**
 * Further filter an already-normalized paperQualities array by colorCode.
 * Only applied when colorCode is provided AND an option carries a non-empty
 * colorModeFilter — so Document/Thesis qualities (colorModeFilter: []) are
 * always passed through untouched regardless of the colorCode value.
 */
const applyColorModeFilter = (qualities = [], colorCode) => {
    if (!colorCode) return qualities;
    const normalizedCode = colorCode.toUpperCase();
    return qualities.filter((q) => {
        if (!Array.isArray(q.colorModeFilter) || q.colorModeFilter.length === 0) return true;
        return q.colorModeFilter.includes(normalizedCode);
    });
};

const buildFallbackPricingConfig = (service) => {
    const pricingRules = service.pricingRules || [];
    const hasBindingOptionRules = pricingRules.some((rule) => rule.group === 'BINDING_OPTION');
    const optionPricing = [
        ...pricingRules.map((rule) => ({
            group: rule.group || 'BOOKLET_OPTION',
            code: rule.code,
            label: rule.label,
            calculationType: rule.calculationType || 'FLAT',
            unitPrice: rule.amount || 0,
            minPages: rule.minPages ?? null,
            maxPages: rule.maxPages ?? null,
            slabSize: rule.slabSize ?? null,
            isTaxable: rule.isTaxable !== false,
            isActive: rule.isActive !== false,
        })),
        ...(!hasBindingOptionRules
            ? (service.bindingConfiguration?.options || service.bindingOptions || []).map((option) => ({
                  group: 'BINDING_OPTION',
                  code: option.code,
                  label: option.label,
                  calculationType:
                      option.pricingModel === 'PER_100_PAGES'
                          ? 'PER_100_PAGES'
                          : CALCULATION_TYPES.includes(option.pricingModel)
                            ? option.pricingModel
                            : 'FLAT',
                  unitPrice: option.unitPrice || 0,
                  minPages: option.minPages ?? null,
                  maxPages: option.maxPages ?? null,
                  slabSize: option.pricingModel === 'PER_100_PAGES' ? 100 : null,
                  isTaxable: true,
                  isActive: option.isActive !== false,
              }))
            : []),
    ];

    return {
        currency: service.currency || 'INR',
        basePricing: {
            calculationType: service.pricingModel || 'FLAT',
            unitPrice: service.basePrice || 0,
            isTaxable: true,
            isActive: true,
        },
        optionPricing,
        comboPricing: [],
        source: 'SERVICE_DEFAULTS',
    };
};

export const getEffectivePricingConfig = async (service) => {
    const pricingProfile = await PrintServicePricing.findOne({ service: service._id, isActive: true })
        .select('-__v')
        .lean();

    if (!pricingProfile) {
        return buildFallbackPricingConfig(service);
    }

    return {
        currency: pricingProfile.currency || service.currency || 'INR',
        basePricing: pricingProfile.basePricing || buildFallbackPricingConfig(service).basePricing,
        optionPricing: (pricingProfile.optionPricing || []).filter((entry) => entry.isActive !== false),
        comboPricing: (pricingProfile.comboPricing || []).filter((entry) => entry.isActive !== false),
        source: 'ADMIN_PROFILE',
    };
};

export const buildCustomizationConfig = (service, pricingConfig = null) => {
    const bindingPricingMap = new Map(
        (pricingConfig?.optionPricing || [])
            .filter((entry) => entry.group === 'BINDING_OPTION')
            .map((entry) => [entry.code, entry]),
    );

    return {
        colorModes: filterActiveOptions(service.supportedColorModes),
        paperSizes: filterActiveOptions(service.supportedPaperSizes),
        paperQualities: filterActiveOptions(service.supportedPaperQualities, normalizePaperQualityOption),
        orientations: filterActiveOptions(service.supportedOrientations),
        sideModes: filterActiveOptions(service.supportedSideModes),
        bindingConfiguration: {
            toggles: filterActiveOptions(service.bindingConfiguration?.toggles || [], normalizeToggleValue),
            options: filterActiveOptions(
                service.bindingConfiguration?.options || service.bindingOptions || [],
                (option) => {
                    const normalizedOption = normalizeBindingOption(option);
                    const pricingEntry = bindingPricingMap.get(normalizedOption.code);

                    if (!pricingEntry) return buildBindingOptionDisplay(normalizedOption);

                    return buildBindingOptionDisplay({
                        ...normalizedOption,
                        pricingModel: pricingEntry.calculationType || normalizedOption.pricingModel,
                        unitPrice: pricingEntry.unitPrice || 0,
                        minPages: pricingEntry.minPages ?? normalizedOption.minPages,
                        maxPages: pricingEntry.maxPages ?? normalizedOption.maxPages,
                    });
                },
            ),
        },
        bookletOptions: filterActiveOptions(service.bookletOptions || []),
        bindingColors: filterActiveOptions(service.supportedBindingColors || []),
    };
};

export const buildPrintServiceDetailResponse = async (service) => {
    const pricingConfig = await getEffectivePricingConfig(service);
    const customizationConfig = buildCustomizationConfig(service, pricingConfig);

    return {
        service: {
            id: service._id,
            name: service.name,
            slug: service.slug,
            serviceType: service.serviceType,
            shortDescription: service.shortDescription,
            badgeLabel: service.badgeLabel,
            listImageUrl: service.listImageUrl,
            detailImageUrl: service.detailImageUrl,
            detailDescriptions: service.detailDescriptions || [],
            allowsMultipleFiles: service.allowsMultipleFiles,
            deliveryNote: service.deliveryNote || '',
        },
        customizationConfig,
    };
};

export const buildFilteredPrintServiceDetailResponse = async (service, section, options = {}) => {
    const { colorCode } = options;
    const normalizedSection = section?.trim();
    if (!normalizedSection) {
        return buildPrintServiceDetailResponse(service);
    }

    const sectionConfig = SECTION_CONFIG[normalizedSection];
    if (!sectionConfig) {
        const error = new Error(`Unsupported section filter: ${normalizedSection}`);
        error.statusCode = 400;
        throw error;
    }

    const fullPayload = await buildPrintServiceDetailResponse(service);
    const filteredCustomizationConfig = {};
    if (sectionConfig.customizationKeys) {
        sectionConfig.customizationKeys.forEach((key) => {
            filteredCustomizationConfig[key] = fullPayload.customizationConfig[key];
        });
    } else {
        filteredCustomizationConfig[sectionConfig.customizationKey] =
            fullPayload.customizationConfig[sectionConfig.customizationKey];
    }

    // Apply color-mode filter to paperQualities when colorCode is provided.
    // This is configuration-driven: options with an empty colorModeFilter pass
    // through untouched, so Document Printing and Thesis Printing are unaffected.
    if (colorCode && filteredCustomizationConfig.paperQualities) {
        filteredCustomizationConfig.paperQualities = applyColorModeFilter(
            filteredCustomizationConfig.paperQualities,
            colorCode,
        );
    }

    return {
        ...fullPayload,
        customizationConfig: filteredCustomizationConfig,
        selectedSection: normalizedSection,
    };
};

const findSelectedOption = (options = [], code) =>
    options.find((option) => option.code === code && option.isActive !== false);

const assertSupportedCode = (service, group, code) => {
    const fieldPath = GROUP_FIELD_MAP[group];
    if (!fieldPath || !code) return;

    const options = getNestedValue(service, fieldPath, []);
    if (!findSelectedOption(options, code)) {
        throw new Error(`Unsupported ${group.toLowerCase().replaceAll('_', ' ')} option: ${code}`);
    }
};

const computeAmount = (entry, context) => {
    const { calculationType = 'FLAT', unitPrice = 0, slabSize } = entry;
    const safeUnitPrice = Number(unitPrice) || 0;
    const pages = Math.max(context.totalPages || 0, 0);
    const copies = Math.max(context.copies || 1, 1);
    const documents = Math.max(context.documentCount || 1, 1);

    switch (calculationType) {
        case 'PER_PAGE':
            return safeUnitPrice * pages * copies;
        case 'PER_COPY':
            return safeUnitPrice * copies;
        case 'PER_SHEET':
            return safeUnitPrice * Math.ceil(pages / 2) * copies;
        case 'PER_ITEM':
        case 'PER_DOCUMENT':
            return safeUnitPrice * documents * copies;
        case 'PER_100_PAGES': {
            const divisor = slabSize || 100;
            return safeUnitPrice * Math.ceil(pages / divisor) * copies;
        }
        case 'FLAT':
        default:
            return safeUnitPrice;
    }
};

const withinPageRange = (entry, totalPages) => {
    if (entry.minPages !== null && entry.minPages !== undefined && totalPages < entry.minPages) return false;
    if (entry.maxPages !== null && entry.maxPages !== undefined && totalPages > entry.maxPages) return false;
    return true;
};

const normalizeBookletOptionCodes = (value = []) => {
    if (Array.isArray(value)) {
        return value.map((entry) => String(entry || '').trim()).filter(Boolean);
    }

    return String(value || '')
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
};

export const resolvePrintPricing = async ({ service, customization = {}, totalPages = 0, documentCount = 1 }) => {
    const pricingConfig = await getEffectivePricingConfig(service);
    const copies = customization.copies || service.copiesConfig?.default || 1;
    const normalizedBookletOptionCodes =
        normalizeBookletOptionCodes(customization.bookletOptionCodes).length > 0
            ? normalizeBookletOptionCodes(customization.bookletOptionCodes)
            : normalizeBookletOptionCodes(customization.selectedAddOnCodes);

    const serviceDefaultSideMode = service.supportedSideModes?.find((o) => o.isDefault)?.code || 'SINGLE';

    const finalCustomization = {
        copies,
        orientation: customization.orientation || '',
        paperSize: customization.paperSize || '',
        colorMode: customization.colorMode || '',
        sideMode: customization.sideMode || serviceDefaultSideMode,
        paperQuality: customization.paperQuality || '',
        bindingSelections: customization.bindingSelections || [],
        selectedBindingCode: customization.selectedBindingCode || '',
        selectedBindingColorCode: customization.selectedBindingColorCode || '',
        bookletOptionCodes: normalizedBookletOptionCodes,
        notes: customization.notes || '',
    };

    [
        ['COLOR_MODE', finalCustomization.colorMode],
        ['PAPER_SIZE', finalCustomization.paperSize],
        ['PAPER_QUALITY', finalCustomization.paperQuality],
        ['ORIENTATION', finalCustomization.orientation],
        ['SIDE_MODE', finalCustomization.sideMode],
        ['BINDING_OPTION', finalCustomization.selectedBindingCode],
        ['BINDING_COLOR', finalCustomization.selectedBindingColorCode],
    ].forEach(([group, code]) => assertSupportedCode(service, group, code));

    finalCustomization.bookletOptionCodes.forEach((code) => assertSupportedCode(service, 'BOOKLET_OPTION', code));

    // Assert selections are supported by the service configuration
    const toggles = service.bindingConfiguration?.toggles || [];
    (finalCustomization.bindingSelections || []).forEach((sel) => {
        const toggle = toggles.find((t) => getToggleId(t) === sel.optionId && t.isActive !== false);
        if (!toggle) {
            throw new Error(`Unsupported option ID: ${sel.optionId}`);
        }
        if (toggle.hasSubOptions) {
            const isPageSlab = toggle.subOptions?.some((so) => so.minPages !== null || so.maxPages !== null);
            if (!isPageSlab) {
                const subOption = (toggle.subOptions || []).find(
                    (so) => getToggleId(so) === sel.subOptionId && so.isActive !== false,
                );
                if (!subOption) {
                    throw new Error(`Unsupported sub-option ID: ${sel.subOptionId} for option: ${toggle.code}`);
                }
            }
        }
    });

    // Dynamic override for document-printing per new business rules
    if (service.slug === 'document-printing') {
        const size = finalCustomization.paperSize || 'A4';
        const color = finalCustomization.colorMode || 'BW';
        const quality =
            finalCustomization.paperQuality || (color === 'COLOR' ? 'SPECIAL_100_GSM' : 'STANDARD_70_75_GSM');

        // Prefer an admin-managed value from PrintServicePricing.comboPricing when one
        // exists for this exact combination. If none is found — e.g. on a database that
        // hasn't run the comboPricing seed script yet — fall back to the original
        // hardcoded table below, so behavior is unchanged wherever comboPricing is empty.
        const storedCombo = (pricingConfig.comboPricing || []).find(
            (entry) => entry.colorMode === color && entry.paperSize === size && entry.paperQuality === quality,
        );

        let comboPrice;
        if (storedCombo) {
            comboPrice = storedCombo.unitPrice;
        } else {
            comboPrice = 1.5; // Default A4 B/W standard
            if (color === 'COLOR') {
                if (size === 'A3') {
                    comboPrice = quality === 'SPECIAL_100_GSM' ? 40 : 20;
                } else {
                    comboPrice = quality === 'SPECIAL_100_GSM' ? 16 : 8;
                }
            } else {
                // BW: price depends on paper quality
                if (size === 'A3') {
                    comboPrice = quality === 'SPECIAL_100_GSM' ? 8 : 6;
                } else {
                    comboPrice = quality === 'SPECIAL_100_GSM' ? 3 : 1.5;
                }
            }
        }

        if (finalCustomization.sideMode === 'DOUBLE') {
            comboPrice *= 2;
        }

        pricingConfig.basePricing.unitPrice = comboPrice;

        // Exclude COLOR_MODE, PAPER_SIZE, and SIDE_MODE from option pricing calculations
        pricingConfig.optionPricing = pricingConfig.optionPricing.filter(
            (entry) => entry.group !== 'COLOR_MODE' && entry.group !== 'PAPER_SIZE' && entry.group !== 'SIDE_MODE',
        );
    }

    // Dynamic override for digital-printing per new business rules
    if (service.slug === 'digital-printing') {
        const size = finalCustomization.paperSize || 'A4';
        const color = finalCustomization.colorMode || 'BW';
        const quality =
            finalCustomization.paperQuality || (color === 'COLOR' ? '100_GSM' : '70_75_GSM');

        // Prefer an admin-managed value from PrintServicePricing.comboPricing when one
        // exists for this exact combination. If none is found — e.g. on a database that
        // hasn't run the comboPricing seed script yet — fall back to the original
        // formula below, so behavior is unchanged wherever comboPricing is empty.
        const storedCombo = (pricingConfig.comboPricing || []).find(
            (entry) => entry.colorMode === color && entry.paperSize === size && entry.paperQuality === quality,
        );

        let comboPrice;
        if (storedCombo) {
            comboPrice = storedCombo.unitPrice;
        } else {
            let perPagePrice = Number(pricingConfig.basePricing.unitPrice) || 0;

            const colorEntry = (pricingConfig.optionPricing || []).find(
                (e) => e.group === 'COLOR_MODE' && e.code === color,
            );
            if (colorEntry) perPagePrice += Number(colorEntry.unitPrice) || 0;

            const sizeEntry = (pricingConfig.optionPricing || []).find(
                (e) => e.group === 'PAPER_SIZE' && e.code === size,
            );
            if (sizeEntry) perPagePrice += Number(sizeEntry.unitPrice) || 0;

            comboPrice = perPagePrice;
        }

        if (finalCustomization.sideMode === 'DOUBLE') {
            comboPrice *= 2;
        }

        pricingConfig.basePricing.unitPrice = comboPrice;

        // Exclude COLOR_MODE, PAPER_SIZE, PAPER_QUALITY, and SIDE_MODE from option pricing calculations
        pricingConfig.optionPricing = pricingConfig.optionPricing.filter(
            (entry) =>
                entry.group !== 'COLOR_MODE' &&
                entry.group !== 'PAPER_SIZE' &&
                entry.group !== 'PAPER_QUALITY' &&
                entry.group !== 'SIDE_MODE',
        );
    }

    // Dynamic override for certificate per new business rules
    if (service.slug === 'certificate') {
        const pages = totalPages || 0;
        const pageBucket = pages > 100 ? 'PAGES_GT_100' : 'PAGES_LTE_100';
        const colorKey = finalCustomization.colorMode === 'COLOR' ? 'COLOR' : 'BW';

        // Prefer an admin-managed value from PrintServicePricing.comboPricing when one
        // exists for this exact (colorMode, pageBucket) combination. If none is found —
        // e.g. on a database that hasn't run the comboPricing seed script yet — fall back
        // to the original hardcoded table below, so behavior is unchanged wherever
        // comboPricing is empty.
        const storedCombo = (pricingConfig.comboPricing || []).find(
            (entry) => entry.colorMode === colorKey && entry.pageBucket === pageBucket,
        );

        let comboPrice;
        if (storedCombo) {
            comboPrice = storedCombo.unitPrice;
        } else {
            const bwUnitPrice = pageBucket === 'PAGES_GT_100' ? 12 : 15;
            comboPrice = colorKey === 'COLOR' ? bwUnitPrice * 2 : bwUnitPrice;
        }

        pricingConfig.basePricing.unitPrice = comboPrice;
        pricingConfig.basePricing.calculationType = 'PER_PAGE';

        // Exclude COLOR_MODE, PAPER_SIZE, and SIDE_MODE from option pricing calculations
        pricingConfig.optionPricing = pricingConfig.optionPricing.filter(
            (entry) => entry.group !== 'COLOR_MODE' && entry.group !== 'PAPER_SIZE' && entry.group !== 'SIDE_MODE',
        );
    }

    // Dynamic override for poster-printing per new business rules
    if (service.slug === 'poster-printing') {
        const size = finalCustomization.paperSize || 'A2';
        const color = finalCustomization.colorMode || 'COLOR';
        const quality = finalCustomization.paperQuality || (color === 'COLOR' ? 'GLOSSY' : 'POSTER_STANDARD');

        // Validate: paper quality must match color mode
        if (quality === 'POSTER_STANDARD' && color !== 'BW') {
            const err = new Error('Normal Sheet paper quality is only available for Black & White poster printing.');
            err.statusCode = 400;
            throw err;
        }
        if ((quality === 'GLOSSY' || quality === 'FABRIC') && color !== 'COLOR') {
            const err = new Error('Glossy / Fabric Poster paper quality is only available for Color poster printing.');
            err.statusCode = 400;
            throw err;
        }

        // Prefer an admin-managed value from PrintServicePricing.comboPricing when one
        // exists for this exact (paperQuality, paperSize) combination. If none is found —
        // e.g. on a database that hasn't run the comboPricing seed script yet — fall back
        // to the original hardcoded table below, so behavior is unchanged wherever
        // comboPricing is empty.
        const storedCombo = (pricingConfig.comboPricing || []).find(
            (entry) =>
                (!entry.colorMode || entry.colorMode === color) &&
                entry.paperQuality === quality &&
                entry.paperSize === size,
        );

        let comboPrice;
        if (storedCombo) {
            comboPrice = storedCombo.unitPrice;
        } else if (quality === 'FABRIC') {
            // Fabric Poster: explicit prices per size
            const fabricPriceMap = { A2: 400, A1: 600, A0: 1500 };
            comboPrice = fabricPriceMap[size] ?? 400;
        } else if (color === 'COLOR') {
            // Glossy (Color standard)
            if (size === 'A2') comboPrice = 250;
            else if (size === 'A1') comboPrice = 500;
            else comboPrice = 900;
        } else {
            // POSTER_STANDARD (BW)
            if (size === 'A2') comboPrice = 60;
            else if (size === 'A1') comboPrice = 75;
            else comboPrice = 100;
        }

        pricingConfig.basePricing.unitPrice = comboPrice;
        pricingConfig.basePricing.calculationType = 'PER_PAGE';

        // Exclude COLOR_MODE, PAPER_SIZE, and SIDE_MODE from option pricing calculations
        pricingConfig.optionPricing = pricingConfig.optionPricing.filter(
            (entry) => entry.group !== 'COLOR_MODE' && entry.group !== 'PAPER_SIZE' && entry.group !== 'SIDE_MODE',
        );
    }

    // Dynamic override for fabric option under poster printing (REMOVED — now handled above via FABRIC paper quality)
    // Dynamic override for direct fabric-poster-foldable service slug
    if (service.slug === 'fabric-poster-foldable') {
        pricingConfig.basePricing.calculationType = 'PER_PAGE';
    }

    // Default paperQuality for thesis-printing if not provided
    if (service.slug === 'thesis-printing' && !finalCustomization.paperQuality) {
        finalCustomization.paperQuality = 'SPECIAL_100_GSM';
    }

    // Dynamic override for thesis-printing paper quality — replaces base PER_ITEM price with PER_PAGE rate
    if (service.slug === 'thesis-printing' && finalCustomization.paperQuality) {
        const color = finalCustomization.colorMode || 'BW';
        const side = finalCustomization.sideMode || 'SINGLE';

        // Prefer an admin-managed value from PrintServicePricing.comboPricing when one
        // exists for this exact (colorMode, sideMode) combination. If none is found —
        // e.g. on a database that hasn't run the comboPricing seed script yet — fall
        // back to the original hardcoded table below, so behavior is unchanged wherever
        // comboPricing is empty.
        const storedCombo = (pricingConfig.comboPricing || []).find(
            (entry) => entry.colorMode === color && entry.sideMode === side,
        );

        let qualityPricePerPage;
        if (storedCombo) {
            qualityPricePerPage = storedCombo.unitPrice;
        } else if (color === 'BW' && side === 'SINGLE') qualityPricePerPage = 3;
        else if (color === 'BW' && side === 'DOUBLE') qualityPricePerPage = 6;
        else if (color === 'COLOR' && side === 'SINGLE') qualityPricePerPage = 10;
        else qualityPricePerPage = 20; // COLOR + DOUBLE

        pricingConfig.basePricing.unitPrice = qualityPricePerPage;
        pricingConfig.basePricing.calculationType = 'PER_PAGE';

        // Exclude PAPER_QUALITY, COLOR_MODE, SIDE_MODE from add-on option pricing (baked into base price)
        pricingConfig.optionPricing = pricingConfig.optionPricing.filter(
            (entry) => !['PAPER_QUALITY', 'COLOR_MODE', 'SIDE_MODE'].includes(entry.group),
        );
    }

    const context = {
        totalPages,
        copies,
        documentCount,
    };

    const baseAmount = computeAmount(pricingConfig.basePricing, context);
    const selectedAddOns = [];
    let selectedBinding = {};
    let addOnAmount = 0;

    const optionPricingMap = new Map(
        (pricingConfig.optionPricing || []).map((entry) => [`${entry.group}:${entry.code}`, entry]),
    );

    // Dynamic injection of BINDING_TOGGLE prices based on selections
    const selections = finalCustomization.bindingSelections || [];
    const togglesList = service.bindingConfiguration?.toggles || [];

    for (const selection of selections) {
        const toggle = togglesList.find((t) => getToggleId(t) === selection.optionId && t.isActive !== false);
        if (!toggle) continue;

        if (toggle.hasSubOptions) {
            let subOption = null;
            // 1. Check if the sub-options are page-count dependent (slabs)
            const isPageSlab = toggle.subOptions?.some((so) => so.minPages !== null || so.maxPages !== null);
            if (isPageSlab) {
                subOption = (toggle.subOptions || []).find((so) => {
                    const minP = so.minPages ?? 0;
                    const maxP = so.maxPages ?? Infinity;
                    return totalPages >= minP && totalPages <= maxP;
                });
            } else if (selection.subOptionId) {
                // 2. Selectable choice (e.g. LANGUAGE, SUMMARY_SYNOPSIS_ABSTRACT_BINDING)
                subOption = (toggle.subOptions || []).find(
                    (so) => getToggleId(so) === selection.subOptionId && so.isActive !== false,
                );
            }

            if (subOption) {
                optionPricingMap.set(`BINDING_TOGGLE:${toggle.code}`, {
                    code: toggle.code,
                    group: 'BINDING_TOGGLE',
                    label: toggle.label,
                    calculationType: 'PER_COPY',
                    unitPrice: subOption.price || 0,
                    isActive: true,
                    optionId: getToggleId(toggle),
                    subOptionId: getToggleId(subOption),
                    subOptionCode: subOption.code || '',
                    subOptionLabel: subOption.label || '',
                });
            }
        } else {
            // Flat price toggle
            optionPricingMap.set(`BINDING_TOGGLE:${toggle.code}`, {
                code: toggle.code,
                group: 'BINDING_TOGGLE',
                label: toggle.label,
                calculationType: 'PER_COPY',
                unitPrice: toggle.price || 0,
                isActive: true,
                optionId: getToggleId(toggle),
                subOptionId: null,
                subOptionCode: '',
                subOptionLabel: '',
            });
        }
    }

    const pushLineItem = (group, code) => {
        const entry = optionPricingMap.get(`${group}:${code}`);
        if (!entry || entry.isActive === false || !withinPageRange(entry, totalPages)) return;

        const amount = computeAmount(entry, context);
        addOnAmount += amount;

        const lineItem = {
            group,
            code: entry.code,
            label: entry.label,
            pricingModel: entry.calculationType,
            unitPrice: entry.unitPrice || 0,
            quantity:
                entry.calculationType === 'PER_PAGE' || entry.calculationType === 'PER_100_PAGES'
                    ? totalPages * copies
                    : copies,
            totalAmount: amount,
        };

        if (group === 'BINDING_OPTION') {
            selectedBinding = {
                code: entry.code,
                label: entry.label,
                pricingModel: entry.calculationType,
                unitPrice: entry.unitPrice || 0,
                totalAmount: amount,
            };
            return;
        }

        if (entry.optionId !== undefined) {
            lineItem.optionId = entry.optionId;
        }
        if (entry.subOptionId !== undefined) {
            lineItem.subOptionId = entry.subOptionId;
        }
        if (entry.subOptionCode !== undefined) {
            lineItem.subOptionCode = entry.subOptionCode;
        }
        if (entry.subOptionLabel !== undefined) {
            lineItem.subOptionLabel = entry.subOptionLabel;
        }

        selectedAddOns.push(lineItem);
    };

    [
        ['COLOR_MODE', finalCustomization.colorMode],
        ['PAPER_SIZE', finalCustomization.paperSize],
        ['PAPER_QUALITY', finalCustomization.paperQuality],
        ['ORIENTATION', finalCustomization.orientation],
        ['SIDE_MODE', finalCustomization.sideMode],
        ['BINDING_COLOR', finalCustomization.selectedBindingColorCode],
    ].forEach(([group, code]) => {
        if (code) pushLineItem(group, code);
    });

    // Push binding toggles dynamically based on active selections
    for (const selection of selections) {
        const toggle = togglesList.find((t) => getToggleId(t) === selection.optionId && t.isActive !== false);
        if (toggle) {
            pushLineItem('BINDING_TOGGLE', toggle.code);
        }
    }

    if (finalCustomization.selectedBindingCode) pushLineItem('BINDING_OPTION', finalCustomization.selectedBindingCode);
    finalCustomization.bookletOptionCodes.forEach((code) => pushLineItem('BOOKLET_OPTION', code));

    const totalAmount = baseAmount + addOnAmount;

    return {
        finalCustomization,
        selectedBinding,
        selectedAddOns,
        pricingConfig,
        priceSummary: {
            baseAmount,
            addOnAmount,
            discountAmount: 0,
            taxableAmount: totalAmount,
            taxAmount: 0,
            totalAmount,
            taxBreakup: [],
        },
    };
};

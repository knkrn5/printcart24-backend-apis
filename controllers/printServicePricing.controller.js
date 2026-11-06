// controllers/printServicePricing.controller.js
import httpStatus from 'http-status';
import PrintService from '#models/printService';
import PrintServicePricing from '#models/printServicePricing';
import { sendResponse } from '#utils/generalHelper';
import { getEffectivePricingConfig, buildCustomizationConfig, resolvePrintPricing } from '#services/printPricing';
import {
    upsertPrintServicePricingSchema,
    updateCombinationPricingSchema,
    updateSharedBindingTogglePricingSchema,
} from '#validations/admin';

// Per business confirmation: binding toggle prices must be identical across these 3
// services. Each service still holds its own independent copy in PrintService
// (confirmed no live database link between them), so "shared" is enforced here by
// writing the same price to every copy on every update — not by a single shared record.
const SHARED_BINDING_TOGGLE_SLUGS = ['document-printing', 'thesis-printing', 'thesis-golden-bindings'];

// Services whose combination pricing calculation has actually been switched to read
// from PrintServicePricing.comboPricing (see services/printPricing.service.js's
// per-slug override blocks). Writing comboPricing for a slug not in this set would
// save successfully but have zero effect on checkout — so it's explicitly rejected
// rather than silently accepted. All 4 combo-pricing services are now verified and
// writable — this is the complete set.
const COMBO_PRICING_WRITABLE_SLUGS = new Set([
    'document-printing',
    'certificate',
    'thesis-printing',
    'poster-printing',
    'digital-printing',
]);

// Mirrors the group-exclusion filters inside each hardcoded override block in
// services/printPricing.service.js (lines ~434-583). These groups are inputs to
// that service's combination price, not independently-priced additive amounts —
// keep this in sync if those filters ever change.
const DERIVED_GROUPS_BY_SLUG = {
    'document-printing': ['COLOR_MODE', 'PAPER_SIZE', 'SIDE_MODE'],
    certificate: ['COLOR_MODE'],
    'poster-printing': ['COLOR_MODE', 'PAPER_SIZE', 'SIDE_MODE'],
    'thesis-printing': ['COLOR_MODE', 'SIDE_MODE'],
};

// Groups excluded from additive pricing AND not used by the combination formula
// either — selecting these currently has zero effect on price.
const NO_PRICE_IMPACT_GROUPS_BY_SLUG = {
    'thesis-printing': ['PAPER_QUALITY'],
};

const COMBO_PRICING_SLUGS = new Set([
    'document-printing',
    'poster-printing',
    'thesis-printing',
    'certificate',
    'digital-printing',
]);

// Business-confirmed: only these customization groups are actually shown in the app for
// these (non-combo) services — everything else technically exists in PrintService but is
// hidden from customers there. A slug NOT listed here keeps returning every group
// (unchanged, safe default) until its in-app field list is explicitly confirmed.
const VISIBLE_CUSTOMIZATION_GROUPS_BY_SLUG = {
    'digital-printing': ['colorModes', 'paperSizes', 'paperQualities'],
};

// Services whose pricing is genuinely additive (base + independent per-dimension offsets,
// see the digital-printing/thesis-golden-bindings branches in printPricing.service.js) but
// are still presented through the same combinationPricing shape as the true combo services,
// for one consistent contract. Every dimension's options are shown as a full cross-product
// grid; a row with 2+ non-default dimensions is fully derived (base + each offset) and is
// a no-op to resend unchanged, but rejected if genuinely edited (see
// applyAdditiveCombinationUpdates) — with a single dimension (thesis-golden-bindings) this
// case never arises since every row differs in at most one dimension.
const ADDITIVE_COMBINATION_DIMENSIONS_BY_SLUG = {
    'thesis-golden-bindings': [{ key: 'bindingColor', group: 'BINDING_COLOR', optionField: 'supportedBindingColors' }],
};
const ADDITIVE_COMBINATION_WRITABLE_SLUGS = new Set(['thesis-golden-bindings']);

const resolveAdditiveDimensionOptions = (service, dimensions) =>
    dimensions.map((dim) => {
        const options = (service[dim.optionField] || []).filter((o) => o.isActive !== false);
        const defaultOption = options.find((o) => o.isDefault) || options[0];
        return { ...dim, options, defaultOption };
    });

// Builds the full cross-product grid (e.g. 2x2 = 4 rows for Digital Printing) for a
// consistent visual shape with the true combo services. Only rows with at most one
// non-default dimension are independently stored — the rest (2+ non-default dimensions)
// are fully derived (base + each offset) and shown for completeness only; see
// applyAdditiveCombinationUpdates for how writes to those cells are handled.
const buildAdditiveCombinationRows = (service, pricingConfig, dimensions) => {
    const resolvedDims = resolveAdditiveDimensionOptions(service, dimensions);
    const optionPricing = pricingConfig.optionPricing || [];
    const base = Number(pricingConfig.basePricing?.unitPrice) || 0;

    const getOffset = (group, code) => {
        const entry = optionPricing.find((e) => e.group === group && e.code === code);
        return entry ? Number(entry.unitPrice) || 0 : 0;
    };

    const buildRow = (selectionCodes) => {
        let price = base;
        const row = {};
        for (const dim of resolvedDims) {
            const code = selectionCodes[dim.key];
            const option = dim.options.find((o) => o.code === code);
            row[dim.key] = { code, label: option?.label || code };
            if (code !== dim.defaultOption?.code) {
                price += getOffset(dim.group, code);
            }
        }
        row.price = roundMoney(price);
        return row;
    };

    // Cartesian product across every dimension's options.
    let rows = [{}];
    for (const dim of resolvedDims) {
        const next = [];
        for (const partial of rows) {
            for (const option of dim.options) {
                next.push({ ...partial, [dim.key]: option.code });
            }
        }
        rows = next;
    }
    return rows.map(buildRow);
};

// Validates submitted rows and derives the new basePricing/optionPricing values. Throws
// (with statusCode) on any validation failure — never partially applies an invalid request.
//
// Rows with 0 or 1 non-default dimensions map 1:1 to a real stored value (base, or one
// optionPricing entry) and are genuinely editable. Rows with 2+ non-default dimensions are
// fully derived (base + each offset) — the GET response includes them for a complete visual
// grid, but they carry no independent storage. Since the UI resends every row verbatim
// (GET/PUT symmetry), a derived row shows up on every save even when untouched: if its
// submitted price matches what it currently computes to, it's a silent no-op; only a
// genuinely different value is rejected, with a message pointing at its component dimensions.
const applyAdditiveCombinationUpdates = (service, dimensions, pricingConfig, submittedRows) => {
    const resolvedDims = resolveAdditiveDimensionOptions(service, dimensions);
    const oldBase = Number(pricingConfig.basePricing?.unitPrice) || 0;

    const getCurrentOffset = (group, code) => {
        const entry = (pricingConfig.optionPricing || []).find((e) => e.group === group && e.code === code);
        return entry ? Number(entry.unitPrice) || 0 : 0;
    };

    const parsedRows = [];
    for (const row of submittedRows) {
        const changedDims = [];
        for (const dim of resolvedDims) {
            const submitted = row[dim.key];
            if (!submitted || !submitted.code) {
                const err = new Error(`Each combination for "${service.slug}" requires "${dim.key}"`);
                err.statusCode = 400;
                throw err;
            }
            const option = dim.options.find((o) => o.code === submitted.code);
            if (!option) {
                const err = new Error(`Unsupported ${dim.key}: ${submitted.code}`);
                err.statusCode = 400;
                throw err;
            }
            if (submitted.code !== dim.defaultOption?.code) {
                changedDims.push({ dim, code: submitted.code, option });
            }
        }

        if (changedDims.length > 1) {
            const currentTotal = roundMoney(
                oldBase + changedDims.reduce((sum, c) => sum + getCurrentOffset(c.dim.group, c.code), 0),
            );
            if (row.price === currentTotal) continue; // resent unchanged — no-op, not an edit

            const err = new Error(
                `"${changedDims.map((c) => c.dim.key).join(' + ')}" is derived from ${changedDims.map((c) => `"${c.dim.key}"`).join(' and ')} individually and can't be edited directly for "${service.slug}" — update those dimensions instead.`,
            );
            err.statusCode = 400;
            throw err;
        }

        parsedRows.push({ price: row.price, changedDim: changedDims[0] || null });
    }

    const baseRow = parsedRows.find((r) => !r.changedDim);
    const offsetRows = parsedRows.filter((r) => r.changedDim);
    const resolvedBase = baseRow ? baseRow.price : oldBase;

    const optionPricingMap = new Map(
        (pricingConfig.optionPricing || []).map((entry) => [`${entry.group}:${entry.code}`, entry]),
    );

    // Only rows whose submitted total actually differs from what's CURRENTLY stored are
    // treated as an edit — same reasoning as above, applied to single-dimension rows: if
    // the base changes in the same request, an untouched offset row's old total (computed
    // against the old base) must not be mistaken for a new offset once compared to the new base.
    for (const { price, changedDim } of offsetRows) {
        const key = `${changedDim.dim.group}:${changedDim.code}`;
        const existingEntry = optionPricingMap.get(key);
        const currentOffset = existingEntry ? Number(existingEntry.unitPrice) || 0 : 0;
        const currentTotal = roundMoney(oldBase + currentOffset);

        if (price === currentTotal) continue; // unchanged — leave the stored offset alone

        optionPricingMap.set(key, {
            group: changedDim.dim.group,
            code: changedDim.code,
            label: changedDim.option.label,
            calculationType: existingEntry?.calculationType || 'FLAT',
            unitPrice: roundMoney(price - resolvedBase),
            minPages: existingEntry?.minPages ?? null,
            maxPages: existingEntry?.maxPages ?? null,
            slabSize: existingEntry?.slabSize ?? null,
            isTaxable: existingEntry?.isTaxable !== false,
            isActive: true,
        });
    }

    return {
        newBasePricing: baseRow ? { ...pricingConfig.basePricing, unitPrice: resolvedBase } : null,
        newOptionPricing: Array.from(optionPricingMap.values()),
    };
};

const getOptionPrice = (optionPricing, group, code) => {
    const entry = (optionPricing || []).find((row) => row.group === group && row.code === code);
    return entry ? entry.unitPrice : null;
};

const priceOptionList = (options, optionPricing, group, derivedGroups, noImpactGroups) => {
    if (derivedGroups.includes(group) || noImpactGroups.includes(group)) {
        return options.map((option) => ({ ...option, price: null }));
    }
    return options.map((option) => ({ ...option, price: getOptionPrice(optionPricing, group, option.code) }));
};

const mapToggleForAdmin = (toggle) => {
    const hasSubOptions = Boolean(toggle.hasSubOptions);
    const admin = {
        code: toggle.code,
        label: toggle.label,
        hasSubOptions,
        subOptions: (toggle.subOptions || []).map((subOption) => ({
            code: subOption.code,
            label: subOption.label,
            minPages: subOption.minPages ?? null,
            maxPages: subOption.maxPages ?? null,
            price: subOption.price ?? 0,
        })),
    };
    if (!hasSubOptions) {
        admin.price = toggle.price ?? 0;
    }
    return admin;
};

const mapBindingOptionForAdmin = (option, optionPricing) => ({
    code: option.code,
    label: option.label,
    price: getOptionPrice(optionPricing, 'BINDING_OPTION', option.code),
});

const roundMoney = (value) => Math.round(value * 100) / 100;

// {code, label} pair for a dimension value — never trust a label from the client,
// always derive it from the service's own option catalog (customizationConfig).
const codeLabel = (option) => ({ code: option.code, label: option.label });

const buildDocumentPrintingCombinations = async (service, customizationConfig) => {
    const combinations = [];
    for (const color of customizationConfig.colorModes) {
        for (const size of customizationConfig.paperSizes) {
            for (const quality of customizationConfig.paperQualities) {
                const { priceSummary } = await resolvePrintPricing({
                    service,
                    customization: {
                        colorMode: color.code,
                        paperSize: size.code,
                        paperQuality: quality.code,
                        sideMode: 'SINGLE',
                        copies: 1,
                    },
                    totalPages: 1,
                    documentCount: 1,
                });
                combinations.push({
                    colorMode: codeLabel(color),
                    paperSize: codeLabel(size),
                    paperQuality: codeLabel(quality),
                    price: roundMoney(priceSummary.baseAmount),
                });
            }
        }
    }
    return combinations;
};

const buildDigitalPrintingCombinations = async (service, customizationConfig) => {
    const combinations = [];
    for (const color of customizationConfig.colorModes) {
        for (const size of customizationConfig.paperSizes) {
            for (const quality of customizationConfig.paperQualities) {
                const { priceSummary } = await resolvePrintPricing({
                    service,
                    customization: {
                        colorMode: color.code,
                        paperSize: size.code,
                        paperQuality: quality.code,
                        sideMode: 'SINGLE',
                        copies: 1,
                    },
                    totalPages: 1,
                    documentCount: 1,
                });
                combinations.push({
                    colorMode: codeLabel(color),
                    paperSize: codeLabel(size),
                    paperQuality: codeLabel(quality),
                    price: roundMoney(priceSummary.baseAmount),
                });
            }
        }
    }
    return combinations;
};

const buildPosterPrintingCombinations = async (service, customizationConfig) => {
    const combinations = [];
    for (const quality of customizationConfig.paperQualities) {
        const colorMode = quality.colorModeFilter?.[0] || 'COLOR';
        const colorOption = (customizationConfig.colorModes || []).find((c) => c.code === colorMode) || {
            code: colorMode,
            label: colorMode === 'BW' ? 'Black & White' : 'Color',
        };
        for (const size of customizationConfig.paperSizes) {
            const { priceSummary } = await resolvePrintPricing({
                service,
                customization: { colorMode, paperSize: size.code, paperQuality: quality.code, sideMode: 'SINGLE', copies: 1 },
                totalPages: 1,
                documentCount: 1,
            });
            combinations.push({
                colorMode: codeLabel(colorOption),
                paperQuality: codeLabel(quality),
                paperSize: codeLabel(size),
                price: roundMoney(priceSummary.baseAmount),
            });
        }
    }
    return combinations;
};

const buildThesisPrintingCombinations = async (service, customizationConfig) => {
    const combinations = [];
    for (const color of customizationConfig.colorModes) {
        for (const side of customizationConfig.sideModes) {
            const { priceSummary } = await resolvePrintPricing({
                service,
                customization: { colorMode: color.code, sideMode: side.code, copies: 1 },
                totalPages: 1,
                documentCount: 1,
            });
            combinations.push({
                colorMode: codeLabel(color),
                sideMode: codeLabel(side),
                price: roundMoney(priceSummary.baseAmount),
            });
        }
    }
    return combinations;
};

// certificate's combo isn't keyed by a selectable option but by a page-count
// bucket (>100 pages), so it's represented via two representative totalPages
// probes rather than an enumerable customization dimension.
const CERTIFICATE_PAGE_BUCKETS = [
    { code: 'PAGES_LTE_100', label: 'Upto 100 pages', totalPages: 50 },
    { code: 'PAGES_GT_100', label: 'Above 100 pages', totalPages: 150 },
];

const buildCertificateCombinations = async (service, customizationConfig) => {
    const combinations = [];
    // Business requirement: Admin panel only configures COLOR combinations for Certificate.
    // BW combinations remain intact in DB for future use and client app backward compatibility.
    const colorModes = (customizationConfig.colorModes || []).filter((color) => color.code === 'COLOR');
    for (const color of colorModes) {
        for (const bucket of CERTIFICATE_PAGE_BUCKETS) {
            const { priceSummary } = await resolvePrintPricing({
                service,
                customization: { colorMode: color.code, copies: 1 },
                totalPages: bucket.totalPages,
                documentCount: 1,
            });
            combinations.push({
                colorMode: codeLabel(color),
                pageBucket: { code: bucket.code, label: bucket.label },
                price: roundMoney(priceSummary.baseAmount / bucket.totalPages),
            });
        }
    }
    return combinations;
};

const buildCombinationPricing = async (service, customizationConfig) => {
    switch (service.slug) {
        case 'document-printing':
            return buildDocumentPrintingCombinations(service, customizationConfig);
        case 'digital-printing':
            return buildDigitalPrintingCombinations(service, customizationConfig);
        case 'poster-printing':
            return buildPosterPrintingCombinations(service, customizationConfig);
        case 'thesis-printing':
            return buildThesisPrintingCombinations(service, customizationConfig);
        case 'certificate':
            return buildCertificateCombinations(service, customizationConfig);
        default:
            return null;
    }
};

// Dedicated response formatter for combination-pricing services (Document Printing,
// Poster Printing, Thesis Printing, Certificate). Its output is also the exact shape
// the PUT .../pricing/combinations endpoint will accept back as a request body —
// GET/PUT symmetry, so the UI never has to reshape data. This does NOT remove
// anything from the underlying models/services — colorModes/paperSizes/orientations/
// bookletOptions/basePricing/bindingConfiguration/etc. still exist internally
// (pricingConfig.basePricing is still computed and still drives the fallback logic in
// resolvePrintPricing) — it's just left out of this specific response. bindingConfiguration
// is dropped here because binding toggles for these 4 services are either managed via the
// dedicated GET/PUT /print-services/binding-toggles endpoint (document-printing,
// thesis-printing) or aren't shown in the app at all for the other two (poster-printing,
// certificate — confirmed unused in the UI, same as orientations/bookletOptions).
const formatComboPricingResponse = (service, combinations) => ({
    service: {
        serviceId: service._id,
        name: service.name,
        slug: service.slug,
    },
    gstPercentage: service.gstPercentage ?? 18,
    combinationPricing: {
        combinations,
    },
});

export const adminListPrintServices = async (req, res) => {
    const services = await PrintService.find({ isActive: true })
        .sort({ sortOrder: 1 })
        .select('name slug serviceType badgeLabel detailImageUrl gstPercentage')
        .lean();

    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        data: {
            services: services.map((service) => ({
                serviceId: service._id,
                name: service.name,
                slug: service.slug,
                serviceType: service.serviceType,
                badgeLabel: service.badgeLabel,
                detailImageUrl: service.detailImageUrl,
                gstPercentage: service.gstPercentage ?? 18,
            })),
        },
        message: 'Active print services fetched successfully',
    });
};

export const adminGetPrintServiceCustomizations = async (req, res) => {
    const { serviceId } = req.params;

    const service = await PrintService.findOne({ _id: serviceId, isActive: true }).select('-__v').lean();
    if (!service) {
        return sendResponse({
            res,
            statusCode: httpStatus.NOT_FOUND,
            message: 'Print service not found',
        });
    }

    const pricingConfig = await getEffectivePricingConfig(service);
    const optionPricing = pricingConfig.optionPricing || [];
    const customizationConfig = buildCustomizationConfig(service, pricingConfig);

    const isComboPricingService = COMBO_PRICING_SLUGS.has(service.slug);
    const additiveDimensions = ADDITIVE_COMBINATION_DIMENSIONS_BY_SLUG[service.slug];

    // Combination-pricing services (Document Printing, Poster Printing, Thesis Printing,
    // Certificate) get the dedicated trimmed formatter — see formatComboPricingResponse.
    // Every other service keeps the existing full customizations response unchanged below.
    if (isComboPricingService) {
        const combinations = await buildCombinationPricing(service, customizationConfig);
        return sendResponse({
            res,
            statusCode: httpStatus.OK,
            data: formatComboPricingResponse(service, combinations),
            message: 'Print service customizations fetched successfully',
        });
    }

    // Additive services (e.g. Digital Printing) also get the combinationPricing shape,
    // for one consistent contract — but as a "star pattern" (see buildAdditiveCombinationRows)
    // rather than a true matrix, since their price is a sum, not a lookup.
    if (additiveDimensions) {
        const combinations = buildAdditiveCombinationRows(service, pricingConfig, additiveDimensions);
        return sendResponse({
            res,
            statusCode: httpStatus.OK,
            data: formatComboPricingResponse(service, combinations),
            message: 'Print service customizations fetched successfully',
        });
    }

    const derivedGroups = DERIVED_GROUPS_BY_SLUG[service.slug] || [];
    const noImpactGroups = NO_PRICE_IMPACT_GROUPS_BY_SLUG[service.slug] || [];

    const fullCustomizations = {
        colorModes: priceOptionList(customizationConfig.colorModes, optionPricing, 'COLOR_MODE', derivedGroups, noImpactGroups),
        paperSizes: priceOptionList(customizationConfig.paperSizes, optionPricing, 'PAPER_SIZE', derivedGroups, noImpactGroups),
        paperQualities: priceOptionList(
            customizationConfig.paperQualities,
            optionPricing,
            'PAPER_QUALITY',
            derivedGroups,
            noImpactGroups,
        ),
        orientations: priceOptionList(customizationConfig.orientations, optionPricing, 'ORIENTATION', derivedGroups, noImpactGroups),
        sideModes: priceOptionList(customizationConfig.sideModes, optionPricing, 'SIDE_MODE', derivedGroups, noImpactGroups),
        // No calculation path prices supportedBindingColors today — always null.
        bindingColors: customizationConfig.bindingColors.map((option) => ({ ...option, price: null })),
        bookletOptions: priceOptionList(
            customizationConfig.bookletOptions,
            optionPricing,
            'BOOKLET_OPTION',
            derivedGroups,
            noImpactGroups,
        ),
        bindingConfiguration: {
            // Binding toggle/sub-option prices are sourced live from PrintService itself
            // (not PrintServicePricing) at checkout time — buildCustomizationConfig already
            // carries those real values through, so no optionPricing lookup is used here.
            toggles: customizationConfig.bindingConfiguration.toggles.map(mapToggleForAdmin),
            options: customizationConfig.bindingConfiguration.options.map((option) =>
                mapBindingOptionForAdmin(option, optionPricing),
            ),
        },
    };

    const visibleGroups = VISIBLE_CUSTOMIZATION_GROUPS_BY_SLUG[service.slug];
    const customizations = visibleGroups
        ? Object.fromEntries(visibleGroups.map((group) => [group, fullCustomizations[group]]))
        : fullCustomizations;

    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        data: {
            service: {
                serviceId: service._id,
                name: service.name,
                slug: service.slug,
            },
            gstPercentage: service.gstPercentage ?? 18,
            basePricing: {
                calculationType: pricingConfig.basePricing?.calculationType || null,
                price: pricingConfig.basePricing?.unitPrice ?? null,
            },
            customizations,
            combinationPricing: null,
        },
        message: 'Print service customizations fetched successfully',
    });
};

// Which dimension fields make up a combination row, per service — drives validation,
// the merge key, and which fields get written. Order here is just the merge-key order,
// not meaningful otherwise.
const COMBO_DIMENSIONS_BY_SLUG = {
    'document-printing': ['colorMode', 'paperSize', 'paperQuality'],
    'digital-printing': ['colorMode', 'paperSize', 'paperQuality'],
    certificate: ['colorMode', 'pageBucket'],
    'poster-printing': ['colorMode', 'paperQuality', 'paperSize'],
    'thesis-printing': ['colorMode', 'sideMode'],
};

// Real, option-catalog-backed dimensions are validated against PrintService's own active
// option list. pageBucket isn't a selectable option at all (it's a computed page-count
// bucket), so it's validated against a fixed pair of codes instead.
const COMBO_DIMENSION_OPTION_FIELD = {
    colorMode: 'supportedColorModes',
    paperSize: 'supportedPaperSizes',
    paperQuality: 'supportedPaperQualities',
    sideMode: 'supportedSideModes',
};
const PAGE_BUCKET_CODES = new Set(['PAGES_LTE_100', 'PAGES_GT_100']);

const buildComboKey = (dimensions, source) => dimensions.map((dim) => source[dim]).join('|');

export const adminUpdatePrintServiceCombinationPricing = async (req, res) => {
    const { serviceId } = req.params;

    const { error, value } = updateCombinationPricingSchema.validate(req.body);
    if (error) {
        return sendResponse({ res, statusCode: httpStatus.BAD_REQUEST, message: error.details[0].message });
    }

    // Binding toggle prices live in PrintService, not PrintServicePricing — writing
    // them isn't implemented yet (needs a separate, explicitly-approved change), so
    // reject rather than silently accept a write that would appear to succeed but do nothing.
    if (value.bindingConfiguration) {
        return sendResponse({
            res,
            statusCode: httpStatus.BAD_REQUEST,
            message: 'Binding toggle pricing updates are not supported by this endpoint yet.',
        });
    }

    const service = await PrintService.findOne({ _id: serviceId, isActive: true }).select('-__v').lean();
    if (!service) {
        return sendResponse({ res, statusCode: httpStatus.NOT_FOUND, message: 'Print service not found' });
    }

    if (value.gstPercentage !== undefined) {
        await PrintService.updateOne(
            { _id: service._id },
            { $set: { gstPercentage: Number(value.gstPercentage) } },
        );
        service.gstPercentage = Number(value.gstPercentage);
    }

    const additiveDimensions = ADDITIVE_COMBINATION_DIMENSIONS_BY_SLUG[service.slug];

    // If request only updated gstPercentage (no combinations array provided or empty)
    if (!value.combinationPricing?.combinations?.length) {
        const isComboPricingService = COMBO_PRICING_SLUGS.has(service.slug);
        const pricingConfig = await getEffectivePricingConfig(service);

        if (isComboPricingService) {
            const customizationConfig = buildCustomizationConfig(service, pricingConfig);
            const combinations = await buildCombinationPricing(service, customizationConfig);
            return sendResponse({
                res,
                statusCode: httpStatus.OK,
                data: formatComboPricingResponse(service, combinations),
                message: `${service.name} pricing updated successfully`,
            });
        }

        if (additiveDimensions) {
            const combinations = buildAdditiveCombinationRows(service, pricingConfig, additiveDimensions);
            return sendResponse({
                res,
                statusCode: httpStatus.OK,
                data: formatComboPricingResponse(service, combinations),
                message: `${service.name} pricing updated successfully`,
            });
        }

        const optionPricing = pricingConfig.optionPricing || [];
        const customizationConfig = buildCustomizationConfig(service, pricingConfig);
        const derivedGroups = DERIVED_GROUPS_BY_SLUG[service.slug] || [];
        const noImpactGroups = NO_PRICE_IMPACT_GROUPS_BY_SLUG[service.slug] || [];
        const fullCustomizations = {
            colorModes: priceOptionList(customizationConfig.colorModes, optionPricing, 'COLOR_MODE', derivedGroups, noImpactGroups),
            paperSizes: priceOptionList(customizationConfig.paperSizes, optionPricing, 'PAPER_SIZE', derivedGroups, noImpactGroups),
            paperQualities: priceOptionList(
                customizationConfig.paperQualities,
                optionPricing,
                'PAPER_QUALITY',
                derivedGroups,
                noImpactGroups,
            ),
            orientations: priceOptionList(customizationConfig.orientations, optionPricing, 'ORIENTATION', derivedGroups, noImpactGroups),
            sideModes: priceOptionList(customizationConfig.sideModes, optionPricing, 'SIDE_MODE', derivedGroups, noImpactGroups),
            bindingColors: customizationConfig.bindingColors.map((option) => ({ ...option, price: null })),
            bookletOptions: priceOptionList(
                customizationConfig.bookletOptions,
                optionPricing,
                'BOOKLET_OPTION',
                derivedGroups,
                noImpactGroups,
            ),
            bindingConfiguration: {
                toggles: customizationConfig.bindingConfiguration.toggles.map(mapToggleForAdmin),
                options: customizationConfig.bindingConfiguration.options.map((option) =>
                    mapBindingOptionForAdmin(option, optionPricing),
                ),
            },
        };

        const visibleGroups = VISIBLE_CUSTOMIZATION_GROUPS_BY_SLUG[service.slug];
        const customizations = visibleGroups
            ? Object.fromEntries(visibleGroups.map((group) => [group, fullCustomizations[group]]))
            : fullCustomizations;

        return sendResponse({
            res,
            statusCode: httpStatus.OK,
            data: {
                service: {
                    serviceId: service._id,
                    name: service.name,
                    slug: service.slug,
                },
                gstPercentage: service.gstPercentage ?? 18,
                basePricing: {
                    calculationType: pricingConfig.basePricing?.calculationType || null,
                    price: pricingConfig.basePricing?.unitPrice ?? null,
                },
                customizations,
                combinationPricing: null,
            },
            message: `${service.name} pricing updated successfully`,
        });
    }
    if (additiveDimensions && ADDITIVE_COMBINATION_WRITABLE_SLUGS.has(service.slug)) {
        const pricingConfig = await getEffectivePricingConfig(service);
        const submittedRows = value.combinationPricing?.combinations || [];

        let updates;
        try {
            updates = applyAdditiveCombinationUpdates(service, additiveDimensions, pricingConfig, submittedRows);
        } catch (err) {
            return sendResponse({ res, statusCode: err.statusCode || httpStatus.BAD_REQUEST, message: err.message });
        }

        const setFields = { optionPricing: updates.newOptionPricing, updatedBy: req.user.id };
        const setOnInsertFields = { service: service._id, currency: service.currency || 'INR', isActive: true };
        if (updates.newBasePricing) {
            setFields.basePricing = updates.newBasePricing;
        } else {
            setOnInsertFields.basePricing = {
                calculationType: service.pricingModel || 'FLAT',
                unitPrice: service.basePrice || 0,
                isTaxable: true,
                isActive: true,
            };
        }

        await PrintServicePricing.findOneAndUpdate(
            { service: service._id },
            { $set: setFields, $setOnInsert: setOnInsertFields },
            { upsert: true, setDefaultsOnInsert: true },
        );

        const freshPricingConfig = await getEffectivePricingConfig(service);
        const combinations = buildAdditiveCombinationRows(service, freshPricingConfig, additiveDimensions);

        return sendResponse({
            res,
            statusCode: httpStatus.OK,
            data: formatComboPricingResponse(service, combinations),
            message: `${service.name} pricing updated successfully`,
        });
    }

    if (!COMBO_PRICING_WRITABLE_SLUGS.has(service.slug)) {
        return sendResponse({
            res,
            statusCode: httpStatus.BAD_REQUEST,
            message: `Combination pricing updates are not yet supported for "${service.slug}".`,
        });
    }

    const dimensions = COMBO_DIMENSIONS_BY_SLUG[service.slug];
    const submittedCombinations = value.combinationPricing?.combinations || [];

    const activeCodesByDimension = {};
    for (const dim of dimensions) {
        const optionField = COMBO_DIMENSION_OPTION_FIELD[dim];
        if (!optionField) continue; // pageBucket — validated separately below
        activeCodesByDimension[dim] = new Set(
            (service[optionField] || []).filter((o) => o.isActive !== false).map((o) => o.code),
        );
    }

    const rows = [];
    for (const row of submittedCombinations) {
        const rowCodes = {};
        for (const dim of dimensions) {
            if (!row[dim] || !row[dim].code) {
                return sendResponse({
                    res,
                    statusCode: httpStatus.BAD_REQUEST,
                    message: `Each combination for "${service.slug}" requires "${dim}"`,
                });
            }
            const code = row[dim].code;

            if (dim === 'pageBucket') {
                if (!PAGE_BUCKET_CODES.has(code)) {
                    return sendResponse({ res, statusCode: httpStatus.BAD_REQUEST, message: `Unsupported page bucket: ${code}` });
                }
            } else if (!activeCodesByDimension[dim].has(code)) {
                return sendResponse({ res, statusCode: httpStatus.BAD_REQUEST, message: `Unsupported ${dim}: ${code}` });
            }

            rowCodes[dim] = code;
        }
        rows.push({ ...rowCodes, unitPrice: row.price });
    }

    // Merge submitted rows into the existing comboPricing array by this service's dimension
    // set — never a full-array replace, so any combination not included in this request is
    // left exactly as it was.
    const existingProfile = await PrintServicePricing.findOne({ service: service._id }).select('comboPricing').lean();
    const normalizedExisting = (existingProfile?.comboPricing || []).map((entry) => {
        if (service.slug === 'poster-printing' && !entry.colorMode && entry.paperQuality) {
            return {
                ...entry,
                colorMode: entry.paperQuality === 'POSTER_STANDARD' ? 'BW' : 'COLOR',
            };
        }
        return entry;
    });
    const comboMap = new Map(
        normalizedExisting.map((entry) => [buildComboKey(dimensions, entry), entry]),
    );

    for (const row of rows) {
        comboMap.set(buildComboKey(dimensions, row), {
            colorMode: row.colorMode ?? null,
            paperSize: row.paperSize ?? null,
            paperQuality: row.paperQuality ?? null,
            sideMode: row.sideMode ?? null,
            pageBucket: row.pageBucket ?? null,
            unitPrice: row.unitPrice,
            isActive: true,
        });
    }

    await PrintServicePricing.findOneAndUpdate(
        { service: service._id },
        {
            $set: { comboPricing: Array.from(comboMap.values()), updatedBy: req.user.id },
            $setOnInsert: {
                service: service._id,
                currency: service.currency || 'INR',
                basePricing: {
                    calculationType: service.pricingModel || 'FLAT',
                    unitPrice: service.basePrice || 0,
                    isTaxable: true,
                    isActive: true,
                },
                optionPricing: [],
                isActive: true,
            },
        },
        { upsert: true, setDefaultsOnInsert: true },
    );

    // Re-read fresh state through the same path the GET endpoint uses (same formatter
    // too), so the response is exactly the shape the UI already knows how to render.
    const pricingConfig = await getEffectivePricingConfig(service);
    const customizationConfig = buildCustomizationConfig(service, pricingConfig);
    const combinations = await buildCombinationPricing(service, customizationConfig);

    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        data: formatComboPricingResponse(service, combinations),
        message: `${service.name} pricing updated successfully`,
    });
};

// Reads all 3 shared-binding-toggle services and builds one unified toggle list,
// trimmed to exactly {code, label, price} (or {code, label, subOptions:[{code,label,price}]})
// — code is required (the only thing PUT reads to identify a row), label is for display
// only. Since all 3 services are meant to hold identical copies, the first service that
// carries a given toggle code is used as the source of its current price.
const fetchSharedBindingToggles = async () => {
    const services = await PrintService.find({ slug: { $in: SHARED_BINDING_TOGGLE_SLUGS }, isActive: true })
        .select('slug bindingConfiguration')
        .lean();

    const byCode = new Map();
    for (const service of services) {
        const toggles = (service.bindingConfiguration?.toggles || []).filter((toggle) => toggle?.isActive !== false);
        for (const toggle of toggles) {
            if (!byCode.has(toggle.code)) byCode.set(toggle.code, toggle);
        }
    }

    const toggles = Array.from(byCode.entries()).map(([code, toggle]) => {
        const hasSubOptions = Boolean(toggle.hasSubOptions);
        const admin = { code, label: toggle.label };
        if (hasSubOptions) {
            admin.subOptions = (toggle.subOptions || []).map((subOption) => ({
                code: subOption.code,
                label: subOption.label,
                price: subOption.price ?? 0,
            }));
        } else {
            admin.price = toggle.price ?? 0;
        }
        return admin;
    });

    toggles.sort((a, b) => a.code.localeCompare(b.code));
    return toggles;
};

export const adminGetSharedBindingTogglePricing = async (req, res) => {
    const toggles = await fetchSharedBindingToggles();

    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        data: { toggles },
        message: 'Binding toggle pricing fetched successfully',
    });
};

export const adminUpdateSharedBindingTogglePricing = async (req, res) => {
    const { error, value } = updateSharedBindingTogglePricingSchema.validate(req.body);
    if (error) {
        return sendResponse({ res, statusCode: httpStatus.BAD_REQUEST, message: error.details[0].message });
    }

    const services = await PrintService.find({ slug: { $in: SHARED_BINDING_TOGGLE_SLUGS }, isActive: true })
        .select('_id slug bindingConfiguration')
        .lean();

    if (services.length === 0) {
        return sendResponse({ res, statusCode: httpStatus.NOT_FOUND, message: 'No binding-toggle services found' });
    }

    // Map each known toggle/sub-option code to exactly which of the 3 services actually
    // contain it — a toggle only gets written to services that already have that code,
    // never invented on a service that doesn't offer it.
    const serviceIdsByToggleCode = new Map();
    const serviceIdsBySubOptionKey = new Map();

    for (const service of services) {
        for (const toggle of service.bindingConfiguration?.toggles || []) {
            if (toggle.isActive === false) continue;

            if (!serviceIdsByToggleCode.has(toggle.code)) serviceIdsByToggleCode.set(toggle.code, new Set());
            serviceIdsByToggleCode.get(toggle.code).add(String(service._id));

            for (const subOption of toggle.subOptions || []) {
                const key = `${toggle.code}:${subOption.code}`;
                if (!serviceIdsBySubOptionKey.has(key)) serviceIdsBySubOptionKey.set(key, new Set());
                serviceIdsBySubOptionKey.get(key).add(String(service._id));
            }
        }
    }

    for (const row of value.toggles) {
        if (!serviceIdsByToggleCode.has(row.code)) {
            return sendResponse({ res, statusCode: httpStatus.BAD_REQUEST, message: `Unsupported binding toggle: ${row.code}` });
        }
        for (const subOption of row.subOptions || []) {
            const key = `${row.code}:${subOption.code}`;
            if (!serviceIdsBySubOptionKey.has(key)) {
                return sendResponse({
                    res,
                    statusCode: httpStatus.BAD_REQUEST,
                    message: `Unsupported sub-option "${subOption.code}" for toggle "${row.code}"`,
                });
            }
        }
    }

    // Targeted, price-only writes — one update per (service, toggle) pair, touching only
    // the numeric price field via arrayFilters. Never touches label/hasSubOptions/
    // minPages/maxPages or adds/removes anything.
    for (const row of value.toggles) {
        const serviceIds = Array.from(serviceIdsByToggleCode.get(row.code));

        for (const serviceId of serviceIds) {
            if (row.price !== undefined) {
                await PrintService.updateOne(
                    { _id: serviceId },
                    { $set: { 'bindingConfiguration.toggles.$[toggle].price': row.price } },
                    { arrayFilters: [{ 'toggle.code': row.code }] },
                );
            }
            for (const subOption of row.subOptions || []) {
                await PrintService.updateOne(
                    { _id: serviceId },
                    { $set: { 'bindingConfiguration.toggles.$[toggle].subOptions.$[sub].price': subOption.price } },
                    { arrayFilters: [{ 'toggle.code': row.code }, { 'sub.code': subOption.code }] },
                );
            }
        }
    }

    const toggles = await fetchSharedBindingToggles();

    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        data: { toggles },
        message: 'Binding toggle pricing updated successfully',
    });
};

export const getAdminPrintServicePricing = async (req, res) => {
    const { serviceId } = req.params;

    const service = await PrintService.findById(serviceId).select('-__v').lean();
    if (!service) {
        return sendResponse({
            res,
            statusCode: httpStatus.NOT_FOUND,
            message: 'Print service not found',
        });
    }

    const pricingConfig = await getEffectivePricingConfig(service);

    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        data: {
            service: {
                id: service._id,
                name: service.name,
                slug: service.slug,
                serviceType: service.serviceType,
            },
            currency: pricingConfig.currency || service.currency || 'INR',
            pricingConfig: {
                basePricing: pricingConfig.basePricing,
                optionPricing: pricingConfig.optionPricing,
                source: pricingConfig.source,
            },
        },
        message: 'Print service pricing fetched successfully',
    });
};

export const upsertAdminPrintServicePricing = async (req, res) => {
    const { serviceId } = req.params;
    const { error, value } = upsertPrintServicePricingSchema.validate(req.body);

    if (error) {
        return sendResponse({
            res,
            statusCode: httpStatus.BAD_REQUEST,
            message: error.details[0].message,
        });
    }

    const service = await PrintService.findById(serviceId).select('name slug serviceType currency');
    if (!service) {
        return sendResponse({
            res,
            statusCode: httpStatus.NOT_FOUND,
            message: 'Print service not found',
        });
    }

    const pricingProfile = await PrintServicePricing.findOneAndUpdate(
        { service: service._id },
        {
            $set: {
                service: service._id,
                currency: value.currency || service.currency || 'INR',
                basePricing: value.basePricing,
                optionPricing: value.optionPricing,
                updatedBy: req.user.id,
                isActive: true,
            },
        },
        { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
    ).select('-__v');

    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        data: pricingProfile,
        message: 'Print service pricing saved successfully',
    });
};

// controllers/printService.controller.js
import httpStatus from 'http-status';
import mongoose from 'mongoose';
import { sendResponse } from '#utils/generalHelper';
import PrintService from '#models/printService';
import { buildFilteredPrintServiceDetailResponse, resolvePrintPricing } from '#services/printPricing';

export const getPrintServices = async (req, res) => {
    const { filter } = req.query;
    const isDetailFilter = filter === 'detail';

    const selectFields = isDetailFilter
        ? 'name slug serviceType badgeLabel detailDescriptions detailImageUrl basePrice allowsMultipleFiles pricingModel'
        : 'name slug serviceType badgeLabel listImageUrl basePrice allowsMultipleFiles pricingModel bgColor';

    const services = await PrintService.find({ isActive: true }).sort({ sortOrder: 1 }).select(selectFields).lean();

    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        data: services,
        message: 'Print services fetched successfully',
    });
};

export const getPrintServiceDetails = async (req, res) => {
    const { slug } = req.params;
    const { section, colorCode } = req.query;

    const service = await PrintService.findOne({ slug, isActive: true }).select('-__v').lean();

    if (!service) {
        return sendResponse({
            res,
            statusCode: httpStatus.NOT_FOUND,
            message: 'Print service not found',
        });
    }

    let detailPayload;
    try {
        detailPayload = await buildFilteredPrintServiceDetailResponse(service, section, { colorCode });
    } catch (error) {
        return sendResponse({
            res,
            statusCode: error.statusCode || httpStatus.BAD_REQUEST,
            message: error.message || 'Unable to build print service details',
        });
    }

    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        data: detailPayload,
        message: 'Print service details fetched successfully',
    });
};

export const getPrintServiceSliderDetails = async (req, res) => {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
        return sendResponse({
            res,
            statusCode: httpStatus.BAD_REQUEST,
            message: 'Invalid print service ID format',
        });
    }

    const service = await PrintService.findById(id).select('shortDescription sliderImages deliveryNote').lean();

    if (!service) {
        return sendResponse({
            res,
            statusCode: httpStatus.NOT_FOUND,
            message: 'Print service not found',
        });
    }

    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        data: {
            shortDescription: service.shortDescription || [],
            sliderImages: service.sliderImages || [],
            deliveryNote: service.deliveryNote || '',
        },
        message: 'Data fetched successfully',
    });
};

export const getQuickPrintConfig = async (req, res) => {
    const service = await PrintService.findOne({ slug: 'document-printing', isActive: true }).select('-__v').lean();
    if (!service) {
        return sendResponse({
            res,
            statusCode: httpStatus.NOT_FOUND,
            message: 'Document printing service not found',
        });
    }

    // Extract customization selections from query params
    const paperSize = req.query.paperSize || 'A4';
    const colorMode = req.query.colorMode || 'BW';
    const sideMode = req.query.sideMode || 'SINGLE';

    // Calculate dynamic base price per page from the same live pricing engine used at
    // checkout (admin-editable via PrintServicePricing.comboPricing) — instead of the
    // hardcoded table this used to duplicate. paperQuality is pinned to STANDARD_70_75_GSM
    // to match createQuickPrintDocument, which always creates Quick Print documents at
    // that quality regardless of colorMode — otherwise this preview could show a
    // different price than what the customer is actually charged after upload.
    let dynamicBasePrice;
    try {
        const { priceSummary } = await resolvePrintPricing({
            service,
            customization: { paperSize, colorMode, sideMode, paperQuality: 'STANDARD_70_75_GSM', copies: 1 },
            totalPages: 1,
            documentCount: 1,
        });
        dynamicBasePrice = priceSummary.baseAmount;
    } catch (err) {
        return sendResponse({
            res,
            statusCode: httpStatus.BAD_REQUEST,
            message: err.message,
        });
    }

    const colorModes =
        service.supportedColorModes
            ?.filter((o) => o.isActive !== false)
            .map((o) => ({ code: o.code, label: o.label })) || [];
    const paperSizes =
        service.supportedPaperSizes
            ?.filter((o) => o.isActive !== false)
            .map((o) => ({ code: o.code, label: o.label })) || [];
    const sideModes =
        service.supportedSideModes
            ?.filter((o) => o.isActive !== false)
            .map((o) => ({ code: o.code, label: o.label })) || [];
    const copiesConfig = service.copiesConfig || { min: 1, max: 500, default: 1 };

    // Parse and validate optional copies query parameter
    const rawCopies = req.query.copies;
    let copies;

    if (rawCopies === undefined || rawCopies === null || rawCopies === '') {
        copies = copiesConfig.default || 1;
    } else {
        const parsed = Number(rawCopies);

        if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
            return sendResponse({
                res,
                statusCode: httpStatus.BAD_REQUEST,
                message: 'copies must be a valid integer',
            });
        }

        const minCopies = Number(copiesConfig.min) || 1;
        const maxCopies = copiesConfig.max != null ? Number(copiesConfig.max) : null;

        if (parsed < minCopies) {
            return sendResponse({
                res,
                statusCode: httpStatus.BAD_REQUEST,
                message: `copies must be at least ${minCopies}`,
            });
        }

        if (maxCopies !== null && parsed > maxCopies) {
            return sendResponse({
                res,
                statusCode: httpStatus.BAD_REQUEST,
                message: `copies must not exceed ${maxCopies}`,
            });
        }

        copies = parsed;
    }

    const subtotal = dynamicBasePrice * copies;

    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        data: {
            slug: service.slug,
            basePrice: dynamicBasePrice,
            copies,
            subtotal,
            currency: service.currency || 'INR',
            colorModes,
            paperSizes,
            sideModes,
            copiesConfig,
        },
        message: 'Quick Print configuration fetched successfully',
    });
};

import httpStatus from 'http-status';
import Joi from 'joi';
import env from '#configs/env';
import chalk from 'chalk';
import { UI_PRINT_LABELS } from '#constants/printMappings';
import { sendResponse, getReadableFileTypes, debugBatchFileUrls } from '#utils/generalHelper';
import PrintDocument from '#models/printDocument';
import PrintCustomization from '#models/printCustomization';
import Cart from '#models/cart';
import { revalidateCartCoupon } from './cart.controller.js';
import { resolveDocumentPropertiesFromUrl } from '#services/documentProcessing';
import {
    batchCreateDocumentsSchema,
    createDocumentSchema,
    updateDocumentCustomizationSchema,
    validateDocumentCustomizationAgainstService,
    sanitizeUrl,
} from '#validations/printDocument';
import PrintService from '#models/printService';
import { resolvePrintPricing } from '#services/printPricing';
import { extractFileMetadataFromUrl } from '#utils/fileMetadata';
import { attachPresignedUrls, resolvePresignedGetUrl, extractS3KeyFromUrl } from '#utils/s3Presigned';

const GST_RATE_PERCENT = 18;

const getOriginalFileNameFromUrl = (fileUrl, fallbackName = 'Document') => {
    if (!fileUrl) return fallbackName;
    try {
        const meta = extractFileMetadataFromUrl(fileUrl);
        return meta.originalFileName || fallbackName;
    } catch {
        try {
            const cleanUrl = fileUrl.split('?')[0];
            const fileName = decodeURIComponent(cleanUrl.substring(cleanUrl.lastIndexOf('/') + 1));
            return fileName || fallbackName;
        } catch {
            return fallbackName;
        }
    }
};

const roundCurrency = (amount = 0) => Number((Number(amount) || 0).toFixed(2));

const formatCurrency = (amount = 0) => roundCurrency(amount);

const injectCustomizationLabels = (customization = {}, serviceSlug = '', service = null) => {
    if (!customization) return;
    let quality = '';
    const size = customization.paperSize || '';
    const color = customization.colorMode || '';

    // Prefer label from the service's supportedPaperQualities when a code is stored
    if (customization.paperQuality && service?.supportedPaperQualities?.length > 0) {
        const option = service.supportedPaperQualities.find((o) => o.code === customization.paperQuality);
        quality = option?.label || customization.paperQuality;
    } else {
        // Legacy fallback: derive label from service slug + color/size combos
        if (serviceSlug === 'document-printing') {
            if (size === 'A4' || size === 'A3') {
                quality = color === 'COLOR' ? '100 GSM' : '70-75 GSM';
            }
        } else if (serviceSlug === 'digital-printing' && service?.supportedPaperQualities?.length > 0) {
            const matched = service.supportedPaperQualities.find((o) => {
                if (o.isActive === false) return false;
                const filter = o.colorModeFilter || [];
                return filter.length > 0 && filter.includes(color);
            });
            const fallback =
                service.supportedPaperQualities.find((o) => o.isActive !== false && o.isDefault) ||
                service.supportedPaperQualities.find((o) => o.isActive !== false);
            quality = (matched || fallback)?.label || '';
        } else if (serviceSlug === 'thesis-printing') {
            const defaultOption =
                service?.supportedPaperQualities?.find((o) => o.isDefault === true) ||
                service?.supportedPaperQualities?.[0];
            quality = defaultOption?.label || '';
        } else if (serviceSlug === 'thesis-golden-bindings') {
            quality = color === 'COLOR' ? '100 GSM' : '70-75 GSM';
        } else if (serviceSlug === 'photo-printing' && service?.supportedPaperQualities?.length > 0) {
            const defaultOption =
                service.supportedPaperQualities.find((o) => o.isActive !== false && o.isDefault) ||
                service.supportedPaperQualities.find((o) => o.isActive !== false);
            quality = defaultOption?.label || '300 GSM Art Card';
        } else if (serviceSlug === 'certificate' && service?.supportedPaperQualities?.length > 0) {
            const defaultOption =
                service.supportedPaperQualities.find((o) => o.isActive !== false && o.isDefault) ||
                service.supportedPaperQualities.find((o) => o.isActive !== false);
            quality = defaultOption?.label || 'Matt Sheet(250GSM)';
        } else if (serviceSlug === 'poster-printing') {
            quality = color === 'COLOR' ? 'Glossy' : 'Normal Sheet';
        }
    }

    delete customization.paperQuality;
    customization.paperQualityLabel = quality;

    customization.orientationLabel = UI_PRINT_LABELS[customization.orientation] || customization.orientation || '';
    customization.sideModeLabel = UI_PRINT_LABELS[customization.sideMode] || customization.sideMode || '';
    customization.bookletOptionCodesLabel =
        UI_PRINT_LABELS[customization.bookletOptionCodes] || customization.bookletOptionCodes || '';
    customization.selectedBindingColorCodeLabel =
        UI_PRINT_LABELS[customization.selectedBindingColorCode] || customization.selectedBindingColorCode || '';
    customization.bindingSelections = customization.bindingSelections || [];
};

const calculateDocumentPrices = async (document, serviceMap = new Map()) => {
    const serviceId = document?.service?.toString?.() || document?.service?.toString() || null;
    if (!serviceId) return { singleDocPrice: 0, finalDocPrice: 0 };

    let service = serviceMap.get(serviceId);
    if (!service) {
        service = await PrintService.findOne({ _id: serviceId, isActive: true }).select('-__v').lean();
        if (service) {
            serviceMap.set(serviceId, service);
        }
    }

    if (!service) return { singleDocPrice: 0, finalDocPrice: 0 };

    try {
        const customization = document.customization || {};

        // Final Doc Price (with multiple copies)
        const pricingResult = await resolvePrintPricing({
            service,
            customization,
            totalPages: document.pageCount || 0,
            documentCount: 1,
        });

        const finalDocPrice = pricingResult.priceSummary?.taxableAmount || 0;

        // Single Doc Price (1 copy)
        const singleDocPricingResult = await resolvePrintPricing({
            service,
            customization: { ...customization, copies: 1 },
            totalPages: document.pageCount || 0,
            documentCount: 1,
        });

        const singleDocPrice = singleDocPricingResult.priceSummary?.taxableAmount || 0;

        return {
            singleDocPrice: roundCurrency(singleDocPrice),
            finalDocPrice: roundCurrency(finalDocPrice),
        };
    } catch (error) {
        return { singleDocPrice: 0, finalDocPrice: 0 };
    }
};

const buildCustomizationPayload = (customization = {}) => ({
    copies: customization.copies || 1,
    orientation: customization.orientation || '',
    paperSize: customization.paperSize || '',
    colorMode: customization.colorMode || '',
    sideMode: customization.sideMode || 'SINGLE',
    paperQuality: customization.paperQuality || '',
    bindingSelections: customization.bindingSelections || [],
    selectedBindingColorCode: customization.selectedBindingColorCode || '',
    bookletOptionCodes: customization.bookletOptionCodes || '',
    notes: customization.notes || '',
    completedAt: new Date(),
});

const buildCustomizationUpdatePayload = (customization = {}) => {
    const updatePayload = {};

    const fieldMap = [
        'copies',
        'orientation',
        'paperSize',
        'colorMode',
        'sideMode',
        'paperQuality',
        'bindingSelections',
        'selectedBindingColorCode',
        'bookletOptionCodes',
        'notes',
    ];

    for (const field of fieldMap) {
        if (!Object.prototype.hasOwnProperty.call(customization, field)) continue;

        let value = customization[field];

        // Map null to empty string to keep schema types clean and allow intentional clearing of data
        if (value === null) value = '';

        // Special handling
        if (field === 'copies') {
            value = value > 0 ? value : 1;
        }

        updatePayload[`customization.${field}`] = value;
    }

    // ✅ Only set completedAt if actual update exists
    if (Object.keys(updatePayload).length > 0) {
        updatePayload['customization.completedAt'] = new Date();
    }

    return updatePayload;
};

const isCustomizationDifferent = (existing = {}, incoming = {}) => {
    const fields = [
        'copies',
        'orientation',
        'paperSize',
        'colorMode',
        'sideMode',
        'paperQuality',
        'bindingSelections',
        'selectedBindingColorCode',
        'bookletOptionCodes',
        'notes',
    ];

    for (const field of fields) {
        const existingVal = existing[field];
        const incomingVal = incoming[field];

        if (field === 'bindingSelections') {
            const existingStr = JSON.stringify(existingVal || []);
            const incomingStr = JSON.stringify(incomingVal || []);
            if (existingStr !== incomingStr) return true;
            continue;
        }

        if (typeof existingVal === 'boolean' || typeof incomingVal === 'boolean') {
            if (Boolean(existingVal) !== Boolean(incomingVal)) return true;
            continue;
        }

        if (String(existingVal || '').trim() !== String(incomingVal || '').trim()) return true;
    }

    return false;
};

const buildDocumentPayload = async ({ document, userId, fallbackServiceId = null, service = null }) => {
    const resolvedDocumentProperties = await resolveDocumentPropertiesFromUrl(document.fileUrl);

    if (service) {
        if (
            service.allowedMimeTypes?.length > 0 &&
            !service.allowedMimeTypes.includes(resolvedDocumentProperties.mimeType)
        ) {
            const readableTypes = getReadableFileTypes(service.allowedMimeTypes);
            console.warn(
                `[UPLOAD] REJECTED: File "${resolvedDocumentProperties.originalFileName || 'document'}" | Format: ${resolvedDocumentProperties.fileExtension || 'unknown'} | MIME: ${resolvedDocumentProperties.mimeType || 'unknown'} | Reason: Invalid file type`,
            );
            throw new Error(`Invalid file type. Allowed types: ${readableTypes}`);
        }
        if (service.maxPagesPerFile && resolvedDocumentProperties.pageCount > service.maxPagesPerFile) {
            throw new Error(
                `Document exceeds the maximum allowed pages for this service. (Max: ${service.maxPagesPerFile})`,
            );
        }
    }

    const rawS3Key = extractS3KeyFromUrl(document.fileUrl) || document.fileUrl;

    return {
        user: userId,
        service: document.service || fallbackServiceId || null,
        originalFileName: resolvedDocumentProperties.originalFileName,
        fileExtension: resolvedDocumentProperties.fileExtension,
        mimeType: resolvedDocumentProperties.mimeType,
        fileSizeBytes: resolvedDocumentProperties.fileSizeBytes,
        pageCount: resolvedDocumentProperties.pageCount,
        fileUrl: rawS3Key,
        storageProvider: 'S3',
        storageKey: resolvedDocumentProperties.storageKey || rawS3Key || '',
        uploadStatus: 'UPLOADED',
        customization: buildCustomizationPayload(document.customization),
    };
};

export const saveDocumentDetails = async (req, res) => {
    const { error, value } = createDocumentSchema.validate(req.body);

    if (error) {
        return sendResponse({ res, statusCode: httpStatus.BAD_REQUEST, message: error.details[0].message });
    }

    let payload;
    try {
        const serviceId = value.service || null;
        let service = null;
        if (serviceId) {
            service = await PrintService.findOne({ _id: serviceId, isActive: true })
                .select('allowedMimeTypes maxPagesPerFile slug')
                .lean();
        }

        payload = await buildDocumentPayload({
            document: value,
            userId: req.user.id,
            fallbackServiceId: serviceId,
            service,
        });
    } catch (processingError) {
        console.error(`[UPLOAD] ERROR: Document processing failed: ${processingError.message}`);
        return sendResponse({
            res,
            statusCode: httpStatus.BAD_REQUEST,
            message: processingError.message || 'Unable to process document file',
        });
    }

    const newDocument = await PrintDocument.create(payload);
    console.log(
        `[UPLOAD] Created document: ${newDocument._id} | File: ${newDocument.originalFileName} | Format: ${newDocument.fileExtension} | PageCount: ${newDocument.pageCount} | Size: ${newDocument.fileSizeBytes} bytes`,
    );
    const docObject = newDocument.toObject();
    const isBindingRequired = service && !['thesis-printing'].includes(service.slug) ? true : false;
    const isBindingColorRequired = service && service.slug === 'thesis-golden-bindings' ? true : false;
    if (docObject.customization) {
        docObject.customization.isColored = docObject.customization.colorMode === 'COLOR';
        docObject.customization.isBindingRequired = isBindingRequired;
        docObject.customization.isBindingColorRequired = isBindingColorRequired;
        injectCustomizationLabels(docObject.customization, service?.slug, service);
    }

    docObject.fileUrl = await resolvePresignedGetUrl(docObject.fileUrl);

    return sendResponse({
        res,
        statusCode: httpStatus.CREATED,
        data: docObject,
        message: 'Document saved successfully',
    });
};

export const saveBatchDocumentDetails = async (req, res) => {
    // [BATCH_FILE_URL_DEBUG][VALIDATION_FLOW] Start of controller before validation
    debugBatchFileUrls(req.body?.documents);

    const { error, value } = batchCreateDocumentsSchema.validate(req.body);

    if (error) {
        return sendResponse({
            res,
            statusCode: httpStatus.BAD_REQUEST,
            message: error.details[0].message,
        });
    }

    try {
        // ✅ STEP 1: Collect all serviceIds (current + future-safe)
        const serviceIds = new Set();

        // fallback serviceId
        if (value.serviceId) {
            serviceIds.add(value.serviceId.toString());
        }

        // if documents can have their own serviceId (future-proofing)
        value.documents.forEach((doc) => {
            if (doc.serviceId) {
                serviceIds.add(doc.serviceId.toString());
            }
        });

        // ✅ STEP 2: Validate all services at once
        const services = await PrintService.find({
            _id: { $in: [...serviceIds] },
            isActive: true,
        })
            .select('_id allowedMimeTypes maxPagesPerFile slug')
            .lean();

        const serviceMap = new Map(services.map((s) => [s._id.toString(), s]));
        const validServiceIds = new Set(serviceMap.keys());

        // ❌ STEP 3: Detect invalid services BEFORE processing
        const invalidServiceIds = [...serviceIds].filter((id) => !validServiceIds.has(id));

        if (invalidServiceIds.length > 0) {
            return sendResponse({
                res,
                statusCode: httpStatus.NOT_FOUND,
                message: `Invalid or inactive service(s): ${invalidServiceIds.join(', ')}`,
            });
        }

        console.log(
            `[UPLOAD] Processing batch upload of ${value.documents.length} document(s) for User: ${req.user.id}`,
        );

        // ✅ STEP 4: Process documents (always create new)
        const results = await Promise.all(
            value.documents.map(async (doc) => {
                const serviceId = doc.service || value.serviceId || null;
                const userId = req.user.id;

                const payload = await buildDocumentPayload({
                    document: doc,
                    userId,
                    fallbackServiceId: serviceId,
                    service: serviceId ? serviceMap.get(serviceId.toString()) : null,
                });

                const newDocument = await PrintDocument.create(payload);
                console.log(
                    `[UPLOAD] Created document: ${newDocument._id} | File: ${newDocument.originalFileName} | Format: ${newDocument.fileExtension} | PageCount: ${newDocument.pageCount} | Size: ${newDocument.fileSizeBytes} bytes`,
                );
                return { document: newDocument.toObject(), clientDocumentKey: doc.clientDocumentKey };
            }),
        );

        const responseData = results.map(({ document, clientDocumentKey }) => {
            const serviceId = document.service?.toString();
            const service = serviceId ? serviceMap.get(serviceId) : null;
            const isBindingRequired = service && !['thesis-printing'].includes(service.slug) ? true : false;
            const isBindingColorRequired = service && service.slug === 'thesis-golden-bindings' ? true : false;
            const customization = {
                ...document.customization,
                isColored: document.customization?.colorMode === 'COLOR',
                isBindingRequired,
                isBindingColorRequired,
            };
            injectCustomizationLabels(customization, service?.slug, service);
            return {
                _id: document._id,
                clientDocumentKey: clientDocumentKey || '',
                originalFileName: document.originalFileName,
                fileExtension: document.fileExtension,
                mimeType: document.mimeType,
                fileSizeBytes: document.fileSizeBytes,
                pageCount: document.pageCount,
                customization,
            };
        });
        // responseData
        return sendResponse({
            res,
            statusCode: httpStatus.CREATED,
            data: responseData,
            message: 'Documents saved successfully',
        });
    } catch (err) {
        console.error(`[UPLOAD] ERROR: Document processing failed: ${err.message}`);
        return sendResponse({
            res,
            statusCode: httpStatus.BAD_REQUEST,
            message: err.message || 'Unable to process documents',
        });
    }
};

export const getUserDocuments = async (req, res) => {
    const selectFields =
        '_id user service originalFileName fileUrl fileExtension pageCount customization isDeleted cartStatus createdAt updatedAt';
    const { cartItemId } = req.query || {};

    let documents = [];

    if (cartItemId) {
        // Query only the document linked to this specific edit session
        const session = await PrintCustomization.findOne({
            user: req.user.id,
            cartItemId,
            status: 'PENDING',
        })
            .select('documentId')
            .lean();

        if (session) {
            documents = await PrintDocument.find({
                _id: session.documentId,
                user: req.user.id,
                isDeleted: false,
            })
                .select(selectFields)
                .lean();
        }
    } else {
        // Fetch soft TTL configurations
        const ttlHours = Number(process.env.AVAILABLE_DOCUMENT_TTL_HOURS) || env.AVAILABLE_DOCUMENT_TTL_HOURS || 1;
        const softExpiryThreshold = new Date(Date.now() - ttlHours * 60 * 60 * 1000);

        // Return only AVAILABLE documents within the soft-expiry threshold.
        // IN_CART, ORDERED, REMOVED, and other non-AVAILABLE documents are
        // never returned regardless of customization session state.
        documents = await PrintDocument.find({
            user: req.user.id,
            isDeleted: false,
            cartStatus: 'AVAILABLE',
            createdAt: { $gte: softExpiryThreshold },
        })
            .select(selectFields)
            .sort({ createdAt: -1 })
            .lean();
    }

    const serviceIds = [...new Set(documents.map((document) => document.service?.toString()).filter(Boolean))];
    const services = await PrintService.find({ _id: { $in: serviceIds }, isActive: true })
        .select('-__v')
        .lean();
    const serviceMap = new Map(services.map((service) => [service._id.toString(), service]));

    const documentPrices = await Promise.all(
        documents.map((document) => calculateDocumentPrices(document, serviceMap)),
    );

    const totalPrice = formatCurrency(documentPrices.reduce((sum, prices) => sum + prices.finalDocPrice, 0));

    // True when any document in the list belongs to Thesis Binding —
    // signals the UI to render the binding color dropdown
    const isBindingColorRequired = services.some((service) => service.slug === 'thesis-golden-bindings');

    const responseDocuments = documents.map(({ pageCount, customization, ...document }, index) => {
        const serviceId = document.service?.toString();
        const service = serviceId ? serviceMap.get(serviceId) : null;
        const isBindingRequired = service && !['thesis-printing'].includes(service.slug) ? true : false;
        const isBindingColorRequiredDoc = service && service.slug === 'thesis-golden-bindings' ? true : false;
        const cust = {
            ...customization,
            sideMode: customization?.sideMode || 'SINGLE',
            isColored: customization?.colorMode === 'COLOR',
            isBindingRequired,
            isBindingColorRequired: isBindingColorRequiredDoc,
            singleDocPrice: formatCurrency(documentPrices[index].singleDocPrice),
            finalDocPrice: formatCurrency(documentPrices[index].finalDocPrice),
        };
        injectCustomizationLabels(cust, service?.slug, service);
        return {
            ...document,
            serviceName: service?.name || '',
            serviceSlug: service?.slug || '',
            originalFileName:
                document.originalFileName || getOriginalFileNameFromUrl(document.fileUrl, `Document ${index + 1}`),
            pageCount: pageCount || 0,
            customization: cust,
        };
    });

    const responseWithPresigned = await attachPresignedUrls(responseDocuments, ['fileUrl']);

    return res.status(httpStatus.OK).json({
        status: true,
        message: 'Documents fetched successfully',
        data: responseWithPresigned,
        totalPrice,
        isBindingColorRequired,
    });
};

export const getDocumentById = async (req, res) => {
    const { documentId } = req.params;

    const selectFields =
        '_id user service originalFileName pageCount fileUrl fileExtension customization isDeleted createdAt updatedAt';
    const document = await PrintDocument.findOne({ _id: documentId, user: req.user.id, isDeleted: false })
        .select(selectFields)
        .lean();

    if (!document) {
        return sendResponse({ res, statusCode: httpStatus.NOT_FOUND, message: 'Document not found' });
    }

    let isBindingRequired = false;
    let isBindingColorRequired = false;
    let serviceSlug = '';
    let serviceName = '';
    let service = null;
    if (document.service) {
        service = await PrintService.findOne({ _id: document.service, isActive: true })
            .select('slug name supportedPaperQualities')
            .lean();
        if (service) {
            serviceSlug = service.slug || '';
            serviceName = service.name || '';
            if (!['thesis-printing'].includes(service.slug)) {
                isBindingRequired = true;
            }
            if (service.slug === 'thesis-golden-bindings') {
                isBindingColorRequired = true;
            }
        }
    }

    const c = document.customization || {};
    c.sideMode = c.sideMode || 'SINGLE';
    c.isColored = c.colorMode === 'COLOR';
    c.isBindingRequired = isBindingRequired;
    c.isBindingColorRequired = isBindingColorRequired;
    injectCustomizationLabels(c, serviceSlug, service);
    document.customization = c;

    const presignedFileUrl = await resolvePresignedGetUrl(document.fileUrl);

    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        data: {
            ...document,
            fileUrl: presignedFileUrl,
            serviceName,
            serviceSlug,
            originalFileName: document.originalFileName || getOriginalFileNameFromUrl(document.fileUrl),
        },
        message: 'Document fetched successfully',
    });
};

export const updateDocumentCustomization = async (req, res) => {
    const { documentId } = req.params;
    const { error, value } = updateDocumentCustomizationSchema.validate(req.body);
    console.log('value: ', value);

    if (error) {
        return sendResponse({
            res,
            statusCode: httpStatus.BAD_REQUEST,
            message: error.details[0].message,
        });
    }

    const existingDocument = await PrintDocument.findOne({ _id: documentId, user: req.user.id, isDeleted: false })
        .select('_id service customization')
        .lean();

    if (!existingDocument) {
        return sendResponse({
            res,
            statusCode: httpStatus.NOT_FOUND,
            message: 'Document not found',
        });
    }

    const service = await PrintService.findOne({ _id: existingDocument.service, isActive: true }).select('-__v').lean();
    const customizationValidationError = validateDocumentCustomizationAgainstService({
        customization: value,
        service,
    });

    if (customizationValidationError) {
        return sendResponse({
            res,
            statusCode: httpStatus.BAD_REQUEST,
            message: customizationValidationError,
        });
    }

    // value is already flat customization
    const customizationUpdate = buildCustomizationUpdatePayload(value);

    const selectFields =
        '_id user service originalFileName pageCount fileUrl fileExtension customization isDeleted createdAt updatedAt';

    const updatedDocument = await PrintDocument.findOneAndUpdate(
        { _id: documentId, user: req.user.id, isDeleted: false },
        { $set: customizationUpdate },
        { returnDocument: 'after', runValidators: true },
    )
        .select(selectFields)
        .lean();

    const updatedPrices = await calculateDocumentPrices(updatedDocument);

    // 1. Fetch any PENDING customization sessions for this user to get their document IDs and associated cart items
    const pendingSessions = await PrintCustomization.find({
        user: req.user.id,
        status: 'PENDING',
    })
        .select('documentId cartItemId')
        .lean();

    const pendingDocIds = pendingSessions.map((session) => session.documentId.toString());

    // Detect if we are in cart-edit/re-customization mode
    const currentSession = pendingSessions.find((session) => session.documentId.toString() === documentId);
    const cartItemId = req.query.cartItemId || currentSession?.cartItemId;

    let allDocuments = [];

    if (cartItemId) {
        // In cart-edit mode, only query the single document being edited
        allDocuments = await PrintDocument.find({
            _id: documentId,
            user: req.user.id,
            isDeleted: false,
        })
            .select('service pageCount customization')
            .lean();
    } else {
        // 2. Fetch soft TTL configurations
        const ttlHours = Number(process.env.AVAILABLE_DOCUMENT_TTL_HOURS) || env.AVAILABLE_DOCUMENT_TTL_HOURS || 1;
        const softExpiryThreshold = new Date(Date.now() - ttlHours * 60 * 60 * 1000);

        // 3. Query documents matching either:
        //    - AVAILABLE and created/updated within the TTL threshold
        //    - Linked to an active PENDING customization session (regardless of cartStatus)
        //    - The document currently being updated (to ensure it is always counted)
        allDocuments = await PrintDocument.find({
            user: req.user.id,
            isDeleted: false,
            $or: [
                {
                    cartStatus: 'AVAILABLE',
                    createdAt: { $gte: softExpiryThreshold },
                },
                {
                    _id: { $in: [...pendingDocIds, documentId] },
                },
            ],
        })
            .select('service pageCount customization')
            .lean();
    }

    const serviceIds = [...new Set(allDocuments.map((doc) => doc.service?.toString()).filter(Boolean))];
    const services = await PrintService.find({ _id: { $in: serviceIds }, isActive: true })
        .select('-__v')
        .lean();
    const cartServiceMap = new Map(services.map((s) => [s._id.toString(), s]));

    const documentPrices = await Promise.all(allDocuments.map((doc) => calculateDocumentPrices(doc, cartServiceMap)));
    const cartTotalPrice = formatCurrency(documentPrices.reduce((sum, p) => sum + p.finalDocPrice, 0));

    console.log(
        `[CUSTOMIZE_UPDATE] Document: ${documentId} | User: ${req.user.id} | Changes: ${JSON.stringify(value)}`,
    );
    console.log(
        `[PRICING] Document: ${documentId} | singleDocPrice: ${updatedPrices.singleDocPrice} | finalDocPrice: ${updatedPrices.finalDocPrice} | cartTotalPrice: ${cartTotalPrice}`,
    );

    const isBindingRequired = service && !['thesis-printing'].includes(service.slug) ? true : false;
    const isBindingColorRequired = service && service.slug === 'thesis-golden-bindings' ? true : false;

    return res.status(httpStatus.OK).json({
        status: true,
        message: 'Document customization updated successfully',
        data: {
            _id: updatedDocument._id,
            customization: (() => {
                const cust = {
                    ...updatedDocument.customization,
                    isColored: updatedDocument.customization?.colorMode === 'COLOR',
                    isBindingRequired,
                    isBindingColorRequired,
                    singleDocPrice: formatCurrency(updatedPrices.singleDocPrice),
                    finalDocPrice: formatCurrency(updatedPrices.finalDocPrice),
                };
                injectCustomizationLabels(cust, service?.slug, service);
                return cust;
            })(),
        },
        totalPrice: cartTotalPrice,
    });
};

export const deleteDocument = async (req, res) => {
    const { documentId } = req.params;

    const document = await PrintDocument.findOneAndUpdate(
        { _id: documentId, user: req.user.id, isDeleted: false },
        { isDeleted: true },
        { returnDocument: 'after', runValidators: true },
    );

    if (!document) {
        return sendResponse({ res, statusCode: httpStatus.NOT_FOUND, message: 'Document not found' });
    }

    // Clean up active cart referencing this deleted document
    const cart = await Cart.findOne({ user: req.user.id, status: 'ACTIVE' });
    if (cart) {
        const matchingItems = cart.items?.filter((item) => item.document?.toString() === documentId) || [];
        if (matchingItems.length > 0) {
            const cartItemIds = matchingItems.map((item) => item._id.toString());

            // Pull the items from cart.items
            cart.items = cart.items.filter((item) => item.document?.toString() !== documentId);

            // Revalidate coupon on the cart
            await revalidateCartCoupon(cart);
            await cart.save();

            // Clean up any customization sessions for these cart items
            await PrintCustomization.deleteMany({ cartItemId: { $in: cartItemIds }, user: req.user.id });
        }
    }

    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        message: 'Document deleted successfully',
    });
};

export const clearAllDocuments = async (req, res) => {
    const userId = req.user.id;

    // ── 1. Resolve the same document set that GET /api/print-documents returns ──
    const ttlHours = Number(process.env.AVAILABLE_DOCUMENT_TTL_HOURS) || env.AVAILABLE_DOCUMENT_TTL_HOURS || 1;
    const softExpiryThreshold = new Date(Date.now() - ttlHours * 60 * 60 * 1000);

    // Return only AVAILABLE documents within the soft-expiry threshold.
    // IN_CART, ORDERED, REMOVED, and other non-AVAILABLE documents are
    // never included regardless of customization session state.
    const visibleDocuments = await PrintDocument.find({
        user: userId,
        isDeleted: false,
        cartStatus: 'AVAILABLE',
        createdAt: { $gte: softExpiryThreshold },
    })
        .select('_id cartStatus')
        .lean();

    if (visibleDocuments.length === 0) {
        return sendResponse({
            res,
            statusCode: httpStatus.OK,
            data: { clearedCount: 0 },
            message: 'No documents to clear',
        });
    }

    // ── 2. Guard: skip documents actively referenced by valid cart items ──
    const cart = await Cart.findOne({ user: userId, status: 'ACTIVE' });
    const cartDocumentIds = new Set(
        (cart?.items || []).filter((item) => item.document != null).map((item) => item.document.toString()),
    );

    const docIdsToDelete = visibleDocuments.map((d) => d._id.toString()).filter((id) => !cartDocumentIds.has(id));

    if (docIdsToDelete.length === 0) {
        return sendResponse({
            res,
            statusCode: httpStatus.OK,
            data: { clearedCount: 0 },
            message: 'All visible documents are referenced by active cart items and cannot be cleared',
        });
    }

    // ── 3. Soft-delete the safe documents ──
    const updateResult = await PrintDocument.updateMany(
        { _id: { $in: docIdsToDelete }, user: userId, isDeleted: false },
        { isDeleted: true },
    );
    const clearedCount = updateResult.modifiedCount ?? 0;

    console.log(chalk.cyan(`[Clear All Docs] user=${userId} cleared=${clearedCount} document(s)`));

    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        data: { clearedCount },
        message: `${clearedCount} document(s) cleared successfully`,
    });
};

const quickPrintDocumentSchema = Joi.object({
    fileUrl: Joi.string().custom(sanitizeUrl).required().label('File url'),
    customization: Joi.object({
        copies: Joi.number().min(1).default(1),
        colorMode: Joi.string().valid('BW', 'COLOR').required(),
        paperSize: Joi.string().valid('A4', 'A3').required(),
        sideMode: Joi.string().valid('SINGLE', 'DOUBLE').required(),
    }).required(),
});

export const createQuickPrintDocument = async (req, res) => {
    const { error, value } = quickPrintDocumentSchema.validate(req.body);
    if (error) {
        return sendResponse({
            res,
            statusCode: httpStatus.BAD_REQUEST,
            message: error.details[0].message,
        });
    }

    const { fileUrl, customization } = value;

    try {
        const service = await PrintService.findOne({ slug: 'document-printing', isActive: true }).lean();
        if (!service) {
            return sendResponse({
                res,
                statusCode: httpStatus.NOT_FOUND,
                message: 'Document printing service not found',
            });
        }

        const resolvedProps = await resolveDocumentPropertiesFromUrl(fileUrl);

        if (service.allowedMimeTypes?.length > 0 && !service.allowedMimeTypes.includes(resolvedProps.mimeType)) {
            const readableTypes = getReadableFileTypes(service.allowedMimeTypes);
            console.warn(
                `[UPLOAD][QUICK_PRINT] REJECTED: File "${resolvedProps.originalFileName || 'document'}" | Format: ${resolvedProps.fileExtension || 'unknown'} | MIME: ${resolvedProps.mimeType || 'unknown'} | Reason: Invalid file type`,
            );
            return sendResponse({
                res,
                statusCode: httpStatus.BAD_REQUEST,
                message: `Invalid file type. Allowed types: ${readableTypes}`,
            });
        }

        if (service.maxPagesPerFile && resolvedProps.pageCount > service.maxPagesPerFile) {
            return sendResponse({
                res,
                statusCode: httpStatus.BAD_REQUEST,
                message: `Document exceeds the maximum allowed pages for this service. (Max: ${service.maxPagesPerFile})`,
            });
        }

        const defaultPaperQuality = (() => {
            if (!service.supportedPaperQualities?.length) return '';
            // Color-mode-aware defaults for services where paper quality depends on color selection
            if (service.slug === 'document-printing') {
                return 'STANDARD_70_75_GSM';
            }
            if (service.slug === 'poster-printing') {
                return customization.colorMode === 'COLOR' ? 'GLOSSY' : 'POSTER_STANDARD';
            }
            if (service.slug === 'digital-printing') {
                const colorMode = customization.colorMode || '';
                const matched = service.supportedPaperQualities.find((o) => {
                    if (o.isActive === false) return false;
                    const filter = o.colorModeFilter || [];
                    return filter.length > 0 && filter.includes(colorMode);
                });
                return (
                    matched?.code ||
                    service.supportedPaperQualities.find((o) => o.isActive !== false && o.isDefault)?.code ||
                    service.supportedPaperQualities.find((o) => o.isActive !== false)?.code ||
                    ''
                );
            }
            // Default: use isDefault flag, then first active option
            return (
                service.supportedPaperQualities.find((o) => o.isActive !== false && o.isDefault)?.code ||
                service.supportedPaperQualities.find((o) => o.isActive !== false)?.code ||
                ''
            );
        })();

        const customizationPayload = {
            copies: customization.copies,
            colorMode: customization.colorMode,
            paperSize: customization.paperSize,
            sideMode: customization.sideMode,
            orientation: 'PORTRAIT',
            paperQuality: defaultPaperQuality,
            bindingSelections: [],
            selectedBindingColorCode: '',
            bookletOptionCodes: '',
            notes: '',
            completedAt: new Date(),
        };

        const rawS3Key = extractS3KeyFromUrl(fileUrl) || fileUrl;

        const documentPayload = {
            user: req.user.id,
            service: service._id,
            originalFileName: resolvedProps.originalFileName,
            fileExtension: resolvedProps.fileExtension,
            mimeType: resolvedProps.mimeType,
            fileSizeBytes: resolvedProps.fileSizeBytes,
            pageCount: resolvedProps.pageCount,
            fileUrl: rawS3Key,
            storageProvider: 'S3',
            storageKey: resolvedProps.storageKey || rawS3Key || '',
            uploadStatus: 'UPLOADED',
            customization: customizationPayload,
            cartStatus: 'IN_CART',
        };

        const newDocument = await PrintDocument.create(documentPayload);
        console.log(
            `[UPLOAD][QUICK_PRINT] Created document: ${newDocument._id} | File: ${newDocument.originalFileName} | Format: ${newDocument.fileExtension} | PageCount: ${newDocument.pageCount} | Size: ${newDocument.fileSizeBytes} bytes`,
        );

        let cart = await Cart.findOne({ user: req.user.id, status: 'ACTIVE' });
        if (!cart) {
            cart = new Cart({ user: req.user.id, items: [] });
        }

        cart.items.push({
            service: service._id,
            serviceSnapshot: {
                name: service.name,
                slug: service.slug,
                serviceType: service.serviceType,
            },
            document: newDocument._id,
        });
        await cart.save();

        const pricingResult = await resolvePrintPricing({
            service,
            customization: customizationPayload,
            totalPages: resolvedProps.pageCount || 0,
            documentCount: 1,
        });

        const finalDocPrice = pricingResult.priceSummary?.taxableAmount || 0;

        return res.status(httpStatus.CREATED).json({
            status: true,
            message: 'Quick Print document created and added to cart successfully',
            data: {
                documentId: newDocument._id,
                pageCount: newDocument.pageCount,
                finalDocPrice: roundCurrency(finalDocPrice),
            },
        });
    } catch (err) {
        console.error('[Create Quick Print Doc Fail]: ', err);
        return sendResponse({
            res,
            statusCode: httpStatus.INTERNAL_SERVER_ERROR,
            message: err.message || 'Failed to save quick print document',
        });
    }
};

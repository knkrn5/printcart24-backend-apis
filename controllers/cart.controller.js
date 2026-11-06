// controllers/cart.controller.js
import httpStatus from 'http-status';
import env from '#configs/env';
import chalk from 'chalk';
import { sendResponse, getReadableFileTypes } from '#utils/generalHelper';
import Cart from '#models/cart';
import PrintService from '#models/printService';
import PrintDocument from '#models/printDocument';
import PrintCustomization from '#models/printCustomization';
import StationeryProduct from '#models/stationeryProduct';
import User from '#models/user';
import Coupon from '#models/coupon';
import { addPrintItemSchema, addStationeryItemSchema, updateCartItemCopiesSchema } from '#validations/cart';

import { applyCouponSchema } from '#validations/coupon';
import { resolvePrintPricing } from '#services/printPricing';
import { checkSameDayRepeatEligibility, calculateSameDayRepeatDiscountAmount } from '#services/sameDayRepeatDiscount';
import { getPricingSettings } from '#services/pricingSetting';
import { UI_PRINT_LABELS } from '#constants/printMappings';

// Customization session expires after 24 hours of inactivity
const CUSTOMIZATION_SESSION_TTL_HOURS = 24;

const DOCUMENT_SELECT_FIELDS = 'originalFileName pageCount fileUrl fileExtension customization createdAt updatedAt';
const GST_RATE_PERCENT = 18;

import { extractFileMetadataFromUrl } from '#utils/fileMetadata';
import { resolvePresignedGetUrl } from '#utils/s3Presigned';

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

const calculateGstAmount = (taxableAmount, gstPercentage = GST_RATE_PERCENT) =>
    roundCurrency(((Number(taxableAmount) || 0) * (Number(gstPercentage) || 0)) / 100);

const buildPricingSummary = ({
    itemTotal = 0,
    gst = 0,
    deliveryFee = 0,
    platformFee = 0,
    discountAmount = 0,
    couponDiscountAmount = 0,
    repeatDiscountAmount = 0,
}) => {
    const normalizedItemTotal = roundCurrency(itemTotal);
    const normalizedGst = 0;
    const normalizedDeliveryFee = roundCurrency(deliveryFee);
    const normalizedPlatformFee = 0;
    const normalizedDiscount = 0;
    const normalizedCouponDiscount = 0;
    const normalizedRepeatDiscount = 0;

    const totalBeforeTax = normalizedItemTotal;
    const totalWithTax = totalBeforeTax + normalizedDeliveryFee;

    return {
        itemTotal: normalizedItemTotal,
        gst: 0,
        deliveryFee: normalizedDeliveryFee,
        platformFee: 0,
        discountAmount: 0,
        couponDiscountAmount: 0,
        repeatDiscountAmount: 0,
        grandTotal: roundCurrency(totalWithTax),
    };
};

const formatPricingSummary = (pricing = {}) => ({
    itemTotal: formatCurrency(pricing.itemTotal),
    gst: formatCurrency(pricing.gst),
    deliveryFee: formatCurrency(pricing.deliveryFee),
    platformFee: formatCurrency(pricing.platformFee),
    discountAmount: formatCurrency(pricing.discountAmount),
    couponDiscountAmount: formatCurrency(pricing.couponDiscountAmount || 0),
    repeatDiscountAmount: formatCurrency(pricing.repeatDiscountAmount || 0),
    grandTotal: formatCurrency(pricing.grandTotal),
});

const buildEmptyPricingSummary = () => buildPricingSummary({});

const getActiveCart = async (userId) =>
    Cart.findOne({ user: userId, status: 'ACTIVE' })
        .populate('items.service', '_id')
        .populate('items.document', DOCUMENT_SELECT_FIELDS);

export const buildCartResponse = async (cart) => {
    const serviceIds = [
        ...new Set((cart.items || []).map((item) => (item.service?._id || item.service)?.toString()).filter(Boolean)),
    ];
    const stationeryIds = [
        ...new Set(
            (cart.stationeryItems || [])
                .map((item) => (item.stationery?._id || item.stationery)?.toString())
                .filter(Boolean),
        ),
    ];

    const [services, stationeries, pricingSettings] = await Promise.all([
        PrintService.find({ _id: { $in: serviceIds }, isActive: true })
            .select('-__v')
            .lean(),
        StationeryProduct.find({ _id: { $in: stationeryIds }, isActive: true })
            .select('name itemPrice thumbnailUrl')
            .lean(),
        getPricingSettings(),
    ]);

    const serviceMap = new Map(services.map((service) => [service._id.toString(), service]));
    const stationeryMap = new Map(stationeries.map((s) => [s._id.toString(), s]));

    const items = await Promise.all(
        (cart.items || []).map(async (item, itemIndex) => {
            const serviceId = (item.service?._id || item.service || '').toString();
            const service = serviceMap.get(serviceId);
            const primaryDocument = item.document;
            let pricing = buildEmptyPricingSummary();

            if (service && primaryDocument) {
                try {
                    const pricingResult = await resolvePrintPricing({
                        service,
                        customization: primaryDocument.customization || {},
                        totalPages: primaryDocument.pageCount || 0,
                        documentCount: 1,
                    });

                    pricing = buildPricingSummary({
                        itemTotal:
                            (pricingResult.priceSummary?.baseAmount || 0) +
                            (pricingResult.priceSummary?.addOnAmount || 0),
                        platformFee: 0,
                        gst: 0,
                        deliveryFee: 0,
                    });
                } catch (error) {
                    pricing = buildEmptyPricingSummary();
                }
            }

            let resolvedQuality = '';
            if (primaryDocument) {
                const docCustomization = primaryDocument.customization || {};
                if (docCustomization.paperQuality) {
                    resolvedQuality = UI_PRINT_LABELS[docCustomization.paperQuality] || docCustomization.paperQuality;
                } else if (service) {
                    const size = docCustomization.paperSize || '';
                    const color = docCustomization.colorMode || '';
                    const serviceSlug = service.slug || '';

                    if (serviceSlug === 'document-printing') {
                        if (size === 'A4' || size === 'A3') {
                            resolvedQuality = color === 'COLOR' ? '100 GSM' : '70-75 GSM';
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
                        resolvedQuality = (matched || fallback)?.label || '';
                    } else if (serviceSlug === 'thesis-printing') {
                        const defaultOption =
                            service?.supportedPaperQualities?.find((o) => o.isDefault === true) ||
                            service?.supportedPaperQualities?.[0];
                        resolvedQuality = defaultOption?.label || '';
                    } else if (serviceSlug === 'thesis-golden-bindings') {
                        resolvedQuality = color === 'COLOR' ? '100 GSM' : '70-75 GSM';
                    } else if (serviceSlug === 'photo-printing' && service?.supportedPaperQualities?.length > 0) {
                        const defaultOption =
                            service.supportedPaperQualities.find((o) => o.isActive !== false && o.isDefault) ||
                            service.supportedPaperQualities.find((o) => o.isActive !== false);
                        resolvedQuality = defaultOption?.label || '300 GSM Art Card';
                    } else if (serviceSlug === 'certificate' && service?.supportedPaperQualities?.length > 0) {
                        const defaultOption =
                            service.supportedPaperQualities.find((o) => o.isActive !== false && o.isDefault) ||
                            service.supportedPaperQualities.find((o) => o.isActive !== false);
                        resolvedQuality = defaultOption?.label || 'Matt Sheet(250GSM)';
                    } else if (serviceSlug === 'poster-printing') {
                        resolvedQuality = color === 'COLOR' ? 'Glossy Sheet' : 'Normal Sheet';
                    }
                }
            }

            const resolvedBindingSelections = [];
            const getToggleId = (t) => (t?.id !== undefined ? t.id : t?.get ? t.get('id') : null);

            if (primaryDocument && service) {
                const selections = primaryDocument.customization?.bindingSelections || [];
                const toggles = service.bindingConfiguration?.toggles || [];
                const pageCount = primaryDocument.pageCount || 0;

                for (const selection of selections) {
                    const toggle = toggles.find((t) => getToggleId(t) === selection.optionId && t.isActive !== false);
                    if (!toggle) continue;

                    let resolvedSubOption = null;
                    let price = toggle.price || 0;

                    if (toggle.hasSubOptions && toggle.subOptions) {
                        const isPageSlab = toggle.subOptions.some((so) => so.minPages !== null || so.maxPages !== null);
                        if (isPageSlab) {
                            resolvedSubOption = toggle.subOptions.find((so) => {
                                const minP = so.minPages ?? 0;
                                const maxP = so.maxPages ?? Infinity;
                                return pageCount >= minP && pageCount <= maxP;
                            });
                        } else if (selection.subOptionId) {
                            resolvedSubOption = toggle.subOptions.find(
                                (so) => getToggleId(so) === selection.subOptionId && so.isActive !== false,
                            );
                        }
                    }

                    if (resolvedSubOption) {
                        price = resolvedSubOption.price || 0;
                    }

                    resolvedBindingSelections.push({
                        optionId: getToggleId(toggle),
                        optionCode: toggle.code || '',
                        optionLabel: toggle.label || '',
                        subOptionId: resolvedSubOption ? getToggleId(resolvedSubOption) : null,
                        subOptionCode: resolvedSubOption ? resolvedSubOption.code || '' : '',
                        subOptionLabel: resolvedSubOption ? resolvedSubOption.label || '' : '',
                        price,
                    });
                }
            }

            const presignedFileUrl = primaryDocument?.fileUrl
                ? await resolvePresignedGetUrl(primaryDocument.fileUrl)
                : '';

            return {
                _id: item._id,
                service: item.service?._id || item.service || null,
                document: primaryDocument
                    ? {
                          _id: primaryDocument._id,
                          originalFileName:
                              primaryDocument.originalFileName ||
                              getOriginalFileNameFromUrl(primaryDocument.fileUrl, `File ${itemIndex + 1}`),
                          pageCount: primaryDocument.pageCount || 0,
                          fileUrl: presignedFileUrl,
                          fileExtension: primaryDocument.fileExtension || '',
                          customization: {
                              copies: primaryDocument.customization?.copies || 1,
                              serviceName: service?.name || '',
                              slug: service?.slug || '',
                              serviceId: service?._id || '',
                              ...(service?.slug !== 'thesis-golden-bindings' && {
                                  paperQualityLabel: resolvedQuality || '',
                                  sideMode: primaryDocument.customization?.sideMode || 'SINGLE',
                                  paperSize: primaryDocument.customization?.paperSize || '',
                                  colorMode: primaryDocument.customization?.colorMode || '',
                              }),
                              bindingSelections: resolvedBindingSelections,
                              selectedBindingColorCode: primaryDocument.customization?.selectedBindingColorCode || '',
                              selectedBindingColorCodeLabel:
                                  UI_PRINT_LABELS[primaryDocument.customization?.selectedBindingColorCode] ||
                                  primaryDocument.customization?.selectedBindingColorCode ||
                                  '',
                              notes: primaryDocument.customization?.notes || '',
                              bookletOptionCodes: primaryDocument.customization?.bookletOptionCodes || '',
                          },
                          createdAt: primaryDocument.createdAt,
                          updatedAt: primaryDocument.updatedAt,
                      }
                    : null,
                _computedPricing: pricing,
                addedAt: item.addedAt || item._id.getTimestamp(),
                updatedAt: item.updatedAt || item._id.getTimestamp(),
            };
        }),
    );

    const stationeryItemsResp = await Promise.all(
        (cart.stationeryItems || []).map(async (item) => {
            const stationery = stationeryMap.get((item.stationery?._id || item.stationery || '').toString());
            let pricing = buildEmptyPricingSummary();
            let name = item.itemSnapshot?.name || 'Unknown Item';

            if (stationery) {
                name = stationery.name;
                const taxableAmount = stationery.itemPrice * item.quantity;
                pricing = buildPricingSummary({
                    itemTotal: taxableAmount,
                    platformFee: 0,
                    gst: 0,
                    deliveryFee: 0,
                });
            }

            const rawThumbnail = stationery?.thumbnailUrl || item.itemSnapshot?.thumbnailUrl || '';
            const presignedThumbnail = rawThumbnail ? await resolvePresignedGetUrl(rawThumbnail) : '';

            const snapshotObj =
                typeof item.itemSnapshot?.toObject === 'function'
                    ? item.itemSnapshot.toObject()
                    : { ...(item.itemSnapshot || {}) };

            return {
                _id: item._id,
                stationery: item.stationery?._id || item.stationery || null,
                itemSnapshot: { ...snapshotObj, name, thumbnailUrl: presignedThumbnail },
                quantity: item.quantity,
                _computedPricing: pricing,
                addedAt: item.addedAt || item._id.getTimestamp(),
                updatedAt: item.updatedAt || item._id.getTimestamp(),
            };
        }),
    );

    const allPricingItems = [...items, ...stationeryItemsResp];

    const totalItemTotal = allPricingItems.reduce((sum, item) => sum + item._computedPricing.itemTotal, 0);
    let couponDiscountAmount = 0;

    if (cart.appliedCoupon?.code) {
        const { discountType, discountAmount: couponAmount } = cart.appliedCoupon;
        if (discountType === 'PERCENT') {
            couponDiscountAmount = (totalItemTotal * couponAmount) / 100;
        } else if (discountType === 'FIXED') {
            couponDiscountAmount = couponAmount;
        } else if (discountType === 'FREE_DELIVERY') {
            couponDiscountAmount = pricingSettings.deliveryFee;
        }
    }

    const roundedCouponDiscount = roundCurrency(couponDiscountAmount);
    const netSubtotalAfterCoupon = Math.max(0, totalItemTotal - roundedCouponDiscount);

    // Evaluate Same-Day Repeat Customer Discount (Dynamic % from admin settings applied after existing coupon discount)
    let repeatDiscountAmount = 0;
    const isRepeatEligible = await checkSameDayRepeatEligibility(cart.user);
    if (isRepeatEligible) {
        repeatDiscountAmount = calculateSameDayRepeatDiscountAmount(
            netSubtotalAfterCoupon,
            pricingSettings.sameDayRepeatDiscountPercentage,
        );
    }

    const totalDiscountAmount = roundedCouponDiscount + repeatDiscountAmount;
    const taxableBase = Math.max(0, totalItemTotal - totalDiscountAmount);

    const totalUndiscountedTax = allPricingItems.reduce(
        (sum, item) => sum + (Number(item._computedPricing?.gst) || 0),
        0,
    );
    let finalGst = 0;
    if (totalUndiscountedTax > 0 && totalItemTotal > 0) {
        const discountFactor = Math.max(0, 1 - totalDiscountAmount / totalItemTotal);
        finalGst = roundCurrency(totalUndiscountedTax * discountFactor);
    } else if (taxableBase > 0) {
        finalGst = calculateGstAmount(taxableBase, pricingSettings.gstPercentage);
    }

    const cartPricing = buildPricingSummary({
        itemTotal: totalItemTotal,
        gst: 0,
        deliveryFee: pricingSettings.deliveryFee,
        platformFee: 0,
        discountAmount: 0,
        couponDiscountAmount: 0,
        repeatDiscountAmount: 0,
    });

    const sanitizedItems = items
        .map(({ _computedPricing, ...item }) => ({
            ...item,
            totalAmount: formatCurrency(_computedPricing.itemTotal),
        }))
        .sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt));

    const sanitizedStationeryItems = stationeryItemsResp
        .map(({ _computedPricing, ...item }) => ({
            ...item,
            totalAmount: formatCurrency(_computedPricing.itemTotal),
        }))
        .sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt));

    console.log(
        `[CART_SUMMARY] Cart: ${cart._id} | Print items: ${sanitizedItems.length} | Stationery items: ${sanitizedStationeryItems.length} | Item Total: ${cartPricing.itemTotal} | Discount: ${cartPricing.discountAmount} | GST: ${cartPricing.gst} | Platform Fee: ${cartPricing.platformFee} | Grand Total: ${cartPricing.grandTotal}`,
    );

    return {
        _id: cart._id,
        user: cart.user,
        status: cart.status,
        deliveryMode: cart.deliveryMode || 'DELIVERY',
        selectedAddressId: cart.selectedAddressId || null,
        paymentMethod: cart.paymentMethod || '',
        notes: cart.notes || '',
        items: sanitizedItems,
        stationeryItems: sanitizedStationeryItems,
        appliedCoupon: cart.appliedCoupon || {},
        pricing: formatPricingSummary(cartPricing),
        createdAt: cart.createdAt,
        updatedAt: cart.updatedAt,
    };
};

export const revalidateCartCoupon = async (cart) => {
    if (!cart.appliedCoupon || !cart.appliedCoupon.code) return { removed: false };

    const originalCouponSnapshot = cart.appliedCoupon;
    cart.appliedCoupon = null; // Temporarily clear to get totalBeforeDiscount
    const cartData = await buildCartResponse(cart);
    cart.appliedCoupon = originalCouponSnapshot; // Restore snapshot

    const totalBeforeDiscount =
        cartData.pricing.itemTotal + cartData.pricing.gst + cartData.pricing.deliveryFee + cartData.pricing.platformFee;

    const coupon = await Coupon.findOne({ code: originalCouponSnapshot.code });
    if (!coupon || !coupon.isActive) {
        cart.appliedCoupon = null;
        return { removed: true, message: 'Coupon removed because it is no longer valid' };
    }

    let potentialDiscount = 0;
    if (coupon.discountType === 'PERCENT') {
        potentialDiscount = (cartData.pricing.itemTotal * coupon.discountValue) / 100;
    } else if (coupon.discountType === 'FIXED') {
        potentialDiscount = coupon.discountValue;
    } else if (coupon.discountType === 'FREE_DELIVERY') {
        potentialDiscount = cartData.pricing.deliveryFee;
    }

    if (coupon.minOrderValue > 0 && totalBeforeDiscount < coupon.minOrderValue) {
        cart.appliedCoupon = null;
        return {
            removed: true,
            message: `Coupon removed because Minimum Cart value should be ₹${coupon.minOrderValue} to apply this coupon`,
        };
    }

    if (totalBeforeDiscount <= potentialDiscount + 1) {
        cart.appliedCoupon = null;
        return {
            removed: true,
            message: 'Coupon removed because cart value should be greater than coupon value',
        };
    }

    return { removed: false };
};

export const getCart = async (req, res) => {
    let cart = await getActiveCart(req.user.id);

    if (!cart) {
        cart = await Cart.create({ user: req.user.id });
        cart = await getActiveCart(req.user.id);
    }

    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        data: await buildCartResponse(cart),
        message: 'Cart fetched successfully',
    });
};

export const addPrintItemToCart = async (req, res) => {
    const { error, value } = addPrintItemSchema.validate(req.body);

    if (error) {
        return sendResponse({ res, statusCode: httpStatus.BAD_REQUEST, message: error.details[0].message });
    }

    const { serviceId, documentIds, cartItemId } = value;

    const service = await PrintService.findById(serviceId).select(
        '_id name slug serviceType isActive allowedMimeTypes maxPagesPerFile',
    );
    if (!service || !service.isActive) {
        return sendResponse({ res, statusCode: httpStatus.BAD_REQUEST, message: 'Invalid or inactive print service' });
    }

    // ─── RE-CUSTOMIZATION PATH ────────────────────────────────────────────────
    // When cartItemId is present, the user is re-saving customization for an
    // existing cart item. We do NOT add a new item — we just verify the session
    // and mark it COMPLETED. The actual customization values were already persisted
    // to PrintDocument via PATCH /print-documents/:documentId before this call.
    if (cartItemId) {
        const cart = await Cart.findOne({ user: req.user.id, status: 'ACTIVE' });
        if (!cart) {
            return sendResponse({ res, statusCode: httpStatus.NOT_FOUND, message: 'Active cart not found' });
        }

        // Confirm the cartItemId belongs to this cart
        const cartItem = cart.items?.id?.(cartItemId);
        if (!cartItem) {
            return sendResponse({
                res,
                statusCode: httpStatus.NOT_FOUND,
                message: 'Cart item not found for the provided cartItemId',
            });
        }

        // Confirm the documentId sent matches the document linked to this cart item
        const linkedDocumentId = cartItem.document?.toString();
        if (!linkedDocumentId || !documentIds.includes(linkedDocumentId)) {
            return sendResponse({
                res,
                statusCode: httpStatus.BAD_REQUEST,
                message: 'documentIds do not match the document linked to this cart item',
            });
        }

        // Confirm a PENDING customization session exists for this cart item
        const session = await PrintCustomization.findOne({
            cartItemId,
            user: req.user.id,
            status: 'PENDING',
        });
        if (!session) {
            return sendResponse({
                res,
                statusCode: httpStatus.NOT_FOUND,
                message: 'No active customization session found for this cart item. Please initiate edit again.',
            });
        }

        // Mark session as completed — no new cart item is pushed
        session.status = 'COMPLETED';
        await session.save();

        cartItem.updatedAt = new Date();
        await cart.save();

        return sendResponse({
            res,
            statusCode: httpStatus.OK,
            message: 'Cart item customization updated successfully',
        });
    }

    // ─── NORMAL ADD-TO-CART PATH ──────────────────────────────────────────────
    const documents = await PrintDocument.find({
        _id: { $in: documentIds },
    }).select('_id user service cartStatus pageCount mimeType originalFileName fileUrl isDeleted');

    const documentMap = new Map(documents.map((doc) => [doc._id.toString(), doc]));
    const invalidDocuments = [];

    for (const docId of documentIds) {
        const doc = documentMap.get(docId);
        if (!doc) {
            invalidDocuments.push({
                documentId: docId,
                reason: 'Document not found',
            });
        } else if (doc.user.toString() !== req.user.id.toString()) {
            invalidDocuments.push({
                documentId: docId,
                reason: 'Unauthorized: Document does not belong to user',
            });
        } else if (doc.isDeleted) {
            invalidDocuments.push({
                documentId: docId,
                reason: 'Document has been deleted',
            });
        } else if (!['AVAILABLE', 'IN_CART'].includes(doc.cartStatus)) {
            invalidDocuments.push({
                documentId: docId,
                reason: `Document is not available (current status: ${doc.cartStatus})`,
            });
        }
    }

    if (invalidDocuments.length > 0) {
        console.error(
            chalk.red.bold('[Cart Error] Some documents are missing, invalid, or unavailable.'),
            chalk.yellow(
                '\nReason for error: This error is thrown because document validation failed during the normal add-to-cart flow.',
            ),
            chalk.cyan('\nValidation Failures:'),
            chalk.yellow(JSON.stringify(invalidDocuments, null, 2)),
        );

        return sendResponse({
            res,
            statusCode: httpStatus.BAD_REQUEST,
            message: 'Some documents are missing, invalid, or unavailable',
            data: { invalidDocuments },
        });
    }

    let cart = await Cart.findOne({ user: req.user.id, status: 'ACTIVE' });
    if (!cart) cart = new Cart({ user: req.user.id, items: [] });

    const existingDocumentIds = new Set(cart.items.map((item) => item.document?.toString()).filter(Boolean));

    const addedDocumentIds = [];

    for (const document of documents) {
        const documentId = document._id.toString();
        if (existingDocumentIds.has(documentId)) continue;

        if (service.allowedMimeTypes?.length > 0 && !service.allowedMimeTypes.includes(document.mimeType)) {
            const readableTypes = getReadableFileTypes(service.allowedMimeTypes);
            console.warn(
                `[CART] REJECTED: File "${document.originalFileName}" | Format: ${document.fileExtension || 'unknown'} | MIME: ${document.mimeType || 'unknown'} | Reason: Invalid file type`,
            );
            return sendResponse({
                res,
                statusCode: httpStatus.BAD_REQUEST,
                message: `File "${document.originalFileName}" has an invalid file type. Allowed types: ${readableTypes}`,
            });
        }

        if (service.maxPagesPerFile && document.pageCount > service.maxPagesPerFile) {
            return sendResponse({
                res,
                statusCode: httpStatus.BAD_REQUEST,
                message: `File "${document.originalFileName}" exceeds the maximum allowed pages for this service. (Max: ${service.maxPagesPerFile})`,
            });
        }

        cart.items.push({
            service: service._id,
            serviceSnapshot: {
                name: service.name,
                slug: service.slug,
                serviceType: service.serviceType,
            },
            document: document._id,
            addedAt: new Date(),
            updatedAt: new Date(),
        });
        addedDocumentIds.push(document._id);
    }

    await cart.save();

    if (addedDocumentIds.length > 0) {
        await PrintDocument.updateMany(
            { _id: { $in: addedDocumentIds }, user: req.user.id, isDeleted: false, cartStatus: 'AVAILABLE' },
            { $set: { cartStatus: 'IN_CART' } },
        );

        console.log(
            `[CART] Added ${addedDocumentIds.length} item(s) to cart for User: ${req.user.id} | Documents: ${addedDocumentIds.join(', ')} | Service: ${service.name} (${service.slug})`,
        );
    }

    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        message: 'Items added to cart successfully',
    });
};

/**
 * POST /cart/items/:cartItemId/customize
 *
 * Initiates (or re-initiates) a customization editing session for an existing
 * in-cart print item. Backend pre-fills the session with the item's current
 * customization — no body required from the frontend.
 *
 * The returned customization object uses the same field shape as PrintDocument.customization
 * and the batch document API, so the UI customization form works without any changes.
 */
export const initiateCartItemCustomization = async (req, res) => {
    const { cartItemId } = req.params;

    // Basic ObjectId format guard
    if (!cartItemId || !/^[a-f\d]{24}$/i.test(cartItemId)) {
        return sendResponse({
            res,
            statusCode: httpStatus.BAD_REQUEST,
            message: 'Invalid cartItemId format',
        });
    }

    // Fetch the active cart and confirm the cartItemId belongs to this user
    const cart = await Cart.findOne({ user: req.user.id, status: 'ACTIVE' })
        .populate('items.document', '_id service customization')
        .lean();

    if (!cart) {
        return sendResponse({ res, statusCode: httpStatus.NOT_FOUND, message: 'Active cart not found' });
    }

    const cartItem = cart.items?.find((item) => item._id.toString() === cartItemId);
    if (!cartItem) {
        return sendResponse({
            res,
            statusCode: httpStatus.NOT_FOUND,
            message: 'Cart item not found',
        });
    }

    const linkedDocument = cartItem.document;
    if (!linkedDocument) {
        return sendResponse({
            res,
            statusCode: httpStatus.BAD_REQUEST,
            message: 'This cart item has no linked document to customize',
        });
    }

    // Confirm the linked document still exists and is not deleted.
    // NOTE: We intentionally do NOT filter by cartStatus here.
    // The cart item itself (found above) is the authoritative proof that this
    // document belongs to the user's active cart. PrintDocument.cartStatus is a
    // sync helper field and must not gate whether a customization session can start —
    // doing so would silently block users from editing cart items whose document
    // cartStatus is AVAILABLE, ORDERED, or REMOVED due to race conditions or
    // prior order/remove flows.
    const document = await PrintDocument.findOne({
        _id: linkedDocument._id,
        user: req.user.id,
        isDeleted: false,
    })
        .select('_id service customization')
        .lean();

    if (!document) {
        return sendResponse({
            res,
            statusCode: httpStatus.NOT_FOUND,
            message: 'Linked document is no longer available for customization',
        });
    }

    // Read the service reference from either the cart item's serviceSnapshot or the document itself
    const serviceId = (cartItem.service?._id || cartItem.service || document.service)?.toString();
    if (!serviceId) {
        return sendResponse({
            res,
            statusCode: httpStatus.BAD_REQUEST,
            message: 'Unable to determine the print service for this cart item',
        });
    }

    // Extract the current customization — these become the pre-filled values
    const existing = document.customization || {};
    const prefilled = {
        copies: existing.copies || 1,
        orientation: existing.orientation || '',
        paperSize: existing.paperSize || '',
        colorMode: existing.colorMode || '',
        sideMode: existing.sideMode || '',
        paperQuality: existing.paperQuality || '',
        staplingEnabled: Boolean(existing.staplingEnabled),
        stickBindingEnabled: Boolean(existing.stickBindingEnabled),
        spiralBindingEnabled: Boolean(existing.spiralBindingEnabled),
        selectedBindingCode: existing.selectedBindingCode || '',
        selectedBindingColorCode: existing.selectedBindingColorCode || '',
        bookletOptionCodes: existing.bookletOptionCodes || '',
        notes: existing.notes || '',
    };

    // Session expires 24 hours from now
    const expiresAt = new Date(Date.now() + CUSTOMIZATION_SESSION_TTL_HOURS * 60 * 60 * 1000);

    // Business Rule: A user can only have one active PENDING customization session at a time.
    // When initiating a new session, any other existing PENDING sessions for this user are considered abandoned and cleaned up.
    const deleteResult = await PrintCustomization.deleteMany({
        user: req.user.id,
        cartItemId: { $ne: cartItemId },
        status: 'PENDING',
    });

    if (deleteResult.deletedCount > 0) {
        console.log(
            chalk.yellow(
                `[Cart Customization] Abandoned ${deleteResult.deletedCount} previous PENDING customization session(s) for user ${req.user.id}. Starting customization for cart item ${cartItemId}.`,
            ),
        );
    }

    // Upsert — if a stale PENDING session already exists for this cartItemId, overwrite it
    const session = await PrintCustomization.findOneAndUpdate(
        { cartItemId, user: req.user.id },
        {
            $set: {
                user: req.user.id,
                cartItemId,
                documentId: document._id,
                serviceId,
                customization: prefilled,
                status: 'PENDING',
                expiresAt,
            },
        },
        { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
    );

    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        message: 'Customization session started',
        data: {
            _id: session._id,
            cartItemId: session.cartItemId,
            documentId: session.documentId,
            serviceId: session.serviceId,
            customization: session.customization,
            status: session.status,
            expiresAt: session.expiresAt,
        },
    });
};

export const addStationeryItemToCart = async (req, res) => {
    const { error, value } = addStationeryItemSchema.validate(req.body);

    if (error) {
        return sendResponse({ res, statusCode: httpStatus.BAD_REQUEST, message: error.details[0].message });
    }

    const { productId, quantity } = value;

    const stationery = await StationeryProduct.findById(productId).select(
        '_id name itemPrice stock isActive thumbnailUrl',
    );
    if (!stationery || !stationery.isActive) {
        return sendResponse({
            res,
            statusCode: httpStatus.BAD_REQUEST,
            message: 'Invalid or inactive stationery product',
        });
    }

    if (stationery.stock < quantity) {
        return sendResponse({ res, statusCode: httpStatus.BAD_REQUEST, message: 'Not enough stock available' });
    }

    let cart = await Cart.findOne({ user: req.user.id, status: 'ACTIVE' });
    if (!cart) cart = new Cart({ user: req.user.id, items: [], stationeryItems: [] });

    const existingItem = (cart.stationeryItems || []).find(
        (item) => item.stationery.toString() === stationery._id.toString(),
    );

    if (existingItem) {
        if (quantity === 0) {
            cart.stationeryItems.pull({ _id: existingItem._id });
        } else {
            existingItem.quantity = quantity;
            existingItem.updatedAt = new Date();
        }
    } else if (quantity > 0) {
        cart.stationeryItems.push({
            stationery: stationery._id,
            itemSnapshot: {
                name: stationery.name,
                brand: stationery.brand || 'General',
                productType: 'STATIONERY',
                thumbnailUrl: stationery.thumbnailUrl || '',
            },
            quantity: quantity,
            addedAt: new Date(),
            updatedAt: new Date(),
        });
    }

    const { removed, message: removedMessage } = await revalidateCartCoupon(cart);
    await cart.save();

    const baseMessage =
        quantity === 0 ? 'Item removed from cart successfully' : 'Stationery updated in cart successfully';
    const finalMessage = removed ? `${baseMessage.replace(' successfully', '')} and ${removedMessage}` : baseMessage;

    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        message: baseMessage,
        data: removed ? { message: finalMessage } : undefined,
    });
};

export const updateCartItemCopies = async (req, res) => {
    const { itemId } = req.params;
    const { error, value } = updateCartItemCopiesSchema.validate(req.query);

    if (error) {
        return sendResponse({ res, statusCode: httpStatus.BAD_REQUEST, message: error.details[0].message });
    }

    const cart = await Cart.findOne({ user: req.user.id, status: 'ACTIVE' });
    if (!cart) {
        return sendResponse({ res, statusCode: httpStatus.NOT_FOUND, message: 'Active cart not found' });
    }

    let isStationery = false;
    let cartItem = cart.items?.id?.(itemId);
    if (!cartItem && cart.stationeryItems && cart.stationeryItems.id) {
        cartItem = cart.stationeryItems.id(itemId);
        isStationery = !!cartItem;
    }

    if (!cartItem) {
        return sendResponse({ res, statusCode: httpStatus.NOT_FOUND, message: 'Cart item not found' });
    }

    if (isStationery) {
        const currentQty = cartItem.quantity || 1;
        if (value.action === 'decrement' && currentQty === 1) {
            return sendResponse({
                res,
                statusCode: httpStatus.BAD_REQUEST,
                message: 'At least 1 quantity is required',
            });
        }

        const nextQty = value.action === 'increment' ? currentQty + 1 : Math.max(currentQty - 1, 1);

        if (value.action === 'increment') {
            const stationery = await StationeryProduct.findById(cartItem.stationery).select('stock isActive');
            if (!stationery || !stationery.isActive) {
                return sendResponse({
                    res,
                    statusCode: httpStatus.BAD_REQUEST,
                    message: 'Stationery product is no longer available',
                });
            }
            if (stationery.stock < nextQty) {
                return sendResponse({
                    res,
                    statusCode: httpStatus.BAD_REQUEST,
                    message: 'Not enough stock available',
                });
            }
        }

        cartItem.quantity = nextQty;
        cartItem.updatedAt = new Date();
        const { removed, message: removedMessage } = await revalidateCartCoupon(cart);
        await cart.save();
        return sendResponse({
            res,
            statusCode: httpStatus.OK,
            data: {
                copies: nextQty,
                ...(removed && {
                    message: `Quantity updated and ${removedMessage}`,
                }),
            },
            message: 'Quantity updated successfully',
        });
    }

    const documentId = cartItem?.document;

    if (!documentId) {
        return sendResponse({ res, statusCode: httpStatus.BAD_REQUEST, message: 'Document not linked with cart item' });
    }

    const document = await PrintDocument.findOne({
        _id: documentId,
        user: req.user.id,
        isDeleted: false,
        cartStatus: 'IN_CART',
    }).select('_id customization.copies');

    if (!document) {
        return sendResponse({ res, statusCode: httpStatus.NOT_FOUND, message: 'Document not found' });
    }

    const currentCopies = Math.max(document.customization?.copies || 1, 1);
    if (value.action === 'decrement' && currentCopies === 1) {
        return sendResponse({
            res,
            statusCode: httpStatus.BAD_REQUEST,
            message: 'At least 1 quantity is required',
        });
    }

    const nextCopies = value.action === 'increment' ? currentCopies + 1 : Math.max(currentCopies - 1, 1);

    await PrintDocument.updateOne(
        { _id: document._id, user: req.user.id, isDeleted: false },
        {
            $set: {
                'customization.copies': nextCopies,
                'customization.completedAt': new Date(),
            },
        },
    );

    // Sync in-memory document state for re-validation if necessary
    if (cartItem.document) {
        cartItem.document.customization = { ...cartItem.document.customization, copies: nextCopies };
    }

    cartItem.updatedAt = new Date();
    const { removed, message: removedMessage } = await revalidateCartCoupon(cart);
    await cart.save();

    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        data: {
            copies: nextCopies,
            ...(removed && {
                message: `Copies updated and ${removedMessage}`,
            }),
        },
        message: 'Copies updated successfully',
    });
};
export const removeCartItem = async (req, res) => {
    const { itemId } = req.params;

    const cart = await Cart.findOne({ user: req.user.id, status: 'ACTIVE' });
    if (!cart) return sendResponse({ res, statusCode: httpStatus.NOT_FOUND, message: 'Cart not found' });

    const itemExistsInPrint = cart.items?.some((item) => item._id.toString() === itemId);
    const itemExistsInStationery = cart.stationeryItems?.some((item) => item._id.toString() === itemId);

    if (!itemExistsInPrint && !itemExistsInStationery) {
        return sendResponse({ res, statusCode: httpStatus.NOT_FOUND, message: 'Cart item not found' });
    }

    if (itemExistsInStationery) {
        cart.stationeryItems = cart.stationeryItems.filter((item) => item._id.toString() !== itemId);
    } else {
        const cartItem = cart.items?.id(itemId);
        const linkedDocumentIds = cartItem?.document ? [cartItem.document] : [];

        cart.items = cart.items.filter((item) => item._id.toString() !== itemId);

        if (linkedDocumentIds.length > 0) {
            await PrintDocument.updateMany(
                { _id: { $in: linkedDocumentIds }, user: req.user.id, isDeleted: false, cartStatus: 'IN_CART' },
                { $set: { cartStatus: 'REMOVED' } },
            );
        }

        // Clean up any customization sessions for this cart item
        await PrintCustomization.deleteMany({ cartItemId: itemId, user: req.user.id });
    }

    const { removed, message: removedMessage } = await revalidateCartCoupon(cart);
    await cart.save();

    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        message: 'Item removed from cart successfully',
        data: removed ? { message: `Item removed and ${removedMessage}` } : undefined,
    });
};

export const applyCoupon = async (req, res) => {
    const { error, value } = applyCouponSchema.validate(req.body);
    if (error) {
        return sendResponse({ res, statusCode: httpStatus.BAD_REQUEST, message: error.details[0].message });
    }

    const { code } = value;

    const coupon = await Coupon.findOne({ code });
    if (!coupon || !coupon.isActive) {
        return sendResponse({ res, statusCode: httpStatus.BAD_REQUEST, message: 'Invalid or inactive coupon' });
    }

    const currentDate = new Date();
    if (coupon.validFrom && new Date(coupon.validFrom) > currentDate) {
        return sendResponse({ res, statusCode: httpStatus.BAD_REQUEST, message: 'Coupon is not yet valid' });
    }
    if (coupon.validUntil && new Date(coupon.validUntil) < currentDate) {
        return sendResponse({ res, statusCode: httpStatus.BAD_REQUEST, message: 'Coupon has expired' });
    }
    if (coupon.usageLimit && coupon.timesRedeemed >= coupon.usageLimit) {
        return sendResponse({ res, statusCode: httpStatus.BAD_REQUEST, message: 'Coupon usage limit reached' });
    }

    const cart = await getActiveCart(req.user.id);
    if (!cart) {
        return sendResponse({ res, statusCode: httpStatus.NOT_FOUND, message: 'Active cart not found' });
    }

    // Calculate current totals without any coupon
    const originalCoupon = cart.appliedCoupon;
    cart.appliedCoupon = null;
    const cartData = await buildCartResponse(cart);
    cart.appliedCoupon = originalCoupon; // Restore temporarily

    const totalBeforeDiscount =
        cartData.pricing.itemTotal + cartData.pricing.gst + cartData.pricing.deliveryFee + cartData.pricing.platformFee;

    if (totalBeforeDiscount === 0) {
        return sendResponse({
            res,
            statusCode: httpStatus.BAD_REQUEST,
            message: 'Cannot apply coupon to an empty cart',
        });
    }

    let potentialDiscount = 0;
    if (coupon.discountType === 'PERCENT') {
        potentialDiscount = (cartData.pricing.itemTotal * coupon.discountValue) / 100;
    } else if (coupon.discountType === 'FIXED') {
        potentialDiscount = coupon.discountValue;
    } else if (coupon.discountType === 'FREE_DELIVERY') {
        potentialDiscount = cartData.pricing.deliveryFee;
    }

    if (coupon.minOrderValue > 0 && totalBeforeDiscount < coupon.minOrderValue) {
        return sendResponse({
            res,
            statusCode: httpStatus.BAD_REQUEST,
            message: `Minimum Cart value should be ₹${coupon.minOrderValue} to apply this coupon`,
        });
    }

    if (totalBeforeDiscount <= potentialDiscount + 1) {
        return sendResponse({
            res,
            statusCode: httpStatus.BAD_REQUEST,
            message: 'Cart value should be greater than coupon value',
        });
    }

    cart.appliedCoupon = {
        coupon: coupon._id,
        code: coupon.code,
        discountType: coupon.discountType,
        discountAmount: coupon.discountValue,
    };

    await cart.save();

    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        message: 'Coupon applied successfully',
    });
};

export const removeCoupon = async (req, res) => {
    const cart = await Cart.findOne({ user: req.user.id, status: 'ACTIVE' });
    if (!cart) {
        return sendResponse({ res, statusCode: httpStatus.NOT_FOUND, message: 'Active cart not found' });
    }

    cart.appliedCoupon = null;
    await cart.save();

    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        message: 'Coupon removed successfully',
    });
};

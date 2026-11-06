// controllers/orders.controller.js
import mongoose from 'mongoose';
import env from '#configs/env';
import httpStatus from 'http-status';
import Joi from 'joi';
import chalk from 'chalk';
import Coupon from '#models/coupon';
import Cart from '#models/cart';
import PrintDocument from '#models/printDocument';
import PrintOrder from '#models/printOrder';
import PrintService from '#models/printService';
import StationeryProduct from '#models/stationeryProduct';
import User from '#models/user';
import Notification from '#models/notification';
import PrintCustomization from '#models/printCustomization';
import { NOTIFICATION_ICON_URL } from '#constants/notification';
import { resolvePrintPricing } from '#services/printPricing';
import { checkSameDayRepeatEligibility, calculateSameDayRepeatDiscountAmount } from '#services/sameDayRepeatDiscount';
import { getPricingSettings } from '#services/pricingSetting';
import { calculatePagination, sendResponse } from '#utils/generalHelper';
import { generateInvoicePdf } from '#utils/invoiceGenerator';
import { generateClientInvoicePdf } from '#utils/clientInvoiceGenerator';
import { buildPrintFileName } from '#utils/fileNameHelper';
import { sendPushNotification } from '#utils/firebase';
import * as rzpService from '#services/razorpay';
import { extractFileMetadataFromUrl } from '#utils/fileMetadata';
import { resolvePresignedGetUrl } from '#utils/s3Presigned';
import { UI_PRINT_LABELS } from '#constants/printMappings';
import { MOCK_TRACKING_COORDINATES } from '#constants/mockTracking';

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
import {
    getOrderByIdParamsSchema,
    listOrdersQuerySchema,
    adminOrderParamsSchema,
    adminListOrdersQuerySchema,
    adminUpdateOrderStatusSchema,
    verifyPaymentSchema,
    placeOrderBodySchema,
} from '#validations/order';

const ORDER_DOCUMENT_SELECT_FIELDS =
    '_id service originalFileName fileUrl pageCount fileExtension customization cartStatus isDeleted createdAt updatedAt';
const GST_RATE_PERCENT = 18;

const ORDER_STATUS_MAP = {
    RECEIVED: 1,
    PROCESSED: 2,
    DISPATCHED: 3,
    DELIVERED: 4,
    CANCELLED: 5,
    FAILED: 6,
    REATTEMPT: 7,
};

const ORDER_STATUS_REVERSE_MAP = {
    1: 'RECEIVED',
    2: 'PROCESSED',
    3: 'DISPATCHED',
    4: 'DELIVERED',
    5: 'CANCELLED',
    6: 'FAILED',
    7: 'REATTEMPT',
};

const CUSTOMIZATION_LABELS = {
    // Paper Size
    A4: 'Paper Size: A4',
    A3: 'Paper Size: A3',
    // Color Mode
    BW: 'Color Mode: Black & White',
    COLOR: 'Color Mode: Color',
    // Side Mode
    SINGLE: 'Side Mode: Single Sided',
    DOUBLE: 'Side Mode: Double Sided',
    // Paper Quality
    '70_GSM': 'Paper Quality: 70 GSM',
    '80_GSM': 'Paper Quality: 80 GSM',
    '100_GSM': 'Paper Quality: 100 GSM',
    '130_GSM': 'Paper Quality: 130 GSM',
    '70_75_GSM': 'Paper Quality: 70-75 GSM',
    STANDARD_70_75_GSM: 'Paper Quality: Standard Paper (70-75 GSM)',
    SPECIAL_100_GSM: 'Paper Quality: Special Paper (100 GSM)',
    BOND_100_GSM: 'Paper Quality: Bond Paper (100 GSM)',
    POSTER_STANDARD: 'Paper Quality: Normal Sheet',
    GLOSSY: 'Paper Quality: Glossy',
    FABRIC: 'Paper Quality: Fabric Poster',
    '300_GSM_ART_CARD': 'Paper Quality: 300 GSM Art Card',
    MATT_SHEET_250_GSM: 'Paper Quality: Matt Sheet(250GSM)',
    // Binding
    STAPLING: 'Binding: Stapling',
    STICK_BINDING: 'Binding: Stick Binding',
    SPIRAL_BINDING: 'Binding: Spiral Binding',
    WIRE_O_UPTO_100: 'Binding: Wire-O Binding',
    SOFT_BIND_300: 'Binding: Soft Binding',
    COMB_BIND_300: 'Binding: Comb Binding',
    STAPLED_20: 'Binding: Simple Staple',
    // Booklet
    COVER_PAGE: 'Booklet: Cover Page',
    TRANSPARENT_FRONT_COVER: 'Booklet: Transparent Front Cover',
    CUSTOM_COVER_PRINT: 'Booklet: Custom Cover Print',
    LAMINATION: 'Booklet: Lamination',
};

const roundCurrency = (amount = 0) => Number((Number(amount) || 0).toFixed(2));

const formatCurrency = (amount = 0) => roundCurrency(amount);

const calculateGstAmount = (taxableAmount, gstPercentage = GST_RATE_PERCENT) =>
    roundCurrency(((Number(taxableAmount) || 0) * (Number(gstPercentage) || 0)) / 100);

const toObjectIdString = (value) => value?.toString?.() || value || '';

const normalizeBookletOptionCodes = (value = '') => {
    if (Array.isArray(value)) {
        return value.map((entry) => String(entry).trim()).filter(Boolean);
    }

    return String(value || '')
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
};

const buildAddressSnapshot = (address = null) => {
    if (!address) return {};

    return {
        addressId: address._id || null,
        firstName: address.firstName || '',
        lastName: address.lastName || '',
        countryCode: address.countryCode || '',
        phone: address.phone || '',
        fullAddress: address.fullAddress || '',
        city: address.city || '',
        citySlug: address.citySlug || '',
        state: address.state || '',
        stateCode: address.stateCode || '',
        pincode: address.pincode || '',
        addressType: address.addressType || 'HOME',
        latitude: Number(address.latitude || 0),
        longitude: Number(address.longitude || 0),
        isDefault: Boolean(address.isDefault),
    };
};

const buildOrderItems = async (cart, serviceMap, pricingSettings = {}) => {
    const items = [];
    let itemIdx = 0;

    for (const cartItem of cart.items || []) {
        const serviceId = toObjectIdString(cartItem.service);
        const service = serviceMap.get(serviceId);
        const document = cartItem.document;

        if (!service) {
            const error = new Error('One or more cart items reference an invalid or inactive print service');
            error.statusCode = httpStatus.BAD_REQUEST;
            throw error;
        }

        if (!document) {
            const error = new Error('One or more cart items do not contain a printable document');
            error.statusCode = httpStatus.BAD_REQUEST;
            throw error;
        }

        if (document.isDeleted || document.cartStatus !== 'IN_CART') {
            const error = new Error('One or more cart documents are unavailable for checkout');
            error.statusCode = httpStatus.BAD_REQUEST;
            throw error;
        }

        const pricingResult = await resolvePrintPricing({
            service,
            customization: document.customization || {},
            totalPages: document.pageCount || 0,
            documentCount: 1,
        });

        const taxableAmount =
            roundCurrency(pricingResult.priceSummary?.baseAmount || 0) +
            roundCurrency(pricingResult.priceSummary?.addOnAmount || 0);
        const taxAmount = 0;
        const totalAmount = roundCurrency(taxableAmount);
        const fileName = buildPrintFileName({
            index: ++itemIdx,
            pageSize: pricingResult.finalCustomization?.paperSize,
            color: pricingResult.finalCustomization?.colorMode,
            copies: pricingResult.finalCustomization?.copies,
        });

        items.push({
            service: service._id,
            serviceSnapshot: {
                name: service.name,
                slug: service.slug,
                serviceType: service.serviceType,
            },
            document: {
                document: document._id,
                originalFileName: document.originalFileName || getOriginalFileNameFromUrl(document.fileUrl, fileName),
                fileUrl: document.fileUrl || '',
                pageCount: document.pageCount || 0,
            },
            customization: {
                copies: pricingResult.finalCustomization?.copies || document.customization?.copies || 1,
                orientation: pricingResult.finalCustomization?.orientation || '',
                paperSize: pricingResult.finalCustomization?.paperSize || '',
                colorMode: pricingResult.finalCustomization?.colorMode || '',
                sideMode: pricingResult.finalCustomization?.sideMode || '',
                paperQuality: pricingResult.finalCustomization?.paperQuality || '',
                stickBindingEnabled: Boolean(pricingResult.finalCustomization?.stickBindingEnabled),
                spiralBindingEnabled: Boolean(pricingResult.finalCustomization?.spiralBindingEnabled),
                staplingEnabled: Boolean(pricingResult.finalCustomization?.staplingEnabled),
                bookletOptionCodes: normalizeBookletOptionCodes(pricingResult.finalCustomization?.bookletOptionCodes),
                selectedBinding: pricingResult.selectedBinding || {},
                selectedAddOns: pricingResult.selectedAddOns || [],
                notes: pricingResult.finalCustomization?.notes || '',
                selectedBindingColorCode: document.customization?.selectedBindingColorCode || '',
            },
            priceSummary: {
                baseAmount: roundCurrency(pricingResult.priceSummary?.baseAmount || 0),
                addOnAmount: roundCurrency(pricingResult.priceSummary?.addOnAmount || 0),
                taxAmount: roundCurrency(taxAmount),
                totalAmount: roundCurrency(totalAmount),
            },
        });
    }

    return items;
};

export const buildOrderPriceSummary = (items = [], stationeryItems = [], appliedCoupon = null, options = {}) => {
    const itemTotal = roundCurrency(
        items.reduce((sum, item) => sum + (item.priceSummary?.baseAmount || 0), 0) +
            stationeryItems.reduce((sum, item) => sum + (item.priceSummary?.taxableAmount || 0), 0),
    );
    const addOnTotal = roundCurrency(items.reduce((sum, item) => sum + (item.priceSummary?.addOnAmount || 0), 0));
    const pricingSettings = options.pricingSettings || {};
    const deliveryFee = options.deliveryFee !== undefined
        ? Number(options.deliveryFee)
        : (pricingSettings.deliveryFee !== undefined ? Number(pricingSettings.deliveryFee) : 0);
    const platformFee = 0; // Statically locked to 0
    const taxAmount = 0; // Statically locked to 0
    const totalDiscountAmount = 0; // Statically locked to 0

    const subtotal = itemTotal + addOnTotal;
    const grandTotal = subtotal + roundCurrency(deliveryFee);

    return {
        itemTotal: roundCurrency(itemTotal),
        addOnTotal: roundCurrency(addOnTotal),
        taxAmount: 0,
        deliveryFee: roundCurrency(deliveryFee),
        platformFee: 0,
        discountAmount: 0,
        grandTotal: roundCurrency(grandTotal),
        currency: 'INR',
    };
};

const formatOrderPriceSummary = (summary = {}) => ({
    itemTotal: formatCurrency(summary.itemTotal),
    addOnTotal: formatCurrency(summary.addOnTotal),
    taxAmount: formatCurrency(summary.taxAmount),
    deliveryFee: formatCurrency(summary.deliveryFee),
    platformFee: formatCurrency(summary.platformFee),
    discountAmount: formatCurrency(summary.discountAmount),
    grandTotal: formatCurrency(summary.grandTotal),
    currency: summary.currency || 'INR',
});

/**
 * Format delivery assignment details for User & Admin order views.
 * Projects ONLY safe Rider profile fields (_id, firstName, lastName, fullName, email, phone, assignedAt).
 * Excludes sensitive fields (password, fid, fidStatus, role, accountStatus, etc.).
 */
const formatDeliveryAssignment = (order = {}) => {
    const ap = order.assignedPartner;
    const hasAssignedPartner = Boolean(ap && ap._id);

    if (!hasAssignedPartner) {
        return null;
    }

    const name = ap.fullName || `${ap.firstName || ''} ${ap.lastName || ''}`.trim();

    return {
        _id: ap._id,
        firstName: ap.firstName || '',
        lastName: ap.lastName || '',
        fullName: name,
        email: ap.email || '',
        phone: ap.phone || '',
        profilePicture: ap.profilePicture || '',
        assignedAt: order.assignedAt || null,
    };
};

const buildOrderListItem = async (order = {}) => {
    const printItems = Array.isArray(order.items) ? order.items : [];
    const stationeryItems = Array.isArray(order.stationeryItems) ? order.stationeryItems : [];

    const printPreviews = (
        await Promise.all(
            printItems.map(async (item) => {
                const s3Url = item?.document?.fileUrl || '';
                if (!s3Url) return null;
                const presignedUrl = await resolvePresignedGetUrl(s3Url);
                return {
                    s3Url: presignedUrl,
                    fileExtension: getFileExtensionFromUrl(s3Url),
                };
            }),
        )
    ).filter(Boolean);

    const stationeryPreviews = (
        await Promise.all(
            stationeryItems.map(async (item) => {
                const s3Url = item?.itemSnapshot?.thumbnailUrl || '';
                if (!s3Url) return null;
                const presignedUrl = await resolvePresignedGetUrl(s3Url);
                return {
                    s3Url: presignedUrl,
                    fileExtension: getFileExtensionFromUrl(s3Url),
                };
            }),
        )
    ).filter(Boolean);

    const combinedPreviews = [...printPreviews, ...stationeryPreviews];
    const totalItems = printItems.length + stationeryItems.length;

    const documentPreviewUrls = combinedPreviews.slice(0, 3);
    const remainingDocumentsCount = Math.max(totalItems - documentPreviewUrls.length, 0);

    return {
        _id: order._id,
        orderNumber: order.orderNumber,
        orderStatus: ORDER_STATUS_MAP[order.orderStatus] || order.orderStatus,
        paymentStatus: order.paymentStatus,
        paymentMethod: order.paymentMethod || '',
        deliveryMode: order.deliveryMode,
        deliveryAssignment: formatDeliveryAssignment(order),
        itemCount: totalItems,
        documentPreviewUrls,
        remainingDocumentsLabel: remainingDocumentsCount > 0 ? `+${remainingDocumentsCount}` : '',
        totalPrice: formatCurrency(order.priceSummary?.grandTotal || 0),
        contactPhone: env.WHATSAPP_CONTACT_PHONE || '',
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
    };
};

const getFileExtensionFromUrl = (url = '') => {
    try {
        // remove query params if any
        const cleanUrl = url.split('?')[0];

        // get last path segment
        const fileName = cleanUrl.substring(cleanUrl.lastIndexOf('/') + 1);

        if (!fileName.includes('.')) return '';

        return fileName.split('.').pop().toLowerCase().trim();
    } catch (err) {
        return '';
    }
};

const buildOrderDetailItem = async (item = {}) => {
    const customization = item.customization || {};
    const doc = item.document || {};
    const serviceSlug = item.serviceSnapshot?.slug || '';

    let resolvedQuality = '';
    if (customization.paperQuality) {
        resolvedQuality = CUSTOMIZATION_LABELS[customization.paperQuality] || customization.paperQuality;
    } else {
        const size = customization.paperSize || '';
        const color = customization.colorMode || '';

        if (['document-printing', 'digital-printing'].includes(serviceSlug)) {
            if (size === 'A4' || size === 'A3') {
                resolvedQuality = color === 'COLOR' ? '100 GSM' : '70-75 GSM';
            }
        } else if (serviceSlug === 'thesis-printing') {
            resolvedQuality = CUSTOMIZATION_LABELS['SPECIAL_100_GSM'] || 'Special Paper (100 GSM)';
        } else if (serviceSlug === 'thesis-golden-bindings') {
            resolvedQuality = color === 'COLOR' ? '100 GSM' : '70-75 GSM';
        } else if (serviceSlug === 'photo-printing') {
            resolvedQuality = '300 GSM Art Card';
        } else if (serviceSlug === 'certificate') {
            resolvedQuality = 'Matt Sheet(250GSM)';
        } else if (serviceSlug === 'poster-printing') {
            resolvedQuality = color === 'COLOR' ? 'Glossy Sheet' : 'Normal Sheet';
        }
    }

    const bindingSelections = [];

    // Filter BINDING_TOGGLE from selectedAddOns
    const toggles = (customization.selectedAddOns || []).filter((addon) => addon.group === 'BINDING_TOGGLE');

    if (toggles.length > 0) {
        toggles.forEach((t) => {
            bindingSelections.push({
                optionId: t.optionId !== undefined ? t.optionId : null,
                optionCode: t.code || '',
                optionLabel: t.label || '',
                subOptionId: t.subOptionId !== undefined ? t.subOptionId : null,
                subOptionCode: t.subOptionCode || '',
                subOptionLabel: t.subOptionLabel || '',
                price: t.unitPrice || 0,
                quantity: t.quantity || 1,
                totalAmount: t.totalAmount || 0,
            });
        });
    } else if (customization.selectedBinding && customization.selectedBinding.code) {
        // Fallback to legacy selectedBinding
        bindingSelections.push({
            optionId: null,
            optionCode: customization.selectedBinding.code || '',
            optionLabel: customization.selectedBinding.label || '',
            subOptionId: null,
            subOptionCode: '',
            subOptionLabel: '',
            price: customization.selectedBinding.unitPrice || 0,
            quantity: 1,
            totalAmount: customization.selectedBinding.totalAmount || 0,
        });
    }

    const selectedBindingColorCode = customization.selectedBindingColorCode || '';
    const selectedBindingColorCodeLabel = selectedBindingColorCode
        ? UI_PRINT_LABELS[selectedBindingColorCode] || selectedBindingColorCode
        : '';

    const isThesisBinding = serviceSlug === 'thesis-golden-bindings';
    const presignedFileUrl = doc?.fileUrl ? await resolvePresignedGetUrl(doc.fileUrl) : '';

    return {
        itemType: 'PRINT',
        name: item.serviceSnapshot?.name || '',
        copies: customization.copies || 1,
        totalAmount: formatCurrency((item.priceSummary?.baseAmount || 0) + (item.priceSummary?.addOnAmount || 0)),
        serviceId: item.service || null,
        serviceName: item.serviceSnapshot?.name || '',
        docId: doc?.document || null,
        originalFileName: doc?.originalFileName || '',
        fileExtension: getFileExtensionFromUrl(doc?.fileUrl),
        fileUrl: presignedFileUrl,
        pageCount: doc?.pageCount || 0,
        ...(!isThesisBinding && {
            paperSize: customization.paperSize || '',
            colorMode: customization.colorMode || '',
            sideMode: customization.sideMode || '',
            paperQuality: customization.paperQuality || '',
            paperQualityLabel: resolvedQuality || '',
        }),
        customization: {
            bindingSelections,
            ...(selectedBindingColorCode && {
                selectedBindingColorCode,
                selectedBindingColorCodeLabel,
            }),
        },
    };
};

const buildOrderDetail = async (order = {}) => {
    const statusHistory = order.statusHistory || [];
    const latest =
        statusHistory.length > 0
            ? statusHistory[statusHistory.length - 1]
            : { status: order.orderStatus || 'RECEIVED', note: 'Order placed', changedAt: order.createdAt };

    const printItems = await Promise.all((order.items || []).map(buildOrderDetailItem));
    const stationeryItems = await Promise.all(
        (order.stationeryItems || []).map(async (item) => ({
            itemType: 'STATIONERY',
            name: item.itemSnapshot?.name || 'Unknown Item',
            brand: item.itemSnapshot?.brand || 'General',
            quantity: item.quantity || 1,
            thumbnailUrl: item.itemSnapshot?.thumbnailUrl
                ? await resolvePresignedGetUrl(item.itemSnapshot.thumbnailUrl)
                : '',
            totalAmount: formatCurrency(item.priceSummary?.taxableAmount || 0),
        })),
    );

    return {
        _id: order._id,
        orderNumber: order.orderNumber,
        cart: order.cart,
        items: [...printItems, ...stationeryItems],
        deliveryAddress: order.deliveryAddress,
        deliveryAssignment: formatDeliveryAssignment(order),
        priceSummary: formatOrderPriceSummary({
            itemTotal: (order.priceSummary?.itemTotal || 0) + (order.priceSummary?.addOnTotal || 0),
            taxAmount: order.priceSummary?.taxAmount || 0,
            deliveryFee: order.priceSummary?.deliveryFee || 0,
            platformFee: order.priceSummary?.platformFee || 0,
            discountAmount: order.priceSummary?.discountAmount || 0,
            grandTotal: order.priceSummary?.grandTotal || 0,
        }),
        status: ORDER_STATUS_MAP[latest.status] || latest.status,
        note: latest.note || '',
        contactPhone: env.WHATSAPP_CONTACT_PHONE || '',
        changedAt: latest.changedAt,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
    };
};

const isTransactionUnsupportedError = (error) =>
    String(error?.message || '').includes('Transaction numbers are only allowed on a replica set member or mongos');

const applySession = (query, session = null) => {
    if (!session) return query;

    return query.session(session);
};

export const placeOrderInternal = async (
    userId,
    session = null,
    cartStatus = 'ACTIVE',
    existingCart = null,
    orderOverrides = {},
) => {
    let cart = existingCart;
    if (!cart) {
        const cartQuery = Cart.findOne({ user: userId, status: cartStatus }).populate(
            'items.document',
            ORDER_DOCUMENT_SELECT_FIELDS,
        );
        cart = await applySession(cartQuery, session);
    } else if (!cart.populated?.('items.document')) {
        await cart.populate({ path: 'items.document', select: ORDER_DOCUMENT_SELECT_FIELDS });
    }

    if (!cart) {
        const error = new Error('Active cart not found');
        error.statusCode = httpStatus.NOT_FOUND;
        throw error;
    }

    if (!cart.items?.length && !cart.stationeryItems?.length) {
        const error = new Error('Cart is empty');
        error.statusCode = httpStatus.BAD_REQUEST;
        throw error;
    }

    if (cart.deliveryMode === 'DELIVERY' && !cart.selectedAddressId) {
        const error = new Error('Checkout details are incomplete');
        error.statusCode = httpStatus.BAD_REQUEST;
        throw error;
    }

    const userQuery = User.findById(userId).select('_id addresses');
    const user = await applySession(userQuery, session);
    if (!user) {
        const error = new Error('User not found');
        error.statusCode = httpStatus.NOT_FOUND;
        throw error;
    }

    const selectedAddress = cart.deliveryMode === 'DELIVERY' ? user.addresses.id(cart.selectedAddressId) : null;

    if (cart.deliveryMode === 'DELIVERY' && !selectedAddress) {
        const error = new Error('Selected delivery address is invalid');
        error.statusCode = httpStatus.BAD_REQUEST;
        throw error;
    }

    let orderItems = [];
    let orderStationeryItems = [];
    let orderPriceSummary = null;

    // Use Frozen Pricing Snapshot if available, else recalculate
    if (cart.pendingPaymentContext && cart.pendingPaymentContext.frozenPricing) {
        orderItems = cart.pendingPaymentContext.frozenPricing.orderItems || [];
        orderStationeryItems = cart.pendingPaymentContext.frozenPricing.orderStationeryItems || [];
        orderPriceSummary = cart.pendingPaymentContext.frozenPricing.orderPriceSummary || {};

        // Still need to reduce stock inside transaction
        for (const stationeryItem of orderStationeryItems) {
            await StationeryProduct.updateOne(
                { _id: stationeryItem.stationery },
                { $inc: { stock: -stationeryItem.quantity } },
                session ? { session } : undefined,
            );
        }
    } else {
        const serviceIds = [
            ...new Set((cart.items || []).map((item) => toObjectIdString(item.service)).filter(Boolean)),
        ];
        const stationeryIds = [
            ...new Set((cart.stationeryItems || []).map((item) => toObjectIdString(item.stationery)).filter(Boolean)),
        ];

        const servicesQuery = PrintService.find({ _id: { $in: serviceIds }, isActive: true })
            .select('-__v')
            .lean();
        const stationeriesQuery = StationeryProduct.find({ _id: { $in: stationeryIds }, isActive: true })
            .select('name itemPrice thumbnailUrl brand')
            .lean();

        const [services, stationeries, pricingSettings] = await Promise.all([
            applySession(servicesQuery, session),
            applySession(stationeriesQuery, session),
            getPricingSettings(),
        ]);

        const serviceMap = new Map(services.map((service) => [service._id.toString(), service]));
        const stationeryMap = new Map(stationeries.map((s) => [s._id.toString(), s]));

        orderItems = await buildOrderItems(cart, serviceMap, pricingSettings);

        orderStationeryItems = [];
        for (const sCartItem of cart.stationeryItems || []) {
            const stationery = stationeryMap.get(toObjectIdString(sCartItem.stationery));
            if (!stationery) {
                const error = new Error('One or more cart items reference an invalid or inactive stationery product');
                error.statusCode = httpStatus.BAD_REQUEST;
                throw error;
            }

            const taxableAmount = roundCurrency(stationery.itemPrice * sCartItem.quantity);
            const taxAmount = 0;
            const totalAmount = taxableAmount;

            orderStationeryItems.push({
                stationery: stationery._id,
                itemSnapshot: {
                    name: stationery.name,
                    brand: stationery.brand || 'General',
                    productType: 'STATIONERY',
                    thumbnailUrl: stationery.thumbnailUrl || '',
                },
                quantity: sCartItem.quantity,
                priceSummary: {
                    unitPrice: stationery.itemPrice,
                    taxableAmount: taxableAmount,
                    taxAmount: taxAmount,
                    totalAmount: totalAmount,
                },
            });

            // Reduce stock (inside transaction)
            await StationeryProduct.updateOne(
                { _id: stationery._id },
                { $inc: { stock: -sCartItem.quantity } },
                session ? { session } : undefined,
            );
        }

        const isRepeatEligible = await checkSameDayRepeatEligibility(userId);
        let repeatDiscountAmount = 0;
        if (isRepeatEligible) {
            const itemSubtotal =
                orderItems.reduce((sum, item) => sum + (item.priceSummary?.baseAmount || 0), 0) +
                orderStationeryItems.reduce((sum, item) => sum + (item.priceSummary?.taxableAmount || 0), 0);
            const addOnTotal = orderItems.reduce((sum, item) => sum + (item.priceSummary?.addOnAmount || 0), 0);
            const subtotalForTax = itemSubtotal + addOnTotal;

            let calculatedCouponDiscount = 0;
            if (cart.appliedCoupon && cart.appliedCoupon.code) {
                const { discountType, discountAmount } = cart.appliedCoupon;
                if (discountType === 'PERCENT') {
                    calculatedCouponDiscount = (subtotalForTax * discountAmount) / 100;
                } else if (discountType === 'FIXED') {
                    calculatedCouponDiscount = discountAmount;
                } else if (discountType === 'FREE_DELIVERY') {
                    calculatedCouponDiscount = pricingSettings.deliveryFee;
                }
            }

            const roundedCouponDiscount = roundCurrency(calculatedCouponDiscount);
            const netSubtotalAfterCoupon = Math.max(0, subtotalForTax - roundedCouponDiscount);
            repeatDiscountAmount = calculateSameDayRepeatDiscountAmount(
                netSubtotalAfterCoupon,
                pricingSettings.sameDayRepeatDiscountPercentage,
            );
        }

        orderPriceSummary = buildOrderPriceSummary(orderItems, orderStationeryItems, cart.appliedCoupon, {
            repeatDiscountAmount,
            pricingSettings,
        });
    }
    const documentIds = orderItems.map((item) => item.document?.document).filter(Boolean);

    const [order] = await PrintOrder.create(
        [
            {
                user: userId,
                cart: cart._id,
                items: orderItems,
                stationeryItems: orderStationeryItems,
                deliveryMode: cart.deliveryMode,
                deliveryAddress: buildAddressSnapshot(selectedAddress),
                appliedCoupon: {
                    coupon: cart.appliedCoupon?.coupon || null,
                    code: cart.appliedCoupon?.code || '',
                    discountType: cart.appliedCoupon?.discountType || '',
                    discountAmount: roundCurrency(cart.appliedCoupon?.discountAmount || 0),
                },
                priceSummary: orderPriceSummary,
                paymentStatus: orderOverrides.paymentStatus || 'PENDING',
                paymentMethod: orderOverrides.paymentMethod || cart.paymentMethod || '',
                razorpayOrderId: orderOverrides.razorpayOrderId || cart.pendingPaymentContext?.razorpayOrderId || undefined,
                razorpayPaymentId: orderOverrides.razorpayPaymentId || undefined,
                razorpaySignature: orderOverrides.razorpaySignature || undefined,
                paidAt: orderOverrides.paidAt || undefined,
                statusHistory: [
                    {
                        status: 'RECEIVED',
                        changedBy: null,
                        note: 'Order placed',
                        changedAt: new Date(),
                    },
                ],
            },
        ],
        session ? { session } : undefined,
    );

    await PrintDocument.updateMany(
        { _id: { $in: documentIds }, user: userId, isDeleted: false, cartStatus: 'IN_CART' },
        { $set: { cartStatus: 'ORDERED' } },
        session ? { session } : undefined,
    );

    // Clean up any customization sessions for these ordered documents
    await PrintCustomization.deleteMany(
        { documentId: { $in: documentIds }, user: userId },
        session ? { session } : undefined,
    );

    cart.status = 'CHECKED_OUT';
    await cart.save(session ? { session } : undefined);

    let activeCartExistsQuery = Cart.exists({ user: userId, status: 'ACTIVE' });
    if (session) activeCartExistsQuery = activeCartExistsQuery.session(session);
    const activeCartExists = await activeCartExistsQuery;
    if (!activeCartExists) {
        await Cart.create([{ user: userId }], session ? { session } : undefined);
    }

    console.log(
        `[CHECKOUT] Order created: #${order.orderNumber} (ID: ${order._id}) | User: ${userId} | Status: ${order.orderStatus} | Payment: ${order.paymentStatus}`,
    );
    console.log(
        `[CHECKOUT] Price Snapshot: Item Total: ${orderPriceSummary.itemTotal} | AddOn Total: ${orderPriceSummary.addOnTotal} | Tax: ${orderPriceSummary.taxAmount} | Platform Fee: ${orderPriceSummary.platformFee} | Grand Total: ${orderPriceSummary.grandTotal}`,
    );
    for (const item of orderItems) {
        console.log(
            `[CHECKOUT] Item Snapshot: ${item.serviceSnapshot?.name} | PageCount: ${item.document?.pageCount} | Copies: ${item.customization?.copies} | Base: ${item.priceSummary?.baseAmount} | AddOn: ${item.priceSummary?.addOnAmount} | Total: ${item.priceSummary?.totalAmount}`,
        );
    }

    return order.toObject();
};

/**
 * Perform a "dry-run" calculation of the order's Grand Total and build the items context
 */
const buildCheckoutContext = async (cart) => {
    const serviceIds = [...new Set((cart.items || []).map((item) => toObjectIdString(item.service)).filter(Boolean))];
    const stationeryIds = [
        ...new Set((cart.stationeryItems || []).map((item) => toObjectIdString(item.stationery)).filter(Boolean)),
    ];

    const [services, stationeries, pricingSettings] = await Promise.all([
        PrintService.find({ _id: { $in: serviceIds }, isActive: true })
            .select('-__v')
            .lean(),
        StationeryProduct.find({ _id: { $in: stationeryIds }, isActive: true })
            .select('name itemPrice thumbnailUrl brand')
            .lean(),
        getPricingSettings(),
    ]);

    const serviceMap = new Map(services.map((service) => [service._id.toString(), service]));
    const stationeryMap = new Map(stationeries.map((s) => [s._id.toString(), s]));

    const orderItems = await buildOrderItems(cart, serviceMap, pricingSettings);

    const orderStationeryItems = (cart.stationeryItems || []).map((sCartItem) => {
        const stationery = stationeryMap.get(toObjectIdString(sCartItem.stationery));
        if (!stationery) throw new Error('Invalid stationery product in cart');

        const taxableAmount = roundCurrency(stationery.itemPrice * sCartItem.quantity);
        const taxAmount = 0;
        const totalAmount = taxableAmount;

        return {
            stationery: stationery._id,
            itemSnapshot: {
                name: stationery.name,
                brand: stationery.brand || 'General',
                productType: 'STATIONERY',
                thumbnailUrl: stationery.thumbnailUrl || '',
            },
            quantity: sCartItem.quantity,
            priceSummary: {
                unitPrice: stationery.itemPrice,
                taxableAmount,
                taxAmount,
                totalAmount,
            },
        };
    });

    const isRepeatEligible = await checkSameDayRepeatEligibility(cart.user);
    let repeatDiscountAmount = 0;
    if (isRepeatEligible) {
        const itemSubtotal =
            orderItems.reduce((sum, item) => sum + (item.priceSummary?.baseAmount || 0), 0) +
            orderStationeryItems.reduce((sum, item) => sum + (item.priceSummary?.taxableAmount || 0), 0);
        const addOnTotal = orderItems.reduce((sum, item) => sum + (item.priceSummary?.addOnAmount || 0), 0);
        const subtotalForTax = itemSubtotal + addOnTotal;

        let calculatedCouponDiscount = 0;
        if (cart.appliedCoupon && cart.appliedCoupon.code) {
            const { discountType, discountAmount } = cart.appliedCoupon;
            if (discountType === 'PERCENT') {
                calculatedCouponDiscount = (subtotalForTax * discountAmount) / 100;
            } else if (discountType === 'FIXED') {
                calculatedCouponDiscount = discountAmount;
            } else if (discountType === 'FREE_DELIVERY') {
                calculatedCouponDiscount = pricingSettings.deliveryFee;
            }
        }

        const roundedCouponDiscount = roundCurrency(calculatedCouponDiscount);
        const netSubtotalAfterCoupon = Math.max(0, subtotalForTax - roundedCouponDiscount);
        repeatDiscountAmount = calculateSameDayRepeatDiscountAmount(
            netSubtotalAfterCoupon,
            pricingSettings.sameDayRepeatDiscountPercentage,
        );
    }

    const summary = buildOrderPriceSummary(orderItems, orderStationeryItems, cart.appliedCoupon, {
        repeatDiscountAmount,
        pricingSettings,
    });
    return {
        cartTotal: summary.grandTotal,
        frozenPricing: {
            orderItems,
            orderStationeryItems,
            orderPriceSummary: summary,
        },
    };
};

/**
 * Initiation Phase: Calculate total and create Razorpay order.
 * No local Order is created yet.
 * @route POST /api/orders
 */
export const placeOrder = async (req, res) => {
    const { error, value } = placeOrderBodySchema.validate(req.body);
    if (error) return sendResponse({ res, statusCode: httpStatus.BAD_REQUEST, message: error.details[0].message });

    // 1. Mandatory Phone Check
    const user = await User.findById(req.user.id).select('phone');
    if (!user?.phone) {
        return sendResponse({
            res,
            statusCode: httpStatus.PRECONDITION_FAILED,
            message: 'A phone number is required to place an order. Please update your profile.',
            data: { isPhoneProvided: false },
        });
    }

    const cart = await Cart.findOne({ user: req.user.id, status: 'ACTIVE' }).populate('items.document');
    if (!cart || (!cart.items?.length && !cart.stationeryItems?.length)) {
        return sendResponse({ res, statusCode: httpStatus.BAD_REQUEST, message: 'Cart is empty or invalid' });
    }

    try {
        // 1. Calculate amount exactly as it would be during placement
        // Temporarily set context for dry-run
        cart.deliveryMode = value.deliveryMode;
        cart.selectedAddressId = value.addressId || null;

        const checkoutContext = await buildCheckoutContext(cart);
        const cartTotal = checkoutContext.cartTotal;

        // 2. Create Razorpay order
        const rzpOrder = await rzpService.createRzpOrder(cartTotal, `TEMP_${Date.now()}`);

        // 3. Save intent in Cart so we can finalize later
        cart.pendingPaymentContext = {
            razorpayOrderId: rzpOrder.id,
            addressId: value.addressId || null,
            deliveryMode: value.deliveryMode,
            couponCode: value.couponCode || '',
            frozenPricing: checkoutContext.frozenPricing,
        };
        await cart.save();

        return sendResponse({
            res,
            statusCode: httpStatus.OK,
            message: 'Payment initiated. Confirm checkout to place order.',
            data: {
                razorpayOrderId: rzpOrder.id,
                amount: Math.round(cartTotal * 100),
                currency: 'INR',
            },
        });
    } catch (err) {
        console.error('[Razorpay Initiation Fail]: ', err);
        return sendResponse({
            res,
            statusCode: httpStatus.INTERNAL_SERVER_ERROR,
            message: 'Failed to initiate payment process',
        });
    }
};

/**
 * Send order notifications (extracted logic)
 */
const sendNotifications = async (order) => {
    // 🛡️ Safety Guard: Only send 'Order Received' notification if order is strictly PAID and received
    if (order.paymentStatus !== 'PAID' || ['FAILED', 'CANCELLED'].includes(order.orderStatus)) {
        console.warn(
            chalk.bold.yellow(
                `[Notification] ⚠️ BLOCKED placement notification for Order #${order.orderNumber}: paymentStatus is '${order.paymentStatus}' and orderStatus is '${order.orderStatus}'`,
            ),
        );
        return;
    }

    const notificationTitle = 'Order Received';
    const notificationBody = `Your order #${order.orderNumber} has been received and is being processed.`;

    try {
        await Notification.create({
            title: notificationTitle,
            body: notificationBody,
            type: 'IN_APP',
            category: 'ORDER_NOTIFICATION',
            recipient: order.user,
            order: order._id,
            imageUrl: NOTIFICATION_ICON_URL,
            data: {
                orderNumber: String(order.orderNumber),
                orderStatus: ORDER_STATUS_MAP['RECEIVED'], // 5
                // orderStatus: String(ORDER_STATUS_MAP['RECEIVED']),
            },
        });
    } catch (err) {
        console.error('[Notification Creation Fail]:', err);
    }

    User.findById(order.user)
        .select('fcmToken')
        .lean()
        .then((user) => {
            if (user?.fcmToken) {
                sendPushNotification(user.fcmToken, notificationTitle, notificationBody, {
                    type: 'ORDER_NOTIFICATION',
                    orderId: order._id.toString(),
                });
            }
            console.log(
                chalk.bold.magenta(
                    `[Notification] Order placement notification successfully sent to user ${order.user} for order #${order.orderNumber}.`,
                ),
            );
        })
        .catch((e) => console.error('FCM Fail:', e));
};

/**
 * Send order failure notifications (In-App + FCM push)
 */
export const notifyUserOrderFailed = async (
    order,
    reason = 'Payment or verification failed. Refund will be initiated shortly.',
) => {
    if (!order || !order.user) return;

    // 🛡️ Safety Guard: Never send failure notification if order is already PAID or fulfilled!
    if (
        order.paymentStatus === 'PAID' ||
        ['RECEIVED', 'PROCESSED', 'DISPATCHED', 'DELIVERED'].includes(order.orderStatus)
    ) {
        console.warn(
            `[Notification] ⚠️ BLOCKED order failure notification for Order #${order.orderNumber}: Order is already in healthy state (${order.orderStatus} / ${order.paymentStatus}).`,
        );
        return;
    }

    const notificationTitle = 'Order Payment Failed';
    const notificationBody = `Your order #${order.orderNumber} could not be completed. ${reason}`;
    const notificationData = {
        orderNumber: String(order.orderNumber),
        orderStatus: ORDER_STATUS_MAP['FAILED'], // 6
    };

    try {
        await Notification.create({
            title: notificationTitle,
            body: notificationBody,
            type: 'IN_APP',
            category: 'ORDER_NOTIFICATION',
            recipient: order.user,
            order: order._id,
            imageUrl: NOTIFICATION_ICON_URL,
            data: notificationData,
            sentBy: null,
        });
    } catch (err) {
        console.error('[Notification] Failed to create in-app notification for failed order:', err.message);
    }

    User.findById(order.user)
        .select('fcmToken')
        .lean()
        .then((user) => {
            if (user?.fcmToken) {
                sendPushNotification(user.fcmToken, notificationTitle, notificationBody, {
                    ...notificationData,
                    type: 'ORDER_NOTIFICATION',
                    orderId: order._id.toString(),
                });
            }
            console.log(
                chalk.bold.magenta(
                    `[Notification] Order failure notification successfully sent to user ${order.user} for order #${order.orderNumber}.`,
                ),
            );
        })
        .catch((e) => console.error('[Notification] FCM Fail for failed order:', e.message));
};

/**
 * Verifies signature and creates the local order (Idempotent)
 */
export const finalizeOrderAfterPayment = async ({
    userId,
    razorpayOrderId,
    razorpayPaymentId,
    razorpaySignature = '',
}) => {
    // 1. Deduplication Fast-Path: Check if order already exists and is finalized
    const existingOrder = await PrintOrder.findOne({ razorpayOrderId });
    if (existingOrder) {
        console.log(
            `[ORDER_DEDUPLICATION] ⚡ Fast path: Order #${existingOrder.orderNumber} already finalized for Razorpay Order ID: ${razorpayOrderId}. Payment Status: ${existingOrder.paymentStatus}`,
        );
        return existingOrder;
    }

    // 2. Fetch and strictly verify payment details from Razorpay gateway
    let paymentMethod = 'ONLINE';
    if (razorpayPaymentId) {
        console.log(`[PAYMENT_GATE] Fetching live payment details from Razorpay for Payment ID: ${razorpayPaymentId}`);
        let rzpPmt = null;
        try {
            rzpPmt = await rzpService.getPaymentDetails(razorpayPaymentId);
        } catch (fetchErr) {
            console.error(
                `[PAYMENT_GATE] ❌ Failed to fetch payment details from Razorpay for ${razorpayPaymentId}: ${fetchErr.message}`,
            );
            throw new Error(`Unable to verify payment with Razorpay: ${fetchErr.message}`);
        }

        // 2a. Status validation: Must be strictly captured
        if (rzpPmt.status !== 'captured' || !rzpPmt.captured) {
            console.error(
                `[PAYMENT_GATE] ⛔ Payment NOT captured on Razorpay! Payment ID: ${razorpayPaymentId} | Status: ${rzpPmt.status} | Captured: ${rzpPmt.captured}`,
            );
            throw new Error(`Payment is not captured on Razorpay gateway. Current status: ${rzpPmt.status}`);
        }

        // 2b. Order ID match validation
        if (rzpPmt.order_id && rzpPmt.order_id !== razorpayOrderId) {
            console.error(
                `[PAYMENT_GATE] ⛔ Razorpay Order ID mismatch! Expected: ${razorpayOrderId}, but payment entity has: ${rzpPmt.order_id}`,
            );
            throw new Error(`Razorpay Order ID mismatch for payment ${razorpayPaymentId}`);
        }

        const method = String(rzpPmt?.method || '').toUpperCase();
        if (method === 'NETBANKING') paymentMethod = 'NET_BANKING';
        else if (method) paymentMethod = method;

        console.log(
            `[PAYMENT_GATE] ✅ Payment verified with Razorpay! ID: ${razorpayPaymentId} | Status: captured | Method: ${paymentMethod} | Amount: ₹${(rzpPmt.amount / 100).toFixed(2)}`,
        );
    }

    // 3. Atomically claim/lock the cart: status 'ACTIVE' -> 'PROCESSING'
    const cartLookup = {
        status: 'ACTIVE',
        'pendingPaymentContext.razorpayOrderId': razorpayOrderId,
    };
    if (userId) cartLookup.user = userId;

    let lockedCart = await Cart.findOneAndUpdate(
        cartLookup,
        { $set: { status: 'PROCESSING' } },
        { returnDocument: 'after' },
    );

    if (!lockedCart) {
        // Check if another concurrent thread already finalized the order
        const concurrentOrder = await PrintOrder.findOne({ razorpayOrderId });
        if (concurrentOrder) {
            console.log(
                `[ORDER_DEDUPLICATION] ⚡ Order #${concurrentOrder.orderNumber} already finalized concurrently for Razorpay Order ID: ${razorpayOrderId}. Returning existing order safely.`,
            );
            return concurrentOrder;
        }

        // What if another thread is currently in-flight (status: 'PROCESSING')?
        // Poll briefly (up to 4 seconds) for the in-flight processing to complete
        for (let attempt = 0; attempt < 8; attempt++) {
            await new Promise((r) => setTimeout(r, 500));
            const inFlightOrder = await PrintOrder.findOne({ razorpayOrderId });
            if (inFlightOrder) {
                console.log(
                    `[ORDER_DEDUPLICATION] ⚡ In-flight finalized order found: #${inFlightOrder.orderNumber} for Razorpay Order ID: ${razorpayOrderId}. Returning safely.`,
                );
                return inFlightOrder;
            }
        }

        console.error(
            `[PAYMENT_FINALIZE] ERROR: Payment context not found for Razorpay Order ID: ${razorpayOrderId} | User: ${userId || 'N/A'}. Cart may be already checked out or expired.`,
        );
        throw new Error('Payment context not found for ' + razorpayOrderId);
    }

    console.log(
        `[CART_LOCK] 🔒 Successfully acquired atomic lock for Cart ${lockedCart._id} (status: ACTIVE -> PROCESSING)`,
    );

    const finalUserId = userId || lockedCart.user.toString();
    const orderOverrides = {
        paymentStatus: 'PAID',
        paymentMethod,
        razorpayOrderId,
        razorpayPaymentId,
        razorpaySignature,
        paidAt: new Date(),
    };

    let finalizedOrder = null;
    let session = await mongoose.startSession();

    try {
        await session.withTransaction(async () => {
            lockedCart.deliveryMode = lockedCart.pendingPaymentContext.deliveryMode;
            lockedCart.selectedAddressId = lockedCart.pendingPaymentContext.addressId;
            await lockedCart.save({ session });

            console.log(
                `[CHECKOUT] Creating Order for Cart ${lockedCart._id} with Razorpay Order: ${razorpayOrderId}`,
            );

            finalizedOrder = await placeOrderInternal(
                finalUserId,
                session,
                'PROCESSING',
                lockedCart,
                orderOverrides,
            );
        });
    } catch (error) {
        if (isTransactionUnsupportedError(error)) {
            // Fallback for standalone MongoDB (No Transactions)
            lockedCart.deliveryMode = lockedCart.pendingPaymentContext.deliveryMode;
            lockedCart.selectedAddressId = lockedCart.pendingPaymentContext.addressId;
            await lockedCart.save();

            finalizedOrder = await placeOrderInternal(
                finalUserId,
                null,
                'PROCESSING',
                lockedCart,
                orderOverrides,
            );
        } else {
            // Revert cart status back to ACTIVE if failed before checkout
            try {
                await Cart.updateOne(
                    { _id: lockedCart._id, status: 'PROCESSING' },
                    { $set: { status: 'ACTIVE' } },
                );
            } catch (revErr) {}
            throw error;
        }
    } finally {
        await session.endSession();
    }

    console.log(
        `[CART_LOCK] 🔓 Cart ${lockedCart._id} transitioned to CHECKED_OUT`,
    );
    console.log(
        `[PAYMENT_FINALIZE] ✅ SUCCESS: Order #${finalizedOrder.orderNumber} finalized | Payment Status: PAID | Method: ${finalizedOrder.paymentMethod} | Razorpay Payment ID: ${razorpayPaymentId}`,
    );

    await sendNotifications(finalizedOrder);
    return finalizedOrder;
};

/**
 * Finalization Phase: Verify signature and finally create the local order.
 * @route POST /api/orders/verify-payment
 */
export const verifyPayment = async (req, res) => {
    const { error, value } = verifyPaymentSchema.validate(req.body);
    if (error) {
        console.error(`[PAYMENT_VERIFY] ERROR: Validation failed - ${error.details[0].message}`);
        return sendResponse({ res, statusCode: httpStatus.BAD_REQUEST, message: error.details[0].message });
    }

    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = value;
    console.log(
        `[PAYMENT_VERIFY] Starting verification for Razorpay Order: ${razorpay_order_id} | Payment ID: ${razorpay_payment_id} | User: ${req.user.id}`,
    );

    // 1. Sign verification
    const isValid = rzpService.verifyRzpSignature(razorpay_order_id, razorpay_payment_id, razorpay_signature);
    if (!isValid) {
        console.error(
            `[PAYMENT_VERIFY] ERROR: Signature verification failed for Razorpay Order: ${razorpay_order_id} | Payment ID: ${razorpay_payment_id}. Signature does not match expected HMAC digest.`,
        );
        return sendResponse({ res, statusCode: httpStatus.BAD_REQUEST, message: 'Invalid payment signature' });
    }

    console.log(
        `[PAYMENT_VERIFY] Signature verification SUCCESS for Razorpay Order: ${razorpay_order_id}`,
    );

    try {
        const order = await finalizeOrderAfterPayment({
            userId: req.user.id,
            razorpayOrderId: razorpay_order_id,
            razorpayPaymentId: razorpay_payment_id,
            razorpaySignature: razorpay_signature,
        });

        console.log(
            `[PAYMENT_VERIFY] SUCCESS: Order #${order.orderNumber} (ID: ${order._id}) finalized and marked PAID`,
        );

        return sendResponse({
            res,
            statusCode: httpStatus.CREATED,
            message: 'Order finalized successfully',
            data: await buildOrderDetail(order),
        });
    } catch (err) {
        console.error(`[PAYMENT_VERIFY] ERROR: finalizeOrderAfterPayment failed: ${err.message}`);

        try {
            const partialOrder = await PrintOrder.findOne({ razorpayOrderId: razorpay_order_id });
            if (partialOrder) {
                // CATCH SAFETY: NEVER overwrite an order that is already successful (PAID, RECEIVED, PROCESSED, etc.)
                if (
                    partialOrder.paymentStatus === 'PAID' ||
                    ['RECEIVED', 'PROCESSED', 'DISPATCHED', 'DELIVERED'].includes(partialOrder.orderStatus)
                ) {
                    console.log(
                        `[CATCH_SAFETY] 🛡️ Order #${partialOrder.orderNumber} already exists with status: ${partialOrder.orderStatus} / ${partialOrder.paymentStatus}.`,
                    );
                    console.log(
                        `[CATCH_SAFETY] ⛔ ABORTING failure overwrite! Existing successful order will NOT be marked FAILED.`,
                    );
                    return sendResponse({
                        res,
                        statusCode: httpStatus.OK,
                        message: 'Order already finalized successfully',
                        data: await buildOrderDetail(partialOrder),
                    });
                }

                if (!['CANCELLED', 'FAILED'].includes(partialOrder.orderStatus)) {
                    console.log(
                        `[CATCH_SAFETY] ⚠️ Verified Order #${partialOrder.orderNumber} is in unfulfilled state (${partialOrder.orderStatus}). Proceeding with safe failure handling.`,
                    );
                    partialOrder.orderStatus = 'FAILED';
                    partialOrder.paymentStatus = 'FAILED';
                    partialOrder.statusHistory.push({
                        status: 'FAILED',
                        changedBy: null,
                        note: 'Payment or verification failed. Refund will be initiated shortly.',
                        changedAt: new Date(),
                    });

                    if (razorpay_payment_id && partialOrder.priceSummary?.grandTotal > 0) {
                        try {
                            console.log(
                                `[AUTO_REFUND] 💸 Initiating automatic refund via Razorpay (Payment ID: ${razorpay_payment_id}, Amount: ₹${partialOrder.priceSummary.grandTotal})...`,
                            );
                            const rzpRefund = await rzpService.refundPayment(
                                razorpay_payment_id,
                                partialOrder.priceSummary.grandTotal,
                                { reason: 'Automatic refund due to order fulfillment failure' },
                            );
                            partialOrder.refund = {
                                status: 'PROCESSING',
                                amount: partialOrder.priceSummary.grandTotal,
                                razorpayRefundId: rzpRefund.id || '',
                                initiatedAt: new Date(),
                            };
                            console.log(
                                `[AUTO_REFUND] ✅ Refund SUCCESS: Refund ID ${rzpRefund.id} initiated for Order #${partialOrder.orderNumber}`,
                            );
                        } catch (rfErr) {
                            partialOrder.refund = {
                                status: 'PROCESSING',
                                amount: partialOrder.priceSummary.grandTotal,
                                failureReason: rfErr.message || 'Refund initiation pending',
                                initiatedAt: new Date(),
                            };
                            console.error(
                                `[AUTO_REFUND] ❌ Auto-refund noted for Order #${partialOrder.orderNumber}: ${rfErr.message}`,
                            );
                        }
                    }

                    await partialOrder.save();
                    console.log(`[ORDER_STATUS] Order #${partialOrder.orderNumber} dynamically updated to FAILED`);
                    notifyUserOrderFailed(partialOrder);
                }
            }
        } catch (healErr) {
            console.error(`[PAYMENT_VERIFY] Error updating order to FAILED: ${healErr.message}`);
        }

        const statusCode = err.message?.includes('not captured') || err.message?.includes('mismatch')
            ? httpStatus.BAD_REQUEST
            : httpStatus.INTERNAL_SERVER_ERROR;

        return sendResponse({
            res,
            statusCode,
            message: err.message || 'Verification failed',
        });
    }
};

/**
 * Orders that a user is still allowed to cancel.
 * RECEIVED (1) — not yet acted on by the shop
 * PROCESSED (2) — shop has accepted but not yet dispatched
 */
const USER_CANCELLABLE_STATUSES = ['RECEIVED', 'PROCESSED'];

/**
 * Cancel an Order (User)
 * @route PATCH /api/orders/:orderId/cancel
 * @access Private (User)
 */
export const cancelOrder = async (req, res) => {
    const { error, value } = getOrderByIdParamsSchema.validate(req.params);

    if (error) {
        return sendResponse({ res, statusCode: httpStatus.BAD_REQUEST, message: error.details[0].message });
    }

    // Ownership filter — users can only cancel their own orders
    const order = await PrintOrder.findOne({ _id: value.orderId, user: req.user.id });

    if (!order) {
        return sendResponse({ res, statusCode: httpStatus.NOT_FOUND, message: 'Order not found.' });
    }

    // Guard: only allow cancellation from permitted statuses
    if (!USER_CANCELLABLE_STATUSES.includes(order.orderStatus)) {
        const STATUS_MESSAGES = {
            DISPATCHED: 'Order cannot be cancelled, it has already been dispatched.',
            DELIVERED: 'Order cannot be cancelled, it has already been delivered.',
            CANCELLED: 'This order has already been cancelled.',
        };
        const message = STATUS_MESSAGES[order.orderStatus] || 'Order cannot be cancelled at this stage.';
        return sendResponse({ res, statusCode: httpStatus.BAD_REQUEST, message });
    }

    // Update status and push history entry
    order.orderStatus = 'CANCELLED';
    order.statusHistory.push({
        status: 'CANCELLED',
        changedBy: null, // null = customer-triggered (not admin)
        note: 'Cancelled by customer',
        changedAt: new Date(),
    });

    // ─── Razorpay Refund Initiation ─────────────────────────────────────────
    // Only attempt a refund if the order was actually paid online.
    const isRefundEligible = order.paymentStatus === 'PAID' && Boolean(order.razorpayPaymentId);

    if (isRefundEligible) {
        const initTime = new Date();
        order.refund = {
            status: 'PROCESSING',
            amount: order.priceSummary?.grandTotal || 0,
            initiatedAt: initTime,
            razorpayRefundId: '',
            processedAt: initTime,
            failureReason: '',
        };

        try {
            const rzpRefund = await rzpService.createRzpRefund(
                order.razorpayPaymentId,
                order.priceSummary?.grandTotal || 0,
                `refund_${order.orderNumber}`,
            );

            // Persist Razorpay's refund ID so we can poll it later
            order.refund.razorpayRefundId = rzpRefund.id || '';
            console.info(
                `[Refund Initiated] Order #${order.orderNumber} → refund ${rzpRefund.id} status: ${rzpRefund.status}`,
            );
        } catch (refundErr) {
            // Never block cancellation because of a refund failure
            order.refund.status = 'FAILED';
            order.refund.failureReason =
                refundErr?.error?.description || refundErr.message || 'Razorpay refund API error';
            console.error(`[Refund Failed] Order #${order.orderNumber}:`, refundErr.message);
        }
    } else {
        const cancelTime = new Date();
        order.refund = {
            status: 'NOT_APPLICABLE',
            amount: order.priceSummary?.grandTotal || 0,
            razorpayRefundId: '',
            initiatedAt: cancelTime,
            processedAt: cancelTime,
            failureReason: '',
        };
    }
    // ────────────────────────────────────────────────────────────────────────

    await order.save();

    // Fire-and-forget: notify the user their cancellation was successful
    const notificationTitle = 'Order Cancelled';
    const notificationBody = `Your order #${order.orderNumber} has been successfully cancelled.`;
    const notificationData = {
        orderNumber: String(order.orderNumber),
        orderStatus: ORDER_STATUS_MAP['CANCELLED'], // 5
        // orderStatus: String(ORDER_STATUS_MAP['CANCELLED']), // "5"
    };

    Notification.create({
        title: notificationTitle,
        body: notificationBody,
        type: 'IN_APP',
        category: 'ORDER_NOTIFICATION',
        recipient: req.user.id,
        order: order._id,
        imageUrl: NOTIFICATION_ICON_URL,
        data: notificationData,
        sentBy: null,
    }).catch(() => {}); // silent fail — never block the response

    User.findById(req.user.id)
        .select('fcmToken')
        .lean()
        .then((user) => {
            if (user?.fcmToken) {
                sendPushNotification(user.fcmToken, notificationTitle, notificationBody, {
                    ...notificationData,
                    type: 'ORDER_NOTIFICATION',
                    orderId: order._id.toString(),
                });
            }
            console.log(
                chalk.bold.magenta(
                    `[Notification] Order cancellation notification successfully sent to user ${req.user.id} for order #${order.orderNumber}.`,
                ),
            );
        })
        .catch((error) => console.error('Failed to dispatch push notification: ', error));

    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        message: 'Order cancelled successfully.',
        data: {
            _id: order._id,
            orderNumber: order.orderNumber,
            orderStatus: ORDER_STATUS_MAP['CANCELLED'], // 5
            refund: {
                status: order.refund?.status || 'NOT_APPLICABLE',
                amount: order.refund?.amount || 0,
                razorpayRefundId: order.refund?.razorpayRefundId || '',
                initiatedAt: order.refund?.initiatedAt || null,
                processedAt: order.refund?.processedAt || order.refund?.initiatedAt || null,
            },
        },
    });
};

/**
 * Poll Razorpay for the latest refund status of a cancelled order.
 * Updates local DB state when Razorpay reports a terminal status (processed / failed).
 * @route GET /api/orders/:orderId/refund-status
 * @access Private (User)
 */
export const getRefundStatus = async (req, res) => {
    const { error, value } = getOrderByIdParamsSchema.validate(req.params);

    if (error) {
        return sendResponse({ res, statusCode: httpStatus.BAD_REQUEST, message: error.details[0].message });
    }

    const order = await PrintOrder.findOne({ _id: value.orderId, user: req.user.id }).select(
        '_id orderNumber refund paymentStatus',
    );

    if (!order) {
        return sendResponse({ res, statusCode: httpStatus.NOT_FOUND, message: 'Order not found.' });
    }

    const refund = order.refund || {};

    // If there is nothing to poll, return the stored state immediately
    if (refund.status === 'NOT_APPLICABLE' || refund.status === 'PROCESSED' || !refund.razorpayRefundId) {
        return sendResponse({
            res,
            statusCode: httpStatus.OK,
            message: 'Refund status fetched successfully.',
            data: {
                refundStatus: refund.status || 'NOT_APPLICABLE',
                razorpayRefundId: refund.razorpayRefundId || '',
                amount: refund.amount || 0,
                initiatedAt: refund.initiatedAt || null,
                processedAt: refund.processedAt || null,
                failureReason: refund.failureReason || '',
            },
        });
    }

    // For PROCESSING or FAILED refunds that have a refundId, hit Razorpay live
    try {
        const rzpRefund = await rzpService.getRzpRefundStatus(refund.razorpayRefundId);

        if (rzpRefund.status === 'processed') {
            order.refund.status = 'PROCESSED';
            order.refund.processedAt = new Date();
            order.paymentStatus = 'REFUNDED';
            await order.save();
        } else if (rzpRefund.status === 'failed') {
            order.refund.status = 'FAILED';
            order.refund.failureReason = 'Razorpay marked refund as failed';
            await order.save();
        }
        // 'pending' → no DB change, just return current state

        return sendResponse({
            res,
            statusCode: httpStatus.OK,
            message: 'Refund status fetched successfully.',
            data: {
                refundStatus: order.refund.status,
                razorpayRefundId: order.refund.razorpayRefundId,
                amount: order.refund.amount,
                initiatedAt: order.refund.initiatedAt,
                processedAt: order.refund.processedAt || null,
                failureReason: order.refund.failureReason || '',
            },
        });
    } catch (err) {
        console.error(`[getRefundStatus] Razorpay fetch failed for ${refund.razorpayRefundId}:`, err.message);
        // Return what we have in DB — do not 500 the user
        return sendResponse({
            res,
            statusCode: httpStatus.OK,
            message: 'Refund status fetched from cache (Razorpay unreachable).',
            data: {
                refundStatus: refund.status,
                razorpayRefundId: refund.razorpayRefundId,
                amount: refund.amount,
                initiatedAt: refund.initiatedAt,
                processedAt: refund.processedAt || null,
                failureReason: refund.failureReason || '',
            },
        });
    }
};

export const listOrders = async (req, res) => {
    const { error, value } = listOrdersQuerySchema.validate(req.query);

    if (error) {
        return sendResponse({ res, statusCode: httpStatus.BAD_REQUEST, message: error.details[0].message });
    }

    const page = Number(value.page);
    const limit = Number(value.limit);

    const filter = { user: req.user.id };
    if (value.orderStatus) {
        filter.orderStatus = ORDER_STATUS_REVERSE_MAP[value.orderStatus];
    }

    const sort = value.orderStatus ? { updatedAt: -1 } : { createdAt: -1 };
    const { records, count } = await calculatePagination(
        PrintOrder,
        filter,
        {
            page,
            limit,
            sort,
            populate: {
                path: 'assignedPartner',
                select: 'firstName lastName fullName email phone profilePicture',
            },
        },
        '-__v',
    );

    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        message: 'Orders fetched successfully',
        data: await Promise.all(records.map(buildOrderListItem)),
        count,
    });
};

export const getOrderById = async (req, res) => {
    const { error, value } = getOrderByIdParamsSchema.validate(req.params);

    if (error) {
        return sendResponse({ res, statusCode: httpStatus.BAD_REQUEST, message: error.details[0].message });
    }

    const order = await PrintOrder.findOne({ _id: value.orderId, user: req.user.id })
        .select(
            '_id orderNumber cart items stationeryItems deliveryAddress priceSummary appliedCoupon orderStatus statusHistory assignedPartner assignedAt createdAt updatedAt',
        )
        .populate('assignedPartner', 'firstName lastName fullName email phone profilePicture')
        .lean();

    if (!order) {
        return sendResponse({ res, statusCode: httpStatus.NOT_FOUND, message: 'Order not found' });
    }

    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        message: 'Order fetched successfully',
        data: await buildOrderDetail(order),
    });
};

export const trackOrder = async (req, res) => {
    const { error, value } = getOrderByIdParamsSchema.validate(req.params);

    if (error) {
        return sendResponse({ res, statusCode: httpStatus.BAD_REQUEST, message: error.details[0].message });
    }

    const order = await PrintOrder.findOne({ _id: value.orderId, user: req.user.id })
        .select(
            '_id orderNumber cart deliveryAddress priceSummary orderStatus statusHistory assignedPartner assignedAt currentLocation createdAt',
        )
        .populate('assignedPartner', 'firstName lastName fullName email phone profilePicture currentLocation')
        .lean();

    if (!order) {
        return sendResponse({ res, statusCode: httpStatus.NOT_FOUND, message: 'Order not found' });
    }

    const statusHistory = order.statusHistory || [];
    const latest =
        statusHistory.length > 0
            ? statusHistory[statusHistory.length - 1]
            : { status: order.orderStatus || 'RECEIVED', note: 'Order placed', changedAt: order.createdAt };

    // Extract timestamps for each status
    const getStatusTimestamp = (status) => statusHistory.find((entry) => entry.status === status)?.changedAt || null;

    const deliveryAssignment = formatDeliveryAssignment(order);

    const hasOrderLocation =
        order.currentLocation &&
        order.currentLocation.latitude !== null &&
        order.currentLocation.latitude !== undefined &&
        order.currentLocation.longitude !== null &&
        order.currentLocation.longitude !== undefined;

    const riderLat = hasOrderLocation
        ? order.currentLocation.latitude
        : order.assignedPartner?.currentLocation?.latitude;
    const riderLng = hasOrderLocation
        ? order.currentLocation.longitude
        : order.assignedPartner?.currentLocation?.longitude;
    const destLat = order.deliveryAddress?.latitude ?? order.deliveryAddress?.coordinates?.lat;
    const destLng = order.deliveryAddress?.longitude ?? order.deliveryAddress?.coordinates?.lng;

    const tracking = {
        currentLocation: {
            latitude: (riderLat && riderLat !== 0) ? riderLat : MOCK_TRACKING_COORDINATES.currentLocation.latitude,
            longitude: (riderLng && riderLng !== 0) ? riderLng : MOCK_TRACKING_COORDINATES.currentLocation.longitude,
            updatedAt: (hasOrderLocation && order.currentLocation?.updatedAt)
                ? order.currentLocation.updatedAt
                : (order.assignedPartner?.currentLocation?.updatedAt ?? latest.changedAt ?? null),
        },
        destination: {
            latitude: (destLat && destLat !== 0) ? destLat : MOCK_TRACKING_COORDINATES.destination.latitude,
            longitude: (destLng && destLng !== 0) ? destLng : MOCK_TRACKING_COORDINATES.destination.longitude,
        },
    };

    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        message: 'Order tracking details fetched successfully',
        data: {
            _id: order._id,
            orderNumber: order.orderNumber,
            cart: order.cart,
            deliveryAddress: order.deliveryAddress,
            grandTotal: order.priceSummary?.grandTotal || 0,
            statusType: ORDER_STATUS_MAP[latest.status] || latest.status,
            receivedAt: getStatusTimestamp('RECEIVED'),
            processedAt: getStatusTimestamp('PROCESSED'),
            dispatchedAt: getStatusTimestamp('DISPATCHED'),
            deliveredAt: getStatusTimestamp('DELIVERED'),
            cancelledAt: getStatusTimestamp('CANCELLED'),
            failedAt: getStatusTimestamp('FAILED'),
            deliveryAssignment,
            tracking,
            note: latest.note || '',
            changedAt: latest.changedAt,
            createdAt: order.createdAt,
        },
    });
};

// ─── Admin Order Controllers ────────────────────────────────────────────────

/**
 * Allowed order status transitions.
 * PENDING → PROCESSED → DISPATCHED → DELIVERED
 * PENDING → CANCELLED
 * PROCESSED → CANCELLED
 * DISPATCHED → FAILED → REATTEMPT
 */
const ALLOWED_TRANSITIONS = {
    RECEIVED: ['PROCESSED', 'CANCELLED'],
    PROCESSED: ['DISPATCHED', 'CANCELLED'],
    DISPATCHED: ['DELIVERED', 'FAILED'],
    FAILED: ['REATTEMPT'],
    REATTEMPT: ['DISPATCHED'],
    DELIVERED: [],
    CANCELLED: [],
};

const buildAdminOrderListItem = (order = {}) => {
    const items = Array.isArray(order.items) ? order.items : [];

    // Use persistent fullName if available, otherwise fallback to reconstructed name or phone
    const u = order.user || {};
    let resolvedName = u.fullName || 'User';

    if (!u.fullName) {
        if (u.firstName || u.lastName) {
            resolvedName = `${u.firstName || ''} ${u.lastName || ''}`.trim() || 'User';
        } else if (u.phone) {
            resolvedName = u.phone;
        }
    }

    return {
        _id: order._id,
        orderNumber: order.orderNumber,
        fullName: resolvedName,
        userPhone: u.phone || '',
        orderStatus: ORDER_STATUS_MAP[order.orderStatus] || order.orderStatus,
        paymentStatus: order.paymentStatus,
        paymentMethod: order.paymentMethod || '',
        deliveryMode: order.deliveryMode,
        deliveryAssignment: formatDeliveryAssignment(order),
        deliveryAddress: order.deliveryAddress || {},
        itemCount: items.length + (order.stationeryItems?.length || 0),
        totalPrice: order.priceSummary?.grandTotal || 0,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
    };
};

export const adminListOrders = async (req, res) => {
    const { error, value } = adminListOrdersQuerySchema.validate(req.query);

    if (error) {
        return sendResponse({ res, statusCode: httpStatus.BAD_REQUEST, message: error.details[0].message });
    }

    const filter = {};

    if (value.status) {
        filter.orderStatus = ORDER_STATUS_REVERSE_MAP[value.status] || value.status;
    }
    if (value.paymentStatus) filter.paymentStatus = value.paymentStatus;

    if (value.search?.trim()) {
        const searchInput = value.search.trim();
        const searchRegex = new RegExp(searchInput, 'i'); // case insensitive

        // Look-ahead: Find non-deleted users matching the search term (Full Name, First Name, Last Name, Phone)
        // isDeleted: false ensures we never resolve orders from soft-deleted accounts via search
        const matchingUsers = await User.find({
            isDeleted: false,
            $or: [
                { fullName: { $regex: searchRegex } }, // Full Name
                { firstName: { $regex: searchRegex } }, // First Name
                { lastName: { $regex: searchRegex } }, // Last Name
                { phone: { $regex: searchRegex } }, // Phone
            ],
        })
            .select('_id')
            .lean();

        const userIds = matchingUsers.map((u) => u._id);

        filter.$or = [
            { orderNumber: { $regex: searchRegex } },
            ...(userIds.length > 0 ? [{ user: { $in: userIds } }] : []),
        ];
    }

    const page = Number(value.page);
    const limit = Number(value.limit);
    const skip = (page - 1) * limit;
    const direction = value.sortOrder === 'asc' ? 1 : -1;
    const sort = { [value.sortBy]: direction, _id: -1 };

    // Exclude orders belonging to soft-deleted users.
    // After the 15-min cron runs, these users (and their orders) will be hard-deleted.
    // This filter guards the window between soft-delete and permanent deletion.
    const deletedUserDocs = await User.find({ isDeleted: true }).select('_id').lean();
    if (deletedUserDocs.length > 0) {
        const deletedUserIds = deletedUserDocs.map((u) => u._id);
        filter.user = { $nin: deletedUserIds };
    }

    const [result, count] = await Promise.all([
        PrintOrder.aggregate([
            {
                $facet: {
                    orders: [
                        { $match: filter },
                        { $sort: sort },
                        { $skip: skip },
                        { $limit: limit },
                        {
                            $lookup: {
                                from: 'users',
                                localField: 'user',
                                foreignField: '_id',
                                as: 'user',
                                pipeline: [{ $project: { firstName: 1, lastName: 1, fullName: 1, phone: 1 } }],
                            },
                        },
                        { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
                        {
                            $lookup: {
                                from: 'partners',
                                localField: 'assignedPartner',
                                foreignField: '_id',
                                as: 'assignedPartner',
                                pipeline: [{ $project: { firstName: 1, lastName: 1, fullName: 1, email: 1, phone: 1, profilePicture: 1 } }],
                            },
                        },
                        { $unwind: { path: '$assignedPartner', preserveNullAndEmptyArrays: true } },
                        { $project: { __v: 0 } },
                    ],
                    counts: [{ $group: { _id: '$orderStatus', count: { $sum: 1 } } }],
                },
            },
        ]),
        PrintOrder.countDocuments(filter),
    ]);

    const ordersRaw = result?.[0]?.orders || [];
    const countsRaw = result?.[0]?.counts || [];

    const counts = { received: 0, processed: 0, dispatched: 0, delivered: 0, cancelled: 0, total: 0 };
    for (const item of countsRaw) {
        const key = String(item._id || '').toLowerCase();
        if (key in counts) {
            counts[key] = item.count;
            counts.total += item.count;
        }
    }

    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        message: 'Orders fetched successfully',
        data: { orders: ordersRaw.map(buildAdminOrderListItem), orderCounts: counts, count },
    });
};

export const adminGetOrderById = async (req, res) => {
    const { error, value } = adminOrderParamsSchema.validate(req.params);

    if (error) {
        return sendResponse({ res, statusCode: httpStatus.BAD_REQUEST, message: error.details[0].message });
    }

    const order = await PrintOrder.findById(value.orderId)
        .populate('user', 'firstName lastName phone email isDeleted')
        .populate('assignedPartner', 'firstName lastName fullName email phone profilePicture')
        .select('-__v')
        .lean();

    if (!order) {
        return sendResponse({ res, statusCode: httpStatus.NOT_FOUND, message: 'Order not found' });
    }

    // Guard: hide orders that belong to a soft-deleted user
    if (order.user?.isDeleted) {
        return sendResponse({ res, statusCode: httpStatus.NOT_FOUND, message: 'Order not found' });
    }

    // Build proper user object
    const u = order.user || {};
    let resolvedName = 'User';
    if (u.firstName || u.lastName) {
        resolvedName = `${u.firstName || ''} ${u.lastName || ''}`.trim() || 'User';
    } else if (u.phone) {
        resolvedName = u.phone;
    }

    const userObj = {
        _id: u._id || '',
        fullName: resolvedName,
        phone: u.phone || '',
        email: u.email || '',
    };

    // Build items
    const formattedItems = await Promise.all(
        (order.items || []).map(async (item) => {
            const isStationery = item.serviceSnapshot?.serviceType === 'STATIONERY';
            const baseItem = {
                itemType: isStationery ? 'STATIONERY' : 'PRINT_SERVICE',
                name: item.serviceSnapshot?.name || 'Unknown Item',
                quantity: item.customization?.copies || 1,
                amount: (item.priceSummary?.baseAmount || 0) + (item.priceSummary?.addOnAmount || 0),
            };

            if (!isStationery) {
                // Document handling
                if (item.document?.originalFileName) {
                    baseItem.fileName = item.document.originalFileName;
                    baseItem.fileUrl = item.document.fileUrl
                        ? await resolvePresignedGetUrl(item.document.fileUrl)
                        : '';
                }

                const c = item.customization || {};
                const customizationDetails = [];

                // 1. Standard Fields
                if (c.paperSize)
                    customizationDetails.push({
                        code: c.paperSize,
                        label: CUSTOMIZATION_LABELS[c.paperSize] || `Paper Size: ${c.paperSize}`,
                    });
                if (c.colorMode)
                    customizationDetails.push({
                        code: c.colorMode,
                        label: CUSTOMIZATION_LABELS[c.colorMode] || `Color Mode: ${c.colorMode}`,
                    });
                if (c.sideMode)
                    customizationDetails.push({
                        code: c.sideMode,
                        label: CUSTOMIZATION_LABELS[c.sideMode] || `Side Mode: ${c.sideMode}`,
                    });
                if (c.paperQuality)
                    customizationDetails.push({
                        code: c.paperQuality,
                        label: CUSTOMIZATION_LABELS[c.paperQuality] || `Paper Quality: ${c.paperQuality}`,
                    });

                // 2. Binding Toggles
                if (c.stickBindingEnabled)
                    customizationDetails.push({ code: 'STICK_BINDING', label: CUSTOMIZATION_LABELS.STICK_BINDING });
                if (c.spiralBindingEnabled)
                    customizationDetails.push({ code: 'SPIRAL_BINDING', label: CUSTOMIZATION_LABELS.SPIRAL_BINDING });
                if (c.staplingEnabled)
                    customizationDetails.push({ code: 'STAPLING', label: CUSTOMIZATION_LABELS.STAPLING });

                // 3. Selected Binding (if any)
                if (c.selectedBinding?.code) {
                    customizationDetails.push({
                        code: c.selectedBinding.code,
                        label:
                            CUSTOMIZATION_LABELS[c.selectedBinding.code] ||
                            `Binding: ${c.selectedBinding.label || c.selectedBinding.code}`,
                    });
                }

                // 4. Booklet Options
                if (Array.isArray(c.bookletOptionCodes)) {
                    c.bookletOptionCodes.forEach((code) => {
                        customizationDetails.push({ code, label: CUSTOMIZATION_LABELS[code] || `Booklet: ${code}` });
                    });
                }

                baseItem.customizationDetails = customizationDetails;

                if (customizationDetails.length > 0) {
                    baseItem.optionsSummary = customizationDetails.map((d) => d.code).join(', ');
                }
            }

            return baseItem;
        }),
    );

    const formattedStationeryItems = await Promise.all(
        (order.stationeryItems || []).map(async (item) => ({
            itemType: 'STATIONERY',
            name: item.itemSnapshot?.name || 'Unknown Item',
            brand: item.itemSnapshot?.brand || 'General',
            quantity: item.quantity || 1,
            amount: item.priceSummary?.taxableAmount || 0,
            thumbnailUrl: item.itemSnapshot?.thumbnailUrl
                ? await resolvePresignedGetUrl(item.itemSnapshot.thumbnailUrl)
                : '',
        })),
    );

    const allFormattedItems = [...formattedItems, ...formattedStationeryItems];

    const finalData = {
        _id: order._id,
        orderNumber: order.orderNumber,
        createdAt: order.createdAt,
        orderStatus: ORDER_STATUS_MAP[order.orderStatus] || order.orderStatus,
        paymentStatus: order.paymentStatus,
        paymentMethod: order.paymentMethod || '',
        deliveryMode: order.deliveryMode,
        deliveryAssignment: formatDeliveryAssignment(order),
        user: userObj,
        deliveryAddress: order.deliveryAddress,
        priceSummary: {
            itemTotal: (order.priceSummary?.itemTotal || 0) + (order.priceSummary?.addOnTotal || 0),
            taxAmount: order.priceSummary?.taxAmount || 0,
            deliveryFee: order.priceSummary?.deliveryFee || 0,
            platformFee: order.priceSummary?.platformFee || 0,
            discountAmount: order.priceSummary?.discountAmount || 0,
            grandTotal: order.priceSummary?.grandTotal || 0,
        },
        statusHistory: order.statusHistory,
        items: allFormattedItems,
    };

    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        message: 'Order fetched successfully',
        data: finalData,
    });
};

export const adminUpdateOrderStatus = async (req, res) => {
    const { error: paramError, value: paramValue } = adminOrderParamsSchema.validate(req.params);

    if (paramError) {
        return sendResponse({ res, statusCode: httpStatus.BAD_REQUEST, message: paramError.details[0].message });
    }

    const { error, value } = adminUpdateOrderStatusSchema.validate(req.body);

    if (error) {
        return sendResponse({ res, statusCode: httpStatus.BAD_REQUEST, message: error.details[0].message });
    }

    const order = await PrintOrder.findById(paramValue.orderId);

    if (!order) {
        return sendResponse({ res, statusCode: httpStatus.NOT_FOUND, message: 'Order not found' });
    }

    const currentStatus = order.orderStatus;
    const newStatus = ORDER_STATUS_REVERSE_MAP[value.orderStatus];

    // Validate transition
    const allowedNextStatuses = ALLOWED_TRANSITIONS[currentStatus] || [];

    if (!allowedNextStatuses.includes(newStatus)) {
        const STATUS_DISPLAY_LABELS = {
            RECEIVED: 'Received',
            PROCESSED: 'Processed',
            DISPATCHED: 'Dispatched',
            DELIVERED: 'Delivered',
            CANCELLED: 'Cancelled',
            FAILED: 'Failed',
            REATTEMPT: 'Reattempt',
        };
        const currentLabel = STATUS_DISPLAY_LABELS[currentStatus] || currentStatus;
        const newLabel = STATUS_DISPLAY_LABELS[newStatus] || newStatus;

        let message;
        // Check for forward jumps/skips
        const LINEAR_FLOW = ['RECEIVED', 'PROCESSED', 'DISPATCHED', 'DELIVERED'];
        const currentIndex = LINEAR_FLOW.indexOf(currentStatus);
        const newIndex = LINEAR_FLOW.indexOf(newStatus);

        if (currentIndex !== -1 && newIndex !== -1 && newIndex > currentIndex && allowedNextStatuses.length > 0) {
            // Admin is trying to jump ahead - suggest the next actual allowed step
            const nextStep = allowedNextStatuses.find((s) => s !== 'CANCELLED') || allowedNextStatuses[0];
            const nextLabel = STATUS_DISPLAY_LABELS[nextStep] || nextStep;
            message = `Please update the status to '${nextLabel}' first.`;
        } else {
            // Covers same status, terminal state (DELIVERED/CANCELLED), and backward transitions
            message = `This order has already been ${currentLabel}.`;
        }

        return sendResponse({ res, statusCode: httpStatus.BAD_REQUEST, message });
    }

    // Business Policy: Delivery orders cannot be dispatched without an assigned delivery partner
    if (newStatus === 'DISPATCHED' && (order.deliveryMode || 'DELIVERY') === 'DELIVERY' && !order.assignedPartner) {
        return sendResponse({
            res,
            statusCode: httpStatus.BAD_REQUEST,
            message: 'Please assign a delivery partner before dispatching this order.',
        });
    }

    // Update status and push history entry
    order.orderStatus = newStatus;
    order.statusHistory.push({
        status: newStatus,
        changedBy: req.user.id,
        note: `Status updated to ${newStatus}`,
        changedAt: new Date(),
    });

    if (newStatus === 'CANCELLED') {
        const isRefundEligible = order.paymentStatus === 'PAID' && Boolean(order.razorpayPaymentId);
        if (isRefundEligible) {
            const initTime = new Date();
            order.refund = {
                status: 'PROCESSING',
                amount: order.priceSummary?.grandTotal || 0,
                initiatedAt: initTime,
                razorpayRefundId: '',
                processedAt: initTime,
                failureReason: '',
            };

            try {
                const rzpRefund = await rzpService.createRzpRefund(
                    order.razorpayPaymentId,
                    order.priceSummary?.grandTotal || 0,
                    `refund_${order.orderNumber}`,
                );
                order.refund.razorpayRefundId = rzpRefund.id || '';
                console.info(
                    `[Refund Initiated] Order #${order.orderNumber} (Admin) → refund ${rzpRefund.id} status: ${rzpRefund.status}`,
                );
            } catch (refundErr) {
                order.refund.status = 'FAILED';
                order.refund.failureReason =
                    refundErr?.error?.description || refundErr.message || 'Razorpay refund API error';
                console.error(`[Refund Failed] Order #${order.orderNumber} (Admin):`, refundErr.message);
            }
        } else {
            const cancelTime = new Date();
            order.refund = {
                status: 'NOT_APPLICABLE',
                amount: order.priceSummary?.grandTotal || 0,
                razorpayRefundId: '',
                initiatedAt: cancelTime,
                processedAt: cancelTime,
                failureReason: '',
            };
        }
    }

    await order.save();

    // ── Fire-and-forget: notify the order owner about the status change ──────
    const STATUS_LABELS = {
        PROCESSED: 'Processed',
        DISPATCHED: 'Dispatched',
        DELIVERED: 'Delivered',
        CANCELLED: 'Cancelled',
        FAILED: 'Failed',
        REATTEMPT: 'Reattempt',
    };
    const statusLabel = STATUS_LABELS[newStatus] || newStatus;
    const notificationTitle = `Order ${statusLabel}`;
    const notificationBody = `Your order #${order.orderNumber} has been ${statusLabel.toLowerCase()}.`;
    const notificationData = {
        orderNumber: String(order.orderNumber),
        orderStatus: ORDER_STATUS_MAP[newStatus] || newStatus,
        // orderStatus: String(ORDER_STATUS_MAP[newStatus] || newStatus),
    };

    Notification.create({
        title: notificationTitle,
        body: notificationBody,
        type: 'IN_APP',
        category: 'ORDER_NOTIFICATION',
        recipient: order.user,
        order: order._id,
        imageUrl: NOTIFICATION_ICON_URL, // always fixed — not caller-supplied
        data: notificationData,
        sentBy: req.user.id,
    }).catch(() => {}); // silent fail — never block the HTTP response

    User.findById(order.user)
        .select('fcmToken')
        .lean()
        .then((user) => {
            if (user?.fcmToken) {
                sendPushNotification(user.fcmToken, notificationTitle, notificationBody, {
                    ...notificationData,
                    type: 'ORDER_NOTIFICATION',
                    orderId: order._id.toString(),
                });
            }
            console.log(
                chalk.bold.magenta(
                    `[Notification] Order status update (${statusLabel}) notification successfully sent to user ${order.user} for order #${order.orderNumber}.`,
                ),
            );
        })
        .catch((error) => console.error('Failed to dispatch push notification: ', error));
    // ─────────────────────────────────────────────────────────────────────────

    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        message: `Order status updated to '${newStatus}' successfully`,
        data: {
            _id: order._id,
            orderNumber: order.orderNumber,
            orderStatus: ORDER_STATUS_MAP[order.orderStatus] || order.orderStatus,
            statusHistory: order.statusHistory,
            updatedAt: order.updatedAt,
        },
    });
};

export const downloadInvoice = async (req, res) => {
    const { error, value } = getOrderByIdParamsSchema.validate(req.params);

    if (error) {
        return sendResponse({ res, statusCode: httpStatus.BAD_REQUEST, message: error.details[0].message });
    }

    const order = await PrintOrder.findOne({ _id: value.orderId, user: req.user.id })
        .populate('user', 'email')
        .lean();

    if (!order) {
        return sendResponse({ res, statusCode: httpStatus.NOT_FOUND, message: 'Order not found' });
    }

    try {
        const fs = await import('fs');
        const path = await import('path');

        const invoicesDir = path.resolve('public/invoices');
        if (!fs.existsSync(invoicesDir)) {
            fs.mkdirSync(invoicesDir, { recursive: true });
        }

        const filePath = path.join(invoicesDir, `invoice_${order.orderNumber}.pdf`);

        await generateClientInvoicePdf(order, filePath, {
            customerEmail: order.user?.email || '-',
        });

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="invoice_${order.orderNumber}.pdf"`);

        const readStream = fs.createReadStream(filePath);
        readStream.pipe(res);
    } catch (err) {
        console.error('Error generating/downloading invoice:', err);
        return sendResponse({
            res,
            statusCode: httpStatus.INTERNAL_SERVER_ERROR,
            message: `Error generating invoice: ${err.message}`,
        });
    }
};

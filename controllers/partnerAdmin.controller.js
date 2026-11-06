// controllers/partnerAdmin.controller.js
import Partner from '#models/partner';
import PrintOrder from '#models/printOrder';
import PartnerNotification from '#models/partnerNotification';
import firebaseAdmin from '#configs/firebase';
import httpStatus from 'http-status';
import { sendResponse } from '#utils/generalHelper';
import { NOTIFICATION_ICON_URL } from '#constants/notification';
import {
    adminListPartnersQuerySchema,
    adminPartnerParamsSchema,
    adminUpdatePartnerStatusSchema,
    adminOrderParamsSchema,
    adminAssignOrderPartnerSchema,
} from '#validations/partnerAdmin';

function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const INVALID_FCM_TOKEN_CODES = new Set([
    'messaging/registration-token-not-registered',
    'messaging/invalid-registration-token',
]);

/**
 * Send push notification to a partner device via Firebase Admin SDK
 */
export const sendPartnerNotificationToPartner = async ({
    partnerId,
    title,
    body,
    category = 'ORDER_NOTIFICATION',
    data = {},
    order = null,
    sentBy = null,
}) => {
    // Save in-app notification for the partner (non-blocking)
    PartnerNotification.create({
        partner: partnerId,
        title,
        body,
        category,
        order,
        data,
        sentBy,
        imageUrl: NOTIFICATION_ICON_URL,
    }).catch((err) => console.error('Failed to save in-app partner notification:', err.message));

    try {
        const partnerFilter = { _id: partnerId, isDeleted: false };
        const partner = await Partner.findOne(partnerFilter).select('+fid +fcmToken +fidStatus');

        const fcmToken = partner?.fcmToken || partner?.fid;
        if (!partner || !fcmToken) {
            console.log(`[Partner Push Skipped] Partner ${partnerId} does not have an FCM registration token.`);
            return null;
        }

        if (partner.fidStatus === 'invalid') {
            console.log(`[Partner Push Skipped] Partner ${partnerId} FCM registration token is marked invalid.`);
            return null;
        }

        const pushData = {
            ...data,
            title,
            body,
        };

        const stringifiedData = {};
        Object.entries(pushData).forEach(([key, val]) => {
            stringifiedData[key] = typeof val === 'string' ? val : JSON.stringify(val);
        });

        const messageId = await firebaseAdmin.messaging().send({
            token: fcmToken,
            data: stringifiedData,
            notification: {
                title,
                body,
            },
        });

        console.log(`[Partner Push Delivered] Push notification delivered to partner ${partnerId}, messageId: ${messageId}`);
        return { messageId };
    } catch (error) {
        console.error(`[Partner Push Delivery Error] Failed for partner ${partnerId}:`, error.message);

        if (INVALID_FCM_TOKEN_CODES.has(error.code)) {
            await Partner.updateOne({ _id: partnerId }, { $set: { fidStatus: 'invalid', fidUpdatedAt: new Date() } }).catch(
                (err) => console.error('Failed to update fidStatus:', err.message),
            );
        }
        return null;
    }
};

/**
 * List Riders (Admin - Paginated & Filterable)
 * @route GET /api/admin/partners
 * @access Private (Admin)
 */
export const adminListPartners = async (req, res) => {
    const { error, value } = adminListPartnersQuerySchema.validate(req.query);
    if (error) {
        return sendResponse({
            res,
            statusCode: httpStatus.BAD_REQUEST,
            message: error.details[0].message,
        });
    }

    const { page, limit, search, accountStatus, isOnline, orderId } = value;
    const skip = (page - 1) * limit;

    // Base filter — only riders and non-deleted
    const filter = { role: 'rider', isDeleted: false };

    if (accountStatus && accountStatus !== 'ALL') {
        filter.accountStatus = accountStatus;
    }

    if (typeof isOnline === 'boolean') {
        filter.isOnline = isOnline;
    }

    if (search?.trim()) {
        const searchString = search.trim();
        const escapedSearch = escapeRegExp(searchString);
        const regex = { $regex: escapedSearch, $options: 'i' };

        const searchNoSpaces = searchString.replace(/\s+/g, '');
        const regexNoSpaces = { $regex: escapeRegExp(searchNoSpaces), $options: 'i' };

        filter.$or = [
            { fullName: regex },
            { email: regex },
            { phone: regexNoSpaces },
        ];
    }

    const [partners, count, totalRiders, pendingRiders, activeRiders, inactiveRiders, rejectedRiders, onlineRiders, offlineRiders, targetedOrder] =
        await Promise.all([
            Partner.find(filter)
                .select('-password -__v')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            Partner.countDocuments(filter),
            Partner.countDocuments({ role: 'rider', isDeleted: false }),
            Partner.countDocuments({ role: 'rider', accountStatus: 'PENDING', isDeleted: false }),
            Partner.countDocuments({ role: 'rider', accountStatus: 'ACTIVE', isDeleted: false }),
            Partner.countDocuments({ role: 'rider', accountStatus: 'INACTIVE', isDeleted: false }),
            Partner.countDocuments({ role: 'rider', accountStatus: 'REJECTED', isDeleted: false }),
            Partner.countDocuments({ role: 'rider', isOnline: true, isDeleted: false }),
            Partner.countDocuments({ role: 'rider', isOnline: false, isDeleted: false }),
            orderId ? PrintOrder.findById(orderId).select('assignedPartner').lean() : null,
        ]);

    const assignedPartnerId = targetedOrder?.assignedPartner?.toString() || null;

    const mappedPartners = partners.map((p) => ({
        ...p,
        orderAssigned: Boolean(assignedPartnerId && p._id?.toString() === assignedPartnerId),
    }));

    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        message: 'Riders fetched successfully.',
        data: {
            partners: mappedPartners,
            partnerCounts: {
                total: totalRiders,
                pending: pendingRiders,
                active: activeRiders,
                inactive: inactiveRiders,
                rejected: rejectedRiders,
                online: onlineRiders,
                offline: offlineRiders,
            },
            count,
        },
    });
};

/**
 * Get Rider Details (Admin)
 * @route GET /api/admin/partners/:partnerId
 * @access Private (Admin)
 */
export const adminGetPartnerById = async (req, res) => {
    const { error, value } = adminPartnerParamsSchema.validate(req.params);
    if (error) {
        return sendResponse({
            res,
            statusCode: httpStatus.BAD_REQUEST,
            message: error.details[0].message,
        });
    }

    const partner = await Partner.findOne({ _id: value.partnerId, role: 'rider', isDeleted: false })
        .select('-password -__v')
        .lean();

    if (!partner) {
        return sendResponse({
            res,
            statusCode: httpStatus.NOT_FOUND,
            message: 'Rider not found.',
        });
    }

    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        data: partner,
        message: 'Rider details fetched successfully.',
    });
};

/**
 * Update Rider Account Status (Admin Activation / Deactivation)
 * @route PATCH /api/admin/partners/:partnerId/status
 * @access Private (Admin)
 */
export const adminUpdatePartnerStatus = async (req, res) => {
    const { error: paramsError, value: params } = adminPartnerParamsSchema.validate(req.params);
    if (paramsError) {
        return sendResponse({
            res,
            statusCode: httpStatus.BAD_REQUEST,
            message: paramsError.details[0].message,
        });
    }

    const { error: bodyError, value: body } = adminUpdatePartnerStatusSchema.validate(req.body);
    if (bodyError) {
        return sendResponse({
            res,
            statusCode: httpStatus.BAD_REQUEST,
            message: bodyError.details[0].message,
        });
    }

    const partner = await Partner.findOne({ _id: params.partnerId, role: 'rider', isDeleted: false });
    if (!partner) {
        return sendResponse({
            res,
            statusCode: httpStatus.NOT_FOUND,
            message: 'Rider not found.',
        });
    }

    partner.accountStatus = body.accountStatus;
    if (body.accountStatus === 'ACTIVE') {
        partner.isActive = true;
    } else if (body.accountStatus === 'INACTIVE' || body.accountStatus === 'REJECTED') {
        partner.isActive = false;
    }

    await partner.save();

    const responseData = {
        _id: partner._id,
        fullName: partner.fullName,
        email: partner.email,
        role: partner.role,
        accountStatus: partner.accountStatus,
        isActive: partner.isActive,
        updatedAt: partner.updatedAt,
    };

    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        data: responseData,
        message: `Rider account status updated to ${body.accountStatus} successfully.`,
    });
};

/**
 * Assign Delivery Partner to Order (Admin)
 * @route PATCH /api/admin/orders/:orderId/assign-partner
 * @access Private (Admin)
 */
export const adminAssignOrderPartner = async (req, res) => {
    const { error: paramsError, value: params } = adminOrderParamsSchema.validate(req.params);
    if (paramsError) {
        return sendResponse({ res, statusCode: httpStatus.BAD_REQUEST, message: paramsError.details[0].message });
    }

    const { error: bodyError, value: body } = adminAssignOrderPartnerSchema.validate(req.body);
    if (bodyError) {
        return sendResponse({ res, statusCode: httpStatus.BAD_REQUEST, message: bodyError.details[0].message });
    }

    const [order, partner] = await Promise.all([
        PrintOrder.findById(params.orderId),
        Partner.findById(body.partnerId).select('_id firstName lastName email role accountStatus isActive isOnline isDeleted'),
    ]);

    if (!order) {
        return sendResponse({ res, statusCode: httpStatus.NOT_FOUND, message: 'Order not found' });
    }

    if (!partner || partner.isDeleted) {
        return sendResponse({ res, statusCode: httpStatus.NOT_FOUND, message: 'Partner not found' });
    }

    if (partner.role !== 'rider') {
        return sendResponse({
            res,
            statusCode: httpStatus.BAD_REQUEST,
            message: 'Only a delivery partner with the rider role can be assigned to an order.',
        });
    }

    if (partner.accountStatus !== 'ACTIVE' || !partner.isActive) {
        return sendResponse({
            res,
            statusCode: httpStatus.CONFLICT,
            message: 'Only an active delivery partner can be assigned to an order.',
        });
    }

    if (order.deliveryMode !== 'DELIVERY') {
        return sendResponse({
            res,
            statusCode: httpStatus.BAD_REQUEST,
            message: 'A delivery partner cannot be assigned to a pickup order.',
        });
    }

    if (['DELIVERED', 'CANCELLED'].includes(order.orderStatus)) {
        return sendResponse({
            res,
            statusCode: httpStatus.CONFLICT,
            message: `A delivery partner cannot be assigned to an order that is already ${order.orderStatus.toLowerCase()}.`,
        });
    }

    const previousPartnerId = order.assignedPartner?.toString();
    const selectedPartnerId = partner._id.toString();

    const formatPartnerSummary = (p) => {
        if (!p) return null;
        const name = p.fullName || `${p.firstName || ''} ${p.lastName || ''}`.trim();
        return {
            _id: p._id,
            id: p._id,
            firstName: p.firstName || '',
            lastName: p.lastName || '',
            fullName: name,
            name: name,
            email: p.email || '',
        };
    };

    const notificationData = {
        type: 'ORDER_ASSIGNED',
        orderId: order._id.toString(),
        orderNumber: String(order.orderNumber),
    };

    // Case 2: Same Rider selected again -> TOGGLE OFF / REMOVE ASSIGNMENT
    if (previousPartnerId === selectedPartnerId) {
        order.assignedPartner = null;
        order.assignedAt = null;
        await order.save();

        // Send ONLY ORDER_ASSIGNMENT_REMOVED notification to the unassigned rider
        sendPartnerNotificationToPartner({
            partnerId: partner._id,
            title: 'Order Assignment Removed',
            body: `Order #${order.orderNumber} is no longer assigned to you.`,
            category: 'ORDER_NOTIFICATION',
            data: { ...notificationData, type: 'ORDER_ASSIGNMENT_REMOVED' },
            order: order._id,
            sentBy: req.user.id,
        }).catch((error) => console.error('Failed to notify unassigned delivery partner:', error.message));

        return sendResponse({
            res,
            statusCode: httpStatus.OK,
            message: 'Delivery partner assignment removed successfully.',
            data: {
                orderId: order._id,
                orderNumber: order.orderNumber,
                assignedPartner: null,
                previousPartner: formatPartnerSummary(partner),
                assignedAt: null,
            },
        });
    }

    // Only online riders can be assigned to new or reassigned orders
    if (!partner.isOnline) {
        return sendResponse({
            res,
            statusCode: httpStatus.CONFLICT,
            message: 'This delivery partner is currently offline and cannot be assigned to an order.',
        });
    }

    // Case 1 & Case 3
    let previousPartnerDoc = null;
    if (previousPartnerId) {
        previousPartnerDoc = await Partner.findById(previousPartnerId)
            .select('_id firstName lastName email role accountStatus')
            .lean();
    }

    const isReassignment = Boolean(previousPartnerId);

    order.assignedPartner = partner._id;
    order.assignedAt = new Date();
    await order.save();

    // Notify newly assigned rider (Rider B / Rider A)
    sendPartnerNotificationToPartner({
        partnerId: partner._id,
        title: 'New Order Assigned',
        body: `Order #${order.orderNumber} has been assigned to you.`,
        category: 'ORDER_NOTIFICATION',
        data: notificationData,
        order: order._id,
        sentBy: req.user.id,
    }).catch((error) => console.error('Failed to notify assigned delivery partner:', error.message));

    // Case 3: Reassignment — notify previously assigned partner (Rider A) that assignment was removed
    if (isReassignment && previousPartnerId) {
        sendPartnerNotificationToPartner({
            partnerId: previousPartnerId,
            title: 'Order Assignment Removed',
            body: `Order #${order.orderNumber} is no longer assigned to you.`,
            category: 'ORDER_NOTIFICATION',
            data: { ...notificationData, type: 'ORDER_ASSIGNMENT_REMOVED' },
            order: order._id,
            sentBy: req.user.id,
        }).catch((error) => console.error('Failed to notify previously assigned delivery partner:', error.message));
    }

    const responseMessage = isReassignment
        ? 'Delivery partner reassigned successfully.'
        : 'Delivery partner assigned successfully.';

    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        message: responseMessage,
        data: {
            orderId: order._id,
            orderNumber: order.orderNumber,
            assignedPartner: formatPartnerSummary(partner),
            previousPartner: formatPartnerSummary(previousPartnerDoc),
            assignedAt: order.assignedAt,
        },
    });
};


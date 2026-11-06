// controllers/partnerOrder.controller.js
import mongoose from 'mongoose';
import PrintOrder from '#models/printOrder';
import Notification from '#models/notification';
import PartnerNotification from '#models/partnerNotification';
import User from '#models/user';
import { sendPushNotification } from '#utils/firebase';
import { NOTIFICATION_ICON_URL } from '#constants/notification';
import httpStatus from 'http-status';
import chalk from 'chalk';
import { sendResponse } from '#utils/generalHelper';
import {
    listRiderOrdersQuerySchema,
    riderDashboardQuerySchema,
    getRiderOrderByIdParamsSchema,
    updateRiderOrderStatusSchema,
} from '#validations/partnerOrder';

const formatCurrency = (val) => `₹${Number(val || 0).toFixed(2)}`;
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const STATUS_MAP = {
    2: 'PROCESSED',
    3: 'DISPATCHED',
    4: 'DELIVERED',
    6: 'FAILED',
    7: 'REATTEMPT',
    '2': 'PROCESSED',
    '3': 'DISPATCHED',
    '4': 'DELIVERED',
    '6': 'FAILED',
    '7': 'REATTEMPT',
    PROCESSED: 'PROCESSED',
    DISPATCHED: 'DISPATCHED',
    DELIVERED: 'DELIVERED',
    FAILED: 'FAILED',
    REATTEMPT: 'REATTEMPT',
};

const RIDER_ALLOWED_NEXT = {
    PROCESSED: ['DISPATCHED'],
    DISPATCHED: ['DELIVERED', 'FAILED'],
    FAILED: ['REATTEMPT'],
};

const ORDER_STATUS_NUM_MAP = {
    RECEIVED: 1,
    PROCESSED: 2,
    DISPATCHED: 3,
    DELIVERED: 4,
    CANCELLED: 5,
    FAILED: 6,
    REATTEMPT: 7,
};

const STATUS_DISPLAY_LABELS = {
    RECEIVED: 'Received',
    PROCESSED: 'Processed',
    DISPATCHED: 'Dispatched',
    DELIVERED: 'Delivered',
    CANCELLED: 'Cancelled',
    FAILED: 'Failed',
    REATTEMPT: 'Reattempt',
};

/**
 * Dispatch User order status notification (in-app record + FCM push)
 */
export const sendOrderStatusNotificationToUser = async (order, newStatus, sentByAdminId = null) => {
    const statusLabel = STATUS_DISPLAY_LABELS[newStatus] || newStatus;
    const notificationTitle = newStatus === 'FAILED' ? 'Delivery Attempt Failed' : `Order ${statusLabel}`;
    const notificationBody =
        newStatus === 'FAILED'
            ? `Delivery attempt for order #${order.orderNumber} was unsuccessful.`
            : `Your order #${order.orderNumber} has been ${statusLabel.toLowerCase()}.`;
    const notificationData = {
        orderNumber: String(order.orderNumber),
        orderStatus: ORDER_STATUS_NUM_MAP[newStatus] || newStatus,
    };

    Notification.create({
        title: notificationTitle,
        body: notificationBody,
        type: 'IN_APP',
        category: 'ORDER_NOTIFICATION',
        recipient: order.user,
        order: order._id,
        imageUrl: NOTIFICATION_ICON_URL,
        data: notificationData,
        sentBy: sentByAdminId,
    }).catch((err) => console.error('Failed to save in-app user notification:', err.message));

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
        .catch((error) => console.error('Failed to dispatch user push notification: ', error.message));
};

/**
 * Build Rider-specific order list item. Includes customer info & delivery address for the rider.
 */
const buildRiderOrderListItem = (order = {}) => {
    const printItems = Array.isArray(order.items) ? order.items : [];
    const stationeryItems = Array.isArray(order.stationeryItems) ? order.stationeryItems : [];
    const totalItems = printItems.length + stationeryItems.length;

    const user = order.user || {};
    const customer = {
        _id: user._id || null,
        firstName: user.firstName || '',
        lastName: user.lastName || '',
        fullName: user.fullName || `${user.firstName || ''} ${user.lastName || ''}`.trim(),
        phone: user.phone || order.deliveryAddress?.phone || '',
    };

    return {
        _id: order._id,
        orderNumber: order.orderNumber,
        orderStatus: order.orderStatus,
        paymentStatus: order.paymentStatus,
        paymentMethod: order.paymentMethod || '',
        deliveryMode: order.deliveryMode,
        assignedAt: order.assignedAt || null,
        customer,
        deliveryAddress: order.deliveryAddress || {},
        itemCount: totalItems,
        totalPrice: formatCurrency(order.priceSummary?.grandTotal || 0),
        grandTotal: order.priceSummary?.grandTotal || 0,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
    };
};

/**
 * Build Rider-specific detailed order view.
 */
const buildRiderOrderDetail = (order = {}) => {
    const user = order.user || {};
    const customer = {
        _id: user._id || null,
        firstName: user.firstName || '',
        lastName: user.lastName || '',
        fullName: user.fullName || `${user.firstName || ''} ${user.lastName || ''}`.trim(),
        phone: user.phone || order.deliveryAddress?.phone || '',
        email: user.email || '',
    };

    const statusHistory = order.statusHistory || [];
    const latest = statusHistory.length > 0
        ? statusHistory[statusHistory.length - 1]
        : { status: order.orderStatus || 'RECEIVED', note: '', changedAt: order.createdAt };

    const items = [
        ...(order.items || []).map((item) => ({
            itemType: 'PRINT',
            name: item.serviceSnapshot?.name || '',
            copies: item.customization?.copies || 1,
            paperSize: item.customization?.paperSize || '',
            colorMode: item.customization?.colorMode || '',
            sideMode: item.customization?.sideMode || '',
            originalFileName: item.document?.originalFileName || '',
            fileUrl: item.document?.fileUrl || '',
            totalAmount: formatCurrency((item.priceSummary?.baseAmount || 0) + (item.priceSummary?.addOnAmount || 0)),
        })),
        ...(order.stationeryItems || []).map((item) => ({
            itemType: 'STATIONERY',
            name: item.itemSnapshot?.name || 'Stationery Item',
            brand: item.itemSnapshot?.brand || 'General',
            quantity: item.quantity || 1,
            thumbnailUrl: item.itemSnapshot?.thumbnailUrl || '',
            totalAmount: formatCurrency(item.priceSummary?.taxableAmount || 0),
        })),
    ];

    return {
        _id: order._id,
        orderNumber: order.orderNumber,
        orderStatus: order.orderStatus,
        paymentStatus: order.paymentStatus,
        paymentMethod: order.paymentMethod || '',
        deliveryMode: order.deliveryMode,
        assignedAt: order.assignedAt || null,
        customer,
        deliveryAddress: order.deliveryAddress || {},
        items,
        priceSummary: {
            itemTotal: formatCurrency(order.priceSummary?.itemTotal || 0),
            addOnTotal: formatCurrency(order.priceSummary?.addOnTotal || 0),
            taxAmount: formatCurrency(order.priceSummary?.taxAmount || 0),
            deliveryFee: formatCurrency(order.priceSummary?.deliveryFee || 0),
            platformFee: formatCurrency(order.priceSummary?.platformFee || 0),
            discountAmount: formatCurrency(order.priceSummary?.discountAmount || 0),
            grandTotal: formatCurrency(order.priceSummary?.grandTotal || 0),
            currency: order.priceSummary?.currency || 'INR',
        },
        statusHistory,
        latestStatusNote: latest.note || '',
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
    };
};

/**
 * List Assigned Orders for Authenticated Rider
 * @route GET /api/partner/orders
 * @access Private (Rider)
 */
export const listRiderAssignedOrders = async (req, res) => {
    const { error, value } = listRiderOrdersQuerySchema.validate(req.query);
    if (error) {
        return sendResponse({
            res,
            statusCode: httpStatus.BAD_REQUEST,
            message: error.details[0].message,
        });
    }

    const page = Number(value.page);
    const limit = Number(value.limit);

    // Hard security requirement: Filter strictly by assignedPartner = req.user.id
    const filter = { assignedPartner: req.user.id };

    if (value.orderStatus) {
        filter.orderStatus = STATUS_MAP[value.orderStatus] || value.orderStatus;
    } else {
        filter.orderStatus = { $in: ['PROCESSED', 'DISPATCHED', 'DELIVERED', 'FAILED'] };
    }

    if (value.search?.trim()) {
        const searchInput = value.search.trim();
        const searchRegex = new RegExp(escapeRegex(searchInput), 'i');

        // Look-ahead: Find non-deleted users matching customer name
        const matchingUsers = await User.find({
            isDeleted: false,
            $or: [
                { fullName: { $regex: searchRegex } },
                { firstName: { $regex: searchRegex } },
                { lastName: { $regex: searchRegex } },
            ],
        })
            .select('_id')
            .lean();

        const userIds = matchingUsers.map((u) => u._id);

        filter.$or = [
            { orderNumber: { $regex: searchRegex } },
            { 'deliveryAddress.fullAddress': { $regex: searchRegex } },
            { 'deliveryAddress.city': { $regex: searchRegex } },
            { 'deliveryAddress.firstName': { $regex: searchRegex } },
            { 'deliveryAddress.lastName': { $regex: searchRegex } },
            ...(userIds.length > 0 ? [{ user: { $in: userIds } }] : []),
        ];
    }

    const skip = (page - 1) * limit;
    const sort = { assignedAt: -1, createdAt: -1 };

    const partnerObjectId = new mongoose.Types.ObjectId(req.user.id);

    const [orders, count, statusCountsRaw] = await Promise.all([
        PrintOrder.find(filter)
            .populate('user', 'firstName lastName fullName phone email')
            .sort(sort)
            .skip(skip)
            .limit(limit)
            .lean(),
        PrintOrder.countDocuments(filter),
        PrintOrder.aggregate([
            { $match: { assignedPartner: partnerObjectId } },
            { $group: { _id: '$orderStatus', count: { $sum: 1 } } },
        ]),
    ]);

    const counts = {
        processed: 0,
        dispatched: 0,
        delivered: 0,
        failed: 0,
        total: 0,
    };

    for (const item of statusCountsRaw) {
        const key = String(item._id || '').toLowerCase();
        if (key in counts && key !== 'total') {
            counts[key] = item.count;
        }
        counts.total += item.count;
    }

    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        message: 'Assigned orders fetched successfully.',
        data: {
            data: orders.map(buildRiderOrderListItem),
            count,
            counts,
        },
    });
};

/**
 * Get Rider Dashboard - Status Counts & Paginated Completed Orders
 * @route GET /api/partner/orders/dashboard
 * @access Private (Rider)
 */
export const getRiderDashboard = async (req, res) => {
    const { error, value } = riderDashboardQuerySchema.validate(req.query);
    if (error) {
        return sendResponse({
            res,
            statusCode: httpStatus.BAD_REQUEST,
            message: error.details[0].message,
        });
    }

    const page = Number(value.page);
    const limit = Number(value.limit);
    const skip = (page - 1) * limit;

    // Hard security requirement: Filter strictly by assignedPartner = req.user.id and completed only
    const filter = {
        assignedPartner: req.user.id,
        orderStatus: 'DELIVERED',
    };

    if (value.search?.trim()) {
        const searchInput = value.search.trim();
        const searchRegex = new RegExp(escapeRegex(searchInput), 'i');

        const matchingUsers = await User.find({
            isDeleted: false,
            $or: [
                { fullName: { $regex: searchRegex } },
                { firstName: { $regex: searchRegex } },
                { lastName: { $regex: searchRegex } },
            ],
        })
            .select('_id')
            .lean();

        const userIds = matchingUsers.map((u) => u._id);

        filter.$or = [
            { orderNumber: { $regex: searchRegex } },
            { 'deliveryAddress.fullAddress': { $regex: searchRegex } },
            { 'deliveryAddress.city': { $regex: searchRegex } },
            { 'deliveryAddress.firstName': { $regex: searchRegex } },
            { 'deliveryAddress.lastName': { $regex: searchRegex } },
            ...(userIds.length > 0 ? [{ user: { $in: userIds } }] : []),
        ];
    }

    const partnerObjectId = new mongoose.Types.ObjectId(req.user.id);
    const sort = { updatedAt: -1, createdAt: -1 };

    const [orders, count, statusCountsRaw, notificationsCount] = await Promise.all([
        PrintOrder.find(filter)
            .populate('user', 'firstName lastName fullName phone email')
            .sort(sort)
            .skip(skip)
            .limit(limit)
            .lean(),
        PrintOrder.countDocuments(filter),
        PrintOrder.aggregate([
            { $match: { assignedPartner: partnerObjectId } },
            { $group: { _id: '$orderStatus', count: { $sum: 1 } } },
        ]),
        PartnerNotification.countDocuments({
            partner: req.user.id,
            status: 'UNREAD',
            isDeleted: false,
        }),
    ]);

    const counts = {
        processed: 0,
        dispatched: 0,
        delivered: 0,
        failed: 0,
        total: 0,
        notifications: notificationsCount || 0,
    };

    for (const item of statusCountsRaw) {
        const key = String(item._id || '').toLowerCase();
        if (key in counts && key !== 'total' && key !== 'notifications') {
            counts[key] = item.count;
        }
        counts.total += item.count;
    }

    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        message: 'Rider dashboard details fetched successfully',
        data: {
            data: orders.map(buildRiderOrderListItem),
            count,
            notificationsCount,
            counts,
        },
    });
};

/**
 * Get Details of a Single Assigned Order for Authenticated Rider
 * @route GET /api/partner/orders/:orderId
 * @access Private (Rider)
 */
export const getRiderAssignedOrderById = async (req, res) => {
    const { error, value } = getRiderOrderByIdParamsSchema.validate(req.params);
    if (error) {
        return sendResponse({
            res,
            statusCode: httpStatus.BAD_REQUEST,
            message: error.details[0].message,
        });
    }

    // Hard security requirement: Find by _id AND assignedPartner = req.user.id
    const order = await PrintOrder.findOne({
        _id: value.orderId,
        assignedPartner: req.user.id,
    })
        .populate('user', 'firstName lastName fullName phone email')
        .lean();

    if (!order) {
        return sendResponse({
            res,
            statusCode: httpStatus.NOT_FOUND,
            message: 'Order not found.',
        });
    }

    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        message: 'Assigned order details fetched successfully.',
        data: buildRiderOrderDetail(order),
    });
};

/**
 * Update Delivery Status of an Assigned Order by Rider
 * @route PATCH /api/partner/orders/:orderId/status
 * @access Private (Rider)
 */
export const updateRiderOrderStatus = async (req, res) => {
    const { error: paramsError, value: params } = getRiderOrderByIdParamsSchema.validate(req.params);
    if (paramsError) {
        return sendResponse({
            res,
            statusCode: httpStatus.BAD_REQUEST,
            message: paramsError.details[0].message,
        });
    }

    const { error: bodyError, value: body } = updateRiderOrderStatusSchema.validate(req.body);
    if (bodyError) {
        return sendResponse({
            res,
            statusCode: httpStatus.BAD_REQUEST,
            message: bodyError.details[0].message,
        });
    }

    // Security check: Must strictly find order by _id AND assignedPartner = req.user.id
    const order = await PrintOrder.findOne({
        _id: params.orderId,
        assignedPartner: req.user.id,
    });

    if (!order) {
        return sendResponse({
            res,
            statusCode: httpStatus.NOT_FOUND,
            message: 'Order not found.',
        });
    }

    if (order.deliveryMode !== 'DELIVERY') {
        return sendResponse({
            res,
            statusCode: httpStatus.BAD_REQUEST,
            message: 'Only delivery orders can be updated by a rider.',
        });
    }

    const currentStatus = order.orderStatus;
    const requestedStatus = STATUS_MAP[body.orderStatus] || body.orderStatus;

    if (currentStatus === requestedStatus) {
        const label = STATUS_DISPLAY_LABELS[requestedStatus] || requestedStatus;
        return sendResponse({
            res,
            statusCode: httpStatus.BAD_REQUEST,
            message: `This order has already been ${label.toLowerCase()}.`,
        });
    }

    const allowedNext = RIDER_ALLOWED_NEXT[currentStatus] || [];

    if (!allowedNext.includes(requestedStatus)) {
        if (currentStatus === 'RECEIVED') {
            return sendResponse({
                res,
                statusCode: httpStatus.BAD_REQUEST,
                message: "Please update the status to 'Processed' first.",
            });
        }
        if (currentStatus === 'DELIVERED') {
            return sendResponse({
                res,
                statusCode: httpStatus.BAD_REQUEST,
                message: 'This order has already been delivered.',
            });
        }
        if (currentStatus === 'CANCELLED') {
            return sendResponse({
                res,
                statusCode: httpStatus.BAD_REQUEST,
                message: 'This order has already been cancelled.',
            });
        }
        if (currentStatus === 'FAILED') {
            return sendResponse({
                res,
                statusCode: httpStatus.BAD_REQUEST,
                message: 'This order has already been marked as failed.',
            });
        }
        if (currentStatus === 'PROCESSED' && (requestedStatus === 'DELIVERED' || requestedStatus === 'FAILED')) {
            return sendResponse({
                res,
                statusCode: httpStatus.BAD_REQUEST,
                message: "Please update the status to 'Dispatched' first.",
            });
        }
        const currentLabel = STATUS_DISPLAY_LABELS[currentStatus] || currentStatus;
        return sendResponse({
            res,
            statusCode: httpStatus.BAD_REQUEST,
            message: `This order has already been ${currentLabel.toLowerCase()}.`,
        });
    }

    const riderNote = (body.note || body.reason || '').trim();
    const defaultNote = requestedStatus === 'FAILED'
        ? (riderNote || 'Delivery attempt failed: customer unavailable')
        : `Order marked as ${requestedStatus.toLowerCase()} by rider`;
    const historyNote = riderNote && requestedStatus !== 'FAILED'
        ? `${defaultNote} - ${riderNote}`
        : defaultNote;

    // Persist new status and add to status history
    order.orderStatus = requestedStatus;
    order.statusHistory.push({
        status: requestedStatus,
        changedBy: null, // rider action
        note: historyNote,
        changedAt: new Date(),
    });

    await order.save();

    // Fire-and-forget: Notify User about the order status update (DISPATCHED / DELIVERED)
    sendOrderStatusNotificationToUser(order, requestedStatus, null).catch((err) =>
        console.error('Failed to dispatch user status notification from rider update:', err.message),
    );

    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        message: `Order status updated to ${requestedStatus} successfully.`,
        data: {
            _id: order._id,
            orderNumber: order.orderNumber,
            orderStatus: order.orderStatus,
            updatedAt: order.updatedAt,
        },
    });
};


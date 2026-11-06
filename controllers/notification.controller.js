// controllers/notification.controller.js
import httpStatus from 'http-status';
import chalk from 'chalk';
import Notification from '#models/notification';
import User from '#models/user';
import PrintOrder from '#models/printOrder';
import { calculatePagination, sendResponse } from '#utils/generalHelper';
import { sendPushNotification } from '#utils/firebase';
import {
    adminSendNotificationSchema,
    adminListNotificationsQuerySchema,
    adminNotificationParamsSchema,
    listUserNotificationsQuerySchema,
} from '#validations/notification';
import { NOTIFICATION_ICON_URL } from '#constants/notification';

// ─── Mapping: Order Status to Numeric (for UI) ──
const ORDER_STATUS_NUMERIC_MAP = {
    RECEIVED: 1,
    PROCESSED: 2,
    DISPATCHED: 3,
    DELIVERED: 4,
    CANCELLED: 5,
};

// ─── Field Map: Admin Notification List ──
const buildAdminNotificationListItem = (n = {}) => ({
    _id: n._id,
    title: n.title,
    body: n.body,
    type: n.type,
    category: n.category,
    status: n.status,
    recipient: Array.isArray(n.recipient)
        ? n.recipient.map((r) => ({
              _id: r?._id,
              fullName: r?.fullName,
              phone: r?.phone,
          })).filter((r) => r._id)
        : [],
    isBroadcast: !Array.isArray(n.recipient) || n.recipient.length === 0,
    order: n.order ?? null, // ObjectId ref (not populated in list — detail view has it)
    sentBy: n.sentBy // populated: { fullName, email }
        ? { _id: n.sentBy._id, fullName: n.sentBy.fullName, email: n.sentBy.email }
        : null,
    createdAt: n.createdAt,
});

// ─── Field Map: User Notification List ──
const buildUserNotificationListItem = (n = {}) => ({
    _id: n._id,
    title: n.title,
    body: n.body,
    // type: n.type,
    category: n.category,
    // status: n.status,
    orderId: n.order?._id ?? n.order ?? null, // handle both populated and raw ID
    orderStatus: n.order?.orderStatus ? ORDER_STATUS_NUMERIC_MAP[n.order.orderStatus] || 0 : 0,
    // data: n.data ?? null,
    imageUrl: n.imageUrl || NOTIFICATION_ICON_URL, // falls back to the default notification icon
    createdAt: n.createdAt,
});

// ─── Admin Controllers ──

/**
 * Send / Create a Notification
 * @route POST /api/admin/notifications
 * @access Private (Admin)
 */
export const adminSendNotification = async (req, res) => {
    const { error, value } = adminSendNotificationSchema.validate(req.body);

    if (error) {
        return sendResponse({ res, statusCode: httpStatus.BAD_REQUEST, message: error.details[0].message });
    }

    const { title, body, type, category, recipientId, recipientIds, orderId, data } = value;

    // Validate order reference if provided
    if (orderId) {
        const orderExists = await PrintOrder.exists({ _id: orderId });

        if (!orderExists) {
            return sendResponse({ res, statusCode: httpStatus.NOT_FOUND, message: 'Order not found' });
        }
    }

    let recipients = [];
    if (recipientId) {
        recipients.push(recipientId);
    } else if (recipientIds && recipientIds.length > 0) {
        recipients = [...new Set(recipientIds)];
    }

    // Validate recipients exist
    if (recipients.length > 0) {
        const uniqueUsersCount = await User.countDocuments({
            _id: { $in: recipients },
            isDeleted: false,
        });

        if (uniqueUsersCount !== recipients.length) {
            return sendResponse({
                res,
                statusCode: httpStatus.NOT_FOUND,
                message: 'One or more recipient users were not found or are deleted',
            });
        }
    }

    const notification = await Notification.create({
        title,
        body,
        type,
        category,
        recipient: recipients, // defaults to [] for broadcast
        order: orderId || null,
        imageUrl: NOTIFICATION_ICON_URL,
        data: data || null,
        sentBy: req.user.id,
    });

    if (type === 'PUSH') {
        const metadata = {
            category,
            type: category, // set type parameter to category value for client transparency
            orderId: orderId ? orderId.toString() : '',
            notificationId: notification._id.toString(),
            ...(data || {}),
        };

        if (recipients.length > 0) {
            const users = await User.find({
                _id: { $in: recipients },
                isDeleted: false,
                isActive: true,
                fcmToken: { $gt: '' },
            }).select('fcmToken').lean();

            const fcmTokens = users.map((u) => u.fcmToken).filter(Boolean);

            if (fcmTokens.length > 0) {
                sendPushNotification(fcmTokens, title, body, metadata).catch((err) => {
                    console.error('Error sending targeted push notification:', err);
                });
            }
        } else {
            const broadcastPush = async () => {
                const batchSize = 500;
                let lastId = null;
                let hasMore = true;

                while (hasMore) {
                    const query = {
                        isDeleted: false,
                        isActive: true,
                        fcmToken: { $gt: '' },
                    };
                    if (lastId) {
                        query._id = { $gt: lastId };
                    }

                    const batchUsers = await User.find(query)
                        .select('fcmToken')
                        .sort({ _id: 1 })
                        .limit(batchSize)
                        .lean();

                    if (batchUsers.length === 0) {
                        hasMore = false;
                        break;
                    }

                    const tokens = batchUsers.map((u) => u.fcmToken).filter(Boolean);
                    if (tokens.length > 0) {
                        await sendPushNotification(tokens, title, body, metadata);
                    }

                    lastId = batchUsers[batchUsers.length - 1]._id;
                    if (batchUsers.length < batchSize) {
                        hasMore = false;
                    }
                }
            };

            broadcastPush().catch((err) => {
                console.error('Error sending broadcast push notifications:', err);
            });
        }
    }

    const populatedNotification = await Notification.findById(notification._id)
        .populate('recipient', 'fullName phone email')
        .populate('sentBy', 'fullName email')
        .lean();

    if (recipients.length > 0) {
        console.log(chalk.bold.green(`[Notification] Admin successfully sent targeted notification to ${recipients.length} user(s).`));
    } else {
        console.log(chalk.bold.blue(`[Notification] Admin successfully sent broadcast notification to all users.`));
    }

    return sendResponse({
        res,
        statusCode: httpStatus.CREATED,
        message: 'Notification sent successfully',
        data: populatedNotification,
    });
};

/**
 * List All Notifications (Admin view — filterable, paginated)
 * @route GET /api/admin/notifications
 * @access Private (Admin)
 */
export const adminGetNotifications = async (req, res) => {
    const { error, value } = adminListNotificationsQuerySchema.validate(req.query);

    if (error) {
        return sendResponse({ res, statusCode: httpStatus.BAD_REQUEST, message: error.details[0].message });
    }

    const { page, limit, type, category, status, search, sortBy, sortOrder } = value;

    const filter = {
        isDeleted: false,
        category: { $in: ['GENERAL', 'PROMOTIONAL'] },
    };

    if (type) filter.type = type;
    if (category) filter.category = category;
    if (status) filter.status = status;

    if (search?.trim()) {
        const regex = { $regex: search.trim(), $options: 'i' };
        filter.$or = [{ title: regex }, { body: regex }];
    }

    const direction = sortOrder === 'asc' ? 1 : -1;
    const sort = { [sortBy]: direction, _id: -1 };

    const { records, count } = await calculatePagination(Notification, filter, {
        page,
        limit,
        sort,
        populate: [
            { path: 'recipient', select: 'fullName phone' },
            { path: 'sentBy', select: 'fullName email' },
        ],
    });

    // Wrap in { data, count } so sendResponse hoists `count` to the parent JSON level
    // (same pattern as admin users list). The field map above controls which
    // keys are included in each list item.
    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        message: 'Notifications fetched successfully',
        data: { data: records.map(buildAdminNotificationListItem), count },
    });
};

/**
 * Get Single Notification Detail (Admin)
 * @route GET /api/admin/notifications/:notificationId
 * @access Private (Admin)
 */
export const adminGetNotificationById = async (req, res) => {
    const { error, value } = adminNotificationParamsSchema.validate(req.params);

    if (error) {
        return sendResponse({ res, statusCode: httpStatus.BAD_REQUEST, message: error.details[0].message });
    }

    const notification = await Notification.findOne({ _id: value.notificationId, isDeleted: false })
        .populate('recipient', 'fullName phone email')
        .populate('order', 'orderNumber orderStatus')
        .populate('sentBy', 'fullName email')
        .lean();

    if (!notification) {
        return sendResponse({ res, statusCode: httpStatus.NOT_FOUND, message: 'Notification not found' });
    }

    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        message: 'Notification fetched successfully',
        data: notification,
    });
};

/**
 * Soft-Delete a Notification (Admin)
 * @route DELETE /api/admin/notifications/:notificationId
 * @access Private (Admin)
 */
export const adminDeleteNotification = async (req, res) => {
    const { error, value } = adminNotificationParamsSchema.validate(req.params);

    if (error) {
        return sendResponse({ res, statusCode: httpStatus.BAD_REQUEST, message: error.details[0].message });
    }

    const notification = await Notification.findOne({ _id: value.notificationId, isDeleted: false });

    if (!notification) {
        return sendResponse({ res, statusCode: httpStatus.NOT_FOUND, message: 'Notification not found' });
    }

    notification.isDeleted = true;
    await notification.save();

    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        message: 'Notification deleted successfully',
    });
};

// ─── User Controllers ─────────────────────────────────────────────────────────

/**
 * Get All Notifications for Authenticated User
 * Fetching the list auto-marks all returned notifications as READ (non-blocking).
 * @route GET /api/notifications
 * @access Private (User)
 */
export const getUserNotifications = async (req, res) => {
    const { error, value } = listUserNotificationsQuerySchema.validate(req.query);

    if (error) {
        return sendResponse({ res, statusCode: httpStatus.BAD_REQUEST, message: error.details[0].message });
    }

    const { page, limit } = value;
    const userId = req.user.id;

    // Fetch user registration date to filter out older broadcast notifications
    const user = await User.findById(userId).select('createdAt').lean();
    if (!user) {
        return sendResponse({ res, statusCode: httpStatus.NOT_FOUND, message: 'User not found' });
    }

    const filter = {
        $or: [
            { recipient: userId },
            {
                recipient: { $size: 0 },
                createdAt: { $gte: user.createdAt },
            },
        ],
        isDeleted: false,
    };

    const { records, count } = await calculatePagination(Notification, filter, {
        page,
        limit,
        sort: { createdAt: -1 },
        populate: [{ path: 'order', select: 'orderStatus' }],
    });

    // Non-blocking mark-as-read: only mark the documents that were just returned
    if (records.length > 0) {
        const fetchedIds = records.map((n) => n._id);
        Notification.updateMany(
            { _id: { $in: fetchedIds }, status: 'UNREAD' },
            { $set: { status: 'READ', readAt: new Date() } },
        ).catch(() => {}); // silent fail — never block the response
    }

    // Wrap in { data, count } so sendResponse hoists `count` to the parent JSON level.
    // The field map above controls which keys are included per notification card.
    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        message: 'Notifications fetched successfully',
        data: { data: records.map(buildUserNotificationListItem), count },
    });
};

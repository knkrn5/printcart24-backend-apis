// controllers/partnerNotification.controller.js
import httpStatus from 'http-status';
import PartnerNotification from '#models/partnerNotification';
import { calculatePagination, sendResponse } from '#utils/generalHelper';
import { listPartnerNotificationsQuerySchema } from '#validations/partnerNotification';
import { NOTIFICATION_ICON_URL } from '#constants/notification';

const ORDER_STATUS_NUMERIC_MAP = {
    RECEIVED: 1,
    PROCESSED: 2,
    DISPATCHED: 3,
    DELIVERED: 4,
    CANCELLED: 5,
    FAILED: 6,
    REATTEMPT: 7,
};

const buildPartnerNotificationListItem = (n = {}) => ({
    _id: n._id,
    title: n.title,
    body: n.body,
    category: n.category,
    orderId: n.order?._id ?? n.order ?? null,
    orderStatus: n.order?.orderStatus ? ORDER_STATUS_NUMERIC_MAP[n.order.orderStatus] || 0 : 0,
    imageUrl: n.imageUrl || NOTIFICATION_ICON_URL,
    createdAt: n.createdAt,
});

/**
 * Get All Notifications for Authenticated Rider
 * Fetching the list auto-marks all returned notifications as READ (non-blocking).
 * @route GET /api/partner/notifications
 * @access Private (Rider)
 */
export const getRiderNotifications = async (req, res) => {
    const { error, value } = listPartnerNotificationsQuerySchema.validate(req.query);

    if (error) {
        return sendResponse({ res, statusCode: httpStatus.BAD_REQUEST, message: error.details[0].message });
    }

    const { page, limit } = value;
    const partnerId = req.user.id;

    const filter = {
        partner: partnerId,
        isDeleted: false,
    };

    const [{ records, count }, initialUnreadCount] = await Promise.all([
        calculatePagination(PartnerNotification, filter, {
            page,
            limit,
            sort: { createdAt: -1 },
            populate: [{ path: 'order', select: 'orderStatus' }],
        }),
        PartnerNotification.countDocuments({
            partner: partnerId,
            status: 'UNREAD',
            isDeleted: false,
        }),
    ]);

    let newlyReadCount = 0;
    // Mark fetched unread notifications as read
    if (records.length > 0) {
        const unreadIds = records.filter((n) => n.status === 'UNREAD').map((n) => n._id);
        newlyReadCount = unreadIds.length;
        if (unreadIds.length > 0) {
            PartnerNotification.updateMany(
                { _id: { $in: unreadIds } },
                { $set: { status: 'READ', readAt: new Date() } },
            ).catch(() => {});
        }
    }

    const remainingUnread = Math.max(0, initialUnreadCount - newlyReadCount);

    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        message: 'Notifications fetched successfully',
        data: {
            data: records.map(buildPartnerNotificationListItem),
            count,
            notificationsCount: remainingUnread,
        },
    });
};

/**
 * Get Unread Notifications Count for Authenticated Rider
 * @route GET /api/partner/notifications/count
 * @access Private (Rider)
 */
export const getRiderNotificationsCount = async (req, res) => {
    const partnerId = req.user.id;

    const notificationsCount = await PartnerNotification.countDocuments({
        partner: partnerId,
        status: 'UNREAD',
        isDeleted: false,
    });

    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        message: 'Notifications count fetched successfully',
        data: {
            notificationsCount,
        },
    });
};
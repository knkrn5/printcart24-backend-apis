// validations/notification.validation.js
import Joi from 'joi';
import { isValidObjectId } from '#utils/generalHelper';

const objectIdValidator = (value, helpers) => {
    if (!isValidObjectId(value)) {
        return helpers.error('any.invalid');
    }
    return value;
};

// ─── Admin Schemas ────────────────────────────────────────────────────────────

/**
 * POST /api/admin/notifications
 * Body validation for creating / sending a notification.
 */
export const adminSendNotificationSchema = Joi.object({
    title: Joi.string().trim().max(120).required().label('Title'),
    body: Joi.string().trim().max(500).required().label('Body'),
    type: Joi.string().valid('PUSH', 'IN_APP').required().label('Type'),
    category: Joi.string()
        .valid('ORDER_NOTIFICATION', 'GENERAL', 'PROMOTIONAL')
        .default('ORDER_NOTIFICATION')
        .label('Category'),
    recipientId: Joi.string()
        .custom(objectIdValidator, 'ObjectId validation')
        .optional()
        .label('Recipient id'),
    recipientIds: Joi.array()
        .items(Joi.string().custom(objectIdValidator, 'ObjectId validation'))
        .optional()
        .label('Recipient ids'),
    orderId: Joi.string()
        .custom(objectIdValidator, 'ObjectId validation')
        .optional()
        .label('Order id'),
    data: Joi.object().optional().label('Extra data'),
}).unknown(false);

/**
 * GET /api/admin/notifications
 * Query params for listing notifications.
 */
export const adminListNotificationsQuerySchema = Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(10),
    type: Joi.string().valid('PUSH', 'IN_APP').optional().label('Type'),
    category: Joi.string()
        .valid('GENERAL', 'PROMOTIONAL')
        .optional()
        .label('Category'),
    status: Joi.string().valid('UNREAD', 'READ').optional().label('Status'),
    search: Joi.string().trim().optional().allow('').label('Search'),
    sortBy: Joi.string().valid('createdAt', 'updatedAt').default('createdAt').label('Sort by'),
    sortOrder: Joi.string().valid('asc', 'desc').default('desc').label('Sort order'),
}).unknown(false);

/**
 * :notificationId param — used for GET detail & DELETE.
 */
export const adminNotificationParamsSchema = Joi.object({
    notificationId: Joi.string()
        .custom(objectIdValidator, 'ObjectId validation')
        .required()
        .label('Notification id'),
});

// ─── User Schemas ─────────────────────────────────────────────────────────────

/**
 * GET /api/notifications
 * Query params for user notification listing.
 */
export const listUserNotificationsQuerySchema = Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
}).unknown(false);

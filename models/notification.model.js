// models/notification.model.js
import mongoose, { Schema } from 'mongoose';
import {
    NOTIFICATION_TYPES,
    NOTIFICATION_CATEGORIES,
    NOTIFICATION_STATUSES,
} from '#constants/notification';

const notificationSchema = new Schema(
    {
        title: {
            type: String,
            required: true,
            trim: true,
        },

        body: {
            type: String,
            required: true,
            trim: true,
        },

        type: {
            type: String,
            enum: NOTIFICATION_TYPES,
            default: 'IN_APP',
        },

        category: {
            type: String,
            enum: NOTIFICATION_CATEGORIES,
            default: 'ORDER_NOTIFICATION',
        },

        status: {
            type: String,
            enum: NOTIFICATION_STATUSES,
            default: 'UNREAD',
        },

        /**
         * The user this notification is intended for.
         * null = broadcast (shown to all users).
         */
        recipient: {
            type: [Schema.Types.ObjectId],
            ref: 'User',
            default: [],
        },

        /**
         * Optional order reference for ORDER_NOTIFICATION deep-links.
         */
        order: {
            type: Schema.Types.ObjectId,
            ref: 'PrintOrder',
            default: null,
        },

        /**
         * Optional image URL for rich PUSH notifications.
         */
        imageUrl: {
            type: String,
            default: '',
            trim: true,
        },

        /**
         * Arbitrary extra payload (e.g. { orderNumber, orderStatus })
         * forwarded to the mobile app via FCM data envelope.
         */
        data: {
            type: Schema.Types.Mixed,
            default: null,
        },

        /**
         * Admin who created / sent this notification.
         */
        sentBy: {
            type: Schema.Types.ObjectId,
            ref: 'Admin',
            default: null,
        },

        /**
         * Soft-delete flag — consistent with orders/users pattern.
         */
        isDeleted: {
            type: Boolean,
            default: false,
        },

        /**
         * Timestamp of when recipient read this notification.
         */
        readAt: {
            type: Date,
            default: null,
        },
    },
    {
        timestamps: true,
        collection: 'notifications',
    },
);

// ─── Indexes ────────────────────────────────────────────────────────────────
notificationSchema.index({ recipient: 1, status: 1, createdAt: -1 }); // user listing
notificationSchema.index({ category: 1, createdAt: -1 });              // admin filtering
notificationSchema.index({ order: 1 });                                // order deep-link lookup
notificationSchema.index({ isDeleted: 1, status: 1 });                 // mark-all-read query

const Notification = mongoose.model('Notification', notificationSchema);
export default Notification;

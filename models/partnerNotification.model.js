// models/partnerNotification.model.js
import mongoose, { Schema } from 'mongoose';
import {
    NOTIFICATION_TYPES,
    NOTIFICATION_CATEGORIES,
    NOTIFICATION_STATUSES,
} from '#constants/notification';

const partnerNotificationSchema = new Schema(
    {
        partner: {
            type: Schema.Types.ObjectId,
            ref: 'Partner',
            required: true,
            index: true,
        },

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
            index: true,
        },

        order: {
            type: Schema.Types.ObjectId,
            ref: 'PrintOrder',
            default: null,
            index: true,
        },

        imageUrl: {
            type: String,
            default: '',
            trim: true,
        },

        data: {
            type: Schema.Types.Mixed,
            default: null,
        },

        sentBy: {
            type: Schema.Types.ObjectId,
            ref: 'Admin',
            default: null,
        },

        isDeleted: {
            type: Boolean,
            default: false,
            index: true,
        },

        readAt: {
            type: Date,
            default: null,
        },
    },
    {
        timestamps: true,
        collection: 'partner_notifications',
    },
);

partnerNotificationSchema.index({ partner: 1, status: 1, createdAt: -1 });

const PartnerNotification = mongoose.model('PartnerNotification', partnerNotificationSchema);
export default PartnerNotification;
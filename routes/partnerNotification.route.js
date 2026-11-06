// routes/partnerNotification.route.js
import { Router } from 'express';
import { getRiderNotifications, getRiderNotificationsCount } from '#controllers/partnerNotification';
import { isRider, verifyPartnerToken } from '#middlewares/partnerAuth';
import asyncHandler from '#utils/asyncHandler';

const partnerNotificationRouter = Router();

partnerNotificationRouter.use(verifyPartnerToken, isRider);

partnerNotificationRouter.route('/count').get(asyncHandler(getRiderNotificationsCount));
partnerNotificationRouter.route('/').get(asyncHandler(getRiderNotifications));

export default partnerNotificationRouter;
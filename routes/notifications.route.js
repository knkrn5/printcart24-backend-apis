// routes/notifications.route.js
import { Router } from 'express';
import { getUserNotifications } from '#controllers/notification';
import { verifyUserToken } from '#middlewares/auth';
import asyncHandler from '#utils/asyncHandler';

const notificationsRouter = Router();

/**
 * @route GET /api/notifications
 * @desc  Fetch all notifications for the authenticated user.
 *        Auto-marks the returned page as READ (non-blocking).
 * @access Private (User)
 */
notificationsRouter.route('/').get(verifyUserToken, asyncHandler(getUserNotifications));

export default notificationsRouter;


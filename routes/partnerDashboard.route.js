// routes/partnerDashboard.route.js
import { Router } from 'express';
import { getRiderDashboard } from '#controllers/partnerOrder';
import { isRider, verifyPartnerToken } from '#middlewares/partnerAuth';
import asyncHandler from '#utils/asyncHandler';

const partnerDashboardRouter = Router();

partnerDashboardRouter.use(verifyPartnerToken, isRider);

partnerDashboardRouter.route('/').get(asyncHandler(getRiderDashboard));

export default partnerDashboardRouter;

// routes/partnerOrder.route.js
import { Router } from 'express';
import {
    getRiderAssignedOrderById,
    listRiderAssignedOrders,
    updateRiderOrderStatus,
} from '#controllers/partnerOrder';
import { isRider, verifyPartnerToken } from '#middlewares/partnerAuth';
import asyncHandler from '#utils/asyncHandler';

const partnerOrderRouter = Router();

partnerOrderRouter.use(verifyPartnerToken, isRider);

partnerOrderRouter.route('/').get(asyncHandler(listRiderAssignedOrders));
partnerOrderRouter.route('/:orderId').get(asyncHandler(getRiderAssignedOrderById));
partnerOrderRouter.route('/:orderId/status').patch(asyncHandler(updateRiderOrderStatus));

export default partnerOrderRouter;

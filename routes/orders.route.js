import { Router } from 'express';
import asyncHandler from '#utils/asyncHandler';
import { verifyUserToken } from '#middlewares/auth';
import { getOrderById, listOrders, placeOrder, trackOrder, cancelOrder, verifyPayment, getRefundStatus, downloadInvoice } from '#controllers/orders';


const ordersRouter = Router();

// User Routes
ordersRouter.use(verifyUserToken);

ordersRouter.route('/').post(asyncHandler(placeOrder)).get(asyncHandler(listOrders));

ordersRouter.route('/:orderId').get(asyncHandler(getOrderById));
ordersRouter.route('/:orderId/invoice').get(asyncHandler(downloadInvoice));
ordersRouter.route('/:orderId/tracking').get(asyncHandler(trackOrder));
ordersRouter.route('/:orderId/cancel').patch(asyncHandler(cancelOrder));
ordersRouter.route('/:orderId/refund-status').get(asyncHandler(getRefundStatus));

ordersRouter.route('/verify-payment').post(asyncHandler(verifyPayment));


export default ordersRouter;

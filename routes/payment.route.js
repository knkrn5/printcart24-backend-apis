// routes/payment.route.js
import { Router } from 'express';
import asyncHandler from '#utils/asyncHandler';
import { razorpayWebhook } from '#controllers/payment';

const paymentRouter = Router();

// Public Webhook (No auth required)
paymentRouter.route('/webhook').post(asyncHandler(razorpayWebhook));

export default paymentRouter;

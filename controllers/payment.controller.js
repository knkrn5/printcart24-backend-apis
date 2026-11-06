// controllers/payment.controller.js
import crypto from 'crypto';
import env from '#configs/env';
import PrintOrder from '#models/printOrder';
import { finalizeOrderAfterPayment, notifyUserOrderFailed } from '#controllers/orders';
import * as rzpService from '#services/razorpay';

/**
 * Razorpay Webhook Handler
 */
export const razorpayWebhook = async (req, res) => {
    const secret = env.RAZORPAY_WEBHOOK_SECRET;
    const signature = req.headers['x-razorpay-signature'];
    const { event, payload } = req.body;
    const paymentEntity = payload?.payment?.entity;

    // 1. Signature Verification
    if (secret && signature) {
        const shasum = crypto.createHmac('sha256', secret);
        shasum.update(JSON.stringify(req.body));
        const digest = shasum.digest('hex');

        if (digest !== signature) {
            console.error(`[PAYMENT_WEBHOOK] ERROR: Invalid webhook signature received for event: ${event}`);
            return res.status(400).send('Invalid signature');
        }
    }

    // 2. Identify Event and Dispatch
    if (event === 'payment.captured' && paymentEntity) {
        const rzpOrderId = paymentEntity.order_id;
        const rzpPaymentId = paymentEntity.id;

        console.log(`[PAYMENT_WEBHOOK] Event payment.captured: Processing payment ${rzpPaymentId} for Razorpay Order ${rzpOrderId}`);

        try {
            const order = await finalizeOrderAfterPayment({
                razorpayOrderId: rzpOrderId,
                razorpayPaymentId: rzpPaymentId,
            });

            console.log(`[PAYMENT_WEBHOOK] SUCCESS: Order #${order.orderNumber} finalized successfully via webhook`);
        } catch (err) {
            console.error(`[PAYMENT_WEBHOOK] ERROR: finalizeOrderAfterPayment failed in webhook: ${err.message}`);

            try {
                const partialOrder = await PrintOrder.findOne({ razorpayOrderId: rzpOrderId });
                if (partialOrder) {
                    // CATCH SAFETY: NEVER overwrite an order that is already successful (PAID, RECEIVED, PROCESSED, etc.)
                    if (
                        partialOrder.paymentStatus === 'PAID' ||
                        ['RECEIVED', 'PROCESSED', 'DISPATCHED', 'DELIVERED'].includes(partialOrder.orderStatus)
                    ) {
                        console.log(
                            `[CATCH_SAFETY] 🛡️ Webhook: Order #${partialOrder.orderNumber} already exists with status: ${partialOrder.orderStatus} / ${partialOrder.paymentStatus}.`,
                        );
                        console.log(
                            `[CATCH_SAFETY] ⛔ ABORTING failure overwrite! Existing successful order will NOT be marked FAILED.`,
                        );
                        return res.status(200).json({ status: 'ok', message: 'Order already finalized' });
                    }

                    if (!['CANCELLED', 'FAILED'].includes(partialOrder.orderStatus)) {
                        console.log(
                            `[CATCH_SAFETY] ⚠️ Webhook: Verified Order #${partialOrder.orderNumber} is in unfulfilled state (${partialOrder.orderStatus}). Proceeding with safe failure handling.`,
                        );
                        partialOrder.orderStatus = 'FAILED';
                        partialOrder.paymentStatus = 'FAILED';
                        partialOrder.statusHistory.push({
                            status: 'FAILED',
                            changedBy: null,
                            note: 'Payment or verification failed. Refund will be initiated shortly.',
                            changedAt: new Date(),
                        });

                        if (rzpPaymentId && partialOrder.priceSummary?.grandTotal > 0) {
                            try {
                                console.log(
                                    `[AUTO_REFUND] 💸 Webhook: Initiating automatic refund via Razorpay (Payment ID: ${rzpPaymentId}, Amount: ₹${partialOrder.priceSummary.grandTotal})...`,
                                );
                                const rzpRefund = await rzpService.refundPayment(
                                    rzpPaymentId,
                                    partialOrder.priceSummary.grandTotal,
                                    { reason: 'Automatic refund: Webhook fulfillment failure' },
                                );
                                partialOrder.refund = {
                                    status: 'PROCESSING',
                                    amount: partialOrder.priceSummary.grandTotal,
                                    razorpayRefundId: rzpRefund.id || '',
                                    initiatedAt: new Date(),
                                };
                                console.log(
                                    `[AUTO_REFUND] ✅ Webhook: Refund SUCCESS: Refund ID ${rzpRefund.id} initiated for Order #${partialOrder.orderNumber}`,
                                );
                            } catch (rfErr) {
                                partialOrder.refund = {
                                    status: 'PROCESSING',
                                    amount: partialOrder.priceSummary.grandTotal,
                                    failureReason: rfErr.message || 'Refund initiation pending',
                                    initiatedAt: new Date(),
                                };
                                console.error(
                                    `[AUTO_REFUND] ❌ Webhook: Auto-refund noted for Order #${partialOrder.orderNumber}: ${rfErr.message}`,
                                );
                            }
                        }

                        await partialOrder.save();
                        console.log(`[ORDER_STATUS] Webhook: Order #${partialOrder.orderNumber} dynamically updated to FAILED`);
                        notifyUserOrderFailed(partialOrder);
                    }
                }
            } catch (healErr) {
                console.error(`[PAYMENT_WEBHOOK] Error updating order to FAILED: ${healErr.message}`);
            }
        }
    } else if (event === 'payment.failed' && paymentEntity) {
        const rzpOrderId = paymentEntity.order_id;
        const rzpPaymentId = paymentEntity.id;
        const failureReason = paymentEntity.error_description || paymentEntity.error_reason || 'Payment failed on gateway';

        console.log(`[PAYMENT_WEBHOOK] Event payment.failed: Razorpay Order: ${rzpOrderId} | Payment: ${rzpPaymentId} | Reason: ${failureReason}`);

        try {
            const order = await PrintOrder.findOne({
                $or: [
                    { razorpayOrderId: rzpOrderId },
                    { razorpayPaymentId: rzpPaymentId },
                ],
            });

            if (order) {
                // CATCH SAFETY: NEVER mark an order as FAILED if it was already marked PAID or fulfilled by another method
                if (
                    order.paymentStatus === 'PAID' ||
                    ['RECEIVED', 'PROCESSED', 'DISPATCHED', 'DELIVERED'].includes(order.orderStatus)
                ) {
                    console.log(
                        `[CATCH_SAFETY] 🛡️ Webhook payment.failed: Order #${order.orderNumber} already exists with status: ${order.orderStatus} / ${order.paymentStatus}. Ignoring failed attempt.`,
                    );
                    return res.status(200).json({ status: 'ok', message: 'Order already fulfilled' });
                }

                if (!['CANCELLED', 'FAILED'].includes(order.orderStatus)) {
                    order.orderStatus = 'FAILED';
                    order.paymentStatus = 'FAILED';
                    order.statusHistory.push({
                        status: 'FAILED',
                        changedBy: null,
                        note: 'Payment failed on gateway: ' + failureReason,
                        changedAt: new Date(),
                    });

                    if (rzpPaymentId && order.priceSummary?.grandTotal > 0) {
                        try {
                            const rzpRefund = await rzpService.refundPayment(
                                rzpPaymentId,
                                order.priceSummary.grandTotal,
                                { reason: 'Automatic refund: ' + failureReason },
                            );
                            order.refund = {
                                status: 'PROCESSING',
                                amount: order.priceSummary.grandTotal,
                                razorpayRefundId: rzpRefund.id || '',
                                initiatedAt: new Date(),
                            };
                            console.log(`[AUTO_REFUND] Webhook refund initiated for Order #${order.orderNumber} (Refund ID: ${rzpRefund.id})`);
                        } catch (rfErr) {
                            order.refund = {
                                status: 'PROCESSING',
                                amount: order.priceSummary.grandTotal,
                                failureReason: rfErr.message || 'Refund initiation pending',
                                initiatedAt: new Date(),
                            };
                            console.error(`[AUTO_REFUND] Webhook auto-refund noted for Order #${order.orderNumber}: ${rfErr.message}`);
                        }
                    }

                    await order.save();
                    console.log(`[ORDER_STATUS] Order #${order.orderNumber} marked as FAILED due to payment.failed event`);
                    notifyUserOrderFailed(order, failureReason);
                }
            } else {
                console.log(`[PAYMENT_WEBHOOK] Event payment.failed: No local order created yet for Razorpay Order ${rzpOrderId}. Cart remains active.`);
            }
        } catch (failedErr) {
            console.error(`[PAYMENT_WEBHOOK] Error handling payment.failed event: ${failedErr.message}`);
        }
    } else if (event === 'refund.processed') {
        const refundEntity = payload?.refund?.entity;
        if (refundEntity?.id) {
            console.info(`[Razorpay Webhook] refund.processed for refund ${refundEntity.id}`);
            try {
                const order = await PrintOrder.findOne({ 'refund.razorpayRefundId': refundEntity.id });
                if (order && order.refund?.status !== 'PROCESSED') {
                    order.refund.status = 'PROCESSED';
                    order.refund.processedAt = new Date();
                    order.paymentStatus = 'REFUNDED';
                    await order.save();
                    console.info(`[Razorpay Webhook] Order #${order.orderNumber} marked REFUNDED.`);
                }
            } catch (err) {
                console.error(`[Razorpay Webhook] refund.processed handler failed:`, err.message);
            }
        }
    } else if (event === 'refund.failed') {
        const refundEntity = payload?.refund?.entity;
        if (refundEntity?.id) {
            console.warn(`[Razorpay Webhook] refund.failed for refund ${refundEntity.id}`);
            try {
                const order = await PrintOrder.findOne({ 'refund.razorpayRefundId': refundEntity.id });
                if (order && order.refund?.status !== 'PROCESSED') {
                    order.refund.status = 'FAILED';
                    order.refund.failureReason = 'Razorpay reported refund failure via webhook';
                    // Keep paymentStatus = 'PAID' to flag for manual reconciliation
                    await order.save();
                    console.warn(
                        `[Razorpay Webhook] Order #${order.orderNumber} refund failed — manual action required.`,
                    );
                }
            } catch (err) {
                console.error(`[Razorpay Webhook] refund.failed handler failed:`, err.message);
            }
        }
    }

    res.status(200).json({ status: 'ok' });
};

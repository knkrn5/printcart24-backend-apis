// services/razorpay.service.js
import Razorpay from 'razorpay';
import crypto from 'crypto';
import env from '#configs/env';

export const razorpayInstance = new Razorpay({
    key_id: env.RAZORPAY_KEY_ID,
    key_secret: env.RAZORPAY_KEY_SECRET,
});

/**
 * Creates a Razorpay Order
 */
export const createRzpOrder = async (amount, orderNumber) => {
    const options = {
        amount: Math.round(amount * 100), // convert to paise
        currency: 'INR',
        receipt: `rcpt_${orderNumber}`,
    };
    return await razorpayInstance.orders.create(options);
};

/**
 * Verifies Razorpay Signature
 */
export const verifyRzpSignature = (orderId, paymentId, signature) => {
    const body = `${orderId}|${paymentId}`;
    const expectedSignature = crypto
        .createHmac('sha256', env.RAZORPAY_KEY_SECRET)
        .update(body.toString())
        .digest('hex');
    return expectedSignature === signature;
};

/**
 * Fetch Payment details from Razorpay
 * @param {string} paymentId
 */
export const getPaymentDetails = async (paymentId) => {
    return await razorpayInstance.payments.fetch(paymentId);
};

/**
 * Initiate a full refund for a captured payment
 * @param {string} paymentId   - Razorpay payment ID (pay_...)
 * @param {number} amountInRupees - Amount to refund in INR (will be converted to paise)
 * @param {string|object} options - Unique receipt label or options object ({ reason, receipt, speed })
 * @returns {Promise<object>}  - Raw Razorpay refund object (rfnd_...)
 */
export const refundPayment = async (paymentId, amountInRupees, options = {}) => {
    const amountInPaise = Math.round(Number(amountInRupees) * 100);
    const receipt = typeof options === 'string' ? options : (options?.receipt || `rfnd_${Date.now()}`);
    const notes = typeof options === 'object' && options?.reason ? { reason: options.reason } : undefined;
    return await razorpayInstance.payments.refund(paymentId, {
        amount: amountInPaise,
        speed: options?.speed || 'normal',
        receipt,
        ...(notes && { notes }),
    });
};

export const createRzpRefund = refundPayment;

/**
 * Fetch the live status of an existing Razorpay refund
 * @param {string} refundId - Razorpay refund ID (rfnd_...)
 * @returns {Promise<object>} - Raw Razorpay refund object
 */
export const getRzpRefundStatus = async (refundId) => {
    return await razorpayInstance.refunds.fetch(refundId);
};

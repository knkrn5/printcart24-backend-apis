// services/sameDayRepeatDiscount.service.js
import moment from 'moment-timezone';
import PrintOrder from '#models/printOrder';

/**
 * Checks if a user has at least one qualifying order placed on the current IST calendar day.
 * Qualifying order: paymentStatus is 'PAID' or 'REFUNDED' (since a later refund must NOT retroactively
 * remove repeat-order eligibility established that day), and orderStatus is NOT 'CANCELLED'.
 *
 * @param {string|import('mongoose').Schema.Types.ObjectId} userId - User ID to check
 * @returns {Promise<boolean>} True if user is eligible for 5% same-day repeat customer discount
 */
export async function checkSameDayRepeatEligibility(userId) {
    if (!userId) return false;

    const startOfIstDay = moment().tz('Asia/Kolkata').startOf('day').toDate();
    const endOfIstDay = moment().tz('Asia/Kolkata').endOf('day').toDate();

    const qualifyingTodayOrdersCount = await PrintOrder.countDocuments({
        user: userId,
        createdAt: { $gte: startOfIstDay, $lte: endOfIstDay },
        paymentStatus: { $in: ['PAID', 'REFUNDED'] },
        orderStatus: { $ne: 'CANCELLED' },
    });

    return qualifyingTodayOrdersCount > 0;
}

/**
 * Calculates the same-day repeat customer discount amount using dynamic percentage (defaults to 5%).
 *
 * @param {number} baseAmount - Total taxable base/item amount
 * @param {number} [percentage=5] - Discount percentage rate
 * @returns {number} discount rounded to 2 decimals
 */
export function calculateSameDayRepeatDiscountAmount(baseAmount, percentage = 5) {
    const numericAmount = Number(baseAmount) || 0;
    const rate = Number(percentage) >= 0 ? Number(percentage) : 5;
    if (numericAmount <= 0 || rate <= 0) return 0;
    return Math.round(((numericAmount * rate) / 100) * 100) / 100;
}

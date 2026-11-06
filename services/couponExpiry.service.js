// services/couponExpiry.service.js
import Coupon from '#models/coupon';

/**
 * Finds all coupons that are still marked active but whose validUntil
 * date has passed, and sets them to isActive: false.
 * Called by the cron scheduler — do not call directly from controllers.
 */
export const deactivateExpiredCoupons = async () => {
    const now = new Date();
    const result = await Coupon.updateMany(
        { isActive: true, validUntil: { $lt: now } },
        { $set: { isActive: false } },
    );
    if (result.modifiedCount > 0) {
        console.log(`[CouponExpiry] Auto-deactivated ${result.modifiedCount} expired coupon(s).`);
    }
};

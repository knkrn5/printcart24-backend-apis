import httpStatus from 'http-status';
import { sendResponse } from '#utils/generalHelper';
import Coupon from '#models/coupon';
import Cart from '#models/cart';
import { adminListCouponsQuerySchema, adminCouponIdSchema, upsertCouponSchema } from '#validations/coupon';

export const adminCreateCoupon = async (req, res) => {
    const { error, value } = upsertCouponSchema.validate(req.body);
    if (error) {
        return sendResponse({ res, statusCode: httpStatus.BAD_REQUEST, message: error.details[0].message });
    }

    const existingCoupon = await Coupon.findOne({ code: value.code });
    if (existingCoupon) {
        return sendResponse({ res, statusCode: httpStatus.CONFLICT, message: 'Coupon with this code already exists' });
    }

    const coupon = await Coupon.create(value);

    return sendResponse({
        res,
        statusCode: httpStatus.CREATED,
        data: coupon,
        message: 'Coupon created successfully',
    });
};

export const adminUpdateCoupon = async (req, res) => {
    const { couponId } = req.params;
    const { error: paramsError, value: paramsValue } = adminCouponIdSchema.validate({ couponId });
    if (paramsError) {
        return sendResponse({ res, statusCode: httpStatus.BAD_REQUEST, message: paramsError.details[0].message });
    }

    const { error, value } = upsertCouponSchema.validate(req.body);
    if (error) {
        return sendResponse({ res, statusCode: httpStatus.BAD_REQUEST, message: error.details[0].message });
    }

    if (value.code) {
        const existingCoupon = await Coupon.findOne({ code: value.code, _id: { $ne: paramsValue.couponId } });
        if (existingCoupon) {
            return sendResponse({
                res,
                statusCode: httpStatus.CONFLICT,
                message: 'Coupon with this code already exists',
            });
        }
    }

    const coupon = await Coupon.findByIdAndUpdate(paramsValue.couponId, { $set: value }, { returnDocument: 'after' });

    if (!coupon) {
        return sendResponse({ res, statusCode: httpStatus.NOT_FOUND, message: 'Coupon not found' });
    }

    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        data: coupon,
        message: 'Coupon updated successfully',
    });
};

export const adminListCoupons = async (req, res) => {
    const { error, value } = adminListCouponsQuerySchema.validate(req.query);
    if (error) {
        return sendResponse({ res, statusCode: httpStatus.BAD_REQUEST, message: error.details[0].message });
    }

    const { page, limit, status, search } = value;
    const skip = (page - 1) * limit;

    const query = {};

    if (status === 1) {
        query.isActive = true;
    } else if (status === 2) {
        query.isActive = false;
    }

    if (search) {
        query.$or = [{ code: { $regex: search, $options: 'i' } }, { title: { $regex: search, $options: 'i' } }];
    }

    const [coupons, count, totalCoupons, activeCoupons, inactiveCoupons] = await Promise.all([
        Coupon.find(query)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .select(
                '-__v -maxDiscountAmount -minOrderValue -applicableServiceTypes -applicableServices -firstOrderOnly -usageLimit -usageLimitPerUser -autoApply',
            )
            .lean(),
        Coupon.countDocuments(query),
        Coupon.countDocuments({}),
        Coupon.countDocuments({ isActive: true }),
        Coupon.countDocuments({ isActive: false }),
    ]);

    const currentDate = new Date();
    const formattedCoupons = coupons.map((c) => {
        let couponStatus = c.isActive ? 'Active' : 'Inactive';

        if (c.isActive && c.validUntil && new Date(c.validUntil) < currentDate) {
            couponStatus = 'Expired';
        }

        return { ...c, couponStatus };
    });

    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        data: {
            coupons: formattedCoupons,
            couponCounts: { total: totalCoupons, active: activeCoupons, inactive: inactiveCoupons },
            count,
        },
        message: 'Coupons fetched successfully',
    });
};

export const adminGetCouponById = async (req, res) => {
    const { error, value } = adminCouponIdSchema.validate(req.params);
    if (error) {
        return sendResponse({ res, statusCode: httpStatus.BAD_REQUEST, message: error.details[0].message });
    }

    const coupon = await Coupon.findById(value.couponId).lean();
    if (!coupon) {
        return sendResponse({ res, statusCode: httpStatus.NOT_FOUND, message: 'Coupon not found' });
    }

    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        data: coupon,
        message: 'Coupon details fetched successfully',
    });
};

export const adminDeleteCoupon = async (req, res) => {
    const { error, value } = adminCouponIdSchema.validate(req.params);
    if (error) {
        return sendResponse({ res, statusCode: httpStatus.BAD_REQUEST, message: error.details[0].message });
    }

    const coupon = await Coupon.findByIdAndDelete(value.couponId);
    if (!coupon) {
        return sendResponse({ res, statusCode: httpStatus.NOT_FOUND, message: 'Coupon not found' });
    }

    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        message: 'Coupon deleted successfully',
    });
};

export const adminUpdateCouponStatus = async (req, res) => {
    const { error, value } = adminCouponIdSchema.validate(req.params);

    if (error) {
        return sendResponse({ res, statusCode: httpStatus.BAD_REQUEST, message: error.details[0].message });
    }

    const existing = await Coupon.findById(value.couponId).select('isActive validUntil');

    if (!existing) {
        return sendResponse({ res, statusCode: httpStatus.NOT_FOUND, message: 'Coupon not found' });
    }

    const newStatus = !existing.isActive;

    if (newStatus === true && existing.validUntil && existing.validUntil < new Date()) {
        return sendResponse({
            res,
            statusCode: httpStatus.BAD_REQUEST,
            message: `Cannot activate an expired coupon. Please increase the End Date to reactivate it.`,
        });
    }

    const coupon = await Coupon.findByIdAndUpdate(
        value.couponId,
        { $set: { isActive: newStatus } },
        { returnDocument: 'after' },
    ).select('_id isActive updatedAt');

    const statusLabel = newStatus ? 'activated' : 'deactivated';

    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        message: `Coupon ${statusLabel} successfully`,
        data: { _id: coupon._id, isActive: coupon.isActive, updatedAt: coupon.updatedAt },
    });
};

export const listActiveCoupons = async (req, res) => {
    const currentDate = new Date();
    const query = {
        isActive: true,
        $and: [
            { $or: [{ validFrom: null }, { validFrom: { $lte: currentDate } }] },
            { $or: [{ validUntil: null }, { validUntil: { $gte: currentDate } }] },
        ],
    };

    const userId = req.user?.id; // set by verifyUserToken middleware

    const [coupons, count, activeCart] = await Promise.all([
        Coupon.find(query)
            .sort({ createdAt: -1 })
            .select('code title description discountType discountValue validFrom validUntil usageLimit timesRedeemed')
            .lean(),
        Coupon.countDocuments(query),
        userId
            ? Cart.findOne({ user: userId, status: 'ACTIVE' }).select('appliedCoupon').lean()
            : Promise.resolve(null),
    ]);

    // Optionally filter out those that have exceeded usageLimit globally
    const validCoupons = coupons.filter((c) => !c.usageLimit || c.timesRedeemed < c.usageLimit);

    const appliedCouponCode = activeCart?.appliedCoupon?.code || null;

    const finalCoupons = validCoupons.map((c) => {
        let title = c.title;
        if (c.discountType === 'PERCENT') title = `${c.discountValue}% OFF`;
        else if (c.discountType === 'FIXED') title = `Rs ${c.discountValue} OFF`;
        else if (c.discountType === 'FREE_DELIVERY') title = 'FREE DELIVERY';

        return {
            _id: c._id,
            code: c.code,
            title,
            description: c.description,
            discountType: c.discountType,
            discountValue: c.discountValue,
            validFrom: c.validFrom || null,
            validUntil: c.validUntil || null,
            isApplied: appliedCouponCode === c.code,
        };
    });

    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        data: { data: finalCoupons, count: finalCoupons.length },
        message: 'Coupons fetched successfully',
    });
};

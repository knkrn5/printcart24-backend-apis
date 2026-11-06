// controllers/users.controller.js
import httpStatus from 'http-status';
import User from '#models/user';
import PrintOrder from '#models/printOrder';
import { sendResponse } from '#utils/generalHelper';
import { adminListUsersQuerySchema, adminUserParamsSchema } from '#validations/user';

// ─── Admin User Controllers ──────────────────────────────────────────────────

const getFullName = (user = {}) => {
    const { firstName = '', lastName = '' } = user;

    return [firstName, lastName]
        .filter(Boolean) // removes empty/null/undefined
        .join(' ')
        .trim();
};

function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * List Users (paginated + filterable)
 * @route GET /api/admin/users
 * @access Private (Admin)
 */
export const adminListUsers = async (req, res) => {
    const { error, value } = adminListUsersQuerySchema.validate(req.query);

    if (error) {
        return sendResponse({ res, statusCode: httpStatus.BAD_REQUEST, message: error.details[0].message });
    }

    const { page, limit, search, status } = value;
    const skip = (page - 1) * limit;

    // Base filter — never show deleted users
    const filter = { isDeleted: false };

    // status: 1 = active, 2 = inactive
    if (status === 1) filter.isActive = true;
    if (status === 2) filter.isActive = false;

    // if search is passed, include in filter
    // Search by Full Name, Phone Number (raw / with country code), Email
    if (search?.trim()) {
        const searchString = search.trim();
        const escapedSearch = escapeRegExp(searchString);
        const regex = { $regex: escapedSearch, $options: 'i' };

        // Strip all whitespace for phone number checks (e.g. "+91 98765 43210" -> "+919876543210")
        const searchNoSpaces = searchString.replace(/\s+/g, '');
        const escapedSearchNoSpaces = escapeRegExp(searchNoSpaces);
        const regexNoSpaces = { $regex: escapedSearchNoSpaces, $options: 'i' };

        filter.$or = [
            { fullName: regex },
            { email: regex },
            { phone: regexNoSpaces },
            {
                $expr: {
                    $regexMatch: {
                        input: { $concat: [{ $ifNull: ["$countryCode", ""] }, { $ifNull: ["$phone", ""] }] },
                        regex: escapedSearchNoSpaces,
                        options: "i"
                    }
                }
            }
        ];
    }

    const [users, count, totalUsers, activeUsers, inactiveUsers] = await Promise.all([
        User.find(filter)
            .select('-password -fcmToken -__v -googleId -appleId -addresses')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean(),
        User.countDocuments(filter),
        User.countDocuments({ isDeleted: false }),
        User.countDocuments({ isActive: true, isDeleted: false }),
        User.countDocuments({ isActive: false, isDeleted: false }),
    ]);

    // Prepare Final User Map with required fields
    const finalUserMap = users.map((user) => {
        return {
            _id: user._id,
            fullName: getFullName(user),
            email: user.email,
            fullPhone: (user.countryCode && user.phone) ? `${user.countryCode} ${user.phone}` : '',
            gender: user.gender,
            profilePicture: user.profilePicture,
            isActive: user.isActive,
            isDeleted: user.isDeleted,
            createdAt: user.createdAt,
            updatedAt: user.updatedAt,
        };
    });

    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        message: 'Users fetched successfully',
        data: {
            users: finalUserMap,
            userCounts: { total: totalUsers, active: activeUsers, inactive: inactiveUsers },
            count,
        },
    });
};

/**
 * Get Single User Detail
 * @route GET /api/admin/users/:userId
 * @access Private (Admin)
 */
export const adminGetUserById = async (req, res) => {
    const { error, value } = adminUserParamsSchema.validate(req.params);

    if (error) {
        return sendResponse({ res, statusCode: httpStatus.BAD_REQUEST, message: error.details[0].message });
    }

    const [user, orders] = await Promise.all([
        // isDeleted: false guard — a soft-deleted user should not be accessible from admin panel
        User.findOne({ _id: value.userId, isDeleted: false }).select('-password -fcmToken -__v').lean(),
        PrintOrder.find({ user: value.userId })
            .select('_id orderNumber orderStatus priceSummary items stationeryItems createdAt')
            .sort({ createdAt: -1 })
            .lean(),
    ]);

    if (!user) {
        return sendResponse({ res, statusCode: httpStatus.NOT_FOUND, message: 'User not found' });
    }

    const finalUser = {
        _id: user._id,
        fullName: getFullName(user),
        authProvider: user.authProvider,
        email: user.email,
        fullPhone: (user.countryCode && user.phone) ? `${user.countryCode} ${user.phone}` : '',
        gender: user.gender,
        profilePicture: user.profilePicture,
        isActive: user.isActive,
        isDeleted: user.isDeleted,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
    };

    const formattedOrders = orders.map((order) => {
        const formattedItems = (order.items || []).map((item) => {
            const isStationery = item.serviceSnapshot?.serviceType === 'STATIONERY';
            const baseItem = {
                itemType: isStationery ? 'STATIONERY' : 'PRINT_SERVICE',
                name: item.serviceSnapshot?.name || 'Unknown Item',
                quantity: item.customization?.copies || 1,
                amount: item.priceSummary?.totalAmount || 0,
            };

            if (!isStationery) {
                const c = item.customization || {};
                const options = [
                    c.paperSize,
                    c.colorMode,
                    c.sideMode,
                    c.paperQuality,
                    c.stickBindingEnabled ? 'Stick Binding' : null,
                    c.spiralBindingEnabled ? 'Spiral Binding' : null,
                    c.staplingEnabled ? 'Stapled' : null,
                    ...(c.bookletOptionCodes || []),
                ].filter(Boolean);

                if (options.length > 0) {
                    baseItem.optionsSummary = options.join(', ');
                }
            }

            return baseItem;
        });

        const formattedStationeryItems = (order.stationeryItems || []).map((item) => ({
            itemType: 'STATIONERY',
            name: item.itemSnapshot?.name || 'Unknown Item',
            quantity: item.quantity || 1,
            amount: item.priceSummary?.totalAmount || 0,
        }));

        const allFormattedItems = [...formattedItems, ...formattedStationeryItems];

        return {
            orderId: order._id,
            orderNumber: order.orderNumber,
            status: order.orderStatus,
            grandTotal: order.priceSummary?.grandTotal || 0,
            createdAt: order.createdAt,
            totalItems: allFormattedItems.length,
            items: allFormattedItems,
        };
    });

    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        message: 'User details and orders fetched successfully',
        data: {
            user: finalUser,
            orderDetail: formattedOrders,
        },
    });
};

/**
 * Activate / Deactivate a User
 * @route PATCH /api/admin/users/:userId/status
 * @access Private (Admin)
 */
export const adminUpdateUserStatus = async (req, res) => {
    const { error, value } = adminUserParamsSchema.validate(req.params);

    if (error) {
        return sendResponse({ res, statusCode: httpStatus.BAD_REQUEST, message: error.details[0].message });
    }

    // Fetch current status first
    const existing = await User.findOne({ _id: value.userId, isDeleted: false }).select('isActive');

    if (!existing) {
        return sendResponse({ res, statusCode: httpStatus.NOT_FOUND, message: 'User not found' });
    }

    // Invert the current status
    const newStatus = !existing.isActive;

    const user = await User.findByIdAndUpdate(
        value.userId,
        { $set: { isActive: newStatus } },
        { returnDocument: 'after' },
    ).select('_id isActive updatedAt');

    const statusLabel = newStatus ? 'activated' : 'deactivated';

    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        message: `User ${statusLabel} successfully`,
        data: { _id: user._id, isActive: user.isActive, updatedAt: user.updatedAt },
    });
};

/**
 * Soft-Delete a User
 * @route DELETE /api/admin/users/:userId
 * @access Private (Admin)
 */
export const adminSoftDeleteUser = async (req, res) => {
    const { error, value } = adminUserParamsSchema.validate(req.params);

    if (error) {
        return sendResponse({ res, statusCode: httpStatus.BAD_REQUEST, message: error.details[0].message });
    }

    const user = await User.findOne({ _id: value.userId, isDeleted: false });

    if (!user) {
        return sendResponse({ res, statusCode: httpStatus.NOT_FOUND, message: 'User not found' });
    }

    // Anonymize credentials to release unique constraints
    if (user.phone && !user.phone.startsWith('deleted_')) {
        user.phone = `deleted_${user._id}_${user.phone}`;
    }
    if (user.email && !user.email.startsWith('deleted_')) {
        user.email = `deleted_${user._id}_${user.email}`;
    }
    if (user.googleId && !user.googleId.startsWith('deleted_')) {
        user.googleId = `deleted_${user._id}_${user.googleId}`;
    }
    if (user.appleId && !user.appleId.startsWith('deleted_')) {
        user.appleId = `deleted_${user._id}_${user.appleId}`;
    }

    user.isDeleted = true;
    user.isActive = false;
    user.fcmToken = '';

    await user.save();

    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        message: 'User deleted successfully',
        data: { _id: user._id, isDeleted: user.isDeleted, updatedAt: user.updatedAt },
    });
};

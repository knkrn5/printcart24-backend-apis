// controllers/admin.controller.js
import Admin from '#models/admin';
import User from '#models/user';
import PrintOrder from '#models/printOrder';
import httpStatus from 'http-status';
import { isValidObjectId, sendResponse } from '#utils/generalHelper';
import { adminLoginSchema, changePasswordSchema, updateAdminProfileSchema } from '#validations/admin';

/**
 * Admin Login
 * @route POST /api/admin/login
 */
export const adminLogin = async (req, res) => {
    const { error, value } = adminLoginSchema.validate(req.body);
    if (error) {
        return sendResponse({
            res,
            statusCode: httpStatus.BAD_REQUEST,
            message: error.details[0].message,
        });
    }

    const { email, password } = value;

    // 1. Find Admin
    const admin = await Admin.findOne({ email, isDeleted: false });
    // If account not found
    if (!admin) {
        return sendResponse({
            res,
            statusCode: httpStatus.UNAUTHORIZED,
            message: 'Account does not exist',
        });
    }

    // 2. Check if active
    if (!admin.isActive) {
        return sendResponse({
            res,
            statusCode: httpStatus.FORBIDDEN,
            message: 'Your account is inactive. Please contact system administrator.',
        });
    }

    // 3. Verify Password
    const isPasswordMatch = await admin.comparePassword(password);
    if (!isPasswordMatch) {
        return sendResponse({
            res,
            statusCode: httpStatus.UNAUTHORIZED,
            message: 'Invalid password',
        });
    }

    // 4. Generate Token
    const token = admin.generateAccessToken();

    // 5. Stamp last login time
    admin.lastLoginAt = new Date();
    await admin.save();

    // 6. Build Response
    const result = {
        id: admin._id,
        fullName: admin.fullName,
        email: admin.email,
        role: admin.role,
        lastLoginAt: admin.lastLoginAt,
    };

    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        data: result,
        message: 'Login successful.',
        token,
    });
};

/**
 * Admin Logout
 * @route POST /api/admin/logout
 * @access Private
 */
export const adminLogout = async (req, res) => {
    // Since JWT is stateless, server-side logout usually involves the client clearing the token.
    // Optionally, you could implement a token blacklist here.
    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        message: 'Logout successful.',
    });
};

/**
 * Change Admin Password
 * @route POST /api/admin/change-password
 * @access Private
 */
export const changeAdminPassword = async (req, res) => {
    // 1. Validation
    const { error, value } = changePasswordSchema.validate(req.body);
    if (error) {
        return sendResponse({
            res,
            statusCode: httpStatus.BAD_REQUEST,
            message: error.details[0].message,
        });
    }

    const { oldPassword, newPassword } = value;

    // 2. Find Admin
    const admin = await Admin.findById(req.user.id);
    if (!admin) {
        return sendResponse({
            res,
            statusCode: httpStatus.NOT_FOUND,
            message: 'Admin not found.',
        });
    }

    // 3. Verify Old Password
    const isPasswordMatch = await admin.comparePassword(oldPassword);
    if (!isPasswordMatch) {
        return sendResponse({
            res,
            statusCode: httpStatus.UNAUTHORIZED,
            message: 'Invalid current password.',
        });
    }

    // 4. Update Password
    admin.password = newPassword;
    await admin.save();

    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        message: 'Password changed successfully.',
    });
};

/**
 * Get Own Admin Profile
 * @route GET /api/admin/profile
 * @access Private (All Admin Roles)
 */
export const getAdminProfile = async (req, res) => {
    const admin = await Admin.findById(req.user.id).select('-password -__v');

    if (!admin) {
        return sendResponse({
            res,
            statusCode: httpStatus.NOT_FOUND,
            message: 'Admin profile not found.',
        });
    }

    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        data: admin,
        message: 'Profile fetched successfully.',
    });
};

/**
 * Update Own Admin Profile
 * @route PATCH /api/admin/profile
 * @access Private (All Admin Roles)
 */
export const updateAdminProfile = async (req, res) => {
    // 1. Validate body
    const { error, value } = updateAdminProfileSchema.validate(req.body);
    if (error) {
        return sendResponse({
            res,
            statusCode: httpStatus.BAD_REQUEST,
            message: error.details[0].message,
        });
    }

    // 2. Build flat dot-notation update object
    const updateFields = {};

    const topLevelFields = ['fullName', 'phone', 'email', 'profilePicture'];
    topLevelFields.forEach((field) => {
        if (value[field] !== undefined) {
            updateFields[field] = value[field];
        }
    });

    // 3. Apply update
    const updatedAdmin = await Admin.findByIdAndUpdate(
        req.user.id,
        { $set: updateFields },
        { returnDocument: 'after', runValidators: true },
    ).select('-password -__v');

    if (!updatedAdmin) {
        return sendResponse({
            res,
            statusCode: httpStatus.NOT_FOUND,
            message: 'Admin profile not found.',
        });
    }

    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        data: updatedAdmin,
        message: 'Profile updated successfully.',
    });
};

// ─── Dashboard Stats ─────────────────────────────────────────────────────────

/**
 * Admin Dashboard Stats
 * @route GET /api/admin/dashboard/stats
 * @access Private (Admin)
 */
export const adminGetDashboardStats = async (req, res) => {
    const [totalUsers, activeUsers, inactiveUsers, totalOrders, completedOrders, cancelledOrders] = await Promise.all([
        User.countDocuments({ isDeleted: false }),
        User.countDocuments({ isActive: true, isDeleted: false }),
        User.countDocuments({ isActive: false, isDeleted: false }),
        PrintOrder.countDocuments({}),
        PrintOrder.countDocuments({ orderStatus: 'DELIVERED' }),
        PrintOrder.countDocuments({ orderStatus: 'CANCELLED' }),
    ]);

    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        message: 'Dashboard stats fetched successfully',
        data: {
            users: {
                total: totalUsers,
                active: activeUsers,
                inactive: inactiveUsers,
            },
            orders: {
                total: totalOrders,
                completed: completedOrders,
                cancelled: cancelledOrders,
            },
        },
    });
};

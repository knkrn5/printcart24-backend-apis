// middlewares/admin.middleware.js
import httpStatus from 'http-status';
import Admin from '#models/admin';

/**
 * Middleware to check if the authenticated user is an Admin
 */
export const isAdmin = async (req, res, next) => {
    try {
        // If verifyUserToken already decoded and attached user, check role
        // However, admins might be in a different table.
        // Let's check if the ID exists in the Admin collection.

        const admin = await Admin.findById(req.user.id);

        if (!admin || admin.isDeleted || !admin.isActive) {
            return next({
                status: httpStatus.FORBIDDEN,
                message: 'Access denied. Admin privileges required.',
            });
        }

        // Attach admin object to request if needed
        req.user = admin;
        next();
    } catch (error) {
        next(error);
    }
};

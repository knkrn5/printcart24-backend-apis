// middlewares/partnerAuth.middleware.js
import jwt from 'jsonwebtoken';
import httpStatus from 'http-status';
import env from '#configs/env';
import Partner from '#models/partner';

/**
 * ### Verifies a Partner's JWT token and validates account status.
 */
export const verifyPartnerToken = async (req, res, next) => {
    try {
        // 1. Extract Bearer token
        const authHeader = req.headers['authorization'] || req.headers['token'];
        const token = authHeader?.startsWith('Bearer ') ? authHeader.split(' ')[1] : authHeader;

        if (!token) {
            return next({
                status: httpStatus.UNAUTHORIZED,
                message: 'Authentication required. Please login.',
            });
        }

        // 2. Verify JWT using secret
        const decoded = jwt.verify(token, env.ACCESS_TOKEN_SECRET);

        // 3. Verify role in token
        if (decoded.role !== 'rider') {
            return next({
                status: httpStatus.FORBIDDEN,
                message: 'Access denied. Partner privileges required.',
            });
        }

        // 4. Load fresh Partner from database
        const partner = await Partner.findById(decoded.id).select('_id role accountStatus isActive isDeleted');

        if (!partner || partner.isDeleted) {
            return next({
                status: httpStatus.UNAUTHORIZED,
                message: 'Invalid session. Please login again.',
            });
        }

        // 5. Account status checks
        if (!partner.isActive) {
            return next({
                status: httpStatus.FORBIDDEN,
                message: 'Partner account is inactive. Please contact support.',
            });
        }

        if (partner.accountStatus === 'PENDING') {
            return next({
                status: httpStatus.FORBIDDEN,
                message: 'Your account is pending admin verification/activation.',
            });
        }

        if (partner.accountStatus !== 'ACTIVE') {
            return next({
                status: httpStatus.FORBIDDEN,
                message: `Your account is currently ${partner.accountStatus.toLowerCase()}. Access denied.`,
            });
        }

        // 6. Attach authenticated Partner context
        req.user = {
            id: partner._id,
            role: partner.role,
            accountStatus: partner.accountStatus,
        };

        next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return next({
                status: httpStatus.UNAUTHORIZED,
                message: 'Session expired. Please login again.',
            });
        }

        if (error.name === 'JsonWebTokenError') {
            return next({
                status: httpStatus.UNAUTHORIZED,
                message: 'Invalid authentication token.',
            });
        }

        next(error);
    }
};

/**
 * ### Authorization check to ensure the authenticated user has the 'rider' role.
 */
export const isRider = (req, res, next) => {
    if (req.user?.role !== 'rider') {
        return next({
            status: httpStatus.FORBIDDEN,
            message: 'Access denied. Rider role required.',
        });
    }
    next();
};

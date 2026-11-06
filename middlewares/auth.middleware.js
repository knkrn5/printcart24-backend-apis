// middlewares/auth.middleware.js
import jwt from 'jsonwebtoken';
import httpStatus from 'http-status';
import User from '#models/user';
import Admin from '#models/admin';
import Partner from '#models/partner';
import env from '#configs/env';

/**
 * ### Verifies a user's JWT token.
 */
export const verifyUserToken = async (req, res, next) => {
    try {
        // 1. Extract token (Authorization: Bearer <token>)
        const authHeader = req.headers['authorization'] || req.headers['token'] || req.headers['token']?.split('=')[1];
        const token = authHeader?.startsWith('Bearer ') ? authHeader.split(' ')[1] : authHeader;

        if (!token) {
            return next({
                status: httpStatus.UNAUTHORIZED,
                message: 'Authentication required. Please login.',
            });
        }

        // 2. Verify JWT
        const decoded = jwt.verify(token, env.ACCESS_TOKEN_SECRET);

        // 3. Fetch user (fresh from DB, not trusting token blindly)
        const user = await User.findById(decoded.id).select('_id role isActive isDeleted isPhoneVerified authProvider');

        if (!user) {
            return next({
                status: httpStatus.UNAUTHORIZED,
                message: 'Invalid session. Please login again.',
            });
        }

        // 4. Account status checks
        if (user.isDeleted) {
            return next({
                status: httpStatus.GONE,
                message: 'Your account has been permanently deleted. Please contact support for assistance.',
                errorKey: 'ACCOUNT_DELETED_PERMANENT',
            });
        }

        if (!user.isActive) {
            return next({
                status: httpStatus.FORBIDDEN,
                message: 'Account is inactive. Contact support.',
                errorKey: 'ACCOUNT_INACTIVE',
            });
        }

        // 5. Enforce phone verification ONLY for PHONE-based accounts
        // Google and Apple users are allowed to access the app and manage profile without a phone.
        if (user.authProvider !== 'GOOGLE' && user.authProvider !== 'APPLE' && !user.isPhoneVerified) {
            return next({
                status: httpStatus.FORBIDDEN,
                message: 'Phone number not verified.',
            });
        }

        // 5. Attach minimal user context
        req.user = {
            id: user._id,
            role: user.role,
            authProvider: user.authProvider,
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
 * ### Verifies an Admin's JWT token.
 */
export const verifyAdminToken = async (req, res, next) => {
    try {
        // 1. Extract token
        const authHeader = req.headers.authorization;
        const token = authHeader?.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;

        if (!token) {
            return next({
                status: httpStatus.UNAUTHORIZED,
                message: 'Authentication required. Please login again.',
            });
        }

        // 2. Verify JWT
        const decoded = jwt.verify(token, env.ACCESS_TOKEN_SECRET);

        // 3. Role validation (decoded should have role: 'ADMIN')
        if (decoded.role !== 'SUPER_ADMIN') {
            return next({
                status: httpStatus.FORBIDDEN,
                message: 'Access denied. SUPER_ADMIN privileges required.',
            });
        }

        // 4. Fetch admin
        const admin = await Admin.findById(decoded.id).select('_id role permissions isActive isDeleted');

        if (!admin || admin.isDeleted) {
            return next({
                status: httpStatus.UNAUTHORIZED,
                message: 'Invalid session. Please login again.',
            });
        }

        if (!admin.isActive) {
            return next({
                status: httpStatus.FORBIDDEN,
                message: 'Admin account is inactive.',
            });
        }

        // 5. Attach admin context
        req.user = {
            id: admin._id,
            role: admin.role,
            permissions: admin.permissions || [],
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

export const verifyAnyToken = async (req, res, next) => {
    try {
        // 1. Extract token (same logic as verifyUserToken)
        const authHeader = req.headers['authorization'] || req.headers['token'] || req.headers['token']?.split('=')[1];
        const token = authHeader?.startsWith('Bearer ') ? authHeader.split(' ')[1] : authHeader;

        if (!token) {
            return next({
                status: httpStatus.UNAUTHORIZED,
                message: 'Authentication required. Please login.',
            });
        }

        // 2. Verify JWT
        const decoded = jwt.verify(token, env.ACCESS_TOKEN_SECRET);

        /**
         * 3. Admin Flow (STRICT)
         * Only SUPER_ADMIN allowed (aligned with verifyAdminToken)
         */
        if (decoded.role === 'SUPER_ADMIN') {
            const admin = await Admin.findById(decoded.id).select('_id role permissions isActive isDeleted');

            if (!admin) {
                return next({
                    status: httpStatus.UNAUTHORIZED,
                    message: 'Invalid session. Please login again.',
                });
            }

            if (admin.isDeleted) {
                return next({
                    status: httpStatus.GONE,
                    message: 'Admin account has been deleted.',
                    errorKey: 'ACCOUNT_DELETED_PERMANENT',
                });
            }

            if (!admin.isActive) {
                return next({
                    status: httpStatus.FORBIDDEN,
                    message: 'Admin account is inactive.',
                    errorKey: 'ACCOUNT_INACTIVE',
                });
            }

            req.user = {
                id: admin._id,
                role: admin.role,
                permissions: admin.permissions || [],
            };

            return next();
        }

        /**
         * 4. Partner / Rider Flow
         */
        if (decoded.role === 'rider') {
            const partner = await Partner.findById(decoded.id).select('_id role accountStatus isActive isDeleted');

            if (!partner || partner.isDeleted) {
                return next({
                    status: httpStatus.UNAUTHORIZED,
                    message: 'Invalid session. Please login again.',
                });
            }

            if (!partner.isActive) {
                return next({
                    status: httpStatus.FORBIDDEN,
                    message: 'Partner account is inactive. Please contact support.',
                });
            }

            if (partner.accountStatus !== 'ACTIVE') {
                return next({
                    status: httpStatus.FORBIDDEN,
                    message: `Your account is currently ${partner.accountStatus.toLowerCase()}. Please contact support.`,
                });
            }

            req.user = {
                id: partner._id,
                role: partner.role,
            };

            return next();
        }

        /**
         * 5. User Flow (STRICT)
         */
        const user = await User.findById(decoded.id).select(
            '_id role isActive isDeleted isPhoneVerified patientId authProvider',
        );

        if (!user) {
            return next({
                status: httpStatus.UNAUTHORIZED,
                message: 'Invalid session. Please login again.',
            });
        }

        if (user.isDeleted) {
            return next({
                status: httpStatus.GONE,
                message: 'Your account has been permanently deleted. Please contact support.',
                errorKey: 'ACCOUNT_DELETED_PERMANENT',
            });
        }

        if (!user.isActive) {
            return next({
                status: httpStatus.FORBIDDEN,
                message: 'Account is inactive. Contact support.',
                errorKey: 'ACCOUNT_INACTIVE',
            });
        }

        if (user.authProvider !== 'GOOGLE' && user.authProvider !== 'APPLE' && !user.isPhoneVerified) {
            return next({
                status: httpStatus.FORBIDDEN,
                message: 'Phone number not verified.',
            });
        }

        req.user = {
            id: user._id,
            role: user.role,
            patientId: user.patientId,
            authProvider: user.authProvider,
        };

        return next();
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

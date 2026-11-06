// controllers/partnerAuth.controller.js
import Partner from '#models/partner';
import httpStatus from 'http-status';
import { sendResponse } from '#utils/generalHelper';
import {
    partnerLoginSchema,
    partnerRegisterSchema,
    updatePartnerProfileSchema,
    updatePartnerFidSchema,
    updatePartnerFcmTokenSchema,
} from '#validations/partnerAuth';

/**
 * Partner Registration
 * @route POST /api/partner/auth/register
 */
export const registerPartner = async (req, res) => {
    const { error, value } = partnerRegisterSchema.validate(req.body);
    if (error) {
        return sendResponse({
            res,
            statusCode: httpStatus.BAD_REQUEST,
            message: error.details[0].message,
        });
    }

    const { firstName, lastName, email, password, phone, countryCode } = value;

    // 1. Check duplicate email
    const existingEmail = await Partner.findOne({ email });
    if (existingEmail) {
        return sendResponse({
            res,
            statusCode: httpStatus.CONFLICT,
            message: 'Email is already registered.',
        });
    }

    // 2. Check duplicate phone (only if phone is provided)
    if (phone) {
        const existingPhone = await Partner.findOne({ phone });
        if (existingPhone) {
            return sendResponse({
                res,
                statusCode: httpStatus.CONFLICT,
                message: 'Phone number is already registered.',
            });
        }
    }

    // 3. Create Partner account (starts as PENDING by default)
    const partnerData = {
        firstName,
        lastName: lastName || '',
        email,
        password,
        role: 'rider',
        accountStatus: 'PENDING',
        isActive: true,
        isDeleted: false,
    };
    if (phone) partnerData.phone = phone;
    if (countryCode) partnerData.countryCode = countryCode;
    if (value.profilePicture !== undefined) partnerData.profilePicture = value.profilePicture;
    if (value.gender !== undefined) partnerData.gender = value.gender;

    const partner = await Partner.create(partnerData);

    const responseData = {
        _id: partner._id,
        firstName: partner.firstName,
        lastName: partner.lastName,
        fullName: partner.fullName,
        email: partner.email,
        phone: partner.phone,
        countryCode: partner.countryCode,
        role: partner.role,
        accountStatus: partner.accountStatus,
        profilePicture: partner.profilePicture || '',
        gender: partner.gender || '',
        isPhoneVerified: partner.isPhoneVerified,
        isEmailVerified: partner.isEmailVerified,
        createdAt: partner.createdAt,
    };

    return sendResponse({
        res,
        statusCode: httpStatus.CREATED,
        data: responseData,
        message: 'Partner account registered successfully. Pending admin approval.',
    });
};

/**
 * Partner Login (Email + Password)
 * @route POST /api/partner/auth/login
 */
export const loginPartner = async (req, res) => {
    const { error, value } = partnerLoginSchema.validate(req.body);
    if (error) {
        return sendResponse({
            res,
            statusCode: httpStatus.BAD_REQUEST,
            message: error.details[0].message,
        });
    }

    const { email, password } = value;

    // 1. Find Partner by email
    const partner = await Partner.findOne({ email, isDeleted: false }).select('+password');
    if (!partner) {
        return sendResponse({
            res,
            statusCode: httpStatus.UNAUTHORIZED,
            message: 'Invalid email or password.',
        });
    }

    // 2. Compare Password
    const isPasswordMatch = await partner.comparePassword(password);
    if (!isPasswordMatch) {
        return sendResponse({
            res,
            statusCode: httpStatus.UNAUTHORIZED,
            message: 'Invalid email or password.',
        });
    }

    // 3. Verify Role
    if (partner.role !== 'rider') {
        return sendResponse({
            res,
            statusCode: httpStatus.FORBIDDEN,
            message: 'Access denied. Rider role required.',
        });
    }

    // 4. Verify active status
    if (!partner.isActive) {
        return sendResponse({
            res,
            statusCode: httpStatus.FORBIDDEN,
            message: 'Account is inactive. Please contact support.',
        });
    }

    // 5. Verify account approval status
    if (partner.accountStatus === 'PENDING') {
        return sendResponse({
            res,
            statusCode: httpStatus.FORBIDDEN,
            message: 'Your account is pending admin verification/activation.',
        });
    }

    if (partner.accountStatus !== 'ACTIVE') {
        return sendResponse({
            res,
            statusCode: httpStatus.FORBIDDEN,
            message: `Your account is currently ${partner.accountStatus.toLowerCase()}. Please contact support.`,
        });
    }

    // 6. Generate Access Token
    const token = partner.generateAccessToken();

    const responseData = {
        _id: partner._id,
        firstName: partner.firstName,
        lastName: partner.lastName,
        fullName: partner.fullName,
        email: partner.email,
        phone: partner.phone,
        role: partner.role,
        accountStatus: partner.accountStatus,
        profilePicture: partner.profilePicture || '',
        gender: partner.gender || '',
    };

    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        data: responseData,
        message: 'Login successful.',
        token,
    });
};

/**
 * Fetch Partner Profile
 * @route GET /api/partner/auth/profile
 */
export const getPartnerProfile = async (req, res) => {
    const partner = await Partner.findById(req.user.id).select('-password -__v');

    if (!partner) {
        return sendResponse({
            res,
            statusCode: httpStatus.NOT_FOUND,
            message: 'Partner profile not found.',
        });
    }

    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        data: partner,
        message: 'Partner profile fetched successfully.',
    });
};

/**
 * Update Partner Profile
 * @route PATCH /api/partner/auth/profile
 */
export const updatePartnerProfile = async (req, res) => {
    const { error, value } = updatePartnerProfileSchema.validate(req.body, { stripUnknown: true });
    if (error) {
        return sendResponse({
            res,
            statusCode: httpStatus.BAD_REQUEST,
            message: error.details[0].message,
        });
    }

    const partner = await Partner.findById(req.user.id);
    if (!partner) {
        return sendResponse({
            res,
            statusCode: httpStatus.NOT_FOUND,
            message: 'Partner profile not found.',
        });
    }

    // Check unique phone if phone is updated and changed
    if (value.phone && value.phone !== partner.phone) {
        const existingPhone = await Partner.findOne({ phone: value.phone, _id: { $ne: req.user.id } });
        if (existingPhone) {
            return sendResponse({
                res,
                statusCode: httpStatus.CONFLICT,
                message: 'Phone number is already registered by another account.',
            });
        }
        partner.phone = value.phone;
    }

    if (value.firstName !== undefined) partner.firstName = value.firstName;
    if (value.lastName !== undefined) partner.lastName = value.lastName;
    if (value.countryCode !== undefined) partner.countryCode = value.countryCode;
    if (value.profilePicture !== undefined) partner.profilePicture = value.profilePicture;
    if (value.gender !== undefined) partner.gender = value.gender;

    await partner.save();

    const updatedPartner = await Partner.findById(req.user.id).select('-password -__v').lean();

    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        data: updatedPartner,
        message: 'Profile updated successfully.',
    });
};

/**
 * Update Partner FID (Notification Token)
 * @route PUT /api/partner/auth/fid
 */
export const updatePartnerFid = async (req, res) => {
    const { error, value } = updatePartnerFidSchema.validate(req.body);
    if (error) {
        return sendResponse({
            res,
            statusCode: httpStatus.BAD_REQUEST,
            message: error.details[0].message,
        });
    }

    const partner = await Partner.findById(req.user.id);
    if (!partner) {
        return sendResponse({
            res,
            statusCode: httpStatus.NOT_FOUND,
            message: 'Partner profile not found.',
        });
    }

    partner.fid = value.fid;
    partner.fcmToken = value.fid;
    partner.fidStatus = 'active';
    partner.fidUpdatedAt = new Date();
    await partner.save();

    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        data: {
            _id: partner._id,
            fidStatus: partner.fidStatus,
            fidUpdatedAt: partner.fidUpdatedAt,
        },
        message: 'FID updated successfully.',
    });
};

/**
 * Update Partner FCM Token
 * @route PUT /api/partner/auth/fcm-token
 */
export const updatePartnerFcmToken = async (req, res) => {
    const { error, value } = updatePartnerFcmTokenSchema.validate(req.body);
    if (error) {
        return sendResponse({
            res,
            statusCode: httpStatus.BAD_REQUEST,
            message: error.details[0].message,
        });
    }

    const partner = await Partner.findById(req.user.id);
    if (!partner) {
        return sendResponse({
            res,
            statusCode: httpStatus.NOT_FOUND,
            message: 'Partner profile not found.',
        });
    }

    partner.fcmToken = value.fcmToken;
    partner.fid = value.fcmToken;
    partner.fidStatus = 'active';
    partner.fidUpdatedAt = new Date();
    await partner.save();

    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        data: {
            _id: partner._id,
            fcmToken: partner.fcmToken,
            fidStatus: partner.fidStatus,
            fidUpdatedAt: partner.fidUpdatedAt,
        },
        message: 'FCM Token updated successfully.',
    });
};

/**
 * Toggle Partner Online/Offline Status
 * @route PATCH /api/partner/auth/status
 * @access Private (Rider)
 */
export const togglePartnerOnlineStatus = async (req, res) => {
    const partner = await Partner.findById(req.user.id);
    if (!partner) {
        return sendResponse({
            res,
            statusCode: httpStatus.NOT_FOUND,
            message: 'Partner profile not found.',
        });
    }

    // Must be approved / active to toggle availability
    if (partner.accountStatus !== 'ACTIVE') {
        return sendResponse({
            res,
            statusCode: httpStatus.FORBIDDEN,
            message:
                partner.accountStatus === 'PENDING'
                    ? 'Your account is pending admin verification/activation.'
                    : `Your account is currently ${partner.accountStatus.toLowerCase()}. Please contact support.`,
        });
    }

    // Flip status
    partner.isOnline = !partner.isOnline;
    await partner.save();

    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        data: {
            _id: partner._id,
            fullName: partner.fullName,
            email: partner.email,
            phone: partner.phone,
            accountStatus: partner.accountStatus,
            isOnline: partner.isOnline,
            updatedAt: partner.updatedAt,
        },
        message: partner.isOnline ? 'You are now online' : 'You are now offline',
    });
};

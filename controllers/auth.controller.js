// controllers/auth.controller.js
import mongoose from 'mongoose';
import env from '#configs/env';
import User from '#models/user';
import Cart from '#models/cart';
import Notification from '#models/notification';
import httpStatus from 'http-status';
import { sendResponse, normalizeGender } from '#utils/generalHelper';
import {
    addressIdParamSchema,
    appleLoginSchema,
    createAddressSchema,
    googleLoginSchema,
    sendOtpSchema,
    updateAddressSchema,
    updateProfileSchema,
    verifyOtpSchema,
} from '#validations/auth';
import { sendOtpService, verifyOtpService } from '#services/otp';
import { resolveIndiaLocationSelection } from '#services/location';
import firebaseAdmin from '#configs/firebase';
import PrintOrder from '#models/printOrder';
import { attachPresignedUrls, extractS3KeyFromUrl, isS3Url } from '#utils/s3Presigned';

/**
 * Merges two user accounts to consolidate identity and data.
 * Used when a user "claims" an existing phone-only account via Google login/update.
 * @param {ObjectId} targetUserId - The account being kept (usually the primary/legacy one)
 * @param {ObjectId} sourceUserId - The account being merged and removed (usually the new/temporary one)
 */
const mergeAccounts = async (targetUserId, sourceUserId) => {
    if (targetUserId.toString() === sourceUserId.toString()) return;

    const [targetUser, sourceUser] = await Promise.all([User.findById(targetUserId), User.findById(sourceUserId)]);

    if (!targetUser || !sourceUser) return;

    // Cache source data before deletion
    const sourceData = {
        addresses: sourceUser.addresses || [],
        firstName: sourceUser.firstName,
        lastName: sourceUser.lastName,
        profilePicture: sourceUser.profilePicture,
        fcmToken: sourceUser.fcmToken,
        googleId: sourceUser.googleId,
        appleId: sourceUser.appleId,
        email: sourceUser.email,
        authProvider: sourceUser.authProvider,
        isEmailVerified: sourceUser.isEmailVerified,
        isPhoneVerified: sourceUser.isPhoneVerified,
    };

    // 1. DELETE source user FIRST to clear unique index collisions (email, googleId, appleId)
    await User.findByIdAndDelete(sourceUserId);

    // 2. Migrate cached data to target
    if (sourceData.addresses.length > 0) {
        targetUser.addresses = [...targetUser.addresses, ...sourceData.addresses];
    }

    if (!targetUser.firstName) targetUser.firstName = sourceData.firstName;
    if (!targetUser.lastName) targetUser.lastName = sourceData.lastName;
    if (!targetUser.profilePicture) targetUser.profilePicture = sourceData.profilePicture;
    if (!targetUser.fcmToken) targetUser.fcmToken = sourceData.fcmToken;

    if (!targetUser.googleId) targetUser.googleId = sourceData.googleId;
    if (!targetUser.appleId) targetUser.appleId = sourceData.appleId;
    if (!targetUser.email) targetUser.email = sourceData.email;
    if (sourceData.authProvider === 'GOOGLE') targetUser.authProvider = 'GOOGLE';
    if (sourceData.authProvider === 'APPLE') targetUser.authProvider = 'APPLE';
    if (sourceData.isEmailVerified) targetUser.isEmailVerified = true;
    if (sourceData.isPhoneVerified) targetUser.isPhoneVerified = true;

    await targetUser.save();

    // 3. Handle Cart Merging (Avoid unique index conflict for ACTIVE carts)
    const [targetCart, sourceCart] = await Promise.all([
        Cart.findOne({ user: targetUserId, status: 'ACTIVE' }),
        Cart.findOne({ user: sourceUserId, status: 'ACTIVE' }),
    ]);

    if (sourceCart) {
        if (targetCart) {
            targetCart.items = [...targetCart.items, ...sourceCart.items];
            targetCart.stationeryItems = [...targetCart.stationeryItems, ...sourceCart.stationeryItems];
            await targetCart.save();
            await Cart.findByIdAndDelete(sourceCart._id);
        } else {
            sourceCart.user = targetUserId;
            await sourceCart.save();
        }
    }

    // 4. Update references in other collections (Historical data)
    await Promise.all([
        Cart.updateMany({ user: sourceUserId, status: { $ne: 'ACTIVE' } }, { $set: { user: targetUserId } }),
        PrintOrder.updateMany({ user: sourceUserId }, { $set: { user: targetUserId } }),
        Notification.updateMany({ recipient: sourceUserId }, { $set: { recipient: targetUserId } }),
    ]);
};

const ensureAddressConsistency = async (user) => {
    let hasAddressChanges = false;
    let hasDefaultAddress = false;
    const normalizedAddresses = user.addresses.map((address) => {
        const addressObject = address.toObject ? address.toObject() : address;
        const normalizedAddress = { ...addressObject };

        if (!normalizedAddress._id) {
            normalizedAddress._id = new mongoose.Types.ObjectId();
            hasAddressChanges = true;
        }

        if (typeof normalizedAddress.isDefault !== 'boolean') {
            normalizedAddress.isDefault = false;
            hasAddressChanges = true;
        }

        if (normalizedAddress.isDefault) {
            if (hasDefaultAddress) {
                normalizedAddress.isDefault = false;
                hasAddressChanges = true;
            } else {
                hasDefaultAddress = true;
            }
        }

        return normalizedAddress;
    });

    if (normalizedAddresses.length > 0 && !hasDefaultAddress) {
        normalizedAddresses[0].isDefault = true;
        hasAddressChanges = true;
    }

    if (hasAddressChanges) {
        // Backfill ids/default flags for legacy address items and keep a single default address.
        user.addresses = normalizedAddresses;
        await user.save({ validateBeforeSave: false });
    }

    return user;
};

const hasOwnProperty = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

const resolveAddressLocationPayload = async (payload, existingAddress = null) => {
    const hasStateCode = hasOwnProperty(payload, 'stateCode');
    const hasCitySlug = hasOwnProperty(payload, 'citySlug');

    if (hasStateCode !== hasCitySlug) {
        return {
            error: 'State code and city slug must be provided together.',
        };
    }

    if (!hasStateCode && !hasCitySlug) {
        return { data: payload };
    }

    const stateCode = payload.stateCode || existingAddress?.stateCode;
    const citySlug = payload.citySlug || existingAddress?.citySlug;
    const resolvedLocation = await resolveIndiaLocationSelection({ stateCode, citySlug });

    if (!resolvedLocation) {
        return {
            error: 'Invalid state and city combination.',
        };
    }

    return {
        data: {
            ...payload,
            ...resolvedLocation,
        },
    };
};

const setDefaultAddress = (addresses, addressId = null) => {
    const defaultAddressId = addressId ? addressId.toString() : null;

    addresses.forEach((address, index) => {
        address.isDefault = defaultAddressId ? address._id.toString() === defaultAddressId : index === 0;
    });
};

const coreProfileProjection =
    '_id firstName lastName countryCode phone email profilePicture gender isProfileComplete authProvider isPhoneVerified isEmailVerified role createdAt updatedAt fcmToken';

/**
 * Whitelist of fields to include in the login response to minimize payload.
 * Comment/uncomment fields below as needed.
 */
const LOGIN_RESPONSE_FIELDS = [
    'isProfileComplete',
    '_id',
    'phone',
    'authProvider',
    'createdAt',
    'isActive',
    'profilePicture',
    'email',
    'firstName',
    'lastName',
    'countryCode',
    'gender',
    'fcmToken',
    // 'role',
    // 'updatedAt',
    // 'isPhoneVerified',
    // 'isEmailVerified',
];

export const sendOtp = async (req, res) => {
    const { error, value } = sendOtpSchema.validate(req.body);

    if (error) {
        return sendResponse({ res, statusCode: httpStatus.BAD_REQUEST, message: error.details[0].message });
    }
    const countryCode = value.countryCode;
    const fullPhone = `${countryCode}${value.phone}`;

    // Early account-status check — block before wasting an OTP
    const existingUser = await User.findOne({ phone: value.phone }).select('isActive isDeleted');

    if (existingUser?.isDeleted) {
        return sendResponse({
            res,
            statusCode: httpStatus.GONE,
            message: 'Your account has been deleted. Please contact support for assistance.',
        });
    }

    if (existingUser && !existingUser.isActive) {
        return sendResponse({
            res,
            statusCode: httpStatus.FORBIDDEN,
            message: 'Account is inactive. Contact support.',
        });
    }

    try {
        await sendOtpService(fullPhone);
    } catch (otpError) {
        return sendResponse({
            res,
            statusCode: otpError.status || otpError.statusCode || httpStatus.INTERNAL_SERVER_ERROR,
            message: otpError.message,
        });
    }

    return sendResponse({ res, statusCode: httpStatus.OK, message: 'OTP sent successfully' });
};

export const verifyOtp = async (req, res) => {
    const { error, value } = verifyOtpSchema.validate(req.body);

    if (error) {
        return sendResponse({ res, statusCode: httpStatus.BAD_REQUEST, message: error.details[0].message });
    }

    const countryCode = value.countryCode;
    const fullPhone = `${countryCode}${value.phone}`;

    // Verify OTP unless explicitly disabled (e.g. if the 3rd party OTP service is down)
    if (!env.DISABLE_OTP_VERIFICATION) {
        try {
            await verifyOtpService(fullPhone, value.otp);
        } catch (verifyError) {
            return sendResponse({
                res,
                statusCode: httpStatus.BAD_REQUEST,
                message: verifyError.message,
            });
        }
    } else {
        console.log(
            `⚠️  OTP verification is BYPASSED (DISABLE_OTP_VERIFICATION=true). Logged in ${fullPhone} without check.`,
        );
    }

    const existingUser = await User.findOne({ phone: value.phone }).select('_id isActive isDeleted');

    if (existingUser?.isDeleted) {
        return sendResponse({
            res,
            statusCode: httpStatus.GONE,
            message: 'Your account has been deleted. Please contact support for assistance.',
        });
    }

    if (existingUser && !existingUser.isActive) {
        return sendResponse({
            res,
            statusCode: httpStatus.FORBIDDEN,
            message: 'Account is inactive. Contact support.',
        });
    }

    // 1. Find or create user (Atomic operation)
    let user = await User.findOneAndUpdate(
        { phone: value.phone },
        {
            $setOnInsert: {
                firstName: '',
                fullName: '', // Explicitly set since $setOnInsert bypasses pre('save') hook
                countryCode: value.countryCode,
                phone: value.phone,
                authProvider: 'PHONE',
                role: 'STUDENT',
            },
            $set: {
                isPhoneVerified: true,
            },
        },
        {
            returnDocument: 'after',
            upsert: true,
        },
    );

    // 2. Generate JWT
    const token = user.generateAccessToken();

    // 3. Build Reduced Response Payload
    // Convert Mongoose document to a plain object and pick only allowed fields
    const fullUser = user.toObject();
    const loggedInUser = {};
    LOGIN_RESPONSE_FIELDS.forEach((field) => {
        if (Object.prototype.hasOwnProperty.call(fullUser, field)) {
            loggedInUser[field] = fullUser[field];
        }
    });

    return sendResponse({ res, statusCode: httpStatus.OK, data: loggedInUser, message: 'Login successful', token });
};

export const googleLogin = async (req, res) => {
    const { error, value } = googleLoginSchema.validate(req.body);
    if (error) {
        return sendResponse({ res, statusCode: httpStatus.BAD_REQUEST, message: error.details[0].message });
    }

    try {
        const { uid, displayName, email, phoneNumber, photoUrl } = value;

        // 1. Find or create user
        let user = await User.findOne({
            $or: [{ googleId: uid }, { email }],
        });

        if (user) {
            // Already exists - update googleId if matched by email
            if (!user.googleId) user.googleId = uid;

            // Set authProvider to GOOGLE if it's currently PHONE or unset
            if (user.authProvider !== 'GOOGLE') user.authProvider = 'GOOGLE';

            // Mark email as verified since it's coming from a verified Google session
            user.isEmailVerified = true;

            // Link phone if provided during Google Login and not already set
            if (phoneNumber && !user.phone) {
                const normalizedPhone = phoneNumber.replace(/^\+91/, '').trim();

                // Check if this phone is already taken by ANOTHER account
                const phoneOwner = await User.findOne({ phone: normalizedPhone, _id: { $ne: user._id } });

                if (phoneOwner) {
                    // LOCKED Check: If the phone owner already has a verified email, block merging
                    if (phoneOwner.isEmailVerified) {
                        return sendResponse({
                            res,
                            statusCode: httpStatus.CONFLICT,
                            message: 'This phone number is already linked and verified with another email account.',
                        });
                    }

                    // CLAIM/MERGE Logic: The phone owner has no verified email, so we can claim it
                    await mergeAccounts(user._id, phoneOwner._id);
                }

                user.phone = normalizedPhone;
                if (!user.countryCode) user.countryCode = '+91';
                user.isProfileComplete = true;
                user.isPhoneVerified = true;
            }

            if (photoUrl && !user.profilePicture) user.profilePicture = photoUrl;
            await user.save();
        } else {
            // New user Signup - but first check if phone is already taken (if provided)
            let normalizedPhone = null;
            let existingPhoneOwner = null;

            if (phoneNumber) {
                normalizedPhone = phoneNumber.replace(/^\+91/, '').trim();
                existingPhoneOwner = await User.findOne({ phone: normalizedPhone });

                if (existingPhoneOwner && existingPhoneOwner.isEmailVerified) {
                    return sendResponse({
                        res,
                        statusCode: httpStatus.CONFLICT,
                        message: 'This phone number is already linked and verified with another account.',
                    });
                }
            }

            const names = (displayName || 'User').split(' ');
            const userData = {
                firstName: names[0],
                lastName: names.slice(1).join(' ') || '',
                email,
                googleId: uid,
                profilePicture: photoUrl || '',
                authProvider: 'GOOGLE',
                isEmailVerified: true,
            };

            if (normalizedPhone) {
                userData.phone = normalizedPhone;
                userData.countryCode = '+91';
                userData.isProfileComplete = true;
                userData.isPhoneVerified = true;
            }

            user = await User.create(userData);

            // If we found an unverified phone owner during signup, merge into the NEW Google account
            if (existingPhoneOwner) {
                await mergeAccounts(user._id, existingPhoneOwner._id);
            }
        }

        // Check account status
        if (user.isDeleted) {
            return sendResponse({ res, statusCode: httpStatus.GONE, message: 'Account deleted.' });
        }
        if (!user.isActive) {
            return sendResponse({ res, statusCode: httpStatus.FORBIDDEN, message: 'Account inactive.' });
        }

        // 3. Generate token
        const token = user.generateAccessToken();

        const fullUser = user.toObject();
        const loggedInUser = {
            ...fullUser,
            isPhoneProvided: !!fullUser.phone,
        };

        // Filter response fields
        const finalResponse = {};
        LOGIN_RESPONSE_FIELDS.forEach((field) => {
            if (hasOwnProperty(loggedInUser, field)) {
                finalResponse[field] = loggedInUser[field];
            }
        });
        finalResponse.isPhoneProvided = loggedInUser.isPhoneProvided;

        return sendResponse({
            res,
            statusCode: httpStatus.OK,
            data: finalResponse,
            message: 'Login successful',
            token,
        });
    } catch (err) {
        console.error('[Google Login Fail]:', err);
        return sendResponse({ res, statusCode: httpStatus.INTERNAL_SERVER_ERROR, message: 'Google login failed' });
    }
};

export const appleLogin = async (req, res) => {
    const { error, value } = appleLoginSchema.validate(req.body);
    if (error) {
        return sendResponse({ res, statusCode: httpStatus.BAD_REQUEST, message: error.details[0].message });
    }

    try {
        const { uid, displayName, email, phoneNumber, photoUrl } = value;
        const cleanEmail = email && typeof email === 'string' && email.trim() !== '' ? email.trim().toLowerCase() : null;

        // 1. Find or create user
        const orConditions = [{ appleId: uid }];
        if (cleanEmail) {
            orConditions.push({ email: cleanEmail });
        }

        let user = await User.findOne({
            $or: orConditions,
        });

        if (user) {
            // Already exists - update appleId if matched by email
            if (!user.appleId) user.appleId = uid;

            // Set authProvider to APPLE if it's currently PHONE or unset
            if (user.authProvider !== 'APPLE' && user.authProvider !== 'GOOGLE') {
                user.authProvider = 'APPLE';
            }

            // Link/update email if provided
            if (cleanEmail) {
                if (!user.email) {
                    const emailOwner = await User.findOne({ email: cleanEmail, _id: { $ne: user._id } });
                    if (emailOwner) {
                        if (emailOwner.isPhoneVerified && user.isPhoneVerified) {
                            return sendResponse({
                                res,
                                statusCode: httpStatus.CONFLICT,
                                message: 'This email is already linked and verified with another phone account.',
                            });
                        }
                        await mergeAccounts(user._id, emailOwner._id);
                    }
                    user.email = cleanEmail;
                }
                user.isEmailVerified = true;
            }

            // Link phone if provided during Apple Login and not already set
            if (phoneNumber && !user.phone) {
                const normalizedPhone = phoneNumber.replace(/^\+91/, '').trim();

                // Check if this phone is already taken by ANOTHER account
                const phoneOwner = await User.findOne({ phone: normalizedPhone, _id: { $ne: user._id } });

                if (phoneOwner) {
                    // LOCKED Check: If the phone owner already has a verified email, block merging
                    if (phoneOwner.isEmailVerified) {
                        return sendResponse({
                            res,
                            statusCode: httpStatus.CONFLICT,
                            message: 'This phone number is already linked and verified with another email account.',
                        });
                    }

                    // CLAIM/MERGE Logic: The phone owner has no verified email, so we can claim it
                    await mergeAccounts(user._id, phoneOwner._id);
                }

                user.phone = normalizedPhone;
                if (!user.countryCode) user.countryCode = '+91';
                user.isProfileComplete = true;
                user.isPhoneVerified = true;
            }

            if (displayName && (!user.firstName || user.firstName.trim() === '')) {
                const names = displayName.trim().split(' ');
                user.firstName = names[0];
                if (!user.lastName && names.slice(1).length > 0) {
                    user.lastName = names.slice(1).join(' ');
                }
            }

            if (photoUrl && !user.profilePicture) user.profilePicture = photoUrl;
            await user.save();
        } else {
            // New user Signup - but first check if phone is already taken (if provided)
            let normalizedPhone = null;
            let existingPhoneOwner = null;

            if (phoneNumber) {
                normalizedPhone = phoneNumber.replace(/^\+91/, '').trim();
                existingPhoneOwner = await User.findOne({ phone: normalizedPhone });

                if (existingPhoneOwner && existingPhoneOwner.isEmailVerified) {
                    return sendResponse({
                        res,
                        statusCode: httpStatus.CONFLICT,
                        message: 'This phone number is already linked and verified with another account.',
                    });
                }
            }

            const names = (displayName || 'Apple User').trim().split(' ');
            const userData = {
                firstName: names[0] || 'Apple',
                lastName: names.slice(1).join(' ') || (names[0] ? '' : 'User'),
                appleId: uid,
                profilePicture: photoUrl || '',
                authProvider: 'APPLE',
            };

            if (cleanEmail) {
                userData.email = cleanEmail;
                userData.isEmailVerified = true;
            }

            if (normalizedPhone) {
                userData.phone = normalizedPhone;
                userData.countryCode = '+91';
                userData.isProfileComplete = true;
                userData.isPhoneVerified = true;
            }

            user = await User.create(userData);

            // If we found an unverified phone owner during signup, merge into the NEW Apple account
            if (existingPhoneOwner) {
                await mergeAccounts(user._id, existingPhoneOwner._id);
            }
        }

        // Check account status
        if (user.isDeleted) {
            return sendResponse({ res, statusCode: httpStatus.GONE, message: 'Account deleted.' });
        }
        if (!user.isActive) {
            return sendResponse({ res, statusCode: httpStatus.FORBIDDEN, message: 'Account inactive.' });
        }

        // 3. Generate token
        const token = user.generateAccessToken();

        const fullUser = user.toObject();
        const loggedInUser = {
            ...fullUser,
            isPhoneProvided: !!fullUser.phone,
        };

        // Filter response fields
        const finalResponse = {};
        LOGIN_RESPONSE_FIELDS.forEach((field) => {
            if (Object.prototype.hasOwnProperty.call(loggedInUser, field)) {
                finalResponse[field] = loggedInUser[field];
            }
        });
        finalResponse.isPhoneProvided = loggedInUser.isPhoneProvided;

        return sendResponse({
            res,
            statusCode: httpStatus.OK,
            data: finalResponse,
            message: 'Login successful',
            token,
        });
    } catch (err) {
        console.error('[Apple Login Fail]:', err);
        return sendResponse({ res, statusCode: httpStatus.INTERNAL_SERVER_ERROR, message: 'Apple login failed' });
    }
};

export const logoutUser = async (req, res) => {
    const userId = req.user.id;

    await User.findByIdAndUpdate(userId, { $unset: { fcmToken: '' } });

    return sendResponse({ res, statusCode: httpStatus.OK, message: 'Logout successful' });
};

export const deleteAccount = async (req, res) => {
    const userId = req.user.id;

    const user = await User.findById(userId);

    if (!user) {
        return sendResponse({ res, statusCode: httpStatus.NOT_FOUND, message: 'User not found.' });
    }

    // Anonymize credentials to release unique constraints
    if (user.phone && !user.phone.startsWith('deleted_')) {
        user.phone = `deleted_${userId}_${user.phone}`;
    }
    if (user.email && !user.email.startsWith('deleted_')) {
        user.email = `deleted_${userId}_${user.email}`;
    }
    if (user.googleId && !user.googleId.startsWith('deleted_')) {
        user.googleId = `deleted_${userId}_${user.googleId}`;
    }
    if (user.appleId && !user.appleId.startsWith('deleted_')) {
        user.appleId = `deleted_${userId}_${user.appleId}`;
    }

    user.isActive = false;
    user.isDeleted = true;
    user.fcmToken = '';

    await user.save();

    return sendResponse({ res, statusCode: httpStatus.OK, message: 'Account deleted successfully' });
};

/**
 * Get User Profile
 * @route GET /api/auth/profile
 * Returns core user fields + notificationsCount (unread) + cartCount (active cart items).
 * All 3 queries run in parallel via Promise.all — zero added latency.
 */
export const fetchProfile = async (req, res) => {
    const userId = req.user.id;

    const [user, notificationsCount, cartCount] = await Promise.all([
        // 1. Core user profile
        User.findById(userId).select(coreProfileProjection).lean(),

        // 2. Unread notification count: personal notifications + broadcast (recipient: null)
        Notification.countDocuments({
            $or: [{ recipient: userId }, { recipient: null }],
            status: 'UNREAD',
            isDeleted: false,
        }),

        // 3. Active cart item count (pre-order cart only, status: ACTIVE)
        Cart.findOne({ user: userId, status: 'ACTIVE' })
            .select('items stationeryItems')
            .lean()
            .then((cart) => (cart?.items?.length ?? 0) + (cart?.stationeryItems?.length ?? 0)),
    ]);

    if (!user) {
        return sendResponse({ res, statusCode: httpStatus.NOT_FOUND, message: 'User not found.' });
    }

    const transformedUser = await attachPresignedUrls(user, ['profilePicture'], undefined, { isPublic: true, defaultFolder: 'profile' });

    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        data: {
            ...transformedUser,
            isPhoneProvided: !!user.phone,
            notificationsCount,
            cartCount,
        },
        message: 'Profile fetched successfully',
    });
};

/**
 * Get User Addresses
 * @route GET /api/auth/addresses
 */
export const getUserAddresses = async (req, res) => {
    const userId = req.user.id;
    let user = await User.findById(userId).select('_id addresses');

    if (!user) {
        return sendResponse({ res, statusCode: httpStatus.NOT_FOUND, message: 'User not found.' });
    }

    user = await ensureAddressConsistency(user);

    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        data: {
            _id: user._id,
            addresses: user.addresses.map((address) => address.toObject()).reverse(),
        },
        message: 'Addresses fetched successfully',
    });
};

/**
 * Get User Address By Id
 * @route GET /api/auth/addresses/:addressId
 */
export const getUserAddressById = async (req, res) => {
    const { error, value } = addressIdParamSchema.validate(req.params);

    if (error) {
        return sendResponse({ res, statusCode: httpStatus.BAD_REQUEST, message: error.details[0].message });
    }

    const userId = req.user.id;
    let user = await User.findById(userId).select('_id addresses');

    if (!user) {
        return sendResponse({ res, statusCode: httpStatus.NOT_FOUND, message: 'User not found.' });
    }

    user = await ensureAddressConsistency(user);

    const address = user.addresses.id(value.addressId);
    if (!address) {
        return sendResponse({ res, statusCode: httpStatus.NOT_FOUND, message: 'Address not found.' });
    }

    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        data: {
            _id: user._id,
            address: address.toObject(),
        },
        message: 'Address fetched successfully',
    });
};

/**
 * Update FCM Token
 * @route PUT /api/auth/fcm-token
 */
export const updateFcmToken = async (req, res) => {
    const { fcmToken } = req.body;

    const userId = req.user.id;
    let user = await User.findById(userId).select('-password -__v');

    if (!user) {
        return sendResponse({ res, statusCode: httpStatus.NOT_FOUND, message: 'User not found.' });
    }

    user = await User.findOneAndUpdate({ _id: userId }, { $set: { fcmToken } }, { returnDocument: 'after' }).select(
        '_id fcmToken',
    );

    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        data: { _id: user._id, fcmToken: user.fcmToken },
        message: 'FCM Token updated successfully',
    });
};

/**
 * Update User Profile
 * @route PATCH /api/auth/profile
 */
export const updateProfile = async (req, res) => {
    const { error, value } = updateProfileSchema.validate(req.body);

    if (error) {
        return sendResponse({ res, statusCode: httpStatus.BAD_REQUEST, message: error.details[0].message });
    }

    const userId = req.user.id;

    // Normalize empty email to null to satisfy sparse unique index
    if (Object.prototype.hasOwnProperty.call(value, 'email') && value.email === '') {
        value.email = null;
    }

    // Fetch fresh user to check current state
    const user = await User.findById(userId).select('phone authProvider email isEmailVerified isPhoneVerified');

    if (!user) {
        return sendResponse({ res, statusCode: httpStatus.NOT_FOUND, message: 'User not found.' });
    }

    // 1. Immutable Phone logic: Block only if different from current
    if (value.phone && user.phone && value.phone !== user.phone) {
        return sendResponse({
            res,
            statusCode: httpStatus.BAD_REQUEST,
            message: 'Phone number is already set and cannot be modified.',
        });
    }

    // New: Check for phone uniqueness before updating
    if (value.phone && !user.phone) {
        const phoneExists = await User.findOne({ phone: value.phone, _id: { $ne: userId } });
        if (phoneExists) {
            // LOCKED Check: If the other account already has a verified email, it's a hard conflict
            if (phoneExists.isEmailVerified) {
                return sendResponse({
                    res,
                    statusCode: httpStatus.CONFLICT,
                    message: 'This phone number is already linked and verified with another email account.',
                });
            }

            // CLAIM/MERGE Logic: Claim the unverified phone account into current session
            await mergeAccounts(userId, phoneExists._id);
        }
    }

    // Immutable Email logic: If user already has a verified email, block modification to a different email
    if (value.email && user.email && user.isEmailVerified && value.email !== user.email) {
        return sendResponse({
            res,
            statusCode: httpStatus.BAD_REQUEST,
            message: 'Email address is already verified and cannot be modified.',
        });
    }

    // Check for email uniqueness before updating (when setting/updating unverified or unset email)
    if (value.email && (!user.email || !user.isEmailVerified || value.email !== user.email)) {
        const emailExists = await User.findOne({ email: value.email, _id: { $ne: userId } });
        if (emailExists) {
            // Check if both accounts already have verified phones
            if (emailExists.isPhoneVerified && user.isPhoneVerified) {
                return sendResponse({
                    res,
                    statusCode: httpStatus.CONFLICT,
                    message: 'This email is already linked and verified with another phone account.',
                });
            }

            // Check if both accounts already have verified emails
            if (emailExists.isEmailVerified && user.isEmailVerified) {
                return sendResponse({
                    res,
                    statusCode: httpStatus.CONFLICT,
                    message: 'This email is already linked and verified with another account.',
                });
            }

            // Claim/Merge logic for email
            await mergeAccounts(userId, emailExists._id);
        }

        value.isEmailVerified = true;
    }

    // 3. Mark profile complete if phone is being set for the first time
    if (value.phone && !user.phone) {
        value.isProfileComplete = true;
        value.isPhoneVerified = true;
    }

    if (value.profilePicture) {
        const rawPic = value.profilePicture.trim();
        if (!rawPic.startsWith('http://') && !rawPic.startsWith('https://') || isS3Url(rawPic)) {
            value.profilePicture = extractS3KeyFromUrl(rawPic) || rawPic;
        }
    }

    if (value.gender !== undefined) {
        value.gender = normalizeGender(value.gender) ?? value.gender;
    }

    const update = { $set: value };

    // Normalize empty email: use $unset to avoid unique index collisions with null
    if (Object.prototype.hasOwnProperty.call(value, 'email') && (value.email === '' || value.email === null)) {
        if (user.email && user.isEmailVerified) {
            return sendResponse({
                res,
                statusCode: httpStatus.BAD_REQUEST,
                message: 'Verified email cannot be removed.',
            });
        }
        delete value.email;
        update.$unset = { email: '' }; // removes the field from DB
    }

    const updatedUser = await User.findOneAndUpdate({ _id: userId }, update, { returnDocument: 'after' })
        .select(coreProfileProjection)
        .lean();

    if (!updatedUser) {
        return sendResponse({ res, statusCode: httpStatus.NOT_FOUND, message: 'User not found.' });
    }

    const transformedUpdatedUser = await attachPresignedUrls(updatedUser, ['profilePicture'], undefined, { isPublic: true, defaultFolder: 'profile' });

    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        data: {
            ...transformedUpdatedUser,
            isPhoneProvided: !!updatedUser.phone,
        },
        message: 'Profile updated successfully',
    });
};

export const createAddress = async (req, res) => {
    const { error, value } = createAddressSchema.validate(req.body);

    if (error) {
        return sendResponse({ res, statusCode: httpStatus.BAD_REQUEST, message: error.details[0].message });
    }

    const userId = req.user.id;
    const user = await User.findById(userId).select('addresses');

    if (!user) {
        return sendResponse({ res, statusCode: httpStatus.NOT_FOUND, message: 'User not found.' });
    }

    const { error: locationError, data: addressPayload } = await resolveAddressLocationPayload(value);
    if (locationError) {
        return sendResponse({ res, statusCode: httpStatus.BAD_REQUEST, message: locationError });
    }

    await ensureAddressConsistency(user);

    const shouldSetAsDefault = user.addresses.length === 0 || value.isDefault === true;
    if (shouldSetAsDefault) {
        user.addresses.forEach((address) => {
            address.isDefault = false;
        });
    }

    const newAddress = {
        _id: new mongoose.Types.ObjectId(),
        ...addressPayload,
        isDefault: shouldSetAsDefault,
    };

    user.addresses.push(newAddress);
    await user.save();

    return sendResponse({
        res,
        statusCode: httpStatus.CREATED,
        data: user.addresses.id(newAddress._id).toObject(),
        message: 'Address added successfully',
    });
};

export const updateAddress = async (req, res) => {
    const { error: paramError, value: paramValue } = addressIdParamSchema.validate(req.params);

    if (paramError) {
        return sendResponse({ res, statusCode: httpStatus.BAD_REQUEST, message: paramError.details[0].message });
    }

    const { error, value } = updateAddressSchema.validate(req.body);

    if (error) {
        return sendResponse({ res, statusCode: httpStatus.BAD_REQUEST, message: error.details[0].message });
    }

    const userId = req.user.id;
    const user = await User.findById(userId).select('addresses');

    if (!user) {
        return sendResponse({ res, statusCode: httpStatus.NOT_FOUND, message: 'User not found.' });
    }

    await ensureAddressConsistency(user);

    const address = user.addresses.id(paramValue.addressId);
    if (!address) {
        return sendResponse({ res, statusCode: httpStatus.NOT_FOUND, message: 'Address not found.' });
    }

    const { error: locationError, data: addressPayload } = await resolveAddressLocationPayload(
        value,
        address.toObject(),
    );
    if (locationError) {
        return sendResponse({ res, statusCode: httpStatus.BAD_REQUEST, message: locationError });
    }

    const wantsToUnsetDefault = hasOwnProperty(value, 'isDefault') && value.isDefault === false;
    if (wantsToUnsetDefault && address.isDefault) {
        return sendResponse({
            res,
            statusCode: httpStatus.BAD_REQUEST,
            message: 'Default address cannot be unset directly. Set another address as default instead.',
        });
    }

    const nextAddressPayload = { ...addressPayload };
    delete nextAddressPayload.isDefault;
    address.set(nextAddressPayload);

    if (value.isDefault === true) {
        setDefaultAddress(user.addresses, paramValue.addressId);
    }

    await user.save();

    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        data: address.toObject(),
        message: 'Address updated successfully',
    });
};

export const deleteAddress = async (req, res) => {
    const { error, value } = addressIdParamSchema.validate(req.params);

    if (error) {
        return sendResponse({ res, statusCode: httpStatus.BAD_REQUEST, message: error.details[0].message });
    }

    const userId = req.user.id;
    const user = await User.findById(userId).select('addresses');

    if (!user) {
        return sendResponse({ res, statusCode: httpStatus.NOT_FOUND, message: 'User not found.' });
    }

    await ensureAddressConsistency(user);

    const address = user.addresses.id(value.addressId);
    if (!address) {
        return sendResponse({ res, statusCode: httpStatus.NOT_FOUND, message: 'Address not found.' });
    }

    const wasDefault = address.isDefault;
    user.addresses.pull({ _id: value.addressId });

    if (wasDefault && user.addresses.length > 0) {
        setDefaultAddress(user.addresses);
    }

    await user.save();

    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        data: { _id: user._id, addressId: value.addressId },
        message: 'Address deleted successfully',
    });
};

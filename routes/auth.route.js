// routes/auth.route.js
import {
    appleLogin,
    createAddress,
    deleteAccount,
    deleteAddress,
    fetchProfile,
    getUserAddressById,
    getUserAddresses,
    googleLogin,
    logoutUser,
    sendOtp,
    updateAddress,
    updateFcmToken,
    updateProfile,
    verifyOtp,
} from '#controllers/auth';
import { Router } from 'express';
import asyncHandler from '#utils/asyncHandler';
import { verifyUserToken } from '#middlewares/auth';

const authRouter = Router();

// 1. Auth Flow
authRouter.route('/send-otp').post(asyncHandler(sendOtp));
authRouter.route('/verify-otp').post(asyncHandler(verifyOtp));
authRouter.route('/google-login').post(asyncHandler(googleLogin));
authRouter.route('/apple-login').post(asyncHandler(appleLogin));

authRouter.use(verifyUserToken);
// 2. User Profile (Private)
authRouter.route('/fcm-token').put(asyncHandler(updateFcmToken));
authRouter.route('/profile').patch(asyncHandler(updateProfile)).get(asyncHandler(fetchProfile));
authRouter.route('/addresses').post(asyncHandler(createAddress)).get(asyncHandler(getUserAddresses));
authRouter
    .route('/addresses/:addressId')
    .get(asyncHandler(getUserAddressById))
    .patch(asyncHandler(updateAddress))
    .delete(asyncHandler(deleteAddress));

// 3. Account Management (Private)
authRouter.route('/logout').post(asyncHandler(logoutUser));
authRouter.route('/delete-account').delete(asyncHandler(deleteAccount));

export default authRouter;

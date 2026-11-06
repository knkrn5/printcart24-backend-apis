// routes/banner.route.js
import { Router } from 'express';
import {
    deleteHomeBannerItem,
    getHomeBanner,
    getHomeBannerById,
    toggleBannerStatus,
    upsertHomeBanner,
} from '#controllers/banner';
import { verifyAdminToken, verifyAnyToken } from '#middlewares/auth';
import asyncHandler from '#utils/asyncHandler';

const bannerRouter = Router();

bannerRouter
    .route('/home')
    .get(verifyAnyToken, asyncHandler(getHomeBanner))
    .post(verifyAdminToken, asyncHandler(upsertHomeBanner));

bannerRouter
    .route('/home/:bannerId')
    .get(verifyAdminToken, asyncHandler(getHomeBannerById))
    .delete(verifyAdminToken, asyncHandler(deleteHomeBannerItem));

bannerRouter.route('/home/toggle-status/:bannerId').patch(verifyAdminToken, asyncHandler(toggleBannerStatus));

export default bannerRouter;

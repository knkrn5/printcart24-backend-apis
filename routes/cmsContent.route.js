// routes/cmsContent.route.js
import { Router } from 'express';
import { verifyAdminToken, verifyUserToken } from '#middlewares/auth';
import { isAdmin } from '#middlewares/admin';
import { getCmsContent, upsertCmsContent, deleteCmsContent } from '#controllers/cmsContent';
import asyncHandler from '#utils/asyncHandler';

const cmsRouter = Router();

/**
 * @description Get CMS content by slug (Available to both Admin and User)
 * @route GET /api/cms/:slug (ANY USER)
 */
cmsRouter.route('/:slug').get(asyncHandler(getCmsContent));

/**
 * @description Create or Update CMS content (Admin Only)
 * @route POST /api/cms
 */
cmsRouter.route('/').post(verifyAdminToken, isAdmin, asyncHandler(upsertCmsContent));

/**
 * @description Delete CMS content (Admin Only)
 * @route DELETE /api/cms/:slug
 */
cmsRouter.route('/:slug').delete(verifyAdminToken, isAdmin, asyncHandler(deleteCmsContent));

export default cmsRouter;

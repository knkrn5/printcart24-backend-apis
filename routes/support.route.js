// routes/support.route.js
import { Router } from 'express';
import asyncHandler from '#utils/asyncHandler';
import { getSupportDetails } from '#controllers/support';

const supportRouter = Router();

/**
 * @description Get support contact information (Public)
 * @route GET /api/support
 */
supportRouter.route('/').get(asyncHandler(getSupportDetails));

export default supportRouter;

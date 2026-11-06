import { Router } from 'express';
import { listActiveCoupons } from '#controllers/coupon';
import { verifyUserToken } from '#middlewares/auth';
import asyncHandler from '#utils/asyncHandler';

const couponRouter = Router();

couponRouter.use(verifyUserToken);
couponRouter.get('/', asyncHandler(listActiveCoupons));

export default couponRouter;

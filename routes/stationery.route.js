import { Router } from 'express';
import asyncHandler from '#utils/asyncHandler';
import { getStationeryProduct, listStationeryProducts } from '#controllers/stationery';
import { verifyUserToken } from '#middlewares/auth';

const stationeryRouter = Router();

stationeryRouter.route('/').get(verifyUserToken, asyncHandler(listStationeryProducts));
stationeryRouter.route('/:productId').get(verifyUserToken, asyncHandler(getStationeryProduct));

export default stationeryRouter;

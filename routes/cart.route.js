import { Router } from 'express';
import asyncHandler from '#utils/asyncHandler';
import { verifyUserToken } from '#middlewares/auth';
import {
    getCart,
    addPrintItemToCart,
    addStationeryItemToCart,
    updateCartItemCopies,
    removeCartItem,
    applyCoupon,
    removeCoupon,
    initiateCartItemCustomization,
} from '#controllers/cart';


const cartRouter = Router();

cartRouter.use(verifyUserToken);

cartRouter.route('/').get(asyncHandler(getCart));


cartRouter.route('/items/print').post(asyncHandler(addPrintItemToCart));
cartRouter.route('/items/stationery').post(asyncHandler(addStationeryItemToCart));

// Edit session initiation — must come BEFORE the /:itemId generic routes
cartRouter.route('/items/:cartItemId/customize').post(asyncHandler(initiateCartItemCustomization));

cartRouter.route('/items/:itemId/copies').patch(asyncHandler(updateCartItemCopies));

cartRouter.route('/items/:itemId').delete(asyncHandler(removeCartItem));

cartRouter.route('/coupon/apply').post(asyncHandler(applyCoupon));
cartRouter.route('/coupon/remove').delete(asyncHandler(removeCoupon));

export default cartRouter;

// routes/printService.route.js
import { Router } from 'express';
import asyncHandler from '#utils/asyncHandler';
import { getPrintServices, getPrintServiceDetails, getPrintServiceSliderDetails, getQuickPrintConfig } from '#controllers/printService';

const printServiceRouter = Router();

printServiceRouter.route('/').get(asyncHandler(getPrintServices));
printServiceRouter.route('/quick-print/config').get(asyncHandler(getQuickPrintConfig));
printServiceRouter.route('/:id/slider-details').get(asyncHandler(getPrintServiceSliderDetails));
printServiceRouter.route('/:slug').get(asyncHandler(getPrintServiceDetails));

export default printServiceRouter;

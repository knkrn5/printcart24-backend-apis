import { Router } from 'express';
import asyncHandler from '#utils/asyncHandler';
import { fetchCities, fetchStates } from '#controllers/location';

const locationRouter = Router();

locationRouter.route('/states').get(asyncHandler(fetchStates));
locationRouter.route('/cities').get(asyncHandler(fetchCities));

export default locationRouter;

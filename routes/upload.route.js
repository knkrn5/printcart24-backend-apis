import { Router } from 'express';
import { verifyAnyToken } from '#middlewares/auth';
import { singleFileUpload } from '#middlewares/upload';
import { uploadFile, uploadFilePresigned } from '#controllers/upload';
import asyncHandler from '#utils/asyncHandler';

const uploadRouter = Router();

uploadRouter.route('/presigned').post(verifyAnyToken, singleFileUpload, asyncHandler(uploadFilePresigned));
uploadRouter.route('/').post(verifyAnyToken, singleFileUpload, asyncHandler(uploadFile));

export default uploadRouter;



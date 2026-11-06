import { Router } from 'express';
import asyncHandler from '#utils/asyncHandler';
import { verifyAnyToken } from '#middlewares/auth';
import { generatePresignedUpload, generatePresignedGet } from '#controllers/s3';
import { publicAssetUpload } from '#middlewares/upload';
import { uploadPublicAsset } from '#controllers/upload';

const s3Router = Router();

s3Router.route('/presigned-upload').post(verifyAnyToken, asyncHandler(generatePresignedUpload));
s3Router.route('/presigned-get').post(verifyAnyToken, asyncHandler(generatePresignedGet));
s3Router.route('/upload-public').post(verifyAnyToken, publicAssetUpload, asyncHandler(uploadPublicAsset));

export default s3Router;

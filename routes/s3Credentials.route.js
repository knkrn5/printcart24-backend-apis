// routes/s3Credentials.route.js
import { Router } from 'express';
import { getS3ClientCredentials } from '#configs/s3';
import { encryptData } from '#utils/encryptDecrypt';
import { sendResponse } from '#utils/generalHelper';
import httpStatus from 'http-status';

const s3Router = Router();

s3Router.route('/').get(getS3Credentials);
/**
 * * Provides encrypted S3 / Backblaze B2 credentials
 */
async function getS3Credentials(req, res, next) {
    try {
        const s3Credentials = getS3ClientCredentials();
        const encryptedCredentials = encryptData(s3Credentials);
        return sendResponse({
            res,
            statusCode: httpStatus.OK,
            data: encryptedCredentials,
            mesage: 'S3 credentials fetched successfully',
        });
    } catch (error) {
        next(error);
    }
}

export default s3Router;

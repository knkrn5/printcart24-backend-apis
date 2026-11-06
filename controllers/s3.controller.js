// controllers/s3.controller.js
import httpStatus from 'http-status';
import { generatePresignedObjectKey, createPutPresignedUrl, createGetPresignedUrl, extractS3KeyFromUrl } from '#utils/s3Presigned';
import { sendResponse } from '#utils/generalHelper';
import { presignedUploadBodySchema, presignedGetBodySchema } from '#validations/upload';

/**
 * Generates an S3 object key and a presigned PUT upload URL for direct client-to-S3 uploads.
 * @route POST /api/s3/presigned-upload
 * @access Public / Any
 */
export const generatePresignedUpload = async (req, res) => {
    const { error, value } = presignedUploadBodySchema.validate(req.body);
    if (error) {
        return sendResponse({
            res,
            statusCode: httpStatus.BAD_REQUEST,
            message: error.details[0].message,
        });
    }

    const { folderName, fileName, contentType } = value;

    const key = generatePresignedObjectKey({
        folderName,
        fileName,
        contentType,
    });

    const uploadUrl = await createPutPresignedUrl(key, contentType);

    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        message: 'Presigned upload URL generated successfully',
        data: {
            key,
            uploadUrl,
        },
    });
};

/**
 * Generates a presigned GET URL for viewing or downloading an S3 object using its key.
 * @route POST /api/s3/presigned-get
 * @access Private (verifyAnyToken)
 */
export const generatePresignedGet = async (req, res) => {
    const { error, value } = presignedGetBodySchema.validate(req.body);
    if (error) {
        return sendResponse({
            res,
            statusCode: httpStatus.BAD_REQUEST,
            message: error.details[0].message,
        });
    }

    const { key, expiresIn } = value;
    const cleanKey = extractS3KeyFromUrl(key);

    if (!cleanKey) {
        return sendResponse({
            res,
            statusCode: httpStatus.BAD_REQUEST,
            message: 'Unable to extract a valid S3 key from the provided input.',
        });
    }

    const url = await createGetPresignedUrl(cleanKey, expiresIn);

    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        message: 'Presigned GET URL generated successfully',
        data: {
            key: cleanKey,
            url,
            expiresIn,
        },
    });
};


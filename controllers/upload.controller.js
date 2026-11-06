// controllers/upload.controller.js
import httpStatus from 'http-status';
import { uploadBufferToS3 } from '#utils/s3Upload';
import { createGetPresignedUrl } from '#utils/s3Presigned';
import { sendResponse } from '#utils/generalHelper';
import { uploadBodySchema, publicUploadBodySchema } from '#validations/upload';

/**
 * Handle generic file upload to S3 / Backblaze B2
 * @route POST /api/upload
 * @access Private (User / Admin via verifyAnyToken)
 */
export const uploadFile = async (req, res) => {
    if (!req.file) {
        return sendResponse({
            res,
            statusCode: httpStatus.BAD_REQUEST,
            message: 'File is required',
        });
    }

    const { error, value } = uploadBodySchema.validate(req.body);
    if (error) {
        return sendResponse({
            res,
            statusCode: httpStatus.BAD_REQUEST,
            message: error.details[0].message,
        });
    }

    const { fileUrl, folderName } = await uploadBufferToS3({
        buffer: req.file.buffer,
        folderName: value.folderName,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
    });

    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        message: 'File uploaded successfully',
        data: {
            file: fileUrl,
            folderName,
        },
    });
};

/**
 * Handle file upload with presigned GET URL in response to fetch file
 * @route POST /api/upload/presigned
 * @access Private (User / Admin via verifyAnyToken)
 */
export const uploadFilePresigned = async (req, res) => {
    if (!req.file) {
        return sendResponse({
            res,
            statusCode: httpStatus.BAD_REQUEST,
            message: 'File is required',
        });
    }

    const { error, value } = uploadBodySchema.validate(req.body);
    if (error) {
        return sendResponse({
            res,
            statusCode: httpStatus.BAD_REQUEST,
            message: error.details[0].message,
        });
    }

    const { fileUrl, key, folderName } = await uploadBufferToS3({
        buffer: req.file.buffer,
        folderName: value.folderName,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
    });

    const presignedUrl = await createGetPresignedUrl(key);

    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        message: 'File uploaded successfully',
        data: {
            file: presignedUrl,
            presignedUrl,
            publicUrl: fileUrl,
            key,
            folderName,
        },
    });
};

/**
 * Handle public asset file upload to S3 / Backblaze B2 (CMS, stationery, banners, profile)
 * Bypasses direct browser-to-S3 presigned PUT uploads to avoid S3 CORS restrictions.
 * @route POST /api/s3/upload-public
 * @access Private (User / Admin via verifyAnyToken)
 */
export const uploadPublicAsset = async (req, res) => {
    if (!req.file) {
        return sendResponse({
            res,
            statusCode: httpStatus.BAD_REQUEST,
            message: 'File is required',
        });
    }

    const { error, value } = publicUploadBodySchema.validate(req.body);
    if (error) {
        return sendResponse({
            res,
            statusCode: httpStatus.BAD_REQUEST,
            message: error.details[0].message,
        });
    }

    const originalName = value.fileName?.trim() || req.file.originalname;

    const { fileUrl, key, folderName } = await uploadBufferToS3({
        buffer: req.file.buffer,
        folderName: value.folderName,
        originalName,
        mimeType: req.file.mimetype,
    });

    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        message: 'Public asset uploaded successfully',
        data: {
            url: fileUrl,
            publicUrl: fileUrl,
            key,
            folderName,
        },
    });
};



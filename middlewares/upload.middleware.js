// middlewares/upload.middleware.js
import multer from 'multer';
import httpStatus from 'http-status';
import { MAX_UPLOAD_SIZE_BYTES, MAX_PUBLIC_UPLOAD_SIZE_BYTES } from '#constants/upload';
import { sendResponse } from '#utils/generalHelper';

const storage = multer.memoryStorage();

const upload = multer({
    storage,
    limits: {
        fileSize: MAX_UPLOAD_SIZE_BYTES,
    },
});

const singleUpload = upload.single('file');

export const singleFileUpload = (req, res, next) => {
    singleUpload(req, res, (err) => {
        if (err) {
            if (err instanceof multer.MulterError) {
                if (err.code === 'LIMIT_FILE_SIZE') {
                    return sendResponse({
                        res,
                        statusCode: httpStatus.BAD_REQUEST,
                        message: 'File size exceeds the 2000 MB limit',
                    });
                }
                return sendResponse({
                    res,
                    statusCode: httpStatus.BAD_REQUEST,
                    message: err.message || 'File upload error',
                });
            }
            return sendResponse({
                res,
                statusCode: httpStatus.BAD_REQUEST,
                message: err.message || 'Invalid upload request',
            });
        }
        next();
    });
};

const ALLOWED_PUBLIC_MIME_TYPES = new Set([
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/svg+xml',
    'application/pdf',
]);

const publicUpload = multer({
    storage,
    limits: {
        fileSize: MAX_PUBLIC_UPLOAD_SIZE_BYTES,
    },
    fileFilter: (req, file, cb) => {
        if (!file.mimetype || !ALLOWED_PUBLIC_MIME_TYPES.has(file.mimetype.toLowerCase())) {
            const err = new Error('Invalid file type. Only images (JPEG, PNG, WebP, GIF, SVG) and PDF are allowed for public assets.');
            err.status = httpStatus.BAD_REQUEST;
            return cb(err, false);
        }
        cb(null, true);
    },
});

const singlePublicUpload = publicUpload.single('file');

export const publicAssetUpload = (req, res, next) => {
    singlePublicUpload(req, res, (err) => {
        if (err) {
            if (err instanceof multer.MulterError) {
                if (err.code === 'LIMIT_FILE_SIZE') {
                    return sendResponse({
                        res,
                        statusCode: httpStatus.BAD_REQUEST,
                        message: 'File size exceeds the 25 MB limit for public asset uploads',
                    });
                }
                return sendResponse({
                    res,
                    statusCode: httpStatus.BAD_REQUEST,
                    message: err.message || 'File upload error',
                });
            }
            return sendResponse({
                res,
                statusCode: err.status || httpStatus.BAD_REQUEST,
                message: err.message || 'Invalid upload request',
            });
        }
        next();
    });
};

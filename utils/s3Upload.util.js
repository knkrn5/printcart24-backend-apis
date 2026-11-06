// utils/s3Upload.util.js
import { PutObjectCommand } from '@aws-sdk/client-s3';
import path from 'path';
import mime from 'mime-types';
import { s3Client, s3Bucket, getS3PublicUrl } from '#configs/s3';
import { FOLDER_NAME_REGEX } from '#constants/upload';

/**
 * Uploads an in-memory file buffer directly to S3 / Backblaze B2.
 *
 * @param {Object} params
 * @param {Buffer} params.buffer - The binary file buffer
 * @param {string} params.folderName - Sanitized folder name (alphanumeric, hyphens, underscores)
 * @param {string} [params.originalName='file'] - The original filename
 * @param {string} [params.mimeType] - Optional MIME type from multipart headers
 * @returns {Promise<{ fileUrl: string, key: string, folderName: string }>}
 */
export const uploadBufferToS3 = async ({ buffer, folderName, originalName = 'file', mimeType }) => {
    const cleanFolder = (folderName || '').trim();
    if (!cleanFolder || !FOLDER_NAME_REGEX.test(cleanFolder)) {
        throw {
            status: 400,
            message: 'Invalid folderName. Folder name must be 1-64 characters and contain only letters, numbers, hyphens, and underscores',
        };
    }

    if (!buffer || !Buffer.isBuffer(buffer)) {
        throw {
            status: 400,
            message: 'File buffer is required for upload',
        };
    }

    // 1. Sanitize original filename and extension
    const parsed = path.parse(originalName || 'file');
    let cleanBaseName = (parsed.name || 'file')
        .toLowerCase()
        .replace(/\s+/g, '_')
        .replace(/[^a-z0-9_\-]/g, '');

    // Strip trailing client-generated timestamp if present (e.g. name_1789370616792 or name-1789370616792)
    cleanBaseName = cleanBaseName.replace(/[-_]\d{10,13}$/, '');

    // If the entire basename was purely a timestamp (e.g. "1789370616792"), fallback to cleanFolder or 'file'
    if (/^\d{10,13}$/.test(cleanBaseName)) {
        cleanBaseName = cleanFolder || 'file';
    }

    if (!cleanBaseName) {
        cleanBaseName = 'file';
    }

    const cleanExt = (parsed.ext || '').toLowerCase();
    const timestamp = Date.now();
    const s3Key = `printcart24/${cleanFolder}/${cleanBaseName}_${timestamp}${cleanExt}`;

    // 2. Resolve content type
    const contentType = mimeType || mime.lookup(cleanExt) || 'application/octet-stream';

    // 3. Upload to S3
    await s3Client.send(
        new PutObjectCommand({
            Bucket: s3Bucket,
            Key: s3Key,
            Body: buffer,
            ContentType: contentType,
        }),
    );

    // 4. Derive public URL
    const fileUrl = getS3PublicUrl(s3Key);

    return {
        fileUrl,
        key: s3Key,
        folderName: cleanFolder,
    };
};

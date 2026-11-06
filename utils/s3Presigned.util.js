// utils/s3Presigned.util.js
import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import path from 'path';
import mime from 'mime-types';
import { s3Client, s3Bucket, getS3PublicUrl } from '#configs/s3';
import env from '#configs/env';
import { FOLDER_NAME_REGEX } from '#constants/upload';

const DEFAULT_EXPIRATION_SECONDS = 15 * 60; // 15 minutes

/**
 * Generates an S3 object key matching PrintCart24 standard convention:
 * printcart24/<folderName>/<cleanBaseName>_<timestamp><cleanExt>
 *
 * @param {Object} params
 * @param {string} [params.folderName='assets'] - Sanitized folder name (alphanumeric, hyphens, underscores)
 * @param {string} [params.fileName='file'] - The original filename (optional)
 * @param {string} [params.contentType] - MIME type used to infer extension if fileName is omitted or lacks one
 * @returns {string} S3 object key
 */
export const generatePresignedObjectKey = ({ folderName = 'assets', fileName = 'file', contentType } = {}) => {
    const cleanFolder = (folderName || 'assets').trim();
    if (!cleanFolder || !FOLDER_NAME_REGEX.test(cleanFolder)) {
        throw {
            status: 400,
            message: 'Invalid folderName. Folder name must be 1-64 characters and contain only letters, numbers, hyphens, and underscores',
        };
    }

    const parsed = path.parse(fileName || 'file');
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

    let cleanExt = (parsed.ext || '').toLowerCase();
    if (!cleanExt && contentType) {
        const inferredExt = mime.extension(contentType);
        if (inferredExt) {
            cleanExt = `.${inferredExt}`;
        }
    }

    const timestamp = Date.now();
    return `printcart24/${cleanFolder}/${cleanBaseName}_${timestamp}${cleanExt}`;
};

/**
 * Creates a presigned PUT URL for client uploads with a 15-minute expiration
 * and signed 'content-type' header.
 *
 * @param {string} objectKey - Target S3 object key
 * @param {string} contentType - MIME type of the file
 * @param {number} [expiresIn=900] - Expiration in seconds (default: 15 minutes)
 * @returns {Promise<string>} Presigned PUT URL
 */
export const createPutPresignedUrl = async (objectKey, contentType, expiresIn = DEFAULT_EXPIRATION_SECONDS) => {
    const command = new PutObjectCommand({
        Bucket: s3Bucket,
        Key: objectKey,
        ContentType: contentType,
    });

    return getSignedUrl(s3Client, command, {
        expiresIn,
        signableHeaders: new Set(['content-type']),
    });
};

/**
 * Creates a presigned GET URL for retrieving an S3 object with a 15-minute expiration.
 *
 * @param {string} objectKey - S3 object key
 * @param {number} [expiresIn=900] - Expiration in seconds (default: 15 minutes)
 * @returns {Promise<string>} Presigned GET URL
 */
export const createGetPresignedUrl = async (objectKey, expiresIn = DEFAULT_EXPIRATION_SECONDS) => {
    const command = new GetObjectCommand({
        Bucket: s3Bucket,
        Key: objectKey,
    });

    return getSignedUrl(s3Client, command, {
        expiresIn,
    });
};

/**
 * Detects whether a URL points to an S3 bucket (AWS, Backblaze B2, or custom S3 endpoint/CDN).
 *
 * @param {string} urlString
 * @returns {boolean}
 */
export const isS3Url = (urlString) => {
    if (!urlString || typeof urlString !== 'string') return false;
    try {
        const parsed = new URL(urlString);
        const host = parsed.hostname.toLowerCase();
        const bucketLower = (s3Bucket || '').toLowerCase();
        const endpointHost = env.AWS_S3_ENDPOINT ? new URL(env.AWS_S3_ENDPOINT).hostname.toLowerCase() : null;
        const baseHost = env.AWS_S3_BASE_URL ? new URL(env.AWS_S3_BASE_URL).hostname.toLowerCase() : null;

        if (host.includes('.amazonaws.com') || host.includes('.backblazeb2.com')) return true;
        if (bucketLower && host.includes(bucketLower)) return true;
        if (endpointHost && host === endpointHost) return true;
        if (baseHost && host === baseHost) return true;
        if (parsed.pathname.toLowerCase().startsWith('/printcart24/')) return true;

        return false;
    } catch {
        return false;
    }
};

/**
 * Extracts the clean S3 object key from a full public/presigned S3 URL or returns the key if already a key.
 *
 * @param {string} keyOrUrl - S3 key or full S3 URL
 * @returns {string} S3 object key
 */
export const extractS3KeyFromUrl = (keyOrUrl) => {
    if (!keyOrUrl || typeof keyOrUrl !== 'string') return '';
    const trimmed = keyOrUrl.trim();
    if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
        return trimmed.replace(/^\/+/, '');
    }

    try {
        const parsed = new URL(trimmed);
        let cleanPath = decodeURIComponent(parsed.pathname).replace(/^\/+/, '');

        // 1. If base URL has a path prefix, strip it if present
        if (env.AWS_S3_BASE_URL) {
            try {
                const basePath = decodeURIComponent(new URL(env.AWS_S3_BASE_URL).pathname).replace(/^\/+|\/+$/g, '');
                if (basePath && cleanPath.startsWith(basePath)) {
                    cleanPath = cleanPath.substring(basePath.length).replace(/^\/+/, '');
                }
            } catch {
                // ignore
            }
        }

        // 2. If path-style URL with bucket prefix (e.g. /my-bucket/printcart24/...)
        const bucketPrefix = `${s3Bucket}/`;
        if (s3Bucket && cleanPath.toLowerCase().startsWith(bucketPrefix.toLowerCase())) {
            cleanPath = cleanPath.substring(bucketPrefix.length).replace(/^\/+/, '');
        }

        return cleanPath;
    } catch {
        return trimmed.replace(/^\/+/, '');
    }
};

/**
 * Checks if a given S3 object key belongs to one of the publicly allowed folders
 * (cms, stationery, banners, profile).
 *
 * @param {string} key - S3 object key
 * @returns {boolean}
 */
export const isPublicS3Key = (key) => {
    if (!key || typeof key !== 'string') return false;
    const cleanKey = key.replace(/^\/+/, '').toLowerCase();
    const publicFolders = ['cms', 'stationery', 'banners', 'banner', 'profile'];
    return publicFolders.some((folder) => {
        return (
            cleanKey.startsWith(`printcart24/${folder}/`) ||
            cleanKey.startsWith(`printcart24/images/${folder}/`) ||
            cleanKey.startsWith(`images/${folder}/`) ||
            cleanKey.startsWith(`${folder}/`)
        );
    });
};

/**
 * Resolves any stored value (new S3 key, legacy S3 public URL, external URL, or empty value)
 * into a fresh presigned GET URL or safe display URL.
 *
 * - Empty / falsy -> returns unchanged (empty string)
 * - External URL (e.g. Google avatar) -> returns unchanged
 * - Public asset (cms, stationery, banners, profile) -> returns direct public S3 URL
 * - Private S3 key / legacy URL -> generates fresh presigned GET URL
 *
 * @param {string} value - Stored key, S3 URL, or external URL
 * @param {number} [expiresIn=900] - Expiration in seconds (default: 15 minutes)
 * @returns {Promise<string>}
 */
export const resolvePresignedGetUrl = async (
    value,
    expiresIn = DEFAULT_EXPIRATION_SECONDS,
    options = {}
) => {
    if (!value || typeof value !== 'string') return '';
    const trimmed = value.trim();
    if (!trimmed) return '';

    const isPublicContext = Boolean(options.isPublic || options.defaultFolder);

    try {
        if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
            if (!isS3Url(trimmed)) {
                // External URL (e.g. Google OAuth photoUrl) — return as-is
                return trimmed;
            }
            let key = extractS3KeyFromUrl(trimmed);
            if (!key) return trimmed;
            if (options.defaultFolder && !key.includes('/')) {
                key = `printcart24/${options.defaultFolder}/${key}`;
            }
            if (isPublicContext || isPublicS3Key(key)) {
                return getS3PublicUrl(key);
            }
            return await createGetPresignedUrl(key, expiresIn);
        }

        // It is an S3 key (e.g. printcart24/profile/...)
        let key = trimmed.replace(/^\/+/, '');
        if (options.defaultFolder && !key.includes('/')) {
            key = `printcart24/${options.defaultFolder}/${key}`;
        }
        if (isPublicContext || isPublicS3Key(key)) {
            return getS3PublicUrl(key);
        }
        return await createGetPresignedUrl(key, expiresIn);
    } catch (error) {
        console.error(`[s3Presigned] Failed to resolve presigned GET URL for "${value}":`, error.message);
        return trimmed;
    }
};

/**
 * Transforms specified fields in an object or array of objects with fresh presigned GET URLs or public URLs.
 * Compatible with .lean() plain objects as well as Mongoose documents.
 *
 * @param {Object|Array} data - Single object or array of objects
 * @param {string[]} [fields=['profilePicture']] - Field names to resolve
 * @param {number} [expiresIn=900] - Expiration in seconds
 * @param {Object} [options={}] - Optional resolution flags (isPublic, defaultFolder)
 * @returns {Promise<Object|Array>}
 */
export const attachPresignedUrls = async (
    data,
    fields = ['profilePicture'],
    expiresIn = DEFAULT_EXPIRATION_SECONDS,
    options = {}
) => {
    if (!data) return data;

    if (Array.isArray(data)) {
        return Promise.all(data.map((item) => attachPresignedUrls(item, fields, expiresIn, options)));
    }

    if (typeof data !== 'object') return data;

    const obj = typeof data.toObject === 'function' ? data.toObject() : { ...data };

    for (const field of fields) {
        if (obj[field] !== undefined) {
            obj[field] = await resolvePresignedGetUrl(obj[field], expiresIn, options);
        }
    }

    return obj;
};


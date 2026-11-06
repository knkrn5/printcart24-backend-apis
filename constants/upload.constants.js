// constants/upload.constants.js

export const UPLOAD_FOLDERS = Object.freeze({
    DOCUMENTS: 'documents',
    PROFILE: 'profile',
    BANNERS: 'banners',
    STATIONERY: 'stationery',
    SERVICES: 'print-services',
    SLIDERS: 'print-slider',
    NOTIFICATION: 'notification',
    CMS: 'cms',
    ASSETS: 'assets',
});

export const ALLOWED_UPLOAD_FOLDERS = Object.freeze(Object.values(UPLOAD_FOLDERS));

export const ALLOWED_PUBLIC_UPLOAD_FOLDERS = Object.freeze([
    UPLOAD_FOLDERS.CMS,
    UPLOAD_FOLDERS.STATIONERY,
    UPLOAD_FOLDERS.BANNERS,
    UPLOAD_FOLDERS.PROFILE,
]);

/**
 * Sanitized folder name regex (Option A: Single folder, alphanumeric, hyphens, underscores, 1-64 chars)
 */
export const FOLDER_NAME_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * Technical upload size ceiling: 2000 MB in bytes (guardrail limit).
 */
export const MAX_UPLOAD_SIZE_BYTES = 2000 * 1024 * 1024;

/**
 * Public asset upload size ceiling: 25 MB in bytes.
 */
export const MAX_PUBLIC_UPLOAD_SIZE_BYTES = 25 * 1024 * 1024;

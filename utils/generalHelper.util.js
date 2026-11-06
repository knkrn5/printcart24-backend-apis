// utils/generalHelper.util.js
import crypto from 'crypto';
import mongoose from 'mongoose';

/**
 * Check if a value is a valid Mongo ObjectId
 * @param {string} id
 * @returns {boolean}
 */
export const isValidObjectId = (id) => {
    if (!id) return false; //  if id is null or undefined
    if (!mongoose.Types.ObjectId.isValid(id)) return false; // if id is not a valid ObjectId
    return String(new mongoose.Types.ObjectId(id)) === id; // if id is a valid ObjectId
};

/**
 * * Generates a random OTP (One-Time Password) of a specified length.
 * @param {number} length - The number of characters for the OTP.
 * @returns {string} The generated OTP.
 */
export const generateOTP = (length = 4) => {
    if (typeof length !== 'number' || length <= 0) {
        throw {
            status: 400,
            message: 'Length must be a positive number.',
        };
    }

    const characters = '0123456789';
    let otp = '';

    // Generate a random buffer of the specified length
    const randomBytes = crypto.randomBytes(length);

    for (let i = 0; i < length; i++) {
        // Use the random byte to select a character from the characters string
        const randomIndex = randomBytes[i] % characters.length;
        otp += characters[randomIndex];
    }

    return otp; // "1234"
};

/**
 * * Hashes an OTP (One-Time Password).
 * @param {string} otp - The OTP to hash.
 * @returns {string} The hashed OTP.
 */
export const hashOtp = (otp) => {
    return crypto.createHash('sha256').update(otp).digest('hex');
};

/**
 * @param {Object} params - Configuration object
 * @param {import('express').Response} params.res - Express response object (required)
 * @param {number} params.statusCode - HTTP status code (required)
 * @param {*} [params.data] - Response payload (optional)
 * @param {string} [params.message] - Response message (optional)
 * @param {string} [params.token] - Token string (optional)
 */
export const sendResponse = (params = {}) => {
    let { res, statusCode, data, message, token, count, counts, notificationsCount } = params;

    if (data && typeof data.toJSON === 'function') {
        data = data.toJSON();
    }

    const response = {
        status: statusCode < 400,
        ...(message && { message }),
        ...(token && { token }),
    };

    if (data !== undefined && data !== null) {
        let responseData = data;
        let responseCount = count;
        let responseCounts = counts;
        let responseNotificationsCount = notificationsCount;

        if (typeof data === 'object' && !Array.isArray(data)) {
            const hasCompoundData = data.userCounts !== undefined;
            const hasProductsData = data.productCounts !== undefined;
            const hasOrdersData = data.orderCounts !== undefined;

            if (!hasCompoundData && Array.isArray(data.users)) {
                responseData = data.users;
            } else if (!hasCompoundData && Array.isArray(data.user)) {
                responseData = data.user;
            } else if (!hasCompoundData && Array.isArray(data.data)) {
                responseData = data.data;
            } else if (!hasProductsData && Array.isArray(data.products)) {
                responseData = data.products;
            } else if (!hasOrdersData && Array.isArray(data.orders)) {
                responseData = data.orders;
            }

            if (data.count !== undefined) {
                responseCount = data.count;
            } else if (data.total !== undefined) {
                responseCount = data.total;
            }

            if (data.counts !== undefined) {
                responseCounts = data.counts;
            }

            // Hoist notificationsCount if data wraps an array (dashboard/list) or is a dedicated count object
            const isDedicatedCount = Object.keys(data).length === 1 && data.notificationsCount !== undefined;
            const wrapsArray = Array.isArray(data.data) || Array.isArray(data.users) || Array.isArray(data.orders);
            if (data.notificationsCount !== undefined && (isDedicatedCount || wrapsArray)) {
                responseNotificationsCount = data.notificationsCount;
            }
        }

        response.data = responseData;
        if (responseCount !== undefined) {
            response.count = responseCount;
            if (response.data && typeof response.data === 'object' && !Array.isArray(response.data)) {
                delete response.data.count;
            }
        }
        if (responseCounts !== undefined) {
            response.counts = responseCounts;
            if (response.data && typeof response.data === 'object' && !Array.isArray(response.data)) {
                delete response.data.counts;
            }
        }
        if (responseNotificationsCount !== undefined) {
            response.notificationsCount = responseNotificationsCount;
            if (response.data && typeof response.data === 'object' && !Array.isArray(response.data)) {
                delete response.data.notificationsCount;
            }
        }

        // Clean up empty data object if all keys were hoisted
        if (response.data && typeof response.data === 'object' && !Array.isArray(response.data) && Object.keys(response.data).length === 0) {
            delete response.data;
        }
    } else {
        if (count !== undefined) response.count = count;
        if (counts !== undefined) response.counts = counts;
        if (notificationsCount !== undefined) response.notificationsCount = notificationsCount;
    }

    return res.status(statusCode).json(response);
};

/**
 * Generic pagination utility
 * @param {Model} model - Mongoose model
 * @param {Object} filter - Mongo filter object
 * @param {Object} options - { page, limit, sort }
 * @param {string} fields - Fields to exclude
 */
export const calculatePagination = async (model, filter = {}, options = {}, fields = '-__v') => {
    const { page = 1, limit = 10, sort = { createdAt: -1 }, populate = null } = options;

    const pageNumber = parseInt(page, 10);
    const limitNumber = parseInt(limit, 10);
    const skip = (pageNumber - 1) * limitNumber;

    let query = model.find(filter).sort(sort).skip(skip).limit(limitNumber).select(fields).lean();

    if (populate) {
        query = query.populate(populate);
    }

    const [records, count] = await Promise.all([query, model.countDocuments(filter)]);

    return { records, count };
};

export const pickBannerFields = (item = {}) => ({
    _id: item._id,
    s3Url: item.s3Url,
    redirectUrl: item.redirectUrl,
    isActive: item.isActive,
    isDeleted: item.isDeleted,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
});

export const filterAndSortBanners = (banners = []) =>
    banners
        .filter((b) => !b.isDeleted && b.isActive && b.s3Url?.trim())
        .sort(
            (a, b) => new Date(b.updatedAt) - new Date(a.updatedAt), // latest first
        )
        .map(pickBannerFields);

export const getReadableFileTypes = (mimeTypesArray = []) => {
    const MAP = {
        'application/pdf': 'PDF',
        'application/msword': 'DOC',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
        'application/vnd.ms-excel': 'XLS',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'XLSX',
        'application/vnd.ms-powerpoint': 'PPT',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PPTX',
        'application/vnd.oasis.opendocument.text': 'ODT',
        'application/vnd.oasis.opendocument.spreadsheet': 'ODS',
        'application/vnd.oasis.opendocument.presentation': 'ODP',
        'application/rtf': 'RTF',
        'text/rtf': 'RTF',
        'text/plain': 'TXT',
        'text/csv': 'CSV',
        'image/jpeg': 'JPEG',
        'image/png': 'PNG',
        'image/webp': 'WEBP',
        'image/bmp': 'BMP',
        'image/tiff': 'TIFF',
        'image/svg+xml': 'SVG',
    };

    return [...new Set(mimeTypesArray.map((mime) => MAP[mime] || mime))].join(', ');
};

/**
 * Diagnostic debug utility for batch file URL validation.
 * Safely outputs diagnostics for documents, redacting sensitive parameters.
 * Does not throw errors.
 * 
 * @param {Array} documents - Array of document objects to debug
 */
export const debugBatchFileUrls = (documents) => {
    if (process.env.ENABLE_FILE_URL_DEBUG !== 'true') return;
    if (!Array.isArray(documents)) return;

    try {
        const redactUrl = (urlStr) => {
            if (!urlStr) return '';
            try {
                const url = new URL(urlStr);
                if (url.search) {
                    url.search = '?REDACTED';
                }
                return url.toString();
            } catch {
                const qIdx = urlStr.indexOf('?');
                if (qIdx !== -1) {
                    return urlStr.substring(0, qIdx) + '?REDACTED';
                }
                return urlStr;
            }
        };

        const getCleanUrlForAnalysis = (urlStr) => {
            if (!urlStr) return '';
            const qIdx = urlStr.indexOf('?');
            if (qIdx !== -1) {
                return urlStr.substring(0, qIdx);
            }
            return urlStr;
        };

        documents.forEach((doc, idx) => {
            try {
                console.log(`[BATCH_FILE_URL_DEBUG] Document Index: ${idx}`);
                console.log(`[BATCH_FILE_URL_DEBUG] originalFileName: ${doc.originalFileName}`);
                
                const rawUrl = doc.fileUrl;
                const redactedUrl = redactUrl(rawUrl);
                const cleanUrl = getCleanUrlForAnalysis(rawUrl);

                console.log(`[BATCH_FILE_URL_DEBUG] Exact raw fileUrl: ${redactedUrl}`);
                console.log(`[BATCH_FILE_URL_DEBUG] JSON.stringify(fileUrl): ${JSON.stringify(redactedUrl)}`);
                console.log(`[BATCH_FILE_URL_DEBUG] storageKey: ${doc.storageKey}`);
                console.log(`[BATCH_FILE_URL_DEBUG] storageProvider: ${doc.storageProvider}`);
                console.log(`[BATCH_FILE_URL_DEBUG] URL length: ${cleanUrl ? cleanUrl.length : 0}`);
                
                if (cleanUrl) {
                    console.log(`[BATCH_FILE_URL_DEBUG] Contains literal spaces: ${cleanUrl.includes(' ')}`);
                    console.log(`[BATCH_FILE_URL_DEBUG] Contains [ or ]: ${cleanUrl.includes('[') || cleanUrl.includes(']')}`);
                    console.log(`[BATCH_FILE_URL_DEBUG] Contains encoded values: ${/%[0-9A-Fa-f]{2}/.test(cleanUrl)}`);
                    
                    const suspiciousChars = [
                        { char: ' ', label: 'space' },
                        { char: '[', label: '[' },
                        { char: ']', label: ']' },
                        { char: '%', label: '%' },
                        { char: '+', label: '+' },
                        { char: '#', label: '#' },
                        { char: '?', label: '?' },
                        { char: '&', label: '&' },
                        { char: "'", label: 'apostrophe' },
                        { char: '"', label: 'double quote' },
                        { char: '(', label: 'open parenthesis' },
                        { char: ')', label: 'close parenthesis' },
                        { char: '\n', label: 'newline' },
                        { char: '\r', label: 'carriage return' },
                        { char: '\t', label: 'tab' },
                    ];
                    
                    suspiciousChars.forEach(({ char, label }) => {
                        let sidx = cleanUrl.indexOf(char);
                        while (sidx !== -1) {
                            console.log(`[BATCH_FILE_URL_DEBUG][SUSPICIOUS_CHAR] Character '${label}' found at index ${sidx}, charCode: ${char.charCodeAt(0)}`);
                            sidx = cleanUrl.indexOf(char, sidx + 1);
                        }
                    });
                    
                    // Unicode / non-ASCII characters
                    for (let i = 0; i < cleanUrl.length; i++) {
                        const code = cleanUrl.charCodeAt(i);
                        if (code > 127) {
                            console.log(`[BATCH_FILE_URL_DEBUG][SUSPICIOUS_CHAR] Unicode/non-ASCII character '${cleanUrl[i]}' found at index ${i}, charCode: ${code}`);
                        }
                    }
                    
                    try {
                        const parsed = new URL(rawUrl);
                        console.log(`[BATCH_FILE_URL_DEBUG][NATIVE_URL] Success`);
                        console.log(`[BATCH_FILE_URL_DEBUG][NATIVE_URL] href: ${redactUrl(parsed.href)}`);
                        console.log(`[BATCH_FILE_URL_DEBUG][NATIVE_URL] pathname: ${parsed.pathname}`);
                        console.log(`[BATCH_FILE_URL_DEBUG][NATIVE_URL] hostname: ${parsed.hostname}`);
                        console.log(`[BATCH_FILE_URL_DEBUG][NATIVE_URL] protocol: ${parsed.protocol}`);
                    } catch (err) {
                        console.log(`[BATCH_FILE_URL_DEBUG][NATIVE_URL] Threw error: ${err.message}`);
                    }
                }
            } catch (innerErr) {
                console.warn(`[BATCH_FILE_URL_DEBUG] Error processing document index ${idx}: ${innerErr.message}`);
            }
        });
        console.log(`[BATCH_FILE_URL_DEBUG][VALIDATION_FLOW] Pre-validation debug logging complete. Proceeding to validation.`);
    } catch (err) {
        console.error(`[BATCH_FILE_URL_DEBUG] Error in debugBatchFileUrls utility: ${err.message}`);
    }
};

export { normalizeGender } from './genderHelper.util.js';

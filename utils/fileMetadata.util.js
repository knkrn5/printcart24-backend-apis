import mime from 'mime-types';

const normalizeExtension = (extension = '') => extension.replace(/^\./, '').trim().toLowerCase();

export const extractFileMetadataFromUrl = (fileUrl) => {
    if (!fileUrl || typeof fileUrl !== 'string') {
        return {
            originalFileName: '',
            fileExtension: '',
            mimeType: '',
            storageKey: '',
        };
    }

    const trimmed = fileUrl.trim();
    let pathname = '';
    let storageKey = '';

    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
        try {
            const parsedUrl = new URL(trimmed);
            pathname = decodeURIComponent(parsedUrl.pathname || '');
            const segments = pathname.split('/').filter(Boolean);
            const isPathStyleS3Url = /^s3[.-]/i.test(parsedUrl.hostname);
            const storageSegments = isPathStyleS3Url ? segments.slice(1) : segments;
            storageKey = storageSegments.join('/');
        } catch {
            const cleanUrl = trimmed.split('?')[0];
            pathname = decodeURIComponent(cleanUrl);
            storageKey = pathname.replace(/^\/+/, '');
        }
    } else {
        const cleanPath = trimmed.split('?')[0];
        pathname = decodeURIComponent(cleanPath);
        storageKey = pathname.replace(/^\/+/, '');
    }

    const segments = pathname.split('/').filter(Boolean);
    const originalFileName = segments[segments.length - 1] || '';
    const fileExtension = normalizeExtension(originalFileName.split('.').pop() || '');

    return {
        originalFileName,
        fileExtension,
        mimeType: mime.lookup(fileExtension) || '',
        storageKey,
    };
};

export const inferMimeType = ({ extension = '', fallbackMimeType = '' }) => {
    const normalizedExtension = normalizeExtension(extension);
    const lookupMime = mime.lookup(normalizedExtension);
    const isGenericFallback = !fallbackMimeType || [
        'application/octet-stream',
        'binary/octet-stream',
        'application/x-download',
        'application/download',
        'unknown/unknown'
    ].includes(fallbackMimeType.toLowerCase());

    if (lookupMime && (isGenericFallback || !fallbackMimeType)) {
        return lookupMime;
    }

    return fallbackMimeType || lookupMime || 'application/octet-stream';
};

export const getDocumentKind = (extension = '', mimeType = '') => {
    const normalizedExtension = normalizeExtension(extension);
    const normalizedMimeType = String(mimeType || '').toLowerCase();

    if (normalizedExtension === 'pdf' || normalizedMimeType === 'application/pdf') return 'pdf';
    if (
        [
            'doc', 'docx',
            'xls', 'xlsx',
            'ppt', 'pptx',
            'odt', 'ods', 'odp',
            'rtf', 'txt', 'csv',
        ].includes(normalizedExtension)
    ) {
        return 'office';
    }
    if (
        normalizedMimeType.startsWith('image/') ||
        ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'tiff', 'tif', 'svg'].includes(normalizedExtension)
    ) {
        return 'image';
    }
    return 'other';
};

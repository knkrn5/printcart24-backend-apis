// utils/genderHelper.util.js

/**
 * Normalizes and sanitizes a gender string into the standard TitleCase format ('Male', 'Female', 'Other').
 * Accepts any case combination (e.g. 'male', 'MaLe', 'mALe', 'FeMale', 'other') with leading/trailing whitespace.
 *
 * @param {*} value - The input value to normalize
 * @returns {string|null} - 'Male' | 'Female' | 'Other' | '' if valid, or null if invalid
 */
export const normalizeGender = (value) => {
    if (value === null || value === undefined) return null;
    if (typeof value !== 'string') return null;

    const trimmed = value.trim().toLowerCase();
    if (trimmed === '') return '';

    if (trimmed === 'male' || trimmed === 'm') {
        return 'Male';
    }
    if (trimmed === 'female' || trimmed === 'f') {
        return 'Female';
    }
    if (trimmed === 'other' || trimmed === 'o') {
        return 'Other';
    }

    return null;
};

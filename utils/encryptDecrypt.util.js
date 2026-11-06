// utils/encryptDecrypt.util.js
import crypto from 'crypto';
import env from '#configs/env';

// It's crucial to use a secure, randomly generated key and store it safely,
// const ENCRYPTION_KEY = env.ENCRYPTION_KEY; // Must be 32 bytes for aes-256-cbc
// const ALGORITHM = 'aes-256-gcm';
// const IV_LENGTH = 16; // For AES, this is always 16

const ENCRYPTION_KEY = env.ENCRYPTION_KEY;
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // GCM standard

const getKey = () => {
    const keyBuffer = Buffer.from(ENCRYPTION_KEY, 'hex');
    return keyBuffer;
};

/**
 * Encrypts data using AES-256-GCM.
 *
 * Encryption details:
 * - Algorithm: aes-256-gcm
 * - Key: 32-byte hex string (64 hex characters) loaded from env.ENCRYPTION_KEY
 * - IV: 12 random bytes (generated per encryption)
 * - Output format: HEX string of (iv + ciphertext + authTag)
 *
 * @param {string|object} data - Plain text string or serializable object.
 * @returns {string} HEX-encoded string containing IV + ciphertext + GCM auth tag.
 *
 * @throws {Error} If encryption fails.
 */
export const encryptData = (data) => {
    const text = typeof data === 'string' ? data : JSON.stringify(data);
    const key = getKey();
    const iv = crypto.randomBytes(IV_LENGTH);

    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);

    const tag = cipher.getAuthTag();

    // iv + ciphertext + tag
    const combined = Buffer.concat([iv, encrypted, tag]);

    return combined.toString('hex');
};

/**
 * Decrypts data encrypted with encryptData().
 *
 * Expected input format:
 * - HEX string
 * - Structure: (12-byte IV + ciphertext + 16-byte GCM auth tag)
 *
 * Decryption process:
 * - Extract IV (first 12 bytes)
 * - Extract auth tag (last 16 bytes)
 * - Extract ciphertext (middle bytes)
 * - Perform AES-256-GCM decryption
 *
 * @param {string} encryptedData - HEX string containing IV + ciphertext + auth tag.
 * @returns {object|string} Parsed JSON object if valid JSON, otherwise raw string.
 *
 * @throws {Error} If authentication fails or data is malformed.
 */
export const decryptData = (encryptedData) => {
    try {
        const key = getKey();

        // Decode HEX string
        const combined = Buffer.from(encryptedData, 'hex');

        if (combined.length < 12 + 16) {
            throw new Error('Invalid encrypted data.');
        }

        const iv = combined.slice(0, 12);
        const tag = combined.slice(combined.length - 16);
        const ciphertext = combined.slice(12, combined.length - 16);

        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(tag);

        const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

        const result = decrypted.toString('utf8');

        try {
            return JSON.parse(result);
        } catch {
            return result;
        }
    } catch (error) {
        console.error('Decryption failed:', error);
        throw {
            status: 400,
            message: 'Decryption failed. The data may be corrupt or the key may be incorrect.',
        };
    }
};

import env from '#configs/env';

/**
 * Structured error class for SMS delivery failures.
 * Encapsulates the provider error without exposing credentials or internal implementation details.
 */
export class SmsDeliveryError extends Error {
    constructor(message, details = {}) {
        super(message);
        this.name = 'SmsDeliveryError';
        this.statusCode = details.statusCode || 500;
        this.status = details.statusCode || 500;
        this.provider = details.provider || 'unknown';
        this.originalMessage = details.originalMessage || message;
    }
}

/**
 * Normalizes a phone number to E.164 format (+[countryCode][number]).
 * E.164 allows up to 15 digits total after the + sign.
 * @param {string} phoneNumber
 * @returns {string} E.164 formatted number
 */
export const normalizeToE164 = (phoneNumber) => {
    if (!phoneNumber) {
        throw new Error('Phone number is required');
    }

    // Strip whitespaces, dashes, brackets, and any other non-digit/non-plus characters
    let cleaned = phoneNumber.replace(/(?!^\+)\D/g, '');

    // Ensure it starts with '+'
    if (!cleaned.startsWith('+')) {
        cleaned = '+' + cleaned;
    }

    // E.164 format validation regex: + followed by 1 to 15 digits
    const e164Regex = /^\+[1-9]\d{1,14}$/;
    if (!e164Regex.test(cleaned)) {
        throw new Error(
            `Invalid phone number format: "${phoneNumber}". Must conform to E.164 format (+[countryCode][number]).`,
        );
    }

    return cleaned;
};

/**
 * MSG91 SMS Provider (Flow API)
 */
const msg91Provider = {
    async sendOTP(phoneNumber, otp, { expiryMinutes } = {}) {
        const { MSG91_AUTH_KEY, MSG91_TEMPLATE_ID } = env;

        // MSG91 expects number format without leading '+'
        const cleanPhoneNumber = phoneNumber.replace(/^\+/, '');

        try {
            const response = await fetch('https://control.msg91.com/api/v5/flow', {
                method: 'POST',
                headers: {
                    accept: 'application/json',
                    authkey: MSG91_AUTH_KEY,
                    'content-type': 'application/json',
                },
                body: JSON.stringify({
                    template_id: MSG91_TEMPLATE_ID,
                    short_url: '0',
                    recipients: [
                        {
                            mobiles: cleanPhoneNumber,
                            minutes: String(expiryMinutes ?? ''),
                            otp: String(otp),
                        },
                    ],
                }),
            });

            let data;
            const rawText = await response.text();
            try {
                data = JSON.parse(rawText);
            } catch {
                data = rawText;
            }

            if (!response.ok) {
                const originalMessage = typeof data === 'object' ? data?.message || JSON.stringify(data) : String(data);
                throw new SmsDeliveryError('MSG91 provider HTTP error', {
                    statusCode: response.status,
                    provider: 'msg91',
                    originalMessage,
                });
            }

            if (data && (data.type === 'error' || data.status === 'error' || data.type === 'failed')) {
                throw new SmsDeliveryError('MSG91 provider API error response', {
                    statusCode: 400,
                    provider: 'msg91',
                    originalMessage: data.message || JSON.stringify(data),
                });
            }

            return { success: true, providerResponse: data };
        } catch (error) {
            if (error instanceof SmsDeliveryError) {
                throw error;
            }

            throw new SmsDeliveryError('Failed to deliver OTP SMS via MSG91 provider', {
                statusCode: 500,
                provider: 'msg91',
                originalMessage: error.message,
            });
        }
    },
};

/**
 * Console/Mock SMS Provider (useful for local development/testing)
 */
const consoleProvider = {
    async sendOTP(phoneNumber, otp, { expiryMinutes } = {}) {
        console.log(
            `[SMS Mock Provider] Sending OTP ${otp} to ${phoneNumber} (valid for ${expiryMinutes ?? 'N/A'} mins)`,
        );
        return { success: true, message: 'OTP logged to console' };
    },
};

// Provider registry
const providers = {
    msg91: msg91Provider,
    console: consoleProvider,
    mock: consoleProvider,
};

/**
 * Masks a phone number to protect user privacy (E.164 format: +[countryCode][number]).
 * Keeps the first 3 characters (e.g. "+91") and the last 4 characters, replacing the middle with asterisks.
 * @param {string} phoneNumber
 * @returns {string} Masked phone number
 */
export const maskPhoneNumber = (phoneNumber) => {
    if (!phoneNumber) return '';
    if (phoneNumber.length <= 7) {
        return '***';
    }
    const prefix = phoneNumber.substring(0, 3);
    const suffix = phoneNumber.substring(phoneNumber.length - 4);
    const maskedLength = phoneNumber.length - 7;
    const mask = '*'.repeat(maskedLength);
    return `${prefix}${mask}${suffix}`;
};

/**
 * Encapsulates SMS delivery.
 * Normalizes input phone number, delegates to the configured provider, and handles errors cleanly.
 *
 * @param {string} phoneNumber - Phone number (will be normalized to E.164)
 * @param {string} otp - One-time password to send
 * @param {Object|string|number} [options] - Options object ({ expiryMinutes, providerOverride }) or providerOverride string
 * @returns {Promise<any>}
 */
export const sendOTP = async (phoneNumber, otp, options = {}) => {
    const { expiryMinutes, providerOverride = null } =
        typeof options === 'string' ? { providerOverride: options } : options;

    const providerName = (providerOverride || env.SMS_PROVIDER || 'console').toLowerCase();
    const provider = providers[providerName];

    if (!provider) {
        throw new Error(
            `SMS provider "${providerName}" is not supported. Configured SMS_PROVIDER must be one of: ${Object.keys(providers).join(', ')}`,
        );
    }

    // Normalize phone number to E.164
    const normalizedPhone = normalizeToE164(phoneNumber);
    const maskedPhone = maskPhoneNumber(normalizedPhone);
    const startTime = Date.now();

    try {
        const result = await provider.sendOTP(normalizedPhone, otp, { expiryMinutes });
        const latency = Date.now() - startTime;

        // Extract MSG91 request/message ID if present
        const messageId = result?.providerResponse?.message || result?.message || null;

        console.log(
            JSON.stringify({
                event: 'SMS_DELIVERY',
                provider: providerName,
                target: maskedPhone,
                status: 'success',
                messageId,
                latencyMs: latency,
            }),
        );

        return result;
    } catch (error) {
        const latency = Date.now() - startTime;
        let finalError = error;

        if (!(error instanceof SmsDeliveryError)) {
            finalError = new SmsDeliveryError('An unexpected error occurred during SMS delivery', {
                statusCode: 500,
                provider: providerName,
                originalMessage: error.message,
            });
        }

        console.error(
            JSON.stringify({
                event: 'SMS_DELIVERY',
                provider: providerName,
                target: maskedPhone,
                status: 'failure',
                failureReason: finalError.originalMessage || finalError.message,
                latencyMs: latency,
            }),
        );

        throw finalError;
    }
};

export default {
    sendOTP,
    normalizeToE164,
    maskPhoneNumber,
    SmsDeliveryError,
};

// scripts/verify-msg91-flow-sms.script.js
import env from '#configs/env';
import { sendOTP, normalizeToE164, maskPhoneNumber, SmsDeliveryError } from '#services/sms';
import { OTP_EXPIRY_MINUTES } from '#services/otp';

console.log('\n--- 1. Testing Phone Normalization & Masking ---');
const rawPhones = ['+919876543210', '919876543210', '+91 98765 43210', '+91-9876543210'];
for (const p of rawPhones) {
    const norm = normalizeToE164(p);
    const masked = maskPhoneNumber(norm);
    console.log(`Input: "${p}" -> Normalized: "${norm}" -> Masked: "${masked}"`);
    if (!norm.startsWith('+91') || norm.length !== 13) {
        throw new Error(`Normalization failed for ${p}: got ${norm}`);
    }
}
console.log('✅ Phone normalization & masking tests passed.\n');

console.log('--- 2. Testing Console / Mock SMS Provider ---');
const mockResult = await sendOTP('+919876543210', '654321', {
    expiryMinutes: OTP_EXPIRY_MINUTES,
    providerOverride: 'console',
});
console.log('Mock Provider Result:', mockResult);
if (!mockResult.success) {
    throw new Error('Mock provider failed');
}
console.log('✅ Console / Mock provider test passed.\n');

console.log('--- 3. Testing MSG91 Flow Payload & Header Construction (Mocked Fetch) ---');
const originalFetch = globalThis.fetch;
let capturedRequest = null;

globalThis.fetch = async (url, options) => {
    capturedRequest = {
        url,
        method: options.method,
        headers: options.headers,
        body: JSON.parse(options.body),
    };
    return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ message: '336279617367373837313038', type: 'success' }),
    };
};

try {
    const msg91Result = await sendOTP('+919876543210', '123456', {
        expiryMinutes: OTP_EXPIRY_MINUTES,
        providerOverride: 'msg91',
    });

    console.log('Captured URL:', capturedRequest.url);
    console.log('Captured Headers:', {
        ...capturedRequest.headers,
        authkey: capturedRequest.headers.authkey ? '[REDACTED_AUTH_KEY]' : '[MISSING]',
    });
    console.log('Captured Body:', JSON.stringify(capturedRequest.body, null, 2));

    // Assertions
    if (capturedRequest.url !== 'https://control.msg91.com/api/v5/flow') {
        throw new Error(`Invalid URL: ${capturedRequest.url}`);
    }
    if (capturedRequest.method !== 'POST') {
        throw new Error(`Invalid Method: ${capturedRequest.method}`);
    }
    if (capturedRequest.headers['accept'] !== 'application/json') {
        throw new Error(`Missing or invalid accept header`);
    }
    if (capturedRequest.headers['content-type'] !== 'application/json') {
        throw new Error(`Missing or invalid content-type header`);
    }
    if (!capturedRequest.headers['authkey']) {
        throw new Error(`Missing authkey header`);
    }
    if (capturedRequest.body.template_id !== env.MSG91_TEMPLATE_ID) {
        throw new Error(
            `Template ID mismatch: expected ${env.MSG91_TEMPLATE_ID}, got ${capturedRequest.body.template_id}`,
        );
    }
    if (capturedRequest.body.short_url !== '0') {
        throw new Error(`short_url must be "0", got ${capturedRequest.body.short_url}`);
    }
    if (!Array.isArray(capturedRequest.body.recipients) || capturedRequest.body.recipients.length !== 1) {
        throw new Error(`recipients must be array of 1 object`);
    }

    const recipient = capturedRequest.body.recipients[0];
    if (recipient.mobiles !== '919876543210') {
        throw new Error(`Expected mobile without '+': 919876543210, got: ${recipient.mobiles}`);
    }
    if (recipient.minutes !== String(OTP_EXPIRY_MINUTES)) {
        throw new Error(`Expected minutes: "${OTP_EXPIRY_MINUTES}", got: "${recipient.minutes}"`);
    }
    if (recipient.otp !== '123456') {
        throw new Error(`Expected otp: "123456", got: "${recipient.otp}"`);
    }

    console.log('✅ MSG91 Flow API payload and headers verified successfully.\n');
} finally {
    globalThis.fetch = originalFetch;
}

console.log('--- 4. Testing Error Handling (Mocked API Error) ---');
globalThis.fetch = async () => {
    return {
        ok: false,
        status: 400,
        text: async () => JSON.stringify({ message: 'Invalid template ID', type: 'error' }),
    };
};

try {
    let errorCaught = false;
    try {
        await sendOTP('+919876543210', '123456', {
            expiryMinutes: OTP_EXPIRY_MINUTES,
            providerOverride: 'msg91',
        });
    } catch (err) {
        errorCaught = true;
        if (!(err instanceof SmsDeliveryError)) {
            throw new Error(`Expected SmsDeliveryError, got ${err.constructor.name}`);
        }
        if (err.statusCode !== 400) {
            throw new Error(`Expected statusCode 400, got ${err.statusCode}`);
        }
        console.log('Successfully caught SmsDeliveryError:', err.message, '| originalMessage:', err.originalMessage);
    }

    if (!errorCaught) {
        throw new Error('Failed to catch error on HTTP 400 response');
    }
    console.log('✅ Error handling test passed.\n');
} finally {
    globalThis.fetch = originalFetch;
}

console.log('🎉 All MSG91 Flow OTP SMS integration verification tests passed!\n');

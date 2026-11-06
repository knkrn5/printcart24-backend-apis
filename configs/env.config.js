// configs/env.config.js
import { cleanEnv, str, num, bool } from 'envalid';

const env = cleanEnv(process.env, {
    PORT: num({ default: 5100 }),
    NODE_ENV: str({ choices: ['development', 'production', 'test'], default: 'development' }),
    FORCE_GOOGLE_DNS: str({ default: 'false' }),
    DB_URL: str(),

    ACCESS_TOKEN_SECRET: str(),
    ACCESS_TOKEN_EXPIRY: str({ default: '8h' }),

    CORS_ORIGINS: str({ default: '' }),

    // Admin Credentials
    SUPER_ADMIN_NAME: str(),
    SUPER_ADMIN_EMAIL: str(),
    SUPER_ADMIN_PASSWORD: str(),
    SUPER_ADMIN_MOBILE: str(),
    SUPER_ADMIN_IMAGE_URL: str(),

    // AWS S3 / Backblaze B2 Config
    AWS_ACCESS_KEY_ID: str({ default: '' }),
    AWS_SECRET_ACCESS_KEY: str({ default: '' }),
    AWS_REGION: str({ default: '' }),
    AWS_S3_BUCKET_NAME: str({ default: '' }),
    AWS_S3_ENDPOINT: str({ default: '' }),
    USE_S3: str({ default: 'false' }),

    AWS_S3_BASE_URL: str({ default: '' }),

    ENCRYPTION_KEY: str(),

    // Razorpay Secrets
    RAZORPAY_KEY_ID: str(),
    RAZORPAY_KEY_SECRET: str(),
    RAZORPAY_WEBHOOK_SECRET: str(),

    OTP_BYPASS_ENABLED: str(),
    OTP_BYPASS_CODE: str(),
    DISABLE_OTP_VERIFICATION: bool({ default: false }),

    REDIS_URL: str({ default: 'redis://localhost:6379' }),
    ENABLE_REDIS: bool({ default: false }),
    FIXED_PLATFORM_FEE: num({ default: 10 }),
    AVAILABLE_DOCUMENT_TTL_HOURS: num({ default: 1 }),
    WHATSAPP_CONTACT_PHONE: str({ default: '' }),
    DOC_TEMP_DIR: str({ default: '' }),

    // Help and Support Configurations
    SUPPORT_WHATSAPP_NUMBER: str({ default: '' }),
    SUPPORT_CALL_NUMBER: str({ default: '' }),
    SUPPORT_EMAIL: str({ default: '' }),

    // SMS Configurations
    SMS_PROVIDER: str({ default: 'msg91' }),
    MSG91_AUTH_KEY: str({ default: '' }),
    MSG91_TEMPLATE_ID: str({ default: '' }),
    MSG91_SENDER_ID: str({ default: '' }),
    MSG91_ROUTE: str({ default: '4' }),
});

export default env;

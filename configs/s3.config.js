// configs/s3.config.js
import { S3Client } from '@aws-sdk/client-s3';
import env from '#configs/env';

const hasEndpoint = Boolean(env.AWS_S3_ENDPOINT);

export const s3Client = new S3Client({
    region: env.AWS_REGION || 'us-east-005',
    endpoint: hasEndpoint ? env.AWS_S3_ENDPOINT : undefined,
    forcePathStyle: hasEndpoint,
    credentials: {
        accessKeyId: env.AWS_ACCESS_KEY_ID,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    },
});

export const s3Bucket = env.AWS_S3_BUCKET_NAME;

export const getS3PublicUrl = (key) => {
    const cleanKey = String(key || '').replace(/^\/+/, '');

    if (env.AWS_S3_BASE_URL) {
        let baseUrl = env.AWS_S3_BASE_URL.replace(/\/+$/, '');
        try {
            const parsedUrl = new URL(baseUrl);
            if (env.AWS_S3_BUCKET_NAME) {
                const bucketRegex = new RegExp(`/${env.AWS_S3_BUCKET_NAME}$`, 'i');
                if (parsedUrl.hostname.toLowerCase().startsWith(`${env.AWS_S3_BUCKET_NAME.toLowerCase()}.`) && bucketRegex.test(parsedUrl.pathname)) {
                    parsedUrl.pathname = parsedUrl.pathname.replace(bucketRegex, '');
                    baseUrl = parsedUrl.toString().replace(/\/+$/, '');
                }
            }
        } catch {
            // ignore
        }

        const firstSegment = cleanKey.split('/')[0];
        if (firstSegment && baseUrl.endsWith(`/${firstSegment}`)) {
            const strippedKey = cleanKey.substring(firstSegment.length).replace(/^\/+/, '');
            return `${baseUrl}/${strippedKey}`;
        }
        return `${baseUrl}/${cleanKey}`;
    }

    if (hasEndpoint) {
        return `${env.AWS_S3_ENDPOINT.replace(/\/+$/, '')}/${env.AWS_S3_BUCKET_NAME}/${cleanKey}`;
    }

    return `https://${env.AWS_S3_BUCKET_NAME}.s3.${env.AWS_REGION}.amazonaws.com/${cleanKey}`;
};

export const getS3ClientCredentials = () => ({
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    region: env.AWS_REGION,
    bucket: env.AWS_S3_BUCKET_NAME,
    endpoint: env.AWS_S3_ENDPOINT || undefined,
    forcePathStyle: hasEndpoint,
    baseUrl: env.AWS_S3_BASE_URL || undefined,
});

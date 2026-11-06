// utils/s3FolderUpload.util.js
/**
 * Utility to upload all files in a local directory (default: "public/images")
 * to an AWS S3 bucket, preserving the original folder hierarchy.
 *
 * Usage example (in an async context):
 *   import { uploadFolderToS3 } from '#utils/s3FolderUpload.util';
 *   await uploadFolderToS3({
 *     bucket: 'my-bucket',
 *     targetFolder: 'printcart24/assets', // folder inside the bucket
 *     localRoot: 'public/images'          // optional
 *   });
 */

import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { readdir, stat } from 'fs/promises';
import { createReadStream } from 'fs';
import { join, resolve, relative, parse } from 'path';
import env from '#configs/env';

/** Small MIME‑type helper */
function getMimeType(filePath) {
    const ext = filePath.split('.').pop().toLowerCase();
    const types = {
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        gif: 'image/gif',
        svg: 'image/svg+xml',
        webp: 'image/webp',
        pdf: 'application/pdf',
        doc: 'application/msword',
        docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };
    return types[ext] || 'application/octet-stream';
}

/** Recursively walk a directory and return an array of absolute file paths */
async function collectFiles(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    const files = await Promise.all(
        entries.map((entry) => {
            const fullPath = join(dir, entry.name);
            if (entry.isDirectory()) return collectFiles(fullPath);
            if (entry.isFile()) return [fullPath];
            return [];
        }),
    );
    return files.flat();
}

/** Build the S3 key with formatted filename (lowercase, underscores, and timestamp) */
function buildS3Key(localRoot, targetFolder, filePath) {
    const relPath = relative(localRoot, filePath);
    const pathParts = relPath.split(/[\\\/]/);

    // Format each part of the path (folders and filename)
    const formattedParts = pathParts.map((part, index) => {
        const isLast = index === pathParts.length - 1;
        if (isLast) {
            const { name, ext } = parse(part);
            const cleanName = name.toLowerCase().replace(/\s+/g, '_');
            const timestamp = Date.now();
            return `${cleanName}_${timestamp}${ext.toLowerCase()}`;
        }
        return part.toLowerCase().replace(/\s+/g, '_');
    });

    const posixRel = formattedParts.join('/');
    const cleanTarget = targetFolder.replace(/\/+$/g, '').replace(/^\/+/g, '');
    return `${cleanTarget}/${posixRel}`;
}

/** Construct S3 Public URL */
function getPublicUrl(bucket, region, key) {
    return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
}

/** Main exported helper */
export async function uploadFolderToS3({ bucket = env.AWS_S3_BUCKET_NAME, targetFolder, localRoot = 'public/images' }) {
    if (env.USE_S3 !== 'true') {
        console.warn('⚠️  S3 Upload is disabled (USE_S3 is not "true").');
        return { uploadedCount: 0, skippedCount: 0, failedCount: 0, details: [] };
    }

    if (!bucket) throw new Error('Bucket name is required');
    if (!targetFolder) throw new Error('Target folder inside the bucket is required');

    const absoluteRoot = resolve(localRoot);
    const allFiles = await collectFiles(absoluteRoot);

    const s3 = new S3Client({
        region: env.AWS_REGION,
        credentials: {
            accessKeyId: env.AWS_ACCESS_KEY_ID,
            secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
        },
    });

    const summary = {
        totalFiles: allFiles.length,
        uploadedCount: 0,
        skippedCount: 0,
        failedCount: 0,
        details: [], // To store info about each file
        errors: [],
    };

    console.log(`🔎 Scanning: ${absoluteRoot} (${allFiles.length} files found)`);

    for (const filePath of allFiles) {
        const key = buildS3Key(absoluteRoot, targetFolder, filePath);
        const fileStat = await stat(filePath);
        const publicUrl = getPublicUrl(bucket, env.AWS_REGION, key);

        const fileInfo = {
            fileName: filePath.split(/[\\\/]/).pop(),
            localPath: filePath,
            s3Key: key,
            s3Url: publicUrl,
            sizeBytes: fileStat.size,
            status: 'pending',
        };

        try {
            try {
                await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
                fileInfo.status = 'skipped';
                summary.skippedCount++;
                console.log(`⏭️  Skipped: ${key}`);
            } catch (e) {
                const stream = createReadStream(filePath);
                await s3.send(
                    new PutObjectCommand({
                        Bucket: bucket,
                        Key: key,
                        Body: stream,
                        ContentType: getMimeType(filePath),
                    }),
                );
                fileInfo.status = 'uploaded';
                summary.uploadedCount++;
                console.log(`✅ Uploaded: ${key}`);
            }
            summary.details.push(fileInfo);
        } catch (err) {
            fileInfo.status = 'failed';
            fileInfo.error = err.message;
            summary.failedCount++;
            summary.details.push(fileInfo);
            summary.errors.push({ file: filePath, error: err.message });
            console.error(`❌ Failed: ${key} -> ${err.message}`);
        }
    }

    console.log('\n=== Upload Summary ===');
    console.log(`✔️  Successful: ${summary.uploadedCount}`);
    console.log(`⏭️  Skipped: ${summary.skippedCount}`);
    console.log(`❌  Failed: ${summary.failedCount}`);

    return summary;
}

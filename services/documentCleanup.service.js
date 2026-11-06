// services/documentCleanup.service.js
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import fs from 'fs/promises';
import { resolve } from 'path';
import env from '#configs/env';
import PrintDocument from '#models/printDocument';
import { getTempRootDir } from '#utils/tempStorage';

// AWS S3 client instantiation
const s3 = new S3Client({
    region: env.AWS_REGION,
    credentials: {
        accessKeyId: env.AWS_ACCESS_KEY_ID,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    },
});

/**
 * Permanently deletes a file from its storage provider (S3 or Local)
 * @param {Object} document - The PrintDocument record from DB
 */
const deleteFileFromStorage = async (document) => {
    const { storageProvider, storageKey, originalFileName } = document;

    if (!storageKey) return;

    if (storageProvider === 'S3') {
        if (env.USE_S3 !== 'true' || !env.AWS_S3_BUCKET_NAME) {
            return;
        }
        try {
            await s3.send(
                new DeleteObjectCommand({
                    Bucket: env.AWS_S3_BUCKET_NAME,
                    Key: storageKey,
                }),
            );
            console.log(`[DocumentCleanup] ✅ S3 file deleted: ${storageKey} (${originalFileName})`);
        } catch (s3Error) {
            console.error(`[DocumentCleanup] ❌ S3 deletion failed for ${storageKey}:`, s3Error.message);
        }
    } else if (storageProvider === 'LOCAL') {
        try {
            // Safe path resolution inside the workspace
            const localPath = resolve(storageKey);
            await fs.unlink(localPath);
            console.log(`[DocumentCleanup] ✅ Local file deleted: ${storageKey} (${originalFileName})`);
        } catch (localError) {
            // Ignore if file doesn't exist (already deleted)
            if (localError.code !== 'ENOENT') {
                console.error(`[DocumentCleanup] ❌ Local file deletion failed for ${storageKey}:`, localError.message);
            }
        }
    }
};

/**
 * Finds and permanently hard-deletes AVAILABLE print documents
 * created more than 7 days ago. Deletes both the storage files and DB records.
 */
export const cleanupExpiredAvailableDocuments = async () => {
    try {
        const docTtlDays = 7;
        const cutoff = new Date(Date.now() - docTtlDays * 24 * 60 * 60 * 1000);

        // Find expired AVAILABLE documents
        const expiredDocuments = await PrintDocument.find({
            cartStatus: 'AVAILABLE',
            createdAt: { $lt: cutoff },
        })
            .select('_id storageProvider storageKey originalFileName')
            .lean();

        if (expiredDocuments.length === 0) {
            return;
        }

        console.log(
            `[DocumentCleanup] 🔎 Found ${expiredDocuments.length} expired AVAILABLE documents (older than 7 days)`,
        );

        // Process storage deletion and database record deletion in parallel batches
        await Promise.all(
            expiredDocuments.map(async (doc) => {
                // 1. Delete file from storage provider only if not referenced by another live document
                const stillReferenced = doc.storageKey
                    ? await PrintDocument.exists({
                          _id: { $ne: doc._id },
                          storageKey: doc.storageKey,
                          isDeleted: false,
                      })
                    : false;

                if (!stillReferenced) {
                    await deleteFileFromStorage(doc);
                } else {
                    console.log(
                        `[DocumentCleanup] ⏭️ Skipping S3 deletion for ${doc.storageKey} — still referenced by another document`,
                    );
                }

                // 2. Purge DB record
                await PrintDocument.deleteOne({ _id: doc._id });
            }),
        );

        console.log(`[DocumentCleanup] ✅ Completed. Purged ${expiredDocuments.length} documents.`);
    } catch (err) {
        console.error('[DocumentCleanup] ❌ Cleanup cron job failed:', err.message);
    }
};

/**
 * Scans directories where document processing temporary files are stored
 * and removes any stale files or directories older than maxAgeMs (default: 30 minutes).
 *
 * Safe for live production:
 * - Active downloads/page counts usually complete in under 1-2 minutes.
 * - Only items older than 30 minutes (orphaned from previous crashes/OOMs/PM2 kills) are deleted.
 *
 * Targets:
 * 1. Current TEMP_ROOT (e.g. /var/tmp/printcart24-documents or Windows temp)
 * 2. Legacy /tmp/printcart24-documents (if distinct from TEMP_ROOT)
 * 3. Legacy /tmp/printcart24-convert-* directories (orphaned LibreOffice conversions)
 *
 * @param {number} maxAgeMs - Maximum age in ms before a temp file/directory is considered stale (default: 30 mins)
 */
export const cleanupStaleTempProcessingFiles = async (maxAgeMs = 30 * 60 * 1000) => {
    const now = Date.now();
    let cleanedCount = 0;

    const cleanDirectoryEntries = async (dirPath) => {
        try {
            const entries = await fs.readdir(dirPath, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = resolve(dirPath, entry.name);
                try {
                    const st = await fs.stat(fullPath);
                    const ageMs = now - st.mtimeMs;
                    if (ageMs > maxAgeMs) {
                        await fs.rm(fullPath, { recursive: true, force: true });
                        cleanedCount++;
                    }
                } catch {
                    // Ignore if file was already removed or inaccessible
                }
            }
        } catch (dirErr) {
            if (dirErr.code !== 'ENOENT') {
                console.error(`[TempCleanup] Error accessing directory ${dirPath}:`, dirErr.message);
            }
        }
    };

    try {
        const currentTempRoot = getTempRootDir();
        // 1. Clean current TEMP_ROOT
        await cleanDirectoryEntries(currentTempRoot);

        // 2. On Linux/Unix, also clean legacy /tmp/printcart24-documents if distinct from TEMP_ROOT
        const legacyDocTemp = '/tmp/printcart24-documents';
        if (resolve(legacyDocTemp) !== resolve(currentTempRoot)) {
            await cleanDirectoryEntries(legacyDocTemp);
            // If legacy directory is completely empty, remove it to keep /tmp clean
            try {
                const remaining = await fs.readdir(legacyDocTemp);
                if (remaining.length === 0) {
                    await fs.rmdir(legacyDocTemp);
                }
            } catch {
                // Ignore
            }
        }

        // 3. On Linux/Unix, clean any orphaned /tmp/printcart24-convert-* folders
        if (process.platform !== 'win32') {
            try {
                const tmpEntries = await fs.readdir('/tmp', { withFileTypes: true });
                for (const entry of tmpEntries) {
                    if (entry.name.startsWith('printcart24-convert-')) {
                        const fullPath = resolve('/tmp', entry.name);
                        try {
                            const st = await fs.stat(fullPath);
                            if (now - st.mtimeMs > maxAgeMs) {
                                await fs.rm(fullPath, { recursive: true, force: true });
                                cleanedCount++;
                            }
                        } catch {
                            // Ignore
                        }
                    }
                }
            } catch {
                // Ignore if /tmp not readable
            }
        }

        if (cleanedCount > 0) {
            console.log(
                `[TempCleanup] 🧹 Cleaned up ${cleanedCount} stale processing directory/file(s) older than ${Math.round(maxAgeMs / 60000)} minutes.`,
            );
        }
    } catch (err) {
        console.error('[TempCleanup] ❌ Error during stale temp processing cleanup:', err.message);
    }
};

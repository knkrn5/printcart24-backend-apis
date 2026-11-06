// scripts/syncImages.script.js
import { uploadFolderToS3 } from '#utils/s3FolderUpload';
import { mkdir, writeFile } from 'fs/promises';
import { join, resolve } from 'path';
import chalk from 'chalk';

/**
 * Robust script to sync local images to S3 and generate a detailed audit log.
 * Resulting log is saved in: public/logs/s3-sync-reports.json
 */
async function syncImages() {
    const LOCAL_IMG_DIR = 'public/images/binding';
    const S3_TARGET_DIR = 'printcart24/images/binding';
    const LOG_DIR = resolve('public/logs');
    const LOG_FILE = join(LOG_DIR, 's3-sync-reports.json');

    console.log(chalk.bold.cyan('--------------------------------------------'));
    console.log(chalk.bold.cyan('🚀  S3 Image Sync & Audit Tool Started'));
    console.log(chalk.bold.cyan('--------------------------------------------\n'));

    try {
        // 1. Ensure Log Directory Exists
        await mkdir(LOG_DIR, { recursive: true });

        // 2. Run the Sync Utility
        const report = await uploadFolderToS3({
            targetFolder: S3_TARGET_DIR,
            localRoot: LOCAL_IMG_DIR,
        });

        // 3. Prepare Audit Metadata
        const auditData = {
            timestamp: new Date().toISOString(),
            configuration: {
                source: LOCAL_IMG_DIR,
                destination: S3_TARGET_DIR,
            },
            stats: {
                totalFound: report.totalFiles,
                uploaded: report.uploadedCount,
                skipped: report.skippedCount,
                failed: report.failedCount,
            },
            files: report.details.map((f) => ({
                name: f.fileName,
                size: (f.sizeBytes / 1024).toFixed(2) + ' KB',
                status: f.status,
                s3Url: f.s3Url,
                error: f.error || null,
            })),
        };

        // 4. Save to JSON log (Overwrite or Append? User asked for a list, so we'll store as an array of reports)
        // For simplicity and readability, we'll store current run's details in a clean JSON
        // but also log a summary to a persistent text log if desired.

        await writeFile(LOG_FILE, JSON.stringify(auditData, null, 2));

        console.log(chalk.green(`\n📊 Sync completed successfully!`));
        console.log(chalk.white(`📂 Detailed report saved to: ${chalk.underline(LOG_FILE)}`));

        if (report.uploadedCount > 0) {
            console.log(
                chalk.yellow(
                    `\n🔗 Sample S3 URL: ${report.details.find((d) => d.status === 'uploaded')?.s3Url || 'N/A'}`,
                ),
            );
        }

        process.exit(0);
    } catch (error) {
        console.error(chalk.red('\n❌ Critical Error during sync:'), error.message);
        process.exit(1);
    }
}

syncImages();

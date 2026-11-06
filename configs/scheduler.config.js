// configs/scheduler.config.js
import cron from 'node-cron';
import { deactivateExpiredCoupons } from '#services/couponExpiry';
import { permanentlyDeleteAccounts } from '#services/permanentDeletion';
import { cleanupExpiredAvailableDocuments, cleanupStaleTempProcessingFiles } from '#services/documentCleanup';


/**
 * Central cron job registry.
 * All scheduled jobs are defined here.
 * To add a new job: import its function and add a cron.schedule() call below.
 */
const registerJobs = () => {
    // ─── Coupon Expiry ─────────────────────────────────────────────────────────
    // Runs at the top of every hour to deactivate date-expired coupons.
    // Cron: '0 * * * *' → fires at 00:00, 01:00, 02:00 ... 23:00 (wall-clock)
    cron.schedule('0 * * * *', deactivateExpiredCoupons);

    // ─── Permanent Account Deletion ───────────────────────────────────────────
    // Runs every 15 minutes to hard-delete users where isDeleted: true,
    // along with their connected PrintDocuments, Carts, PrintOrders, Notifications.
    // Cron: '*/15 * * * *' → fires at :00, :15, :30, :45 of every hour.
    cron.schedule('*/15 * * * *', permanentlyDeleteAccounts);

    // ─── Stale AVAILABLE Document Purge ──────────────────────────────────────
    // Runs every day at midnight to delete AVAILABLE documents older than 7 days
    // from database and their S3/local file storage.
    // Cron: '0 0 * * *' → fires at 00:00 every day
    cron.schedule('0 0 * * *', cleanupExpiredAvailableDocuments);

    // ─── Stale Temporary Processing Files Purge ──────────────────────────────
    // Runs every 30 minutes to clean up orphaned processing files/folders
    // from interrupted or crashed downloads older than 30 minutes.
    // Cron: '*/30 * * * *' → fires at :00, :30 of every hour.
    cron.schedule('*/30 * * * *', cleanupStaleTempProcessingFiles);
};

export const startScheduler = () => {
    // Run all jobs once immediately on boot to catch anything that expired
    // while the server was down, then let cron handle recurring runs.
    deactivateExpiredCoupons();
    permanentlyDeleteAccounts(); // purge any pending soft-deleted users immediately on boot
    cleanupExpiredAvailableDocuments(); // clean up expired documents immediately on boot
    cleanupStaleTempProcessingFiles(); // clean up any orphaned temp processing files immediately on boot

    registerJobs();
    console.log('[Scheduler] All cron jobs registered.');
};


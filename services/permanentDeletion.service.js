// services/permanentDeletion.service.js
/**
 * Permanent Account Deletion Service
 *
 * Called by the cron scheduler every 15 minutes.
 * Permanently hard-deletes all users where isDeleted: true,
 * along with all their connected data:
 *   - PrintDocuments  (user field)
 *   - Carts           (user field)
 *   - PrintOrders     (user field)
 *   - Notifications   (recipient field)
 *
 * S3 files are NOT deleted (intentional — DB records only).
 * Do NOT call this function directly from controllers.
 */

import User from '#models/user';
import PrintDocument from '#models/printDocument';
import Cart from '#models/cart';
import PrintOrder from '#models/printOrder';
import Notification from '#models/notification';

export const permanentlyDeleteAccounts = async () => {
    try {
        // 1. Find all soft-deleted users
        const deletedUsers = await User.find({ isDeleted: true }).select('_id').lean();

        if (deletedUsers.length === 0) {
            // Nothing to do — log silently at debug level only
            return;
        }

        const userIds = deletedUsers.map((u) => u._id);

        // 2. Delete connected data FIRST (dependency-safe order — users deleted last)
        const [docResult, cartResult, orderResult, notifResult] = await Promise.all([
            PrintDocument.deleteMany({ user: { $in: userIds } }),
            Cart.deleteMany({ user: { $in: userIds } }),
            PrintOrder.deleteMany({ user: { $in: userIds } }),
            Notification.deleteMany({ recipient: { $in: userIds } }),
        ]);

        // 3. Delete users last — only after all connected data is gone
        const userResult = await User.deleteMany({ _id: { $in: userIds } });

        // 4. Log a single summary line for observability
        console.log(
            `[PermanentDeletion] ✅ Purged ${userResult.deletedCount} user(s) | ` +
                `docs:${docResult.deletedCount} | ` +
                `carts:${cartResult.deletedCount} | ` +
                `orders:${orderResult.deletedCount} | ` +
                `notifs:${notifResult.deletedCount}`,
        );
    } catch (error) {
        // Log the error but do NOT re-throw — a failure here must never crash the server.
        // The cron scheduler will retry on the next 15-minute tick automatically.
        console.error('[PermanentDeletion] ❌ Error during permanent deletion:', error.message);
    }
};

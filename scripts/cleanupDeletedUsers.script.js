// scripts/cleanupDeletedUsers.script.js
/**
 * One-time cleanup script to permanently hard-delete all users where
 * isDeleted: true, along with all their connected data:
 *   - PrintDocuments
 *   - Carts
 *   - PrintOrders
 *   - Notifications (personal, i.e. recipient === userId)
 *
 * S3 files are NOT deleted (Option B — DB records only).
 *
 * Usage:
 *   node --env-file=.env scripts/cleanupDeletedUsers.script.js            ← DRY RUN (safe)
 *   node --env-file=.env scripts/cleanupDeletedUsers.script.js --confirm  ← LIVE DESTRUCTIVE RUN
 *
 * Or via npm script (add to package.json if desired):
 *   npm run cleanup:deleted-users
 *   npm run cleanup:deleted-users -- --confirm
 */

import mongoose from 'mongoose';
import chalk from 'chalk';

import { dbConnection } from '#configs/db';
import User from '#models/user';
import PrintDocument from '#models/printDocument';
import Cart from '#models/cart';
import PrintOrder from '#models/printOrder';
import Notification from '#models/notification';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const DIVIDER = '═'.repeat(60);
const THIN_LINE = '─'.repeat(60);

const isConfirm = process.argv.includes('--confirm');

// ─── Main ─────────────────────────────────────────────────────────────────────

(async () => {
    try {
        // ── Header ──────────────────────────────────────────────────────────
        console.log(chalk.bold.cyan(`\n${DIVIDER}`));
        console.log(chalk.bold.cyan(' PrintCart24 — Deleted Users Cleanup Script'));
        if (isConfirm) {
            console.log(chalk.bold.red(' ⚠️  MODE: LIVE / DESTRUCTIVE — data WILL be permanently deleted'));
        } else {
            console.log(chalk.bold.yellow(' MODE: DRY RUN — no data will be modified'));
        }
        console.log(chalk.bold.cyan(`${DIVIDER}\n`));

        // ── Step 1: Connect to Database ─────────────────────────────────────
        await dbConnection();

        // ── Step 2: Find all soft-deleted users ─────────────────────────────
        const deletedUsers = await User.find({ isDeleted: true }).lean();

        if (deletedUsers.length === 0) {
            console.log(chalk.green('✅ No soft-deleted users found. Database is already clean.\n'));
            process.exit(0);
        }

        console.log(chalk.white(`Found ${chalk.bold.red(deletedUsers.length)} soft-deleted user(s) to purge:\n`));

        const userIds = deletedUsers.map((u) => u._id);

        // ── Step 3: Count connected data totals (for summary) ───────────────
        const [totalDocs, totalCarts, totalOrders, totalNotifs] = await Promise.all([
            PrintDocument.countDocuments({ user: { $in: userIds } }),
            Cart.countDocuments({ user: { $in: userIds } }),
            PrintOrder.countDocuments({ user: { $in: userIds } }),
            Notification.countDocuments({ recipient: { $in: userIds } }),
        ]);

        // ── Step 4: Print per-user detail report ────────────────────────────
        for (let i = 0; i < deletedUsers.length; i++) {
            const u = deletedUsers[i];

            // Individual counts per user for granular reporting
            const [uDocs, uCarts, uOrders, uNotifs] = await Promise.all([
                PrintDocument.countDocuments({ user: u._id }),
                Cart.countDocuments({ user: u._id }),
                PrintOrder.countDocuments({ user: u._id }),
                Notification.countDocuments({ recipient: u._id }),
            ]);

            console.log(chalk.bold.white(`  ${i + 1}. User ID : ${u._id}`));
            console.log(chalk.gray(`     Phone   : ${u.phone || '(none)'}`));
            console.log(chalk.gray(`     Email   : ${u.email || '(none)'}`));
            console.log(chalk.gray(`     Deleted : ${u.updatedAt ? new Date(u.updatedAt).toISOString() : 'unknown'}`));
            console.log(chalk.gray(`     ── Connected Data ──────────────────────`));
            console.log(chalk.gray(`     → PrintDocuments : ${uDocs}`));
            console.log(chalk.gray(`     → Carts          : ${uCarts}`));
            console.log(chalk.gray(`     → PrintOrders    : ${uOrders}`));
            console.log(chalk.gray(`     → Notifications  : ${uNotifs}`));
            console.log('');
        }

        // ── Step 5: Summary totals ───────────────────────────────────────────
        console.log(chalk.bold.cyan(THIN_LINE));
        console.log(chalk.bold.white('SUMMARY'));
        console.log(chalk.white(`  Users         : ${chalk.bold.red(deletedUsers.length)}`));
        console.log(chalk.white(`  PrintDocuments: ${chalk.bold.red(totalDocs)}`));
        console.log(chalk.white(`  Carts         : ${chalk.bold.red(totalCarts)}`));
        console.log(chalk.white(`  PrintOrders   : ${chalk.bold.red(totalOrders)}`));
        console.log(chalk.white(`  Notifications : ${chalk.bold.red(totalNotifs)}`));
        console.log(chalk.bold.cyan(THIN_LINE));

        // ── Step 6: Dry-run exits here safely ────────────────────────────────
        if (!isConfirm) {
            console.log(chalk.bold.yellow('\n⚠️  DRY RUN complete — no data was modified.'));
            console.log(chalk.white('   Verify the above list carefully before proceeding.'));
            console.log(chalk.white('   Re-run with --confirm to permanently delete:\n'));
            console.log(chalk.gray('   node --env-file=.env scripts/cleanupDeletedUsers.script.js --confirm\n'));
            process.exit(0);
        }

        // ── Step 7: LIVE destructive deletion ───────────────────────────────
        // Connected data is deleted BEFORE users — dependency-safe order.
        console.log(chalk.bold.red('\n⚠️  Starting permanent deletion...\n'));

        let docsDeleted = 0;
        let cartsDeleted = 0;
        let ordersDeleted = 0;
        let notifsDeleted = 0;
        let usersDeleted = 0;

        try {
            const docResult = await PrintDocument.deleteMany({ user: { $in: userIds } });
            docsDeleted = docResult.deletedCount;
            console.log(chalk.green(`  ✅ PrintDocuments deleted : ${docsDeleted}`));
        } catch (err) {
            console.error(chalk.red(`  ❌ PrintDocuments deletion failed: ${err.message}`));
        }

        try {
            const cartResult = await Cart.deleteMany({ user: { $in: userIds } });
            cartsDeleted = cartResult.deletedCount;
            console.log(chalk.green(`  ✅ Carts deleted          : ${cartsDeleted}`));
        } catch (err) {
            console.error(chalk.red(`  ❌ Carts deletion failed: ${err.message}`));
        }

        try {
            const orderResult = await PrintOrder.deleteMany({ user: { $in: userIds } });
            ordersDeleted = orderResult.deletedCount;
            console.log(chalk.green(`  ✅ PrintOrders deleted    : ${ordersDeleted}`));
        } catch (err) {
            console.error(chalk.red(`  ❌ PrintOrders deletion failed: ${err.message}`));
        }

        try {
            const notifResult = await Notification.deleteMany({ recipient: { $in: userIds } });
            notifsDeleted = notifResult.deletedCount;
            console.log(chalk.green(`  ✅ Notifications deleted  : ${notifsDeleted}`));
        } catch (err) {
            console.error(chalk.red(`  ❌ Notifications deletion failed: ${err.message}`));
        }

        // Delete users last — only after all connected data is successfully gone
        try {
            const userResult = await User.deleteMany({ _id: { $in: userIds } });
            usersDeleted = userResult.deletedCount;
            console.log(chalk.green(`  ✅ Users deleted          : ${usersDeleted}`));
        } catch (err) {
            console.error(chalk.red(`  ❌ Users deletion failed: ${err.message}`));
        }

        // ── Step 8: Post-deletion confirmation summary ───────────────────────
        console.log('');
        console.log(chalk.bold.cyan(THIN_LINE));
        console.log(chalk.bold.green('✅ DELETION COMPLETE'));
        console.log(chalk.white(`  Users deleted         : ${usersDeleted}`));
        console.log(chalk.white(`  PrintDocuments deleted: ${docsDeleted}`));
        console.log(chalk.white(`  Carts deleted         : ${cartsDeleted}`));
        console.log(chalk.white(`  PrintOrders deleted   : ${ordersDeleted}`));
        console.log(chalk.white(`  Notifications deleted : ${notifsDeleted}`));
        console.log(chalk.bold.cyan(THIN_LINE));
        console.log('');

        process.exit(0);
    } catch (error) {
        console.error(chalk.bold.red('\n❌ Fatal error during cleanup:'), error);
        process.exit(1);
    } finally {
        await mongoose.connection.close();
        console.log(chalk.blue('MongoDB connection closed.\n'));
    }
})();

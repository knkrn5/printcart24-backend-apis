// scripts/checkFabricPosterUsage.script.js
import mongoose from 'mongoose';
import chalk from 'chalk';

import { dbConnection } from '#configs/db';
import PrintService from '#models/printService';
import PrintDocument from '#models/printDocument';
import Cart from '#models/cart';
import PrintOrder from '#models/printOrder';

(async () => {
    try {
        console.log(chalk.blue('Connecting to database...'));
        await dbConnection();
        console.log(chalk.green('Database connected successfully.'));

        const targetSlug = 'fabric-poster-foldable';
        console.log(chalk.blue(`Searching for PrintService with slug: '${targetSlug}'...`));
        const service = await PrintService.findOne({ slug: targetSlug });

        if (!service) {
            console.log(
                chalk.yellow(
                    `\n[WARNING] Print service with slug '${targetSlug}' was not found in the database.`
                )
            );
            console.log(chalk.yellow('It might have already been removed or was never seeded. Safe to disable.'));
            process.exit(0);
        }

        const serviceId = service._id;
        console.log(chalk.green(`Found PrintService: "${service.name}" (ID: ${serviceId})`));
        console.log(`Current active status: ${service.isActive ? chalk.green('Active') : chalk.red('Inactive')}\n`);

        console.log(chalk.blue('=== 1. Checking Customized Documents (PrintDocument) ==='));
        const totalDocs = await PrintDocument.countDocuments({ service: serviceId });
        console.log(`Total print documents referencing this service: ${totalDocs}`);

        if (totalDocs > 0) {
            const docsByStatus = await PrintDocument.aggregate([
                { $match: { service: serviceId } },
                { $group: { _id: '$cartStatus', count: { $sum: 1 } } }
            ]);
            console.log(chalk.yellow('Breakdown by cartStatus:'));
            docsByStatus.forEach((item) => {
                console.log(`  - ${item._id}: ${item.count} document(s)`);
            });
        }
        console.log();

        console.log(chalk.blue('=== 2. Checking Shopping Carts (Cart) ==='));
        const totalCarts = await Cart.countDocuments({ 'items.service': serviceId });
        console.log(`Total carts containing this service: ${totalCarts}`);

        if (totalCarts > 0) {
            const cartsByStatus = await Cart.aggregate([
                { $match: { 'items.service': serviceId } },
                { $group: { _id: '$status', count: { $sum: 1 } } }
            ]);
            console.log(chalk.yellow('Breakdown by cart status:'));
            cartsByStatus.forEach((item) => {
                console.log(`  - ${item._id}: ${item.count} cart(s)`);
            });

            // Specific check for ACTIVE carts
            const activeCartsCount = await Cart.countDocuments({
                status: 'ACTIVE',
                'items.service': serviceId
            });
            if (activeCartsCount > 0) {
                console.log(
                    chalk.red(
                        `\n[IMPORTANT] There are ${activeCartsCount} ACTIVE carts containing this category.`
                    )
                );
                console.log(
                    chalk.red(
                        'If disabled, these items will remain in the users\' carts but they may not be able to customize/checkout.'
                    )
                );
            }
        }
        console.log();

        console.log(chalk.blue('=== 3. Checking Orders (PrintOrder) ==='));
        const totalOrders = await PrintOrder.countDocuments({ 'items.service': serviceId });
        console.log(`Total orders containing this service: ${totalOrders}`);

        if (totalOrders > 0) {
            const ordersByStatus = await PrintOrder.aggregate([
                { $match: { 'items.service': serviceId } },
                {
                    $group: {
                        _id: { orderStatus: '$orderStatus', paymentStatus: '$paymentStatus' },
                        count: { $sum: 1 }
                    }
                }
            ]);
            console.log(chalk.yellow('Breakdown by Order Status & Payment Status:'));
            ordersByStatus.forEach((item) => {
                console.log(
                    `  - Order: ${item._id.orderStatus} | Payment: ${item._id.paymentStatus} -> ${item.count} order(s)`
                );
            });

            // Check for active (undelivered & unpaid/pending) orders
            const pendingOrdersCount = await PrintOrder.countDocuments({
                'items.service': serviceId,
                orderStatus: { $in: ['RECEIVED', 'PROCESSED', 'DISPATCHED'] }
            });

            if (pendingOrdersCount > 0) {
                console.log(
                    chalk.red(
                        `\n[CRITICAL] There are ${pendingOrdersCount} ongoing/pending orders for this category.`
                    )
                );
                console.log(
                    chalk.red(
                        'Ensure these pending orders are processed and completed/delivered/cancelled before disabling the service.'
                    )
                );
            } else {
                console.log(chalk.green('\n[SAFE] No active/pending orders found for this category.'));
            }
        } else {
            console.log(chalk.green('\n[SAFE] No orders found containing this category.'));
        }
        console.log();

        console.log(chalk.blue('=== Summary & Recommendation ==='));
        if (totalOrders > 0) {
            console.log(
                chalk.yellow(
                    `Historical data exists (Total Orders: ${totalOrders}). Permanent removal would break DB references.`
                )
            );
            console.log(chalk.green('Disabling is the correct and only safe path.'));
        } else {
            console.log(chalk.green('No historical orders exist. Either disabling or deletion is database-safe.'));
        }

        process.exit(0);
    } catch (error) {
        console.error(chalk.bgRed.white('Error during database check:'), error.message, error);
        process.exit(1);
    } finally {
        await mongoose.connection.close();
        console.log(chalk.blue('MongoDB connection closed.'));
    }
})();

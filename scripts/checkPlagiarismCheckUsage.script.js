// scripts/checkPlagiarismCheckUsage.script.js
import mongoose from 'mongoose';
import chalk from 'chalk';

import { dbConnection } from '#configs/db';
import PrintService from '#models/printService';
import PrintDocument from '#models/printDocument';
import Cart from '#models/cart';
import PrintOrder from '#models/printOrder';

(async () => {
    try {
        await dbConnection();

        // 1. Find the Plagiarism Check service in DB
        const service = await PrintService.findOne({ slug: 'plagiarism-check' });
        if (!service) {
            console.log(chalk.yellow('Plagiarism Check service not found in database. It might not be seeded yet.'));
            process.exit(0);
        }

        const serviceId = service._id;
        console.log(chalk.cyan(`Target Service: Plagiarism Check`));
        console.log(chalk.cyan(`Service ID: ${serviceId}`));
        console.log(chalk.cyan(`Is Active currently: ${service.isActive}\n`));

        // 2. Query Unordered/Available/In-cart Customized Documents
        // Schema: printDocument.model.js
        console.log(chalk.bold.yellow('========================================================================'));
        console.log(chalk.bold.yellow('1. Querying Unordered/Active Customized Documents (PrintDocument)...'));
        console.log(chalk.bold.yellow('========================================================================'));
        const unorderedDocs = await PrintDocument.find({
            service: serviceId,
            cartStatus: { $ne: 'ORDERED' },
            isDeleted: false,
        }).populate('user', 'firstName lastName email phone');

        console.log(chalk.green(`Found ${unorderedDocs.length} unordered customized document(s):\n`));
        unorderedDocs.forEach((doc, idx) => {
            console.log(chalk.blue(`[Document #${idx + 1}]`));
            console.log(`  ID: ${doc._id}`);
            console.log(`  Original File: ${doc.originalFileName || 'N/A'}`);
            console.log(`  File URL: ${doc.fileUrl}`);
            console.log(`  Page Count: ${doc.pageCount}`);
            console.log(`  Cart Status: ${doc.cartStatus}`);
            console.log(`  User: ${doc.user ? `${doc.user.firstName} ${doc.user.lastName} (${doc.user.email})` : 'Unknown'}`);
            console.log(`  Created At: ${doc.createdAt}`);
            console.log('------------------------------------------------------------------------');
        });
        console.log();

        // 3. Query Cart Items containing the service
        // Schema: cart.model.js
        console.log(chalk.bold.yellow('========================================================================'));
        console.log(chalk.bold.yellow('2. Querying Cart Items (Cart)...'));
        console.log(chalk.bold.yellow('========================================================================'));
        const carts = await Cart.find({
            $or: [
                { 'items.service': serviceId },
                { 'items.serviceSnapshot.slug': 'plagiarism-check' },
            ],
        }).populate('user', 'firstName lastName email phone');

        console.log(chalk.green(`Found ${carts.length} cart(s) referencing this service:\n`));
        carts.forEach((cart, idx) => {
            console.log(chalk.blue(`[Cart #${idx + 1}]`));
            console.log(`  Cart ID: ${cart._id}`);
            console.log(`  User: ${cart.user ? `${cart.user.firstName} ${cart.user.lastName} (${cart.user.email})` : 'Unknown'}`);
            console.log(`  Cart Status: ${cart.status}`);
            const matchingItems = cart.items.filter(
                (item) => item.service?.toString() === serviceId.toString() || item.serviceSnapshot?.slug === 'plagiarism-check'
            );
            console.log(`  Matching Plagiarism Check Items: ${matchingItems.length}`);
            matchingItems.forEach((item, itemIdx) => {
                console.log(`    - Item #${itemIdx + 1}:`);
                console.log(`      Item ID: ${item._id}`);
                console.log(`      Document Reference: ${item.document || 'None'}`);
                console.log(`      Service Snapshot: Name: "${item.serviceSnapshot?.name}", Slug: "${item.serviceSnapshot?.slug}"`);
            });
            console.log(`  Updated At: ${cart.updatedAt}`);
            console.log('------------------------------------------------------------------------');
        });
        console.log();

        // 4. Query Order Items containing the service
        // Schema: printOrder.model.js
        console.log(chalk.bold.yellow('========================================================================'));
        console.log(chalk.bold.yellow('3. Querying Active Orders (PrintOrder)...'));
        console.log(chalk.bold.yellow('========================================================================'));
        const activeOrders = await PrintOrder.find({
            $or: [
                { 'items.service': serviceId },
                { 'items.serviceSnapshot.slug': 'plagiarism-check' },
            ],
            orderStatus: { $in: ['RECEIVED', 'PROCESSED', 'DISPATCHED'] },
        }).populate('user', 'firstName lastName email phone');

        console.log(chalk.green(`Found ${activeOrders.length} active/pending order(s):\n`));
        activeOrders.forEach((order, idx) => {
            console.log(chalk.blue(`[Order #${idx + 1}]`));
            console.log(`  Order ID: ${order._id}`);
            console.log(`  Order Number: ${order.orderNumber}`);
            console.log(`  User: ${order.user ? `${order.user.firstName} ${order.user.lastName} (${order.user.email})` : 'Unknown'}`);
            console.log(`  Order Status: ${order.orderStatus}`);
            console.log(`  Grand Total: ${order.priceSummary?.grandTotal || 0} ${order.priceSummary?.currency || 'INR'}`);
            console.log(`  Created At: ${order.createdAt}`);
            console.log('------------------------------------------------------------------------');
        });
        console.log();

        console.log(chalk.bold.yellow('========================================================================'));
        console.log(chalk.bold.yellow('4. Querying Completed/Cancelled Orders (PrintOrder)...'));
        console.log(chalk.bold.yellow('========================================================================'));
        const completedOrders = await PrintOrder.find({
            $or: [
                { 'items.service': serviceId },
                { 'items.serviceSnapshot.slug': 'plagiarism-check' },
            ],
            orderStatus: { $in: ['DELIVERED', 'CANCELLED'] },
        }).populate('user', 'firstName lastName email phone');

        console.log(chalk.green(`Found ${completedOrders.length} completed/cancelled order(s):\n`));
        completedOrders.forEach((order, idx) => {
            console.log(chalk.blue(`[Order #${idx + 1}]`));
            console.log(`  Order ID: ${order._id}`);
            console.log(`  Order Number: ${order.orderNumber}`);
            console.log(`  User: ${order.user ? `${order.user.firstName} ${order.user.lastName} (${order.user.email})` : 'Unknown'}`);
            console.log(`  Order Status: ${order.orderStatus}`);
            console.log(`  Grand Total: ${order.priceSummary?.grandTotal || 0} ${order.priceSummary?.currency || 'INR'}`);
            console.log(`  Created At: ${order.createdAt}`);
            console.log('------------------------------------------------------------------------');
        });
        console.log();

        process.exit(0);
    } catch (error) {
        console.error(chalk.bgRed.white('Error during verification script execution:'), error.message, error);
        process.exit(1);
    } finally {
        await mongoose.connection.close();
        console.log(chalk.blue('MongoDB connection closed.'));
    }
})();

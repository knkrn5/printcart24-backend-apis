// scripts/seedTestOrder.script.js
//
// PURPOSE: Creates a real test order in the database by bypassing Razorpay.
//          Interactively lets you pick an existing user so the order shows up
//          in that user's order section.
//
// USAGE:
//   npm run order:seed                  → Interactive: list users → pick → create order
//   npm run order:seed -- --cleanup     → Remove ALL seed data created by this script
//
// WHAT THIS SCRIPT DOES:
//   1. Connects to MongoDB using env vars from .env
//   2. Lists all active users and lets you select one by number
//   3. Picks 2 active print services (document-printing + digital-printing, or any 2)
//   4. Creates 2 PrintDocument records linked to those services (cartStatus: IN_CART)
//   5. Creates a Cart with those 2 documents (PICKUP mode — no address needed)
//   6. Builds price summaries and inserts a PrintOrder marked PAID/UPI
//   7. Prints the created order _id, orderNumber and ready-to-use API URLs
//
// NOTE: Run `npm run print-services:seed` first if no services exist in the DB.

import readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import mongoose from 'mongoose';
import chalk from 'chalk';
import { dbConnection } from '#configs/db';
import User from '#models/user';
import PrintService from '#models/printService';
import PrintDocument from '#models/printDocument';
import PrintOrder from '#models/printOrder';
import Cart from '#models/cart';
import { buildOrderPriceSummary } from '#controllers/orders';

/* ─────────────────────────────────────────────
   Constants & Flags
───────────────────────────────────────────── */
const SCRIPT_TAG = '[order:seed]';
const CLEANUP_FLAG = process.argv.includes('--cleanup');

// Tag written into razorpayOrderId so --cleanup can find seeded orders
const SEED_ORDER_TAG = 'SEED_ORDER_';

/* ─────────────────────────────────────────────
   Logger helpers
───────────────────────────────────────────── */
const log = {
    info:    (msg) => console.log(chalk.cyan(`${SCRIPT_TAG} ${msg}`)),
    success: (msg) => console.log(chalk.green(`${SCRIPT_TAG} ✅ ${msg}`)),
    warn:    (msg) => console.log(chalk.yellow(`${SCRIPT_TAG} ⚠️  ${msg}`)),
    error:   (msg) => console.error(chalk.red(`${SCRIPT_TAG} ❌ ${msg}`)),
    section: (msg) => console.log(chalk.bold.magenta(`\n${SCRIPT_TAG} ── ${msg} ──`)),
    divider: ()    => console.log(chalk.gray('─'.repeat(60))),
};

/* ─────────────────────────────────────────────
   Currency helpers
───────────────────────────────────────────── */
const roundCurrency = (amount = 0) => Number((Number(amount) || 0).toFixed(2));
const calculateGst  = (amount = 0) => roundCurrency((amount * 18) / 100);

/* ─────────────────────────────────────────────
   Step 1 – List users and let the user pick one
───────────────────────────────────────────── */
const selectUser = async (rl) => {
    log.section('Step 1: Select a user');

    const users = await User.find({ isDeleted: false, isActive: true })
        .select('_id firstName lastName fullName phone email countryCode')
        .sort({ createdAt: -1 })
        .limit(50)
        .lean();

    if (!users.length) {
        log.error('No active users found in the database. Create a user via the app first.');
        process.exit(1);
    }

    console.log('');
    console.log(chalk.bold.white('  Available Users:'));
    console.log(chalk.gray('  ┌────┬──────────────────────────────┬───────────────────────────────────────────────┐'));
    console.log(chalk.gray('  │ #  │ Name                         │ ID / Contact                                  │'));
    console.log(chalk.gray('  ├────┼──────────────────────────────┼───────────────────────────────────────────────┤'));

    users.forEach((u, i) => {
        const num      = String(i + 1).padEnd(3);
        const name     = (u.fullName || `${u.firstName || ''} ${u.lastName || ''}`.trim() || 'Unnamed').padEnd(30).slice(0, 30);
        const contact  = u.phone
            ? `${u.countryCode || ''}${u.phone}`
            : u.email || '—';
        const id       = `${u._id}`;
        const detail   = `${id}  ${contact}`;
        console.log(chalk.white(`  │ ${num}│ ${name} │ ${detail.padEnd(45).slice(0, 45)} │`));
    });

    console.log(chalk.gray('  └────┴──────────────────────────────┴───────────────────────────────────────────────┘'));
    console.log('');

    // Prompt loop until valid input
    let selected = null;
    while (!selected) {
        const answer = await rl.question(chalk.bold.yellow(`  Enter number (1–${users.length}): `));
        const idx = parseInt(answer.trim(), 10) - 1;
        if (!isNaN(idx) && idx >= 0 && idx < users.length) {
            selected = users[idx];
        } else {
            console.log(chalk.red(`  Invalid choice. Please enter a number between 1 and ${users.length}.`));
        }
    }

    const displayName = selected.fullName || `${selected.firstName || ''} ${selected.lastName || ''}`.trim() || 'Unnamed';
    log.success(`Selected → "${displayName}"  (_id: ${selected._id})`);
    return selected;
};

/* ─────────────────────────────────────────────
   Step 2 – Pick 2 active print services
───────────────────────────────────────────── */
const pickTwoServices = async () => {
    log.section('Step 2: Picking 2 active print services');

    const preferred = ['document-printing', 'digital-printing'];
    let services = await PrintService.find({ slug: { $in: preferred }, isActive: true }).lean();

    if (services.length < 2) {
        log.warn('Preferred slugs not fully available. Picking any 2 active services as fallback.');
        services = await PrintService.find({ isActive: true }).limit(2).lean();
    }

    if (services.length < 2) {
        log.error('Need at least 2 active print services in the DB. Run: npm run print-services:seed');
        process.exit(1);
    }

    log.success(`Service 1 → "${services[0].name}" (slug: ${services[0].slug},  basePrice: ₹${services[0].basePrice}/page)`);
    log.success(`Service 2 → "${services[1].name}" (slug: ${services[1].slug},  basePrice: ₹${services[1].basePrice}/page)`);

    return services;
};

/* ─────────────────────────────────────────────
   Step 3 – Create 2 PrintDocument records
───────────────────────────────────────────── */
const createTestDocuments = async (userId, services) => {
    log.section('Step 3: Creating test print documents (cartStatus: IN_CART)');

    const [svc1, svc2] = services;

    const doc1 = await PrintDocument.create({
        user:             userId,
        service:          svc1._id,
        originalFileName: 'test-document-1.pdf',
        fileExtension:    'pdf',
        mimeType:         'application/pdf',
        fileSizeBytes:    102400,
        pageCount:        10,
        storageProvider:  'LOCAL',
        storageKey:       `test/seed/doc1_${Date.now()}.pdf`,
        fileUrl:          'https://example.com/test-document-1.pdf',
        uploadStatus:     'READY',
        cartStatus:       'IN_CART',
        customization: {
            copies:      2,
            orientation: 'PORTRAIT',
            paperSize:   'A4',
            colorMode:   'BW',
            sideMode:    'SINGLE',
            paperQuality: '',
        },
    });

    const doc2 = await PrintDocument.create({
        user:             userId,
        service:          svc2._id,
        originalFileName: 'test-document-2.pdf',
        fileExtension:    'pdf',
        mimeType:         'application/pdf',
        fileSizeBytes:    204800,
        pageCount:        5,
        storageProvider:  'LOCAL',
        storageKey:       `test/seed/doc2_${Date.now()}.pdf`,
        fileUrl:          'https://example.com/test-document-2.pdf',
        uploadStatus:     'READY',
        cartStatus:       'IN_CART',
        customization: {
            copies:      1,
            orientation: 'PORTRAIT',
            paperSize:   'A4',
            colorMode:   'COLOR',
            sideMode:    'SINGLE',
            paperQuality: '',
        },
    });

    log.success(`Doc 1 → _id: ${doc1._id}  (${svc1.name}, 10 pages × 2 copies, B&W)`);
    log.success(`Doc 2 → _id: ${doc2._id}  (${svc2.name},  5 pages × 1 copy,  Color)`);

    return [doc1, doc2];
};

/* ─────────────────────────────────────────────
   Step 4 – Create a Cart with the 2 items
───────────────────────────────────────────── */
const createTestCart = async (userId, services, documents) => {
    log.section('Step 4: Creating test cart (PICKUP mode — no address needed)');

    const [svc1, svc2] = services;
    const [doc1, doc2] = documents;

    // Remove any existing ACTIVE cart for this user so the unique index doesn't block us
    const removed = await Cart.deleteOne({ user: userId, status: 'ACTIVE' });
    if (removed.deletedCount > 0) {
        log.warn('Removed an existing ACTIVE cart for this user to make room.');
    }

    const cart = await Cart.create({
        user:          userId,
        status:        'ACTIVE',
        deliveryMode:  'PICKUP',
        paymentMethod: 'UPI',
        items: [
            {
                service:         svc1._id,
                serviceSnapshot: { name: svc1.name, slug: svc1.slug, serviceType: svc1.serviceType },
                document:        doc1._id,
            },
            {
                service:         svc2._id,
                serviceSnapshot: { name: svc2.name, slug: svc2.slug, serviceType: svc2.serviceType },
                document:        doc2._id,
            },
        ],
        stationeryItems: [],
    });

    log.success(`Cart → _id: ${cart._id}  items: ${cart.items.length}  mode: ${cart.deliveryMode}`);
    return cart;
};

/* ─────────────────────────────────────────────
   Step 5 – Build & insert the order (no Razorpay)
───────────────────────────────────────────── */
const createTestOrder = async (userId, services, documents, cart) => {
    log.section('Step 5: Building and inserting the order (PAID / UPI)');

    const [svc1, svc2] = services;
    const [doc1, doc2] = documents;

    // ── Item 1 pricing ───────────────────────────────────────────────────
    const s1Base   = roundCurrency(doc1.pageCount * (doc1.customization?.copies || 2) * (svc1.basePrice || 3));
    const s1Tax    = calculateGst(s1Base);

    // ── Item 2 pricing (COLOR adds ₹5/page per standard pricing rule) ───
    const colorSurcharge = 5;
    const s2Base   = roundCurrency(doc2.pageCount * (doc2.customization?.copies || 1) * ((svc2.basePrice || 3) + colorSurcharge));
    const s2Tax    = calculateGst(s2Base);

    const orderItems = [
        {
            service: svc1._id,
            serviceSnapshot: { name: svc1.name, slug: svc1.slug, serviceType: svc1.serviceType },
            document: {
                document:         doc1._id,
                originalFileName: '1-A4-BW-x2.pdf',
                fileUrl:          doc1.fileUrl,
                pageCount:        doc1.pageCount,
            },
            customization: {
                copies:               doc1.customization?.copies || 2,
                orientation:          'PORTRAIT',
                paperSize:            'A4',
                colorMode:            'BW',
                sideMode:             'SINGLE',
                paperQuality:         '',
                stickBindingEnabled:  false,
                spiralBindingEnabled: false,
                staplingEnabled:      false,
                bookletOptionCodes:   [],
                selectedBinding:      {},
                selectedAddOns:       [],
                notes:                'Seed test — item 1',
            },
            priceSummary: {
                baseAmount:  s1Base,
                addOnAmount: 0,
                taxAmount:   s1Tax,
                totalAmount: roundCurrency(s1Base + s1Tax),
            },
        },
        {
            service: svc2._id,
            serviceSnapshot: { name: svc2.name, slug: svc2.slug, serviceType: svc2.serviceType },
            document: {
                document:         doc2._id,
                originalFileName: '2-A4-COLOR-x1.pdf',
                fileUrl:          doc2.fileUrl,
                pageCount:        doc2.pageCount,
            },
            customization: {
                copies:               doc2.customization?.copies || 1,
                orientation:          'PORTRAIT',
                paperSize:            'A4',
                colorMode:            'COLOR',
                sideMode:             'SINGLE',
                paperQuality:         '',
                stickBindingEnabled:  false,
                spiralBindingEnabled: false,
                staplingEnabled:      false,
                bookletOptionCodes:   [],
                selectedBinding:      {},
                selectedAddOns:       [],
                notes:                'Seed test — item 2',
            },
            priceSummary: {
                baseAmount:  s2Base,
                addOnAmount: 0,
                taxAmount:   s2Tax,
                totalAmount: roundCurrency(s2Base + s2Tax),
            },
        },
    ];

    const priceSummary = buildOrderPriceSummary(orderItems, [], null);

    const seedTag = `${SEED_ORDER_TAG}${Date.now()}`;

    const [order] = await PrintOrder.create([
        {
            user:              userId,
            cart:              cart._id,
            items:             orderItems,
            stationeryItems:   [],
            deliveryMode:      'PICKUP',
            deliveryAddress:   {},
            appliedCoupon:     { coupon: null, code: '', discountType: '', discountAmount: 0 },
            priceSummary,
            paymentStatus:     'PAID',
            paymentMethod:     'UPI',
            razorpayOrderId:   seedTag,
            razorpayPaymentId: `SEED_PAY_${Date.now()}`,
            razorpaySignature: 'SEED_SIGNATURE',
            paidAt:            new Date(),
            statusHistory: [
                {
                    status:    'RECEIVED',
                    changedBy: null,
                    note:      'Order placed via order:seed script',
                    changedAt: new Date(),
                },
            ],
        },
    ]);

    // Mark documents as ORDERED
    await PrintDocument.updateMany(
        { _id: { $in: [doc1._id, doc2._id] }, user: userId },
        { $set: { cartStatus: 'ORDERED' } },
    );

    // Archive the cart and open a fresh one
    cart.status = 'CHECKED_OUT';
    await cart.save();

    const activeExists = await Cart.exists({ user: userId, status: 'ACTIVE' });
    if (!activeExists) {
        await Cart.create({ user: userId });
        log.info('Fresh ACTIVE cart created for user.');
    }

    return order;
};

/* ─────────────────────────────────────────────
   Cleanup mode
───────────────────────────────────────────── */
const runCleanup = async () => {
    log.section('Cleanup mode: removing all orders created by this seed script');

    // Find orders created by the seed (identified by razorpayOrderId prefix)
    const seededOrders = await PrintOrder.find({
        razorpayOrderId: { $regex: `^${SEED_ORDER_TAG}` },
    }).select('_id user cart items stationeryItems').lean();

    if (!seededOrders.length) {
        log.warn('No seed orders found to clean up.');
        return;
    }

    log.info(`Found ${seededOrders.length} seed order(s) to remove.`);

    for (const order of seededOrders) {
        const docIds = (order.items || []).map((i) => i.document?.document).filter(Boolean);

        await PrintDocument.deleteMany({ _id: { $in: docIds } });
        await Cart.deleteOne({ _id: order.cart });
        await PrintOrder.deleteOne({ _id: order._id });

        log.success(`Removed order ${order._id} + ${docIds.length} document(s) + cart`);
    }

    log.success('Cleanup complete. User accounts were NOT removed.');
};

/* ─────────────────────────────────────────────
   Main
───────────────────────────────────────────── */
(async () => {
    const rl = readline.createInterface({ input, output });

    console.log(chalk.bold.cyan('\n╔══════════════════════════════════════════════╗'));
    console.log(chalk.bold.cyan('║        PrintCart24 — Order Seed Script       ║'));
    console.log(chalk.bold.cyan('╚══════════════════════════════════════════════╝'));
    console.log(chalk.gray(`  Usage:   npm run order:seed`));
    console.log(chalk.gray(`  Cleanup: npm run order:seed -- --cleanup`));
    log.divider();

    try {
        log.info('Connecting to MongoDB...');
        await dbConnection();
        log.success('MongoDB connected.');

        if (CLEANUP_FLAG) {
            console.log(chalk.bold.red('\n  ⚠️  CLEANUP MODE — seed orders + their documents/carts will be removed\n'));
            await runCleanup();
            process.exit(0);
        }

        // ── Interactive flow ─────────────────────────────────────────────
        const user      = await selectUser(rl);
        const services  = await pickTwoServices();
        const documents = await createTestDocuments(user._id, services);
        const cart      = await createTestCart(user._id, services, documents);
        const order     = await createTestOrder(user._id, services, documents, cart);

        const displayName = user.fullName || `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'Unnamed';

        // ── Final summary ────────────────────────────────────────────────
        log.section('Order Created Successfully');
        log.divider();
        console.log(chalk.bold.green(`  Order Number : ${order.orderNumber}`));
        console.log(chalk.bold.green(`  Order ID     : ${order._id}`));
        console.log(chalk.bold.green(`  User         : ${displayName}  (_id: ${user._id})`));
        console.log(chalk.bold.green(`  Payment      : ${order.paymentStatus} (${order.paymentMethod})`));
        console.log(chalk.bold.green(`  Grand Total  : ₹${order.priceSummary?.grandTotal ?? 'N/A'}`));
        console.log(chalk.bold.green(`  Items        : ${order.items?.length ?? 0} print item(s)`));
        log.divider();
        console.log(chalk.bold.yellow(`\n  📌 Test User API (login as this user to see the order):`));
        console.log(chalk.bold.white(`     GET  /api/orders`));
        console.log(chalk.bold.white(`     GET  /api/orders/${order._id}`));
        console.log(chalk.bold.yellow(`\n  📌 Test Admin API:`));
        console.log(chalk.bold.white(`     GET  /api/admin/orders`));
        console.log(chalk.bold.white(`     GET  /api/admin/orders/${order._id}`));
        console.log(chalk.bold.yellow(`\n  📌 To remove this and all other seed orders, run:`));
        console.log(chalk.bold.white(`     npm run order:seed -- --cleanup`));
        log.divider();

        process.exit(0);
    } catch (err) {
        log.error(`Seed script failed: ${err.message}`);
        console.error(err);
        process.exit(1);
    } finally {
        rl.close();
        await mongoose.connection.close();
        log.info('MongoDB connection closed.');
    }
})();

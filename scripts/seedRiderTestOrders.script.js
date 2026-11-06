// scripts/seedRiderTestOrders.script.js
//
// PURPOSE: Creates 5 realistic PrintCart orders for manually testing rider
//          assignment, reassignment, unassignment, and listing flows.
//
// USAGE:
//   node --env-file=.env scripts/seedRiderTestOrders.script.js
//
// WHAT THIS SCRIPT DOES:
//   1. Connects to MongoDB using env vars from .env
//   2. Finds an existing active user, services, and documents
//   3. Creates 5 DELIVERY orders with orderStatus PROCESSED
//   4. All orders start with assignedPartner = null, assignedAt = null
//   5. Skips any order whose reference tag already exists (safe to re-run)
//   6. Prints a summary table with order IDs and details
//
// NOTE: This is a development/test data script only.
//       It does NOT modify any production business logic.

import mongoose from 'mongoose';
import chalk from 'chalk';
import { dbConnection } from '#configs/db';
import User from '#models/user';
import PrintService from '#models/printService';
import PrintDocument from '#models/printDocument';
import PrintOrder from '#models/printOrder';
import { buildOrderPriceSummary } from '#controllers/orders';

/* ─────────────────────────────────────────────
   Static Test-Order Configuration
   ───────────────────────────────────────────── */

/**
 * Add additional test orders by appending another configuration object.
 *
 * @property {string}  reference      - Unique test identifier used for duplicate detection.
 * @property {number}  serviceIndex   - Index into the fetched active services list.
 * @property {number}  documentIndex  - Index into the fetched user documents list.
 * @property {number}  quantity       - Number of copies for this item.
 * @property {string}  colorMode      - 'BW' or 'COLOR'.
 * @property {string}  deliveryMode   - Use 'DELIVERY' for Rider assignment testing.
 * @property {string}  orderStatus    - A valid PrintOrder status (e.g. 'PROCESSED').
 *
 * @example
 * {
 *   reference: 'RIDER-TEST-006',
 *   serviceIndex: 2,
 *   documentIndex: 1,
 *   quantity: 2,
 *   colorMode: 'COLOR',
 *   deliveryMode: 'DELIVERY',
 *   orderStatus: 'PROCESSED',
 * }
 *
 * Add more objects to this array whenever additional test orders are required.
 */
const TEST_ORDERS = [
    {
        reference: 'RIDER-TEST-001',
        serviceIndex: 0,
        documentIndex: 0,
        quantity: 2,
        colorMode: 'BW',
        deliveryMode: 'DELIVERY',
        orderStatus: 'PROCESSED',
    },
    {
        reference: 'RIDER-TEST-002',
        serviceIndex: 0,
        documentIndex: 0,
        quantity: 1,
        colorMode: 'COLOR',
        deliveryMode: 'DELIVERY',
        orderStatus: 'PROCESSED',
    },
    {
        reference: 'RIDER-TEST-003',
        serviceIndex: 1,
        documentIndex: 0,
        quantity: 3,
        colorMode: 'BW',
        deliveryMode: 'DELIVERY',
        orderStatus: 'PROCESSED',
    },
    {
        reference: 'RIDER-TEST-004',
        serviceIndex: 0,
        documentIndex: 0,
        quantity: 1,
        colorMode: 'COLOR',
        deliveryMode: 'DELIVERY',
        orderStatus: 'PROCESSED',
    },
    {
        reference: 'RIDER-TEST-005',
        serviceIndex: 1,
        documentIndex: 0,
        quantity: 5,
        colorMode: 'BW',
        deliveryMode: 'DELIVERY',
        orderStatus: 'PROCESSED',
    },
];

/* ─────────────────────────────────────────────
   Constants & Helpers
   ───────────────────────────────────────────── */
const SCRIPT_TAG = '[seedRiderTestOrders]';
const SEED_TAG_PREFIX = 'RIDER_TEST_';

const log = {
    info:    (msg) => console.log(chalk.cyan(`${SCRIPT_TAG} ${msg}`)),
    success: (msg) => console.log(chalk.green(`${SCRIPT_TAG} ✅ ${msg}`)),
    warn:    (msg) => console.log(chalk.yellow(`${SCRIPT_TAG} ⚠️  ${msg}`)),
    error:   (msg) => console.error(chalk.red(`${SCRIPT_TAG} ❌ ${msg}`)),
    section: (msg) => console.log(chalk.bold.magenta(`\n${SCRIPT_TAG} ── ${msg} ──`)),
    divider: ()    => console.log(chalk.gray('─'.repeat(72))),
};

const roundCurrency = (amount = 0) => Number((Number(amount) || 0).toFixed(2));
const calculateGst  = (amount = 0) => roundCurrency((amount * 18) / 100);

/* ─────────────────────────────────────────────
   Step 1 – Find an existing active user with documents
   ───────────────────────────────────────────── */
const findCustomer = async () => {
    log.section('Step 1: Finding an existing active user');

    // Prefer a user who already has at least one document
    const usersWithDocs = await PrintDocument.aggregate([
        { $match: { isDeleted: false } },
        { $group: { _id: '$user', docCount: { $sum: 1 } } },
        { $sort: { docCount: -1 } },
        { $limit: 1 },
    ]);

    let user = null;

    if (usersWithDocs.length > 0) {
        user = await User.findOne({
            _id: usersWithDocs[0]._id,
            isDeleted: false,
            isActive: true,
        })
            .select('_id firstName lastName fullName phone countryCode email addresses')
            .lean();

        if (user) {
            log.info(`Found user with ${usersWithDocs[0].docCount} existing document(s).`);
        }
    }

    // Fallback: most recent active user
    if (!user) {
        log.warn('No user with existing documents found. Using most recent active user.');
        user = await User.findOne({ isDeleted: false, isActive: true })
            .select('_id firstName lastName fullName phone countryCode email addresses')
            .sort({ createdAt: -1 })
            .lean();
    }

    if (!user) {
        log.error('No active users found. Create a user via the app first.');
        process.exit(1);
    }

    const displayName = user.fullName || `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'Unnamed';
    log.success(`Customer → "${displayName}" (_id: ${user._id})`);

    return user;
};

/* ─────────────────────────────────────────────
   Step 2 – Find available active services
   ───────────────────────────────────────────── */
const findServices = async () => {
    log.section('Step 2: Finding active print services');

    const services = await PrintService.find({ isActive: true })
        .sort({ sortOrder: 1, createdAt: 1 })
        .limit(10)
        .lean();

    if (services.length === 0) {
        log.error('No active print services found. Run: npm run print-services:seed');
        process.exit(1);
    }

    services.forEach((s, i) => {
        log.success(`  [${i}] ${s.name} (slug: ${s.slug}, basePrice: ₹${s.basePrice ?? 'N/A'})`);
    });

    return services;
};

/* ─────────────────────────────────────────────
   Step 3 – Find or create documents for the user
   ───────────────────────────────────────────── */
const findDocuments = async (userId) => {
    log.section('Step 3: Finding existing documents for the user');

    let docs = await PrintDocument.find({ user: userId, isDeleted: false })
        .sort({ createdAt: -1 })
        .limit(10)
        .lean();

    if (docs.length === 0) {
        log.warn('No documents found for this user. Creating 2 test documents for seeding...');
        docs = await createTestDocuments(userId);
    }

    docs.forEach((d, i) => {
        log.success(`  [${i}] ${d.originalFileName || 'unnamed'} (${d.pageCount ?? 0} pages, ${d.mimeType})`);
    });

    return docs;
};

/* ─────────────────────────────────────────────
   Create lightweight test documents when none exist
   ───────────────────────────────────────────── */
const createTestDocuments = async (userId) => {
    const doc1 = await PrintDocument.create({
        user:             userId,
        service:          null,
        originalFileName: 'rider-test-doc-bw.pdf',
        fileExtension:    'pdf',
        mimeType:         'application/pdf',
        fileSizeBytes:    102400,
        pageCount:        10,
        storageProvider:  'LOCAL',
        storageKey:       `test/rider-seed/doc1_${Date.now()}.pdf`,
        fileUrl:          'https://example.com/rider-test-doc-bw.pdf',
        uploadStatus:     'READY',
        cartStatus:       'AVAILABLE',
        customization: {
            copies:      1,
            orientation: 'PORTRAIT',
            paperSize:   'A4',
            colorMode:   'BW',
            sideMode:    'SINGLE',
        },
    });

    const doc2 = await PrintDocument.create({
        user:             userId,
        service:          null,
        originalFileName: 'rider-test-doc-color.pdf',
        fileExtension:    'pdf',
        mimeType:         'application/pdf',
        fileSizeBytes:    204800,
        pageCount:        5,
        storageProvider:  'LOCAL',
        storageKey:       `test/rider-seed/doc2_${Date.now()}.pdf`,
        fileUrl:          'https://example.com/rider-test-doc-color.pdf',
        uploadStatus:     'READY',
        cartStatus:       'AVAILABLE',
        customization: {
            copies:      1,
            orientation: 'PORTRAIT',
            paperSize:   'A4',
            colorMode:   'COLOR',
            sideMode:    'SINGLE',
        },
    });

    log.success(`Created test doc 1 → _id: ${doc1._id} (10 pages, B&W)`);
    log.success(`Created test doc 2 → _id: ${doc2._id} (5 pages, Color)`);

    return [doc1, doc2];
};

/* ─────────────────────────────────────────────
   Step 4 – Build a delivery address snapshot
   ───────────────────────────────────────────── */
const buildDeliveryAddress = (user) => {
    if (user.addresses && user.addresses.length > 0) {
        const addr = user.addresses.find((a) => a.isDefault) || user.addresses[0];
        return {
            addressId:     addr._id || null,
            firstName:     addr.firstName || user.firstName || '',
            lastName:      addr.lastName || user.lastName || '',
            countryCode:   addr.countryCode || user.countryCode || '+91',
            phone:         addr.phone || user.phone || '',
            fullAddress:   addr.fullAddress || '',
            city:          addr.city || '',
            citySlug:      addr.citySlug || '',
            state:         addr.state || '',
            stateCode:     addr.stateCode || '',
            pincode:       addr.pincode || '',
            addressType:   addr.addressType || 'HOME',
            isDefault:     addr.isDefault ?? false,
        };
    }

    return {
        addressId:     null,
        firstName:     user.firstName || 'Test',
        lastName:      user.lastName || 'Customer',
        countryCode:   user.countryCode || '+91',
        phone:         user.phone || '9999999999',
        fullAddress:   '123 Test Street, Development Area',
        city:          'Bangalore',
        citySlug:      'bangalore',
        state:         'Karnataka',
        stateCode:     'KA',
        pincode:       '560001',
        addressType:   'HOME',
        isDefault:     false,
    };
};

/* ─────────────────────────────────────────────
   Step 5 – Create the 5 test orders
   ───────────────────────────────────────────── */
const createTestOrders = async (user, services, documents) => {
    log.section('Step 5: Creating test orders');

    const results = { created: 0, skipped: 0, failed: 0, orders: [] };

    for (const cfg of TEST_ORDERS) {
        const tag = `${SEED_TAG_PREFIX}${cfg.reference}`;

        try {
            // ── Duplicate protection ──
            const existing = await PrintOrder.findOne({ razorpayOrderId: tag })
                .select('_id orderNumber')
                .lean();

            if (existing) {
                log.warn(`${cfg.reference} already exists (orderNumber: ${existing.orderNumber}). Skipping.`);
                results.skipped += 1;

                // Fetch the full order for the summary table
                const fullOrder = await PrintOrder.findOne({ razorpayOrderId: tag })
                    .populate('items.service', 'name slug')
                    .lean();

                results.orders.push({
                    reference:   cfg.reference,
                    orderId:     fullOrder._id,
                    orderNumber: fullOrder.orderNumber,
                    serviceName: fullOrder.items?.[0]?.service?.name || 'N/A',
                    deliveryMode: fullOrder.deliveryMode,
                    orderStatus: fullOrder.orderStatus,
                    assignedPartner: fullOrder.assignedPartner,
                    assignedAt: fullOrder.assignedAt,
                });
                continue;
            }

            // ── Validate indexes ──
            if (cfg.serviceIndex >= services.length) {
                throw new Error(
                    `serviceIndex ${cfg.serviceIndex} is out of range. ` +
                    `Only ${services.length} services available (indices 0–${services.length - 1}).`,
                );
            }
            if (cfg.documentIndex >= documents.length) {
                throw new Error(
                    `documentIndex ${cfg.documentIndex} is out of range. ` +
                    `Only ${documents.length} document(s) available (indices 0–${documents.length - 1}).`,
                );
            }

            const service  = services[cfg.serviceIndex];
            const document = documents[cfg.documentIndex];
            const pageCount = document.pageCount || 1;
            const copies    = cfg.quantity;

            // ── Price calculation ──
            const basePrice = service.basePrice || 3;
            const colorSurcharge = cfg.colorMode === 'COLOR' ? 5 : 0;
            const perPageRate = basePrice + colorSurcharge;
            const itemBase = roundCurrency(pageCount * copies * perPageRate);
            const itemTax  = calculateGst(itemBase);

            const orderItem = {
                service: service._id,
                serviceSnapshot: {
                    name:        service.name,
                    slug:        service.slug,
                    serviceType: service.serviceType,
                },
                document: {
                    document:         document._id,
                    originalFileName: document.originalFileName || 'test-doc.pdf',
                    fileUrl:          document.fileUrl || '',
                    pageCount:        pageCount,
                },
                customization: {
                    copies:               copies,
                    orientation:          'PORTRAIT',
                    paperSize:            'A4',
                    colorMode:            cfg.colorMode,
                    sideMode:             'SINGLE',
                    paperQuality:         '',
                    stickBindingEnabled:  false,
                    spiralBindingEnabled: false,
                    staplingEnabled:      false,
                    bookletOptionCodes:   [],
                    selectedBinding:      {},
                    selectedAddOns:       [],
                    notes:                `Rider test — ${cfg.reference}`,
                    selectedBindingColorCode: '',
                },
                priceSummary: {
                    baseAmount:  itemBase,
                    addOnAmount: 0,
                    taxAmount:   itemTax,
                    totalAmount: roundCurrency(itemBase + itemTax),
                },
            };

            const orderPriceSummary = buildOrderPriceSummary([orderItem], [], null);

            const deliveryAddress = buildDeliveryAddress(user);

            const now = new Date();

            const [order] = await PrintOrder.create([
                {
                    user:              user._id,
                    cart:              null,
                    items:             [orderItem],
                    stationeryItems:   [],
                    deliveryMode:      cfg.deliveryMode,
                    assignedPartner:   null,
                    assignedAt:        null,
                    deliveryAddress:   deliveryAddress,
                    appliedCoupon:     { coupon: null, code: '', discountType: '', discountAmount: 0 },
                    priceSummary:      orderPriceSummary,
                    orderStatus:       cfg.orderStatus,
                    statusHistory: [
                        {
                            status:    'RECEIVED',
                            changedBy: null,
                            note:      'Seed: order created',
                            changedAt: now,
                        },
                        {
                            status:    cfg.orderStatus,
                            changedBy: null,
                            note:      `Seed: set to ${cfg.orderStatus}`,
                            changedAt: now,
                        },
                    ],
                    paymentStatus:     'PAID',
                    paymentMethod:     'UPI',
                    razorpayOrderId:   tag,
                    razorpayPaymentId: `SEED_PAY_${Date.now()}_${cfg.reference}`,
                    razorpaySignature: 'SEED_SIGNATURE',
                    paidAt:            now,
                },
            ]);

            results.created += 1;
            log.success(`${cfg.reference} → orderNumber: ${order.orderNumber}, _id: ${order._id}`);

            results.orders.push({
                reference:   cfg.reference,
                orderId:     order._id,
                orderNumber: order.orderNumber,
                serviceName: service.name,
                deliveryMode: order.deliveryMode,
                orderStatus: order.orderStatus,
                assignedPartner: order.assignedPartner,
                assignedAt: order.assignedAt,
            });
        } catch (err) {
            results.failed += 1;
            log.error(`${cfg.reference} failed: ${err.message}`);
            results.orders.push({
                reference:   cfg.reference,
                orderId:     null,
                orderNumber: null,
                serviceName: 'N/A',
                deliveryMode: cfg.deliveryMode,
                orderStatus: 'FAILED',
                assignedPartner: null,
                assignedAt: null,
                error: err.message,
            });
        }
    }

    return results;
};

/* ─────────────────────────────────────────────
   Step 6 – Print summary table
   ───────────────────────────────────────────── */
const printSummary = (results) => {
    log.section('RIDER TEST ORDERS');
    log.divider();

    const header = [
        'Reference'.padEnd(18),
        'Order Number'.padEnd(18),
        'Service'.padEnd(20),
        'Status'.padEnd(14),
        'Partner'.padEnd(12),
    ].join('  ');

    console.log(chalk.bold.white(`  ${header}`));
    log.divider();

    for (const o of results.orders) {
        const partnerCol = o.assignedPartner ? `${o.assignedPartner}`.slice(0, 10) : 'null';
        const row = [
            (o.reference || '').padEnd(18),
            (o.orderNumber || 'N/A').padEnd(18),
            (o.serviceName || 'N/A').padEnd(20),
            (o.orderStatus || 'N/A').padEnd(14),
            partnerCol.padEnd(12),
        ].join('  ');
        console.log(chalk.white(`  ${row}`));
    }

    log.divider();
    console.log('');
    console.log(chalk.bold.green(`  Created:       ${results.created}`));
    console.log(chalk.bold.yellow(`  Skipped:       ${results.skipped}`));
    console.log(chalk.bold.red(`  Failed:        ${results.failed}`));
    console.log('');

    // Print order IDs for easy Postman copy
    const createdOrders = results.orders.filter((o) => o.orderId);
    if (createdOrders.length > 0) {
        console.log(chalk.bold.cyan('  Order IDs (copy into Postman):'));
        for (const o of createdOrders) {
            console.log(chalk.white(`    ${o.reference}  →  ${o.orderId}`));
        }
    }
    console.log('');
};

/* ─────────────────────────────────────────────
   Main
   ───────────────────────────────────────────── */
(async () => {
    console.log(chalk.bold.cyan('\n╔══════════════════════════════════════════════════════╗'));
    console.log(chalk.bold.cyan('║     PrintCart24 — Rider Test Orders Seed Script     ║'));
    console.log(chalk.bold.cyan('╚══════════════════════════════════════════════════════╝'));
    log.divider();

    try {
        log.info('Connecting to MongoDB...');
        await dbConnection();
        log.success('MongoDB connected.');

        const customer  = await findCustomer();
        const services  = await findServices();
        const documents = await findDocuments(customer._id);

        const results = await createTestOrders(customer, services, documents);
        printSummary(results);

        process.exit(0);
    } catch (err) {
        log.error(`Seed script failed: ${err.message}`);
        console.error(err);
        process.exit(1);
    } finally {
        await mongoose.connection.close();
        log.info('MongoDB connection closed.');
    }
})();

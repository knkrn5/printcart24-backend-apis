// scripts/testBindingAPIDisplay.script.js
import mongoose from 'mongoose';
import chalk from 'chalk';
import { dbConnection } from '#configs/db';
import Cart from '#models/cart';
import PrintDocument from '#models/printDocument';
import PrintService from '#models/printService';
import PrintOrder from '#models/printOrder';
import { buildCartResponse } from '#controllers/cart';
import { getOrderById } from '#controllers/orders';

let passed = 0;
let failed = 0;
const pass = (label) => { console.log(chalk.green(`  ✅ PASS: ${label}`)); passed++; };
const fail = (label) => { console.log(chalk.red(`  ❌ FAIL: ${label}`)); failed++; };

const mockRes = () => {
    const res = {};
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (data) => { res.body = data; return res; };
    return res;
};

const runTest = async () => {
    try {
        await dbConnection();
        console.log(chalk.bold.cyan('\nStarting API Display verification test...'));

        const service = await PrintService.findOne({ slug: 'thesis-printing' }).lean();
        if (!service) {
            fail('thesis-printing service missing, seed first.');
            process.exit(1);
        }

        const mockUserId = new mongoose.Types.ObjectId();

        // 1. Create a dummy document with bindingSelections
        const doc = await PrintDocument.create({
            user: mockUserId,
            service: service._id,
            originalFileName: 'test-cart-display.pdf',
            mimeType: 'application/pdf',
            cartStatus: 'IN_CART',
            fileUrl: 'http://test.local/doc.pdf',
            pageCount: 45,
            customization: {
                copies: 2,
                colorMode: 'COLOR',
                paperSize: 'A4',
                sideMode: 'DOUBLE',
                bindingSelections: [
                    { optionId: 3, subOptionId: null }, // SPIRAL_BINDING (will resolve slab Upto 100 pages, price: 30)
                    { optionId: 4, subOptionId: 1 }     // LANGUAGE (English, price: 500)
                ],
                selectedBindingColorCode: 'RED'
            }
        });

        // 2. Add item to active cart
        const cart = await Cart.create({
            user: mockUserId,
            status: 'ACTIVE',
            items: [{
                service: service._id,
                serviceSnapshot: { name: service.name, slug: service.slug, serviceType: service.serviceType },
                document: doc._id
            }]
        });

        // Test GET /api/cart response builder
        const populatedCart = await Cart.findOne({ user: mockUserId, status: 'ACTIVE' })
            .populate('items.service', '_id')
            .populate('items.document');

        const cartResp = await buildCartResponse(populatedCart);
        const cartCustomization = cartResp?.items?.[0]?.document?.customization;

        if (cartCustomization) {
            pass('Cart customization returns customization object');
            if (Array.isArray(cartCustomization.bindingSelections) && cartCustomization.bindingSelections.length === 2) {
                pass('Cart customization contains 2 bindingSelections');
                const spiral = cartCustomization.bindingSelections.find(b => b.optionCode === 'SPIRAL_BINDING');
                const lang = cartCustomization.bindingSelections.find(b => b.optionCode === 'LANGUAGE');

                if (spiral && spiral.price === 30 && spiral.subOptionCode === 'SPIRAL_SLAB_1') {
                    pass('Spiral binding price and subOptionCode resolved correctly based on pageCount');
                } else {
                    fail(`Spiral binding mismatch: ${JSON.stringify(spiral)}`);
                }

                if (lang && lang.price === 500 && lang.subOptionCode === 'LANG_ENGLISH') {
                    pass('Language binding option resolved correctly');
                } else {
                    fail(`Language binding mismatch: ${JSON.stringify(lang)}`);
                }
            } else {
                fail('bindingSelections is missing or has incorrect length in cart response');
            }

            if (cartCustomization.selectedBindingColorCode === 'RED' && cartCustomization.selectedBindingColorCodeLabel === 'Red') {
                pass('Binding color code and label are populated in cart response');
            } else {
                fail(`Color mismatch: ${cartCustomization.selectedBindingColorCode} / ${cartCustomization.selectedBindingColorCodeLabel}`);
            }
        } else {
            fail('Cart response item does not contain customization');
        }

        // 3. Test GET /api/orders/:id mapping
        // Create an order snapshot representing checkout
        const order = await PrintOrder.create({
            orderNumber: 'TESTORDER01',
            user: mockUserId,
            items: [{
                service: service._id,
                serviceSnapshot: { name: service.name, slug: service.slug, serviceType: service.serviceType },
                document: {
                    document: doc._id,
                    originalFileName: doc.originalFileName,
                    fileUrl: doc.fileUrl,
                    pageCount: doc.pageCount
                },
                customization: {
                    copies: 2,
                    paperSize: 'A4',
                    colorMode: 'COLOR',
                    sideMode: 'DOUBLE',
                    selectedBinding: {},
                    selectedAddOns: [
                        { group: 'BINDING_TOGGLE', code: 'SPIRAL_BINDING', label: 'Upto 100 pages', pricingModel: 'PER_COPY', unitPrice: 30, quantity: 2, totalAmount: 60, optionId: 3, subOptionId: null, subOptionCode: 'SPIRAL_SLAB_1', subOptionLabel: 'Upto 100 pages' },
                        { group: 'BINDING_TOGGLE', code: 'LANGUAGE', label: 'English', pricingModel: 'PER_COPY', unitPrice: 500, quantity: 2, totalAmount: 1000, optionId: 4, subOptionId: 1, subOptionCode: 'LANG_ENGLISH', subOptionLabel: 'English' }
                    ]
                },
                priceSummary: { baseAmount: 600, addOnAmount: 1060, taxAmount: 298.8, totalAmount: 1958.8 }
            }]
        });

        const req = { params: { orderId: order._id.toString() }, user: { id: mockUserId.toString() } };
        const res = mockRes();

        await getOrderById(req, res);

        const orderItem = res.body?.data?.items?.[0];
        const orderItemCustomization = orderItem?.customization;

        if (orderItemCustomization) {
            pass('Order item details contain customization object');
            const selections = orderItemCustomization.bindingSelections;
            if (Array.isArray(selections) && selections.length === 2) {
                pass('Order customization contains 2 bindingSelections');
                const spiral = selections.find(s => s.optionCode === 'SPIRAL_BINDING');
                const lang = selections.find(s => s.optionCode === 'LANGUAGE');

                if (spiral && spiral.price === 30 && spiral.totalAmount === 60 && spiral.quantity === 2 && spiral.optionId === 3 && spiral.subOptionId === null && spiral.subOptionCode === 'SPIRAL_SLAB_1') {
                    pass('Order Spiral Binding resolved correctly from snapshot selectedAddOns');
                } else {
                    fail(`Order Spiral Binding mismatch: ${JSON.stringify(spiral)}`);
                }

                if (lang && lang.price === 500 && lang.totalAmount === 1000 && lang.quantity === 2 && lang.optionId === 4 && lang.subOptionId === 1 && lang.subOptionCode === 'LANG_ENGLISH') {
                    pass('Order Language option resolved correctly from snapshot selectedAddOns');
                } else {
                    fail(`Order Language mismatch: ${JSON.stringify(lang)}`);
                }
            } else {
                fail('bindingSelections missing or incorrect in order detail response');
            }
        } else {
            fail('Order details response does not contain customization on items');
        }

        // Cleanup
        await PrintDocument.deleteMany({ user: mockUserId });
        await Cart.deleteMany({ user: mockUserId });
        await PrintOrder.deleteMany({ user: mockUserId });

        mongoose.connection.close();
        console.log(chalk.bold.cyan('\nAPI Display Test Completed:'));
        console.log(chalk.green(`  Passed: ${passed}`));
        console.log(chalk.red(`  Failed: ${failed}`));
        process.exit(failed > 0 ? 1 : 0);

    } catch (err) {
        console.error(chalk.red('💥 Test crashed:'), err);
        try { mongoose.connection.close(); } catch {}
        process.exit(1);
    }
};

runTest();

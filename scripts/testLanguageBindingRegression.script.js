// scripts/testLanguageBindingRegression.script.js
import mongoose from 'mongoose';
import chalk from 'chalk';
import { dbConnection } from '#configs/db';
import Cart from '#models/cart';
import PrintDocument from '#models/printDocument';
import PrintService from '#models/printService';
import PrintOrder from '#models/printOrder';
import User from '#models/user';
import { placeOrderInternal, getOrderById } from '#controllers/orders';

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
        console.log(chalk.bold.cyan('\nStarting Language Binding Option Regression Test...'));

        const service = await PrintService.findOne({ slug: 'thesis-printing' }).lean();
        if (!service) {
            fail('thesis-printing service missing, seed first.');
            process.exit(1);
        }

        const mockUserId = new mongoose.Types.ObjectId();

        const randomPhone = '9' + Math.floor(100000000 + Math.random() * 900000000);

        // Ensure user exists in database for placeOrderInternal mandatory checks (e.g. phone)
        await User.create({
            _id: mockUserId,
            fullName: 'Test User',
            phone: randomPhone,
            email: `test_${randomPhone}@example.com`,
            addresses: [{
                _id: new mongoose.Types.ObjectId(),
                firstName: 'Test',
                lastName: 'User',
                countryCode: '+91',
                phone: randomPhone,
                fullAddress: 'Test Address Line 1',
                city: 'New Delhi',
                citySlug: 'new-delhi',
                state: 'Delhi',
                stateCode: 'DL',
                pincode: '110001',
                addressType: 'HOME'
            }]
        });

        // 1. Create a dummy document with bindingSelections covering LANGUAGE, STAPLING, and SUMMARY_SYNOPSIS_ABSTRACT_BINDING
        const doc = await PrintDocument.create({
            user: mockUserId,
            service: service._id,
            originalFileName: 'test-regression.pdf',
            mimeType: 'application/pdf',
            cartStatus: 'IN_CART',
            fileUrl: 'https://test.local/doc.pdf',
            pageCount: 45, // will fall into STAPLING Upto 100 pages slab
            customization: {
                copies: 1,
                colorMode: 'BW',
                paperSize: 'A4',
                sideMode: 'SINGLE',
                bindingSelections: [
                    { optionId: 1, subOptionId: null }, // STAPLING (slab)
                    { optionId: 4, subOptionId: 1 },    // LANGUAGE = English
                    { optionId: 7, subOptionId: 1 }     // SUMMARY_SYNOPSIS_ABSTRACT_BINDING = Tape Binding
                ]
            }
        });

        // 2. Add item to active cart
        await Cart.create({
            user: mockUserId,
            status: 'ACTIVE',
            deliveryMode: 'PICKUP', // bypass address requirement check
            items: [{
                service: service._id,
                serviceSnapshot: { name: service.name, slug: service.slug, serviceType: service.serviceType },
                document: doc._id
            }]
        });

        // 3. Place order using internal backend logic (simulates complete order creation)
        console.log(chalk.yellow('  Placing order via placeOrderInternal...'));
        const order = await placeOrderInternal(mockUserId, null, 'ACTIVE');

        // Retrieve order details using order controller endpoint logic
        const req = { params: { orderId: order._id.toString() }, user: { id: mockUserId.toString() } };
        const res = mockRes();

        console.log(chalk.yellow('  Fetching order details via getOrderById...'));
        await getOrderById(req, res);

        const orderItem = res.body?.data?.items?.[0];
        const orderItemCustomization = orderItem?.customization;

        if (orderItemCustomization) {
            pass('Order item contains customization object');
            const selections = orderItemCustomization.bindingSelections;
            if (Array.isArray(selections) && selections.length === 3) {
                pass('Order customization contains all 3 bindingSelections');

                const stapling = selections.find(s => s.optionCode === 'STAPLING');
                const lang = selections.find(s => s.optionCode === 'LANGUAGE');
                const summary = selections.find(s => s.optionCode === 'SUMMARY_SYNOPSIS_ABSTRACT_BINDING');

                // Verify LANGUAGE
                if (lang) {
                    if (lang.optionLabel === 'Language') {
                        pass(`LANGUAGE optionLabel is correctly 'Language'`);
                    } else {
                        fail(`LANGUAGE optionLabel is '${lang.optionLabel}' (Expected: 'Language')`);
                    }

                    if (lang.subOptionLabel === 'English') {
                        pass(`LANGUAGE subOptionLabel is correctly 'English'`);
                    } else {
                        fail(`LANGUAGE subOptionLabel is '${lang.subOptionLabel}' (Expected: 'English')`);
                    }

                    if (lang.optionLabel !== lang.subOptionLabel) {
                        pass(`LANGUAGE does not produce duplicate label (no "English: English")`);
                    } else {
                        fail(`LANGUAGE produces duplicate label: "${lang.optionLabel}: ${lang.subOptionLabel}"`);
                    }
                } else {
                    fail('LANGUAGE selection not found');
                }

                // Verify STAPLING
                if (stapling) {
                    if (stapling.optionLabel === 'Stapling') {
                        pass(`STAPLING optionLabel is correctly 'Stapling'`);
                    } else {
                        fail(`STAPLING optionLabel is '${stapling.optionLabel}' (Expected: 'Stapling')`);
                    }

                    if (stapling.subOptionLabel === 'Upto 100 pages') {
                        pass(`STAPLING subOptionLabel is correctly 'Upto 100 pages'`);
                    } else {
                        fail(`STAPLING subOptionLabel is '${stapling.subOptionLabel}' (Expected: 'Upto 100 pages')`);
                    }
                } else {
                    fail('STAPLING selection not found');
                }

                // Verify SUMMARY_SYNOPSIS_ABSTRACT_BINDING
                if (summary) {
                    if (summary.optionLabel === 'Summary, Synopsis, Abstract Binding') {
                        pass(`SUMMARY_SYNOPSIS_ABSTRACT_BINDING optionLabel is correctly 'Summary, Synopsis, Abstract Binding'`);
                    } else {
                        fail(`SUMMARY_SYNOPSIS_ABSTRACT_BINDING optionLabel is '${summary.optionLabel}' (Expected: 'Summary, Synopsis, Abstract Binding')`);
                    }

                    if (summary.subOptionLabel === 'Tape Binding') {
                        pass(`SUMMARY_SYNOPSIS_ABSTRACT_BINDING subOptionLabel is correctly 'Tape Binding'`);
                    } else {
                        fail(`SUMMARY_SYNOPSIS_ABSTRACT_BINDING subOptionLabel is '${summary.subOptionLabel}' (Expected: 'Tape Binding')`);
                    }
                } else {
                    fail('SUMMARY_SYNOPSIS_ABSTRACT_BINDING selection not found');
                }

            } else {
                fail(`bindingSelections length is ${selections?.length || 0} (Expected: 3)`);
            }
        } else {
            fail('Order details response does not contain customization on items');
        }

        // Cleanup
        console.log(chalk.yellow('  Cleaning up test database records...'));
        await PrintDocument.deleteMany({ user: mockUserId });
        await Cart.deleteMany({ user: mockUserId });
        await PrintOrder.deleteMany({ user: mockUserId });
        await User.deleteOne({ _id: mockUserId });

        mongoose.connection.close();
        console.log(chalk.bold.cyan('\nRegression Test Completed:'));
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

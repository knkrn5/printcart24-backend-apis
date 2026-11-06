// scripts/testCheckoutSideMode.script.js
import mongoose from 'mongoose';
import chalk from 'chalk';
import Razorpay from 'razorpay';
import crypto from 'crypto';
import { dbConnection } from '#configs/db';
import PrintService from '#models/printService';
import PrintDocument from '#models/printDocument';
import Cart from '#models/cart';
import User from '#models/user';
import PrintOrder from '#models/printOrder';
import env from '#configs/env';
import { addPrintItemToCart } from '#controllers/cart';
import { placeOrder, verifyPayment } from '#controllers/orders';

// ── Stub Razorpay calls globally ──────────────────────────────────────────────
Object.defineProperty(Razorpay.prototype, 'orders', {
    get() {
        return {
            create: async (options) => {
                console.log(chalk.yellow(`    [Razorpay Mock] Stubbed orders.create called with:`, JSON.stringify(options)));
                return { id: 'fake_rzp_order_id_' + Date.now() };
            }
        };
    },
    configurable: true
});

Object.defineProperty(Razorpay.prototype, 'payments', {
    get() {
        return {
            fetch: async (paymentId) => {
                console.log(chalk.yellow(`    [Razorpay Mock] Stubbed payments.fetch called for: ${paymentId}`));
                return { method: 'UPI' };
            }
        };
    },
    configurable: true
});

// Helper to generate signature matching env.RAZORPAY_KEY_SECRET
const generateSignature = (orderId, paymentId) => {
    const body = `${orderId}|${paymentId}`;
    return crypto
        .createHmac('sha256', env.RAZORPAY_KEY_SECRET)
        .update(body)
        .digest('hex');
};

const runTests = async () => {
    try {
        await dbConnection();
        console.log(chalk.bold.white('\n🚀 Test Checkout Flow for Documents with Missing Side Mode\n'));

        // 1. SETUP: Create test user
        const testEmail = 'sidemode-tester@test.local';
        const testPhone = '9977553311';
        await User.deleteOne({ email: testEmail });
        await User.deleteOne({ phone: testPhone });

        const user = await User.create({
            firstName: 'SideMode',
            lastName: 'Tester',
            fullName: 'SideMode Tester',
            email: testEmail,
            phone: testPhone,
            isPhoneVerified: true,
            isEmailVerified: true,
        });
        console.log(chalk.green(`Created test user: ${user.fullName} (ID: ${user._id})`));

        // Clean up any old active carts/documents
        await Cart.deleteOne({ user: user._id });
        await PrintDocument.deleteMany({ user: user._id });

        // 2. Fetch print service
        const service = await PrintService.findOne({ slug: 'document-printing', isActive: true }).lean();
        if (!service) {
            console.log(chalk.red('❌ FATAL: "document-printing" service not found. Make sure services are seeded.'));
            process.exit(1);
        }
        console.log(chalk.gray(`Found print service: ${service.name} (ID: ${service._id})`));

        // 3. Create Doc A (with sideMode selected)
        const docA = await PrintDocument.create({
            user: user._id,
            service: service._id,
            originalFileName: 'document-with-sideMode.pdf',
            fileExtension: 'pdf',
            mimeType: 'application/pdf',
            fileSizeBytes: 102400,
            pageCount: 5,
            fileUrl: 'https://appsinvo-stag-dev.s3.ap-south-1.amazonaws.com/PrintCart24/doc-A.pdf',
            storageProvider: 'LOCAL',
            storageKey: 'uploads/doc-A.pdf',
            uploadStatus: 'READY',
            cartStatus: 'AVAILABLE',
            customization: {
                copies: 1,
                orientation: 'PORTRAIT',
                paperSize: 'A4',
                colorMode: 'BW',
                sideMode: 'SINGLE', // Selected side mode
                paperQuality: '',
                completedAt: new Date(),
            }
        });
        console.log(chalk.gray(`Created Doc A (sideMode: 'SINGLE'): ${docA._id}`));

        // 4. Create Doc B (with NO sideMode selected)
        const docB = await PrintDocument.create({
            user: user._id,
            service: service._id,
            originalFileName: 'document-without-sideMode.pdf',
            fileExtension: 'pdf',
            mimeType: 'application/pdf',
            fileSizeBytes: 204800,
            pageCount: 10,
            fileUrl: 'https://appsinvo-stag-dev.s3.ap-south-1.amazonaws.com/PrintCart24/doc-B.pdf',
            storageProvider: 'LOCAL',
            storageKey: 'uploads/doc-B.pdf',
            uploadStatus: 'READY',
            cartStatus: 'AVAILABLE',
            customization: {
                copies: 1,
                orientation: 'PORTRAIT',
                paperSize: 'A4',
                colorMode: 'BW',
                sideMode: '', // NOT selected!
                paperQuality: '',
                completedAt: new Date(),
            }
        });
        console.log(chalk.gray(`Created Doc B (sideMode: ''): ${docB._id}`));

        // 5. Add both to cart one by one
        const mockRes = () => {
            const res = {};
            res.status = (code) => { res.statusCode = code; return res; };
            res.json = (data) => { res.body = data; return res; };
            return res;
        };

        const mockReq = (overrides = {}) => ({
            user: { id: user._id.toString() },
            params: {},
            query: {},
            body: {},
            ...overrides,
        });

        console.log(chalk.cyan('\nAdding Doc A to cart...'));
        const addReqA = mockReq({
            body: {
                serviceId: service._id.toString(),
                documentIds: [docA._id.toString()],
            }
        });
        const addResA = mockRes();
        await addPrintItemToCart(addReqA, addResA);
        console.log(`Add Doc A result: HTTP ${addResA.statusCode}`);

        console.log(chalk.cyan('Adding Doc B to cart...'));
        const addReqB = mockReq({
            body: {
                serviceId: service._id.toString(),
                documentIds: [docB._id.toString()],
            }
        });
        const addResB = mockRes();
        await addPrintItemToCart(addReqB, addResB);
        console.log(`Add Doc B result: HTTP ${addResB.statusCode}`);

        // 6. Initiate Checkout
        console.log(chalk.cyan('\nInitiating checkout (placeOrder)...'));
        const checkoutReq = mockReq({
            body: {
                deliveryMode: 'PICKUP',
                addressId: '',
            }
        });
        const checkoutRes = mockRes();
        await placeOrder(checkoutReq, checkoutRes);
        console.log(`Checkout response status: HTTP ${checkoutRes.statusCode}`);
        
        let checkoutSuccess = checkoutRes.statusCode === 200 && checkoutRes.body?.status === true;
        let finalOrderCreated = false;
        let orderId = null;
        let verifyRes = null;

        if (checkoutSuccess) {
            console.log(chalk.green('  ✅ Checkout initiated successfully!'));
            const rzpOrderId = checkoutRes.body.data.razorpayOrderId;
            const rzpPaymentId = 'pay_fake_' + Date.now();
            const rzpSignature = generateSignature(rzpOrderId, rzpPaymentId);

            // 7. Verify Payment and Finalise Order
            console.log(chalk.cyan('\nFinalising checkout (verifyPayment)...'));
            const verifyReq = mockReq({
                body: {
                    razorpay_order_id: rzpOrderId,
                    razorpay_payment_id: rzpPaymentId,
                    razorpay_signature: rzpSignature,
                }
            });
            verifyRes = mockRes();
            await verifyPayment(verifyReq, verifyRes);
            console.log(`Verify payment result status: HTTP ${verifyRes.statusCode}`);

            if (verifyRes.statusCode === 201 && verifyRes.body?.status === true) {
                finalOrderCreated = true;
                orderId = verifyRes.body.data._id;
                console.log(chalk.green(`  ✅ Order finalized successfully! Order ID: ${orderId}`));
            } else {
                console.log(chalk.red(`  ❌ verifyPayment failed:`, JSON.stringify(verifyRes.body)));
            }
        } else {
            console.log(chalk.red(`  ❌ Checkout initiation failed:`, JSON.stringify(checkoutRes.body)));
        }

        // 8. Analysis & reporting
        console.log(chalk.bold.white('\n' + '═'.repeat(60)));
        console.log(chalk.bold.white('  TEST RESULTS & ANALYSIS'));
        console.log(chalk.bold.white('═'.repeat(60)));

        if (checkoutSuccess && finalOrderCreated && verifyRes.body?.data?.items) {
            const items = verifyRes.body.data.items;
            const itemA = items.find(item => item.originalFileName === 'document-with-sideMode.pdf');
            const itemB = items.find(item => item.originalFileName === 'document-without-sideMode.pdf');

            console.log(chalk.cyan(`  Doc A final sideMode in order: '${itemA?.sideMode}'`));
            console.log(chalk.cyan(`  Doc B final sideMode in order: '${itemB?.sideMode}'`));

            if (itemB?.sideMode === 'SINGLE') {
                console.log(chalk.green('  ✅ SUCCESS: Fallback to SINGLE succeeded!'));
                console.log(chalk.green('     Even though Doc B had no sideMode in DB customization, it checked out with default sideMode "SINGLE".'));
            } else {
                console.log(chalk.red(`  ❌ FAILURE: Fallback did not resolve to SINGLE (got: '${itemB?.sideMode}').`));
            }
        } else {
            console.log(chalk.red('  ❌ Checkout or order finalisation failed.'));
        }
        console.log(chalk.bold.white('═'.repeat(60)));

        // 9. CLEANUP
        console.log(chalk.cyan('\nCleaning up database...'));
        await User.deleteOne({ _id: user._id });
        await PrintDocument.deleteMany({ user: user._id });
        await Cart.deleteOne({ user: user._id });
        if (orderId) {
            await PrintOrder.deleteOne({ _id: orderId });
        }
        console.log(chalk.green('Cleanup completed.'));

        mongoose.connection.close();
        process.exit(0);

    } catch (err) {
        console.error(chalk.bold.red('\n💥 Unhandled error during test:'), err);
        try { mongoose.connection.close(); } catch {}
        process.exit(1);
    }
};

runTests();

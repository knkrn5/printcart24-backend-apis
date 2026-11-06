// scripts/testCartEditCustomizationFlow.script.js
//
// End-to-end test for the Cart Item Edit & Re-Customization flow.
// Simulates exactly what a user and the frontend would do, step by step:
//
//   Step 1 — GET /cart                              (view cart)
//   Step 2 — POST /cart/items/print                 (add document to cart — normal flow)
//   Step 3 — GET /cart                              (verify item is in cart)
//   Step 4 — POST /cart/items/:cartItemId/customize (tap Edit — get pre-filled session)
//   Step 5 — PATCH /print-documents/:documentId     (save changed options)
//   Step 6 — POST /cart/items/print (+ cartItemId)  (confirm back to cart — no duplicate)
//   Step 7 — GET /cart                              (verify cart count & updated pricing)
//   Step 8 — Edge case: edit same item twice (session upsert)
//   Step 9 — Edge case: cartItemId with wrong documentId
//   Step 10 — Edge case: re-customize without initiating session first
//   Step 11 — Cleanup

import mongoose from 'mongoose';
import chalk from 'chalk';
import { dbConnection } from '#configs/db';
import PrintService from '#models/printService';
import PrintDocument from '#models/printDocument';
import PrintCustomization from '#models/printCustomization';
import Cart from '#models/cart';
import { getCart, addPrintItemToCart, initiateCartItemCustomization } from '#controllers/cart';
import { updateDocumentCustomization } from '#controllers/printDocument';

// ── Test counters ─────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
const results = [];

const pass = (label, detail = '') => {
    console.log(chalk.green(`  ✅ PASS: ${label}`) + (detail ? chalk.gray(` — ${detail}`) : ''));
    passed++;
    results.push({ status: 'PASS', label, detail });
};

const fail = (label, detail = '') => {
    console.log(chalk.red(`  ❌ FAIL: ${label}`) + (detail ? chalk.gray(` — ${detail}`) : ''));
    failed++;
    results.push({ status: 'FAIL', label, detail });
};

const section = (title) => console.log(chalk.bold.cyan(`\n${'─'.repeat(60)}\n  ${title}\n${'─'.repeat(60)}`));

// ── Mock Express req/res ──────────────────────────────────────────────────────
const mockRes = () => {
    const res = {};
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (data) => { res.body = data; return res; };
    return res;
};

const mockReq = (overrides = {}) => ({
    user: { id: null },
    params: {},
    query: {},
    body: {},
    ...overrides,
});

// ── Main test runner ──────────────────────────────────────────────────────────
const runTests = async () => {
    try {
        await dbConnection();
        console.log(chalk.bold.white('\n🚀 Cart Edit & Re-Customization Flow — E2E Test\n'));

        // ── SETUP: Fetch required seed data ───────────────────────────────────
        section('SETUP — Fetch seed data & create test user');

        const docPrintingService = await PrintService.findOne({ slug: 'document-printing', isActive: true })
            .select('_id name slug serviceType allowedMimeTypes maxPagesPerFile')
            .lean();

        if (!docPrintingService) {
            console.log(chalk.red('\n  ❌ FATAL: "document-printing" service not found. Run seed first.'));
            process.exit(1);
        }
        console.log(chalk.gray(`  Service found: document-printing (_id: ${docPrintingService._id})`));

        // Create a synthetic user ID (no actual user record needed for controller mocking)
        const mockUserId = new mongoose.Types.ObjectId();
        console.log(chalk.gray(`  Mock user _id: ${mockUserId}`));

        // Create a test document (AVAILABLE status, ready to add to cart)
        const testDoc = await PrintDocument.create({
            user: mockUserId,
            service: docPrintingService._id,
            originalFileName: 'test-report.pdf',
            fileExtension: 'pdf',
            mimeType: 'application/pdf',
            fileSizeBytes: 102400,
            pageCount: 10,
            fileUrl: 'http://test.local/test-report.pdf',
            storageProvider: 'LOCAL',
            storageKey: 'test/test-report.pdf',
            uploadStatus: 'READY',
            cartStatus: 'AVAILABLE',
            customization: {
                copies: 2,
                orientation: 'PORTRAIT',
                paperSize: 'A4',
                colorMode: 'BW',
                sideMode: 'DOUBLE',
                paperQuality: '75GSM',
                staplingEnabled: false,
                stickBindingEnabled: false,
                spiralBindingEnabled: false,
                selectedBindingCode: '',
                selectedBindingColorCode: '',
                bookletOptionCodes: '',
                notes: '',
                completedAt: new Date(),
            },
        });
        console.log(chalk.gray(`  Test document created: ${testDoc._id}`));

        // ── STEP 1 — GET /cart (before anything is in cart) ──────────────────
        section('STEP 1 — GET /cart (empty cart)');
        {
            const req = mockReq({ user: { id: mockUserId.toString() } });
            const res = mockRes();
            await getCart(req, res);

            const body = res.body;
            if (res.statusCode === 200 && body?.status === true && Array.isArray(body?.data?.items)) {
                pass('GET /cart returns 200 with items array', `items count: ${body.data.items.length}`);
            } else {
                fail('GET /cart did not return expected structure', JSON.stringify(body));
            }

            if (body?.data?.items?.length === 0) {
                pass('Cart is initially empty for new user');
            } else {
                fail('Expected empty cart for new mock user', `items: ${body?.data?.items?.length}`);
            }
        }

        // ── STEP 2 — POST /cart/items/print (normal add to cart) ─────────────
        section('STEP 2 — POST /cart/items/print (add document to cart)');
        {
            const req = mockReq({
                user: { id: mockUserId.toString() },
                body: {
                    serviceId: docPrintingService._id.toString(),
                    documentIds: [testDoc._id.toString()],
                },
            });
            const res = mockRes();
            await addPrintItemToCart(req, res);

            if (res.statusCode === 200 && res.body?.status === true) {
                pass('POST /cart/items/print returns 200 success', res.body?.message);
            } else {
                fail('POST /cart/items/print failed', JSON.stringify(res.body));
            }

            // Verify document cartStatus updated to IN_CART
            const updatedDoc = await PrintDocument.findById(testDoc._id).select('cartStatus').lean();
            if (updatedDoc?.cartStatus === 'IN_CART') {
                pass('PrintDocument.cartStatus updated to IN_CART after add to cart');
            } else {
                fail(`PrintDocument.cartStatus not updated — got: ${updatedDoc?.cartStatus}`);
            }
        }

        // ── STEP 3 — GET /cart (verify item is in cart) ───────────────────────
        section('STEP 3 — GET /cart (verify item in cart)');
        let cartItemId = null;
        {
            const req = mockReq({ user: { id: mockUserId.toString() } });
            const res = mockRes();
            await getCart(req, res);

            const items = res.body?.data?.items || [];
            if (items.length === 1) {
                pass('Cart has exactly 1 item after adding', `item _id: ${items[0]._id}`);
                cartItemId = items[0]._id.toString();
            } else {
                fail(`Expected 1 cart item, got: ${items.length}`);
                process.exit(1);
            }

            const cartItem = items[0];
            if (cartItem?.document?._id?.toString() === testDoc._id.toString()) {
                pass('Cart item references correct document');
            } else {
                fail('Cart item document reference mismatch');
            }

            if (cartItem?.document?.customization?.copies === 2) {
                pass('Cart item shows correct copies (2) from initial customization');
            } else {
                fail(`Incorrect copies in cart item — got: ${cartItem?.document?.customization?.copies}`);
            }

            if (typeof cartItem?.totalAmount === 'number') {
                pass(`Cart item has computed totalAmount: ₹${cartItem.totalAmount}`);
            } else {
                fail('Cart item is missing totalAmount');
            }
        }

        // ── STEP 4 — POST /cart/items/:cartItemId/customize (tap Edit) ────────
        section('STEP 4 — POST /cart/items/:cartItemId/customize (initiate edit session)');
        let sessionDocumentId = null;
        let sessionServiceId = null;
        {
            const req = mockReq({
                user: { id: mockUserId.toString() },
                params: { cartItemId },
            });
            const res = mockRes();
            await initiateCartItemCustomization(req, res);

            if (res.statusCode === 200 && res.body?.status === true) {
                pass('POST /cart/items/:cartItemId/customize returns 200', res.body?.message);
            } else {
                fail('Initiate edit session failed', JSON.stringify(res.body));
            }

            const sessionData = res.body?.data;

            if (sessionData?.cartItemId?.toString() === cartItemId) {
                pass('Session.cartItemId matches the cart item');
            } else {
                fail(`Session cartItemId mismatch — got: ${sessionData?.cartItemId}`);
            }

            if (sessionData?.documentId?.toString() === testDoc._id.toString()) {
                pass('Session.documentId references correct document');
            } else {
                fail(`Session documentId mismatch — got: ${sessionData?.documentId}`);
            }

            if (sessionData?.customization?.copies === 2) {
                pass('Session.customization is pre-filled with existing copies (2)');
            } else {
                fail(`Pre-fill failed — expected copies 2, got: ${sessionData?.customization?.copies}`);
            }

            if (sessionData?.customization?.colorMode === 'BW') {
                pass('Session.customization is pre-filled with existing colorMode (BW)');
            } else {
                fail(`Pre-fill failed — expected colorMode BW, got: ${sessionData?.customization?.colorMode}`);
            }

            if (sessionData?.customization?.paperSize === 'A4') {
                pass('Session.customization is pre-filled with existing paperSize (A4)');
            } else {
                fail(`Pre-fill failed — expected paperSize A4, got: ${sessionData?.customization?.paperSize}`);
            }

            if (sessionData?.status === 'PENDING') {
                pass('Session status is PENDING');
            } else {
                fail(`Expected PENDING status, got: ${sessionData?.status}`);
            }

            if (sessionData?.expiresAt) {
                const exp = new Date(sessionData.expiresAt);
                const hoursFromNow = (exp - Date.now()) / 3600000;
                pass(`Session has expiresAt set (~${hoursFromNow.toFixed(1)}h from now)`);
            } else {
                fail('Session missing expiresAt');
            }

            // Verify session doc in DB
            const dbSession = await PrintCustomization.findOne({ cartItemId, user: mockUserId }).lean();
            if (dbSession && dbSession.status === 'PENDING') {
                pass('PrintCustomization document saved to DB with PENDING status');
            } else {
                fail('PrintCustomization document not found in DB or wrong status');
            }

            sessionDocumentId = sessionData?.documentId?.toString();
            sessionServiceId = sessionData?.serviceId?.toString();
        }

        // ── STEP 5 — PATCH /print-documents/:documentId (save new options) ────
        section('STEP 5 — PATCH /print-documents/:documentId (user changes options)');
        {
            // User changes: colorMode BW → COLOR, copies 2 → 3
            const req = mockReq({
                user: { id: mockUserId.toString() },
                params: { documentId: testDoc._id.toString() },
                body: { colorMode: 'COLOR', copies: 3 },
            });
            const res = mockRes();
            await updateDocumentCustomization(req, res);

            if (res.statusCode === 200 && res.body?.status === true) {
                pass('PATCH /print-documents/:documentId returns 200', res.body?.message);
            } else {
                fail('updateDocumentCustomization failed', JSON.stringify(res.body));
            }

            // Verify the document was updated in DB
            const updatedDoc = await PrintDocument.findById(testDoc._id).select('customization').lean();
            if (updatedDoc?.customization?.colorMode === 'COLOR') {
                pass('PrintDocument.colorMode updated to COLOR in DB');
            } else {
                fail(`colorMode not updated — got: ${updatedDoc?.customization?.colorMode}`);
            }

            if (updatedDoc?.customization?.copies === 3) {
                pass('PrintDocument.copies updated to 3 in DB');
            } else {
                fail(`copies not updated — got: ${updatedDoc?.customization?.copies}`);
            }
        }

        // ── STEP 6 — POST /cart/items/print + cartItemId (confirm back to cart) ─
        section('STEP 6 — POST /cart/items/print with cartItemId (confirm re-customization)');
        {
            const req = mockReq({
                user: { id: mockUserId.toString() },
                body: {
                    serviceId: docPrintingService._id.toString(),
                    documentIds: [testDoc._id.toString()],
                    cartItemId,
                },
            });
            const res = mockRes();
            await addPrintItemToCart(req, res);

            if (res.statusCode === 200 && res.body?.status === true) {
                pass('POST /cart/items/print (with cartItemId) returns 200', res.body?.message);
            } else {
                fail('Re-customization confirm call failed', JSON.stringify(res.body));
            }

            // Verify session is now COMPLETED
            const dbSession = await PrintCustomization.findOne({ cartItemId, user: mockUserId }).lean();
            if (dbSession?.status === 'COMPLETED') {
                pass('PrintCustomization session marked as COMPLETED after confirm');
            } else {
                fail(`Session status not COMPLETED — got: ${dbSession?.status}`);
            }
        }

        // ── STEP 7 — GET /cart (verify no duplicate, pricing updated) ─────────
        section('STEP 7 — GET /cart (verify no duplicate item, updated pricing)');
        {
            const req = mockReq({ user: { id: mockUserId.toString() } });
            const res = mockRes();
            await getCart(req, res);

            const items = res.body?.data?.items || [];
            if (items.length === 1) {
                pass('Cart still has exactly 1 item — no duplicate created');
            } else {
                fail(`Expected 1 item, got ${items.length} — DUPLICATE CREATED!`);
            }

            const cartItem = items[0];
            if (cartItem?._id?.toString() === cartItemId) {
                pass('Cart item _id (cartItemId) is unchanged after re-customization');
            } else {
                fail(`Cart item _id changed! Before: ${cartItemId}, After: ${cartItem?._id}`);
            }

            if (cartItem?.document?.customization?.copies === 3) {
                pass('Cart item reflects updated copies (3) from re-customization');
            } else {
                fail(`copies not updated in cart response — got: ${cartItem?.document?.customization?.copies}`);
            }

            if (cartItem?.document?.customization?.colorMode === 'COLOR') {
                pass('Cart item reflects updated colorMode (COLOR) from re-customization');
            } else {
                fail(`colorMode not updated in cart response — got: ${cartItem?.document?.customization?.colorMode}`);
            }

            const pricingBefore = 48; // rough baseline for 2 copies BW
            const newTotal = res.body?.data?.pricing?.grandTotal;
            if (typeof newTotal === 'number' && newTotal > 0) {
                pass(`Cart pricing recalculated successfully — grandTotal: ₹${newTotal}`);
            } else {
                fail('Cart pricing is missing or zero after re-customization');
            }
        }

        // ── STEP 8 — Edge case: Edit same item TWICE (session upsert) ─────────
        section('STEP 8 — Edge case: Edit same item twice (stale session upsert)');
        {
            // First edit initiation
            const req1 = mockReq({ user: { id: mockUserId.toString() }, params: { cartItemId } });
            const res1 = mockRes();
            await initiateCartItemCustomization(req1, res1);
            const firstSessionId = res1.body?.data?._id?.toString();

            // Simulate time passing (not needed — upsert should overwrite immediately)
            // Second edit initiation on same cartItemId
            const req2 = mockReq({ user: { id: mockUserId.toString() }, params: { cartItemId } });
            const res2 = mockRes();
            await initiateCartItemCustomization(req2, res2);
            const secondSessionId = res2.body?.data?._id?.toString();

            if (res2.statusCode === 200) {
                pass('Second initiate on same cartItemId succeeds (session upsert)');
            } else {
                fail('Second initiate on same cartItemId failed', JSON.stringify(res2.body));
            }

            // Only one session document should exist in DB for this cartItemId
            const sessionCount = await PrintCustomization.countDocuments({ cartItemId, user: mockUserId });
            if (sessionCount === 1) {
                pass('Only 1 PrintCustomization document exists for cartItemId (no duplicates in DB)');
            } else {
                fail(`Expected 1 session doc, found ${sessionCount}`);
            }

            // Clean up: mark the pending session from step 8 as completed so step 9 can test cleanly
            await PrintCustomization.findOneAndUpdate(
                { cartItemId, user: mockUserId, status: 'PENDING' },
                { $set: { status: 'COMPLETED' } },
            );
        }

        // ── STEP 9 — Edge case: wrong documentId in re-customize call ─────────
        section('STEP 9 — Edge case: cartItemId with wrong documentId (should reject)');
        {
            // First re-initiate a fresh PENDING session
            const initReq = mockReq({ user: { id: mockUserId.toString() }, params: { cartItemId } });
            const initRes = mockRes();
            await initiateCartItemCustomization(initReq, initRes);

            const fakeDocId = new mongoose.Types.ObjectId().toString();
            const req = mockReq({
                user: { id: mockUserId.toString() },
                body: {
                    serviceId: docPrintingService._id.toString(),
                    documentIds: [fakeDocId],
                    cartItemId,
                },
            });
            const res = mockRes();
            await addPrintItemToCart(req, res);

            if (res.statusCode === 400 && res.body?.status === false) {
                pass('Rejected: documentIds do not match the cart item — correct guard', res.body?.message);
            } else {
                fail('Expected 400 rejection for mismatched documentIds', JSON.stringify(res.body));
            }
        }

        // ── STEP 10 — Edge case: confirm without initiating session first ──────
        section('STEP 10 — Edge case: confirm re-customize without active PENDING session');
        {
            // First, complete the pending session from step 9
            await PrintCustomization.findOneAndUpdate(
                { cartItemId, user: mockUserId, status: 'PENDING' },
                { $set: { status: 'COMPLETED' } },
            );

            // Now try to confirm again — no PENDING session exists
            const req = mockReq({
                user: { id: mockUserId.toString() },
                body: {
                    serviceId: docPrintingService._id.toString(),
                    documentIds: [testDoc._id.toString()],
                    cartItemId,
                },
            });
            const res = mockRes();
            await addPrintItemToCart(req, res);

            if (res.statusCode === 404 && res.body?.status === false) {
                pass('Rejected: no active PENDING session — correct guard', res.body?.message);
            } else {
                fail('Expected 404 rejection when no session exists', JSON.stringify(res.body));
            }
        }

        // ── STEP 11 — Edge case: invalid cartItemId format ────────────────────
        section('STEP 11 — Edge case: invalid cartItemId format');
        {
            const req = mockReq({
                user: { id: mockUserId.toString() },
                params: { cartItemId: 'not-a-valid-id' },
            });
            const res = mockRes();
            await initiateCartItemCustomization(req, res);

            if (res.statusCode === 400 && res.body?.status === false) {
                pass('Rejected: invalid cartItemId format handled correctly', res.body?.message);
            } else {
                fail('Expected 400 for invalid cartItemId format', JSON.stringify(res.body));
            }
        }

        // ── STEP 12 — Edge case: cartItemId not in user's cart ────────────────
        section('STEP 12 — Edge case: cartItemId belonging to different user');
        {
            const otherUserId = new mongoose.Types.ObjectId();
            const req = mockReq({
                user: { id: otherUserId.toString() },
                params: { cartItemId },
            });
            const res = mockRes();
            await initiateCartItemCustomization(req, res);

            // Other user won't have an active cart with this item
            if (res.statusCode === 404 && res.body?.status === false) {
                pass('Rejected: cartItemId not found in other user cart — correct isolation', res.body?.message);
            } else {
                fail('Expected 404 for cartItemId cross-user access', JSON.stringify(res.body));
            }
        }

        // ── CLEANUP ────────────────────────────────────────────────────────────
        section('CLEANUP — Remove test data');
        {
            await PrintDocument.deleteMany({ user: mockUserId });
            await PrintCustomization.deleteMany({ user: mockUserId });
            await Cart.deleteMany({ user: mockUserId });
            pass('All test documents, customization sessions, and cart data deleted');
        }

        // ── FINAL REPORT ───────────────────────────────────────────────────────
        console.log(chalk.bold.white('\n' + '═'.repeat(60)));
        console.log(chalk.bold.white('  FINAL REPORT'));
        console.log(chalk.bold.white('═'.repeat(60)));
        console.log(chalk.bold.green(`  ✅ PASSED : ${passed}`));
        if (failed > 0) {
            console.log(chalk.bold.red(`  ❌ FAILED : ${failed}`));
            console.log(chalk.bold.red('\n  Failed tests:'));
            results.filter(r => r.status === 'FAIL').forEach(r => {
                console.log(chalk.red(`    • ${r.label}`));
                if (r.detail) console.log(chalk.gray(`      ${r.detail}`));
            });
        } else {
            console.log(chalk.bold.green('  All tests passed! 🎉'));
        }
        console.log(chalk.bold.white('═'.repeat(60) + '\n'));

        mongoose.connection.close();
        process.exit(failed > 0 ? 1 : 0);

    } catch (err) {
        console.error(chalk.bold.red('\n💥 Unhandled test failure:'), err);
        try { mongoose.connection.close(); } catch {}
        process.exit(1);
    }
};

runTests();

// scripts/diagCartEditCustomizationBug.script.js
//
// DIAGNOSTIC SCRIPT — Cart Edit Customization Dependency Bug
//
// PURPOSE:
//   Investigate whether `initiateCartItemCustomization` (POST /cart/items/:cartItemId/customize)
//   silently fails or returns 404 in real-world cart scenarios where PrintDocument does NOT
//   have cartStatus = 'IN_CART' or has empty/null customization data.
//
// BUGS BEING PROBED:
//   BUG-1: cartStatus gate — addPrintItemToCart only marks AVAILABLE→IN_CART.
//           If a document was already IN_CART (e.g. added via a previous session and
//           re-added), the updateMany filter `cartStatus: 'AVAILABLE'` skips it,
//           leaving it IN_CART — OK. BUT if for any reason the status is something
//           else (ORDERED, REMOVED, etc.) or the updateMany failed silently,
//           initiateCartItemCustomization's inner findOne with cartStatus:'IN_CART'
//           will return null → 404 "document no longer available".
//
//   BUG-2: The updateMany in addPrintItemToCart ONLY updates documents whose
//           cartStatus is 'AVAILABLE'. If the document was previously IN_CART
//           (from a prior session) and was re-added, the updateMany is a no-op
//           (filter doesn't match) — but the cart item still points to it.
//           That path is fine, BUT:
//           When a document has cartStatus='ORDERED' or 'REMOVED' and somehow ends
//           up referenced in cart.items (data anomaly), initiateCartItemCustomization
//           will block on the cartStatus: 'IN_CART' guard.
//
//   BUG-3 (THE REPORTED BUG): Cart items created via the quick-print path
//           (createQuickPrintDocument) set cartStatus='IN_CART' directly on creation
//           and DO have customization. BUT:
//           - The regular add-to-cart path ALSO accepts documents that were IN_CART
//             (line 393: cartStatus: { $in: ['AVAILABLE', 'IN_CART'] }).
//           - The updateMany (line 448) only sets IN_CART for AVAILABLE ones:
//               { cartStatus: 'AVAILABLE' } → 'IN_CART'
//           - A document that was already IN_CART from a prior session is NOT
//             re-updated by updateMany (it's already IN_CART, fine), but the
//             REAL problem: when the document's customization data is EMPTY or NULL
//             (e.g., created with no customization sub-object), the populate on the
//             cart's items.document field returns the doc but customization is {}.
//             The initiateCartItemCustomization still creates the session (no issue
//             with data). SO this is actually fine...
//
//   BUG-4 (ROOT CAUSE of reported issue):
//           The `initiateCartItemCustomization` function has a SECOND, REDUNDANT
//           document lookup (lines 510–523) with a hard filter cartStatus:'IN_CART'.
//           This lookup is INDEPENDENT from what was already populated from cart.
//           If the document exists and is linked to the cart, but its cartStatus
//           in the DB is NOT 'IN_CART' (e.g., due to a race condition, a prior
//           remove-and-re-add cycle, or an update that left it in ORDERED/REMOVED),
//           this secondary findOne returns null and the endpoint returns 404
//           even though the cart item IS valid and the document IS accessible
//           via the cart populate.
//
//           THE KEY SCENARIO (exact bug):
//           Document is created via batch API without customization data.
//           User adds to cart → updateMany sets cartStatus=IN_CART.
//           User clicks Edit → initiateCartItemCustomization is called.
//           The FIRST populate (cart.populate) DOES return the document.
//           The SECOND findOne with cartStatus:'IN_CART' ALSO returns the document.
//           → This should work. So what's the actual failing scenario?
//
//           THE REAL FAILING SCENARIO:
//           User adds a document to cart → cartStatus = IN_CART (correct).
//           At some point the order is placed → cartStatus = ORDERED.
//           User tries to add the SAME document back to a new cart (maybe cancelled
//           order). The addPrintItemToCart accepts documents with
//           cartStatus: { $in: ['AVAILABLE', 'IN_CART'] } — ORDERED is NOT in this
//           list, so it won't be added this way.
//
//           BUT — the quick-print path creates the document with cartStatus='IN_CART'
//           and directly pushes to cart. If user re-opens the app, the old cart has
//           items referencing documents that are now ORDERED. Clicking edit → 404.
//
//           SIMPLEST REAL BUG:
//           The populate in initiateCartItemCustomization uses:
//               .populate('items.document', '_id service customization')
//           If the document was DELETED (isDeleted: true), populate STILL returns
//           the document object (populate doesn't filter by isDeleted). Then the
//           secondary findOne with isDeleted:false returns null → 404.
//
//           Even simpler: if the referenced document record simply doesn't exist
//           in print_documents (orphaned cart item), populate returns null for
//           item.document, and we hit the 'no linked document' guard.
//
// CONCLUSION: The dependency is the SECOND PrintDocument.findOne with
//             cartStatus:'IN_CART' guard (lines 510-523). This is overly strict
//             for the purpose of initiating a customization session. The cart item
//             already proves the document belongs to this cart. The only required
//             checks should be: document exists + not deleted. cartStatus should
//             NOT gate whether a customization session can start.
//
// TEST PLAN (12 scenarios):
//   Scenario A — Happy path (existing test, should still pass)
//   Scenario B — Document exists, cartStatus = 'AVAILABLE' (never updated to IN_CART)
//   Scenario C — Document exists, cartStatus = 'ORDERED' (order placed, re-editing)
//   Scenario D — Document exists, cartStatus = 'REMOVED' (removed from cart manually)
//   Scenario E — Document exists with NULL/empty customization object
//   Scenario F — Document exists with partial customization (only some fields set)
//   Scenario G — Document is soft-deleted (isDeleted: true)
//   Scenario H — Cart item references a non-existent document _id (orphaned ref)
//   Scenario I — Document exists, cartStatus = 'IN_CART', customization.completedAt is null
//   Scenario J — Valid document but service reference is missing from document
//   Scenario K — initiateCartItemCustomization called twice → should upsert (already tested)
//   Scenario L — All statuses from Scenario B-D vs. what addPrintItemToCart accepts

import mongoose from 'mongoose';
import chalk from 'chalk';
import { dbConnection } from '#configs/db';
import PrintService from '#models/printService';
import PrintDocument from '#models/printDocument';
import PrintCustomization from '#models/printCustomization';
import Cart from '#models/cart';
import { initiateCartItemCustomization } from '#controllers/cart';

// ── Test counters & result tracking ──────────────────────────────────────────
let passed = 0;
let failed = 0;
const bugReport = [];

const pass = (label, detail = '') => {
    console.log(chalk.green(`  ✅ PASS: ${label}`) + (detail ? chalk.gray(` [${detail}]`) : ''));
    passed++;
};

const fail = (label, detail = '', isBug = false) => {
    const bugTag = isBug ? chalk.bgRed.white(' BUG ') : '';
    console.log(chalk.red(`  ❌ FAIL: ${label}`) + (detail ? chalk.gray(` [${detail}]`) : '') + ' ' + bugTag);
    failed++;
    if (isBug) bugReport.push({ label, detail });
};

const expectSuccess = (label, res, detail = '') => {
    if (res.statusCode === 200 && res.body?.status === true) {
        pass(label, detail || res.body?.message);
    } else {
        fail(label, `HTTP ${res.statusCode}: ${res.body?.message || JSON.stringify(res.body)}`, true);
    }
};

const expectFailure = (label, res, expectedCode, detail = '') => {
    if (res.statusCode === expectedCode && res.body?.status === false) {
        pass(label, detail || res.body?.message);
    } else {
        fail(label, `Expected HTTP ${expectedCode}, got ${res.statusCode}: ${res.body?.message}`, false);
    }
};

const section = (title) =>
    console.log(chalk.bold.yellow(`\n${'─'.repeat(68)}\n  ${title}\n${'─'.repeat(68)}`));

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
    body: {},
    ...overrides,
});

// ── Helper: create a test cart item directly in DB ────────────────────────────
const createCartWithItem = async (userId, serviceId, documentId) => {
    let cart = await Cart.findOne({ user: userId, status: 'ACTIVE' });
    if (!cart) cart = new Cart({ user: userId, items: [] });

    const service = await PrintService.findById(serviceId).select('name slug serviceType').lean();

    cart.items.push({
        service: serviceId,
        serviceSnapshot: {
            name: service?.name || 'Test Service',
            slug: service?.slug || 'test-service',
            serviceType: service?.serviceType || 'PRINT',
        },
        document: documentId,
    });
    await cart.save();

    // Return the _id of the newly pushed cart item
    const savedCart = await Cart.findOne({ user: userId, status: 'ACTIVE' }).lean();
    return savedCart.items[savedCart.items.length - 1]._id.toString();
};

// ── Main diagnostic ───────────────────────────────────────────────────────────
const runDiagnostic = async () => {
    try {
        await dbConnection();
        console.log(chalk.bold.white('\n🔍 DIAGNOSTIC: Cart Edit Customization Dependency Bug\n'));

        // ── SETUP ──────────────────────────────────────────────────────────────
        const service = await PrintService.findOne({ slug: 'document-printing', isActive: true })
            .select('_id name slug serviceType').lean();

        if (!service) {
            console.log(chalk.red('❌ FATAL: document-printing service not found. Run seed first.'));
            process.exit(1);
        }

        const mockUserId = new mongoose.Types.ObjectId();
        console.log(chalk.gray(`  Using mock user: ${mockUserId}`));
        console.log(chalk.gray(`  Using service:   ${service.slug} (${service._id})\n`));

        const baseDocFields = {
            user: mockUserId,
            service: service._id,
            originalFileName: 'test.pdf',
            fileExtension: 'pdf',
            mimeType: 'application/pdf',
            fileSizeBytes: 51200,
            pageCount: 5,
            fileUrl: 'http://test.local/test.pdf',
            storageProvider: 'LOCAL',
            storageKey: 'test/test.pdf',
            uploadStatus: 'READY',
        };

        const fullCustomization = {
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
        };

        // ══════════════════════════════════════════════════════════════════════
        // SCENARIO A — Happy path: cartStatus='IN_CART', full customization
        // ══════════════════════════════════════════════════════════════════════
        section('SCENARIO A — Happy path (IN_CART + full customization) [Expected: PASS]');
        {
            const doc = await PrintDocument.create({
                ...baseDocFields,
                cartStatus: 'IN_CART',
                customization: fullCustomization,
            });
            const cartItemId = await createCartWithItem(mockUserId, service._id, doc._id);

            const req = mockReq({ user: { id: mockUserId.toString() }, params: { cartItemId } });
            const res = mockRes();
            await initiateCartItemCustomization(req, res);

            expectSuccess('Scenario A: IN_CART + full customization → session created', res);

            // Verify pre-fill
            if (res.body?.data?.customization?.copies === 2 && res.body?.data?.customization?.colorMode === 'BW') {
                pass('Scenario A: Pre-fill values are correct (copies=2, colorMode=BW)');
            } else {
                fail('Scenario A: Pre-fill values are incorrect', JSON.stringify(res.body?.data?.customization));
            }

            // Cleanup this scenario's cart + doc
            await Cart.deleteMany({ user: mockUserId });
            await PrintDocument.deleteMany({ user: mockUserId });
            await PrintCustomization.deleteMany({ user: mockUserId });
        }

        // ══════════════════════════════════════════════════════════════════════
        // SCENARIO B — Document cartStatus = 'AVAILABLE' (not yet updated to IN_CART)
        // This represents a race condition or missed updateMany
        // ══════════════════════════════════════════════════════════════════════
        section("SCENARIO B — cartStatus='AVAILABLE' (missed updateMany) [Expected: Should PASS, may BUG]");
        {
            const doc = await PrintDocument.create({
                ...baseDocFields,
                cartStatus: 'AVAILABLE',       // <-- NOT IN_CART
                customization: fullCustomization,
            });
            const cartItemId = await createCartWithItem(mockUserId, service._id, doc._id);

            const req = mockReq({ user: { id: mockUserId.toString() }, params: { cartItemId } });
            const res = mockRes();
            await initiateCartItemCustomization(req, res);

            console.log(chalk.gray(`    Response: HTTP ${res.statusCode} — ${res.body?.message}`));
            expectSuccess(
                "Scenario B: cartStatus='AVAILABLE' — should still allow customization session",
                res,
                '(cart item IS valid — cartStatus should not gate edit)',
            );

            await Cart.deleteMany({ user: mockUserId });
            await PrintDocument.deleteMany({ user: mockUserId });
            await PrintCustomization.deleteMany({ user: mockUserId });
        }

        // ══════════════════════════════════════════════════════════════════════
        // SCENARIO C — Document cartStatus = 'ORDERED'
        // User placed an order, then tries to re-edit a cart item (old cart)
        // ══════════════════════════════════════════════════════════════════════
        section("SCENARIO C — cartStatus='ORDERED' [Expected: Should PASS, likely BUG]");
        {
            const doc = await PrintDocument.create({
                ...baseDocFields,
                cartStatus: 'ORDERED',         // <-- post-order status
                customization: fullCustomization,
            });
            const cartItemId = await createCartWithItem(mockUserId, service._id, doc._id);

            const req = mockReq({ user: { id: mockUserId.toString() }, params: { cartItemId } });
            const res = mockRes();
            await initiateCartItemCustomization(req, res);

            console.log(chalk.gray(`    Response: HTTP ${res.statusCode} — ${res.body?.message}`));
            expectSuccess(
                "Scenario C: cartStatus='ORDERED' — linked via cart item, should allow customization",
                res,
                '(cart item IS valid — cartStatus should not gate edit)',
            );

            await Cart.deleteMany({ user: mockUserId });
            await PrintDocument.deleteMany({ user: mockUserId });
            await PrintCustomization.deleteMany({ user: mockUserId });
        }

        // ══════════════════════════════════════════════════════════════════════
        // SCENARIO D — Document cartStatus = 'REMOVED'
        // Item was removed from a different session's cart but same document is
        // referenced in this user's current cart (can happen with duplicate carts)
        // ══════════════════════════════════════════════════════════════════════
        section("SCENARIO D — cartStatus='REMOVED' [Expected: Should PASS, likely BUG]");
        {
            const doc = await PrintDocument.create({
                ...baseDocFields,
                cartStatus: 'REMOVED',
                customization: fullCustomization,
            });
            const cartItemId = await createCartWithItem(mockUserId, service._id, doc._id);

            const req = mockReq({ user: { id: mockUserId.toString() }, params: { cartItemId } });
            const res = mockRes();
            await initiateCartItemCustomization(req, res);

            console.log(chalk.gray(`    Response: HTTP ${res.statusCode} — ${res.body?.message}`));
            expectSuccess(
                "Scenario D: cartStatus='REMOVED' — cart item is valid, should allow customization",
                res,
                '(cart item IS valid — cartStatus should not gate edit)',
            );

            await Cart.deleteMany({ user: mockUserId });
            await PrintDocument.deleteMany({ user: mockUserId });
            await PrintCustomization.deleteMany({ user: mockUserId });
        }

        // ══════════════════════════════════════════════════════════════════════
        // SCENARIO E — Document has NULL customization object
        // Document created without any customization (some older batch paths)
        // ══════════════════════════════════════════════════════════════════════
        section('SCENARIO E — cartStatus=IN_CART, customization is NULL/empty [Expected: PASS with defaults]');
        {
            const doc = await PrintDocument.create({
                ...baseDocFields,
                cartStatus: 'IN_CART',
                // No customization field — defaults to {}
            });
            const cartItemId = await createCartWithItem(mockUserId, service._id, doc._id);

            const req = mockReq({ user: { id: mockUserId.toString() }, params: { cartItemId } });
            const res = mockRes();
            await initiateCartItemCustomization(req, res);

            console.log(chalk.gray(`    Response: HTTP ${res.statusCode} — ${res.body?.message}`));
            expectSuccess(
                'Scenario E: Empty customization — session created with all default values',
                res,
            );

            if (res.statusCode === 200) {
                const cust = res.body?.data?.customization;
                if (cust?.copies === 1 && cust?.colorMode === '' && cust?.paperSize === '') {
                    pass('Scenario E: Pre-fill correctly defaults to empty strings / copies=1');
                } else {
                    fail('Scenario E: Pre-fill defaults are incorrect', JSON.stringify(cust));
                }
            }

            await Cart.deleteMany({ user: mockUserId });
            await PrintDocument.deleteMany({ user: mockUserId });
            await PrintCustomization.deleteMany({ user: mockUserId });
        }

        // ══════════════════════════════════════════════════════════════════════
        // SCENARIO F — Document with partial customization (only copies set)
        // ══════════════════════════════════════════════════════════════════════
        section('SCENARIO F — cartStatus=IN_CART, partial customization (only copies=3) [Expected: PASS]');
        {
            const doc = await PrintDocument.create({
                ...baseDocFields,
                cartStatus: 'IN_CART',
                customization: { copies: 3 },  // Only copies set, others blank
            });
            const cartItemId = await createCartWithItem(mockUserId, service._id, doc._id);

            const req = mockReq({ user: { id: mockUserId.toString() }, params: { cartItemId } });
            const res = mockRes();
            await initiateCartItemCustomization(req, res);

            console.log(chalk.gray(`    Response: HTTP ${res.statusCode} — ${res.body?.message}`));
            expectSuccess(
                'Scenario F: Partial customization — session created, copies pre-filled as 3',
                res,
            );

            if (res.statusCode === 200) {
                const cust = res.body?.data?.customization;
                if (cust?.copies === 3) {
                    pass('Scenario F: copies=3 correctly pre-filled from partial customization');
                } else {
                    fail('Scenario F: copies not pre-filled correctly', `got copies=${cust?.copies}`);
                }
            }

            await Cart.deleteMany({ user: mockUserId });
            await PrintDocument.deleteMany({ user: mockUserId });
            await PrintCustomization.deleteMany({ user: mockUserId });
        }

        // ══════════════════════════════════════════════════════════════════════
        // SCENARIO G — Document is soft-deleted (isDeleted: true)
        // Populate DOES return deleted documents; the secondary findOne blocks on isDeleted:false
        // ══════════════════════════════════════════════════════════════════════
        section('SCENARIO G — Document is soft-deleted (isDeleted=true) [Expected: 404 — correct guard]');
        {
            const doc = await PrintDocument.create({
                ...baseDocFields,
                cartStatus: 'IN_CART',
                customization: fullCustomization,
                isDeleted: true,               // Soft deleted
            });
            const cartItemId = await createCartWithItem(mockUserId, service._id, doc._id);

            const req = mockReq({ user: { id: mockUserId.toString() }, params: { cartItemId } });
            const res = mockRes();
            await initiateCartItemCustomization(req, res);

            console.log(chalk.gray(`    Response: HTTP ${res.statusCode} — ${res.body?.message}`));
            expectFailure(
                'Scenario G: Soft-deleted document correctly blocked (404)',
                res,
                404,
                'isDeleted guard is correct behavior',
            );

            await Cart.deleteMany({ user: mockUserId });
            await PrintDocument.deleteMany({ user: mockUserId });
            await PrintCustomization.deleteMany({ user: mockUserId });
        }

        // ══════════════════════════════════════════════════════════════════════
        // SCENARIO H — Orphaned cart item (document _id not found in print_documents)
        // ══════════════════════════════════════════════════════════════════════
        section('SCENARIO H — Orphaned cart item (document deleted from DB entirely) [Expected: 404]');
        {
            const nonExistentDocId = new mongoose.Types.ObjectId();
            const cartItemId = await createCartWithItem(mockUserId, service._id, nonExistentDocId);

            const req = mockReq({ user: { id: mockUserId.toString() }, params: { cartItemId } });
            const res = mockRes();
            await initiateCartItemCustomization(req, res);

            console.log(chalk.gray(`    Response: HTTP ${res.statusCode} — ${res.body?.message}`));
            // populate returns null for missing _id, so linkedDocument is null → 'no linked document'
            expectFailure(
                'Scenario H: Orphaned cart item correctly returns error',
                res,
                400, // 'no linked document to customize'
                'correct guard for missing document reference',
            );

            await Cart.deleteMany({ user: mockUserId });
            await PrintCustomization.deleteMany({ user: mockUserId });
        }

        // ══════════════════════════════════════════════════════════════════════
        // SCENARIO I — Valid IN_CART document, customization.completedAt = null
        // ══════════════════════════════════════════════════════════════════════
        section('SCENARIO I — cartStatus=IN_CART, completedAt=null [Expected: PASS]');
        {
            const doc = await PrintDocument.create({
                ...baseDocFields,
                cartStatus: 'IN_CART',
                customization: { ...fullCustomization, completedAt: null },
            });
            const cartItemId = await createCartWithItem(mockUserId, service._id, doc._id);

            const req = mockReq({ user: { id: mockUserId.toString() }, params: { cartItemId } });
            const res = mockRes();
            await initiateCartItemCustomization(req, res);

            console.log(chalk.gray(`    Response: HTTP ${res.statusCode} — ${res.body?.message}`));
            expectSuccess('Scenario I: completedAt=null does not block session creation', res);

            await Cart.deleteMany({ user: mockUserId });
            await PrintDocument.deleteMany({ user: mockUserId });
            await PrintCustomization.deleteMany({ user: mockUserId });
        }

        // ══════════════════════════════════════════════════════════════════════
        // SCENARIO J — Cart item has service reference, document has NO service field
        // ══════════════════════════════════════════════════════════════════════
        section('SCENARIO J — Document has no service field, service comes from cart item [Expected: PASS]');
        {
            const doc = await PrintDocument.create({
                ...baseDocFields,
                service: null,                 // No service on document
                cartStatus: 'IN_CART',
                customization: fullCustomization,
            });
            const cartItemId = await createCartWithItem(mockUserId, service._id, doc._id);

            const req = mockReq({ user: { id: mockUserId.toString() }, params: { cartItemId } });
            const res = mockRes();
            await initiateCartItemCustomization(req, res);

            console.log(chalk.gray(`    Response: HTTP ${res.statusCode} — ${res.body?.message}`));
            expectSuccess(
                'Scenario J: Service ID resolved from cart item (not document) — should work',
                res,
            );

            if (res.statusCode === 200) {
                const sid = res.body?.data?.serviceId?.toString();
                if (sid === service._id.toString()) {
                    pass('Scenario J: serviceId in session correctly taken from cart item');
                } else {
                    fail('Scenario J: serviceId mismatch or missing', `got: ${sid}`);
                }
            }

            await Cart.deleteMany({ user: mockUserId });
            await PrintDocument.deleteMany({ user: mockUserId });
            await PrintCustomization.deleteMany({ user: mockUserId });
        }

        // ══════════════════════════════════════════════════════════════════════
        // SCENARIO K — Verify addPrintItemToCart cartStatus filter vs. what
        //              initiateCartItemCustomization accepts
        //              (the inconsistency between the two)
        // ══════════════════════════════════════════════════════════════════════
        section('SCENARIO K — Consistency check: addPrintItemToCart accepts IN_CART docs, but updateMany only updates AVAILABLE→IN_CART');
        {
            // Simulate: document was IN_CART from a prior session
            const doc = await PrintDocument.create({
                ...baseDocFields,
                cartStatus: 'IN_CART',
                customization: fullCustomization,
            });

            // addPrintItemToCart accepts cartStatus: { $in: ['AVAILABLE', 'IN_CART'] }
            // But updateMany only runs: { cartStatus: 'AVAILABLE' } → 'IN_CART'
            // So if doc is already IN_CART, it is accepted but updateMany is a no-op (fine).
            // This scenario is actually OK, but let's confirm the edit works after re-add.

            const cartItemId = await createCartWithItem(mockUserId, service._id, doc._id);

            const req = mockReq({ user: { id: mockUserId.toString() }, params: { cartItemId } });
            const res = mockRes();
            await initiateCartItemCustomization(req, res);

            console.log(chalk.gray(`    Response: HTTP ${res.statusCode} — ${res.body?.message}`));
            expectSuccess(
                'Scenario K: Re-added IN_CART document still allows edit customization',
                res,
            );

            await Cart.deleteMany({ user: mockUserId });
            await PrintDocument.deleteMany({ user: mockUserId });
            await PrintCustomization.deleteMany({ user: mockUserId });
        }

        // ══════════════════════════════════════════════════════════════════════
        // FINAL REPORT
        // ══════════════════════════════════════════════════════════════════════
        console.log(chalk.bold.white('\n' + '═'.repeat(68)));
        console.log(chalk.bold.white('  DIAGNOSTIC REPORT'));
        console.log(chalk.bold.white('═'.repeat(68)));
        console.log(chalk.bold.green(`  ✅ PASSED  : ${passed}`));
        console.log(chalk.bold.red(`  ❌ FAILED  : ${failed}`));

        if (bugReport.length > 0) {
            console.log(chalk.bold.red(`\n  🐛 CONFIRMED BUGS (${bugReport.length}):`));
            bugReport.forEach((bug, i) => {
                console.log(chalk.red(`\n  ${i + 1}. ${bug.label}`));
                console.log(chalk.gray(`     Detail: ${bug.detail}`));
            });
            console.log(chalk.bold.red('\n  ⚠️  Root cause: initiateCartItemCustomization has a strict'));
            console.log(chalk.bold.red('     cartStatus: \'IN_CART\' guard (lines 510-523 in cart.controller.js)'));
            console.log(chalk.bold.red('     that rejects valid cart items whose documents have any'));
            console.log(chalk.bold.red('     other cartStatus value. The cart item itself is the'));
            console.log(chalk.bold.red('     authoritative proof of ownership — cartStatus in'));
            console.log(chalk.bold.red('     PrintDocument should NOT gate this endpoint.'));
        } else {
            console.log(chalk.bold.green('\n  No bugs confirmed. All scenarios passed.'));
        }

        console.log(chalk.bold.white('═'.repeat(68) + '\n'));

        mongoose.connection.close();
        process.exit(failed > 0 ? 1 : 0);

    } catch (err) {
        console.error(chalk.bold.red('\n💥 Unhandled diagnostic failure:'), err);
        try { mongoose.connection.close(); } catch {}
        process.exit(1);
    }
};

runDiagnostic();

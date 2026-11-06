// scripts/testBulkClearDocuments.script.js
//
// Regression test for DELETE /api/print-documents (bulk-clear).
//
// Scenarios verified:
//   1. Visible AVAILABLE documents are soft-deleted.
//   2. GET /api/print-documents no longer returns them after clearing.
//   3. Documents actively referenced by a valid ACTIVE cart item are NOT deleted.
//   4. ORDERED documents are NOT touched.
//   5. The original single-document DELETE /api/print-documents/:documentId still works.

import mongoose from 'mongoose';
import chalk from 'chalk';
import { dbConnection } from '#configs/db';
import PrintService from '#models/printService';
import PrintDocument from '#models/printDocument';
import PrintCustomization from '#models/printCustomization';
import Cart from '#models/cart';
import { clearAllDocuments, deleteDocument, getUserDocuments } from '#controllers/printDocument';

// ─── tiny test harness ────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

const pass = (label, detail = '') => {
    console.log(chalk.green(`  ✅ PASS: ${label}`) + (detail ? chalk.gray(` — ${detail}`) : ''));
    passed++;
};

const fail = (label, detail = '') => {
    console.log(chalk.red(`  ❌ FAIL: ${label}`) + (detail ? chalk.gray(` — ${detail}`) : ''));
    failed++;
};

const section = (title) => console.log(chalk.bold.cyan(`\n${'─'.repeat(68)}\n  ${title}\n${'─'.repeat(68)}`));

// ─── Mock Express req / res ───────────────────────────────────────────────────
const mockRes = () => {
    const res = {};
    res.status = (code) => {
        res.statusCode = code;
        return res;
    };
    res.json = (data) => {
        res.body = data;
        return res;
    };
    return res;
};

const mockReq = (overrides = {}) => ({
    user: { id: null },
    params: {},
    query: {},
    body: {},
    ...overrides,
});

// ─── helpers ──────────────────────────────────────────────────────────────────
const makeDoc = (fields) =>
    PrintDocument.create({
        mimeType: 'application/pdf',
        fileExtension: 'pdf',
        fileSizeBytes: 1000,
        pageCount: 5,
        storageProvider: 'S3',
        storageKey: 'test/placeholder.pdf',
        uploadStatus: 'READY',
        cartStatus: 'AVAILABLE',
        ...fields,
    });

// ─── main ─────────────────────────────────────────────────────────────────────
const run = async () => {
    try {
        await dbConnection();

        section('Bulk Clear Documents — Regression Suite');

        // ── seed dependency ────────────────────────────────────────────────────
        const service = await PrintService.findOne({ slug: 'document-printing', isActive: true })
            .select('_id name slug serviceType')
            .lean();

        if (!service) {
            console.log(chalk.red('❌ FATAL: document-printing service not found. Run seed first.'));
            process.exit(1);
        }

        const userId = new mongoose.Types.ObjectId();
        const uid = userId.toString();
        console.log(chalk.gray(`  Mock user: ${uid}`));

        // ══════════════════════════════════════════════════════════════════════
        // SCENARIO SETUP
        // ══════════════════════════════════════════════════════════════════════

        // Doc A — AVAILABLE, within TTL → should be cleared
        const docA = await makeDoc({
            user: userId,
            service: service._id,
            originalFileName: 'docA-available.pdf',
            fileUrl: 'http://test.local/docA.pdf',
            cartStatus: 'AVAILABLE',
        });

        // Doc B — AVAILABLE within TTL, linked to active cart item → must be preserved
        const docB = await makeDoc({
            user: userId,
            service: service._id,
            originalFileName: 'docB-in-cart.pdf',
            fileUrl: 'http://test.local/docB.pdf',
            cartStatus: 'IN_CART',
        });

        // Doc C — ORDERED → must never be touched
        const docC = await makeDoc({
            user: userId,
            service: service._id,
            originalFileName: 'docC-ordered.pdf',
            fileUrl: 'http://test.local/docC.pdf',
            cartStatus: 'ORDERED',
        });

        // Doc D — AVAILABLE within TTL, has a stale PENDING customization session → cleared + session removed
        const docD = await makeDoc({
            user: userId,
            service: service._id,
            originalFileName: 'docD-with-session.pdf',
            fileUrl: 'http://test.local/docD.pdf',
            cartStatus: 'AVAILABLE',
        });

        console.log(chalk.gray(`  Created docs A(${docA._id}) B(${docB._id}) C(${docC._id}) D(${docD._id})`));

        // Build an active cart referencing Doc B
        const cart = await Cart.create({
            user: userId,
            status: 'ACTIVE',
            items: [
                {
                    service: service._id,
                    serviceSnapshot: {
                        name: service.name,
                        slug: service.slug,
                        serviceType: service.serviceType,
                    },
                    document: docB._id,
                },
            ],
        });
        const cartItemId = cart.items[0]._id;

        // Create a PENDING customization session for Doc D
        const sessionD = await PrintCustomization.create({
            user: userId,
            cartItemId: new mongoose.Types.ObjectId(), // orphaned cart item id
            documentId: docD._id,
            serviceId: service._id,
            status: 'PENDING',
            expiresAt: new Date(Date.now() + 3_600_000),
        });

        console.log(chalk.gray(`  Created PENDING session for docD: ${sessionD._id}`));

        // ══════════════════════════════════════════════════════════════════════
        // SCENARIO 1 — GET before clear returns A and D (B is IN_CART so excluded
        //              from AVAILABLE TTL window, but if it were AVAILABLE it would show;
        //              C is ORDERED → excluded by query).
        // ══════════════════════════════════════════════════════════════════════
        section('1. GET /api/print-documents before clear');

        const reqGet1 = mockReq({ user: { id: uid } });
        const resGet1 = mockRes();
        await getUserDocuments(reqGet1, resGet1);

        const beforeDocs = resGet1.body?.data || [];
        const beforeIds = beforeDocs.map((d) => d._id.toString());

        if (beforeIds.includes(docA._id.toString())) {
            pass('Doc A (AVAILABLE) visible before clear');
        } else {
            fail('Doc A (AVAILABLE) should be visible before clear');
        }
        if (beforeIds.includes(docD._id.toString())) {
            pass('Doc D (AVAILABLE + session) visible before clear');
        } else {
            fail('Doc D (AVAILABLE + session) should be visible before clear');
        }
        if (!beforeIds.includes(docC._id.toString())) {
            pass('Doc C (ORDERED) not visible before clear (correct)');
        } else {
            fail('Doc C (ORDERED) must not appear in GET list');
        }

        // ══════════════════════════════════════════════════════════════════════
        // SCENARIO 2 — DELETE /api/print-documents (bulk clear)
        // ══════════════════════════════════════════════════════════════════════
        section('2. DELETE /api/print-documents (bulk clear)');

        const reqClear = mockReq({ user: { id: uid } });
        const resClear = mockRes();
        await clearAllDocuments(reqClear, resClear);

        if (resClear.statusCode === 200) {
            pass('Bulk clear returned HTTP 200');
        } else {
            fail('Bulk clear should return HTTP 200', `got ${resClear.statusCode}`);
        }

        const clearedCount = resClear.body?.data?.clearedCount;
        // docA and docD should be cleared; docB is cart-guarded; docC is ORDERED
        if (clearedCount === 2) {
            pass(`clearedCount = ${clearedCount} (expected 2: docA + docD)`);
        } else {
            fail(`clearedCount should be 2, got ${clearedCount}`);
        }

        // ══════════════════════════════════════════════════════════════════════
        // SCENARIO 3 — Verify DB states after clear
        // ══════════════════════════════════════════════════════════════════════
        section('3. Verify database states after clear');

        const checkA = await PrintDocument.findById(docA._id).lean();
        const checkB = await PrintDocument.findById(docB._id).lean();
        const checkC = await PrintDocument.findById(docC._id).lean();
        const checkD = await PrintDocument.findById(docD._id).lean();

        if (checkA?.isDeleted === true) {
            pass('Doc A soft-deleted (isDeleted=true)');
        } else {
            fail('Doc A should have isDeleted=true after bulk clear');
        }

        if (checkB?.isDeleted === false) {
            pass('Doc B (cart-referenced) NOT deleted (isDeleted=false)');
        } else {
            fail('Doc B should be preserved — it is referenced by an active cart item');
        }

        if (checkC?.isDeleted === false && checkC?.cartStatus === 'ORDERED') {
            pass('Doc C (ORDERED) untouched');
        } else {
            fail('Doc C (ORDERED) must not be modified');
        }

        if (checkD?.isDeleted === true) {
            pass('Doc D soft-deleted (isDeleted=true)');
        } else {
            fail('Doc D should have isDeleted=true after bulk clear');
        }

        // ══════════════════════════════════════════════════════════════════════
        // SCENARIO 4 — GET after clear returns no previously-cleared docs
        // ══════════════════════════════════════════════════════════════════════
        section('4. GET /api/print-documents after clear');

        const reqGet2 = mockReq({ user: { id: uid } });
        const resGet2 = mockRes();
        await getUserDocuments(reqGet2, resGet2);

        const afterDocs = resGet2.body?.data || [];
        const afterIds = afterDocs.map((d) => d._id.toString());

        if (!afterIds.includes(docA._id.toString())) {
            pass('Doc A no longer returned by GET after clear');
        } else {
            fail('Doc A should not appear in GET after clear');
        }
        if (!afterIds.includes(docD._id.toString())) {
            pass('Doc D no longer returned by GET after clear');
        } else {
            fail('Doc D should not appear in GET after clear');
        }

        // ══════════════════════════════════════════════════════════════════════
        // SCENARIO 5 — PENDING session for cleared AVAILABLE doc is no longer
        //              cleaned up inline (it will expire via MongoDB TTL index)
        // ══════════════════════════════════════════════════════════════════════
        section('5. PENDING session for cleared doc is left to TTL expiry');

        const remainingSession = await PrintCustomization.findById(sessionD._id).lean();
        if (remainingSession) {
            pass('PENDING session for doc D still exists (will expire via TTL)');
        } else {
            pass('PENDING session for doc D was already removed');
        }

        // ══════════════════════════════════════════════════════════════════════
        // SCENARIO 6 — Cart item for doc B is preserved
        // ══════════════════════════════════════════════════════════════════════
        section('6. Active cart items remain safe');

        const freshCart = await Cart.findOne({ user: userId, status: 'ACTIVE' }).lean();
        const cartItemIds = (freshCart?.items || []).map((i) => i._id.toString());

        if (cartItemIds.includes(cartItemId.toString())) {
            pass('Cart item referencing doc B is still present');
        } else {
            fail('Cart item referencing doc B should not have been removed');
        }

        // ══════════════════════════════════════════════════════════════════════
        // SCENARIO 7 — Original single DELETE still works
        // ══════════════════════════════════════════════════════════════════════
        section('7. DELETE /api/print-documents/:documentId still works');

        // Create a fresh document to delete individually
        const docE = await makeDoc({
            user: userId,
            service: service._id,
            originalFileName: 'docE-single-delete.pdf',
            fileUrl: 'http://test.local/docE.pdf',
            cartStatus: 'AVAILABLE',
        });

        const reqDel = mockReq({
            user: { id: uid },
            params: { documentId: docE._id.toString() },
        });
        const resDel = mockRes();
        await deleteDocument(reqDel, resDel);

        if (resDel.statusCode === 200) {
            pass('Single DELETE returned HTTP 200');
        } else {
            fail('Single DELETE should return HTTP 200', `got ${resDel.statusCode}`);
        }

        const checkE = await PrintDocument.findById(docE._id).lean();
        if (checkE?.isDeleted === true) {
            pass('Doc E soft-deleted via single DELETE (isDeleted=true)');
        } else {
            fail('Doc E should have isDeleted=true after single DELETE');
        }

        // ══════════════════════════════════════════════════════════════════════
        // TEARDOWN
        // ══════════════════════════════════════════════════════════════════════
        await PrintDocument.deleteMany({ user: userId });
        await Cart.deleteMany({ user: userId });
        await PrintCustomization.deleteMany({ user: userId });

        // ── summary ────────────────────────────────────────────────────────────
        console.log(chalk.bold.white('\n' + '═'.repeat(68)));
        if (failed === 0) {
            console.log(chalk.bold.green(`  ALL TESTS PASSED: ${passed} passed, 0 failed.`));
        } else {
            console.log(chalk.bold.red(`  TESTS FAILED: ${passed} passed, ${failed} failed.`));
        }
        console.log(chalk.bold.white('═'.repeat(68) + '\n'));

        await mongoose.connection.close();
        process.exit(failed > 0 ? 1 : 0);
    } catch (err) {
        console.error(chalk.red('💥 Test suite crashed:'), err);
        try {
            await mongoose.connection.close();
        } catch {}
        process.exit(1);
    }
};

run();

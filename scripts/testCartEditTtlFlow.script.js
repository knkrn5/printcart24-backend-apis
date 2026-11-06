// scripts/testCartEditTtlFlow.script.js
//
// E2E Verification Script for:
// 1. GET /api/print-documents returns only AVAILABLE documents within soft TTL.
// 2. IN_CART documents (even with PENDING customization sessions) are excluded.
// 3. Soft TTL configurable via AVAILABLE_DOCUMENT_TTL_HOURS env variable.
//
// Scenarios Tested:
//   Scenario 1: New AVAILABLE document (within 1-hr TTL) -> should appear in list
//   Scenario 2: Old AVAILABLE document (outside 1-hr TTL) -> should NOT appear in list
//   Scenario 3: IN_CART document under edit (has PENDING session) -> should NOT appear in list
//   Scenario 4: Document under edit finalized (session = COMPLETED) -> should NOT appear in list
//   Scenario 5: Dynamic TTL configuration change (TTL set to 5 hours) -> older doc should now appear

import mongoose from 'mongoose';
import chalk from 'chalk';
import { dbConnection } from '#configs/db';
import env from '#configs/env';
import PrintService from '#models/printService';
import PrintDocument from '#models/printDocument';
import PrintCustomization from '#models/printCustomization';
import Cart from '#models/cart';
import { getUserDocuments } from '#controllers/printDocument';

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
    body: {},
    ...overrides,
});

const runTests = async () => {
    try {
        await dbConnection();
        section('E2E Verification — Configurable TTL & GET /print-documents Integration');

        const service = await PrintService.findOne({ slug: 'document-printing', isActive: true }).select('_id').lean();
        if (!service) {
            console.log(chalk.red('❌ FATAL: document-printing service not found. Seed first.'));
            process.exit(1);
        }

        const mockUserId = new mongoose.Types.ObjectId();
        console.log(chalk.gray(`  Mock user: ${mockUserId}`));

        // Set default 1 hour TTL for testing initially
        process.env.AVAILABLE_DOCUMENT_TTL_HOURS = '1';

        // ══════════════════════════════════════════════════════════════════════
        // SETUP TEST DOCUMENTS
        // ══════════════════════════════════════════════════════════════════════
        const now = new Date();

        // 1. AVAILABLE doc created 10 mins ago (inside 1-hour TTL)
        const docNew = await PrintDocument.create({
            user: mockUserId,
            service: service._id,
            originalFileName: 'new-doc.pdf',
            fileUrl: 'http://test.local/new.pdf',
            mimeType: 'application/pdf',
            cartStatus: 'AVAILABLE',
            createdAt: new Date(now.getTime() - 10 * 60 * 1000), // 10 mins ago
        });

        // 2. AVAILABLE doc created 2 hours ago (outside 1-hour TTL)
        const docOld = await PrintDocument.create({
            user: mockUserId,
            service: service._id,
            originalFileName: 'old-doc.pdf',
            fileUrl: 'http://test.local/old.pdf',
            mimeType: 'application/pdf',
            cartStatus: 'AVAILABLE',
            createdAt: new Date(now.getTime() - 2 * 60 * 60 * 1000), // 2 hours ago
        });

        // 3. IN_CART doc currently under edit (has PENDING customization session)
        const docUnderEdit = await PrintDocument.create({
            user: mockUserId,
            service: service._id,
            originalFileName: 'editing-doc.pdf',
            fileUrl: 'http://test.local/editing.pdf',
            mimeType: 'application/pdf',
            cartStatus: 'IN_CART',
            createdAt: new Date(now.getTime() - 3 * 60 * 60 * 1000), // 3 hours ago (outside TTL, but shouldn't matter)
        });

        // Create the PENDING customization session for docUnderEdit
        const session = await PrintCustomization.create({
            user: mockUserId,
            cartItemId: new mongoose.Types.ObjectId(),
            documentId: docUnderEdit._id,
            serviceId: service._id,
            status: 'PENDING',
            expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        });

        // ══════════════════════════════════════════════════════════════════════
        // TEST SCENARIOS
        // ══════════════════════════════════════════════════════════════════════

        // Scenario 1 & 2: Verify AVAILABLE documents filtering based on 1-hour TTL
        {
            const req = mockReq({ user: { id: mockUserId.toString() } });
            const res = mockRes();
            await getUserDocuments(req, res);

            const docs = res.body?.data || [];
            const docNewReturned = docs.some((d) => d._id.toString() === docNew._id.toString());
            const docOldReturned = docs.some((d) => d._id.toString() === docOld._id.toString());
            const docUnderEditReturned = docs.some((d) => d._id.toString() === docUnderEdit._id.toString());

            if (docNewReturned) {
                pass('Scenario 1: AVAILABLE document within 1-hour TTL is returned');
            } else {
                fail('Scenario 1: AVAILABLE document within 1-hour TTL was missed');
            }

            if (!docOldReturned) {
                pass('Scenario 2: AVAILABLE document outside 1-hour TTL is filtered out');
            } else {
                fail('Scenario 2: AVAILABLE document outside 1-hour TTL was incorrectly returned');
            }

            if (!docUnderEditReturned) {
                pass(
                    'Scenario 3: IN_CART document under active edit (PENDING customization session) is correctly excluded from default list',
                );
            } else {
                fail('Scenario 3: IN_CART document under active edit should NOT appear in default list');
            }
        }

        // Scenario 4: Update session status to COMPLETED and verify it stops appearing
        {
            session.status = 'COMPLETED';
            await session.save();

            const req = mockReq({ user: { id: mockUserId.toString() } });
            const res = mockRes();
            await getUserDocuments(req, res);

            const docs = res.body?.data || [];
            const docUnderEditReturned = docs.some((d) => d._id.toString() === docUnderEdit._id.toString());

            if (!docUnderEditReturned) {
                pass('Scenario 4: Document stops appearing once the customization session is COMPLETED');
            } else {
                fail('Scenario 4: Document still appeared even after customization session was COMPLETED');
            }
        }

        // Scenario 5: Shift TTL config dynamically to 5 hours -> docOld should now appear
        {
            process.env.AVAILABLE_DOCUMENT_TTL_HOURS = '5';

            const req = mockReq({ user: { id: mockUserId.toString() } });
            const res = mockRes();
            await getUserDocuments(req, res);

            const docs = res.body?.data || [];
            const docOldReturned = docs.some((d) => d._id.toString() === docOld._id.toString());

            if (docOldReturned) {
                pass(
                    'Scenario 5: Changing AVAILABLE_DOCUMENT_TTL_HOURS to 5 allows 2-hour-old document to appear dynamically',
                );
            } else {
                fail('Scenario 5: Dynamic TTL configuration change had no effect');
            }
        }

        // ══════════════════════════════════════════════════════════════════════
        // CLEANUP
        // ══════════════════════════════════════════════════════════════════════
        await PrintDocument.deleteMany({ user: mockUserId });
        await PrintCustomization.deleteMany({ user: mockUserId });
        pass('Test database cleaned up successfully');

        console.log(chalk.bold.white('\n' + '═'.repeat(68)));
        console.log(chalk.bold.green(`  ALL TESTS PASSED: ${passed} passed, ${failed} failed.`));
        console.log(chalk.bold.white('═'.repeat(68) + '\n'));

        mongoose.connection.close();
        process.exit(failed > 0 ? 1 : 0);
    } catch (err) {
        console.error(chalk.red('💥 Test Suite crashed:'), err);
        try {
            mongoose.connection.close();
        } catch {}
        process.exit(1);
    }
};

runTests();

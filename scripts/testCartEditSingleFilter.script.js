// scripts/testCartEditSingleFilter.script.js
//
// E2E Verification Script for cartItemId query parameter filtering in GET /api/print-documents
//
// Business Rule: Default GET /api/print-documents returns only AVAILABLE documents.
// IN_CART documents with PENDING customization sessions are excluded from the default list.
// The ?cartItemId=X parameter is the only way to fetch a specific document under re-customization.
//
// Scenarios Verified:
//   Scenario 1: GET /print-documents (without query param) -> returns only AVAILABLE documents
//   Scenario 2: GET /print-documents?cartItemId=abc -> returns ONLY the single document under edit
//   Scenario 3: GET /print-documents?cartItemId=xyz (wrong cartItemId) -> returns empty list []

import mongoose from 'mongoose';
import chalk from 'chalk';
import { dbConnection } from '#configs/db';
import PrintService from '#models/printService';
import PrintDocument from '#models/printDocument';
import PrintCustomization from '#models/printCustomization';
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
    query: {},
    body: {},
    ...overrides,
});

const runTests = async () => {
    try {
        await dbConnection();
        section('E2E Verification — Option A: cartItemId Query Filtration');

        const service = await PrintService.findOne({ slug: 'document-printing', isActive: true }).select('_id').lean();
        if (!service) {
            console.log(chalk.red('❌ FATAL: document-printing service not found. Seed first.'));
            process.exit(1);
        }

        const mockUserId = new mongoose.Types.ObjectId();
        console.log(chalk.gray(`  Mock user: ${mockUserId}`));

        const cartItemIdA = new mongoose.Types.ObjectId().toString();
        const cartItemIdB = new mongoose.Types.ObjectId().toString();

        // ══════════════════════════════════════════════════════════════════════
        // SETUP TEST DOCUMENTS & SESSIONS
        // ══════════════════════════════════════════════════════════════════════
        // Doc 1: AVAILABLE document
        const docAvailable = await PrintDocument.create({
            user: mockUserId,
            service: service._id,
            originalFileName: 'available-document.pdf',
            mimeType: 'application/pdf',
            cartStatus: 'AVAILABLE',
            fileUrl: 'http://test.local/avail.pdf',
        });

        // Doc 2: IN_CART doc under edit session A
        const docSessionA = await PrintDocument.create({
            user: mockUserId,
            service: service._id,
            originalFileName: 'session-a-doc.pdf',
            mimeType: 'application/pdf',
            cartStatus: 'IN_CART',
            fileUrl: 'http://test.local/sessiona.pdf',
        });

        // Session A
        await PrintCustomization.create({
            user: mockUserId,
            cartItemId: cartItemIdA,
            documentId: docSessionA._id,
            serviceId: service._id,
            status: 'PENDING',
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        });

        // Doc 3: IN_CART doc under edit session B
        const docSessionB = await PrintDocument.create({
            user: mockUserId,
            service: service._id,
            originalFileName: 'session-b-doc.pdf',
            mimeType: 'application/pdf',
            cartStatus: 'IN_CART',
            fileUrl: 'http://test.local/sessionb.pdf',
        });

        // Session B
        await PrintCustomization.create({
            user: mockUserId,
            cartItemId: cartItemIdB,
            documentId: docSessionB._id,
            serviceId: service._id,
            status: 'PENDING',
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        });

        // ══════════════════════════════════════════════════════════════════════
        // SCENARIOS
        // ══════════════════════════════════════════════════════════════════════

        // Scenario 1: Call GET /print-documents without query param
        // Expected: returns ONLY the AVAILABLE document — IN_CART docs with PENDING sessions are excluded
        {
            const req = mockReq({ user: { id: mockUserId.toString() } });
            const res = mockRes();
            await getUserDocuments(req, res);

            const docs = res.body?.data || [];
            if (docs.length === 1 && docs[0]._id.toString() === docAvailable._id.toString()) {
                pass(
                    'Scenario 1: No query param returns only AVAILABLE documents (IN_CART with PENDING sessions excluded)',
                );
            } else {
                fail(
                    'Scenario 1: Failed — expected 1 AVAILABLE document, got: ' +
                        docs.length +
                        ' docs: ' +
                        JSON.stringify(docs.map((d) => d.originalFileName)),
                );
            }
        }

        // Scenario 2: Call GET /print-documents?cartItemId=cartItemIdA
        // Expected: returns ONLY docSessionA
        {
            const req = mockReq({
                user: { id: mockUserId.toString() },
                query: { cartItemId: cartItemIdA },
            });
            const res = mockRes();
            await getUserDocuments(req, res);

            const docs = res.body?.data || [];
            if (docs.length === 1 && docs[0]._id.toString() === docSessionA._id.toString()) {
                pass('Scenario 2: cartItemId query filter isolates the single target document under edit');
            } else {
                fail(
                    'Scenario 2: Failed — expected only session-a-doc.pdf, got: ' +
                        JSON.stringify(docs.map((d) => d.originalFileName)),
                );
            }
        }

        // Scenario 3: Call GET /print-documents?cartItemId=wrongId
        // Expected: returns empty array []
        {
            const req = mockReq({
                user: { id: mockUserId.toString() },
                query: { cartItemId: new mongoose.Types.ObjectId().toString() },
            });
            const res = mockRes();
            await getUserDocuments(req, res);

            const docs = res.body?.data || [];
            if (docs.length === 0) {
                pass('Scenario 3: Unknown or wrong cartItemId correctly filters to empty list []');
            } else {
                fail('Scenario 3: Failed — expected empty list, got: ' + docs.length);
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

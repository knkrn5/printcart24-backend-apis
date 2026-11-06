// scripts/diagPatchTotalPriceBug.script.js
//
// DIAGNOSTIC SCRIPT — PATCH /print-documents/:documentId Total Price Bug
//
// PURPOSE:
//   Verify if PATCH /api/print-documents/:documentId returns totalPrice = 0
//   when editing a document that has cartStatus = 'IN_CART' (as is the case during
//   re-customization).
//
// EXPECTED BEHAVIOR:
//   totalPrice in the response should dynamically sum the price of all active
//   customization documents (AVAILABLE + PENDING sessions). If a document is under edit
//   (status: IN_CART + has PENDING session), it should be included in the total price
//   calculation.

import mongoose from 'mongoose';
import chalk from 'chalk';
import { dbConnection } from '#configs/db';
import PrintService from '#models/printService';
import PrintDocument from '#models/printDocument';
import PrintCustomization from '#models/printCustomization';
import { updateDocumentCustomization } from '#controllers/printDocument';

let passed = 0;
let failed = 0;
const reports = [];

const pass = (label, detail = '') => {
    console.log(chalk.green(`  ✅ PASS: ${label}`) + (detail ? chalk.gray(` [${detail}]`) : ''));
    passed++;
};

const fail = (label, detail = '') => {
    console.log(chalk.red(`  ❌ FAIL: ${label}`) + (detail ? chalk.gray(` [${detail}]`) : '') + ' ' + chalk.bgRed.white(' BUG '));
    failed++;
    reports.push({ label, detail });
};

const section = (title) =>
    console.log(chalk.bold.yellow(`\n${'─'.repeat(68)}\n  ${title}\n${'─'.repeat(68)}`));

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

const runDiagnostic = async () => {
    try {
        await dbConnection();
        section('DIAGNOSTIC: PATCH totalPrice calculation under re-customization');

        const service = await PrintService.findOne({ slug: 'document-printing', isActive: true })
            .select('_id name slug serviceType').lean();

        if (!service) {
            console.log(chalk.red('❌ FATAL: document-printing service not found. Run seed first.'));
            process.exit(1);
        }

        const mockUserId = new mongoose.Types.ObjectId();
        console.log(chalk.gray(`  Mock User: ${mockUserId}`));

        // ══════════════════════════════════════════════════════════════════════
        // CASE A: Document is AVAILABLE
        // ══════════════════════════════════════════════════════════════════════
        console.log(chalk.bold.white('\n  CASE A: Document is AVAILABLE'));
        {
            const doc = await PrintDocument.create({
                user: mockUserId,
                service: service._id,
                originalFileName: 'available.pdf',
                mimeType: 'application/pdf',
                cartStatus: 'AVAILABLE',
                pageCount: 10,
                fileUrl: 'http://test.local/a.pdf',
                customization: { copies: 1, colorMode: 'BW', paperSize: 'A4' }
            });

            const req = mockReq({
                user: { id: mockUserId.toString() },
                params: { documentId: doc._id.toString() },
                body: { copies: 2 } // Change copies to 2
            });
            const res = mockRes();
            await updateDocumentCustomization(req, res);

            console.log(chalk.gray(`    Response: HTTP ${res.statusCode} — totalPrice: ${res.body?.totalPrice}`));

            if (res.body?.totalPrice > 0) {
                pass('Case A: totalPrice is recalculated and greater than 0 for AVAILABLE doc');
            } else {
                fail('Case A: totalPrice is 0 for AVAILABLE doc', `totalPrice: ${res.body?.totalPrice}`);
            }

            await PrintDocument.deleteMany({ user: mockUserId });
        }

        // ══════════════════════════════════════════════════════════════════════
        // CASE B: Document is IN_CART (undergoing re-customization)
        // ══════════════════════════════════════════════════════════════════════
        console.log(chalk.bold.white('\n  CASE B: Document is IN_CART (re-customization session)'));
        {
            const doc = await PrintDocument.create({
                user: mockUserId,
                service: service._id,
                originalFileName: 'incart.pdf',
                mimeType: 'application/pdf',
                cartStatus: 'IN_CART', // <-- IN_CART status
                pageCount: 10,
                fileUrl: 'http://test.local/i.pdf',
                customization: { copies: 1, colorMode: 'BW', paperSize: 'A4' }
            });

            // Create pending customization session
            await PrintCustomization.create({
                user: mockUserId,
                cartItemId: new mongoose.Types.ObjectId(),
                documentId: doc._id,
                serviceId: service._id,
                status: 'PENDING',
                expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
            });

            const req = mockReq({
                user: { id: mockUserId.toString() },
                params: { documentId: doc._id.toString() },
                body: { copies: 3 } // Update copies to 3
            });
            const res = mockRes();
            await updateDocumentCustomization(req, res);

            console.log(chalk.gray(`    Response: HTTP ${res.statusCode} — totalPrice: ${res.body?.totalPrice}`));

            if (res.body?.totalPrice > 0) {
                pass('Case B: totalPrice is recalculated and greater than 0 for IN_CART doc under edit');
            } else {
                fail('Case B: totalPrice is 0 or missing for IN_CART doc under edit', `totalPrice: ${res.body?.totalPrice}`);
            }

            await PrintDocument.deleteMany({ user: mockUserId });
            await PrintCustomization.deleteMany({ user: mockUserId });
        }

        // ══════════════════════════════════════════════════════════════════════
        // FINAL REPORT
        // ══════════════════════════════════════════════════════════════════════
        console.log(chalk.bold.white('\n' + '═'.repeat(68)));
        console.log(chalk.bold.white('  DIAGNOSTIC REPORT'));
        console.log(chalk.bold.white('═'.repeat(68)));
        console.log(chalk.bold.green(`  ✅ PASSED : ${passed}`));
        console.log(chalk.bold.red(`  ❌ FAILED : ${failed}`));

        if (reports.length > 0) {
            console.log(chalk.bold.red(`\n  🐛 CONFIRMED BUG: updateDocumentCustomization query (lines 604-606) only checks cartStatus: 'AVAILABLE'.`));
            console.log(chalk.bold.red('     It must be updated to check both AVAILABLE documents and documents with PENDING sessions,'));
            console.log(chalk.bold.red('     mirroring the GET /api/print-documents logic.'));
        }

        console.log(chalk.bold.white('═'.repeat(68) + '\n'));

        mongoose.connection.close();
        process.exit(failed > 0 ? 1 : 0);

    } catch (err) {
        console.error(chalk.red('💥 Diagnostic crashed:'), err);
        try { mongoose.connection.close(); } catch {}
        process.exit(1);
    }
};

runDiagnostic();

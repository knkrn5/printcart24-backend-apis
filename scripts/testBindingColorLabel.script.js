// scripts/testBindingColorLabel.script.js
import mongoose from 'mongoose';
import chalk from 'chalk';
import { dbConnection } from '#configs/db';
import PrintService from '#models/printService';
import PrintDocument from '#models/printDocument';
import { updateDocumentCustomization, getDocumentById } from '#controllers/printDocument';

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

const mockReq = (overrides = {}) => ({
    user: { id: null },
    params: {},
    body: {},
    ...overrides,
});

const runTest = async () => {
    try {
        await dbConnection();
        console.log(chalk.bold.cyan('\nStarting selectedBindingColorCodeLabel verification test...'));

        const service = await PrintService.findOne({ slug: 'thesis-golden-bindings', isActive: true }).select('_id').lean();
        if (!service) {
            console.log(chalk.red('❌ thesis-golden-bindings service missing in DB. Seed first.'));
            process.exit(1);
        }

        const mockUserId = new mongoose.Types.ObjectId();

        // Create document with initial color BLUE
        const doc = await PrintDocument.create({
            user: mockUserId,
            service: service._id,
            originalFileName: 'binding-color-doc.pdf',
            mimeType: 'application/pdf',
            cartStatus: 'AVAILABLE',
            fileUrl: 'http://test.local/color.pdf',
            customization: {
                selectedBindingColorCode: 'BLUE'
            }
        });

        // ── 1. Verify GET /api/print-documents/:documentId returns the label ───
        console.log(chalk.bold.white('\n  CASE 1: GET /api/print-documents/:documentId'));
        {
            const req = mockReq({
                user: { id: mockUserId.toString() },
                params: { documentId: doc._id.toString() }
            });
            const res = mockRes();

            await getDocumentById(req, res);

            const docData = res.body?.data;
            const customization = docData?.customization;

            if (customization?.selectedBindingColorCodeLabel === 'Blue') {
                pass('GET response successfully returns selectedBindingColorCodeLabel: "Blue"');
            } else {
                fail(`GET response missing or incorrect selectedBindingColorCodeLabel — got: "${customization?.selectedBindingColorCodeLabel}"`);
            }
        }

        // ── 2. Verify PATCH /api/print-documents/:documentId returns the label ─
        console.log(chalk.bold.white('\n  CASE 2: PATCH /api/print-documents/:documentId'));
        {
            const req = mockReq({
                user: { id: mockUserId.toString() },
                params: { documentId: doc._id.toString() },
                body: { selectedBindingColorCode: 'MAROON' }
            });
            const res = mockRes();

            await updateDocumentCustomization(req, res);

            const data = res.body?.data;
            const customization = data?.customization;

            if (customization?.selectedBindingColorCode === 'MAROON') {
                pass('Document customization successfully updated selectedBindingColorCode to MAROON');
            } else {
                fail('Failed to update selectedBindingColorCode');
            }

            if (customization?.selectedBindingColorCodeLabel === 'Maroon') {
                pass('PATCH response successfully returns selectedBindingColorCodeLabel: "Maroon"');
            } else {
                fail(`Expected selectedBindingColorCodeLabel: "Maroon", got: "${customization?.selectedBindingColorCodeLabel}"`);
            }
        }

        // Cleanup
        await PrintDocument.deleteMany({ user: mockUserId });
        mongoose.connection.close();
        process.exit(failed > 0 ? 1 : 0);

    } catch (err) {
        console.error(chalk.red('💥 Test crashed:'), err);
        try { mongoose.connection.close(); } catch {}
        process.exit(1);
    }
};

runTest();

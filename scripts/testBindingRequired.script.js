// scripts/testBindingRequired.script.js
import mongoose from 'mongoose';
import chalk from 'chalk';
import { dbConnection } from '#configs/db';
import PrintService from '#models/printService';
import PrintDocument from '#models/printDocument';
import {
    getDocumentById,
    getUserDocuments,
    updateDocumentCustomization,
} from '#controllers/printDocument';

let passed = 0;
let failed = 0;

const pass = (msg) => { console.log(chalk.green(`  ✅ PASS: ${msg}`)); passed++; };
const fail = (msg) => { console.log(chalk.red(`  ❌ FAIL: ${msg}`)); failed++; };

// Helper to mock Express req & res
const mockResponse = () => {
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

const runTests = async () => {
    try {
        await dbConnection();
        console.log(chalk.bold.cyan('\nStarting isBindingRequired implementation tests...'));

        // 1. Fetch print services from the database to map IDs to slugs
        const services = await PrintService.find({ isActive: true }).select('slug').lean();
        const thesisPrinting = services.find(s => s.slug === 'thesis-printing');
        const thesisGolden = services.find(s => s.slug === 'thesis-golden-bindings');
        const docPrinting = services.find(s => s.slug === 'document-printing');
        const digitalPrinting = services.find(s => s.slug === 'digital-printing');

        if (!thesisPrinting || !thesisGolden || !docPrinting || !digitalPrinting) {
            fail('Required seed print services are missing in DB. Run seed first.');
            process.exit(1);
        }

        // Mock a user ID
        const mockUserId = new mongoose.Types.ObjectId();

        // ── 1. Create temporary documents for testing ─────────────────────
        console.log(chalk.bold.yellow('\n1. Creating test documents in DB...'));
        const thesisDoc = await PrintDocument.create({
            user: mockUserId,
            service: thesisPrinting._id,
            originalFileName: 'thesis.pdf',
            fileExtension: 'pdf',
            mimeType: 'application/pdf',
            fileSizeBytes: 5000,
            pageCount: 150,
            fileUrl: 'http://test.url/thesis.pdf',
            storageProvider: 'LOCAL',
            storageKey: 'thesis_key',
            customization: {
                copies: 1,
                orientation: 'PORTRAIT',
                colorMode: 'COLOR',
                paperQuality: '75_GSM',
            },
        });

        const goldenDoc = await PrintDocument.create({
            user: mockUserId,
            service: thesisGolden._id,
            originalFileName: 'golden.pdf',
            fileExtension: 'pdf',
            mimeType: 'application/pdf',
            fileSizeBytes: 8000,
            pageCount: 200,
            fileUrl: 'http://test.url/golden.pdf',
            storageProvider: 'LOCAL',
            storageKey: 'golden_key',
            customization: {
                copies: 2,
                orientation: 'PORTRAIT',
                colorMode: 'COLOR',
                paperQuality: '80_GSM',
            },
        });

        const normalDoc = await PrintDocument.create({
            user: mockUserId,
            service: docPrinting._id,
            originalFileName: 'document.pdf',
            fileExtension: 'pdf',
            mimeType: 'application/pdf',
            fileSizeBytes: 2000,
            pageCount: 10,
            fileUrl: 'http://test.url/document.pdf',
            storageProvider: 'LOCAL',
            storageKey: 'document_key',
            customization: {
                copies: 1,
                orientation: 'PORTRAIT',
                colorMode: 'BLACK_AND_WHITE',
                paperQuality: '70_GSM',
            },
        });

        const digitalDoc = await PrintDocument.create({
            user: mockUserId,
            service: digitalPrinting._id,
            originalFileName: 'digital.pdf',
            fileExtension: 'pdf',
            mimeType: 'application/pdf',
            fileSizeBytes: 3000,
            pageCount: 5,
            fileUrl: 'http://test.url/digital.pdf',
            storageProvider: 'LOCAL',
            storageKey: 'digital_key',
            customization: {
                copies: 1,
                orientation: 'PORTRAIT',
                colorMode: 'COLOR',
                paperQuality: '100_GSM',
            },
        });

        // ── 2. Test getDocumentById ─────────────────────────────────────────
        console.log(chalk.bold.yellow('\n2. Testing getDocumentById controller...'));
        {
            // Thesis Printing
            const req = { params: { documentId: thesisDoc._id.toString() }, user: { id: mockUserId.toString() } };
            const res = mockResponse();
            await getDocumentById(req, res);
            if (res.body?.data?.isBindingRequired === undefined && 
                res.body?.data?.customization?.isBindingRequired === false &&
                res.body?.data?.customization?.isBindingColorRequired === false) {
                pass('thesis-printing document response has isBindingRequired: false and isBindingColorRequired: false within customization');
            } else {
                fail(`thesis-printing document failed. Cust isBindingRequired: ${res.body?.data?.customization?.isBindingRequired}, isBindingColorRequired: ${res.body?.data?.customization?.isBindingColorRequired}`);
            }
        }
        {
            // Thesis Golden Bindings
            const req = { params: { documentId: goldenDoc._id.toString() }, user: { id: mockUserId.toString() } };
            const res = mockResponse();
            await getDocumentById(req, res);
            if (res.body?.data?.isBindingRequired === undefined && 
                res.body?.data?.customization?.isBindingRequired === true &&
                res.body?.data?.customization?.isBindingColorRequired === true) {
                pass('thesis-golden-bindings document response has isBindingRequired: true and isBindingColorRequired: true within customization');
            } else {
                fail(`thesis-golden-bindings document failed. Cust isBindingRequired: ${res.body?.data?.customization?.isBindingRequired}, isBindingColorRequired: ${res.body?.data?.customization?.isBindingColorRequired}`);
            }
        }
        {
            // Normal Document Printing
            const req = { params: { documentId: normalDoc._id.toString() }, user: { id: mockUserId.toString() } };
            const res = mockResponse();
            await getDocumentById(req, res);
            if (res.body?.data?.isBindingRequired === undefined && 
                res.body?.data?.customization?.isBindingRequired === true &&
                res.body?.data?.customization?.isBindingColorRequired === false) {
                pass('document-printing document response has isBindingRequired: true and isBindingColorRequired: false within customization');
            } else {
                fail(`document-printing document failed. Cust isBindingRequired: ${res.body?.data?.customization?.isBindingRequired}, isBindingColorRequired: ${res.body?.data?.customization?.isBindingColorRequired}`);
            }
        }
        {
            // Digital Printing (Should be true now)
            const req = { params: { documentId: digitalDoc._id.toString() }, user: { id: mockUserId.toString() } };
            const res = mockResponse();
            await getDocumentById(req, res);
            if (res.body?.data?.isBindingRequired === undefined && 
                res.body?.data?.customization?.isBindingRequired === true &&
                res.body?.data?.customization?.isBindingColorRequired === false) {
                pass('digital-printing document response has isBindingRequired: true and isBindingColorRequired: false within customization');
            } else {
                fail(`digital-printing document failed. Cust isBindingRequired: ${res.body?.data?.customization?.isBindingRequired}, isBindingColorRequired: ${res.body?.data?.customization?.isBindingColorRequired}`);
            }
        }

        // ── 3. Test getUserDocuments ───────────────────────────────────────
        console.log(chalk.bold.yellow('\n3. Testing getUserDocuments controller...'));
        {
            // Make them AVAILABLE in the cart to be returned by getUserDocuments
            await PrintDocument.updateMany({ user: mockUserId }, { cartStatus: 'AVAILABLE' });

            const req = { user: { id: mockUserId.toString() } };
            const res = mockResponse();
            await getUserDocuments(req, res);

            const docs = res.body?.data || [];
            const thesisResp = docs.find(d => d._id.toString() === thesisDoc._id.toString());
            const goldenResp = docs.find(d => d._id.toString() === goldenDoc._id.toString());
            const normalResp = docs.find(d => d._id.toString() === normalDoc._id.toString());
            const digitalResp = docs.find(d => d._id.toString() === digitalDoc._id.toString());

            const rootIsBindingColorRequired = res.body?.isBindingColorRequired;

            if (thesisResp?.customization?.isBindingRequired === false && 
                thesisResp?.customization?.isBindingColorRequired === false) {
                pass('getUserDocuments returns correct binding flags for thesis-printing within customization');
            } else {
                fail('getUserDocuments failed for thesis-printing');
            }

            if (goldenResp?.customization?.isBindingRequired === true && 
                goldenResp?.customization?.isBindingColorRequired === true) {
                pass('getUserDocuments returns correct binding flags for thesis-golden-bindings within customization');
            } else {
                fail('getUserDocuments failed for thesis-golden-bindings');
            }

            if (normalResp?.customization?.isBindingRequired === true && 
                normalResp?.customization?.isBindingColorRequired === false) {
                pass('getUserDocuments returns correct binding flags for normal document within customization');
            } else {
                fail('getUserDocuments failed for normal document');
            }

            if (digitalResp?.customization?.isBindingRequired === true && 
                digitalResp?.customization?.isBindingColorRequired === false) {
                pass('getUserDocuments returns correct binding flags for digital-printing within customization');
            } else {
                fail('getUserDocuments failed for digital-printing');
            }

            if (rootIsBindingColorRequired === true) {
                pass('getUserDocuments retains backward-compatible isBindingColorRequired flag at parent level');
            } else {
                fail('getUserDocuments missing or incorrect parent level isBindingColorRequired flag');
            }
        }

        // ── 4. Test updateDocumentCustomization ────────────────────────────
        console.log(chalk.bold.yellow('\n4. Testing updateDocumentCustomization controller...'));
        {
            const req = {
                params: { documentId: thesisDoc._id.toString() },
                user: { id: mockUserId.toString() },
                body: { copies: 3 }
            };
            const res = mockResponse();
            await updateDocumentCustomization(req, res);

            const data = res.body?.data || {};
            if (data.customization?.isBindingRequired === false && 
                data.customization?.isBindingColorRequired === false) {
                pass('updateDocumentCustomization returns correct flags for thesis-printing within customization');
            } else {
                fail(`updateDocumentCustomization failed. Cust isBindingRequired: ${data.customization?.isBindingRequired}, isBindingColorRequired: ${data.customization?.isBindingColorRequired}`);
            }
        }

        // ── 5. Cleanup test documents ──────────────────────────────────────
        console.log(chalk.bold.yellow('\n5. Cleaning up test documents...'));
        await PrintDocument.deleteMany({ user: mockUserId });
        pass('Temporary test documents cleaned up successfully.');

        console.log(chalk.bold.cyan(`\nTests completed: ${passed} passed, ${failed} failed.`));
        mongoose.connection.close();
        process.exit(failed > 0 ? 1 : 0);
    } catch (e) {
        console.error(chalk.red('\nUnhandled test failure:'), e);
        mongoose.connection.close();
        process.exit(1);
    }
};

runTests();

// scripts/testBindingSelections.script.js
import mongoose from 'mongoose';
import chalk from 'chalk';
import { dbConnection } from '#configs/db';
import PrintService from '#models/printService';
import PrintDocument from '#models/printDocument';
import { getDocumentById } from '#controllers/printDocument';

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
        console.log(chalk.bold.cyan('\nStarting bindingSelections verification test...'));

        const service = await PrintService.findOne({ slug: 'thesis-golden-bindings', isActive: true }).select('_id').lean();
        if (!service) {
            console.log(chalk.red('❌ thesis-golden-bindings service missing in DB. Seed first.'));
            process.exit(1);
        }

        const mockUserId = new mongoose.Types.ObjectId();

        const testSelections = [
            { optionId: 3, subOptionId: null },
            { optionId: 4, subOptionId: 1 },
            { optionId: 6, subOptionId: null },
            { optionId: 7, subOptionId: 1 }
        ];

        // Create document with bindingSelections
        const doc = await PrintDocument.create({
            user: mockUserId,
            service: service._id,
            originalFileName: 'binding-selections-doc.pdf',
            mimeType: 'application/pdf',
            cartStatus: 'AVAILABLE',
            fileUrl: 'http://test.local/selections.pdf',
            customization: {
                bindingSelections: testSelections
            }
        });

        // Fetch document by ID
        const req = mockReq({
            user: { id: mockUserId.toString() },
            params: { documentId: doc._id.toString() }
        });
        const res = mockRes();

        await getDocumentById(req, res);

        const data = res.body?.data;
        const customization = data?.customization;

        if (customization && Array.isArray(customization.bindingSelections)) {
            pass('GET response customization contains bindingSelections array');
            
            // Validate items match
            const matches = testSelections.every((sel, i) => {
                const resSel = customization.bindingSelections[i];
                return resSel && resSel.optionId === sel.optionId && resSel.subOptionId === sel.subOptionId;
            });

            if (matches && customization.bindingSelections.length === testSelections.length) {
                pass('bindingSelections array elements match test selections exactly');
            } else {
                fail(`bindingSelections elements mismatch. Expected: ${JSON.stringify(testSelections)}, Got: ${JSON.stringify(customization.bindingSelections)}`);
            }
        } else {
            fail('GET response customization missing bindingSelections array');
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

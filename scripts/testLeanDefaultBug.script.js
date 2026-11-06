// scripts/testLeanDefaultBug.script.js
import mongoose from 'mongoose';
import chalk from 'chalk';
import { dbConnection } from '#configs/db';
import PrintService from '#models/printService';
import PrintDocument from '#models/printDocument';
import { getDocumentById } from '#controllers/printDocument';

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

const run = async () => {
    try {
        await dbConnection();

        const service = await PrintService.findOne({ slug: 'thesis-golden-bindings', isActive: true }).select('_id').lean();
        const mockUserId = new mongoose.Types.ObjectId();

        // 1. Insert directly into MongoDB collection bypassing Mongoose validation/defaults
        const docId = new mongoose.Types.ObjectId();
        await PrintDocument.collection.insertOne({
            _id: docId,
            user: mockUserId,
            service: service._id,
            originalFileName: 'old-doc-no-selections.pdf',
            mimeType: 'application/pdf',
            cartStatus: 'AVAILABLE',
            fileUrl: 'http://test.local/old.pdf',
            customization: {
                copies: 1,
                colorMode: 'BW',
                // bindingSelections is intentionally completely omitted
            },
            isDeleted: false,
            createdAt: new Date(),
            updatedAt: new Date()
        });

        // 2. Call GET endpoint
        const req = mockReq({
            user: { id: mockUserId.toString() },
            params: { documentId: docId.toString() }
        });
        const res = mockRes();

        await getDocumentById(req, res);

        const data = res.body?.data;
        console.log(chalk.yellow(`Customization response keys: ${Object.keys(data?.customization || {})}`));
        console.log(chalk.yellow(`bindingSelections value: ${JSON.stringify(data?.customization?.bindingSelections)}`));

        if (data?.customization && 'bindingSelections' in data.customization) {
            console.log(chalk.green('✅ SUCCESS: bindingSelections key is present in response'));
        } else {
            console.log(chalk.red('❌ BUG: bindingSelections key is completely missing from response (lean() default omission)'));
        }

        // Cleanup
        await PrintDocument.deleteOne({ _id: docId });
        mongoose.connection.close();

    } catch (err) {
        console.error(err);
        try { mongoose.connection.close(); } catch {}
    }
};

run();

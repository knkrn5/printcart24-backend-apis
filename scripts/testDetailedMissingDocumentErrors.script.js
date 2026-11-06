// scripts/testDetailedMissingDocumentErrors.script.js
import mongoose from 'mongoose';
import chalk from 'chalk';
import { dbConnection } from '#configs/db';
import PrintService from '#models/printService';
import PrintDocument from '#models/printDocument';
import { addPrintItemToCart } from '#controllers/cart';

// Mock Express response
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

// Mock Express request
const mockReq = (overrides = {}) => ({
    user: { id: null },
    body: {},
    ...overrides,
});

const runTests = async () => {
    try {
        await dbConnection();
        console.log(chalk.bold.white('\n🚀 Testing Detailed Missing Document Errors\n'));

        // Fetch document printing service
        const docPrintingService = await PrintService.findOne({ slug: 'document-printing', isActive: true })
            .select('_id name slug serviceType allowedMimeTypes maxPagesPerFile')
            .lean();

        if (!docPrintingService) {
            console.log(chalk.red('\n  ❌ FATAL: "document-printing" service not found. Run seed first.'));
            process.exit(1);
        }

        const currentUserId = new mongoose.Types.ObjectId();
        const otherUserId = new mongoose.Types.ObjectId();

        // 1. Create a valid document for current user
        const validDoc = await PrintDocument.create({
            user: currentUserId,
            service: docPrintingService._id,
            originalFileName: 'valid.pdf',
            fileExtension: 'pdf',
            mimeType: 'application/pdf',
            fileSizeBytes: 1024,
            pageCount: 5,
            fileUrl: 'http://test.local/valid.pdf',
            storageProvider: 'LOCAL',
            storageKey: 'test/valid.pdf',
            uploadStatus: 'READY',
            cartStatus: 'AVAILABLE',
        });

        // 2. Create an unauthorized document (belongs to another user)
        const unauthorizedDoc = await PrintDocument.create({
            user: otherUserId,
            service: docPrintingService._id,
            originalFileName: 'unauthorized.pdf',
            fileExtension: 'pdf',
            mimeType: 'application/pdf',
            fileSizeBytes: 1024,
            pageCount: 5,
            fileUrl: 'http://test.local/unauthorized.pdf',
            storageProvider: 'LOCAL',
            storageKey: 'test/unauthorized.pdf',
            uploadStatus: 'READY',
            cartStatus: 'AVAILABLE',
        });

        // 3. Create a deleted document
        const deletedDoc = await PrintDocument.create({
            user: currentUserId,
            service: docPrintingService._id,
            originalFileName: 'deleted.pdf',
            fileExtension: 'pdf',
            mimeType: 'application/pdf',
            fileSizeBytes: 1024,
            pageCount: 5,
            fileUrl: 'http://test.local/deleted.pdf',
            storageProvider: 'LOCAL',
            storageKey: 'test/deleted.pdf',
            uploadStatus: 'READY',
            cartStatus: 'AVAILABLE',
            isDeleted: true,
        });

        // 4. Create an already ordered document
        const orderedDoc = await PrintDocument.create({
            user: currentUserId,
            service: docPrintingService._id,
            originalFileName: 'ordered.pdf',
            fileExtension: 'pdf',
            mimeType: 'application/pdf',
            fileSizeBytes: 1024,
            pageCount: 5,
            fileUrl: 'http://test.local/ordered.pdf',
            storageProvider: 'LOCAL',
            storageKey: 'test/ordered.pdf',
            uploadStatus: 'READY',
            cartStatus: 'ORDERED',
        });

        // Non-existent document ID
        const nonExistentId = new mongoose.Types.ObjectId().toString();

        console.log(chalk.cyan('Triggering request with detailed errors...'));

        const req = mockReq({
            user: { id: currentUserId },
            body: {
                serviceId: docPrintingService._id.toString(),
                documentIds: [
                    validDoc._id.toString(),
                    unauthorizedDoc._id.toString(),
                    deletedDoc._id.toString(),
                    orderedDoc._id.toString(),
                    nonExistentId,
                ],
            },
        });

        const res = mockRes();
        await addPrintItemToCart(req, res);

        console.log(chalk.yellow(`Response status: ${res.statusCode}`));
        console.log(chalk.yellow(`Response message: ${res.body.message}`));
        console.log(chalk.yellow('Response data:'), JSON.stringify(res.body.data, null, 2));

        const errors = res.body.data?.invalidDocuments || [];

        // Verify all 4 failure types are caught correctly
        const expectedErrors = {
            [unauthorizedDoc._id.toString()]: 'Unauthorized: Document does not belong to user',
            [deletedDoc._id.toString()]: 'Document has been deleted',
            [orderedDoc._id.toString()]: 'Document is not available (current status: ORDERED)',
            [nonExistentId]: 'Document not found',
        };

        let allPassed = true;
        for (const [id, reason] of Object.entries(expectedErrors)) {
            const err = errors.find((e) => e.documentId === id);
            if (err && err.reason === reason) {
                console.log(chalk.green(`✅ PASSED: Detected error for ${id} with reason: "${reason}"`));
            } else {
                console.log(chalk.red(`❌ FAILED: Expected error for ${id} with reason: "${reason}", got: ${JSON.stringify(err)}`));
                allPassed = false;
            }
        }

        // Cleanup created docs
        await PrintDocument.deleteMany({
            _id: {
                $in: [
                    validDoc._id,
                    unauthorizedDoc._id,
                    deletedDoc._id,
                    orderedDoc._id,
                ],
            },
        });

        if (allPassed) {
            console.log(chalk.bold.green('\n🎉 All tests passed successfully!\n'));
            process.exit(0);
        } else {
            console.log(chalk.bold.red('\n❌ Some verification checks failed.\n'));
            process.exit(1);
        }
    } catch (err) {
        console.error(chalk.red('Test error:'), err);
        process.exit(1);
    }
};

runTests();

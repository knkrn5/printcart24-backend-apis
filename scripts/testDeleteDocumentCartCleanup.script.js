import mongoose from 'mongoose';
import chalk from 'chalk';
import { dbConnection } from '#configs/db';
import PrintService from '#models/printService';
import PrintDocument from '#models/printDocument';
import PrintCustomization from '#models/printCustomization';
import Cart from '#models/cart';
import { deleteDocument } from '#controllers/printDocument';
import { addPrintItemToCart } from '#controllers/cart';

// Mock Express req/res
const mockRes = () => {
    const res = {};
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (data) => { res.body = data; return res; };
    return res;
};

const mockReq = (overrides = {}) => ({
    user: { id: null },
    params: {},
    query: {},
    body: {},
    ...overrides,
});

const runTest = async () => {
    try {
        await dbConnection();
        console.log(chalk.bold.white('\n🚀 Document Deletion Cart Cleanup Test\n'));

        // 1. Setup seed data
        const docPrintingService = await PrintService.findOne({ slug: 'document-printing', isActive: true }).lean();
        if (!docPrintingService) {
            console.log(chalk.red('Fatal: Run seed first.'));
            process.exit(1);
        }

        const mockUserId = new mongoose.Types.ObjectId();
        
        // 2. Create test document
        const document = await PrintDocument.create({
            user: mockUserId,
            service: docPrintingService._id,
            originalFileName: 'test.pdf',
            fileExtension: 'pdf',
            mimeType: 'application/pdf',
            fileSizeBytes: 1000,
            pageCount: 5,
            fileUrl: 'http://test.local/test.pdf',
            uploadStatus: 'READY',
            cartStatus: 'AVAILABLE',
        });
        console.log(chalk.green('Created test document:'), document._id);

        // 3. Create a cart and add document to it
        const reqAdd = mockReq({
            user: { id: mockUserId.toString() },
            body: {
                serviceId: docPrintingService._id.toString(),
                documentIds: [document._id.toString()]
            }
        });
        const resAdd = mockRes();
        await addPrintItemToCart(reqAdd, resAdd);
        console.log(chalk.green('Added document to cart. Status code:'), resAdd.statusCode);

        // Verify cart has the item
        let cart = await Cart.findOne({ user: mockUserId, status: 'ACTIVE' }).lean();
        console.log(chalk.blue('Cart items count before delete:'), cart.items.length);
        if (cart.items.length !== 1) {
            throw new Error('Cart setup failed');
        }

        const cartItemId = cart.items[0]._id.toString();

        // 4. Create a customization session to verify it gets deleted
        await PrintCustomization.create({
            user: mockUserId,
            cartItemId,
            documentId: document._id,
            serviceId: docPrintingService._id,
            customization: { copies: 2 },
            status: 'PENDING',
            expiresAt: new Date(Date.now() + 3600000),
        });
        console.log(chalk.green('Created PENDING customization session.'));

        // 5. Delete the document
        const reqDel = mockReq({
            user: { id: mockUserId.toString() },
            params: { documentId: document._id.toString() }
        });
        const resDel = mockRes();
        await deleteDocument(reqDel, resDel);
        console.log(chalk.green('Called deleteDocument. Status code:'), resDel.statusCode);

        // 6. Verify cart is cleaned up
        cart = await Cart.findOne({ user: mockUserId, status: 'ACTIVE' }).lean();
        console.log(chalk.blue('Cart items count after delete:'), cart.items.length);

        // 7. Verify customization session is deleted
        const sessionCount = await PrintCustomization.countDocuments({ cartItemId });
        console.log(chalk.blue('Customization session count after delete:'), sessionCount);

        let testPassed = true;
        if (cart.items.length !== 0) {
            console.log(chalk.red('FAIL: Cart item was not removed.'));
            testPassed = false;
        }
        if (sessionCount !== 0) {
            console.log(chalk.red('FAIL: Customization session was not removed.'));
            testPassed = false;
        }

        if (testPassed) {
            console.log(chalk.bold.green('\n🎉 SUCCESS: Cart item and customization session cleaned up correctly!'));
        } else {
            console.log(chalk.bold.red('\n❌ FAILURE: Cleanup did not work.'));
        }

        // Cleanup
        await PrintDocument.deleteMany({ user: mockUserId });
        await Cart.deleteMany({ user: mockUserId });
        await PrintCustomization.deleteMany({ user: mockUserId });
        console.log(chalk.gray('Cleaned up test data.'));
        process.exit(testPassed ? 0 : 1);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
};

runTest();

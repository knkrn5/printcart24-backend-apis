// scripts/testStaleCustomizationSessionsBug.script.js
import mongoose from 'mongoose';
import chalk from 'chalk';
import { dbConnection } from '#configs/db';
import PrintService from '#models/printService';
import PrintDocument from '#models/printDocument';
import PrintCustomization from '#models/printCustomization';
import Cart from '#models/cart';
import User from '#models/user';
import { addPrintItemToCart, initiateCartItemCustomization } from '#controllers/cart';
import { getUserDocuments } from '#controllers/printDocument';

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

const run = async () => {
    let mockUserId = new mongoose.Types.ObjectId();
    try {
        console.log(chalk.cyan('Connecting to database...'));
        await dbConnection();

        const service = await PrintService.findOne({ slug: 'document-printing', isActive: true }).lean();
        if (!service) {
            throw new Error('Service "document-printing" not found.');
        }

        // Create test user
        const user = await User.create({
            _id: mockUserId,
            firstName: 'StaleSession',
            lastName: 'Tester',
            fullName: 'StaleSession Tester',
            email: 'stalesession-tester@test.local',
            phone: '9900000011',
            isPhoneVerified: true,
            isEmailVerified: true,
        });
        console.log(chalk.green(`[Setup] User document created: ${user._id}`));

        // 1. Create Doc A
        console.log(chalk.cyan('\n1. Creating test document A...'));
        const docA = await PrintDocument.create({
            user: mockUserId,
            service: service._id,
            originalFileName: 'doc_A.pdf',
            mimeType: 'application/pdf',
            cartStatus: 'AVAILABLE',
            fileUrl: 'http://test.local/doc_A.pdf',
            customization: { copies: 1 }
        });

        // Add Doc A to cart
        console.log(chalk.cyan('   Adding Doc A to cart...'));
        const addReqA = mockReq({
            user: { id: mockUserId.toString() },
            body: { serviceId: service._id.toString(), documentIds: [docA._id.toString()] }
        });
        const addResA = mockRes();
        await addPrintItemToCart(addReqA, addResA);

        const cartAfterA = await Cart.findOne({ user: mockUserId, status: 'ACTIVE' }).lean();
        const cartItemIdA = cartAfterA.items.find(item => item.document.toString() === docA._id.toString())._id.toString();
        console.log(chalk.green(`   Doc A added. CartItem A ID: ${cartItemIdA}`));

        // Customize/Edit Doc A (creates PENDING session for A)
        console.log(chalk.cyan('   Initiating customization session for Doc A...'));
        const initReqA = mockReq({ user: { id: mockUserId.toString() }, params: { cartItemId: cartItemIdA } });
        await initiateCartItemCustomization(initReqA, mockRes());

        // 2. Create Doc B
        console.log(chalk.cyan('\n2. Creating test document B...'));
        const docB = await PrintDocument.create({
            user: mockUserId,
            service: service._id,
            originalFileName: 'doc_B.pdf',
            mimeType: 'application/pdf',
            cartStatus: 'AVAILABLE',
            fileUrl: 'http://test.local/doc_B.pdf',
            customization: { copies: 1 }
        });

        // Add Doc B to cart
        console.log(chalk.cyan('   Adding Doc B to cart...'));
        const addReqB = mockReq({
            user: { id: mockUserId.toString() },
            body: { serviceId: service._id.toString(), documentIds: [docB._id.toString()] }
        });
        const addResB = mockRes();
        await addPrintItemToCart(addReqB, addResB);

        const cartAfterB = await Cart.findOne({ user: mockUserId, status: 'ACTIVE' }).lean();
        const cartItemIdB = cartAfterB.items.find(item => item.document.toString() === docB._id.toString())._id.toString();
        console.log(chalk.green(`   Doc B added. CartItem B ID: ${cartItemIdB}`));

        // 3. Initiate customization session for Doc B (the new document)
        console.log(chalk.cyan('\n3. Initiating customization session for Doc B (new document)...'));
        const initReqB = mockReq({ user: { id: mockUserId.toString() }, params: { cartItemId: cartItemIdB } });
        await initiateCartItemCustomization(initReqB, mockRes());

        // 4. Query user documents (GET /api/print-documents)
        console.log(chalk.cyan('\n4. Querying getUserDocuments (GET /api/print-documents)...'));
        const getDocsReq = mockReq({ user: { id: mockUserId.toString() } });
        const getDocsRes = mockRes();
        await getUserDocuments(getDocsReq, getDocsRes);

        const returnedDocs = getDocsRes.body?.data || [];
        const returnedDocIds = returnedDocs.map(d => d._id.toString());
        console.log(chalk.yellow(`   Returned Documents in response: ${JSON.stringify(returnedDocIds)}`));

        // Unrelated previous documents (Doc A) should NOT be returned
        const isDocAReturned = returnedDocIds.includes(docA._id.toString());
        if (isDocAReturned) {
            console.log(chalk.red('\n❌ BUG TRIGGERED: Unrelated older document A is incorrectly included in getUserDocuments!'));
        } else {
            console.log(chalk.green('\n✅ SUCCESS: Unrelated older document A is excluded.'));
        }

        // Cleanup
        console.log(chalk.cyan('\nCleaning up database...'));
        await User.deleteOne({ _id: mockUserId });
        await PrintDocument.deleteMany({ user: mockUserId });
        await PrintCustomization.deleteMany({ user: mockUserId });
        await Cart.deleteMany({ user: mockUserId });
        await mongoose.connection.close();
        console.log(chalk.cyan('Database connection closed.'));
    } catch (err) {
        console.error(chalk.red('\n❌ Error running script:'), err);
        try {
            await User.deleteOne({ _id: mockUserId });
            await mongoose.connection.close();
        } catch {}
    }
};

run();

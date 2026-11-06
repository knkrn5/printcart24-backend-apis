// scripts/testBatchEndpointIssue.script.js
import mongoose from 'mongoose';
import chalk from 'chalk';
import { dbConnection } from '#configs/db';
import PrintService from '#models/printService';
import PrintDocument from '#models/printDocument';
import PrintCustomization from '#models/printCustomization';
import Cart from '#models/cart';
import User from '#models/user';
import { addPrintItemToCart, initiateCartItemCustomization } from '#controllers/cart';
import { saveBatchDocumentDetails } from '#controllers/printDocument';

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
            firstName: 'BatchIssue',
            lastName: 'Tester',
            fullName: 'BatchIssue Tester',
            email: 'batchissue-tester@test.local',
            phone: '9900000012',
            isPhoneVerified: true,
            isEmailVerified: true,
        });
        console.log(chalk.green(`[Setup] User document created: ${user._id}`));

        // 1. Create Document A and add/customize it
        console.log(chalk.cyan('\n1. Creating test document A...'));
        const docA = await PrintDocument.create({
            user: mockUserId,
            service: service._id,
            originalFileName: 'doc_A.png',
            mimeType: 'image/png',
            cartStatus: 'AVAILABLE',
            fileUrl: 'http://test.local/doc_A.png',
            customization: { copies: 1 }
        });

        // Add A to cart
        console.log(chalk.cyan('   Adding Doc A to cart...'));
        const addReqA = mockReq({
            user: { id: mockUserId.toString() },
            body: { serviceId: service._id.toString(), documentIds: [docA._id.toString()] }
        });
        const addResA = mockRes();
        await addPrintItemToCart(addReqA, addResA);

        const cartAfterA = await Cart.findOne({ user: mockUserId, status: 'ACTIVE' }).lean();
        const cartItemIdA = cartAfterA.items.find(item => item.document.toString() === docA._id.toString())._id.toString();

        // Initiate customization for A
        console.log(chalk.cyan('   Initiating customization for Doc A...'));
        const initReqA = mockReq({ user: { id: mockUserId.toString() }, params: { cartItemId: cartItemIdA } });
        await initiateCartItemCustomization(initReqA, mockRes());

        // 2. Create Document B and add/customize it (abandoning A)
        console.log(chalk.cyan('\n2. Creating test document B...'));
        const docB = await PrintDocument.create({
            user: mockUserId,
            service: service._id,
            originalFileName: 'doc_B.png',
            mimeType: 'image/png',
            cartStatus: 'AVAILABLE',
            fileUrl: 'http://test.local/doc_B.png',
            customization: { copies: 1 }
        });

        // Add B to cart
        console.log(chalk.cyan('   Adding Doc B to cart...'));
        const addReqB = mockReq({
            user: { id: mockUserId.toString() },
            body: { serviceId: service._id.toString(), documentIds: [docB._id.toString()] }
        });
        const addResB = mockRes();
        await addPrintItemToCart(addReqB, addResB);

        const cartAfterB = await Cart.findOne({ user: mockUserId, status: 'ACTIVE' }).lean();
        const cartItemIdB = cartAfterB.items.find(item => item.document.toString() === docB._id.toString())._id.toString();

        // Initiate customization for B (abandoning A)
        console.log(chalk.cyan('   Initiating customization for Doc B (abandoning A)...'));
        const initReqB = mockReq({ user: { id: mockUserId.toString() }, params: { cartItemId: cartItemIdB } });
        await initiateCartItemCustomization(initReqB, mockRes());

        // Confirm Document A's PENDING session is deleted
        const sessionA = await PrintCustomization.findOne({ cartItemId: cartItemIdA, status: 'PENDING' }).lean();
        if (!sessionA) {
            console.log(chalk.green('   Confirmed: Document A\'s PENDING session was deleted.'));
        } else {
            console.log(chalk.red('   WARNING: Document A\'s PENDING session is still active!'));
        }

        // 3. Call POST /api/print-documents/batch sending BOTH B and A (simulating frontend payload with stale doc A by fileUrl)
        console.log(chalk.cyan('\n3. Calling POST /api/print-documents/batch with BOTH B and A (by fileUrl)...'));
        const batchReq = mockReq({
            user: { id: mockUserId.toString() },
            body: {
                serviceId: service._id.toString(),
                documents: [
                    {
                        originalFileName: 'doc_B.png',
                        mimeType: 'image/png',
                        fileUrl: 'http://test.local/doc_B.png',
                        pageCount: 1
                    },
                    {
                        originalFileName: 'doc_A.png',
                        mimeType: 'image/png',
                        fileUrl: 'http://test.local/doc_A.png',
                        pageCount: 1
                    }
                ]
            }
        });
        const batchRes = mockRes();
        await saveBatchDocumentDetails(batchReq, batchRes);

        console.log(chalk.gray(`   Batch API status code: ${batchRes.statusCode}`));
        console.log(chalk.gray(`   Batch API response body: ${JSON.stringify(batchRes.body, null, 2)}`));

        const returnedBatchDocs = batchRes.body?.data || [];
        const returnedBatchDocIds = returnedBatchDocs.map(d => d._id.toString());
        console.log(chalk.yellow(`   Batch API returned document IDs: ${JSON.stringify(returnedBatchDocIds)}`));

        const returnedFileNames = returnedBatchDocs.map(d => d.originalFileName);
        console.log(chalk.yellow(`   Batch API returned file names: ${JSON.stringify(returnedFileNames)}`));

        // Let's check if the returned document for A is a newly created duplicate (its ID is different from docA._id)
        const matchedDocA = returnedBatchDocs.find(d => d.originalFileName === 'doc_A.png');
        if (matchedDocA) {
            if (matchedDocA._id.toString() !== docA._id.toString()) {
                console.log(chalk.red(`\n❌ BUG TRIGGERED: A duplicate document A was created (New ID: ${matchedDocA._id}, Original ID: ${docA._id})`));
            } else {
                console.log(chalk.green('\n✅ SUCCESS: Document A was reused without duplicating.'));
            }
        } else {
            console.log(chalk.green('\n✅ SUCCESS: Document A is not returned by the batch endpoint.'));
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

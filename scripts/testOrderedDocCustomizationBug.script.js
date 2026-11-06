// scripts/testOrderedDocCustomizationBug.script.js
import mongoose from 'mongoose';
import chalk from 'chalk';
import { dbConnection } from '#configs/db';
import PrintService from '#models/printService';
import PrintDocument from '#models/printDocument';
import PrintCustomization from '#models/printCustomization';
import Cart from '#models/cart';
import User from '#models/user';
import { getCart, addPrintItemToCart, initiateCartItemCustomization } from '#controllers/cart';
import { getUserDocuments } from '#controllers/printDocument';
import { placeOrderInternal } from '#controllers/orders';

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
    try {
        console.log(chalk.cyan('Connecting to database...'));
        await dbConnection();

        const service = await PrintService.findOne({ slug: 'document-printing', isActive: true }).lean();
        if (!service) {
            throw new Error('Service "document-printing" not found.');
        }

        const mockUserId = new mongoose.Types.ObjectId();
        console.log(chalk.gray(`Mock User ID: ${mockUserId}`));

        // Create a real User document
        const user = await User.create({
            _id: mockUserId,
            firstName: 'BugRepro',
            lastName: 'Tester',
            fullName: 'BugRepro Tester',
            email: 'bugrepro-tester@test.local',
            phone: '9900000009',
            isPhoneVerified: true,
            isEmailVerified: true,
        });
        console.log(chalk.green(`   User document created: ${user._id}`));

        // 1. Create a test document
        console.log(chalk.cyan('\n1. Creating test document...'));
        const doc = await PrintDocument.create({
            user: mockUserId,
            service: service._id,
            originalFileName: 'bug_repro_test.pdf',
            mimeType: 'application/pdf',
            cartStatus: 'AVAILABLE',
            fileUrl: 'http://test.local/bug_repro_test.pdf',
            customization: {
                copies: 1,
                colorMode: 'BW',
                paperSize: 'A4',
                sideMode: 'SINGLE',
            }
        });
        console.log(chalk.green(`   Document created: ${doc._id} (cartStatus: ${doc.cartStatus})`));

        // 2. Add to cart
        console.log(chalk.cyan('\n2. Adding document to cart...'));
        const addReq = mockReq({
            user: { id: mockUserId.toString() },
            body: {
                serviceId: service._id.toString(),
                documentIds: [doc._id.toString()]
            }
        });
        const addRes = mockRes();
        await addPrintItemToCart(addReq, addRes);
        console.log(chalk.gray(`   Add to cart status code: ${addRes.statusCode}`));

        // Fetch active cart item ID
        const activeCart = await Cart.findOne({ user: mockUserId, status: 'ACTIVE' });
        const cartItem = activeCart.items[0];
        const cartItemId = cartItem._id.toString();
        console.log(chalk.green(`   Added to cart. CartItem ID: ${cartItemId}`));

        // 3. Initiate customization session (creates a PENDING session)
        console.log(chalk.cyan('\n3. Initiating customization session (creates PENDING session)...'));
        const initReq = mockReq({
            user: { id: mockUserId.toString() },
            params: { cartItemId }
        });
        const initRes = mockRes();
        await initiateCartItemCustomization(initReq, initRes);
        console.log(chalk.gray(`   Initiate status code: ${initRes.statusCode}`));

        // Set delivery mode to PICKUP to bypass address check during checkout simulation
        activeCart.deliveryMode = 'PICKUP';
        await activeCart.save();

        // Verify session exists
        const sessionCountBefore = await PrintCustomization.countDocuments({
            cartItemId,
            user: mockUserId,
            status: 'PENDING'
        });
        console.log(chalk.green(`   PENDING customization session count before order: ${sessionCountBefore}`));

        // 4. Place the order
        console.log(chalk.cyan('\n4. Placing/Finalizing order (simulating checkout)...'));
        // Place the order internally (this sets cartStatus to ORDERED and checks out the cart)
        const order = await placeOrderInternal(mockUserId.toString(), null, 'ACTIVE');
        console.log(chalk.green(`   Order placed: ${order._id}`));

        // Verify document cartStatus
        const updatedDoc = await PrintDocument.findById(doc._id).lean();
        console.log(chalk.green(`   Document cartStatus after order: ${updatedDoc.cartStatus}`));

        // 5. Query user documents
        console.log(chalk.cyan('\n5. Querying getUserDocuments (GET /api/print-documents)...'));
        const getDocsReq = mockReq({
            user: { id: mockUserId.toString() }
        });
        const getDocsRes = mockRes();
        await getUserDocuments(getDocsReq, getDocsRes);

        const returnedDocs = getDocsRes.body?.data || [];
        const returnedDocIds = returnedDocs.map(d => d._id.toString());
        console.log(chalk.yellow(`   Returned Documents in response: ${JSON.stringify(returnedDocIds)}`));

        const isDocReturned = returnedDocIds.includes(doc._id.toString());
        if (isDocReturned) {
            console.log(chalk.red('\n❌ BUG TRIGGERED: Document is ORDERED but still returned in getUserDocuments!'));
        } else {
            console.log(chalk.green('\n✅ SUCCESS: Ordered document is filtered out of getUserDocuments.'));
        }

        // Cleanup
        console.log(chalk.cyan('\nCleaning up database...'));
        await User.deleteOne({ _id: mockUserId });
        await PrintDocument.deleteMany({ user: mockUserId });
        await PrintCustomization.deleteMany({ user: mockUserId });
        await Cart.deleteMany({ user: mockUserId });
        if (order) {
            const PrintOrder = mongoose.model('PrintOrder');
            await PrintOrder.deleteOne({ _id: order._id });
        }
        await mongoose.connection.close();
        console.log(chalk.cyan('Database connection closed.'));
    } catch (err) {
        console.error(chalk.red('Error running script:'), err);
        try {
            await User.deleteOne({ _id: mockUserId });
            await mongoose.connection.close();
        } catch {}
    }
};

run();

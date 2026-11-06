// scripts/testFinalRegressionFlow.script.js
import mongoose from 'mongoose';
import chalk from 'chalk';
import { dbConnection } from '#configs/db';
import PrintService from '#models/printService';
import PrintDocument from '#models/printDocument';
import PrintCustomization from '#models/printCustomization';
import Cart from '#models/cart';
import User from '#models/user';
import { getCart, addPrintItemToCart, initiateCartItemCustomization } from '#controllers/cart';
import { getUserDocuments, updateDocumentCustomization } from '#controllers/printDocument';
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
    let mockUserId = new mongoose.Types.ObjectId();
    try {
        console.log(chalk.cyan('Connecting to database...'));
        await dbConnection();

        const service = await PrintService.findOne({ slug: 'document-printing', isActive: true }).lean();
        if (!service) {
            throw new Error('Service "document-printing" not found.');
        }

        // Create a real User document
        const user = await User.create({
            _id: mockUserId,
            firstName: 'Regression',
            lastName: 'Tester',
            fullName: 'Regression Tester',
            email: 'regression-tester@test.local',
            phone: '9900000010',
            isPhoneVerified: true,
            isEmailVerified: true,
        });
        console.log(chalk.green(`\n[Setup] User document created: ${user._id}`));

        // 1. Create/upload a document
        console.log(chalk.cyan('\n1. Creating/Uploading test document...'));
        const doc = await PrintDocument.create({
            user: mockUserId,
            service: service._id,
            originalFileName: 'regression_test.pdf',
            mimeType: 'application/pdf',
            cartStatus: 'AVAILABLE',
            fileUrl: 'http://test.local/regression_test.pdf',
            customization: {
                copies: 1,
                colorMode: 'BW',
                paperSize: 'A4',
                sideMode: 'SINGLE',
            }
        });
        console.log(chalk.green(`   Document created: ${doc._id} (cartStatus: ${doc.cartStatus})`));

        // Add to cart to get a cart item ID
        console.log(chalk.cyan('\n[Prep] Adding document to cart to get cartItemId...'));
        const addReq = mockReq({
            user: { id: mockUserId.toString() },
            body: {
                serviceId: service._id.toString(),
                documentIds: [doc._id.toString()]
            }
        });
        const addRes = mockRes();
        await addPrintItemToCart(addReq, addRes);

        const activeCart = await Cart.findOne({ user: mockUserId, status: 'ACTIVE' });
        const cartItemId = activeCart.items[0]._id.toString();
        console.log(chalk.green(`   Cart item created. ID: ${cartItemId}`));

        // 2. Customize it using POST /api/cart/items/:id/customize (initiate edit session)
        console.log(chalk.cyan('\n2. Initiating customization using POST /api/cart/items/:id/customize...'));
        const initReq = mockReq({
            user: { id: mockUserId.toString() },
            params: { cartItemId }
        });
        const initRes = mockRes();
        await initiateCartItemCustomization(initReq, initRes);
        console.log(chalk.gray(`   Status code: ${initRes.statusCode}`));

        // Verify session is created and status is PENDING
        const pendingSession = await PrintCustomization.findOne({ cartItemId, user: mockUserId }).lean();
        if (pendingSession && pendingSession.status === 'PENDING') {
            console.log(chalk.green('   PENDING session successfully created.'));
        } else {
            throw new Error('PENDING session not found or has incorrect status.');
        }

        // Save customization details (PATCH /print-documents/:id)
        console.log(chalk.cyan('\n[Prep] Customizing options via PATCH /print-documents/:documentId...'));
        const patchReq = mockReq({
            user: { id: mockUserId.toString() },
            params: { documentId: doc._id.toString() },
            body: { copies: 2 }
        });
        const patchRes = mockRes();
        await updateDocumentCustomization(patchReq, patchRes);
        console.log(chalk.gray(`   PATCH customization status code: ${patchRes.statusCode}`));

        // Complete/save re-customization back to cart
        console.log(chalk.cyan('\n[Prep] Completing customization back to cart...'));
        const saveReq = mockReq({
            user: { id: mockUserId.toString() },
            body: {
                serviceId: service._id.toString(),
                documentIds: [doc._id.toString()],
                cartItemId
            }
        });
        const saveRes = mockRes();
        await addPrintItemToCart(saveReq, saveRes);
        console.log(chalk.gray(`   Complete customization status code: ${saveRes.statusCode}`));

        // Set delivery mode to PICKUP to bypass address validations during checkout
        const updatedCart = await Cart.findOne({ user: mockUserId, status: 'ACTIVE' });
        updatedCart.deliveryMode = 'PICKUP';
        await updatedCart.save();

        // 3. Place the order
        console.log(chalk.cyan('\n3. Placing the order (checkout)...'));
        const order = await placeOrderInternal(mockUserId.toString(), null, 'ACTIVE');
        console.log(chalk.green(`   Order placed: ${order._id}`));

        // 4. Confirm its cartStatus becomes ORDERED
        console.log(chalk.cyan('\n4. Verifying document cartStatus is ORDERED...'));
        const docAfterOrder = await PrintDocument.findById(doc._id).lean();
        if (docAfterOrder.cartStatus === 'ORDERED') {
            console.log(chalk.green('   Confirmed: Document cartStatus is ORDERED.'));
        } else {
            throw new Error(`Document cartStatus is not ORDERED! Current status: ${docAfterOrder.cartStatus}`);
        }

        // 5. Confirm its pending/completed PrintCustomization session is deleted
        console.log(chalk.cyan('\n5. Verifying PrintCustomization session is deleted...'));
        const sessionAfterOrder = await PrintCustomization.findOne({ documentId: doc._id }).lean();
        if (!sessionAfterOrder) {
            console.log(chalk.green('   Confirmed: PrintCustomization session was successfully deleted.'));
        } else {
            throw new Error('PrintCustomization session was NOT deleted!');
        }

        // 6. Confirm the ordered document is no longer returned by GET /api/print-documents
        console.log(chalk.cyan('\n6. Verifying GET /api/print-documents does not return ordered document...'));
        const getDocsReq = mockReq({ user: { id: mockUserId.toString() } });
        const getDocsRes = mockRes();
        await getUserDocuments(getDocsReq, getDocsRes);
        const returnedDocIds = (getDocsRes.body?.data || []).map(d => d._id.toString());
        if (!returnedDocIds.includes(doc._id.toString())) {
            console.log(chalk.green('   Confirmed: Ordered document is excluded from getUserDocuments list.'));
        } else {
            throw new Error('Ordered document was returned by getUserDocuments!');
        }

        // 7. Test POST /api/cart/items/print and confirm previous "Document is not available (current status: ORDERED)" error does not occur
        // because it's no longer in the customization flow. (We also confirm that attempting to add it returns the correct validation error).
        console.log(chalk.cyan('\n7. Attempting to add ordered document back to cart...'));
        const reAddReq = mockReq({
            user: { id: mockUserId.toString() },
            body: {
                serviceId: service._id.toString(),
                documentIds: [doc._id.toString()]
            }
        });
        const reAddRes = mockRes();
        await addPrintItemToCart(reAddReq, reAddRes);
        console.log(chalk.gray(`   Status code: ${reAddRes.statusCode}`));
        console.log(chalk.gray(`   Message returned: ${reAddRes.body?.message}`));
        if (reAddRes.statusCode === 400 && reAddRes.body?.message === 'Some documents are missing, invalid, or unavailable') {
            console.log(chalk.green('   Confirmed: Valid validation error is returned (ordered document not available to add).'));
        } else {
            throw new Error('Adding ordered document did not return the expected validation error.');
        }

        // 8. Verify that normal AVAILABLE non-ordered documents still work correctly for customization and add-to-cart
        console.log(chalk.cyan('\n8. Verifying normal AVAILABLE document works correctly...'));
        const normalDoc = await PrintDocument.create({
            user: mockUserId,
            service: service._id,
            originalFileName: 'normal_doc.pdf',
            mimeType: 'application/pdf',
            cartStatus: 'AVAILABLE',
            fileUrl: 'http://test.local/normal_doc.pdf',
            customization: {
                copies: 1,
                colorMode: 'BW',
                paperSize: 'A4',
                sideMode: 'SINGLE',
            }
        });
        console.log(chalk.gray(`   Normal AVAILABLE doc created: ${normalDoc._id}`));

        // Verify it is listed in getUserDocuments
        const getDocsReq2 = mockReq({ user: { id: mockUserId.toString() } });
        const getDocsRes2 = mockRes();
        await getUserDocuments(getDocsReq2, getDocsRes2);
        const returnedDocIds2 = (getDocsRes2.body?.data || []).map(d => d._id.toString());
        if (returnedDocIds2.includes(normalDoc._id.toString())) {
            console.log(chalk.green('   Confirmed: AVAILABLE document is successfully listed.'));
        } else {
            throw new Error('AVAILABLE document is missing from getUserDocuments list!');
        }

        // Add normal document to cart
        const addReq2 = mockReq({
            user: { id: mockUserId.toString() },
            body: {
                serviceId: service._id.toString(),
                documentIds: [normalDoc._id.toString()]
            }
        });
        const addRes2 = mockRes();
        await addPrintItemToCart(addReq2, addRes2);
        if (addRes2.statusCode === 200) {
            console.log(chalk.green('   Confirmed: Normal AVAILABLE document added to cart successfully.'));
        } else {
            throw new Error(`Failed to add normal document to cart: ${addRes2.body?.message}`);
        }

        console.log(chalk.bold.green('\n🎉 ALL REGRESSION TESTS PASSED SUCCESSFULLY!'));

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
        console.error(chalk.red('\n❌ REGRESSION TEST FAILED:'), err);
        try {
            await User.deleteOne({ _id: mockUserId });
            await mongoose.connection.close();
        } catch {}
    }
};

run();

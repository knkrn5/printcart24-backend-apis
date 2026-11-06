// scripts/verifyOriginalFilenameFlow.script.js
import mongoose from 'mongoose';
import chalk from 'chalk';
import { dbConnection } from '#configs/db';
import PrintService from '#models/printService';
import PrintDocument from '#models/printDocument';
import Cart from '#models/cart';
import PrintOrder from '#models/printOrder';
import User from '#models/user';
import { getCart, addPrintItemToCart } from '#controllers/cart';
import { getUserDocuments, getDocumentById } from '#controllers/printDocument';
import { placeOrderInternal, getOrderById } from '#controllers/orders';

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

const runVerification = async () => {
    console.log(chalk.bold.blue('\n============================================================'));
    console.log(chalk.bold.blue('  VERIFYING ORIGINAL FILENAME FLOW (UPLOAD -> CART -> ORDER)'));
    console.log(chalk.bold.blue('============================================================\n'));

    try {
        await dbConnection();

        // 1. Fetch Print Service
        const service = await PrintService.findOne({ slug: 'document-printing', isActive: true });
        if (!service) {
            console.log(chalk.red('❌ FATAL: "document-printing" service not found. Make sure services are seeded.'));
            process.exit(1);
        }
        console.log(chalk.gray(`Found print service: ${service.name} (ID: ${service._id})`));

        // 2. Setup/retrieve test user
        const testEmail = 'filename-tester@test.local';
        const testPhone = '9988776655';
        await User.deleteOne({ email: testEmail });
        await User.deleteOne({ phone: testPhone });
        
        const user = await User.create({
            firstName: 'Filename',
            lastName: 'Tester',
            fullName: 'Filename Tester',
            email: testEmail,
            phone: testPhone,
            isPhoneVerified: true,
            isEmailVerified: true,
        });
        console.log(chalk.green(`Created test user: ${user.fullName} (ID: ${user._id})`));

        // Clean up any old active carts/documents/orders for clean run but KEEP the new one at the end
        await Cart.deleteOne({ user: user._id, status: 'ACTIVE' });
        
        // 3. Create a Document to simulate file upload
        const testFileName = 'my_semester_final_project_report_v2.pdf';
        const fileUrl = `https://printcart24-test-bucket.s3.amazonaws.com/uploads/${testFileName}`;
        
        const document = await PrintDocument.create({
            user: user._id,
            service: service._id,
            originalFileName: testFileName,
            fileExtension: 'pdf',
            mimeType: 'application/pdf',
            fileSizeBytes: 2048576,
            pageCount: 15,
            fileUrl: fileUrl,
            storageProvider: 'S3',
            storageKey: `uploads/${testFileName}`,
            uploadStatus: 'READY',
            cartStatus: 'AVAILABLE',
            customization: {
                copies: 1,
                orientation: 'PORTRAIT',
                paperSize: 'A4',
                colorMode: 'COLOR',
                sideMode: 'SINGLE',
                paperQuality: '',
            }
        });
        console.log(chalk.green(`Created test document in DB: ${document._id}`));
        console.log(chalk.gray(`  Original filename: "${document.originalFileName}"`));

        // 4. Test GET /api/documents (getUserDocuments controller)
        console.log(chalk.bold.yellow('\nStep 1: Test GET /api/documents list...'));
        {
            const req = mockReq({ user: { id: user._id.toString() } });
            const res = mockRes();
            await getUserDocuments(req, res);
            
            const docs = res.body?.data || [];
            const matchingDoc = docs.find(d => d._id.toString() === document._id.toString());
            
            if (matchingDoc) {
                console.log(`Returned doc in list originalFileName: "${matchingDoc.originalFileName}"`);
                if (matchingDoc.originalFileName === testFileName) {
                    console.log(chalk.green(`  ✅ SUCCESS: Filename matches original "${testFileName}"`));
                } else {
                    console.log(chalk.red(`  ❌ FAILURE: Filename is "${matchingDoc.originalFileName}"`));
                }
            } else {
                console.log(chalk.red('  ❌ FAILURE: Test document not returned in list'));
            }
        }

        // 5. Test GET /api/documents/:id (getDocumentById controller)
        console.log(chalk.bold.yellow('\nStep 2: Test GET /api/documents/:id detail...'));
        {
            const req = mockReq({
                user: { id: user._id.toString() },
                params: { documentId: document._id.toString() }
            });
            const res = mockRes();
            await getDocumentById(req, res);
            
            const doc = res.body?.data;
            if (doc) {
                console.log(`Returned doc detail originalFileName: "${doc.originalFileName}"`);
                if (doc.originalFileName === testFileName) {
                    console.log(chalk.green(`  ✅ SUCCESS: Filename matches original "${testFileName}"`));
                } else {
                    console.log(chalk.red(`  ❌ FAILURE: Filename is "${doc.originalFileName}"`));
                }
            } else {
                console.log(chalk.red('  ❌ FAILURE: Test document not returned in detail'));
            }
        }

        // 6. Test POST /api/cart/items/print (addToCart controller)
        console.log(chalk.bold.yellow('\nStep 3: Add document to cart...'));
        {
            const req = mockReq({
                user: { id: user._id.toString() },
                body: {
                    serviceId: service._id.toString(),
                    documentIds: [document._id.toString()]
                }
            });
            const res = mockRes();
            await addPrintItemToCart(req, res);
            
            if (res.statusCode === 200) {
                console.log(chalk.green('  ✅ SUCCESS: Document added to cart successfully'));
            } else {
                console.log(chalk.red(`  ❌ FAILURE: Status code ${res.statusCode}`), res.body);
            }
        }

        // 7. Test GET /api/cart (getCart controller)
        console.log(chalk.bold.yellow('\nStep 4: Fetch cart items and verify originalFileName...'));
        {
            const req = mockReq({ user: { id: user._id.toString() } });
            const res = mockRes();
            await getCart(req, res);
            
            const cartItems = res.body?.data?.items || [];
            const cartItem = cartItems.find(item => item.document?._id.toString() === document._id.toString());
            
            if (cartItem) {
                const returnedFileName = cartItem.document.originalFileName;
                console.log(`Cart item originalFileName returned: "${returnedFileName}"`);
                if (returnedFileName === testFileName) {
                    console.log(chalk.green(`  ✅ SUCCESS: Cart item filename matches original "${testFileName}"`));
                } else {
                    console.log(chalk.red(`  ❌ FAILURE: Cart item filename is "${returnedFileName}" (expected "${testFileName}")`));
                }
            } else {
                console.log(chalk.red('  ❌ FAILURE: Document not found in cart'));
            }
        }

        // 8. Test Place Order
        console.log(chalk.bold.yellow('\nStep 5: Place local order and check final saved filename...'));
        {
            // Update cart context to allow placeOrderInternal to succeed
            const cart = await Cart.findOne({ user: user._id, status: 'ACTIVE' });
            cart.deliveryMode = 'PICKUP';
            await cart.save();

            // Run placeOrderInternal
            const order = await placeOrderInternal(user._id.toString());
            console.log(chalk.green(`Order placed successfully! Order ID: ${order._id}, Order Number: ${order.orderNumber}`));
            
            // Retrieve placed order detail from DB
            const placedOrder = await PrintOrder.findById(order._id).populate('items.document');
            const orderItem = placedOrder.items?.[0];
            const savedOriginalFileName = orderItem?.document?.originalFileName;

            console.log(`Saved originalFileName in database order item: "${savedOriginalFileName}"`);
            if (savedOriginalFileName === testFileName) {
                console.log(chalk.green(`  ✅ SUCCESS: Saved order filename matches original "${testFileName}"`));
            } else {
                console.log(chalk.red(`  ❌ FAILURE: Saved order filename is "${savedOriginalFileName}" (expected "${testFileName}")`));
            }

            // Test GET /api/orders/:id (getOrderById controller)
            console.log(chalk.bold.yellow('\nStep 6: Verify API GET /api/orders/:id details response...'));
            const req = mockReq({
                user: { id: user._id.toString() },
                params: { orderId: order._id.toString() }
            });
            const res = mockRes();
            await getOrderById(req, res);

            const orderDetail = res.body?.data;
            const detailItem = orderDetail?.items?.[0];
            console.log(`Order detail item originalFileName returned: "${detailItem?.originalFileName}"`);
            if (detailItem?.originalFileName === testFileName) {
                console.log(chalk.green(`  ✅ SUCCESS: Order API details matches original "${testFileName}"`));
            } else {
                console.log(chalk.red(`  ❌ FAILURE: Order API details returned "${detailItem?.originalFileName}"`));
            }

            console.log(chalk.bold.cyan('\n------------------------------------------------------------'));
            console.log(chalk.bold.cyan('  * Sample order is kept in database for you to inspect! *'));
            console.log(chalk.bold.cyan(`  User email: ${testEmail}`));
            console.log(chalk.bold.cyan(`  Order ID: ${order._id}`));
            console.log(chalk.bold.cyan(`  Order Number: ${order.orderNumber}`));
            console.log(chalk.bold.cyan('------------------------------------------------------------\n'));
        }

    } catch (err) {
        console.error(chalk.red('Verification failed with error:'), err);
    } finally {
        await mongoose.disconnect();
        console.log(chalk.gray('Disconnected from DB.'));
    }
};

runVerification();

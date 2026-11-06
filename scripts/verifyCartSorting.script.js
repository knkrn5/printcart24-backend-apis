// scripts/verifyCartSorting.script.js
import mongoose from 'mongoose';
import chalk from 'chalk';
import { dbConnection } from '#configs/db';
import PrintService from '#models/printService';
import PrintDocument from '#models/printDocument';
import StationeryProduct from '#models/stationeryProduct';
import Cart from '#models/cart';
import { getCart, addPrintItemToCart, addStationeryItemToCart, updateCartItemCopies } from '#controllers/cart';

let passed = 0;
let failed = 0;

const pass = (label, detail = '') => {
    console.log(chalk.green(`  ✅ PASS: ${label}`) + (detail ? chalk.gray(` — ${detail}`) : ''));
    passed++;
};

const fail = (label, detail = '') => {
    console.log(chalk.red(`  ❌ FAIL: ${label}`) + (detail ? chalk.gray(` — ${detail}`) : ''));
    failed++;
};

const section = (title) =>
    console.log(chalk.bold.cyan(`\n${'─'.repeat(70)}\n  ${title}\n${'─'.repeat(70)}`));

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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const runTests = async () => {
    const mockUserId = new mongoose.Types.ObjectId();
    let docPrintingService = null;
    let docA = null;
    let docB = null;
    let productA = null;
    let productB = null;

    try {
        await dbConnection();
        section('SETUP — Creating test data');

        docPrintingService = await PrintService.findOne({ slug: 'document-printing', isActive: true });
        if (!docPrintingService) {
            console.log(chalk.red('❌ FATAL: document-printing service not found. Seed first.'));
            process.exit(1);
        }

        // Create Print Documents
        docA = await PrintDocument.create({
            user: mockUserId,
            service: docPrintingService._id,
            originalFileName: 'doc-A.pdf',
            fileUrl: 'http://test.local/doc-A.pdf',
            mimeType: 'application/pdf',
            cartStatus: 'AVAILABLE',
        });
        docB = await PrintDocument.create({
            user: mockUserId,
            service: docPrintingService._id,
            originalFileName: 'doc-B.pdf',
            fileUrl: 'http://test.local/doc-B.pdf',
            mimeType: 'application/pdf',
            cartStatus: 'AVAILABLE',
        });

        // Create Stationery Products (Ensure unique brand/name combinations)
        productA = await StationeryProduct.create({
            name: `Test Pen A - ${mockUserId}`,
            brand: 'BrandA',
            itemPrice: 10,
            stock: 100,
            isActive: true,
        });
        productB = await StationeryProduct.create({
            name: `Test Pen B - ${mockUserId}`,
            brand: 'BrandB',
            itemPrice: 15,
            stock: 100,
            isActive: true,
        });

        console.log(chalk.gray(`  Test user: ${mockUserId}`));
        console.log(chalk.gray(`  docA: ${docA._id}`));
        console.log(chalk.gray(`  docB: ${docB._id}`));
        console.log(chalk.gray(`  productA: ${productA._id}`));
        console.log(chalk.gray(`  productB: ${productB._id}`));

        // ══════════════════════════════════════════════════════════════════════
        // PART 1: Print items sorting
        // ══════════════════════════════════════════════════════════════════════
        section('PART 1: Print Items Sorting Verification');

        // Add docA
        let req = mockReq({ user: { id: mockUserId.toString() }, body: { serviceId: docPrintingService._id.toString(), documentIds: [docA._id.toString()] } });
        let res = mockRes();
        await addPrintItemToCart(req, res);
        if (res.statusCode === 200) pass('Added docA to cart');
        else fail('Failed to add docA to cart', JSON.stringify(res.body));

        await sleep(150); // Ensure timestamp difference is measurable (> 100ms)

        // Add docB
        req = mockReq({ user: { id: mockUserId.toString() }, body: { serviceId: docPrintingService._id.toString(), documentIds: [docB._id.toString()] } });
        res = mockRes();
        await addPrintItemToCart(req, res);
        if (res.statusCode === 200) pass('Added docB to cart');
        else fail('Failed to add docB to cart', JSON.stringify(res.body));

        // Get Cart — expect docB (newest) at index 0, docA at index 1
        req = mockReq({ user: { id: mockUserId.toString() } });
        res = mockRes();
        await getCart(req, res);
        
        let cartItems = res.body?.data?.items || [];
        if (cartItems.length === 2 && 
            cartItems[0].document._id.toString() === docB._id.toString() &&
            cartItems[1].document._id.toString() === docA._id.toString()) {
            pass('Items sorted correctly after addition (docB first, docA second)');
        } else {
            fail('Incorrect sorting after addition', JSON.stringify(cartItems.map(i => i.document._id)));
        }

        await sleep(150);

        // Update docA copies (increment)
        const itemAId = cartItems.find(item => item.document._id.toString() === docA._id.toString())._id;
        req = mockReq({ 
            user: { id: mockUserId.toString() }, 
            params: { itemId: itemAId.toString() }, 
            query: { action: 'increment' } 
        });
        res = mockRes();
        await updateCartItemCopies(req, res);
        if (res.statusCode === 200) pass('Incremented copies for docA');
        else fail('Failed to increment copies for docA', JSON.stringify(res.body));

        // Get Cart — expect docB at index 0, docA at index 1 (order remains same)
        req = mockReq({ user: { id: mockUserId.toString() } });
        res = mockRes();
        await getCart(req, res);

        cartItems = res.body?.data?.items || [];
        if (cartItems.length === 2 && 
            cartItems[0].document._id.toString() === docB._id.toString() &&
            cartItems[1].document._id.toString() === docA._id.toString()) {
            pass('Items sorted correctly after update (order remains docB first, docA second)');
        } else {
            fail('Incorrect sorting after update', JSON.stringify(cartItems.map(i => i.document._id)));
        }

        // ══════════════════════════════════════════════════════════════════════
        // PART 2: Stationery items sorting
        // ══════════════════════════════════════════════════════════════════════
        section('PART 2: Stationery Items Sorting Verification');

        // Add productA
        req = mockReq({ user: { id: mockUserId.toString() }, body: { productId: productA._id.toString(), quantity: 1 } });
        res = mockRes();
        await addStationeryItemToCart(req, res);
        if (res.statusCode === 200) pass('Added productA to cart');
        else fail('Failed to add productA to cart', JSON.stringify(res.body));

        await sleep(150);

        // Add productB
        req = mockReq({ user: { id: mockUserId.toString() }, body: { productId: productB._id.toString(), quantity: 2 } });
        res = mockRes();
        await addStationeryItemToCart(req, res);
        if (res.statusCode === 200) pass('Added productB to cart');
        else fail('Failed to add productB to cart', JSON.stringify(res.body));

        // Get Cart — expect productB (newest) at index 0, productA at index 1
        req = mockReq({ user: { id: mockUserId.toString() } });
        res = mockRes();
        await getCart(req, res);

        let stationeryItems = res.body?.data?.stationeryItems || [];
        if (stationeryItems.length === 2 && 
            stationeryItems[0].stationery.toString() === productB._id.toString() &&
            stationeryItems[1].stationery.toString() === productA._id.toString()) {
            pass('Stationery sorted correctly after addition (productB first, productA second)');
        } else {
            fail('Incorrect stationery sorting after addition', JSON.stringify(stationeryItems.map(i => i.stationery)));
        }

        await sleep(150);

        // Update quantity of productA
        req = mockReq({ user: { id: mockUserId.toString() }, body: { productId: productA._id.toString(), quantity: 3 } });
        res = mockRes();
        await addStationeryItemToCart(req, res);
        if (res.statusCode === 200) pass('Updated quantity of productA to 3');
        else fail('Failed to update quantity of productA', JSON.stringify(res.body));

        // Get Cart — expect productB at index 0, productA at index 1 (order remains same)
        req = mockReq({ user: { id: mockUserId.toString() } });
        res = mockRes();
        await getCart(req, res);

        stationeryItems = res.body?.data?.stationeryItems || [];
        if (stationeryItems.length === 2 && 
            stationeryItems[0].stationery.toString() === productB._id.toString() &&
            stationeryItems[1].stationery.toString() === productA._id.toString()) {
            pass('Stationery sorted correctly after update (order remains productB first, productA second)');
        } else {
            fail('Incorrect stationery sorting after update', JSON.stringify(stationeryItems.map(i => i.stationery)));
        }

        console.log('\n=======================================');
        console.log(`🎉 TEST SUMMARY: ${passed} Passed, ${failed} Failed`);
        console.log('=======================================\n');

        if (failed > 0) {
            process.exit(1);
        }
    } catch (err) {
        console.error('❌ Error running tests:', err);
        process.exit(1);
    } finally {
        section('CLEANUP — Removing test records');
        if (docA) await PrintDocument.deleteOne({ _id: docA._id });
        if (docB) await PrintDocument.deleteOne({ _id: docB._id });
        if (productA) await StationeryProduct.deleteOne({ _id: productA._id });
        if (productB) await StationeryProduct.deleteOne({ _id: productB._id });
        await Cart.deleteOne({ user: mockUserId });
        await mongoose.connection.close();
        console.log('MongoDB connection closed.');
    }
};

runTests();

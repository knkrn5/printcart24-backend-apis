import mongoose from 'mongoose';
import chalk from 'chalk';
import { dbConnection } from '#configs/db';
import Cart from '#models/cart';
import PrintDocument from '#models/printDocument';
import PrintService from '#models/printService';
import PrintOrder from '#models/printOrder';
import { buildCartResponse } from '#controllers/cart';
import { getOrderById } from '#controllers/orders';

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

const runTest = async () => {
    try {
        await dbConnection();
        console.log(chalk.bold.cyan('\nStarting Thesis Binding field omission verification test...'));

        const mockUserId = new mongoose.Types.ObjectId();
        
        const thesisService = await PrintService.findOne({ slug: 'thesis-golden-bindings' }).lean();
        const nonThesisService = await PrintService.findOne({ slug: 'document-printing' }).lean();

        if (!thesisService || !nonThesisService) {
            fail('Services missing, seed first.');
            process.exit(1);
        }

        // Test Cart formatting
        const cart = await Cart.create({
            user: mockUserId,
            status: 'ACTIVE',
            items: [
                {
                    service: thesisService._id,
                    serviceSnapshot: { name: thesisService.name, slug: thesisService.slug, serviceType: thesisService.serviceType },
                    document: await PrintDocument.create({ user: mockUserId, service: thesisService._id, originalFileName: 'thesis.pdf', fileUrl: 'http://test/1.pdf', mimeType: 'application/pdf', pageCount: 10, customization: { copies: 1, paperSize: 'A4', colorMode: 'BW', sideMode: 'SINGLE' } })
                },
                {
                    service: nonThesisService._id,
                    serviceSnapshot: { name: nonThesisService.name, slug: nonThesisService.slug, serviceType: nonThesisService.serviceType },
                    document: await PrintDocument.create({ user: mockUserId, service: nonThesisService._id, originalFileName: 'doc.pdf', fileUrl: 'http://test/2.pdf', mimeType: 'application/pdf', pageCount: 10, customization: { copies: 1, paperSize: 'A4', colorMode: 'BW', sideMode: 'SINGLE', paperQuality: '70_GSM' } })
                }
            ]
        });

        const populatedCart = await Cart.findOne({ user: mockUserId, status: 'ACTIVE' })
            .populate('items.service', '_id')
            .populate('items.document');

        const cartResp = await buildCartResponse(populatedCart);
        
        const thesisCartItem = cartResp.items.find(i => i.document?.customization?.slug === 'thesis-golden-bindings');
        const nonThesisCartItem = cartResp.items.find(i => i.document?.customization?.slug === 'document-printing');

        if (thesisCartItem && thesisCartItem.document?.customization?.paperSize === undefined && thesisCartItem.document?.customization?.colorMode === undefined) {
            pass('Cart: Fields correctly omitted for Thesis Binding');
        } else {
            fail(`Cart: Fields NOT omitted for Thesis Binding. Fields: ${JSON.stringify(thesisCartItem?.document?.customization)}`);
        }

        if (nonThesisCartItem && nonThesisCartItem.document?.customization?.paperSize === 'A4') {
            pass('Cart: Fields correctly retained for Non-Thesis Binding');
        } else {
            fail('Cart: Fields incorrectly omitted for Non-Thesis Binding');
        }

        // Test Order formatting
        const order = await PrintOrder.create({
            orderNumber: 'TESTORDER02',
            user: mockUserId,
            items: [
                {
                    service: thesisService._id,
                    serviceSnapshot: { name: thesisService.name, slug: thesisService.slug, serviceType: thesisService.serviceType },
                    document: { document: new mongoose.Types.ObjectId(), originalFileName: 'thesis.pdf' },
                    customization: { copies: 1, paperSize: 'A4', colorMode: 'BW', sideMode: 'SINGLE', paperQuality: '70_GSM' },
                },
                {
                    service: nonThesisService._id,
                    serviceSnapshot: { name: nonThesisService.name, slug: nonThesisService.slug, serviceType: nonThesisService.serviceType },
                    document: { document: new mongoose.Types.ObjectId(), originalFileName: 'doc.pdf' },
                    customization: { copies: 1, paperSize: 'A4', colorMode: 'BW', sideMode: 'SINGLE', paperQuality: '70_GSM' },
                }
            ]
        });

        const req = { params: { orderId: order._id.toString() }, user: { id: mockUserId.toString() } };
        const res = mockRes();
        await getOrderById(req, res);

        const orderData = res.body?.data;
        const thesisOrderItem = orderData?.items?.find(i => i.serviceName === thesisService.name);
        const nonThesisOrderItem = orderData?.items?.find(i => i.serviceName === nonThesisService.name);

        if (thesisOrderItem && thesisOrderItem.paperSize === undefined && thesisOrderItem.colorMode === undefined) {
            pass('Order: Fields correctly omitted for Thesis Binding');
        } else {
            fail(`Order: Fields NOT omitted for Thesis Binding. Fields: ${JSON.stringify(thesisOrderItem)}`);
        }

        if (nonThesisOrderItem && nonThesisOrderItem.paperSize === 'A4') {
            pass('Order: Fields correctly retained for Non-Thesis Binding');
        } else {
            fail('Order: Fields incorrectly omitted for Non-Thesis Binding');
        }

        // Cleanup
        await PrintDocument.deleteMany({ user: mockUserId });
        await Cart.deleteMany({ user: mockUserId });
        await PrintOrder.deleteMany({ user: mockUserId });
        mongoose.connection.close();
        
        console.log(chalk.bold.cyan('\nAPI Test Completed:'));
        console.log(chalk.green(`  Passed: ${passed}`));
        console.log(chalk.red(`  Failed: ${failed}`));
        process.exit(failed > 0 ? 1 : 0);
    } catch (err) {
        console.error(chalk.red('💥 Test crashed:'), err);
        try { mongoose.connection.close(); } catch {}
        process.exit(1);
    }
};

runTest();

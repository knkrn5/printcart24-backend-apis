// scripts/verifyTableWidth.script.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { PDFDocument } from 'pdf-lib';
import env from '../configs/env.config.js';
import PrintOrder from '../models/printOrder.model.js';
import User from '../models/user.model.js';
import {
    renderClientInvoiceHtml,
    generateClientInvoicePdf,
} from '../utils/clientInvoiceGenerator.util.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ultraShortOrder = {
    orderNumber: 'PC24-SHORT-TEST',
    createdAt: new Date('2026-08-20T00:00:00Z'),
    orderStatus: 'PROCESSED',
    paymentStatus: 'PAID',
    paymentMethod: 'UPI',
    razorpayPaymentId: 'pay_123',
    deliveryAddress: {
        firstName: 'A',
        lastName: 'B',
        phone: '9999999999',
        fullAddress: 'X',
        city: 'Delhi',
        state: 'Delhi',
        pincode: '110001',
    },
    items: [
        {
            serviceSnapshot: { name: 'Print' },
            document: { originalFileName: 'Doc' },
            customization: { copies: 1, paperSize: 'A4', colorMode: 'BW', sideMode: 'SINGLE' },
            priceSummary: { baseAmount: 10, addOnAmount: 0, taxAmount: 1.8, totalAmount: 11.8 },
        },
    ],
    priceSummary: {
        itemTotal: 10,
        addOnTotal: 0,
        deliveryFee: 0,
        platformFee: 0,
        discountAmount: 0,
        taxAmount: 1.8,
        grandTotal: 11.8,
    },
};

async function main() {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(env.DB_URL);

    const orderId = '6a86dbbf2348ae0d3cfe13b8';
    const realOrder = await PrintOrder.findOne({ _id: orderId })
        .populate('user', 'email')
        .lean();

    const invoicesDir = path.resolve(__dirname, '../public/invoices');

    // 1. Generate Ultra Short Item PDF
    const shortPdfPath = path.join(invoicesDir, 'invoice-ultra-short-test.pdf');
    await generateClientInvoicePdf(ultraShortOrder, shortPdfPath);

    // 2. Generate Real Order PDF
    const realPdfPath = path.join(invoicesDir, 'invoice-real-order-test.pdf');
    await generateClientInvoicePdf(realOrder, realPdfPath, { customerEmail: realOrder.user?.email || '-' });

    console.log('Generated ultra-short order PDF:', shortPdfPath);
    console.log('Generated real order PDF:', realPdfPath);

    const shortBytes = fs.readFileSync(shortPdfPath);
    const realBytes = fs.readFileSync(realPdfPath);

    const shortDoc = await PDFDocument.load(shortBytes);
    const realDoc = await PDFDocument.load(realBytes);

    console.log('Ultra Short Order PDF Page Count:', shortDoc.getPageCount(), '| Page 1 width:', shortDoc.getPage(0).getWidth());
    console.log('Real Order PDF Page Count:', realDoc.getPageCount(), '| Page 1 width:', realDoc.getPage(0).getWidth());

    await mongoose.disconnect();
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});

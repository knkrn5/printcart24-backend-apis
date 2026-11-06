// scripts/investigateInvoiceDiff.script.js
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { PDFDocument } from 'pdf-lib';
import env from '../configs/env.config.js';
import PrintOrder from '../models/printOrder.model.js';
import User from '../models/user.model.js';
import {
    buildClientInvoiceViewModel,
    renderClientInvoiceHtml,
    generateClientInvoicePdf,
} from '../utils/clientInvoiceGenerator.util.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getHash(data) {
    return crypto.createHash('sha256').update(data).digest('hex');
}

async function getPdfMeta(filePath) {
    const bytes = fs.readFileSync(filePath);
    const pdfDoc = await PDFDocument.load(bytes);
    const pageCount = pdfDoc.getPageCount();
    const pages = [];
    for (let i = 0; i < pageCount; i++) {
        const page = pdfDoc.getPage(i);
        pages.push({
            pageNumber: i + 1,
            width: Math.round(page.getWidth() * 100) / 100,
            height: Math.round(page.getHeight() * 100) / 100,
            rotation: page.getRotation().angle,
        });
    }
    return {
        fileSize: bytes.length,
        hash: getHash(bytes),
        pageCount,
        pages,
    };
}

async function main() {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(env.DB_URL);
    console.log('Connected to MongoDB.\n');

    const orderId = '6a86dbbf2348ae0d3cfe13b8';
    console.log(`[1] Fetching Real Order ${orderId} using production controller query...`);
    const realOrder = await PrintOrder.findOne({ _id: orderId })
        .populate('user', 'email')
        .lean();

    if (!realOrder) {
        console.error(`Order ${orderId} not found in DB!`);
        process.exit(1);
    }

    console.log('--- Real Order Data Summary ---');
    console.log('Order ID:', realOrder._id.toString());
    console.log('Order Number:', realOrder.orderNumber);
    console.log('User Email:', realOrder.user?.email || 'N/A');
    console.log('Order Status:', realOrder.orderStatus);
    console.log('Payment Status:', realOrder.paymentStatus);
    console.log('Print Items Count:', realOrder.items?.length || 0);
    console.log('Stationery Items Count:', realOrder.stationeryItems?.length || 0);

    let totalAddOnsCount = 0;
    if (Array.isArray(realOrder.items)) {
        for (const item of realOrder.items) {
            if (item.customization?.selectedBinding?.label) totalAddOnsCount++;
            if (Array.isArray(item.customization?.selectedAddOns)) {
                totalAddOnsCount += item.customization.selectedAddOns.length;
            }
        }
    }
    console.log('Total Add-ons Count:', totalAddOnsCount);
    console.log('Pricing Summary:', JSON.stringify(realOrder.priceSummary, null, 2));

    const invoicesDir = path.resolve(__dirname, '../public/invoices');
    if (!fs.existsSync(invoicesDir)) {
        fs.mkdirSync(invoicesDir, { recursive: true });
    }

    const testPdfPath = path.join(invoicesDir, 'invoice-real-order-test.pdf');
    const apiPdfPath = path.join(invoicesDir, 'invoice-real-order-api.pdf');
    const testHtmlPath = path.join(invoicesDir, 'invoice-real-order-test.html');
    const apiHtmlPath = path.join(invoicesDir, 'invoice-real-order-api.html');

    // Options passed in production API controller (downloadInvoice):
    // { customerEmail: order.user?.email || '-' }
    const apiOptions = {
        customerEmail: realOrder.user?.email || '-',
    };

    // 1. Generate via Script Test Flow (using Real Order Data)
    console.log('\n[2] Rendering HTML and generating PDF via Script Flow for Real Order...');
    const testHtml = renderClientInvoiceHtml(realOrder, apiOptions);
    fs.writeFileSync(testHtmlPath, testHtml, 'utf8');
    await generateClientInvoicePdf(realOrder, testPdfPath, apiOptions);
    console.log(`Saved Script PDF: ${testPdfPath}`);

    // 2. Generate via Production Controller Flow (simulated exact call)
    console.log('\n[3] Rendering HTML and generating PDF via Production API Controller Flow...');
    const apiHtml = renderClientInvoiceHtml(realOrder, apiOptions);
    fs.writeFileSync(apiHtmlPath, apiHtml, 'utf8');
    await generateClientInvoicePdf(realOrder, apiPdfPath, apiOptions);
    console.log(`Saved API PDF: ${apiPdfPath}`);

    // 3. Comparison
    console.log('\n[4] Comparing Script PDF vs API PDF...');
    const testHtmlHash = getHash(fs.readFileSync(testHtmlPath));
    const apiHtmlHash = getHash(fs.readFileSync(apiHtmlPath));

    const testMeta = await getPdfMeta(testPdfPath);
    const apiMeta = await getPdfMeta(apiPdfPath);

    console.log('\n--- HTML Comparison ---');
    console.log('Test HTML Hash:', testHtmlHash);
    console.log('API HTML Hash: ', apiHtmlHash);
    console.log('HTML Identical?:', testHtmlHash === apiHtmlHash);

    console.log('\n--- PDF Metadata & Hash Comparison ---');
    console.log('Test PDF Size: ', testMeta.fileSize, 'bytes');
    console.log('API PDF Size:  ', apiMeta.fileSize, 'bytes');
    console.log('Test PDF Hash: ', testMeta.hash);
    console.log('API PDF Hash:  ', apiMeta.hash);
    console.log('PDF Byte Match?:', testMeta.hash === apiMeta.hash);
    console.log('Page Count Test:', testMeta.pageCount, '| API:', apiMeta.pageCount);
    console.log('Page Dimensions Test:', JSON.stringify(testMeta.pages), '| API:', JSON.stringify(apiMeta.pages));

    await mongoose.disconnect();
}

main().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});

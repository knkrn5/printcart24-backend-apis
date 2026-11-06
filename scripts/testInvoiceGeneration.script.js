// scripts/testInvoiceGeneration.script.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateInvoicePdf } from '#utils/invoiceGenerator';
import {
    buildClientInvoiceViewModel,
    renderClientInvoiceHtml,
    generateClientInvoicePdf,
} from '../utils/clientInvoiceGenerator.util.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Base Mock Order Object matching models/printOrder.model.js structure
const baseMockOrder = {
    orderNumber: 'PC24-20260701-9988',
    createdAt: new Date('2026-07-01T02:00:00Z'),
    orderStatus: 'PROCESSED',
    paymentStatus: 'PAID',
    paymentMethod: 'UPI',
    razorpayPaymentId: 'pay_P1r2i3n4t5C6a7r8t9',
    deliveryAddress: {
        firstName: 'Rajesh',
        lastName: 'Kumar',
        phone: '9876543210',
        fullAddress: 'A-43, Apartment 102, Block C, Green Park Residency',
        city: 'New Delhi',
        state: 'Delhi',
        pincode: '110016',
    },
    items: [
        {
            serviceSnapshot: {
                name: 'Standard Document Printing',
            },
            document: {
                originalFileName: 'college_project_report_final.pdf',
            },
            customization: {
                copies: 3,
                paperSize: 'A4',
                colorMode: 'COLOR',
                sideMode: 'DOUBLE',
                paperQuality: '80_GSM',
                selectedBinding: {
                    label: 'Spiral Wire-O Binding',
                    totalAmount: 120.00,
                },
                selectedAddOns: [
                    {
                        label: 'Plastic Cover Sheet',
                        totalAmount: 30.00,
                    },
                    {
                        label: 'Corner Stapling',
                        totalAmount: 15.00,
                    },
                ],
            },
            priceSummary: {
                baseAmount: 180.00, // 60 per copy
                addOnAmount: 45.00, // binding + addons
                taxAmount: 40.50, // 18% GST
                totalAmount: 265.50,
            },
        },
        {
            serviceSnapshot: {
                name: 'Thesis Printing & Binding',
            },
            document: {
                originalFileName: 'doctoral_dissertation.pdf',
            },
            customization: {
                copies: 1,
                paperSize: 'A4',
                colorMode: 'BW',
                sideMode: 'SINGLE',
                paperQuality: '100_GSM',
                selectedBinding: {
                    label: 'Hardcover Gold Embossed Binding',
                    totalAmount: 450.00,
                },
            },
            priceSummary: {
                baseAmount: 150.00,
                addOnAmount: 450.00,
                taxAmount: 108.00,
                totalAmount: 708.00,
            },
        },
    ],
    stationeryItems: [
        {
            itemSnapshot: {
                name: 'Gel Pen - Blue (Pack of 5)',
                brand: 'Reynolds Racer Gel',
            },
            quantity: 2,
            priceSummary: {
                unitPrice: 50.00,
                taxableAmount: 100.00,
                taxAmount: 18.00,
                totalAmount: 118.00,
            },
        },
        {
            itemSnapshot: {
                name: 'Hardbound Register - A4 Size',
                brand: 'Classmate',
            },
            quantity: 1,
            priceSummary: {
                unitPrice: 120.00,
                taxableAmount: 120.00,
                taxAmount: 21.60,
                totalAmount: 141.60,
            },
        },
    ],
    priceSummary: {
        itemTotal: 600.00, // baseAmount items + stationery unitPrices
        addOnTotal: 615.00, // sum of add-ons & bindings
        deliveryFee: 40.00,
        platformFee: 10.00,
        discountAmount: 50.00, // Coupon discount
        taxAmount: 188.10, // Sum of taxes
        grandTotal: 1403.10,
    },
};

async function runAllTests() {
    const invoicesDir = path.resolve(__dirname, '../public/invoices');
    if (!fs.existsSync(invoicesDir)) {
        fs.mkdirSync(invoicesDir, { recursive: true });
    }

    console.log('====================================================');
    console.log('PRINTCART24 INVOICE TEST SUITE (FINALIZED CLIENT FORMAT)');
    console.log('====================================================\n');

    // ─── 1. LEGACY PDFKit INVOICE TEST ──────────────────────────────────────────
    console.log('▶ [1/3] Testing Legacy PDFKit Invoice Generator...');
    const legacyOutputPath = path.join(invoicesDir, 'invoice-legacy-pdfkit.pdf');
    const legacySamplePath = path.join(invoicesDir, 'sample-invoice.pdf');

    const writeStream = fs.createWriteStream(legacyOutputPath);
    await generateInvoicePdf(baseMockOrder, writeStream);

    const sampleStream = fs.createWriteStream(legacySamplePath);
    await generateInvoicePdf(baseMockOrder, sampleStream);

    console.log(`  ✓ Legacy PDFKit invoice generated at:\n    ${legacyOutputPath}`);

    // ─── 2. CLIENT EJS INVOICE GENERATOR TEST (LibreOffice Architecture) ───────
    console.log('\n▶ [2/3] Testing Client EJS Invoice via Existing LibreOffice Architecture...');
    const clientPdfPath = path.join(invoicesDir, 'invoice-client-ejs.pdf');
    const clientHtmlPath = path.join(invoicesDir, 'invoice-client-ejs.html');

    const html = renderClientInvoiceHtml(baseMockOrder);
    fs.writeFileSync(clientHtmlPath, html, 'utf8');
    await generateClientInvoicePdf(baseMockOrder, clientPdfPath);

    console.log(`  ✓ Client EJS invoice HTML generated at:\n    ${clientHtmlPath}`);
    console.log(`  ✓ Client EJS invoice PDF generated via LibreOffice at:\n    ${clientPdfPath}`);

    // ─── 3. MULTI-SCENARIO & CUSTOMER EMAIL VERIFICATION ────────────────────────
    console.log('\n▶ [3/3] Running Comprehensive Verification Scenarios (12 Scenarios)...');

    const scenarios = [
        {
            id: 'scenario-01-print-only',
            name: '1. Print-only order',
            order: {
                ...baseMockOrder,
                orderNumber: 'PC24-SCENARIO-01',
                stationeryItems: [],
                priceSummary: {
                    itemTotal: 330.00,
                    addOnTotal: 615.00,
                    deliveryFee: 40.00,
                    platformFee: 10.00,
                    discountAmount: 0,
                    taxAmount: 170.10,
                    grandTotal: 1165.10,
                },
            },
        },
        {
            id: 'scenario-02-stationery-only',
            name: '2. Stationery-only order',
            order: {
                ...baseMockOrder,
                orderNumber: 'PC24-SCENARIO-02',
                items: [],
                priceSummary: {
                    itemTotal: 220.00,
                    addOnTotal: 0,
                    deliveryFee: 30.00,
                    platformFee: 5.00,
                    discountAmount: 0,
                    taxAmount: 39.60,
                    grandTotal: 294.60,
                },
            },
        },
        {
            id: 'scenario-03-mixed',
            name: '3. Mixed print + stationery order',
            order: { ...baseMockOrder, orderNumber: 'PC24-SCENARIO-03' },
        },
        {
            id: 'scenario-04-single-binding',
            name: '4. Print order with single binding',
            order: {
                ...baseMockOrder,
                orderNumber: 'PC24-SCENARIO-04',
                items: [baseMockOrder.items[0]],
                stationeryItems: [],
            },
        },
        {
            id: 'scenario-05-multiple-addons',
            name: '5. Print order with multiple add-ons',
            order: {
                ...baseMockOrder,
                orderNumber: 'PC24-SCENARIO-05',
                items: [baseMockOrder.items[0]],
                stationeryItems: [],
            },
        },
        {
            id: 'scenario-06-multi-print-items',
            name: '6. Multiple print items (3 document jobs)',
            order: {
                ...baseMockOrder,
                orderNumber: 'PC24-SCENARIO-06',
                items: [
                    ...baseMockOrder.items,
                    {
                        serviceSnapshot: { name: 'Poster Printing' },
                        document: { originalFileName: 'event_poster_a2.pdf' },
                        customization: { copies: 5, paperSize: 'A2', colorMode: 'COLOR', sideMode: 'SINGLE', paperQuality: '220_GSM' },
                        priceSummary: { baseAmount: 500.00, addOnAmount: 0, taxAmount: 90.00, totalAmount: 590.00 },
                    },
                ],
            },
        },
        {
            id: 'scenario-07-multi-stationery-items',
            name: '7. Multiple stationery items (4 items)',
            order: {
                ...baseMockOrder,
                orderNumber: 'PC24-SCENARIO-07',
                stationeryItems: [
                    ...baseMockOrder.stationeryItems,
                    { itemSnapshot: { name: 'Highlighter Pack', brand: 'Faber-Castell' }, quantity: 1, priceSummary: { unitPrice: 80.00, taxAmount: 14.40, totalAmount: 94.40 } },
                    { itemSnapshot: { name: 'Sticky Notes 3x3', brand: '3M Post-It' }, quantity: 3, priceSummary: { unitPrice: 45.00, taxAmount: 24.30, totalAmount: 159.30 } },
                ],
            },
        },
        {
            id: 'scenario-08-coupon-discount',
            name: '8. Order with coupon discount (FLAT ₹100 off)',
            order: {
                ...baseMockOrder,
                orderNumber: 'PC24-SCENARIO-08',
                priceSummary: { ...baseMockOrder.priceSummary, discountAmount: 100.00, grandTotal: 1353.10 },
            },
        },
        {
            id: 'scenario-09-custom-delivery-fee',
            name: '9. Order with custom delivery fee (₹60.00)',
            order: {
                ...baseMockOrder,
                orderNumber: 'PC24-SCENARIO-09',
                priceSummary: { ...baseMockOrder.priceSummary, deliveryFee: 60.00, grandTotal: 1423.10 },
            },
        },
        {
            id: 'scenario-10-platform-fee',
            name: '10. Order with platform fee (₹15.00)',
            order: {
                ...baseMockOrder,
                orderNumber: 'PC24-SCENARIO-10',
                priceSummary: { ...baseMockOrder.priceSummary, platformFee: 15.00, grandTotal: 1408.10 },
            },
        },
        {
            id: 'scenario-11-tax-breakdown',
            name: '11. Order with 18% GST tax breakdown',
            order: { ...baseMockOrder, orderNumber: 'PC24-SCENARIO-11' },
        },
        {
            id: 'scenario-12-multi-page',
            name: '12. Multi-page invoice (8 items with long descriptions)',
            order: {
                ...baseMockOrder,
                orderNumber: 'PC24-SCENARIO-12',
                items: Array(6).fill(baseMockOrder.items[0]),
                stationeryItems: Array(2).fill(baseMockOrder.stationeryItems[0]),
            },
        },
    ];

    for (const scenario of scenarios) {
        const scenarioPdfPath = path.join(invoicesDir, `${scenario.id}.pdf`);
        await generateClientInvoicePdf(scenario.order, scenarioPdfPath);

        const scenarioHtml = renderClientInvoiceHtml(scenario.order);
        if (scenarioHtml.includes('undefined')) {
            throw new Error(`Anomaly detected in ${scenario.name}: output contains "undefined"`);
        }
        if (scenarioHtml.includes('[object Object]')) {
            throw new Error(`Anomaly detected in ${scenario.name}: output contains "[object Object]"`);
        }

        console.log(`  ✓ Scenario Passed: ${scenario.name}`);
    }

    // Verify Customer Email Fallback: With Email vs Without Email
    const withEmailHtml = renderClientInvoiceHtml(baseMockOrder, { customerEmail: 'rajesh.kumar@example.com' });
    if (!withEmailHtml.includes('rajesh.kumar@example.com')) {
        throw new Error('Customer email was not rendered when provided');
    }

    const withoutEmailHtml = renderClientInvoiceHtml(baseMockOrder);
    if (!withoutEmailHtml.includes('Email: -')) {
        throw new Error('Customer email fallback "-" was not rendered when email missing');
    }
    console.log('  ✓ Customer Email Fallback verified: renders actual email when present, "-" when missing.');

    console.log('\n====================================================');
    console.log('ALL INVOICE TESTS COMPLETED SUCCESSFULLY');
    console.log('====================================================\n');
}

runAllTests().catch((err) => {
    console.error('Test execution failed:', err);
    process.exit(1);
});

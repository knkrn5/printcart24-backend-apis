// scripts/verifyDocumentPricing.script.js
import mongoose from 'mongoose';
import { dbConnection } from '#configs/db';
import PrintService from '#models/printService';
import { resolvePrintPricing } from '#services/printPricing';

(async () => {
    try {
        await dbConnection();

        // 1. Fetch Document Printing Service
        const docService = await PrintService.findOne({ slug: 'document-printing', isActive: true }).lean();
        if (!docService) {
            console.error('Document printing service not found!');
            process.exit(1);
        }

        console.log('\n--- VERIFYING DOCUMENT PRINTING PRICING (10 Pages, 1 Copy) ---');

        const testCases = [
            { label: 'A4 B/W Single Sided', size: 'A4', color: 'BW', side: 'SINGLE', expectedSingleDoc: 20 },
            { label: 'A4 Color Single Sided', size: 'A4', color: 'COLOR', side: 'SINGLE', expectedSingleDoc: 80 },
            { label: 'A3 B/W Single Sided', size: 'A3', color: 'BW', side: 'SINGLE', expectedSingleDoc: 60 },
            { label: 'A3 Color Single Sided', size: 'A3', color: 'COLOR', side: 'SINGLE', expectedSingleDoc: 200 },
            { label: 'A4 B/W Double Sided', size: 'A4', color: 'BW', side: 'DOUBLE', expectedSingleDoc: 20 },
            { label: 'A3 Color Double Sided', size: 'A3', color: 'COLOR', side: 'DOUBLE', expectedSingleDoc: 200 },
        ];

        for (const tc of testCases) {
            const pricingResult = await resolvePrintPricing({
                service: docService,
                customization: {
                    paperSize: tc.size,
                    colorMode: tc.color,
                    sideMode: tc.side,
                    copies: 1
                },
                totalPages: 10,
                documentCount: 1,
            });

            const total = pricingResult.priceSummary.totalAmount;
            const status = total === tc.expectedSingleDoc ? '✅ PASS' : `❌ FAIL (Got: ₹${total}, Expected: ₹${tc.expectedSingleDoc})`;
            console.log(`${tc.label}: Got ₹${total} | ${status}`);
        }

        // 2. Fetch Thesis Binding to ensure it is unchanged
        const thesisService = await PrintService.findOne({ slug: 'thesis-golden-bindings', isActive: true }).lean();
        if (thesisService) {
            console.log('\n--- VERIFYING THESIS BINDING (100 Pages, 1 Copy, A4 Color, Hardbound) ---');
            const pricingResult = await resolvePrintPricing({
                service: thesisService,
                customization: {
                    paperSize: 'A4',
                    colorMode: 'COLOR',
                    sideMode: 'SINGLE',
                    copies: 1,
                    selectedBindingCode: 'GOLD_FOIL_NAVY'
                },
                totalPages: 100,
                documentCount: 1,
            });
            console.log(`Base Price (PER_ITEM): ₹${pricingResult.priceSummary.baseAmount} (Expected: ₹600)`);
            console.log(`Color Addon (100 pages * ₹5): ₹${pricingResult.selectedAddOns.find(a => a.group === 'COLOR_MODE')?.totalAmount} (Expected: ₹500)`);
            console.log(`Binding Option (Hardbound): ₹${pricingResult.selectedBinding?.totalAmount} (Expected: ₹200)`);
            console.log(`Total thesis price: ₹${pricingResult.priceSummary.totalAmount} (Expected: ₹1300)`);
        }
        // 3. Fetch Certificate Service
        const certService = await PrintService.findOne({ slug: 'certificate', isActive: true }).lean();
        if (certService) {
            console.log('\n--- VERIFYING CERTIFICATE PRICING ---');

            // Test 1: 50 pages (up to 100 pages slab: ₹15/page)
            const pricingResult50 = await resolvePrintPricing({
                service: certService,
                customization: {
                    paperSize: 'A4',
                    colorMode: 'COLOR',
                    sideMode: 'SINGLE',
                    copies: 1
                },
                totalPages: 50,
                documentCount: 1,
            });
            const total50 = pricingResult50.priceSummary.totalAmount;
            const status50 = total50 === 750 ? '✅ PASS' : `❌ FAIL (Got: ₹${total50}, Expected: ₹750)`;
            console.log(`Certificate 50 pages: Got ₹${total50} | ${status50}`);

            // Test 2: 150 pages (100+ pages slab: ₹12/page)
            const pricingResult150 = await resolvePrintPricing({
                service: certService,
                customization: {
                    paperSize: 'A4',
                    colorMode: 'COLOR',
                    sideMode: 'SINGLE',
                    copies: 1
                },
                totalPages: 150,
                documentCount: 1,
            });
            const total150 = pricingResult150.priceSummary.totalAmount;
            const status150 = total150 === 1800 ? '✅ PASS' : `❌ FAIL (Got: ₹${total150}, Expected: ₹1800)`;
            console.log(`Certificate 150 pages: Got ₹${total150} | ${status150}`);
        }
        // 4. Fetch Poster Printing Service
        const posterService = await PrintService.findOne({ slug: 'poster-printing', isActive: true }).lean();
        if (posterService) {
            console.log('\n--- VERIFYING POSTER PRINTING PRICING ---');

            const posterCases = [
                // Single page cases
                { size: 'A2', color: 'COLOR', pages: 1, expected: 250 },
                { size: 'A1', color: 'COLOR', pages: 1, expected: 500 },
                { size: 'A0', color: 'COLOR', pages: 1, expected: 900 },
                { size: 'A2', color: 'BW', pages: 1, expected: 60 },
                { size: 'A1', color: 'BW', pages: 1, expected: 75 },
                { size: 'A0', color: 'BW', pages: 1, expected: 100 },
                // Multi page cases
                { size: 'A2', color: 'COLOR', pages: 8, expected: 2000 },
                { size: 'A1', color: 'COLOR', pages: 8, expected: 4000 },
                { size: 'A0', color: 'COLOR', pages: 8, expected: 7200 },
                { size: 'A2', color: 'BW', pages: 8, expected: 480 },
                { size: 'A1', color: 'BW', pages: 8, expected: 600 },
                { size: 'A0', color: 'BW', pages: 8, expected: 800 },
                { size: 'A2', color: 'COLOR', pages: 12, expected: 3000 },
            ];

            for (const tc of posterCases) {
                const pricingResult = await resolvePrintPricing({
                    service: posterService,
                    customization: {
                        paperSize: tc.size,
                        colorMode: tc.color,
                        sideMode: 'SINGLE',
                        copies: 1
                    },
                    totalPages: tc.pages,
                    documentCount: 1,
                });
                const total = pricingResult.priceSummary.totalAmount;
                const status = total === tc.expected ? '✅ PASS' : `❌ FAIL (Got: ₹${total}, Expected: ₹${tc.expected})`;
                console.log(`Poster ${tc.size} ${tc.color} (${tc.pages} pages): Got ₹${total} | ${status}`);
            }
        }

        process.exit(0);
    } catch (err) {
        console.error('Error during verification:', err);
        process.exit(1);
    } finally {
        await mongoose.connection.close();
    }
})();

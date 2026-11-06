import mongoose from 'mongoose';
import chalk from 'chalk';
import { dbConnection } from '#configs/db';
import PrintService from '#models/printService';
import { buildPrintServiceDetailResponse, resolvePrintPricing } from '#services/printPricing';

const divider = (char = '─', len = 60) => chalk.gray(char.repeat(len));

(async () => {
    try {
        console.log('\n' + divider('═'));
        console.log(chalk.bold.cyan('  PAPER QUALITY PRICING & OPTIONS VERIFICATION'));
        console.log(divider('═') + '\n');

        await dbConnection();

        // 1. Fetch the print services
        const docService = await PrintService.findOne({ slug: 'document-printing', isActive: true }).lean();
        const posterService = await PrintService.findOne({ slug: 'poster-printing', isActive: true }).lean();
        const thesisService = await PrintService.findOne({ slug: 'thesis-printing', isActive: true }).lean();

        if (!docService || !posterService || !thesisService) {
            throw new Error('Required services not found in database. Make sure seed script was run.');
        }

        console.log(chalk.green('✔ Required services fetched successfully from database.\n'));

        // ----------------------------------------------------
        // Test Case 1: Response Structure & Keys
        // ----------------------------------------------------
        console.log(chalk.yellow('--- Test Case 1: Response Structure for print customizations ---'));
        
        const docDetail = await buildPrintServiceDetailResponse(docService);
        const posterDetail = await buildPrintServiceDetailResponse(posterService);
        const thesisDetail = await buildPrintServiceDetailResponse(thesisService);

        console.log(chalk.bold('\nDocument Printing "paperQualities" structure:'));
        console.log(JSON.stringify(docDetail.customizationConfig.paperQualities, null, 2));

        console.log(chalk.bold('\nPoster Printing "paperQualities" structure:'));
        console.log(JSON.stringify(posterDetail.customizationConfig.paperQualities, null, 2));

        console.log(chalk.bold('\nThesis Printing "paperQualities" structure:'));
        console.log(JSON.stringify(thesisDetail.customizationConfig.paperQualities, null, 2));

        // ----------------------------------------------------
        // Test Case 2: Document Printing Pricing Calculations
        // ----------------------------------------------------
        console.log(chalk.yellow('\n--- Test Case 2: Document Printing Pricing ---'));
        const docTestCases = [
            // Standard (70-75 GSM)
            { size: 'A4', color: 'BW', quality: 'STANDARD_70_75_GSM', pages: 10, expected: 15, desc: 'A4 BW Standard (₹1.5/pg)' },
            { size: 'A4', color: 'COLOR', quality: 'STANDARD_70_75_GSM', pages: 10, expected: 80, desc: 'A4 Color Standard (₹8/pg)' },
            { size: 'A3', color: 'BW', quality: 'STANDARD_70_75_GSM', pages: 10, expected: 60, desc: 'A3 BW Standard (₹6/pg)' },
            { size: 'A3', color: 'COLOR', quality: 'STANDARD_70_75_GSM', pages: 10, expected: 200, desc: 'A3 Color Standard (₹20/pg)' },
            // Special (100 GSM)
            { size: 'A4', color: 'BW', quality: 'SPECIAL_100_GSM', pages: 10, expected: 30, desc: 'A4 BW Special (₹3/pg)' },
            { size: 'A4', color: 'COLOR', quality: 'SPECIAL_100_GSM', pages: 10, expected: 160, desc: 'A4 Color Special (₹16/pg)' },
            { size: 'A3', color: 'BW', quality: 'SPECIAL_100_GSM', pages: 10, expected: 80, desc: 'A3 BW Special (₹8/pg)' },
            { size: 'A3', color: 'COLOR', quality: 'SPECIAL_100_GSM', pages: 10, expected: 200, desc: 'A3 Color Special (₹20/pg)' },
        ];

        for (const tc of docTestCases) {
            const result = await resolvePrintPricing({
                service: docService,
                customization: {
                    paperSize: tc.size,
                    colorMode: tc.color,
                    paperQuality: tc.quality,
                    copies: 1,
                    orientation: 'PORTRAIT',
                    sideMode: 'SINGLE',
                },
                totalPages: tc.pages,
                documentCount: 1,
            });
            const price = result.priceSummary.totalAmount;
            if (price === tc.expected) {
                console.log(chalk.green(`✔ Pass: ${tc.desc} => ₹${price}`));
            } else {
                console.log(chalk.red(`❌ Fail: ${tc.desc} => Expected ₹${tc.expected}, got ₹${price}`));
                throw new Error('Document pricing validation failed');
            }
        }

        // ----------------------------------------------------
        // Test Case 3: Poster Printing Pricing & Validation
        // ----------------------------------------------------
        console.log(chalk.yellow('\n--- Test Case 3: Poster Printing Pricing & Validation ---'));
        const posterTestCases = [
            // Standard Poster Sheet (BW only)
            { size: 'A2', color: 'BW', quality: 'POSTER_STANDARD', expected: 60, desc: 'A2 BW Normal Sheet (₹60)' },
            { size: 'A1', color: 'BW', quality: 'POSTER_STANDARD', expected: 75, desc: 'A1 BW Normal Sheet (₹75)' },
            { size: 'A0', color: 'BW', quality: 'POSTER_STANDARD', expected: 100, desc: 'A0 BW Normal Sheet (₹100)' },
            // Glossy (Color only)
            { size: 'A2', color: 'COLOR', quality: 'GLOSSY', expected: 250, desc: 'A2 Color Glossy (₹250)' },
            { size: 'A1', color: 'COLOR', quality: 'GLOSSY', expected: 500, desc: 'A1 Color Glossy (₹500)' },
            { size: 'A0', color: 'COLOR', quality: 'GLOSSY', expected: 900, desc: 'A0 Color Glossy (₹900)' },
            // Fabric (Color only)
            { size: 'A2', color: 'COLOR', quality: 'FABRIC', expected: 400, desc: 'A2 Color Fabric (₹400)' },
            { size: 'A1', color: 'COLOR', quality: 'FABRIC', expected: 600, desc: 'A1 Color Fabric (₹600)' },
            { size: 'A0', color: 'COLOR', quality: 'FABRIC', expected: 1500, desc: 'A0 Color Fabric (₹1500)' },
        ];

        for (const tc of posterTestCases) {
            const result = await resolvePrintPricing({
                service: posterService,
                customization: {
                    paperSize: tc.size,
                    colorMode: tc.color,
                    paperQuality: tc.quality,
                    copies: 1,
                    orientation: 'PORTRAIT',
                    sideMode: 'SINGLE',
                },
                totalPages: 1,
                documentCount: 1,
            });
            const price = result.priceSummary.totalAmount;
            if (price === tc.expected) {
                console.log(chalk.green(`✔ Pass: ${tc.desc} => ₹${price}`));
            } else {
                console.log(chalk.red(`❌ Fail: ${tc.desc} => Expected ₹${tc.expected}, got ₹${price}`));
                throw new Error('Poster pricing validation failed');
            }
        }

        // Test Poster Validation Errors
        try {
            await resolvePrintPricing({
                service: posterService,
                customization: {
                    paperSize: 'A2',
                    colorMode: 'BW',
                    paperQuality: 'GLOSSY',
                },
                totalPages: 1,
                documentCount: 1,
            });
            console.log(chalk.red('❌ Fail: Expected validation error when selecting GLOSSY with BW poster, but it passed.'));
            throw new Error('Poster validation failed to catch GLOSSY + BW mismatch');
        } catch (e) {
            console.log(chalk.green(`✔ Pass: Caught expected error for GLOSSY + BW poster: "${e.message}"`));
        }

        try {
            await resolvePrintPricing({
                service: posterService,
                customization: {
                    paperSize: 'A2',
                    colorMode: 'COLOR',
                    paperQuality: 'POSTER_STANDARD',
                },
                totalPages: 1,
                documentCount: 1,
            });
            console.log(chalk.red('❌ Fail: Expected validation error when selecting Normal Sheet (POSTER_STANDARD) with Color poster, but it passed.'));
            throw new Error('Poster validation failed to catch Normal Sheet + Color mismatch');
        } catch (e) {
            console.log(chalk.green(`✔ Pass: Caught expected error for Normal Sheet + Color poster: "${e.message}"`));
        }

        // ----------------------------------------------------
        // Test Case 4: Thesis Printing Pricing (Replaced Base Price)
        // ----------------------------------------------------
        console.log(chalk.yellow('\n--- Test Case 4: Thesis Printing Pricing (Replacing Base Price) ---'));
        const thesisTestCases = [
            // Special Paper (100 GSM) or Bond Paper (100 GSM) — same pricing rules
            { color: 'BW', side: 'SINGLE', quality: 'SPECIAL_100_GSM', pages: 50, expected: 150, desc: 'Thesis BW Single (₹3/pg, total ₹150)' },
            { color: 'BW', side: 'DOUBLE', quality: 'SPECIAL_100_GSM', pages: 50, expected: 300, desc: 'Thesis BW Double (₹6/pg, total ₹300)' },
            { color: 'COLOR', side: 'SINGLE', quality: 'SPECIAL_100_GSM', pages: 50, expected: 300, desc: 'Thesis Color Single (₹6/pg, total ₹300)' },
            { color: 'COLOR', side: 'DOUBLE', quality: 'SPECIAL_100_GSM', pages: 50, expected: 600, desc: 'Thesis Color Double (₹12/pg, total ₹600)' },
            
            { color: 'BW', side: 'SINGLE', quality: 'BOND_100_GSM', pages: 50, expected: 150, desc: 'Thesis BW Single Bond (₹3/pg, total ₹150)' },
            { color: 'COLOR', side: 'DOUBLE', quality: 'BOND_100_GSM', pages: 50, expected: 600, desc: 'Thesis Color Double Bond (₹12/pg, total ₹600)' },
        ];

        for (const tc of thesisTestCases) {
            const result = await resolvePrintPricing({
                service: thesisService,
                customization: {
                    paperSize: 'A4',
                    colorMode: tc.color,
                    sideMode: tc.side,
                    paperQuality: tc.quality,
                    copies: 1,
                    orientation: 'PORTRAIT',
                },
                totalPages: tc.pages,
                documentCount: 1,
            });
            const price = result.priceSummary.totalAmount;
            if (price === tc.expected) {
                console.log(chalk.green(`✔ Pass: ${tc.desc} => ₹${price}`));
            } else {
                console.log(chalk.red(`❌ Fail: ${tc.desc} => Expected ₹${tc.expected}, got ₹${price}`));
                throw new Error('Thesis pricing validation failed');
            }
        }

        console.log(chalk.green.bold('\n🎉 ALL CUSTOM VERIFICATION TESTS PASSED SUCCESSFULLY!\n'));
        process.exit(0);
    } catch (error) {
        console.error(chalk.bgRed.white('\n❌ VERIFICATION FAILED:'), error.message);
        process.exit(1);
    } finally {
        await mongoose.connection.close();
        console.log(chalk.blue('MongoDB connection closed.'));
    }
})();

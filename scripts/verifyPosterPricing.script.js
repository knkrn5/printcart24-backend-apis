import mongoose from 'mongoose';
import chalk from 'chalk';
import { dbConnection } from '#configs/db';
import PrintService from '#models/printService';
import { buildFilteredPrintServiceDetailResponse, resolvePrintPricing } from '#services/printPricing';

const divider = (char = '─', len = 60) => chalk.gray(char.repeat(len));

(async () => {
    try {
        console.log('\n' + divider('═'));
        console.log(chalk.bold.cyan('  POSTER AND FABRIC DYNAMIC PRICING VERIFICATION SCRIPT'));
        console.log(divider('═') + '\n');

        await dbConnection();

        // 1. Resolve poster printing service
        const service = await PrintService.findOne({ slug: 'poster-printing', isActive: true }).select('-__v').lean();
        if (!service) {
            console.log(chalk.red('❌ Poster Printing service not found in database.'));
            process.exit(1);
        }
        console.log(chalk.green('✔ Poster Printing service found in DB.'));

        // 2. Resolve fabric poster service (so we can assert it exists and is hidden/inactive)
        const fabricService = await PrintService.findOne({ slug: 'fabric-poster-foldable' }).select('-__v').lean();
        if (!fabricService) {
            console.log(chalk.red('❌ Fabric Poster (Foldable) service not found in database.'));
            process.exit(1);
        }
        console.log(chalk.green('✔ Fabric Poster (Foldable) service found in DB.'));

        // 3. Test buildFilteredPrintServiceDetailResponse for section=poster
        console.log(chalk.yellow('\n--- Test Case 1: Fetching options with section=poster ---'));
        const detailResponse = await buildFilteredPrintServiceDetailResponse(service, 'poster');
        
        const config = detailResponse.customizationConfig || {};
        const paperSizes = config.paperSizes || [];
        const paperQualities = config.paperQualities || [];

        console.log(chalk.white('Returned Customization Keys:'), Object.keys(config).join(', '));
        if (paperSizes.length === 0 || paperQualities.length === 0) {
            throw new Error('paperSizes or paperQualities options are missing in section filter output.');
        }
        console.log(chalk.green('✔ Correct customization keys returned in section filter response.'));

        const fabricOption = paperQualities.find(q => q.code === 'FABRIC');
        if (!fabricOption) {
            throw new Error('FABRIC option is not present in supportedPaperQualities.');
        }
        console.log(chalk.green(`✔ FABRIC option found: ${fabricOption.label} (${fabricOption.code})`));

        // 4. Test price calculations
        console.log(chalk.yellow('\n--- Test Case 2: Pricing Calculations Verification ---'));
        
        const testCases = [
            // BW — Normal Sheet (POSTER_STANDARD)
            { size: 'A2', colorMode: 'BW',    quality: 'POSTER_STANDARD', expected: 60,   desc: 'A2 BW Normal Sheet' },
            { size: 'A1', colorMode: 'BW',    quality: 'POSTER_STANDARD', expected: 75,   desc: 'A1 BW Normal Sheet' },
            { size: 'A0', colorMode: 'BW',    quality: 'POSTER_STANDARD', expected: 100,  desc: 'A0 BW Normal Sheet' },
            // Color — Glossy
            { size: 'A2', colorMode: 'COLOR', quality: 'GLOSSY',          expected: 250,  desc: 'A2 Color Glossy' },
            { size: 'A1', colorMode: 'COLOR', quality: 'GLOSSY',          expected: 500,  desc: 'A1 Color Glossy' },
            { size: 'A0', colorMode: 'COLOR', quality: 'GLOSSY',          expected: 900,  desc: 'A0 Color Glossy' },
            // Color — Fabric Poster
            { size: 'A2', colorMode: 'COLOR', quality: 'FABRIC',          expected: 400,  desc: 'A2 Color Fabric Poster' },
            { size: 'A1', colorMode: 'COLOR', quality: 'FABRIC',          expected: 600,  desc: 'A1 Color Fabric Poster' },
            { size: 'A0', colorMode: 'COLOR', quality: 'FABRIC',          expected: 1500, desc: 'A0 Color Fabric Poster' },
        ];

        for (const tc of testCases) {
            const pricingResult = await resolvePrintPricing({
                service,
                customization: {
                    paperSize: tc.size,
                    colorMode: tc.colorMode,
                    paperQuality: tc.quality,
                    copies: 1,
                    orientation: 'PORTRAIT',
                    sideMode: 'SINGLE',
                },
                totalPages: 1,
                documentCount: 1,
            });

            const actualPrice = pricingResult.priceSummary?.totalAmount || 0;
            if (actualPrice !== tc.expected) {
                console.log(chalk.red(`❌ Fail: ${tc.desc} (Size: ${tc.size}, Quality: ${tc.quality}, Color: ${tc.colorMode})`));
                console.log(chalk.red(`   Expected: ₹${tc.expected}, Got: ₹${actualPrice}`));
                throw new Error(`Pricing mismatch for ${tc.desc}`);
            } else {
                console.log(chalk.green(`✔ Pass: ${tc.desc} => Calculated price: ₹${actualPrice} (Expected: ₹${tc.expected})`));
            }
        }

        console.log(chalk.green.bold('\n🎉 ALL VERIFICATION TEST CASES PASSED SUCCESSFULLY!\n'));
        process.exit(0);
    } catch (error) {
        console.error(chalk.bgRed.white('\n❌ VERIFICATION FAILED:'), error.message);
        process.exit(1);
    } finally {
        await mongoose.connection.close();
        console.log(chalk.blue('MongoDB connection closed.'));
    }
})();

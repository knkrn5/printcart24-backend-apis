// scripts/verifyDigitalPrintingComboPricing.script.js
import mongoose from 'mongoose';
import chalk from 'chalk';
import { dbConnection } from '#configs/db';
import PrintService from '#models/printService';
import PrintServicePricing from '#models/printServicePricing';
import {
    getEffectivePricingConfig,
    buildCustomizationConfig,
    resolvePrintPricing,
} from '#services/printPricing';

const SERVICE_SLUG = 'digital-printing';

(async () => {
    try {
        await dbConnection();

        const service = await PrintService.findOne({ slug: SERVICE_SLUG }).lean();
        if (!service) {
            console.error(chalk.red(`Service "${SERVICE_SLUG}" not found.`));
            process.exit(1);
        }

        console.log(chalk.bold.cyan('\n1. Testing combinations generation for Digital Printing:'));
        const pricingConfig = await getEffectivePricingConfig(service);
        const customizationConfig = buildCustomizationConfig(service, pricingConfig);

        const { adminGetPrintServiceCustomizations } = await import('#controllers/printServicePricing');

        // Emulate the controller combinations build:
        const combinations = [];
        const codeLabel = (option) => ({ code: option.code, label: option.label });
        const roundMoney = (value) => Math.round(value * 100) / 100;

        for (const color of customizationConfig.colorModes) {
            for (const size of customizationConfig.paperSizes) {
                for (const quality of customizationConfig.paperQualities) {
                    const { priceSummary } = await resolvePrintPricing({
                        service,
                        customization: {
                            colorMode: color.code,
                            paperSize: size.code,
                            paperQuality: quality.code,
                            sideMode: 'SINGLE',
                            copies: 1,
                        },
                        totalPages: 1,
                        documentCount: 1,
                    });
                    combinations.push({
                        colorMode: codeLabel(color),
                        paperSize: codeLabel(size),
                        paperQuality: codeLabel(quality),
                        price: roundMoney(priceSummary.baseAmount),
                    });
                }
            }
        }

        console.log(chalk.green(`Total combinations returned: ${combinations.length}`));
        console.log(JSON.stringify(combinations, null, 2));

        if (combinations.length !== 8) {
            throw new Error(`Expected 8 combinations, found ${combinations.length}`);
        }

        console.log(chalk.bold.cyan('\n2. Testing Admin PUT / Update Simulation:'));
        // Simulate updating COLOR + A4 + 100_GSM from 15 to 18
        const targetRow = { colorMode: 'COLOR', paperSize: 'A4', paperQuality: '100_GSM', unitPrice: 18 };
        await PrintServicePricing.updateOne(
            {
                service: service._id,
                comboPricing: {
                    $elemMatch: {
                        colorMode: targetRow.colorMode,
                        paperSize: targetRow.paperSize,
                        paperQuality: targetRow.paperQuality,
                    },
                },
            },
            {
                $set: { 'comboPricing.$.unitPrice': targetRow.unitPrice },
            }
        );

        console.log(chalk.green(`Updated COLOR + A4 + 100_GSM unitPrice to 18`));

        console.log(chalk.bold.cyan('\n3. Testing User Checkout / resolvePrintPricing with the updated price:'));
        const freshPricingConfig = await getEffectivePricingConfig(service);
        const { priceSummary: singleSideResult } = await resolvePrintPricing({
            service,
            pricingConfig: freshPricingConfig,
            customization: {
                colorMode: 'COLOR',
                paperSize: 'A4',
                paperQuality: '100_GSM',
                sideMode: 'SINGLE',
                copies: 2,
            },
            totalPages: 10,
            documentCount: 1,
        });

        console.log('Single side result (10 pages x 2 copies @ 18/page):', singleSideResult);
        const expectedSingle = 18 * 10 * 2; // 360
        if (singleSideResult.baseAmount !== expectedSingle) {
            throw new Error(`Expected baseAmount ${expectedSingle}, got ${singleSideResult.baseAmount}`);
        }
        console.log(chalk.green(`✓ Single sided baseAmount matches: ₹${singleSideResult.baseAmount}`));

        const { priceSummary: doubleSideResult } = await resolvePrintPricing({
            service,
            pricingConfig: freshPricingConfig,
            customization: {
                colorMode: 'COLOR',
                paperSize: 'A4',
                paperQuality: '100_GSM',
                sideMode: 'DOUBLE',
                copies: 2,
            },
            totalPages: 10,
            documentCount: 1,
        });

        console.log('Double side result (10 pages x 2 copies @ 36/page):', doubleSideResult);
        const expectedDouble = 18 * 2 * 10 * 2; // 720
        if (doubleSideResult.baseAmount !== expectedDouble) {
            throw new Error(`Expected double-sided baseAmount ${expectedDouble}, got ${doubleSideResult.baseAmount}`);
        }
        console.log(chalk.green(`✓ Double sided baseAmount matches: ₹${doubleSideResult.baseAmount}`));

        // Restore back to 15
        await PrintServicePricing.updateOne(
            {
                service: service._id,
                comboPricing: {
                    $elemMatch: {
                        colorMode: targetRow.colorMode,
                        paperSize: targetRow.paperSize,
                        paperQuality: targetRow.paperQuality,
                    },
                },
            },
            {
                $set: { 'comboPricing.$.unitPrice': 15 },
            }
        );
        console.log(chalk.gray(`Restored COLOR + A4 + 100_GSM unitPrice back to 15`));

        console.log(chalk.bold.green('\nALL VERIFICATION CHECKS PASSED!\n'));
        process.exit(0);
    } catch (err) {
        console.error(chalk.red('Verification failed:'), err);
        process.exit(1);
    } finally {
        await mongoose.connection.close();
    }
})();

// scripts/verifyCertificateAdminCustomizations.script.js
import mongoose from 'mongoose';
import chalk from 'chalk';
import { dbConnection } from '#configs/db';
import PrintService from '#models/printService';
import PrintServicePricing from '#models/printServicePricing';
import {
    getEffectivePricingConfig,
    buildCustomizationConfig,
    buildFilteredPrintServiceDetailResponse,
} from '#services/printPricing';

const CERTIFICATE_PAGE_BUCKETS = [
    { code: 'PAGES_LTE_100', label: 'Upto 100 pages', totalPages: 50 },
    { code: 'PAGES_GT_100', label: 'Above 100 pages', totalPages: 150 },
];

(async () => {
    try {
        await dbConnection();

        const service = await PrintService.findOne({ _id: '6aa11ef44d8ad0883c48b215' }).lean();
        if (!service) {
            console.error(chalk.red('Service 6aa11ef44d8ad0883c48b215 not found'));
            process.exit(1);
        }

        console.log(chalk.bold.cyan('\n1. Verifying supportedColorModes in PrintService:'));
        console.log(JSON.stringify(service.supportedColorModes.map((c) => ({ code: c.code, label: c.label, isActive: c.isActive })), null, 2));

        console.log(chalk.bold.cyan('\n2. Verifying User App API (GET /api/print-services/certificate?section=colorModes):'));
        const userAppColorModes = await buildFilteredPrintServiceDetailResponse(service, 'colorModes');
        console.log('colorModes in user app response:');
        console.log(JSON.stringify(userAppColorModes.customizationConfig.colorModes, null, 2));
        if (userAppColorModes.customizationConfig.colorModes.length !== 2) {
            throw new Error(`Expected both color modes in user app, found ${userAppColorModes.customizationConfig.colorModes.length}`);
        }
        console.log(chalk.green('✓ Both Color and Black & White are present for client app'));

        console.log(chalk.bold.cyan('\n3. Verifying Admin Customizations (GET /api/admin/print-services/:serviceId/customizations):'));
        const pricingConfig = await getEffectivePricingConfig(service);
        const customizationConfig = buildCustomizationConfig(service, pricingConfig);

        // This matches buildCertificateCombinations in printServicePricing.controller.js
        const { resolvePrintPricing } = await import('#services/printPricing');
        const codeLabel = (option) => ({ code: option.code, label: option.label });
        const roundMoney = (value) => Math.round(value * 100) / 100;

        const colorModes = (customizationConfig.colorModes || []).filter((color) => color.code === 'COLOR');
        const adminCombinations = [];
        for (const color of colorModes) {
            for (const bucket of CERTIFICATE_PAGE_BUCKETS) {
                const { priceSummary } = await resolvePrintPricing({
                    service,
                    customization: { colorMode: color.code, copies: 1 },
                    totalPages: bucket.totalPages,
                    documentCount: 1,
                });
                adminCombinations.push({
                    colorMode: codeLabel(color),
                    pageBucket: { code: bucket.code, label: bucket.label },
                    price: roundMoney(priceSummary.baseAmount / bucket.totalPages),
                });
            }
        }

        console.log(chalk.green(`Admin combinations count: ${adminCombinations.length}`));
        console.log(JSON.stringify(adminCombinations, null, 2));

        if (adminCombinations.length !== 2) {
            throw new Error(`Expected exactly 2 combinations for admin, got ${adminCombinations.length}`);
        }
        if (adminCombinations.some((c) => c.colorMode.code !== 'COLOR')) {
            throw new Error('Found non-COLOR combination in admin response');
        }
        console.log(chalk.green('✓ Admin response contains ONLY the 2 COLOR combinations'));

        console.log(chalk.bold.cyan('\n4. Verifying that B&W prices are STILL preserved in comboPricing database:'));
        const pricingDoc = await PrintServicePricing.findOne({ service: service._id }).lean();
        const bwRows = (pricingDoc?.comboPricing || []).filter((r) => r.colorMode === 'BW');
        if (bwRows.length < 2) {
            throw new Error('B&W comboPricing rows were unexpectedly lost!');
        }
        console.log(chalk.green(`✓ B&W rows preserved in DB: ${bwRows.length} rows`));

        console.log(chalk.bold.green('\nALL VERIFICATIONS PASSED SUCCESSFULLY!\n'));
        process.exit(0);
    } catch (err) {
        console.error(chalk.red('Verification failed:'), err);
        process.exit(1);
    } finally {
        await mongoose.connection.close();
    }
})();

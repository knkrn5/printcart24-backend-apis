// scripts/testOrderValidationAddonQty.script.js
import mongoose from 'mongoose';
import chalk from 'chalk';
import { dbConnection } from '#configs/db';
import PrintService from '#models/printService';
import PrintOrder from '#models/printOrder';
import { resolvePrintPricing, getEffectivePricingConfig } from '#services/printPricing';

const GROUP_FIELD_MAP = {
    COLOR_MODE: 'supportedColorModes',
    PAPER_SIZE: 'supportedPaperSizes',
    PAPER_QUALITY: 'supportedPaperQualities',
    ORIENTATION: 'supportedOrientations',
    SIDE_MODE: 'supportedSideModes',
    BINDING_TOGGLE: 'bindingConfiguration.toggles',
    BINDING_OPTION: 'bindingConfiguration.options',
    BOOKLET_OPTION: 'bookletOptions',
};

const getNestedValue = (obj, path, defaultValue) => {
    return path.split('.').reduce((acc, part) => (acc && acc[part] !== undefined ? acc[part] : undefined), obj) || defaultValue;
};

const run = async () => {
    try {
        console.log(chalk.cyan('Connecting to database...'));
        await dbConnection();

        // Find all active print services
        console.log(chalk.cyan('Fetching all active print services...'));
        const services = await PrintService.find({ isActive: true });
        console.log(chalk.green(`Found ${services.length} active print service(s).`));

        let foundBugTrigger = false;

        for (const service of services) {
            console.log(chalk.blue(`\n--------------------------------------------`));
            console.log(chalk.blue(`Testing service: ${service.name} (${service.slug})`));

            // Get effective pricing configuration
            const pricingConfig = await getEffectivePricingConfig(service);

            const isSupported = (group, code) => {
                const fieldPath = GROUP_FIELD_MAP[group];
                if (!fieldPath || !code) return false;
                const options = getNestedValue(service, fieldPath, []);
                return options.some(o => o.code === code && o.isActive !== false);
            };
            
            // Find all option pricing entries that calculate per page or per 100 pages AND are supported by this service
            const perPageOptions = (pricingConfig.optionPricing || []).filter(
                entry => (entry.calculationType === 'PER_PAGE' || entry.calculationType === 'PER_100_PAGES') &&
                        isSupported(entry.group, entry.code)
            );

            if (perPageOptions.length === 0) {
                console.log(chalk.yellow(`No supported options with PER_PAGE or PER_100_PAGES calculationType found for this service.`));
                continue;
            }

            console.log(chalk.yellow(`Found ${perPageOptions.length} supported option(s) with PER_PAGE or PER_100_PAGES calculationType:`));
            perPageOptions.forEach(opt => {
                console.log(chalk.gray(` - Group: ${opt.group}, Code: ${opt.code}, Label: ${opt.label}`));
            });

            // Build customization payload that selects these options
            const customization = {
                copies: 1,
                orientation: service.supportedOrientations?.find(o => o.isActive !== false)?.code || '',
                paperSize: service.supportedPaperSizes?.find(o => o.isActive !== false)?.code || '',
                colorMode: service.supportedColorModes?.find(o => o.isActive !== false)?.code || '',
                sideMode: service.supportedSideModes?.find(o => o.isActive !== false)?.code || '',
                paperQuality: service.supportedPaperQualities?.find(o => o.isActive !== false)?.code || ''
            };

            // Override standard selections with the PER_PAGE options we found
            perPageOptions.forEach(opt => {
                if (opt.group === 'COLOR_MODE') customization.colorMode = opt.code;
                if (opt.group === 'PAPER_SIZE') customization.paperSize = opt.code;
                if (opt.group === 'PAPER_QUALITY') customization.paperQuality = opt.code;
                if (opt.group === 'ORIENTATION') customization.orientation = opt.code;
                if (opt.group === 'SIDE_MODE') customization.sideMode = opt.code;
            });

            console.log(chalk.cyan(`Resolving print pricing with totalPages = 0 and custom customization...`));
            const pricingResult = await resolvePrintPricing({
                service,
                customization,
                totalPages: 0,
                documentCount: 1
            });

            const zeroQtyAddOns = pricingResult.selectedAddOns.filter(addon => addon.quantity === 0);
            if (zeroQtyAddOns.length > 0) {
                console.log(chalk.red(`❌ Found ${zeroQtyAddOns.length} selectedAddOn(s) with quantity = 0:`));
                zeroQtyAddOns.forEach(addon => {
                    console.log(chalk.red(`   - Group: ${addon.group}, Code: ${addon.code}, PricingModel: ${addon.pricingModel}, Quantity: ${addon.quantity}`));
                });

                foundBugTrigger = true;

                // Now, let's construct a mock PrintOrder and trigger Mongoose validation
                console.log(chalk.cyan('Constructing mock PrintOrder and validating...'));
                const mockOrder = new PrintOrder({
                    user: new mongoose.Types.ObjectId(),
                    cart: new mongoose.Types.ObjectId(),
                    deliveryMode: 'PICKUP',
                    paymentStatus: 'PAID',
                    orderStatus: 'RECEIVED',
                    items: [{
                        service: service._id,
                        serviceSnapshot: {
                            name: service.name,
                            slug: service.slug,
                            serviceType: service.serviceType
                        },
                        document: {
                            document: new mongoose.Types.ObjectId(),
                            originalFileName: 'test_empty.pdf',
                            fileUrl: 'https://example.com/test_empty.pdf',
                            pageCount: 0
                        },
                        customization: {
                            copies: 1,
                            orientation: customization.orientation,
                            paperSize: customization.paperSize,
                            colorMode: customization.colorMode,
                            sideMode: customization.sideMode,
                            paperQuality: customization.paperQuality,
                            selectedAddOns: pricingResult.selectedAddOns
                        },
                        priceSummary: {
                            baseAmount: 0,
                            addOnAmount: 0,
                            taxAmount: 0,
                            totalAmount: 0
                        }
                    }],
                    priceSummary: {
                        baseAmount: 0,
                        addOnAmount: 0,
                        taxAmount: 0,
                        totalAmount: 0,
                        grandTotal: 0
                    }
                });

                try {
                    await mockOrder.validate();
                    console.log(chalk.green('✅ PrintOrder successfully validated (no validation errors).'));
                } catch (validationError) {
                    console.log(chalk.red('❌ PrintOrder validation failed as expected:'));
                    console.log(chalk.red(validationError.stack || validationError.toString()));
                }
                
                // We successfully demonstrated the bug, we can continue testing others
                // break;
            } else {
                console.log(chalk.green('✅ No selectedAddOns with quantity = 0 found for this service.'));
            }
        }

        if (!foundBugTrigger) {
            console.log(chalk.yellow('\nCould not trigger the bug using active service configurations with page count = 0.'));
        }

        await mongoose.connection.close();
        console.log(chalk.cyan('\nDatabase connection closed.'));
    } catch (err) {
        console.error(chalk.red('Error running script:'), err);
        try { await mongoose.connection.close(); } catch {}
    }
};

run();

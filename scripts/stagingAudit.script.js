// scripts/stagingAudit.script.js
import mongoose from 'mongoose';
import fs from 'fs';
import { dbConnection } from '#configs/db';
import PrintService from '#models/printService';
import PrintServicePricing from '#models/printServicePricing';

const run = async () => {
    try {
        await dbConnection();

        // Retrieve print services
        const services = await PrintService.find().lean();
        // Retrieve print service pricing profiles
        const pricingProfiles = await PrintServicePricing.find().lean();

        console.log('=== SERVICES COUNT IN STAGING:', services.length);
        console.log('=== PRICING PROFILES COUNT IN STAGING:', pricingProfiles.length);

        const dataDump = {
            services: services.map(s => ({
                id: s._id.toString(),
                name: s.name,
                slug: s.slug,
                isActive: s.isActive,
                serviceType: s.serviceType,
                pricingModel: s.pricingModel,
                basePrice: s.basePrice,
                supportedPaperSizes: s.supportedPaperSizes?.map(x => ({ code: x.code, label: x.label, price: x.price, isActive: x.isActive, isDefault: x.isDefault })),
                supportedColorModes: s.supportedColorModes?.map(x => ({ code: x.code, label: x.label, price: x.price, isActive: x.isActive, isDefault: x.isDefault })),
                supportedSideModes: s.supportedSideModes?.map(x => ({ code: x.code, label: x.label, price: x.price, isActive: x.isActive, isDefault: x.isDefault })),
                supportedPaperQualities: s.supportedPaperQualities?.map(x => ({ code: x.code, label: x.label, price: x.price, isActive: x.isActive, isDefault: x.isDefault, colorModeFilter: x.colorModeFilter })),
                supportedOrientations: s.supportedOrientations?.map(x => ({ code: x.code, label: x.label, price: x.price, isActive: x.isActive, isDefault: x.isDefault })),
                supportedBindingColors: s.supportedBindingColors?.map(x => ({ code: x.code, label: x.label })),
                bindingConfiguration: {
                    toggles: s.bindingConfiguration?.toggles?.map(x => ({
                        id: x.id,
                        code: x.code,
                        label: x.label,
                        price: x.price,
                        hasSubOptions: x.hasSubOptions,
                        isActive: x.isActive,
                        isDefault: x.isDefault,
                        subOptions: x.subOptions?.map(so => ({ id: so.id, code: so.code, label: so.label, price: so.price, minPages: so.minPages, maxPages: so.maxPages }))
                    })),
                    options: s.bindingConfiguration?.options?.map(x => ({ code: x.code, label: x.label, unitPrice: x.unitPrice }))
                },
                bookletOptions: s.bookletOptions?.map(x => ({ code: x.code, label: x.label, price: x.price, isActive: x.isActive })),
                pricingRules: s.pricingRules?.map(x => ({ group: x.group, code: x.code, label: x.label, calculationType: x.calculationType, amount: x.amount, minPages: x.minPages, maxPages: x.maxPages, slabSize: x.slabSize, isActive: x.isActive })),
                taxRules: s.taxRules
            })),
            pricingProfiles: pricingProfiles.map(p => ({
                id: p._id.toString(),
                service: p.service.toString(),
                currency: p.currency,
                isActive: p.isActive,
                basePricing: p.basePricing,
                optionPricing: p.optionPricing?.map(x => ({
                    group: x.group,
                    code: x.code,
                    label: x.label,
                    calculationType: x.calculationType,
                    unitPrice: x.unitPrice,
                    minPages: x.minPages,
                    maxPages: x.maxPages,
                    slabSize: x.slabSize,
                    isActive: x.isActive
                }))
            }))
        };

        fs.writeFileSync('scripts/stagingDump.json', JSON.stringify(dataDump, null, 2), 'utf-8');
        console.log('Saved to scripts/stagingDump.json successfully.');

        await mongoose.connection.close();
        process.exit(0);
    } catch (err) {
        console.error('Audit Error:', err);
        process.exit(1);
    }
};

run();

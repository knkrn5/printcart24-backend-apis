// scratch/testValidationAndPricing.js
import mongoose from 'mongoose';
import { dbConnection } from '../configs/db.config.js';
import PrintService from '../models/printService.model.js';
import { validateDocumentCustomizationAgainstService } from '../validations/printDocument.validation.js';
import { resolvePrintPricing } from '../services/printPricing.service.js';

(async () => {
    try {
        await dbConnection();
        const service = await PrintService.findOne({ slug: 'poster-printing', isActive: true }).select('-__v').lean();
        if (!service) {
            console.log('poster-printing service not found in DB');
            process.exit(1);
        }
        
        // Mock a customization state where paperSize is empty or missing, and we update other fields
        const testCustomizations = [
            { orientation: 'PORTRAIT', colorMode: 'COLOR' }, // paperSize is missing
            { paperSize: '', orientation: 'PORTRAIT', colorMode: 'COLOR' }, // paperSize is empty string
            { paperSize: null, orientation: 'PORTRAIT', colorMode: 'COLOR' }, // paperSize is null
        ];
        
        for (const cust of testCustomizations) {
            console.log('\nTesting customization:', cust);
            
            // 1. Backend validation check
            const validationError = validateDocumentCustomizationAgainstService({
                customization: cust,
                service,
            });
            console.log('validateDocumentCustomizationAgainstService output:', validationError);
            
            // 2. Pricing resolution check
            try {
                const pricingResult = await resolvePrintPricing({
                    service,
                    customization: cust,
                    totalPages: 1,
                    documentCount: 1,
                });
                console.log('resolvePrintPricing successful, basePrice:', pricingResult.priceSummary.totalAmount);
            } catch (err) {
                console.log('resolvePrintPricing failed with error:', err.message);
            }
        }
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
})();

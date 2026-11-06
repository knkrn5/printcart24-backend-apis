// scripts/verifyPlatformFee.script.js
import mongoose from 'mongoose';
import chalk from 'chalk';

import env from '#configs/env';
import Cart from '#models/cart';
import { dbConnection } from '#configs/db';

// We can read buildCartResponse by importing it or simulating it. Let's do both!
import { buildOrderPriceSummary } from '../controllers/orders.controller.js';

(async () => {
    try {
        console.log(chalk.blue('=== Starting Platform Fee Verification ==='));
        console.log(`Configured FIXED_PLATFORM_FEE: ${env.FIXED_PLATFORM_FEE}`);

        // 1. Connect to Database
        await dbConnection();

        // 2. Test Order Price Summary function
        console.log(chalk.yellow('\n--- Testing buildOrderPriceSummary ---'));
        const mockItems = [
            {
                priceSummary: {
                    baseAmount: 30,
                    addOnAmount: 5,
                    taxAmount: 6.3,
                    totalAmount: 41.3
                }
            }
        ];
        const mockStationeryItems = [
            {
                priceSummary: {
                    unitPrice: 50,
                    taxableAmount: 50,
                    taxAmount: 9,
                    totalAmount: 59
                }
            }
        ];
        
        const orderSummary = buildOrderPriceSummary(mockItems, mockStationeryItems, null);
        console.log('Resulting Order Price Summary:', JSON.stringify(orderSummary, null, 2));

        if (orderSummary.platformFee !== env.FIXED_PLATFORM_FEE) {
            throw new Error(`Expected platformFee to be ${env.FIXED_PLATFORM_FEE}, got ${orderSummary.platformFee}`);
        }

        // Expected grandTotal = (30 + 5 + 50) - discount(0) = 85. Tax on 85 (18%) = 15.3. 
        // grandTotal = 85 + 15.3 + delivery(0) + platform(10) = 110.3
        const expectedGrandTotal = 85 + 15.3 + 0 + env.FIXED_PLATFORM_FEE;
        if (Math.abs(orderSummary.grandTotal - expectedGrandTotal) > 0.01) {
            throw new Error(`Expected grandTotal to be ~${expectedGrandTotal}, got ${orderSummary.grandTotal}`);
        }
        console.log(chalk.green('✔ buildOrderPriceSummary calculations are correct!'));

        // 3. Test Cart Price Summary in DB
        console.log(chalk.yellow('\n--- Testing Cart Response ---'));
        // Find any active cart in the DB to test the actual buildCartResponse
        const testCart = await Cart.findOne({ status: 'ACTIVE' });
        if (testCart) {
            console.log(`Found active cart for user: ${testCart.user}`);
            // Let's dynamically load buildCartResponse from controller
            const { buildCartResponse } = await import('../controllers/cart.controller.js');
            const cartResponseData = await buildCartResponse(testCart);

            console.log('Sample Cart Response Pricing Summary:');
            console.log(JSON.stringify(cartResponseData.pricing, null, 2));

            if (Number(cartResponseData.pricing.platformFee) !== env.FIXED_PLATFORM_FEE) {
                throw new Error(`Cart response platformFee expected ${env.FIXED_PLATFORM_FEE}, got ${cartResponseData.pricing.platformFee}`);
            }
            console.log(chalk.green('✔ Cart response platformFee is correctly populated!'));
        } else {
            console.log(chalk.magenta('No active cart found in DB to execute buildCartResponse. Skipping live cart test.'));
        }

        console.log(chalk.bold.green('\n✅ Verification completed successfully! All checks passed.'));
        process.exit(0);
    } catch (error) {
        console.error(chalk.bgRed.white('\n✖ Verification failed:'), error);
        process.exit(1);
    } finally {
        await mongoose.connection.close();
        console.log(chalk.blue('MongoDB connection closed.'));
    }
})();

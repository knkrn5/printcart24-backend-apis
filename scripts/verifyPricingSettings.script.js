// scripts/verifyPricingSettings.script.js
import mongoose from 'mongoose';
import chalk from 'chalk';
import { dbConnection } from '#configs/db';
import { getPricingSettings, updatePricingSettings } from '#services/pricingSetting';
import { buildOrderPriceSummary } from '../controllers/orders.controller.js';
import Cart from '#models/cart';
import { buildCartResponse } from '../controllers/cart.controller.js';

(async () => {
    try {
        console.log(chalk.blue('=== Starting Pricing Settings End-to-End Verification ==='));
        await dbConnection();

        // 1. Initial Fetch
        console.log(chalk.yellow('\n1. Testing getPricingSettings()...'));
        const initialSettings = await getPricingSettings();
        console.log('Current settings:', JSON.stringify(initialSettings, null, 2));

        if (
            typeof initialSettings.platformFee !== 'number' ||
            typeof initialSettings.deliveryFee !== 'number' ||
            typeof initialSettings.gstPercentage !== 'number' ||
            typeof initialSettings.sameDayRepeatDiscountPercentage !== 'number'
        ) {
            throw new Error('getPricingSettings() did not return all required numeric fields');
        }
        console.log(chalk.green('✔ getPricingSettings() returned valid numeric fields!'));

        // 2. Test updatePricingSettings()
        console.log(chalk.yellow('\n2. Testing updatePricingSettings() with test values...'));
        const testPayload = {
            platformFee: 25,
            deliveryFee: 40,
            gstPercentage: 12,
            sameDayRepeatDiscountPercentage: 8,
        };

        const updatedSettings = await updatePricingSettings(testPayload);
        console.log('Updated settings response:', JSON.stringify(updatedSettings, null, 2));

        if (
            updatedSettings.platformFee !== 25 ||
            updatedSettings.deliveryFee !== 40 ||
            updatedSettings.gstPercentage !== 12 ||
            updatedSettings.sameDayRepeatDiscountPercentage !== 8
        ) {
            throw new Error('updatePricingSettings() did not persist expected test values');
        }
        console.log(chalk.green('✔ updatePricingSettings() persisted and returned updated values!'));

        // 3. Test buildOrderPriceSummary with the updated settings
        console.log(chalk.yellow('\n3. Testing buildOrderPriceSummary() with updated pricingSettings...'));
        const mockItems = [
            {
                priceSummary: {
                    baseAmount: 100,
                    addOnAmount: 0,
                    taxAmount: 12,
                    totalAmount: 112,
                },
            },
        ];

        // repeatDiscountAmount: 8% of 100 = 8
        // taxableBase: 100 - 8 = 92
        // GST (12% of 92): 11.04
        // Grand Total: 92 + 11.04 + 40 (delivery) + 25 (platform) = 168.04
        const orderSummary = buildOrderPriceSummary(mockItems, [], null, {
            repeatDiscountAmount: 8,
            pricingSettings: updatedSettings,
        });

        console.log('Resulting Order Price Summary:', JSON.stringify(orderSummary, null, 2));

        if (orderSummary.deliveryFee !== 40) {
            throw new Error(`Expected deliveryFee 40, got ${orderSummary.deliveryFee}`);
        }
        if (orderSummary.platformFee !== 25) {
            throw new Error(`Expected platformFee 25, got ${orderSummary.platformFee}`);
        }
        if (Math.abs(orderSummary.taxAmount - 11.04) > 0.01) {
            throw new Error(`Expected taxAmount 11.04, got ${orderSummary.taxAmount}`);
        }
        if (Math.abs(orderSummary.grandTotal - 168.04) > 0.01) {
            throw new Error(`Expected grandTotal 168.04, got ${orderSummary.grandTotal}`);
        }
        console.log(chalk.green('✔ buildOrderPriceSummary correctly calculates tax and grand total with dynamic settings!'));

        // 4. Test live Cart response if an active cart exists
        console.log(chalk.yellow('\n4. Testing buildCartResponse() live integration...'));
        const testCart = await Cart.findOne({ status: 'ACTIVE' });
        if (testCart) {
            console.log(`Testing with active cart user: ${testCart.user}`);
            const cartResponse = await buildCartResponse(testCart);
            console.log('Cart pricing summary:', JSON.stringify(cartResponse.pricing, null, 2));

            if (cartResponse.pricing.platformFee !== 25) {
                throw new Error(`Expected cart platformFee 25, got ${cartResponse.pricing.platformFee}`);
            }
            if (cartResponse.pricing.deliveryFee !== 40) {
                throw new Error(`Expected cart deliveryFee 40, got ${cartResponse.pricing.deliveryFee}`);
            }
            console.log(chalk.green('✔ buildCartResponse reflects live dynamic pricing settings!'));
        } else {
            console.log(chalk.magenta('No active cart found in DB. Skipping live cart check.'));
        }

        // 5. Restore settings to standard baseline
        console.log(chalk.yellow('\n5. Restoring settings to baseline defaults (platformFee: 10, deliveryFee: 0, gstPercentage: 18, sameDayRepeatDiscountPercentage: 5)...'));
        const restored = await updatePricingSettings({
            platformFee: 10,
            deliveryFee: 0,
            gstPercentage: 18,
            sameDayRepeatDiscountPercentage: 5,
        });
        console.log('Restored settings in DB:', JSON.stringify(restored, null, 2));
        console.log(chalk.green('✔ Baseline settings restored!'));

        console.log(chalk.bold.green('\n🎉 ALL PRICING SETTINGS VERIFICATIONS PASSED!'));
        process.exit(0);
    } catch (error) {
        console.error(chalk.bgRed.white('\n✖ Verification failed:'), error);
        process.exit(1);
    } finally {
        await mongoose.connection.close();
        console.log(chalk.blue('MongoDB connection closed.'));
    }
})();

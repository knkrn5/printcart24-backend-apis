// scripts/migrateHistoricalOrdersLabels.script.js
import mongoose from 'mongoose';
import chalk from 'chalk';
import { dbConnection } from '#configs/db';
import PrintOrder from '#models/printOrder';

const BINDING_TOGGLE_PARENTS = {
    LANGUAGE: 'Language',
    STAPLING: 'Stapling',
    SPIRAL_BINDING: 'Spiral Binding',
    SUMMARY_SYNOPSIS_ABSTRACT_BINDING: 'Summary, Synopsis, Abstract Binding'
};

const run = async () => {
    const isApply = process.argv.includes('--apply');
    console.log(chalk.bold.cyan(`\nStarting historical orders label audit/migration (Mode: ${isApply ? 'APPLY' : 'DRY-RUN'})...`));

    try {
        await dbConnection();

        const orders = await PrintOrder.find({
            'items.customization.selectedAddOns': {
                $elemMatch: {
                    group: 'BINDING_TOGGLE'
                }
            }
        });

        console.log(`Found ${orders.length} orders with BINDING_TOGGLE add-ons.`);
        let modifiedCount = 0;

        for (const order of orders) {
            let orderUpdated = false;

            for (const item of order.items || []) {
                const selectedAddOns = item.customization?.selectedAddOns || [];
                for (const addon of selectedAddOns) {
                    if (addon.group === 'BINDING_TOGGLE' && BINDING_TOGGLE_PARENTS[addon.code]) {
                        const correctParentLabel = BINDING_TOGGLE_PARENTS[addon.code];
                        if (addon.label !== correctParentLabel) {
                            console.log(chalk.yellow(`[Order ${order.orderNumber}] Correcting addon label for '${addon.code}': '${addon.label}' -> '${correctParentLabel}'`));
                            addon.label = correctParentLabel;
                            orderUpdated = true;
                        }
                    }
                }
            }

            if (orderUpdated) {
                modifiedCount++;
                if (isApply) {
                    await PrintOrder.updateOne({ _id: order._id }, { $set: { items: order.items } });
                }
            }
        }

        console.log(chalk.bold.cyan('\nMigration Summary:'));
        console.log(`Total orders checked: ${orders.length}`);
        console.log(`Orders needing update: ${modifiedCount}`);

        if (isApply) {
            console.log(chalk.green('✅ Updates applied to the database successfully.'));
        } else {
            console.log(chalk.yellow('ℹ️ Dry-run mode. No changes were saved to the database. Run with --apply to execute.'));
        }

        await mongoose.connection.close();
    } catch (err) {
        console.error(chalk.red('💥 Error:'), err);
        try { await mongoose.connection.close(); } catch {}
    }
};

run();

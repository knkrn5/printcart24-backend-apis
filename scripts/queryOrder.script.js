import { dbConnection } from '#configs/db';
import PrintOrder from '#models/printOrder';
import mongoose from 'mongoose';

const run = async () => {
    try {
        await dbConnection();
        const order = await PrintOrder.findById('6a50b96471c00e2e20bae413').lean();
        if (!order) {
            console.log('Order 6a50b96471c00e2e20bae413 not found.');
        } else {
            console.log('Order Items Customization details:');
            console.dir(order.items.map(item => item.customization), { depth: null });
        }
        await mongoose.connection.close();
    } catch (err) {
        console.error('Error:', err);
    }
};

run();

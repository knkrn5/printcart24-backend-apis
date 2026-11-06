import mongoose from 'mongoose';
import Coupon from '#models/coupon';

const MONGODB_URI = process.env.DB_URL || 'mongodb://localhost:27017/printcart24';

const COUPONS = [
    // 🖨️ PRINT SERVICES (First Order)

    {
        code: 'PRINT30NEW',
        title: '30% OFF First Print Order',
        description: 'Get 30% off on your first print service order. Minimum order value ₹199.',
        discountType: 'PERCENT',
        discountValue: 30,
        maxDiscountAmount: 300,
        minOrderValue: 199,
        applicableServiceTypes: ['PRINT'],
        firstOrderOnly: true,
        usageLimitPerUser: 1,
        validFrom: new Date(),
        validUntil: new Date(new Date().setFullYear(new Date().getFullYear() + 1)),
        isActive: true,
    },
    {
        code: 'BULK25NEW',
        title: '25% OFF Bulk Printing',
        description: 'Save 25% on bulk print orders. Minimum order value ₹499.',
        discountType: 'PERCENT',
        discountValue: 25,
        maxDiscountAmount: 500,
        minOrderValue: 499,
        applicableServiceTypes: ['PRINT'],
        firstOrderOnly: true,
        usageLimitPerUser: 1,
        validFrom: new Date(),
        validUntil: new Date(new Date().setFullYear(new Date().getFullYear() + 1)),
        isActive: true,
    },
    {
        code: 'WELCOMEPRINT20',
        title: '20% OFF Welcome Print Offer',
        description: 'Flat 20% off on your first print order. Minimum order value ₹149.',
        discountType: 'PERCENT',
        discountValue: 20,
        maxDiscountAmount: 200,
        minOrderValue: 149,
        applicableServiceTypes: ['PRINT'],
        firstOrderOnly: true,
        usageLimitPerUser: 1,
        validFrom: new Date(),
        validUntil: new Date(new Date().setFullYear(new Date().getFullYear() + 1)),
        isActive: true,
    },

    // 📚 STATIONERY PRODUCTS (First Order)

    {
        code: 'STATIONERY50',
        title: '₹50 OFF Stationery',
        description: 'Flat ₹50 off on your first stationery purchase.',
        discountType: 'FIXED',
        discountValue: 50,
        minOrderValue: 199,
        applicableServiceTypes: ['STATIONERY'],
        firstOrderOnly: true,
        usageLimitPerUser: 1,
        validFrom: new Date(),
        validUntil: new Date(new Date().setFullYear(new Date().getFullYear() + 1)),
        isActive: true,
    },
    {
        code: 'WELCOME100',
        title: '₹100 OFF New User',
        description: 'Flat ₹100 off on all orders above ₹499.',
        discountType: 'FIXED',
        discountValue: 100,
        minOrderValue: 499,
        applicableServiceTypes: ['STATIONERY'],
        firstOrderOnly: true,
        usageLimitPerUser: 1,
        validFrom: new Date(),
        validUntil: new Date(new Date().setFullYear(new Date().getFullYear() + 1)),
        isActive: true,
    },
];

const seedCoupons = async () => {
    try {
        await mongoose.connect(MONGODB_URI);
        console.log('Connected to MongoDB');

        await Coupon.deleteMany({});
        console.log('Cleared existing coupons');

        await Coupon.insertMany(COUPONS);
        console.log('Successfully seeded coupons');

        console.log('Coupons seeded:', COUPONS);
    } catch (error) {
        console.error('Error seeding coupons:', error);
    } finally {
        await mongoose.disconnect();
        console.log('Disconnected from MongoDB');
    }
};

seedCoupons();

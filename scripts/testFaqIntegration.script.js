import mongoose from 'mongoose';
import Faq from '#models/faq';

const MONGODB_URI = process.env.DB_URL || 'mongodb://localhost:27017/printcart24';

const assert = (condition, message) => {
    if (!condition) {
        throw new Error(`Assertion Failed: ${message}`);
    }
    console.log(`[PASS] ${message}`);
};

const runTests = async () => {
    try {
        console.log('Connecting to MongoDB:', MONGODB_URI);
        await mongoose.connect(MONGODB_URI);
        console.log('Connected to MongoDB.');

        // Clean up
        await Faq.deleteMany({});
        console.log('Cleared existing FAQs.');

        // 1. Test creation and dynamic ordering
        console.log('--- Testing Create FAQ (Dynamic Ordering) ---');
        // Create first FAQ
        const faq1 = await Faq.create({
            question: 'What is PrintCart24?',
            answer: 'A printing service for students.',
            order: 1, // Let's simulate the controller logic
        });
        assert(faq1.order === 1, 'First FAQ should have order 1');

        // Let's get max order and simulate creating second FAQ (as in the controller)
        const lastFaq = await Faq.findOne({ isDeleted: false })
            .sort({ order: -1 })
            .select('order')
            .lean();
        const nextOrder = lastFaq ? lastFaq.order + 1 : 1;
        assert(nextOrder === 2, 'Next order value calculated should be 2');

        const faq2 = await Faq.create({
            question: 'How to pay?',
            answer: 'Via Cards, NetBanking, or UPI.',
            order: nextOrder,
        });
        assert(faq2.order === 2, 'Second FAQ should have order 2');

        // Create a third FAQ
        const faq3 = await Faq.create({
            question: 'Is COD available?',
            answer: 'No, only online payments.',
            order: faq2.order + 1,
        });
        assert(faq3.order === 3, 'Third FAQ should have order 3');

        // 2. Test sorting (newest/highest order first)
        console.log('--- Testing Sorting order DESC ---');
        const sortedFaqs = await Faq.find({ isDeleted: false, isActive: true }).sort({ order: -1 }).lean();
        assert(sortedFaqs.length === 3, 'Should retrieve 3 FAQs');
        assert(sortedFaqs[0].question === 'Is COD available?', 'Newest FAQ (highest order) should be first');
        assert(sortedFaqs[1].question === 'How to pay?', 'Second FAQ should be second');
        assert(sortedFaqs[2].question === 'What is PrintCart24?', 'Oldest FAQ (lowest order) should be last');

        // 3. Test update (retaining rank order)
        console.log('--- Testing Update (Rank retention) ---');
        const faq1BeforeUpdate = await Faq.findById(faq1._id);
        const faq1Order = faq1BeforeUpdate.order;

        const faq1Updated = await Faq.findByIdAndUpdate(
            faq1._id,
            { $set: { answer: 'A premium printing service for students.' } },
            { returnDocument: 'after' }
        );
        assert(faq1Updated.order === faq1Order, 'Updated FAQ must preserve its original rank/order');
        assert(faq1Updated.answer === 'A premium printing service for students.', 'Answer should be updated');

        // 4. Test soft delete
        console.log('--- Testing Soft Delete ---');
        await Faq.findByIdAndUpdate(faq2._id, { $set: { isDeleted: true } });
        const activeFaqsAfterDelete = await Faq.find({ isDeleted: false, isActive: true }).sort({ order: -1 }).lean();
        assert(activeFaqsAfterDelete.length === 2, 'Should only retrieve 2 active, non-deleted FAQs');
        assert(activeFaqsAfterDelete[0].question === 'Is COD available?', 'First remains COD');
        assert(activeFaqsAfterDelete[1].question === 'What is PrintCart24?', 'Second is PrintCart24 (faq2 was deleted)');

        // 5. Test Status Toggle (Inverting isActive)
        console.log('--- Testing Status Toggle ---');
        const faq3BeforeToggle = await Faq.findById(faq3._id);
        const initialStatus = faq3BeforeToggle.isActive;

        // Toggle (invert status)
        faq3BeforeToggle.isActive = !faq3BeforeToggle.isActive;
        await faq3BeforeToggle.save();
        assert(faq3BeforeToggle.isActive === !initialStatus, 'Status should be inverted');

        const activeFaqsAfterToggle = await Faq.find({ isDeleted: false, isActive: true }).sort({ order: -1 }).lean();
        assert(activeFaqsAfterToggle.length === 1, 'Only 1 FAQ should be active now');
        assert(activeFaqsAfterToggle[0].question === 'What is PrintCart24?', 'Remaining active FAQ should be FAQ 1');

        console.log('\n=====================================');
        console.log('🎉 ALL INTEGRATION TESTS PASSED!');
        console.log('=====================================\n');

    } catch (error) {
        console.error('❌ TEST FAILED:', error);
    } finally {
        await mongoose.disconnect();
        console.log('Disconnected from MongoDB.');
    }
};

runTests();

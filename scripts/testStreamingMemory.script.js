import { resolveDocumentPropertiesFromUrl } from '../services/documentProcessing.service.js';

const TEST_URL = 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf';

const formatMemory = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;

const runTest = async () => {
    console.log('--- Memory Test for Document Processing ---');
    
    const initialMemory = process.memoryUsage();
    console.log(`Initial Heap Used: ${formatMemory(initialMemory.heapUsed)}`);

    try {
        console.log(`Processing URL: ${TEST_URL}`);
        const result = await resolveDocumentPropertiesFromUrl(TEST_URL);
        console.log('Result:', result);
    } catch (err) {
        console.error('Error during processing:', err.message);
    }

    const finalMemory = process.memoryUsage();
    console.log(`Final Heap Used: ${formatMemory(finalMemory.heapUsed)}`);
    console.log(`Heap Difference: ${formatMemory(finalMemory.heapUsed - initialMemory.heapUsed)}`);
};

runTest();

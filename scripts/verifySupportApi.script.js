// scripts/verifySupportApi.script.js
import { getSupportDetails } from '#controllers/support';

const assert = (condition, message) => {
    if (!condition) {
        throw new Error(`Assertion Failed: ${message}`);
    }
    console.log(`[PASS] ${message}`);
};

const runTests = async () => {
    try {
        console.log('--- Testing getSupportDetails Controller ---');

        const mockReq = {};
        let responseStatus = null;
        let responseJson = null;

        const mockRes = {
            status: (code) => {
                responseStatus = code;
                return {
                    json: (data) => {
                        responseJson = data;
                        return data;
                    }
                };
            }
        };

        await getSupportDetails(mockReq, mockRes);

        assert(responseStatus === 200, 'HTTP Status should be 200');
        assert(responseJson !== null, 'Response body should not be null');
        assert(responseJson.status === true, 'Response status field should be true');
        assert(responseJson.data !== undefined, 'Response should contain data');
        assert(responseJson.data.whatsappNumber === '+919999999999', `WhatsApp number matches: ${responseJson.data.whatsappNumber}`);
        assert(responseJson.data.callNumber === '+919999999999', `Call number matches: ${responseJson.data.callNumber}`);
        assert(responseJson.data.email === 'support@printcart24.com', `Email matches: ${responseJson.data.email}`);

        console.log('\n=====================================');
        console.log('🎉 SUPPORT API VERIFICATION PASSED!');
        console.log('=====================================\n');
    } catch (error) {
        console.error('❌ TEST FAILED:', error);
        process.exit(1);
    }
};

runTests();

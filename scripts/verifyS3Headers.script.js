// scripts/verifyS3Headers.script.js
import { resolveDocumentPropertiesFromUrl } from '#services/documentProcessing';

(async () => {
    const url = 'https://appsinvo-stag-dev.s3.ap-south-1.amazonaws.com/PrintCart24/Cybersecurity_(2-page).docx';
    
    console.log('Fetching S3 URL headers via HEAD request...');
    try {
        const headRes = await fetch(url, { method: 'HEAD' });
        console.log('HEAD status:', headRes.status);
        console.log('HEAD headers:');
        for (const [key, value] of headRes.headers.entries()) {
            console.log(`  ${key}: ${value}`);
        }
    } catch (err) {
        console.error('HEAD error:', err.message);
    }

    console.log('\nFetching S3 URL headers via GET request...');
    try {
        const getRes = await fetch(url);
        console.log('GET status:', getRes.status);
        console.log('GET content-type:', getRes.headers.get('content-type'));
        console.log('GET content-length:', getRes.headers.get('content-length'));
    } catch (err) {
        console.error('GET error:', err.message);
    }

    console.log('\nRunning resolveDocumentPropertiesFromUrl...');
    try {
        const properties = await resolveDocumentPropertiesFromUrl(url);
        console.log('Resolved properties:', properties);
    } catch (err) {
        console.error('resolveDocumentPropertiesFromUrl error:', err.message);
    }
})();

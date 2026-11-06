// scripts/testMimeTypeInference.script.js
import { inferMimeType } from '#utils/fileMetadata';

const runTest = (title, input, expected) => {
    const result = inferMimeType(input);
    const pass = result === expected;
    console.log(`${pass ? '✅ PASS' : '❌ FAIL'} | ${title}`);
    console.log(`  Input: ${JSON.stringify(input)}`);
    console.log(`  Got: "${result}", Expected: "${expected}"`);
};

console.log('--- Testing MIME Type Inference Logic ---');

runTest(
    'DOCX file with generic S3 content-type',
    { extension: 'docx', fallbackMimeType: 'application/octet-stream' },
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
);

runTest(
    'PDF file with correct content-type',
    { extension: 'pdf', fallbackMimeType: 'application/pdf' },
    'application/pdf'
);

runTest(
    'PDF file with generic S3 content-type',
    { extension: 'pdf', fallbackMimeType: 'application/octet-stream' },
    'application/pdf'
);

runTest(
    'DOC file with generic content-type',
    { extension: 'doc', fallbackMimeType: 'application/octet-stream' },
    'application/msword'
);

runTest(
    'Image file with generic content-type',
    { extension: 'png', fallbackMimeType: 'binary/octet-stream' },
    'image/png'
);

runTest(
    'Unknown extension with generic fallback',
    { extension: 'abcde', fallbackMimeType: 'application/octet-stream' },
    'application/octet-stream'
);

runTest(
    'Specific fallback with no extension',
    { extension: '', fallbackMimeType: 'application/pdf' },
    'application/pdf'
);

/**
 * scripts/testUrlEncodingFull.script.js
 *
 * Comprehensive edge-case test suite for URL sanitization in the document
 * upload pipeline. Covers:
 *   1. The original double-encoding bug (user's reported filenames)
 *   2. Common special characters a user can put in a filename
 *   3. Unicode / emoji filenames
 *   4. Already-encoded vs. plain vs. double-encoded inputs
 *   5. Malformed / attack-vector URLs that must be rejected
 *   6. Downstream extractFileMetadataFromUrl correctness
 *
 * Run: node scripts/testUrlEncodingFull.script.js
 */

// ─── Implementation under test ────────────────────────────────────────────────

/**
 * THE FIX — mirrors the updated sanitizeUrl in
 * validations/printDocument.validation.js
 */
const ALLOWED_FILE_URL_PROTOCOLS = new Set(['https:', 'http:']);

const sanitizeUrl = (value) => {
    if (!value) return value;
    try {
        const parsed = new URL(value.trim());
        if (!ALLOWED_FILE_URL_PROTOCOLS.has(parsed.protocol)) return null;
        return parsed.toString();
    } catch {
        return null;
    }
};

/**
 * Mirrors extractFileMetadataFromUrl from utils/fileMetadata.util.js
 * (pure JS re-implementation — no imports needed for the test)
 */
const extractFileMetadataFromUrl = (fileUrl) => {
    const parsedUrl   = new URL(fileUrl);
    const pathname    = decodeURIComponent(parsedUrl.pathname || '');
    const segments    = pathname.split('/').filter(Boolean);
    const fileName    = segments[segments.length - 1] || '';
    const extension   = fileName.split('.').pop() || '';
    const isS3Path    = /^s3[.-]/i.test(parsedUrl.hostname);
    const storeSegs   = isS3Path ? segments.slice(1) : segments;

    return {
        originalFileName: fileName,
        fileExtension:    extension,
        storageKey:       storeSegs.join('/'),
    };
};

// ─── Test runner ──────────────────────────────────────────────────────────────

const BASE = 'https://s3.amazonaws.com/my-bucket/uploads/';

let passed  = 0;
let failed  = 0;
let skipped = 0;

const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red   = (s) => `\x1b[31m${s}\x1b[0m`;
const dim   = (s) => `\x1b[2m${s}\x1b[0m`;
const bold  = (s) => `\x1b[1m${s}\x1b[0m`;

const assert = (label, actual, expected) => {
    const ok   = actual === expected;
    const icon = ok ? green('✅') : red('❌');
    console.log(`  ${icon}  ${label}`);
    if (!ok) {
        console.log(`       ${dim('Expected:')} ${JSON.stringify(expected)}`);
        console.log(`       ${dim('Actual  :')} ${JSON.stringify(actual)}`);
        failed++;
    } else {
        passed++;
    }
};

const assertNull = (label, actual) => {
    const ok   = actual === null || actual === undefined;
    const icon = ok ? green('✅') : red('❌');
    console.log(`  ${icon}  ${label}`);
    if (!ok) {
        console.log(`       ${dim('Expected:')} null (rejected)`);
        console.log(`       ${dim('Actual  :')} ${JSON.stringify(actual)}`);
        failed++;
    } else {
        passed++;
    }
};

const section = (title) => {
    console.log(`\n${bold('── ' + title + ' ' + '─'.repeat(Math.max(0, 62 - title.length)))}\n`);
};

const describe = (label, fn) => {
    console.log(`  ${dim('📄')} ${label}`);
    fn();
};

// ─── Helper: build a full S3 URL from a raw filename ─────────────────────────
const url = (filename) => `${BASE}${filename}`;

// ─── Section 1: Original reported bug ────────────────────────────────────────
section('1. Original Reported Bug (acc%3D1%3Bdoc%3Dencoded=...)');

describe('User uploads a file with encoded = and ; chars — frontend sends already-encoded URL', () => {
    const FRONTEND_URL     = url('acc%3D1%3Bdoc%3Dencoded%3DAEDNq5fCIVkozLhL.pdf');
    const DOUBLE_ENCODED   = url('acc%253D1%253Bdoc%253Dencoded%253DAEDNq5fCIVkozLhL.pdf');

    const result = sanitizeUrl(FRONTEND_URL);

    assert('sanitizeUrl does NOT double-encode %3D → %253D', result, FRONTEND_URL);
    assert('result is NOT the double-encoded form', result !== DOUBLE_ENCODED, true);

    const meta = extractFileMetadataFromUrl(result);
    assert('extractFileMetadataFromUrl decodes filename correctly',
        meta.originalFileName, 'acc=1;doc=encoded=AEDNq5fCIVkozLhL.pdf');
    assert('fileExtension is pdf', meta.fileExtension, 'pdf');
});

// ─── Section 2: Plain (decoded) filenames ─────────────────────────────────────
section('2. Plain / Unencoded Special Character Filenames');

describe('Spaces in filename (raw)', () => {
    const input  = url('My Document File.pdf');
    const result = sanitizeUrl(input);
    // URL constructor encodes space → %20
    assert('space encoded to %20', result, url('My%20Document%20File.pdf'));
    const meta = extractFileMetadataFromUrl(result);
    assert('filename decoded back correctly', meta.originalFileName, 'My Document File.pdf');
});

describe('Parentheses in filename', () => {
    const input  = url('Report (Final).pdf');
    const result = sanitizeUrl(input);
    // ( and ) are valid path chars, URL constructor keeps them
    assert('parentheses preserved', result, url('Report%20(Final).pdf'));
    const meta = extractFileMetadataFromUrl(result);
    assert('filename decoded correctly', meta.originalFileName, 'Report (Final).pdf');
});

describe('Ampersand in filename', () => {
    const input  = url('Terms & Conditions.pdf');
    const result = sanitizeUrl(input);
    // & in path is kept as-is by URL constructor (reserved but valid in path)
    assert('sanitizeUrl returns a valid URL', typeof result, 'string');
    assert('result is parseable', (() => { try { new URL(result); return true; } catch { return false; } })(), true);
    const meta = extractFileMetadataFromUrl(result);
    assert('extension is pdf', meta.fileExtension, 'pdf');
});

describe('Hash (#) in filename — fragment separator', () => {
    // '#' starts URL fragment; URL constructor will strip the path after it.
    // The file should ideally be percent-encoded by S3 uploader before sending.
    // We test that sanitizeUrl does NOT crash and returns a string.
    const input  = url('file%23name.pdf');   // pre-encoded '#'
    const result = sanitizeUrl(input);
    assert('pre-encoded # (%23) is preserved', result, input);
    const meta = extractFileMetadataFromUrl(result);
    assert('filename with # decoded correctly', meta.originalFileName, 'file#name.pdf');
});

describe('Question mark (?) in filename — pre-encoded', () => {
    const input  = url('What%3Fis%3Fthis.pdf');  // ? → %3F
    const result = sanitizeUrl(input);
    assert('%3F preserved (no double-encode)', result, input);
    const meta = extractFileMetadataFromUrl(result);
    assert('filename decoded correctly', meta.originalFileName, 'What?is?this.pdf');
});

// ─── Section 3: Unicode / international filenames ─────────────────────────────
section('3. Unicode / International Character Filenames');

describe('Hindi filename (Devanagari script)', () => {
    // S3 SDK / frontend typically percent-encodes unicode
    const encoded = url('%E0%A4%A6%E0%A4%B8%E0%A5%8D%E0%A4%A4%E0%A4%BE%E0%A4%B5%E0%A5%87%E0%A4%9C.pdf');
    const result  = sanitizeUrl(encoded);
    assert('Hindi encoded filename preserved', result, encoded);
    const meta = extractFileMetadataFromUrl(result);
    assert('Hindi filename decoded correctly', meta.originalFileName, 'दस्तावेज.pdf');
});

describe('Chinese filename', () => {
    const encoded = url('%E6%96%87%E4%BB%B6.pdf');
    const result  = sanitizeUrl(encoded);
    assert('Chinese encoded filename preserved', result, encoded);
    const meta = extractFileMetadataFromUrl(result);
    assert('Chinese filename decoded correctly', meta.originalFileName, '文件.pdf');
});

describe('Emoji in filename (🎉)', () => {
    const encoded = url('%F0%9F%8E%89party.pdf');  // 🎉 → %F0%9F%8E%89
    const result  = sanitizeUrl(encoded);
    assert('emoji encoded filename preserved', result, encoded);
    const meta = extractFileMetadataFromUrl(result);
    assert('emoji filename decoded correctly', meta.originalFileName, '🎉party.pdf');
});

describe('Arabic filename', () => {
    const encoded = url('%D9%85%D9%84%D9%81.pdf');   // ملف.pdf
    const result  = sanitizeUrl(encoded);
    assert('Arabic encoded filename preserved', result, encoded);
    const meta = extractFileMetadataFromUrl(result);
    assert('Arabic filename decoded correctly', meta.originalFileName, 'ملف.pdf');
});

// ─── Section 4: Already-encoded vs double-encoded inputs ──────────────────────
section('4. Already-Encoded vs Double-Encoded Inputs');

describe('Already-encoded spaces (%20)', () => {
    const input  = url('my%20document.pdf');
    const result = sanitizeUrl(input);
    assert('%20 preserved (not double-encoded to %2520)', result, input);
});

describe('Already-encoded plus sign (%2B)', () => {
    const input  = url('file%2Bname.pdf');
    const result = sanitizeUrl(input);
    assert('%2B preserved', result, input);
    const meta = extractFileMetadataFromUrl(result);
    assert('filename decoded to file+name.pdf', meta.originalFileName, 'file+name.pdf');
});

describe('Double-encoded input (%253D — already corrupted)', () => {
    // If somehow a double-encoded URL arrives (e.g. old buggy data), sanitizeUrl
    // should NOT make it worse. The URL constructor treats %25 as encoded %
    // and re-serializes it as-is.
    const input  = url('acc%253D1.pdf');
    const result = sanitizeUrl(input);
    assert('double-encoded input not made worse (passed through as-is)', result, input);
});

describe('Idempotency — running sanitizeUrl twice gives same result', () => {
    const input   = url('acc%3D1%3Bdoc%3Dencoded%3DAEDNq5fCIVkozLhL.pdf');
    const once    = sanitizeUrl(input);
    const twice   = sanitizeUrl(once);
    assert('sanitizeUrl(sanitizeUrl(url)) === sanitizeUrl(url)', twice, once);
});

describe('Mixed encoded/unencoded — space + encoded equals sign', () => {
    const input  = url('Report%3D2024 Final.pdf');  // contains %3D and unencoded space
    const result = sanitizeUrl(input);
    // URL constructor encodes the space, leaves %3D as-is
    assert('space encoded, %3D preserved', result, url('Report%3D2024%20Final.pdf'));
    const meta = extractFileMetadataFromUrl(result);
    assert('filename decoded correctly', meta.originalFileName, 'Report=2024 Final.pdf');
});

// ─── Section 5: Query strings / S3 presigned URL params ───────────────────────
section('5. S3 Presigned URLs with Query Parameters');

describe('Presigned URL — query params preserved', () => {
    const presigned = 'https://s3.amazonaws.com/bucket/uploads/doc.pdf'
        + '?X-Amz-Algorithm=AWS4-HMAC-SHA256'
        + '&X-Amz-Credential=AKID%2F20240101%2Fus-east-1%2Fs3%2Faws4_request'
        + '&X-Amz-Expires=3600'
        + '&X-Amz-Signature=abc123';

    const result = sanitizeUrl(presigned);
    assert('presigned URL is returned as a valid string', typeof result, 'string');
    assert('presigned URL is parseable', (() => { try { new URL(result); return true; } catch { return false; } })(), true);
    assert('%2F in query param not double-encoded', result.includes('%252F'), false);
});

describe('Filename with encoded equals in presigned URL path', () => {
    const input  = 'https://s3.amazonaws.com/bucket/uploads/acc%3D1%3Bdoc%3Dfile.pdf'
        + '?X-Amz-Expires=3600';
    const result = sanitizeUrl(input);
    assert('%3D in path not double-encoded', result.includes('%253D'), false);
    assert('query param preserved', result.includes('X-Amz-Expires=3600'), true);
});

// ─── Section 6: Malformed / attack-vector URLs ───────────────────────────────
section('6. Malformed & Attack-Vector URLs (must be rejected)');

describe('Completely invalid string', () => {
    assertNull('non-URL string rejected', sanitizeUrl('not-a-url'));
});

describe('javascript: protocol', () => {
    assertNull('javascript: URL rejected', sanitizeUrl('javascript:alert(1)'));
});

describe('data: protocol', () => {
    assertNull('data: URL rejected', sanitizeUrl('data:text/html,<h1>XSS</h1>'));
});

describe('file: protocol', () => {
    // file: is now also rejected by the protocol allowlist inside sanitizeUrl itself.
    assertNull('file: URL rejected by protocol allowlist', sanitizeUrl('file:///etc/passwd'));
});

describe('Empty string', () => {
    // value is falsy → sanitizeUrl returns value (empty string)
    // Joi .required() then rejects it
    assert('empty string returned as-is (Joi required rejects downstream)',
        sanitizeUrl(''), '');
});

describe('URL with path traversal attempt', () => {
    const input  = 'https://s3.amazonaws.com/bucket/../../../etc/passwd';
    const result = sanitizeUrl(input);
    // URL constructor resolves the path traversal, normalising it
    assert('path traversal resolved/normalised', result, 'https://s3.amazonaws.com/etc/passwd');
});

describe('Null byte injection (%00)', () => {
    const input  = url('file%00name.pdf');
    const result = sanitizeUrl(input);
    // URL constructor may throw or strip null bytes
    assert('null byte input produces null or safe string',
        result === null || (typeof result === 'string' && !result.includes('\x00')), true);
});

// ─── Section 7: File type / extension edge cases ──────────────────────────────
section('7. File Type & Extension Edge Cases');

const extCases = [
    ['PDF uppercase extension',  'MY_REPORT.PDF',     'PDF'],
    ['DOCX file',                'thesis.docx',       'docx'],
    ['DOC file',                 'letter.doc',        'doc'],
    ['JPEG image',               'photo.jpeg',        'jpeg'],
    ['PNG image',                'banner.png',        'png'],
    ['File with dots in name',   'v2.1.final.pdf',    'pdf'],
    ['No extension',             'README',            'README'],
];

for (const [label, filename, expectedExt] of extCases) {
    describe(label, () => {
        const input  = url(encodeURIComponent(filename));
        const result = sanitizeUrl(input);
        assert('sanitizeUrl returns a string', typeof result, 'string');
        const meta = extractFileMetadataFromUrl(result);
        assert(`extension extracted: "${expectedExt}"`, meta.fileExtension, expectedExt);
        assert(`filename decoded to "${filename}"`, meta.originalFileName, filename);
    });
}

// ─── Section 8: Trailing whitespace / padding ────────────────────────────────
section('8. Whitespace / Padding');

describe('Leading and trailing spaces trimmed', () => {
    const input  = `  ${url('document.pdf')}  `;
    const result = sanitizeUrl(input);
    assert('whitespace trimmed', result, url('document.pdf'));
});

describe('Tab characters in URL string', () => {
    const input  = `\t${url('document.pdf')}\t`;
    const result = sanitizeUrl(input);
    // trim() removes tabs; URL constructor then parses cleanly
    assert('tabs trimmed and URL parsed', result, url('document.pdf'));
});

// ─── Summary ──────────────────────────────────────────────────────────────────
const total = passed + failed;
console.log(`\n${'═'.repeat(66)}`);
console.log(bold(` Results: ${green(passed + ' passed')}, ${failed > 0 ? red(failed + ' failed') : failed + ' failed'} / ${total} total`));
console.log(`${'═'.repeat(66)}\n`);

if (failed > 0) {
    console.log(red('⚠️  Some assertions failed. Review the output above.\n'));
    process.exit(1);
} else {
    console.log(green('✅  All assertions passed. sanitizeUrl is safe for production.\n'));
}

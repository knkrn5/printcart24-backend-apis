/**
 * scripts/testUrlEncoding.script.js
 *
 * Reproduces and verifies the double URL-encoding bug in the document processing
 * pipeline introduced by the `sanitizeUrl` custom Joi validator.
 *
 * Run: node scripts/testUrlEncoding.script.js
 *
 * Key insight:
 *   - %3D ('%' + '3D') encodes '='  — a RESERVED char.
 *   - encodeURI() encodes '%' itself to '%25', turning %3D → %253D (double-encode).
 *   - decodeURI() does NOT decode reserved-char sequences like %3D or %3B,
 *     so `decodeURI + encodeURI` does NOT fix the double-encoding for reserved chars.
 *   - The correct approach: parse the URL through the WHATWG URL constructor,
 *     which normalises encoding without double-encoding already-encoded sequences.
 */

// ─── Implementation mirrors ───────────────────────────────────────────────────

/** Exact copy of sanitizeUrl from validations/printDocument.validation.js */
const sanitizeUrl_CURRENT = (value) => {
    if (!value) return value;
    try {
        const cleaned = encodeURI(value.trim());
        return cleaned;
    } catch {
        return null;
    }
};

/**
 * Proposed FIXED sanitizeUrl.
 * Uses the WHATWG URL constructor to parse and re-serialize the URL.
 * This safely normalises the URL without double-encoding already-encoded
 * percent-sequences, including reserved characters like %3D (%3B, etc.).
 */
const sanitizeUrl_FIXED = (value) => {
    if (!value) return value;
    try {
        return new URL(value.trim()).toString();
    } catch {
        return null;
    }
};

/** Mirrors extractFileMetadataFromUrl from utils/fileMetadata.util.js */
const extractFileMetadataFromUrl = (fileUrl) => {
    const parsedUrl = new URL(fileUrl);
    const pathname = decodeURIComponent(parsedUrl.pathname || '');
    const segments = pathname.split('/').filter(Boolean);
    const originalFileName = segments[segments.length - 1] || '';
    const fileExtension = originalFileName.split('.').pop() || '';
    return { originalFileName, fileExtension };
};

// ─── Test Runner ──────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

const assert = (label, actual, expected) => {
    const ok = actual === expected;
    const icon = ok ? '✅' : '❌';
    console.log(`${icon}  ${label}`);
    if (!ok) {
        console.log(`     Expected : ${JSON.stringify(expected)}`);
        console.log(`     Actual   : ${JSON.stringify(actual)}`);
        failed++;
    } else {
        passed++;
    }
};

// ─── Test Data ────────────────────────────────────────────────────────────────

// What the frontend sends — filename is already percent-encoded in an S3-style URL.
// %3D = '=',  %3B = ';'
const BASE_URL          = 'https://s3.amazonaws.com/my-bucket/uploads/';
const ENCODED_FILENAME  = 'acc%3D1%3Bdoc%3Dencoded%3DAEDNq5fCIVkozLhL.pdf';
const DECODED_FILENAME  = 'acc=1;doc=encoded=AEDNq5fCIVkozLhL.pdf';
const FRONTEND_URL      = `${BASE_URL}${ENCODED_FILENAME}`;

console.log('\n══════════════════════════════════════════════════════════════════');
console.log(' URL Encoding Bug Verification — PrintCart24');
console.log('══════════════════════════════════════════════════════════════════\n');
console.log(`Frontend URL  : ${FRONTEND_URL}`);
console.log(`Decoded fname : ${DECODED_FILENAME}\n`);

// ─── Section 1: Reproduce the Bug ────────────────────────────────────────────
console.log('── Section 1: sanitizeUrl (CURRENT — buggy) ─────────────────────\n');

const buggyResult = sanitizeUrl_CURRENT(FRONTEND_URL);
// encodeURI turns '%' (U+0025) → '%25', so '%3D' → '%253D'
const DOUBLE_ENCODED_FILENAME = 'acc%253D1%253Bdoc%253Dencoded%253DAEDNq5fCIVkozLhL.pdf';
const EXPECTED_BUGGY_URL      = `${BASE_URL}${DOUBLE_ENCODED_FILENAME}`;

console.log(`Input   : ${FRONTEND_URL}`);
console.log(`Output  : ${buggyResult}\n`);

assert(
    'BUG: sanitizeUrl double-encodes % → %25  (e.g. %3D → %253D)',
    buggyResult,
    EXPECTED_BUGGY_URL,
);
assert(
    'BUG: output URL differs from the original frontend URL',
    buggyResult !== FRONTEND_URL,
    true,
);

// ─── Section 2: Proposed Fix ─────────────────────────────────────────────────
console.log('\n── Section 2: sanitizeUrl (FIXED — URL constructor) ──────────────\n');

const fixedResult = sanitizeUrl_FIXED(FRONTEND_URL);
console.log(`Input   : ${FRONTEND_URL}`);
console.log(`Output  : ${fixedResult}\n`);

assert(
    'FIX: URL constructor preserves already-encoded URL unchanged',
    fixedResult,
    FRONTEND_URL,
);

// Idempotency check
const fixedResultTwice = sanitizeUrl_FIXED(fixedResult);
assert(
    'FIX: idempotent — running sanitizeUrl twice gives the same result',
    fixedResultTwice,
    FRONTEND_URL,
);

// Works on a plain (decoded) URL too — URL constructor leaves '=' and ';' as-is
// in path segments (they are valid path chars per RFC 3986), so the URL is
// returned unchanged. This is correct: sanitizeUrl's job is to prevent double-encoding,
// not to force-encode every possible special character.
const rawUrl       = `${BASE_URL}${DECODED_FILENAME}`;
const fixedFromRaw = sanitizeUrl_FIXED(rawUrl);
assert(
    'FIX: raw (decoded) URL passes through unchanged — no double-encoding introduced',
    fixedFromRaw,
    rawUrl,
);
assert(
    'FIX: raw URL is parseable by new URL() (no throw)',
    typeof fixedFromRaw,
    'string',
);

// ─── Section 3: Downstream impact on extractFileMetadataFromUrl ──────────────
console.log('\n── Section 3: Downstream — extractFileMetadataFromUrl ────────────\n');

// With the BUGGY URL
try {
    const metaBuggy = extractFileMetadataFromUrl(buggyResult);
    console.log(`Buggy filename extracted  : "${metaBuggy.originalFileName}"`);
    // After one decodeURIComponent pass: %253D → %3D (still percent-encoded, not '=')
    assert(
        'Buggy URL: filename still contains %3D (not fully decoded)',
        metaBuggy.originalFileName.includes('%3D'),
        true,
    );
    assert(
        'Buggy URL: filename does NOT match the intended decoded filename',
        metaBuggy.originalFileName === DECODED_FILENAME,
        false,
    );
} catch (err) {
    console.log(`❌  extractFileMetadataFromUrl threw on buggy URL: ${err.message}`);
    failed++;
}

// With the FIXED URL
try {
    const metaFixed = extractFileMetadataFromUrl(fixedResult);
    console.log(`Fixed filename extracted  : "${metaFixed.originalFileName}"`);
    assert(
        'Fixed URL: filename is fully decoded to its original value',
        metaFixed.originalFileName,
        DECODED_FILENAME,
    );
} catch (err) {
    console.log(`❌  extractFileMetadataFromUrl threw on fixed URL: ${err.message}`);
    failed++;
}

// ─── Section 4: Why decodeURI won't fix this ─────────────────────────────────
console.log('\n── Section 4: Why decodeURI + encodeURI is NOT a valid fix ──────\n');

// decodeURI deliberately does NOT decode reserved chars (%3D, %3B, %2F, etc.)
// See ECMA-262 §19.2.6.3 "Decode" — the set excludes reserved chars.
const decodeUriAttempt = encodeURI(decodeURI(FRONTEND_URL));
console.log(`decodeURI(url) =`, decodeURI(FRONTEND_URL));
console.log(`encodeURI(decodeURI(url)) =`, decodeUriAttempt);
assert(
    'decodeURI + encodeURI still double-encodes reserved chars like %3D',
    decodeUriAttempt,
    EXPECTED_BUGGY_URL,   // still buggy!
);

// ─── Section 5: Encoding mechanics reference ─────────────────────────────────
console.log('\n── Section 5: Encoding Mechanics Reference ───────────────────────\n');
console.log('  encodeURI("%")              →', encodeURI('%'));
console.log('  encodeURI("%3D")            →', encodeURI('%3D'));         // BUG
console.log('  decodeURI("%3D")            →', decodeURI('%3D'));         // %3D (unchanged — reserved)
console.log('  decodeURIComponent("%3D")   →', decodeURIComponent('%3D')); // = (decodes reserved)
console.log('  decodeURI("%253D")          →', decodeURI('%253D'));        // %3D (one pass)
console.log('  new URL(url).toString()     →', new URL(FRONTEND_URL).toString()); // ✅ unchanged

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════════════════════════════');
console.log(` Results: ${passed} passed, ${failed} failed`);
console.log('══════════════════════════════════════════════════════════════════\n');

if (failed > 0) {
    console.log('⚠️  Some assertions failed — review the output above.\n');
    process.exit(1);
} else {
    console.log('✅  All assertions passed. Bug confirmed and fix verified.\n');
}

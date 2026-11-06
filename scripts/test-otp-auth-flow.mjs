#!/usr/bin/env node
/**
 * scripts/test-otp-auth-flow.mjs
 *
 * Tests the send-otp / verify-otp account-status guard flow.
 *
 * Usage:
 *   node scripts/test-otp-auth-flow.mjs [BASE_URL]
 *
 * Env vars (optional, read from process.env):
 *   BASE_URL          - defaults to http://localhost:5100/api
 *   TEST_PHONE        - a real/unused phone number for new-user test (digits only, no country code)
 *   TEST_COUNTRY_CODE - default +91
 *   DELETED_PHONE     - phone of a user whose DB record has isDeleted:true
 *   INACTIVE_PHONE    - phone of a user whose DB record has isActive:false
 *   OTP_BYPASS_CODE   - bypass OTP (set in your .env for dev)
 *
 * Colour codes: ✅ PASS  ❌ FAIL  ⚠️  SKIP
 */

import http from 'http';
import https from 'https';

// ─── Config ─────────────────────────────────────────────────────────────────
const BASE_URL    = process.argv[2] || process.env.BASE_URL || 'http://localhost:5100/api';
const CC          = process.env.TEST_COUNTRY_CODE  || '+91';
const NEW_PHONE   = process.env.TEST_PHONE         || null;   // set to a fresh number
const DEL_PHONE   = process.env.DELETED_PHONE      || null;   // isDeleted:true
const INA_PHONE   = process.env.INACTIVE_PHONE     || null;   // isActive:false
const BYPASS_CODE = process.env.OTP_BYPASS_CODE    || null;

// ─── HTTP helper ─────────────────────────────────────────────────────────────
function request(method, path, body) {
    return new Promise((resolve, reject) => {
        const url     = new URL(BASE_URL + path);
        const driver  = url.protocol === 'https:' ? https : http;
        const payload = JSON.stringify(body);

        const req = driver.request(
            {
                hostname: url.hostname,
                port:     url.port || (url.protocol === 'https:' ? 443 : 80),
                path:     url.pathname + url.search,
                method,
                headers: {
                    'Content-Type':   'application/json',
                    'Content-Length': Buffer.byteLength(payload),
                },
            },
            (res) => {
                let data = '';
                res.on('data', (c) => (data += c));
                res.on('end', () => {
                    try {
                        resolve({ status: res.statusCode, body: JSON.parse(data) });
                    } catch {
                        resolve({ status: res.statusCode, body: data });
                    }
                });
            },
        );
        req.on('error', reject);
        req.write(payload);
        req.end();
    });
}

// ─── Assertion helper ────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function assert(label, condition, { status, body } = {}) {
    if (condition) {
        console.log(`  ✅  ${label}`);
        passed++;
    } else {
        console.log(`  ❌  ${label}`);
        if (status !== undefined) console.log(`      status: ${status}`);
        if (body    !== undefined) console.log(`      body  :`, JSON.stringify(body));
        failed++;
    }
}

function skip(label, reason) {
    console.log(`  ⚠️   SKIP — ${label} (${reason})`);
}

function section(title) {
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`📋  ${title}`);
    console.log('─'.repeat(60));
}

// ─── Tests ───────────────────────────────────────────────────────────────────

async function testNewUser() {
    section('Scenario D — New / active user (full login flow)');

    if (!NEW_PHONE) {
        skip('send-otp', 'TEST_PHONE not set — set env var to a fresh phone number');
        skip('verify-otp', 'TEST_PHONE not set');
        return;
    }

    if (!BYPASS_CODE) {
        skip('verify-otp', 'OTP_BYPASS_CODE not set — cannot auto-verify; check server logs for OTP');
    }

    // 1. send-otp
    console.log(`\n  -> POST /auth/send-otp  phone=${NEW_PHONE}`);
    const send = await request('POST', '/auth/send-otp', { countryCode: CC, phone: NEW_PHONE });
    console.log(`     status: ${send.status}  body: ${JSON.stringify(send.body)}`);
    assert('send-otp returns 200',         send.status === 200);
    assert('message is "OTP sent successfully"', send.body?.message === 'OTP sent successfully');

    if (!BYPASS_CODE) return;

    // 2. verify-otp  (using bypass code)
    console.log(`\n  -> POST /auth/verify-otp  phone=${NEW_PHONE}  otp=${BYPASS_CODE}`);
    const verify = await request('POST', '/auth/verify-otp', {
        countryCode: CC,
        phone:       NEW_PHONE,
        otp:         String(BYPASS_CODE),
    });
    console.log(`     status: ${verify.status}  body: ${JSON.stringify(verify.body)}`);
    assert('verify-otp returns 200',        verify.status === 200);
    assert('response contains token',       !!verify.body?.data?.token || !!verify.body?.token);
}

async function testDeletedUser() {
    section('Scenario A — Deleted account  ->  blocked at send-otp');

    if (!DEL_PHONE) {
        skip('send-otp', 'DELETED_PHONE not set — set env var to a phone with isDeleted:true');
        return;
    }

    // 1. send-otp must be blocked
    console.log(`\n  -> POST /auth/send-otp  phone=${DEL_PHONE}`);
    const send = await request('POST', '/auth/send-otp', { countryCode: CC, phone: DEL_PHONE });
    console.log(`     status: ${send.status}  body: ${JSON.stringify(send.body)}`);
    assert('send-otp returns 410 Gone',     send.status === 410);
    assert('message mentions account deleted',
        send.body?.message?.toLowerCase().includes('deleted'));

    // 2. verify-otp direct call — safety net
    section('Scenario B — Deleted account  ->  direct verify-otp call (safety net)');
    console.log(`\n  -> POST /auth/verify-otp  phone=${DEL_PHONE}  otp=000000`);
    const verify = await request('POST', '/auth/verify-otp', {
        countryCode: CC,
        phone:       DEL_PHONE,
        otp:         BYPASS_CODE || '000000',
    });
    console.log(`     status: ${verify.status}  body: ${JSON.stringify(verify.body)}`);
    assert('verify-otp returns 410 Gone (safety net)',  verify.status === 410);
    assert('message mentions account deleted',
        verify.body?.message?.toLowerCase().includes('deleted'));
}

async function testInactiveUser() {
    section('Scenario C — Inactive account  ->  blocked at send-otp');

    if (!INA_PHONE) {
        skip('send-otp', 'INACTIVE_PHONE not set — set env var to a phone with isActive:false');
        return;
    }

    console.log(`\n  -> POST /auth/send-otp  phone=${INA_PHONE}`);
    const send = await request('POST', '/auth/send-otp', { countryCode: CC, phone: INA_PHONE });
    console.log(`     status: ${send.status}  body: ${JSON.stringify(send.body)}`);
    assert('send-otp returns 403 Forbidden', send.status === 403);
    assert('message mentions inactive',
        send.body?.message?.toLowerCase().includes('inactive'));
}

// ─── Run ─────────────────────────────────────────────────────────────────────
(async () => {
    console.log(`\n🚀  OTP Auth Flow Test`);
    console.log(`    BASE_URL : ${BASE_URL}`);
    console.log(`    CC       : ${CC}`);
    console.log(`    NEW_PHONE: ${NEW_PHONE   ?? '(not set)'}`);
    console.log(`    DEL_PHONE: ${DEL_PHONE   ?? '(not set)'}`);
    console.log(`    INA_PHONE: ${INA_PHONE   ?? '(not set)'}`);
    console.log(`    BYPASS   : ${BYPASS_CODE ?? '(not set)'}`);

    await testNewUser();
    await testDeletedUser();
    await testInactiveUser();

    console.log(`\n${'='.repeat(60)}`);
    console.log(`  Results: ${passed} passed, ${failed} failed`);
    console.log('='.repeat(60));

    process.exit(failed > 0 ? 1 : 0);
})();

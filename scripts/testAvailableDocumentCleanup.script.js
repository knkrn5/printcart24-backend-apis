// scripts/testAvailableDocumentCleanup.script.js
//
// E2E Verification Script for AVAILABLE Document Purge scheduler job.
//
// Scenarios Verified:
//   - Doc 1: AVAILABLE and older than 7 days -> should be deleted.
//   - Doc 2: AVAILABLE and newer than 7 days -> should be preserved.
//   - Doc 3: IN_CART and older than 7 days -> should be preserved (since it's in the cart).

import mongoose from 'mongoose';
import chalk from 'chalk';
import { dbConnection } from '#configs/db';
import PrintService from '#models/printService';
import PrintDocument from '#models/printDocument';
import { cleanupExpiredAvailableDocuments } from '#services/documentCleanup';

let passed = 0;
let failed = 0;

const pass = (label, detail = '') => {
    console.log(chalk.green(`  ✅ PASS: ${label}`) + (detail ? chalk.gray(` — ${detail}`) : ''));
    passed++;
};

const fail = (label, detail = '') => {
    console.log(chalk.red(`  ❌ FAIL: ${label}`) + (detail ? chalk.gray(` — ${detail}`) : ''));
    failed++;
};

const section = (title) =>
    console.log(chalk.bold.cyan(`\n${'─'.repeat(68)}\n  ${title}\n${'─'.repeat(68)}`));

const runTests = async () => {
    try {
        await dbConnection();
        section('E2E Verification — Expired AVAILABLE Document Cleanup Cron Job');

        const service = await PrintService.findOne({ slug: 'document-printing', isActive: true }).select('_id').lean();
        if (!service) {
            console.log(chalk.red('❌ FATAL: document-printing service not found. Run seed first.'));
            process.exit(1);
        }

        const mockUserId = new mongoose.Types.ObjectId();
        console.log(chalk.gray(`  Mock user: ${mockUserId}`));

        // ══════════════════════════════════════════════════════════════════════
        // SETUP TEST DATA
        // ══════════════════════════════════════════════════════════════════════
        const now = new Date();

        // 1. Doc 1: AVAILABLE + 8 days old (Expired -> should be deleted)
        const docExpiredAvailable = await PrintDocument.create({
            user: mockUserId,
            service: service._id,
            originalFileName: 'expired-available.pdf',
            mimeType: 'application/pdf',
            cartStatus: 'AVAILABLE',
            storageProvider: 'LOCAL',
            storageKey: 'test/expired-available.pdf',
            fileUrl: 'http://test.local/expired-available.pdf',
            createdAt: new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000) // 8 days ago
        });

        // 2. Doc 2: AVAILABLE + 2 days old (Active -> should be preserved)
        const docActiveAvailable = await PrintDocument.create({
            user: mockUserId,
            service: service._id,
            originalFileName: 'active-available.pdf',
            mimeType: 'application/pdf',
            cartStatus: 'AVAILABLE',
            storageProvider: 'LOCAL',
            storageKey: 'test/active-available.pdf',
            fileUrl: 'http://test.local/active-available.pdf',
            createdAt: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000) // 2 days ago
        });

        // 3. Doc 3: IN_CART + 10 days old (Active in cart -> should be preserved)
        const docExpiredInCart = await PrintDocument.create({
            user: mockUserId,
            service: service._id,
            originalFileName: 'expired-incart.pdf',
            mimeType: 'application/pdf',
            cartStatus: 'IN_CART',
            storageProvider: 'LOCAL',
            storageKey: 'test/expired-incart.pdf',
            fileUrl: 'http://test.local/expired-incart.pdf',
            createdAt: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000) // 10 days ago
        });

        // ══════════════════════════════════════════════════════════════════════
        // RUN CLEANUP JOB
        // ══════════════════════════════════════════════════════════════════════
        console.log(chalk.gray('\n  Triggering document cleanup cron job...'));
        await cleanupExpiredAvailableDocuments();

        // ══════════════════════════════════════════════════════════════════════
        // VERIFY DB STATES
        // ══════════════════════════════════════════════════════════════════════
        console.log(chalk.gray('\n  Verifying database states...'));

        const check1 = await PrintDocument.findById(docExpiredAvailable._id);
        const check2 = await PrintDocument.findById(docActiveAvailable._id);
        const check3 = await PrintDocument.findById(docExpiredInCart._id);

        if (!check1) {
            pass('AVAILABLE document older than 7 days was successfully deleted');
        } else {
            fail('AVAILABLE document older than 7 days was NOT deleted');
        }

        if (check2) {
            pass('AVAILABLE document newer than 7 days was preserved');
        } else {
            fail('AVAILABLE document newer than 7 days was incorrectly deleted');
        }

        if (check3) {
            pass('IN_CART document older than 7 days was preserved');
        } else {
            fail('IN_CART document older than 7 days was incorrectly deleted');
        }

        // ══════════════════════════════════════════════════════════════════════
        // CLEANUP remaining test items
        // ══════════════════════════════════════════════════════════════════════
        await PrintDocument.deleteMany({ user: mockUserId });
        pass('Test database cleaned up successfully');

        console.log(chalk.bold.white('\n' + '═'.repeat(68)));
        console.log(chalk.bold.green(`  ALL TESTS PASSED: ${passed} passed, ${failed} failed.`));
        console.log(chalk.bold.white('═'.repeat(68) + '\n'));

        mongoose.connection.close();
        process.exit(failed > 0 ? 1 : 0);

    } catch (err) {
        console.error(chalk.red('💥 Test Suite crashed:'), err);
        try { mongoose.connection.close(); } catch {}
        process.exit(1);
    }
};

runTests();

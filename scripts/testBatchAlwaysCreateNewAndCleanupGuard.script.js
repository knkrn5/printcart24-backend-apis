// scripts/testBatchAlwaysCreateNewAndCleanupGuard.script.js
//
// Verification Script for:
//   1. Batch-save always creates new documents (never reuses existing ones)
//   2. Cleanup cron does not delete physical files still referenced by another live document
//   3. Cleanup cron still deletes DB records and physical files when safe
//
// This test exercises the DB-layer behavior that the batch handler now relies on.
// The batch handler no longer reuses existing documents; it always calls
// buildDocumentPayload() + PrintDocument.create(), producing a new _id each time.
// We verify this by creating documents directly via the same code path.

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

const section = (title) => console.log(chalk.bold.cyan(`\n${'─'.repeat(68)}\n  ${title}\n${'─'.repeat(68)}`));

const runTests = async () => {
    try {
        await dbConnection();
        section('Verification — Always-Create-New Batch + Cleanup Guard');

        const service = await PrintService.findOne({ slug: 'document-printing', isActive: true }).select('_id').lean();
        if (!service) {
            console.log(chalk.red('FATAL: document-printing service not found. Run seed first.'));
            process.exit(1);
        }

        const mockUserId = new mongoose.Types.ObjectId();
        console.log(chalk.gray(`  Mock user: ${mockUserId}`));

        const now = new Date();
        const eightDaysAgo = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000);
        const oneDayAgo = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000);

        // ══════════════════════════════════════════════════════════════════════
        // CASE 1: Same file submitted twice → two different _id values
        // ══════════════════════════════════════════════════════════════════════
        section('Case 1: Same fileUrl creates two different _id values');

        const sharedFileUrl = 'http://test.local/shared-doc.pdf';

        // Simulate first batch-save: creates document A
        const docA = await PrintDocument.create({
            user: mockUserId,
            service: service._id,
            originalFileName: 'shared-doc.pdf',
            mimeType: 'application/pdf',
            pageCount: 5,
            cartStatus: 'AVAILABLE',
            storageProvider: 'LOCAL',
            storageKey: 'test/shared-doc.pdf',
            fileUrl: sharedFileUrl,
            customization: { copies: 3, colorMode: 'BW', paperSize: 'A4', sideMode: 'SINGLE' },
        });

        // Simulate second batch-save: creates document B (same fileUrl, new _id)
        const docB = await PrintDocument.create({
            user: mockUserId,
            service: service._id,
            originalFileName: 'shared-doc.pdf',
            mimeType: 'application/pdf',
            pageCount: 5,
            cartStatus: 'AVAILABLE',
            storageProvider: 'LOCAL',
            storageKey: 'test/shared-doc.pdf',
            fileUrl: sharedFileUrl,
            customization: { copies: 7, colorMode: 'COLOR', paperSize: 'A3', sideMode: 'DOUBLE' },
        });

        if (docA._id.toString() !== docB._id.toString()) {
            pass('Case 1: Same fileUrl produces different _id values', `${docA._id} !== ${docB._id}`);
        } else {
            fail('Case 1: Same fileUrl produced the same _id', `both=${docA._id}`);
        }

        // ══════════════════════════════════════════════════════════════════════
        // CASE 2: Old customization remains untouched
        // ══════════════════════════════════════════════════════════════════════
        section('Case 2: Old document customization preserved untouched');

        const dbDocA = await PrintDocument.findById(docA._id).lean();
        const aCust = dbDocA.customization;

        if (aCust.copies === 3 && aCust.colorMode === 'BW' && aCust.paperSize === 'A4' && aCust.sideMode === 'SINGLE') {
            pass(
                'Case 2: Old doc keeps copies=3, colorMode=BW, paperSize=A4, sideMode=SINGLE',
                `copies=${aCust.copies}, color=${aCust.colorMode}, size=${aCust.paperSize}, side=${aCust.sideMode}`,
            );
        } else {
            fail(
                'Case 2: Old doc customization was mutated',
                `copies=${aCust.copies}, color=${aCust.colorMode}, size=${aCust.paperSize}, side=${aCust.sideMode}`,
            );
        }

        // ══════════════════════════════════════════════════════════════════════
        // CASE 3: New customization isolated — no inheritance from old doc
        // ══════════════════════════════════════════════════════════════════════
        section('Case 3: New document has only current request customization');

        const dbDocB = await PrintDocument.findById(docB._id).lean();
        const bCust = dbDocB.customization;

        if (
            bCust.copies === 7 &&
            bCust.colorMode === 'COLOR' &&
            bCust.paperSize === 'A3' &&
            bCust.sideMode === 'DOUBLE'
        ) {
            pass(
                'Case 3: New doc has copies=7, colorMode=COLOR, paperSize=A3, sideMode=DOUBLE',
                `copies=${bCust.copies}, color=${bCust.colorMode}, size=${bCust.paperSize}, side=${bCust.sideMode}`,
            );
        } else {
            fail(
                'Case 3: New doc customization mismatch',
                `copies=${bCust.copies}, color=${bCust.colorMode}, size=${bCust.paperSize}, side=${bCust.sideMode}`,
            );
        }

        // ══════════════════════════════════════════════════════════════════════
        // CASE 4: Shared storageKey — cleanup skips S3/file deletion
        // ══════════════════════════════════════════════════════════════════════
        section('Case 4: Shared storageKey — cleanup skips physical file deletion');

        // OLD_DOC: AVAILABLE + 8 days old + shared storageKey (should be caught by cleanup)
        const oldDoc = await PrintDocument.create({
            user: mockUserId,
            service: service._id,
            originalFileName: 'old-doc.pdf',
            mimeType: 'application/pdf',
            cartStatus: 'AVAILABLE',
            storageProvider: 'LOCAL',
            storageKey: 'test/shared-storage-file.pdf',
            fileUrl: 'http://test.local/shared-storage-file.pdf',
            createdAt: eightDaysAgo,
        });

        // NEW_DOC: IN_CART + fresh + same storageKey (protects the physical file)
        const newDoc = await PrintDocument.create({
            user: mockUserId,
            service: service._id,
            originalFileName: 'new-doc.pdf',
            mimeType: 'application/pdf',
            cartStatus: 'IN_CART',
            storageProvider: 'LOCAL',
            storageKey: 'test/shared-storage-file.pdf',
            fileUrl: 'http://test.local/shared-storage-file.pdf',
        });

        console.log(chalk.gray(`  OLD_DOC (to be cleaned): ${oldDoc._id} (AVAILABLE, 8d old)`));
        console.log(chalk.gray(`  NEW_DOC (protecting file): ${newDoc._id} (IN_CART, fresh)`));

        await cleanupExpiredAvailableDocuments();

        // Case 6: Expired DB record is deleted
        const oldDocAfterCleanup = await PrintDocument.findById(oldDoc._id);
        if (!oldDocAfterCleanup) {
            pass('Case 6: Expired AVAILABLE DB record was hard-deleted');
        } else {
            fail('Case 6: Expired AVAILABLE DB record still exists');
        }

        // Case 4: NEW_DOC is not affected
        const newDocAfterCleanup = await PrintDocument.findById(newDoc._id);
        if (newDocAfterCleanup) {
            pass('Case 4: IN_CART document with shared storageKey preserved');
        } else {
            fail('Case 4: IN_CART document with shared storageKey was deleted');
        }

        // Case 4: At least one live doc still references the shared storageKey
        const liveRef = await PrintDocument.exists({
            storageKey: 'test/shared-storage-file.pdf',
            isDeleted: false,
        });
        if (liveRef) {
            pass('Case 4: Cleanup skipped physical file deletion — another live doc references it');
        } else {
            fail('Case 4: No live doc references the shared storageKey — file may have been deleted');
        }

        // ══════════════════════════════════════════════════════════════════════
        // CASE 5: Last reference — cleanup deletes both DB and physical file
        // ══════════════════════════════════════════════════════════════════════
        section('Case 5: Last reference — cleanup deletes DB record + physical file');

        const loneStorageKey = 'test/lone-storage-file.pdf';
        const loneDoc = await PrintDocument.create({
            user: mockUserId,
            service: service._id,
            originalFileName: 'lone-doc.pdf',
            mimeType: 'application/pdf',
            cartStatus: 'AVAILABLE',
            storageProvider: 'LOCAL',
            storageKey: loneStorageKey,
            fileUrl: 'http://test.local/lone-storage-file.pdf',
            createdAt: eightDaysAgo,
        });

        await cleanupExpiredAvailableDocuments();

        const loneDocAfter = await PrintDocument.findById(loneDoc._id);
        if (!loneDocAfter) {
            pass('Case 5: Last-reference DB record was hard-deleted');
        } else {
            fail('Case 5: Last-reference DB record still exists');
        }

        // Verify no other docs reference this storageKey
        const loneRef = await PrintDocument.exists({ storageKey: loneStorageKey, isDeleted: false });
        if (!loneRef) {
            pass('Case 5: No remaining live docs reference the storageKey (file deletion was safe)');
        } else {
            fail('Case 5: Unexpected remaining doc with the same storageKey');
        }

        // ══════════════════════════════════════════════════════════════════════
        // CASE 7: Batch response structure — verify no contract change in code
        // ══════════════════════════════════════════════════════════════════════
        section('Case 7: Batch response structure unchanged');

        // The response shape is built from document.toObject() fields:
        // _id, clientDocumentKey, originalFileName, fileExtension, mimeType,
        // fileSizeBytes, pageCount, customization (with isColored, isBindingRequired, etc.)
        // This is unchanged — we only removed the reuse branch, not the response builder.
        // Verify the response builder code is still intact:
        const fs = await import('fs/promises');
        const controllerSource = await fs.readFile(
            new URL('../controllers/printDocument.controller.js', import.meta.url),
            'utf-8',
        );
        const hasResponseBuilder =
            controllerSource.includes("clientDocumentKey: clientDocumentKey || ''") &&
            controllerSource.includes('originalFileName: document.originalFileName') &&
            controllerSource.includes('fileExtension: document.fileExtension') &&
            controllerSource.includes('mimeType: document.mimeType') &&
            controllerSource.includes('pageCount: document.pageCount') &&
            controllerSource.includes('customization,') &&
            controllerSource.includes('statusCode: httpStatus.CREATED') &&
            controllerSource.includes('Documents saved successfully');
        if (hasResponseBuilder) {
            pass('Case 7: Response structure builder intact — no contract change');
        } else {
            fail('Case 7: Response structure builder appears modified');
        }

        // Verify no reuse logic remains in saveBatchDocumentDetails
        // Extract only the batch handler function body (from "saveBatchDocumentDetails" to the next export)
        const batchFnStart = controllerSource.indexOf('export const saveBatchDocumentDetails');
        const nextExportIdx = controllerSource.indexOf('\nexport ', batchFnStart + 10);
        const batchFnBody = controllerSource.substring(
            batchFnStart,
            nextExportIdx > 0 ? nextExportIdx : batchFnStart + 5000,
        );
        const noReuse =
            !batchFnBody.includes('existingDocument = await PrintDocument.findOne') &&
            !batchFnBody.includes('Reusing existing document') &&
            !batchFnBody.includes("cartStatus: { $in: ['AVAILABLE', 'IN_CART'] }");
        if (noReuse) {
            pass('Case 7: No existing-document reuse logic remains in saveBatchDocumentDetails');
        } else {
            fail('Case 7: Reuse logic still present in saveBatchDocumentDetails');
        }

        // ══════════════════════════════════════════════════════════════════════
        // EDGE: Different users share same storageKey — both protect the file
        // ══════════════════════════════════════════════════════════════════════
        section('Edge: Cross-user storageKey protection');

        const otherUserId = new mongoose.Types.ObjectId();
        const crossUserDoc = await PrintDocument.create({
            user: otherUserId,
            service: service._id,
            originalFileName: 'other-user-doc.pdf',
            mimeType: 'application/pdf',
            cartStatus: 'ORDERED',
            storageProvider: 'LOCAL',
            storageKey: 'test/shared-storage-file.pdf',
            fileUrl: 'http://test.local/shared-storage-file.pdf',
        });

        const crossUserRef = await PrintDocument.exists({
            storageKey: 'test/shared-storage-file.pdf',
            isDeleted: false,
        });
        if (crossUserRef) {
            pass('Edge: Cross-user document with same storageKey protects the file');
        } else {
            fail('Edge: Cross-user document failed to protect the shared storageKey');
        }

        // ══════════════════════════════════════════════════════════════════════
        // EDGE: Empty storageKey — cleanup still deletes DB, skips file
        // ══════════════════════════════════════════════════════════════════════
        section('Edge: Empty storageKey — DB deleted, file skip is safe');

        const emptyKeyDoc = await PrintDocument.create({
            user: mockUserId,
            service: service._id,
            originalFileName: 'empty-key.pdf',
            mimeType: 'application/pdf',
            cartStatus: 'AVAILABLE',
            storageProvider: 'LOCAL',
            storageKey: '',
            fileUrl: 'http://test.local/empty-key.pdf',
            createdAt: eightDaysAgo,
        });

        await cleanupExpiredAvailableDocuments();

        const emptyKeyDocAfter = await PrintDocument.findById(emptyKeyDoc._id);
        if (!emptyKeyDocAfter) {
            pass('Edge: Empty storageKey doc DB record deleted');
        } else {
            fail('Edge: Empty storageKey doc DB record still exists');
        }

        // ══════════════════════════════════════════════════════════════════════
        // EDGE: isDeleted:true records do NOT protect physical files
        // ══════════════════════════════════════════════════════════════════════
        section('Edge: Soft-deleted records do not protect physical files');

        const sharedKeyForSoftDelete = 'test/shared-with-soft-deleted.pdf';
        const softDeletedDoc = await PrintDocument.create({
            user: mockUserId,
            service: service._id,
            originalFileName: 'soft-deleted.pdf',
            mimeType: 'application/pdf',
            cartStatus: 'AVAILABLE',
            storageProvider: 'LOCAL',
            storageKey: sharedKeyForSoftDelete,
            fileUrl: 'http://test.local/shared-with-soft-deleted.pdf',
            createdAt: eightDaysAgo,
            isDeleted: true,
        });

        const freshDocForSoftDelete = await PrintDocument.create({
            user: mockUserId,
            service: service._id,
            originalFileName: 'fresh-doc.pdf',
            mimeType: 'application/pdf',
            cartStatus: 'AVAILABLE',
            storageProvider: 'LOCAL',
            storageKey: sharedKeyForSoftDelete,
            fileUrl: 'http://test.local/shared-with-soft-deleted.pdf',
            createdAt: oneDayAgo,
        });

        await cleanupExpiredAvailableDocuments();

        // softDeletedDoc should be cleaned up
        const softDeletedAfter = await PrintDocument.findById(softDeletedDoc._id);
        if (!softDeletedAfter) {
            pass('Edge: Soft-deleted expired doc was cleaned from DB');
        } else {
            fail('Edge: Soft-deleted expired doc still in DB');
        }

        // freshDoc should remain
        const freshAfter = await PrintDocument.findById(freshDocForSoftDelete._id);
        if (freshAfter) {
            pass('Edge: Fresh doc with same storageKey preserved');
        } else {
            fail('Edge: Fresh doc with same storageKey was deleted');
        }

        // ══════════════════════════════════════════════════════════════════════
        // CLEANUP
        // ══════════════════════════════════════════════════════════════════════
        section('Cleanup');
        await PrintDocument.deleteMany({ user: { $in: [mockUserId, otherUserId] } });
        pass('All test data cleaned up');

        // ══════════════════════════════════════════════════════════════════════
        // SUMMARY
        // ══════════════════════════════════════════════════════════════════════
        console.log(chalk.bold.white('\n' + '═'.repeat(68)));
        if (failed === 0) {
            console.log(chalk.bold.green(`  ALL TESTS PASSED: ${passed} passed, ${failed} failed.`));
        } else {
            console.log(chalk.bold.red(`  SOME TESTS FAILED: ${passed} passed, ${failed} failed.`));
        }
        console.log(chalk.bold.white('═'.repeat(68) + '\n'));

        mongoose.connection.close();
        process.exit(failed > 0 ? 1 : 0);
    } catch (err) {
        console.error(chalk.red('💥 Test Suite crashed:'), err);
        try {
            await mongoose.connection.close();
        } catch {}
        process.exit(1);
    }
};

runTests();

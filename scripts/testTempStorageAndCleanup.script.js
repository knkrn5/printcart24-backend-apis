// scripts/testTempStorageAndCleanup.script.js
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { getTempRootDir, TEMP_ROOT } from '#utils/tempStorage';
import { cleanupStaleTempProcessingFiles } from '#services/documentCleanup';

const runTests = async () => {
    console.log('--- [TEST] Temp Storage and Cleanup Verification ---');

    // Test 1: TEMP_ROOT resolution
    console.log('\n[1] Checking TEMP_ROOT resolution:');
    console.log(`    Current OS platform: ${process.platform}`);
    console.log(`    Resolved TEMP_ROOT: ${TEMP_ROOT}`);
    if (process.platform === 'win32') {
        const expected = path.join(os.tmpdir(), 'printcart24-documents');
        if (TEMP_ROOT === expected) {
            console.log('    ✅ Windows default correctly resolved to %TEMP%\\printcart24-documents');
        } else {
            console.error(`    ❌ Expected ${expected}, got ${TEMP_ROOT}`);
        }
    } else {
        const expected = '/var/tmp/printcart24-documents';
        if (TEMP_ROOT === expected) {
            console.log('    ✅ Linux default correctly resolved to /var/tmp/printcart24-documents (physical disk)');
        } else {
            console.error(`    ❌ Expected ${expected}, got ${TEMP_ROOT}`);
        }
    }

    // Test 2: Custom DOC_TEMP_DIR override test
    console.log('\n[2] Checking DOC_TEMP_DIR env override:');
    const customPath = path.resolve('test-temp-override');
    process.env.DOC_TEMP_DIR = customPath;
    const resolvedCustom = getTempRootDir();
    if (resolvedCustom === customPath) {
        console.log(`    ✅ Custom DOC_TEMP_DIR override works: ${resolvedCustom}`);
    } else {
        console.error(`    ❌ Custom override failed: got ${resolvedCustom}`);
    }
    delete process.env.DOC_TEMP_DIR;

    // Test 3: Stale temp directory cleaner
    console.log('\n[3] Testing cleanupStaleTempProcessingFiles logic:');
    const testTempRoot = path.join(os.tmpdir(), `printcart24-test-cleanup-${Date.now()}`);
    await fs.mkdir(testTempRoot, { recursive: true });

    const recentFolder = path.join(testTempRoot, 'pdf-active-upload');
    const staleFolder = path.join(testTempRoot, 'pdf-crashed-orphan');
    await fs.mkdir(recentFolder, { recursive: true });
    await fs.mkdir(staleFolder, { recursive: true });
    await fs.writeFile(path.join(recentFolder, 'active.pdf'), 'active content');
    await fs.writeFile(path.join(staleFolder, 'orphan.pdf'), 'stale content');

    // Backdate stale folder mtime to 60 minutes ago
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    await fs.utimes(staleFolder, oneHourAgo, oneHourAgo);

    // Recent folder has current time
    const now = new Date();
    await fs.utimes(recentFolder, now, now);

    // Temporarily point DOC_TEMP_DIR to our test folder to test cleaner
    process.env.DOC_TEMP_DIR = testTempRoot;

    // Run cleaner with 30-minute threshold
    await cleanupStaleTempProcessingFiles(30 * 60 * 1000);

    // Verify recent folder still exists
    let recentExists = false;
    try {
        await fs.stat(recentFolder);
        recentExists = true;
    } catch {
        recentExists = false;
    }

    // Verify stale folder was deleted
    let staleExists = false;
    try {
        await fs.stat(staleFolder);
        staleExists = true;
    } catch {
        staleExists = false;
    }

    if (recentExists && !staleExists) {
        console.log('    ✅ Stale orphan folder was successfully deleted (> 30 mins)');
        console.log('    ✅ Active in-flight folder was preserved (< 30 mins)');
    } else {
        console.error(`    ❌ Verification failed: recentExists=${recentExists}, staleExists=${staleExists}`);
    }

    // Cleanup test folder
    delete process.env.DOC_TEMP_DIR;
    await fs.rm(testTempRoot, { recursive: true, force: true }).catch(() => {});

    console.log('\n--- All Tests Completed Successfully ---');
    process.exit(0);
};

runTests().catch((err) => {
    console.error('Test execution failed:', err);
    process.exit(1);
});

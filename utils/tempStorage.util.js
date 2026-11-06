// utils/tempStorage.util.js
import os from 'os';
import path from 'path';
import env from '#configs/env';

/**
 * Resolves the root directory for temporary document processing files.
 *
 * Prioritizes:
 * 1. env.DOC_TEMP_DIR or process.env.DOC_TEMP_DIR (if explicitly configured)
 * 2. '/var/tmp/printcart24-documents' on Linux/POSIX platforms
 *    (Uses the physical disk partition /dev/root where GBs of free space exist,
 *    avoiding Linux /tmp which is usually a RAM-backed tmpfs mount that causes OOM/EDQUOT crashes)
 * 3. os.tmpdir()/printcart24-documents on Windows/other platforms (NTFS local temp)
 */
export const getTempRootDir = () => {
    const configuredDir = env.DOC_TEMP_DIR || process.env.DOC_TEMP_DIR;
    if (configuredDir) {
        return path.resolve(configuredDir);
    }

    if (process.platform !== 'win32') {
        return '/var/tmp/printcart24-documents';
    }

    return path.join(os.tmpdir(), 'printcart24-documents');
};

export const TEMP_ROOT = getTempRootDir();

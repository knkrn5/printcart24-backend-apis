import { mkdir, mkdtemp, stat } from 'fs/promises';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { pathToFileURL } from 'url';
import { TEMP_ROOT } from '#utils/tempStorage';

const execFileAsync = promisify(execFile);

export const convertOfficeDocumentToPdf = async (sourcePath, parentDir) => {
    const baseDir = parentDir || TEMP_ROOT;
    await mkdir(baseDir, { recursive: true });
    const outputDir = await mkdtemp(path.join(baseDir, 'convert-'));
    const profileDir = path.join(outputDir, 'profile');
    const profileUrl = pathToFileURL(profileDir).href;

    try {
        await execFileAsync(
            'soffice',
            [
                `-env:UserInstallation=${profileUrl}`,
                '--headless',
                '--nodefault',
                '--nolockcheck',
                '--nologo',
                '--norestore',
                '--convert-to',
                'pdf',
                '--outdir',
                outputDir,
                sourcePath,
            ],
            {
                windowsHide: true,
                timeout: 60000,
            },
        );
    } catch (error) {
        if (error.code === 'ENOENT') {
            throw new Error('LibreOffice (soffice) is required on the server to process office documents.');
        }

        const stderr = error.stderr ? error.stderr.toString().trim() : '';
        const stdout = error.stdout ? error.stdout.toString().trim() : '';
        const detail = stderr || stdout || error.message;

        throw new Error(`Failed to convert office document to PDF: ${detail}`);
    }

    const outputPdf = path.join(outputDir, `${path.parse(sourcePath).name}.pdf`);
    try {
        await stat(outputPdf);
    } catch {
        throw new Error('Failed to convert office document to PDF: Output PDF was not generated');
    }

    return outputPdf;
};

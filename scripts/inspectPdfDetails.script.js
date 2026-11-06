// scripts/inspectPdfDetails.script.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PDFDocument } from 'pdf-lib';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function inspectPdf(filePath) {
    if (!fs.existsSync(filePath)) {
        return { exists: false };
    }
    const bytes = fs.readFileSync(filePath);
    const pdfDoc = await PDFDocument.load(bytes);
    const pageCount = pdfDoc.getPageCount();
    const pages = [];
    for (let i = 0; i < pageCount; i++) {
        const page = pdfDoc.getPage(i);
        pages.push({
            pageNumber: i + 1,
            width: page.getWidth(),
            height: page.getHeight(),
            rotation: page.getRotation().angle,
        });
    }
    return {
        exists: true,
        sizeBytes: bytes.length,
        pageCount,
        pages,
    };
}

async function main() {
    const testPdfPath = path.resolve(__dirname, '../public/invoices/invoice-client-ejs.pdf');
    const apiPdfPath = path.resolve(__dirname, '../public/invoices/api-invoice-6a86dbbf2348ae0d3cfe13b8.pdf');

    const testDetails = await inspectPdf(testPdfPath);
    const apiDetails = await inspectPdf(apiPdfPath);

    console.log('=== TEST PDF DETAILS ===');
    console.log(JSON.stringify(testDetails, null, 2));

    console.log('\n=== API PDF DETAILS ===');
    console.log(JSON.stringify(apiDetails, null, 2));
}

main().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});

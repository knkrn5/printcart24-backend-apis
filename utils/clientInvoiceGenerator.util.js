// utils/clientInvoiceGenerator.util.js
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEMPLATE_PATH = path.resolve(__dirname, '../templates/invoice/invoice.ejs');
const DEFAULT_LOGO_PATH = path.resolve(__dirname, '../assets/printcampus-logo.png');
const DEFAULT_SIGN_PATH = path.resolve(__dirname, '../assets/pc-sign.jpg');

/**
 * Resolves the LibreOffice (soffice) executable across Linux/EC2 and Windows environments.
 * Matches existing architecture from services/documentConversion.service.js.
 */
function resolveSofficeExecutable() {
    if (process.platform !== 'win32') {
        return 'soffice';
    }

    const winPaths = [
        'C:\\Program Files\\LibreOffice\\program\\soffice.com',
        'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.com',
        'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
        'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
    ];

    for (const p of winPaths) {
        if (fs.existsSync(p)) {
            return p;
        }
    }

    return 'soffice';
}

/**
 * Converts a local file to a Base64 Data URI for robust embedding in HTML/PDF.
 *
 * @param {string} filePath - Absolute file path to asset
 * @param {string} mimeType - MIME type string (e.g. 'image/png', 'image/jpeg')
 * @returns {string} Base64 Data URI string or empty string if absent
 */
function getAssetDataUri(filePath, mimeType) {
    try {
        if (fs.existsSync(filePath)) {
            const buf = fs.readFileSync(filePath);
            return `data:${mimeType};base64,${buf.toString('base64')}`;
        }
    } catch {
        // Fallback gracefully
    }
    return '';
}

/**
 * Builds the Client Invoice View Model / DTO from a PrintOrder document or lean object.
 * NOTE: Preserves 100% of existing financial and business calculations without changes.
 *
 * @param {Object} order - Mongoose PrintOrder document or lean object
 * @param {Object} [options={}] - Optional overrides for assets (logo, signature, QR code, email)
 * @returns {Object} Normalized invoice view model conforming to client EJS contract
 */
export function buildClientInvoiceViewModel(order = {}, options = {}) {
    const deliveryAddress = order.deliveryAddress || {};
    const priceSummary = order.priceSummary || {};
    const customerName = `${deliveryAddress.firstName || ''} ${deliveryAddress.lastName || ''}`.trim() || 'Valued Customer';
    const cityStateZip = [
        deliveryAddress.city,
        deliveryAddress.state
            ? deliveryAddress.pincode
                ? `${deliveryAddress.state} - ${deliveryAddress.pincode}`
                : deliveryAddress.state
            : deliveryAddress.pincode,
    ]
        .filter(Boolean)
        .join(', ');

    // Normalize Items (Print Items + Stationery Items)
    const normalizedItems = [];
    let serialNumber = 1;

    // 1. Print Items
    if (Array.isArray(order.items)) {
        for (const item of order.items) {
            const docInfo = item.document || {};
            const serviceSnapshot = item.serviceSnapshot || {};
            const customization = item.customization || {};
            const price = item.priceSummary || {};
            const copies = customization.copies || 1;

            const addonsList = [];
            if (customization.selectedBinding?.label && customization.selectedBinding.totalAmount > 0) {
                addonsList.push({
                    name: `Binding: ${customization.selectedBinding.label}`,
                    price: customization.selectedBinding.totalAmount,
                });
            }
            if (Array.isArray(customization.selectedAddOns)) {
                for (const addon of customization.selectedAddOns) {
                    addonsList.push({
                        name: addon.label,
                        price: addon.totalAmount,
                    });
                }
            }

            const detailsList = [];
            if (customization.paperQuality) {
                detailsList.push({ label: 'Quality', value: customization.paperQuality });
            }

            normalizedItems.push({
                serial: serialNumber++,
                title: docInfo.originalFileName || 'Document',
                service: serviceSnapshot.name || 'Document Printing',
                size: customization.paperSize || '',
                color: customization.colorMode || '',
                printType: customization.sideMode || '',
                addons: addonsList.length > 0 ? addonsList : undefined,
                details: detailsList.length > 0 ? detailsList : undefined,
                unitPrice: price.baseAmount ? price.baseAmount / copies : 0,
                quantity: copies,
                discount: 0,
                tax: price.taxAmount || 0,
                total: price.totalAmount || 0,
            });
        }
    }

    // 2. Stationery Items
    if (Array.isArray(order.stationeryItems)) {
        for (const item of order.stationeryItems) {
            const itemSnapshot = item.itemSnapshot || {};
            const price = item.priceSummary || {};
            const quantity = item.quantity || 1;

            const detailsList = [];
            if (itemSnapshot.brand) {
                detailsList.push({ label: 'Brand', value: itemSnapshot.brand });
            }

            normalizedItems.push({
                serial: serialNumber++,
                title: itemSnapshot.name || 'Stationery Item',
                service: 'Stationery Product',
                details: detailsList.length > 0 ? detailsList : undefined,
                unitPrice: price.unitPrice || 0,
                quantity: quantity,
                discount: 0,
                tax: price.taxAmount || 0,
                total: price.totalAmount || 0,
            });
        }
    }

    const formattedDate = order.createdAt
        ? new Date(order.createdAt).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })
        : new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' });

    // Customer email: Render real email if available, otherwise render '-' (never undefined/null/blank)
    const resolvedCustomerEmail = options.customerEmail || order.user?.email || '-';

    // Resolve Logo and Signature Data URIs
    const resolvedLogoDataUri =
        options.logoDataUri !== undefined ? options.logoDataUri : getAssetDataUri(DEFAULT_LOGO_PATH, 'image/png');

    const resolvedSignatureDataUri =
        options.signatureDataUri !== undefined
            ? options.signatureDataUri
            : getAssetDataUri(DEFAULT_SIGN_PATH, 'image/jpeg');

    return {
        currency: '₹',
        invoiceNumber: `REC-${order.orderNumber}`,
        issueDate: formattedDate,
        orderNumber: order.orderNumber,
        orderDate: formattedDate,
        paymentInfo: {
            mode: order.paymentMethod || 'N/A',
            status: order.paymentStatus || 'PENDING',
            transactionId: order.razorpayPaymentId || '',
        },
        paymentMode: order.paymentMethod || 'N/A',
        sellerInfo: {
            brandName: 'Print Campus',
            legalName: 'Print Campus Solutions Private Limited',
            address: '123 Campus Plaza, Sector 62',
            city: 'Noida, Uttar Pradesh - 201301',
            gstin: '09AAACP1234A1Z5',
            email: 'support@printcampus.in',
            phone: '',
            website: 'www.printcampus.in',
            tagline: 'Online Document Printing & Stationery Services',
            logoDataUri: resolvedLogoDataUri,
            signatureDataUri: resolvedSignatureDataUri,
        },
        customerInfo: {
            name: customerName,
            address: deliveryAddress.fullAddress || 'N/A',
            city: cityStateZip || '',
            phone: deliveryAddress.phone ? `+91 ${deliveryAddress.phone}` : '',
            email: resolvedCustomerEmail,
        },
        shippingInfo: {
            name: customerName,
            address: deliveryAddress.fullAddress || 'N/A',
            city: cityStateZip || '',
            phone: deliveryAddress.phone ? `+91 ${deliveryAddress.phone}` : '',
            email: resolvedCustomerEmail,
        },
        items: normalizedItems,
        totals: {
            itemSubtotal: priceSummary.itemTotal || 0,
            addonsSubtotal: priceSummary.addOnTotal || 0,
            deliveryFee: priceSummary.deliveryFee || 0,
            platformFee: priceSummary.platformFee || 0,
            discount: priceSummary.discountAmount || 0,
            discountAmount: priceSummary.discountAmount || 0,
            taxAmount: priceSummary.taxAmount || 0,
            grandTotal: priceSummary.grandTotal || 0,
            quantity: normalizedItems.reduce((acc, it) => acc + (it.quantity || 1), 0),
        },
        qrCodeDataUrl: options.qrCodeDataUrl || '',
    };
}

/**
 * Lightweight in-memory EJS template evaluator without external npm dependencies
 *
 * @param {string} templateStr - EJS template content
 * @param {Object} data - Template variables
 * @returns {string} Rendered HTML
 */
export function compileAndRenderEjs(templateStr, data = {}) {
    let jsCode = 'let __out = [];\n';
    let cursor = 0;
    const regex = /<%(={1,2}|-)?\s*([\s\S]*?)\s*%>/g;
    let match;

    while ((match = regex.exec(templateStr)) !== null) {
        const textBefore = templateStr.slice(cursor, match.index);
        if (textBefore) {
            jsCode += `__out.push(${JSON.stringify(textBefore)});\n`;
        }

        const prefix = match[1];
        const code = match[2];

        if (prefix === '=' || prefix === '-') {
            jsCode += `__out.push((typeof (${code}) !== "undefined" && (${code}) !== null) ? (${code}) : "");\n`;
        } else {
            jsCode += `${code}\n`;
        }

        cursor = regex.lastIndex;
    }

    const textAfter = templateStr.slice(cursor);
    if (textAfter) {
        jsCode += `__out.push(${JSON.stringify(textAfter)});\n`;
    }

    jsCode += 'return __out.join("");\n';

    const fn = new Function(
        '__data',
        `
        with (__data) {
            ${jsCode}
        }
    `,
    );

    return fn(data);
}

/**
 * Renders the Client Invoice HTML string from a PrintOrder
 *
 * @param {Object} order - Mongoose order or lean document
 * @param {Object} [options={}] - Options (e.g. customerEmail, logoDataUri, signatureDataUri)
 * @returns {string} Rendered HTML string
 */
export function renderClientInvoiceHtml(order, options = {}) {
    if (!fs.existsSync(TEMPLATE_PATH)) {
        throw new Error(`Invoice template not found at: ${TEMPLATE_PATH}`);
    }
    const templateContent = fs.readFileSync(TEMPLATE_PATH, 'utf8');
    const viewModel = buildClientInvoiceViewModel(order, options);
    return compileAndRenderEjs(templateContent, viewModel);
}

/**
 * Generates the Client EJS Invoice PDF using the existing LibreOffice conversion architecture.
 *
 * @param {Object} order - Mongoose order document or lean object
 * @param {string} outputPdfPath - Destination file path for generated PDF
 * @param {Object} [options={}] - Optional overrides
 * @returns {Promise<void>}
 */
export async function generateClientInvoicePdf(order, outputPdfPath, options = {}) {
    const htmlContent = renderClientInvoiceHtml(order, options);
    const outDir = path.dirname(outputPdfPath);
    const tempHtmlPath = outputPdfPath.replace(/\.pdf$/i, '.temp.html');
    const baseName = path.parse(tempHtmlPath).name;
    const generatedPdfPath = path.join(outDir, `${baseName}.pdf`);

    fs.writeFileSync(tempHtmlPath, htmlContent, 'utf8');

    const sofficeBin = resolveSofficeExecutable();

    try {
        await execFileAsync(sofficeBin, ['--headless', '--convert-to', 'pdf', '--outdir', outDir, tempHtmlPath], {
            windowsHide: true,
        });

        if (generatedPdfPath !== outputPdfPath && fs.existsSync(generatedPdfPath)) {
            fs.renameSync(generatedPdfPath, outputPdfPath);
        }
    } catch (err) {
        if (err.code === 'ENOENT') {
            throw new Error(`LibreOffice (soffice) not found at '${sofficeBin}'. It is required for PDF generation.`);
        }
        throw new Error(`Failed to generate client invoice PDF via LibreOffice: ${err.message}`);
    } finally {
        if (fs.existsSync(tempHtmlPath)) {
            fs.unlinkSync(tempHtmlPath);
        }
    }
}

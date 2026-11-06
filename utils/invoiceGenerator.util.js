// utils/invoiceGenerator.util.js
import PDFDocument from 'pdfkit';

/**
 * Helper to draw a horizontal rule
 */
const drawHr = (doc, y) => {
    doc.strokeColor('#e2e8f0')
       .lineWidth(1)
       .moveTo(50, y)
       .lineTo(545, y)
       .stroke();
};

/**
 * Helper to draw table rows
 */
const generateTableRow = (doc, y, sno, desc, unitPrice, qty, total, isHeader = false) => {
    doc.fontSize(isHeader ? 9 : 8)
       .font(isHeader ? 'Helvetica-Bold' : 'Helvetica')
       .fillColor(isHeader ? '#1e293b' : '#334155');

    doc.text(sno, 50, y, { width: 30, align: 'left' })
       .text(desc, 85, y, { width: 250, align: 'left' })
       .text(unitPrice, 340, y, { width: 65, align: 'right' })
       .text(qty, 415, y, { width: 40, align: 'center' })
       .text(total, 465, y, { width: 80, align: 'right' });
};

/**
 * Generates the invoice PDF and pipes it to the provided writable stream
 * @param {Object} order - Mongoose order document or lean object
 * @param {import('stream').Writable} stream - Response stream or file stream
 * @returns {Promise<void>}
 */
export const generateInvoicePdf = (order, stream) => {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ margin: 50, size: 'A4', bufferPages: true });

            doc.pipe(stream);

            // 1. Branding and Invoice Metadata Header
            doc.fillColor('#1e3a8a')
               .font('Helvetica-Bold')
               .fontSize(22)
               .text('Print Campus', 50, 45)
               .fontSize(8)
               .font('Helvetica')
               .fillColor('#64748b')
               .text('Online Document Printing & Stationery Services', 50, 70)
               .text('Email: support@printcampus.com', 50, 82)
               .text('Website: www.printcampus.com', 50, 94);

            doc.fillColor('#0f172a')
               .font('Helvetica-Bold')
               .fontSize(16)
               .text('RECEIPT', 200, 45, { align: 'right' })
               .font('Helvetica')
               .fontSize(9)
               .fillColor('#334155')
               .text(`Receipt No: REC-${order.orderNumber}`, 200, 68, { align: 'right' })
               .text(`Receipt Date: ${new Date(order.createdAt).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}`, 200, 80, { align: 'right' })
               .text(`Order Status: ${order.orderStatus}`, 200, 92, { align: 'right' });

            drawHr(doc, 115);

            // 2. Billing & Payment Information
            const address = order.deliveryAddress || {};
            const customerName = `${address.firstName || ''} ${address.lastName || ''}`.trim() || 'Valued Customer';

            doc.font('Helvetica-Bold')
               .fontSize(10)
               .fillColor('#1e293b')
               .text('Sold By (Seller):', 50, 130)
               .font('Helvetica')
               .fontSize(9)
               .fillColor('#334155')
               .text('Print Campus Solutions Private Limited', 50, 145)
               .text('123 Campus Plaza, Sector 62', 50, 157)
               .text('Noida, Uttar Pradesh - 201301', 50, 169)
               .text('GSTIN: 09AAACP1234A1Z5', 50, 181);

            doc.font('Helvetica-Bold')
               .fontSize(10)
               .fillColor('#1e293b')
               .text('Bill To (Customer):', 300, 130)
               .font('Helvetica')
               .fontSize(9)
               .fillColor('#334155')
               .text(customerName, 300, 145)
               .text(address.fullAddress || 'N/A', 300, 157, { width: 245 })
               .text(`${address.city || ''}, ${address.state || ''} - ${address.pincode || ''}`, 300, doc.y + 2)
               .text(`Phone: +91 ${address.phone || 'N/A'}`, 300, doc.y + 2);

            // Payment details block
            const currentYAfterAddress = doc.y;
            const paymentStartY = Math.max(195, currentYAfterAddress + 10);
            
            doc.font('Helvetica-Bold')
               .fontSize(9)
               .fillColor('#1e293b')
               .text('Payment Info:', 50, paymentStartY)
               .font('Helvetica')
               .fontSize(8.5)
               .fillColor('#334155')
               .text(`Payment Status: ${order.paymentStatus || 'PENDING'}`, 50, paymentStartY + 14)
               .text(`Payment Mode: ${order.paymentMethod || 'N/A'}`, 50, paymentStartY + 25);

            if (order.razorpayPaymentId) {
                doc.text(`Transaction ID: ${order.razorpayPaymentId}`, 50, paymentStartY + 36);
            }

            const tableStartY = Math.max(260, paymentStartY + 50);
            drawHr(doc, tableStartY - 10);

            // 3. Items Table Header Background
            doc.fillColor('#f8fafc')
               .rect(50, tableStartY, 495, 20)
               .fill();

            generateTableRow(doc, tableStartY + 5, 'S.No', 'Item & Description', 'Unit Price', 'Qty', 'Total', true);
            drawHr(doc, tableStartY + 20);

            let y = tableStartY + 25;
            let sno = 1;

            // 4. Print items
            if (order.items && order.items.length > 0) {
                for (const item of order.items) {
                    // Check if we need to add a page (prevent overflow)
                    if (y > 670) {
                        doc.addPage();
                        y = 50;
                    }

                    const serviceSnapshot = item.serviceSnapshot || {};
                    const docInfo = item.document || {};
                    const customization = item.customization || {};
                    const price = item.priceSummary || {};

                    let desc = `Print: ${docInfo.originalFileName || 'Document'}\n`;
                    desc += `Service: ${serviceSnapshot.name || 'N/A'}\n`;
                    
                    const specs = [];
                    if (customization.paperSize) specs.push(`Size: ${customization.paperSize}`);
                    if (customization.colorMode) specs.push(customization.colorMode);
                    if (customization.sideMode) specs.push(customization.sideMode);
                    if (customization.paperQuality) specs.push(customization.paperQuality);
                    if (specs.length > 0) desc += `${specs.join(' | ')}\n`;

                    if (customization.selectedBinding && customization.selectedBinding.label && customization.selectedBinding.totalAmount > 0) {
                        desc += `Binding: ${customization.selectedBinding.label} (+Rs. ${customization.selectedBinding.totalAmount.toFixed(2)})\n`;
                    }

                    if (customization.selectedAddOns && customization.selectedAddOns.length > 0) {
                        const addOnsDesc = customization.selectedAddOns
                            .map(addon => `${addon.label} (+Rs. ${addon.totalAmount.toFixed(2)})`)
                            .join(', ');
                        desc += `Addons: ${addOnsDesc}\n`;
                    }

                    desc = desc.trim();

                    const copies = customization.copies || 1;
                    const baseUnitVal = price.baseAmount / copies;
                    const unitPriceStr = `Rs. ${baseUnitVal.toFixed(2)}`;
                    const totalStr = price.totalAmount ? `Rs. ${price.totalAmount.toFixed(2)}` : 'Rs. 0.00';

                    const descHeight = doc.heightOfString(desc, { width: 250 });
                    const rowHeight = Math.max(descHeight, 20);

                    generateTableRow(doc, y, sno.toString(), desc, unitPriceStr, copies.toString(), totalStr, false);
                    y += rowHeight + 12;
                    drawHr(doc, y - 6);
                    sno++;
                }
            }

            // 5. Stationery items
            if (order.stationeryItems && order.stationeryItems.length > 0) {
                for (const item of order.stationeryItems) {
                    if (y > 670) {
                        doc.addPage();
                        y = 50;
                    }

                    const snapshot = item.itemSnapshot || {};
                    const price = item.priceSummary || {};

                    let desc = `Stationery: ${snapshot.name || 'N/A'}\n`;
                    if (snapshot.brand) desc += `Brand: ${snapshot.brand}\n`;
                    desc = desc.trim();

                    const unitPrice = price.unitPrice ? price.unitPrice.toFixed(2) : '0.00';
                    const qty = item.quantity || 1;
                    const totalStr = price.totalAmount ? `Rs. ${price.totalAmount.toFixed(2)}` : 'Rs. 0.00';

                    const descHeight = doc.heightOfString(desc, { width: 250 });
                    const rowHeight = Math.max(descHeight, 20);

                    generateTableRow(doc, y, sno.toString(), desc, `Rs. ${unitPrice}`, qty.toString(), totalStr, false);
                    y += rowHeight + 12;
                    drawHr(doc, y - 6);
                    sno++;
                }
            }

            // 6. Summary Block
            const pSummary = order.priceSummary || {};
            const totals = [
                { label: 'Item Subtotal:', val: pSummary.itemTotal },
                { label: 'Add-ons Subtotal:', val: pSummary.addOnTotal },
                { label: 'Delivery Fee:', val: pSummary.deliveryFee },
            ];

            y += 10;
            doc.font('Helvetica').fontSize(8.5).fillColor('#475569');

            for (const t of totals) {
                if (t.val === undefined || t.val === null || (t.val === 0 && t.label !== 'Tax (GST):' && t.label !== 'Delivery Fee:')) {
                    continue;
                }

                if (y > 680) {
                    doc.addPage();
                    y = 50;
                }

                doc.text(t.label, 320, y, { width: 130, align: 'right' })
                   .text(`Rs. ${t.val.toFixed(2)}`, 460, y, { width: 85, align: 'right' });
                y += 14;
            }

            if (y > 670) {
                doc.addPage();
                y = 50;
            }

            doc.strokeColor('#94a3b8')
               .lineWidth(1)
               .moveTo(320, y + 2)
               .lineTo(545, y + 2)
               .stroke();

            y += 8;

            doc.fontSize(11)
               .font('Helvetica-Bold')
               .fillColor('#0f172a')
               .text('Grand Total:', 320, y, { width: 130, align: 'right' })
               .text(`Rs. ${(pSummary.grandTotal || 0).toFixed(2)}`, 460, y, { width: 85, align: 'right' });

            // 7. Footer details on all buffered pages
            const pages = doc.bufferedPageRange();
            for (let i = 0; i < pages.count; i++) {
                doc.switchToPage(i);
                
                // Draw bottom rules & pagination
                doc.strokeColor('#cbd5e1')
                   .lineWidth(0.5)
                   .moveTo(50, 760)
                   .lineTo(545, 760)
                   .stroke();

                doc.fontSize(7.5)
                   .font('Helvetica')
                   .fillColor('#94a3b8')
                   .text('This is a computer-generated tax invoice and requires no physical or digital signature.', 50, 768, { align: 'left', width: 350 })
                   .text(`Page ${i + 1} of ${pages.count}`, 445, 768, { align: 'right', width: 100 });
            }

            stream.on('finish', resolve);
            stream.on('error', reject);
            doc.end();
        } catch (err) {
            reject(err);
        }
    });
};

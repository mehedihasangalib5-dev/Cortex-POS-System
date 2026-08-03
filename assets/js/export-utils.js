// ---------------------------------------------------------------------------
// Shared PDF / Excel export helpers. Built on top of two CDN libraries that
// pages must load themselves before this module runs (see reports.html /
// inventory.html <head>):
//   - jsPDF + jspdf-autotable  -> window.jspdf.jsPDF, doc.autoTable(...)
//   - SheetJS (xlsx)           -> window.XLSX
//
// Keeps "given a title + column headers + row arrays, produce a downloadable
// file" logic in one place instead of duplicating it per page.
// ---------------------------------------------------------------------------
import { toast } from "./app-shell.js";

/**
 * Money for PDFs. jsPDF's built-in fonts (Helvetica/Times/Courier) don't
 * carry the Bengali Taka glyph (৳) and render it as a blank box, so PDF
 * exports use "Tk" instead. Excel exports can keep the real ৳ symbol since
 * SheetJS just writes Unicode text that Excel renders with a system font.
 */
export function pdfMoney(n) {
    const num = Number(n) || 0;
    return 'Tk ' + num.toLocaleString('en-BD', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function dateSlug() {
    return new Date().toISOString().slice(0, 10);
}

/**
 * Renders a titled, tabular PDF report and triggers a download.
 * @param {Object} opts
 * @param {string} opts.filename      - without extension
 * @param {string} opts.title         - report heading, e.g. "Sales Report"
 * @param {string} [opts.businessName]
 * @param {string} [opts.subtitle]    - e.g. a date range or active filter description
 * @param {string[]} opts.columns     - table header labels
 * @param {(string|number)[][]} opts.rows
 * @param {string[]} [opts.summaryLines] - optional bold lines printed below the table (totals, etc.)
 */
export function exportTableToPdf({ filename, title, businessName, subtitle, columns, rows, summaryLines }) {
    if (!window.jspdf || !window.jspdf.jsPDF) {
        toast('PDF export failed to load — check your connection and try again', 'error');
        return;
    }
    if (!rows || rows.length === 0) {
        toast('Nothing to export yet', 'error');
        return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: columns.length > 6 ? 'landscape' : 'portrait', unit: 'pt' });
    const marginLeft = 40;
    let y = 46;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.setTextColor(20, 24, 40);
    doc.text(businessName || 'CorPOS & IMS', marginLeft, y);

    y += 20;
    doc.setFontSize(12.5);
    doc.text(title, marginLeft, y);

    y += 15;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(100, 105, 120);
    doc.text(`Generated ${new Date().toLocaleString('en-BD')}`, marginLeft, y);
    if (subtitle) {
        y += 13;
        doc.text(subtitle, marginLeft, y);
    }
    y += 10;

    doc.autoTable({
        startY: y,
        head: [columns],
        body: rows,
        margin: { left: marginLeft, right: marginLeft },
        styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 5, textColor: [30, 33, 45] },
        headStyles: { fillColor: [36, 84, 255], textColor: [255, 255, 255], fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [246, 248, 252] },
        theme: 'striped',
    });

    if (summaryLines && summaryLines.length) {
        let sy = doc.lastAutoTable.finalY + 22;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9.5);
        doc.setTextColor(20, 24, 40);
        summaryLines.forEach((line) => {
            doc.text(line, marginLeft, sy);
            sy += 14;
        });
    }

    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(150, 155, 168);
        doc.text(
            `Page ${i} of ${pageCount}`,
            doc.internal.pageSize.getWidth() - 90,
            doc.internal.pageSize.getHeight() - 20,
        );
    }

    doc.save(`${filename}-${dateSlug()}.pdf`);
}

/**
 * Builds a single-sheet .xlsx and triggers a download. Pass real JS numbers
 * (not strings) in numeric cells so Excel treats them as numbers.
 * @param {Object} opts
 * @param {string} opts.filename   - without extension
 * @param {string} opts.sheetName
 * @param {string[]} opts.columns
 * @param {(string|number)[][]} opts.rows
 */
export function exportTableToExcel({ filename, sheetName, columns, rows }) {
    if (!window.XLSX) {
        toast('Excel export failed to load — check your connection and try again', 'error');
        return;
    }
    if (!rows || rows.length === 0) {
        toast('Nothing to export yet', 'error');
        return;
    }

    const aoa = [columns, ...rows];
    const ws = window.XLSX.utils.aoa_to_sheet(aoa);

    // Size columns to their longest cell/header so nothing is truncated by default.
    ws['!cols'] = columns.map((c, i) => {
        const longest = rows.reduce((max, r) => Math.max(max, String(r[i] ?? '').length), String(c).length);
        return { wch: Math.min(Math.max(longest + 2, 10), 40) };
    });

    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31)); // Excel sheet names cap at 31 chars
    window.XLSX.writeFile(wb, `${filename}-${dateSlug()}.xlsx`);
}

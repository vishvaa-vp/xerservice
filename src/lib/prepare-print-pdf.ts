import { PDFDocument, StandardFonts, degrees, rgb, pushGraphicsState, popGraphicsState, rectangle, clip, endPath } from 'pdf-lib';
import { selectedPageNumbers, sheetDimensions, type PrintSettings } from '@/lib/print-settings';

/** Creates the actual sheet layout shown by LivePrintPreview; copies/colour/duplex stay native. */
export async function preparePrintPdf(bytes: ArrayBuffer, settings: PrintSettings, filename: string): Promise<Uint8Array> {
    const source = await PDFDocument.load(bytes);
    const numbers = selectedPageNumbers(source.getPageCount(), settings);
    if (!numbers.length) throw new Error('No printable pages selected.');
    const output = await PDFDocument.create();
    const font = settings.headersFooters ? await output.embedFont(StandardFonts.Helvetica) : undefined;
    const size = sheetDimensions(settings);
    const n = settings.pagesPerSheet;
    if (![1, 2, 4, 6, 9, 16].includes(n)) throw new Error('Unsupported pages per sheet.');
    const margin = settings.margins === 'none' ? 0 : settings.margins === 'minimum' ? 10 : 28;
    const header = settings.headersFooters ? 16 : 0;
    const columns = n === 2 ? (settings.orientation === 'landscape' ? 2 : 1) : Math.ceil(Math.sqrt(n));
    const rows = Math.ceil(n / columns), gap = n > 1 ? 8 : 0;
    const cellWidth = (size.width - margin * 2 - gap * (columns - 1)) / columns;
    const cellHeight = (size.height - margin * 2 - header * 2 - gap * (rows - 1)) / rows;
    // Flatten field appearances before embedding page content.
    source.getForm().flatten();
    for (let offset = 0; offset < numbers.length; offset += n) {
        const page = output.addPage([size.width, size.height]);
        const group = numbers.slice(offset, offset + n);
        for (let index = 0; index < group.length; index++) {
            const original = source.getPage(group[index] - 1);
            const rotation = ((original.getRotation().angle % 360) + 360) % 360;
            const embedded = await output.embedPage(original);
            const sideways = rotation === 90 || rotation === 270;
            const width = sideways ? embedded.height : embedded.width;
            const height = sideways ? embedded.width : embedded.height;
            const fit = Math.min(cellWidth / width, cellHeight / height);
            const scale = settings.scale === 'custom' ? (settings.customScale ?? 100) / 100 : settings.scale === 'fit' ? fit : Math.min(1, fit);
            const x = margin + (index % columns) * (cellWidth + gap);
            const y = size.height - margin - header - (Math.floor(index / columns) + 1) * cellHeight - Math.floor(index / columns) * gap;
            const left = x + (cellWidth - width * scale) / 2;
            const bottom = y + (cellHeight - height * scale) / 2;
            page.pushOperators(pushGraphicsState(), rectangle(x, y, cellWidth, cellHeight), clip(), endPath());
            page.drawPage(embedded, {
                x: left + (rotation === 180 ? embedded.width * scale : rotation === 270 ? embedded.height * scale : 0),
                y: bottom + (rotation === 90 ? embedded.width * scale : rotation === 180 ? embedded.height * scale : 0),
                xScale: scale, yScale: scale, rotate: degrees(-rotation),
            });
            page.pushOperators(popGraphicsState());
        }
        if (font) {
            const inset = Math.max(12, margin);
            const safeName = filename.replace(/[^\x20-\x7e]/g, '?').slice(0, 90);
            page.drawText(safeName, { x: inset, y: size.height - inset - 9, size: 9, font, color: rgb(.33, .33, .33) });
            const label = `Pages ${group.join(', ')}`;
            page.drawText(label, { x: size.width - inset - font.widthOfTextAtSize(label, 9), y: inset, size: 9, font });
        }
    }
    return output.save();
}

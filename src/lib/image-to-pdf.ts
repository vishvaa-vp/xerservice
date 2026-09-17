import { PDFDocument } from 'pdf-lib';
import { MAX_DOCUMENT_BYTES } from './pdf-document';

export async function convertImageToPdf(imageFile: File): Promise<{ pdfFile: File }> {
    if (imageFile.size > MAX_DOCUMENT_BYTES) throw new Error('Choose an image smaller than 20 MB.');
    const url = URL.createObjectURL(imageFile);
    try {
        const img = new Image();
        await new Promise<void>((resolve, reject) => {
            img.onload = () => resolve();
            img.onerror = () => reject(new Error('This image could not be opened. Try another image.'));
            img.src = url;
        });
        // Decode consistently, including EXIF rotation, and bound the raster size for mobile devices.
        const scale = Math.min(1, 3508 / Math.max(img.naturalWidth, img.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Image conversion is unavailable in this browser.');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => {
            if (blob) resolve(blob);
            else reject(new Error('This image could not be converted. Try a smaller image.'));
        }, 'image/png'));
        canvas.width = canvas.height = 0;
        const doc = await PDFDocument.create();
        const embedded = await doc.embedPng(await png.arrayBuffer());
        const page = doc.addPage([595.28, 841.89]);
        const fit = Math.min((page.getWidth() - 40) / embedded.width, (page.getHeight() - 40) / embedded.height);
        const width = embedded.width * fit;
        const height = embedded.height * fit;
        page.drawImage(embedded, { x: (page.getWidth() - width) / 2, y: (page.getHeight() - height) / 2, width, height });
        const bytes = await doc.save();
        const pdfFile = new File([new Uint8Array(bytes)], `${imageFile.name.replace(/\.[^.]+$/, '')}.pdf`, { type: 'application/pdf' });
        if (pdfFile.size > MAX_DOCUMENT_BYTES) throw new Error('The converted image exceeds 20 MB. Choose a smaller image.');
        return { pdfFile };
    } finally {
        URL.revokeObjectURL(url);
    }
}

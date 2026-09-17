import { NextRequest, NextResponse } from 'next/server';
import { PDFDocument } from 'pdf-lib';
import { detectPageSize, MAX_DOCUMENT_BYTES, MAX_DOCUMENT_PAGES } from '@/lib/pdf-document';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
    const headers = { 'Cache-Control': 'no-store' };
    const fail = (error: string, status: number) => NextResponse.json({ isValid: false, error }, { status, headers });
    if (!req.headers.get('content-type')?.startsWith('multipart/form-data')) return fail('Upload a PDF file.', 415);
    const length = Number(req.headers.get('content-length'));
    if (Number.isFinite(length) && length > MAX_DOCUMENT_BYTES + 1024 * 1024) return fail('File too large (max 20 MB).', 413);
    let form: FormData;
    try { form = await req.formData(); } catch { return fail('Invalid file upload.', 400); }
    const file = form.get('file');
    if (!file || typeof file === 'string') return fail('No file provided.', 400);
    if (file.size > MAX_DOCUMENT_BYTES) return fail('File too large (max 20 MB).', 413);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-') return fail('Upload a valid PDF file.', 415);
    try {
        const doc = await PDFDocument.load(bytes);
        const pageCount = doc.getPageCount();
        if (pageCount < 1 || pageCount > MAX_DOCUMENT_PAGES) return fail(`Choose a PDF with 1-${MAX_DOCUMENT_PAGES} pages.`, 422);
        const pageSizes = doc.getPages().map((page, i) => {
            const { width, height } = page.getSize();
            const rotated = Math.abs(page.getRotation().angle % 180) === 90;
            const w = rotated ? height : width;
            const h = rotated ? width : height;
            return { pageNumber: i + 1, width: w, height: h, label: detectPageSize(w, h), orientation: w > h ? 'landscape' : 'portrait' };
        });
        if (pageSizes.some(p => !Number.isFinite(p.width) || !Number.isFinite(p.height) || p.width <= 0 || p.height <= 0)) return fail('The PDF has invalid page dimensions.', 422);
        const sizes: Record<string, number> = {};
        pageSizes.forEach(p => { sizes[p.label] = (sizes[p.label] || 0) + 1; });
        return NextResponse.json({ isValid: true, pageCount, pageSizes, dominantSize: Object.entries(sizes).sort((a, b) => b[1] - a[1])[0][0], fileSizeBytes: file.size, fileName: file.name, title: doc.getTitle() ?? null, author: doc.getAuthor() ?? null }, { headers });
    } catch {
        return fail('This PDF is damaged or password-protected. Upload a valid, unlocked PDF.', 422);
    }
}

'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { ChevronLeft, ChevronRight, RotateCw, Loader2, FileWarning } from 'lucide-react';
import { pagesOnSide, selectedPageNumbers, sheetDimensions, type PrintSettings } from '@/lib/print-settings';
import styles from './LivePrintPreview.module.css';

interface Props { file: File; pageCount: number; settings: PrintSettings; review?: boolean }

export default function LivePrintPreview({ file, pageCount, settings, review = false }: Props) {
    const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [renderedKey, setRenderedKey] = useState('');
    const [sheet, setSheet] = useState(0);
    const [back, setBack] = useState(false);
    const frontCanvas = useRef<HTMLCanvasElement>(null);
    const backCanvas = useRef<HTMLCanvasElement>(null);
    const selected = useMemo(() => selectedPageNumbers(pageCount, settings), [pageCount, settings]);
    const double = settings.sides !== 'single';
    const sheetCount = Math.ceil(selected.length / settings.pagesPerSheet / (double ? 2 : 1));
    const currentSheet = Math.min(sheet, Math.max(0, sheetCount - 1));
    const size = sheetDimensions(settings);
    // The binding axis follows the physical long/short edge in either orientation.
    const axis = (settings.sides === 'double_long') === (settings.orientation === 'portrait') ? 'y' : 'x';
    const frontPages = pagesOnSide(selected, currentSheet, false, settings);
    const backPages = double ? pagesOnSide(selected, currentSheet, true, settings) : [];
    const visiblePages = back && double ? backPages : frontPages;
    const sourceKey = `${currentSheet}:${selected.join(',')}:${settings.pagesPerSheet}:${settings.sides}`;
    const renderKey = JSON.stringify([sourceKey, size.width, size.height, settings.margins, settings.scale, settings.customScale, settings.headersFooters, settings.color, file.name]);
    const updating = loading || renderedKey !== renderKey;

    useEffect(() => { setSheet(0); setBack(false); }, [settings.pageRange, settings.customRange, settings.pagesPerSheet, settings.sides]);

    useEffect(() => {
        let disposed = false;
        let task: PDFDocumentLoadingTask | undefined;
        setLoading(true);
        setError('');
        setDocument(null);
        void (async () => {
            try {
                const pdfjs = await import('pdfjs-dist');
                const isImage = /\.(jpe?g|png|webp)$/i.test(file.name) || file.type.startsWith('image/');
                let targetFile = file;
                if (isImage) {
                    const { convertImageToPdf } = await import('@/lib/image-to-pdf');
                    const converted = await convertImageToPdf(file);
                    if (disposed) return;
                    targetFile = converted.pdfFile;
                }
                const data = await targetFile.arrayBuffer();
                if (disposed) return;
                pdfjs.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs';
                task = pdfjs.getDocument({ data, cMapUrl: '/pdfjs/cmaps/', cMapPacked: true, standardFontDataUrl: '/pdfjs/standard_fonts/', wasmUrl: '/pdfjs/wasm/' });
                task.onPassword = () => { void task?.destroy(); };
                const pdf = await task.promise;
                if (!disposed) setDocument(pdf);
            } catch (err) {
                console.error('[LivePrintPreview] Failed to open document:', err);
                if (!disposed) { setError('Could not open this preview. Close settings and try again.'); setLoading(false); }
            }
        })();
        return () => { disposed = true; void task?.destroy(); };
    }, [file]);

    useEffect(() => {
        if (!document) return;
        let disposed = false;
        let renderTask: RenderTask | undefined;
        setLoading(true);
        setError('');
        void (async () => {
            try {
                // Compose both physical sides off-screen, then publish them together.
                const scale = 1400 / Math.max(size.width, size.height);
                const canvases: HTMLCanvasElement[] = [];
                for (const numbers of [frontPages, backPages]) {
                    const output = window.document.createElement('canvas');
                    output.width = Math.round(size.width * scale);
                    output.height = Math.round(size.height * scale);
                    const ctx = output.getContext('2d');
                    if (!ctx) throw new Error('Canvas unavailable');
                    ctx.scale(scale, scale);
                    ctx.fillStyle = '#ffffff';
                    ctx.fillRect(0, 0, size.width, size.height);
                    const margin = settings.margins === 'none' ? 0 : settings.margins === 'minimum' ? 10 : 28;
                    const header = settings.headersFooters ? 16 : 0;
                    const columns = settings.pagesPerSheet === 2 ? (settings.orientation === 'landscape' ? 2 : 1) : Math.ceil(Math.sqrt(settings.pagesPerSheet));
                    const rows = Math.ceil(settings.pagesPerSheet / columns);
                    const gap = settings.pagesPerSheet > 1 ? 8 : 0;
                    const cellWidth = (size.width - margin * 2 - gap * (columns - 1)) / columns;
                    const cellHeight = (size.height - margin * 2 - header * 2 - gap * (rows - 1)) / rows;
                    for (let i = 0; i < numbers.length; i++) {
                        if (disposed) return;
                        const page = await document.getPage(numbers[i]);
                        if (disposed) return;
                        const natural = page.getViewport({ scale: 1 });
                        const fit = Math.min(cellWidth / natural.width, cellHeight / natural.height);
                        const zoom = settings.scale === 'custom' ? (settings.customScale ?? 100) / 100 : 1;
                        const layoutScale = settings.scale === 'custom' ? zoom : settings.scale === 'fit' ? fit : Math.min(1, fit);
                        const viewport = page.getViewport({ scale: Math.min(2, Math.max(0.1, layoutScale * scale)) });
                        const raster = window.document.createElement('canvas');
                        raster.width = Math.ceil(viewport.width);
                        raster.height = Math.ceil(viewport.height);
                        renderTask = page.render({ canvas: raster, viewport, background: '#ffffff' });
                        await renderTask.promise;
                        if (disposed) return;
                        const x = margin + (i % columns) * (cellWidth + gap);
                        const y = margin + header + Math.floor(i / columns) * (cellHeight + gap);
                        const width = natural.width * layoutScale, height = natural.height * layoutScale;
                        ctx.save();
                        ctx.beginPath(); ctx.rect(x, y, cellWidth, cellHeight); ctx.clip();
                        ctx.drawImage(raster, x + (cellWidth - width) / 2, y + (cellHeight - height) / 2, width, height);
                        ctx.restore();
                        raster.width = raster.height = 0;
                        page.cleanup();
                    }
                    if (settings.headersFooters && numbers.length) {
                        ctx.fillStyle = '#555555';
                        ctx.font = '9px sans-serif';
                        const inset = Math.max(12, margin);
                        ctx.fillText(file.name, inset, inset + 9, size.width - inset * 2);
                        ctx.textAlign = 'right';
                        ctx.fillText(`Pages ${numbers.join(', ')}`, size.width - inset, size.height - inset, size.width - inset * 2);
                    }
                    if (settings.color === 'bw') {
                        const pixels = ctx.getImageData(0, 0, output.width, output.height);
                        for (let i = 0; i < pixels.data.length; i += 4) {
                            const gray = Math.round(pixels.data[i] * 0.2126 + pixels.data[i + 1] * 0.7152 + pixels.data[i + 2] * 0.0722);
                            pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = gray;
                        }
                        ctx.putImageData(pixels, 0, 0);
                    }
                    canvases.push(output);
                }
                if (disposed) return;
                [frontCanvas.current, backCanvas.current].forEach((canvas, i) => {
                    if (!canvas) return;
                    canvas.width = canvases[i].width; canvas.height = canvases[i].height;
                    canvas.getContext('2d')?.drawImage(canvases[i], 0, 0);
                });
                setLoading(false);
                setRenderedKey(renderKey);
            } catch {
                if (!disposed) { setError('Could not render this page. Try another page or reopen settings.'); setLoading(false); setRenderedKey(renderKey); }
            }
        })();
        return () => { disposed = true; renderTask?.cancel(); };
    }, [document, renderKey]);

    return (
        <div className={styles.root} aria-label="Live print preview" aria-busy={updating && !error}>
            <div className={styles.heading}><strong>Live preview</strong><span>{settings.paperSize.toUpperCase()} · {settings.color === 'bw' ? 'B&W' : 'Color'}</span></div>
            <div className={styles.toolbar}>
                <button type="button" title="Previous sheet" aria-label="Previous sheet" disabled={currentSheet === 0 || !sheetCount} onClick={() => { setSheet(currentSheet - 1); setBack(false); }}><ChevronLeft size={18} /></button>
                <span>Sheet {sheetCount ? currentSheet + 1 : 0} of {sheetCount}</span>
                <button type="button" title="Next sheet" aria-label="Next sheet" disabled={currentSheet >= sheetCount - 1} onClick={() => { setSheet(currentSheet + 1); setBack(false); }}><ChevronRight size={18} /></button>
                {double && <button type="button" className={styles.flipButton} title="Flip sheet" aria-label="Flip sheet" disabled={updating || !sheetCount} onClick={() => setBack(!back)}><RotateCw size={16} /><span>{back ? 'Back' : 'Front'}</span></button>}
            </div>
            <div className={`${styles.stage} ${review ? styles.review : ''}`} style={{ '--paper-ratio': size.width / size.height } as CSSProperties}>
                <div className={`${styles.paper} ${back && double ? styles.flipped : ''}`} data-axis={axis} data-side={back && double ? 'back' : 'front'} style={{ aspectRatio: `${size.width} / ${size.height}`, visibility: error || !sheetCount ? 'hidden' : 'visible' }}>
                    <canvas ref={frontCanvas} className={styles.front} aria-label="Front of printed sheet" />
                    <canvas ref={backCanvas} className={styles.back} aria-label="Back of printed sheet" />
                </div>
                {updating && !error && <div className={styles.status} role="status"><Loader2 size={17} className={styles.spinner} /> Updating preview</div>}
                {(error || (!sheetCount && !loading)) && <div className={styles.empty} role="status"><FileWarning size={24} /><p>{error || 'Choose a valid page range to preview.'}</p></div>}
            </div>
            <div className={styles.details} aria-live="polite">
                <span>{visiblePages.length ? `Document ${visiblePages.length === 1 ? 'page' : 'pages'} ${visiblePages.join(', ')}` : !sheetCount ? 'No pages selected' : 'Blank back side'}</span>
                <span>{settings.copies} {settings.copies === 1 ? 'copy' : 'copies'} · {sheetCount * settings.copies} sheets total</span>
            </div>
            {double && <p className={styles.binding}>{settings.sides === 'double_long' ? 'Long-edge binding' : 'Short-edge binding'} · {back ? 'Back' : 'Front'} side</p>}
        </div>
    );
}

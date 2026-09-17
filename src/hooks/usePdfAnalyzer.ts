'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { convertImageToPdf } from '@/lib/image-to-pdf';
import { detectPageSize, MAX_DOCUMENT_BYTES, MAX_DOCUMENT_PAGES } from '@/lib/pdf-document';
import type { PDFDocumentLoadingTask } from 'pdfjs-dist';

export interface PageInfo {
    pageNumber: number;
    width: number;
    height: number;
    label: string;
    isColor: boolean;
    thumbnail?: string;
}

export interface PdfAnalysisResult {
    pageCount: number;
    pages: PageInfo[];
    suggestedColor: 'bw' | 'color';
    colorPageCount: number;
    bwPageCount: number;
    dominantSize: string;
    analyzing: boolean;
    error: string | null;
    convertedPdfFile?: File;
}

const emptyResult = (): PdfAnalysisResult => ({ pageCount: 0, pages: [], suggestedColor: 'bw', colorPageCount: 0, bwPageCount: 0, dominantSize: 'A4', analyzing: false, error: null });

function detectColor(canvas: HTMLCanvasElement): boolean {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Page previews are unavailable in this browser.');
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let colored = 0;
    for (let i = 0; i < data.length; i += 4) {
        const max = Math.max(data[i], data[i + 1], data[i + 2]);
        const min = Math.min(data[i], data[i + 1], data[i + 2]);
        if (max - min > 25 && ++colored >= 8) return true;
    }
    return false;
}

export function usePdfAnalyzer() {
    const [result, setResult] = useState<PdfAnalysisResult>(emptyResult);
    const latest = useRef(0);
    const mounted = useRef(true);
    const active = useRef(new Set<AbortController>());

    useEffect(() => {
        mounted.current = true;
        const controllers = active.current;
        return () => { mounted.current = false; controllers.forEach(controller => controller.abort()); controllers.clear(); };
    }, []);

    const analyze = useCallback(async (file: File, onProgress?: (result: PdfAnalysisResult) => void, signal?: AbortSignal): Promise<PdfAnalysisResult | null> => {
        if (!mounted.current) return null;
        const request = ++latest.current;
        const controller = new AbortController();
        active.current.add(controller);
        const cancel = () => controller.abort();
        signal?.addEventListener('abort', cancel, { once: true });
        if (signal?.aborted) controller.abort();
        let task: PDFDocumentLoadingTask | undefined;
        let passwordProtected = false;
        const destroy = () => { void task?.destroy(); };
        controller.signal.addEventListener('abort', destroy, { once: true });
        const publish = (value: PdfAnalysisResult) => {
            if (controller.signal.aborted) return;
            if (request === latest.current) setResult(value);
            onProgress?.(value);
        };
        publish({ ...emptyResult(), analyzing: true });
        try {
            if (file.size > MAX_DOCUMENT_BYTES) throw new Error('Choose a file smaller than 20 MB.');
            const isImage = /\.(jpe?g|png|webp)$/i.test(file.name) || ['image/jpeg', 'image/png', 'image/webp'].includes(file.type);
            const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
            if (!isImage && !isPdf) throw new Error('Save this document as a PDF, then upload it here.');
            const target = isImage ? (await convertImageToPdf(file)).pdfFile : file;
            const pdfjs = await import('pdfjs-dist');
            const data = await target.arrayBuffer();
            if (controller.signal.aborted) return null;
            pdfjs.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs';
            task = pdfjs.getDocument({ data, cMapUrl: '/pdfjs/cmaps/', cMapPacked: true, standardFontDataUrl: '/pdfjs/standard_fonts/', wasmUrl: '/pdfjs/wasm/' });
            task.onPassword = () => { passwordProtected = true; void task?.destroy(); };
            const pdf = await task.promise;
            if (pdf.numPages < 1 || pdf.numPages > MAX_DOCUMENT_PAGES) throw new Error(`Choose a PDF with 1-${MAX_DOCUMENT_PAGES} pages.`);
            const pages: PageInfo[] = [];
            const sizes: Record<string, number> = {};
            let colorPageCount = 0;
            let final = { ...emptyResult(), pageCount: pdf.numPages, analyzing: true };
            publish(final);
            for (let i = 1; i <= pdf.numPages; i++) {
                if (controller.signal.aborted) return null;
                const page = await pdf.getPage(i);
                const size = page.getViewport({ scale: 1 });
                const viewport = page.getViewport({ scale: Math.min(1, 420 / Math.max(size.width, size.height)) });
                const canvas = document.createElement('canvas');
                canvas.width = Math.max(1, Math.ceil(viewport.width));
                canvas.height = Math.max(1, Math.ceil(viewport.height));
                await page.render({ canvas, viewport, background: '#ffffff' }).promise;
                const isColor = detectColor(canvas);
                if (isColor) colorPageCount++;
                pages.push({ pageNumber: i, width: size.width, height: size.height, label: detectPageSize(size.width, size.height), isColor, thumbnail: i <= 5 ? canvas.toDataURL('image/jpeg', 0.8) : undefined });
                canvas.width = canvas.height = 0;
                page.cleanup();
                const label = pages[pages.length - 1].label;
                sizes[label] = (sizes[label] || 0) + 1;
                final = { pageCount: pdf.numPages, pages: [...pages], colorPageCount, bwPageCount: pages.length - colorPageCount, dominantSize: Object.entries(sizes).sort((a, b) => b[1] - a[1])[0][0], suggestedColor: colorPageCount ? 'color' : 'bw', analyzing: i < pdf.numPages, error: null, convertedPdfFile: isImage ? target : undefined };
                publish(final);
            }
            return final;
        } catch (error) {
            const message = passwordProtected ? 'Unlock this PDF before uploading it.' : error instanceof Error && /20 MB|1-500|Save this/.test(error.message) ? error.message : 'This file could not be opened. Upload a valid, unlocked PDF or image.';
            publish({ ...emptyResult(), error: message });
            return null;
        } finally {
            controller.signal.removeEventListener('abort', destroy);
            await task?.destroy();
            active.current.delete(controller);
            signal?.removeEventListener('abort', cancel);
        }
    }, []);

    const reset = useCallback(() => {
        latest.current++;
        active.current.forEach(controller => controller.abort());
        active.current.clear();
        setResult(emptyResult());
    }, []);
    return { ...result, analyze, reset };
}

/**
 * XerService Desktop — Bounded PDF.js Viewer
 *
 * Provides a self-contained vanilla TypeScript PDF viewer component
 * for the vendor order workspace. Uses PDF.js for real PDF rendering
 * with bounded resource management (only visible + adjacent pages rendered).
 *
 * Key design constraints from astraplan.md Section 11.3:
 * - Load PDF.js worker on demand (not at app startup)
 * - Bounded rendering: only visible/nearby pages, release stale canvases
 * - Load/error/retry states for expired auth, missing files, corruption
 * - Cleanup: destroy document proxy, release all canvases on close
 */

import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';

// ── Types ────────────────────────────────────────────────────────────

export interface PdfViewerOptions {
    /** Container element for the main canvas */
    canvasContainer: HTMLElement;
    /** Container element for the thumbnail strip */
    thumbnailContainer?: HTMLElement;
    /** Status/message container for load/error/empty states */
    statusContainer?: HTMLElement;
    /** Toolbar elements */
    pageInput?: HTMLInputElement;
    pageTotal?: HTMLElement;
    zoomSelect?: HTMLSelectElement;
    /** Callback when page count is known */
    onPageCountReady?: (count: number) => void;
    /** Callback on load error */
    onError?: (error: string) => void;
}

export type ZoomMode = 'fit-page' | 'fit-width' | number;

// ── Constants ────────────────────────────────────────────────────────

const THUMBNAIL_WIDTH = 120;
const MAX_CACHED_PAGES = 5; // bounded cache for rendered pages
const WORKER_PATH = '/pdfjs/pdf.worker.min.mjs';

// ── Worker initialization ────────────────────────────────────────────

let workerInitialized = false;

function ensureWorker() {
    if (workerInitialized) return;
    pdfjsLib.GlobalWorkerOptions.workerSrc = WORKER_PATH;
    workerInitialized = true;
}

// ── PdfViewer Class ──────────────────────────────────────────────────

export class PdfViewer {
    private options: PdfViewerOptions;
    private doc: PDFDocumentProxy | null = null;
    private currentPage = 1;
    private pageCount = 0;
    private zoom: ZoomMode = 'fit-page';
    private mainCanvas: HTMLCanvasElement;
    private renderTask: RenderTask | null = null;
    private thumbnailCanvases: Map<number, HTMLCanvasElement> = new Map();
    private pageCache: Map<number, PDFPageProxy> = new Map();
    private destroyed = false;

    constructor(options: PdfViewerOptions) {
        this.options = options;
        ensureWorker();

        // Create main canvas
        this.mainCanvas = document.createElement('canvas');
        this.mainCanvas.className = 'pdf-main-canvas';
        this.options.canvasContainer.innerHTML = '';
        this.options.canvasContainer.appendChild(this.mainCanvas);

        this.showStatus('loading', 'Preparing document viewer…');
    }

    // ── Public API ───────────────────────────────────────────────────

    async loadDocument(data: ArrayBuffer): Promise<void> {
        if (this.destroyed) return;
        this.cleanup();
        this.showStatus('loading', 'Loading PDF document…');

        try {
            const loadingTask = pdfjsLib.getDocument({
                data: new Uint8Array(data),
                cMapUrl: '/pdfjs/cmaps/',
                cMapPacked: true,
                standardFontDataUrl: '/pdfjs/standard_fonts/',
            });

            this.doc = await loadingTask.promise;
            this.pageCount = this.doc.numPages;
            this.currentPage = 1;

            // Update toolbar
            if (this.options.pageTotal) {
                this.options.pageTotal.textContent = `of ${this.pageCount}`;
            }
            if (this.options.pageInput) {
                this.options.pageInput.value = '1';
                this.options.pageInput.max = String(this.pageCount);
            }

            this.options.onPageCountReady?.(this.pageCount);
            this.hideStatus();
            await this.renderCurrentPage();
            this.renderThumbnails();
        } catch (err: any) {
            const msg = err?.message || 'Failed to load PDF document';
            let friendlyMsg = msg;
            if (msg.includes('Invalid PDF') || msg.includes('bad XRef')) {
                friendlyMsg = 'This PDF file appears to be corrupted or invalid.';
            } else if (msg.includes('password')) {
                friendlyMsg = 'This PDF is password-protected and cannot be previewed.';
            }
            this.showStatus('error', friendlyMsg);
            this.options.onError?.(friendlyMsg);
        }
    }

    getPageCount(): number {
        return this.pageCount;
    }

    getCurrentPage(): number {
        return this.currentPage;
    }

    async setPage(n: number): Promise<void> {
        if (this.destroyed || !this.doc) return;
        const page = Math.max(1, Math.min(n, this.pageCount));
        if (page === this.currentPage) return;
        this.currentPage = page;
        if (this.options.pageInput) {
            this.options.pageInput.value = String(page);
        }
        this.updateThumbnailHighlight();
        await this.renderCurrentPage();
    }

    async nextPage(): Promise<void> {
        await this.setPage(this.currentPage + 1);
    }

    async prevPage(): Promise<void> {
        await this.setPage(this.currentPage - 1);
    }

    async setZoom(mode: ZoomMode): Promise<void> {
        if (this.destroyed) return;
        this.zoom = mode;
        if (this.options.zoomSelect && typeof mode === 'string') {
            this.options.zoomSelect.value = mode;
        }
        await this.renderCurrentPage();
    }

    destroy(): void {
        this.destroyed = true;
        this.cancelRender();
        this.cleanup();

        // Clear canvases
        this.mainCanvas.width = 0;
        this.mainCanvas.height = 0;
        this.options.canvasContainer.innerHTML = '';

        // Clear thumbnails
        if (this.options.thumbnailContainer) {
            this.options.thumbnailContainer.innerHTML = '';
        }
        this.thumbnailCanvases.clear();
    }

    // ── Private: Rendering ───────────────────────────────────────────

    private async renderCurrentPage(): Promise<void> {
        if (this.destroyed || !this.doc) return;
        this.cancelRender();

        try {
            const page = await this.getPage(this.currentPage);
            const containerWidth = this.options.canvasContainer.clientWidth - 32; // padding
            const containerHeight = this.options.canvasContainer.clientHeight - 32;

            const unscaledViewport = page.getViewport({ scale: 1 });
            let scale: number;

            if (typeof this.zoom === 'number') {
                scale = this.zoom / 100;
            } else if (this.zoom === 'fit-width') {
                scale = containerWidth / unscaledViewport.width;
            } else {
                // fit-page
                const scaleW = containerWidth / unscaledViewport.width;
                const scaleH = containerHeight / unscaledViewport.height;
                scale = Math.min(scaleW, scaleH, 3); // cap at 3x
            }

            scale = Math.max(0.1, Math.min(scale, 5)); // clamp 10%-500%
            const viewport = page.getViewport({ scale });

            const dpr = window.devicePixelRatio || 1;
            this.mainCanvas.width = Math.floor(viewport.width * dpr);
            this.mainCanvas.height = Math.floor(viewport.height * dpr);
            this.mainCanvas.style.width = `${Math.floor(viewport.width)}px`;
            this.mainCanvas.style.height = `${Math.floor(viewport.height)}px`;

            const ctx = this.mainCanvas.getContext('2d');
            if (!ctx) return;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

            this.renderTask = page.render({
                canvasContext: ctx,
                viewport,
                canvas: this.mainCanvas,
            });
            await this.renderTask.promise;
            this.renderTask = null;

            // Bounded cache eviction
            this.evictPageCache();
        } catch (err: any) {
            if (err?.name !== 'RenderingCancelledException') {
                console.warn('[PdfViewer] Render error:', err?.message);
            }
        }
    }

    private async renderThumbnails(): Promise<void> {
        if (this.destroyed || !this.doc || !this.options.thumbnailContainer) return;

        const container = this.options.thumbnailContainer;
        container.innerHTML = '';
        this.thumbnailCanvases.clear();

        // Only render first ~20 thumbnails for bounded memory
        const maxThumbs = Math.min(this.pageCount, 20);

        for (let i = 1; i <= maxThumbs; i++) {
            const wrapper = document.createElement('div');
            wrapper.className = `pdf-thumb-wrapper ${i === this.currentPage ? 'active' : ''}`;
            wrapper.setAttribute('data-page', String(i));

            const canvas = document.createElement('canvas');
            canvas.className = 'pdf-thumb-canvas';
            wrapper.appendChild(canvas);

            const label = document.createElement('span');
            label.className = 'pdf-thumb-label';
            label.textContent = String(i);
            wrapper.appendChild(label);

            wrapper.addEventListener('click', () => this.setPage(i));
            container.appendChild(wrapper);
            this.thumbnailCanvases.set(i, canvas);

            // Render thumbnail asynchronously
            this.renderThumbnail(i, canvas).catch(() => { /* non-critical */ });
        }

        if (this.pageCount > maxThumbs) {
            const more = document.createElement('div');
            more.className = 'pdf-thumb-more';
            more.textContent = `+${this.pageCount - maxThumbs} more pages`;
            container.appendChild(more);
        }
    }

    private async renderThumbnail(pageNum: number, canvas: HTMLCanvasElement): Promise<void> {
        if (this.destroyed || !this.doc) return;
        try {
            const page = await this.doc.getPage(pageNum);
            const unscaledVp = page.getViewport({ scale: 1 });
            const scale = THUMBNAIL_WIDTH / unscaledVp.width;
            const viewport = page.getViewport({ scale });

            canvas.width = Math.floor(viewport.width);
            canvas.height = Math.floor(viewport.height);

            const ctx = canvas.getContext('2d');
            if (!ctx) return;
            await page.render({ canvasContext: ctx, viewport, canvas }).promise;
        } catch { /* ignore thumbnail failures */ }
    }

    private updateThumbnailHighlight(): void {
        if (!this.options.thumbnailContainer) return;
        this.options.thumbnailContainer.querySelectorAll('.pdf-thumb-wrapper').forEach(el => {
            const pg = el.getAttribute('data-page');
            el.classList.toggle('active', pg === String(this.currentPage));
        });
    }

    // ── Private: Page cache ──────────────────────────────────────────

    private async getPage(pageNum: number): Promise<PDFPageProxy> {
        if (this.pageCache.has(pageNum)) {
            return this.pageCache.get(pageNum)!;
        }
        if (!this.doc) throw new Error('No document loaded');
        const page = await this.doc.getPage(pageNum);
        this.pageCache.set(pageNum, page);
        return page;
    }

    private evictPageCache(): void {
        if (this.pageCache.size <= MAX_CACHED_PAGES) return;
        // Keep current ± 2 pages, evict everything else
        const keep = new Set<number>();
        for (let i = this.currentPage - 2; i <= this.currentPage + 2; i++) {
            if (i >= 1 && i <= this.pageCount) keep.add(i);
        }
        for (const [pageNum, page] of this.pageCache) {
            if (!keep.has(pageNum)) {
                page.cleanup();
                this.pageCache.delete(pageNum);
            }
        }
    }

    // ── Private: Render lifecycle ────────────────────────────────────

    private cancelRender(): void {
        if (this.renderTask) {
            try { this.renderTask.cancel(); } catch { /* ignore */ }
            this.renderTask = null;
        }
    }

    private cleanup(): void {
        this.cancelRender();
        for (const [, page] of this.pageCache) {
            try { page.cleanup(); } catch { /* ignore */ }
        }
        this.pageCache.clear();
        if (this.doc) {
            try { this.doc.cleanup(); } catch { /* ignore */ }
            try { this.doc.loadingTask?.destroy(); } catch { /* ignore */ }
            this.doc = null;
        }
    }

    // ── Private: Status display ──────────────────────────────────────

    private showStatus(type: 'loading' | 'error' | 'empty', message: string): void {
        // Show in canvas container as overlay
        const existing = this.options.canvasContainer.querySelector('.pdf-status-overlay');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.className = `pdf-status-overlay pdf-status-${type}`;
        overlay.innerHTML = type === 'loading'
            ? `<div class="pdf-status-spinner"></div><p>${message}</p>`
            : type === 'error'
            ? `<div class="pdf-status-icon">⚠️</div><p>${message}</p><button class="btn-secondary pdf-retry-btn">Retry</button>`
            : `<div class="pdf-status-icon">📄</div><p>${message}</p>`;

        this.options.canvasContainer.appendChild(overlay);

        // Hide canvas while status is showing
        this.mainCanvas.style.display = 'none';
    }

    private hideStatus(): void {
        const existing = this.options.canvasContainer.querySelector('.pdf-status-overlay');
        if (existing) existing.remove();
        this.mainCanvas.style.display = 'block';
    }
}

// ── Factory ──────────────────────────────────────────────────────────

export function createPdfViewer(options: PdfViewerOptions): PdfViewer {
    return new PdfViewer(options);
}

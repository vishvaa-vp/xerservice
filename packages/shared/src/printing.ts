/**
 * Authoritative Print Calculation & Mapping Utilities
 * Pure geometry, imposition, and format-mapping algorithms.
 */

import type { PrintSettings, DbPrintSettings, PaperSize } from '@packages/types';

export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;
export const MAX_DOCUMENT_PAGES = 500;

export function selectedPageNumbers(count: number, settings: Pick<PrintSettings, 'pageRange' | 'customRange'>): number[] {
    if (settings.pageRange === 'range') {
        const pages = new Set<number>();
        for (const part of settings.customRange.split(',')) {
            const match = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
            if (!match) return [];
            const start = Number(match[1]), end = Number(match[2] || match[1]);
            if (start < 1 || end > count || start > end) return [];
            for (let page = start; page <= end; page++) pages.add(page);
        }
        return Array.from(pages).sort((a, b) => a - b);
    }
    return Array.from({ length: count }, (_, i) => i + 1).filter(page => settings.pageRange === 'all' || page % 2 === (settings.pageRange === 'odd' ? 1 : 0));
}

export function sheetDimensions(settings: Pick<PrintSettings, 'paperSize' | 'orientation'>) {
    const sizes: Record<PaperSize, [number, number]> = {
        a4: [595.28, 841.89],
        a3: [841.89, 1190.55],
        legal: [612, 1008],
    };
    const [short, long] = sizes[settings.paperSize] || sizes.a4;
    return settings.orientation === 'landscape' ? { width: long, height: short } : { width: short, height: long };
}

export function pagesOnSide(pages: number[], sheet: number, back: boolean, settings: Pick<PrintSettings, 'sides' | 'pagesPerSheet'>) {
    const sides = settings.sides === 'single' ? 1 : 2;
    const offset = (sheet * sides + (back ? 1 : 0)) * settings.pagesPerSheet;
    return pages.slice(offset, offset + settings.pagesPerSheet);
}

export function detectPageSize(width: number, height: number): string {
    const [short, long] = [Math.min(width, height), Math.max(width, height)];
    const sizes = [['A4', 595.28, 841.89], ['A3', 841.89, 1190.55], ['Letter', 612, 792], ['Legal', 612, 1008], ['A5', 419.53, 595.28]] as const;
    return sizes.find(([, w, h]) => Math.abs(short - w) < 10 && Math.abs(long - h) < 10)?.[0] ?? 'Custom';
}

export function toDbPrintSettings(settings: PrintSettings): DbPrintSettings {
    return {
        colour_mode: settings.color === 'color' ? 'COLOUR' : 'BW',
        sides: settings.sides === 'double_long' ? 'DOUBLE_LONG_EDGE' : settings.sides === 'double_short' ? 'DOUBLE_SHORT_EDGE' : 'SINGLE',
        orientation: settings.orientation === 'landscape' ? 'LANDSCAPE' : 'PORTRAIT',
        copies: Math.max(1, settings.copies || 1),
        pages_per_sheet: Math.max(1, settings.pagesPerSheet || 1),
        paper_size: (settings.paperSize || 'a4').toUpperCase(),
        margin: (settings.margins || 'default').toUpperCase(),
        page_selection: (settings.pageRange || 'all').toUpperCase() as DbPrintSettings['page_selection'],
        page_range: settings.pageRange === 'range' ? (settings.customRange || null) : null,
        scale: (settings.scale || 'default').toUpperCase(),
        ...(settings.scale === 'custom' ? { custom_scale: Math.min(200, Math.max(10, settings.customScale ?? 100)) } : {}),
        include_filename_page_numbers: Boolean(settings.headersFooters),
    };
}

export function fromDbPrintSettings(db: Partial<DbPrintSettings>): PrintSettings {
    const color: 'bw' | 'color' = db.colour_mode === 'COLOUR' ? 'color' : 'bw';
    const sides: 'single' | 'double_long' | 'double_short' =
        db.sides === 'DOUBLE_SHORT_EDGE' ? 'double_short' :
        db.sides === 'DOUBLE_LONG_EDGE' ? 'double_long' : 'single';
    const orientation: 'portrait' | 'landscape' = db.orientation === 'LANDSCAPE' ? 'landscape' : 'portrait';
    const paperSize: 'a4' | 'a3' | 'legal' =
        db.paper_size?.toLowerCase() === 'a3' ? 'a3' :
        db.paper_size?.toLowerCase() === 'legal' ? 'legal' : 'a4';
    const margins: 'default' | 'none' | 'minimum' =
        db.margin?.toLowerCase() === 'none' ? 'none' :
        db.margin?.toLowerCase() === 'minimum' ? 'minimum' : 'default';
    const pageRange: 'all' | 'odd' | 'even' | 'range' =
        db.page_selection?.toLowerCase() === 'odd' ? 'odd' :
        db.page_selection?.toLowerCase() === 'even' ? 'even' :
        db.page_selection?.toLowerCase() === 'range' ? 'range' : 'all';
    const scale: 'default' | 'fit' | 'custom' =
        db.scale?.toLowerCase() === 'fit' ? 'fit' :
        db.scale?.toLowerCase() === 'custom' ? 'custom' : 'default';

    return {
        customScale: Number(db.custom_scale ?? 100),
        copies: Math.max(1, db.copies || 1),
        color,
        sides,
        paperSize,
        orientation,
        pagesPerSheet: Math.max(1, db.pages_per_sheet || 1),
        pageRange,
        customRange: db.page_range || '',
        margins,
        scale,
        headersFooters: Boolean(db.include_filename_page_numbers),
        addonIds: [],
    };
}

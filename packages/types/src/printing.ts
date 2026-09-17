/**
 * Authoritative Print Specification Types for XerService
 * Pure domain contracts for print settings and layout definitions.
 */

export type ColorMode = 'bw' | 'color';
export type PrintSides = 'single' | 'double_long' | 'double_short';
export type PaperSize = 'a4' | 'a3' | 'legal';
export type PageOrientation = 'portrait' | 'landscape';
export type PageSelectionMode = 'all' | 'odd' | 'even' | 'range';
export type MarginMode = 'default' | 'none' | 'minimum';
export type ScaleMode = 'default' | 'fit' | 'custom';

export interface PrintSettings {
    copies: number;
    color: ColorMode;
    sides: PrintSides;
    paperSize: PaperSize;
    orientation: PageOrientation;
    pagesPerSheet: number;
    pageRange: PageSelectionMode;
    customRange: string;
    margins: MarginMode;
    scale: ScaleMode;
    customScale?: number;
    headersFooters: boolean;
    addonIds?: string[];
}

export interface DbPrintSettings {
    colour_mode: 'BW' | 'COLOUR';
    sides: 'SINGLE' | 'DOUBLE_LONG_EDGE' | 'DOUBLE_SHORT_EDGE';
    orientation: 'PORTRAIT' | 'LANDSCAPE';
    copies: number;
    pages_per_sheet: number;
    paper_size: string;
    margin: string;
    page_selection: 'ALL' | 'ODD' | 'EVEN' | 'RANGE';
    page_range: string | null;
    custom_scale?: number;
    scale: string;
    include_filename_page_numbers: boolean;
}

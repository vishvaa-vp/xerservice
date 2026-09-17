/**
 * XerService Authoritative Server-Side Pricing Engine
 *
 * Implements strict, server-authoritative document page selection,
 * printable page calculation, imposition (pages per sheet),
 * duplex sheet calculation, and financial snapshot arithmetic.
 */

export type PageSelectionMode = 'ALL' | 'ODD' | 'EVEN' | 'RANGE';
export type PrintSides = 'SINGLE' | 'DOUBLE_LONG_EDGE' | 'DOUBLE_SHORT_EDGE';

export interface PageSelectionResult {
    selectedPagesCount: number;
    selectedPagesList: number[];
}

export interface FilePricingInput {
    originalPages: number;
    pageSelection: PageSelectionMode;
    pageRange: string | null;
    pagesPerSheet: number;
    sides: PrintSides;
    copies: number;
    unitPrice: number; // shop_pricing.price_per_sheet
}

export interface FilePricingResult {
    originalPages: number;
    selectedPages: number;
    printablePages: number;
    printedSidesPerCopy: number;
    sheetsPerCopy: number;
    physicalSheets: number;
    unitPrice: number;
    lineTotal: number;
}

/**
 * Validates and parses document page selection against authoritative original page count.
 * Enforces:
 * - Rejects 0 or negative pages
 * - Rejects page references > originalPages
 * - Rejects inverted ranges (e.g. "5-3")
 * - Deduplicates repeated page references (e.g. "1,1,2" -> {1, 2})
 */
export function evaluatePageSelection(
    originalPages: number,
    mode: PageSelectionMode,
    rangeString: string | null
): PageSelectionResult {
    if (!Number.isInteger(originalPages) || originalPages < 1) {
        throw new Error(`Invalid original page count: ${originalPages}`);
    }

    if (mode === 'ALL') {
        const pages: number[] = [];
        for (let i = 1; i <= originalPages; i++) pages.push(i);
        return { selectedPagesCount: originalPages, selectedPagesList: pages };
    }

    if (mode === 'ODD') {
        const pages: number[] = [];
        for (let i = 1; i <= originalPages; i += 2) pages.push(i);
        return { selectedPagesCount: pages.length, selectedPagesList: pages };
    }

    if (mode === 'EVEN') {
        const pages: number[] = [];
        for (let i = 2; i <= originalPages; i += 2) pages.push(i);
        return { selectedPagesCount: pages.length, selectedPagesList: pages };
    }

    if (mode === 'RANGE') {
        if (!rangeString || rangeString.trim() === '') {
            throw new Error('Page range specification cannot be empty.');
        }

        const uniquePages = new Set<number>();
        const parts = rangeString.split(',');

        for (const rawPart of parts) {
            const part = rawPart.trim();
            if (!part) {
                throw new Error('Page range contains an empty segment.');
            }

            const match = part.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
            if (!match) {
                throw new Error(`Malformed page range expression: "${part}". Expected format like "1-3" or "5".`);
            }

            const start = Number(match[1]);
            const end = Number(match[2] || match[1]);

            if (start === 0 || end === 0) {
                throw new Error('Page numbers must be greater than or equal to 1.');
            }

            if (start < 1) {
                throw new Error(`Invalid starting page: ${start}. Page numbers start at 1.`);
            }

            if (end > originalPages) {
                throw new Error(`Page reference ${end} exceeds the document total (${originalPages}).`);
            }

            if (start > end) {
                throw new Error(`Inverted page range "${part}": start (${start}) cannot be greater than end (${end}).`);
            }

            for (let p = start; p <= end; p++) {
                uniquePages.add(p);
            }
        }

        if (uniquePages.size === 0) {
            throw new Error('Page range resulted in 0 selected pages.');
        }

        const sortedPages = Array.from(uniquePages).sort((a, b) => a - b);
        return {
            selectedPagesCount: sortedPages.length,
            selectedPagesList: sortedPages,
        };
    }

    throw new Error(`Unsupported page selection mode: ${mode}`);
}

/**
 * Calculates authoritative document file pricing including imposition and sheet math.
 */
export function calculateFilePricing(input: FilePricingInput): FilePricingResult {
    const { originalPages, pageSelection, pageRange, pagesPerSheet, sides, copies, unitPrice } = input;

    if (!Number.isInteger(copies) || copies < 1) {
        throw new Error(`Copies must be an integer >= 1 (received ${copies})`);
    }

    if (!Number.isInteger(pagesPerSheet) || pagesPerSheet < 1) {
        throw new Error(`pagesPerSheet must be an integer >= 1 (received ${pagesPerSheet})`);
    }

    if (unitPrice < 0) {
        throw new Error(`unitPrice cannot be negative (received ${unitPrice})`);
    }

    // 1. Evaluate selected pages
    const { selectedPagesCount } = evaluatePageSelection(originalPages, pageSelection, pageRange);

    // 2. Imposition: calculate printed sides per copy
    // e.g. 5 selected pages at 2 pages/sheet = 3 sides per copy
    const printedSidesPerCopy = Math.ceil(selectedPagesCount / pagesPerSheet);

    // 3. Duplex calculation: calculate sheets per copy
    let sheetsPerCopy: number;
    if (sides === 'SINGLE') {
        sheetsPerCopy = printedSidesPerCopy;
    } else if (sides === 'DOUBLE_LONG_EDGE' || sides === 'DOUBLE_SHORT_EDGE') {
        sheetsPerCopy = Math.ceil(printedSidesPerCopy / 2);
    } else {
        throw new Error(`Unsupported sides configuration: ${sides}`);
    }

    // 4. Physical sheets for all copies
    const physicalSheets = sheetsPerCopy * copies;

    // 5. Authoritative Line Total in ₹ (rounded to 2 decimals)
    const rawLineTotal = physicalSheets * unitPrice;
    const lineTotal = Math.round(rawLineTotal * 100) / 100;

    return {
        originalPages,
        selectedPages: selectedPagesCount,
        printablePages: selectedPagesCount * copies,
        printedSidesPerCopy,
        sheetsPerCopy,
        physicalSheets,
        unitPrice,
        lineTotal,
    };
}

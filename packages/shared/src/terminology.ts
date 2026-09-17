/**
 * @packages/shared/terminology
 * Authoritative Unified Domain Terminology for XerService.
 * Pure domain definitions, string normalizers, and formatting helpers.
 * Shared across Customer Web, Vendor Desktop Shell, and Admin Portal.
 * Zero database side-effects, zero runtime dependencies.
 */

// ============================================================================
// 1. Physical Imposition Concepts: Sides, Pages, Sheets
// ============================================================================

export interface PrintSidesInfo {
    key: string;
    /** Human-readable primary label (e.g. "Single-sided (1 side / sheet)") */
    label: string;
    /** Concise label for compact tables and badges (e.g. "Single-sided") */
    shortLabel: string;
    /** Industry technical nomenclature (e.g. "Simplex", "Duplex (Long Edge)") */
    technicalLabel: string;
    /** Number of printable sides per physical sheet (1 or 2) */
    sidesPerSheet: number;
    /** Whether this mode is double-sided */
    isDuplex: boolean;
}

/**
 * Normalizes any sides identifier into authoritative PrintSidesInfo.
 * Accepts: 'single', 'SINGLE', 'double', 'double_long', 'DOUBLE_LONG_EDGE', 'double_short', 'DOUBLE_SHORT_EDGE'
 */
export function formatPrintSidesMode(rawSides?: string | null): PrintSidesInfo {
    const s = String(rawSides || '').toLowerCase().trim();

    if (s === 'double_short' || s === 'double_short_edge' || s.includes('short')) {
        return {
            key: 'double_short',
            label: 'Double-sided (Short Edge Flip)',
            shortLabel: 'Double-sided',
            technicalLabel: 'Duplex (Short Edge)',
            sidesPerSheet: 2,
            isDuplex: true,
        };
    }

    if (s === 'double' || s === 'double_long' || s === 'double_long_edge' || s.includes('double') || s.includes('duplex')) {
        return {
            key: 'double_long',
            label: 'Double-sided (Long Edge Flip)',
            shortLabel: 'Double-sided',
            technicalLabel: 'Duplex (Long Edge)',
            sidesPerSheet: 2,
            isDuplex: true,
        };
    }

    // Default to single-sided (Simplex)
    return {
        key: 'single',
        label: 'Single-sided (1 side / sheet)',
        shortLabel: 'Single-sided',
        technicalLabel: 'Simplex',
        sidesPerSheet: 1,
        isDuplex: false,
    };
}

/** Formats document logical page count (e.g. "1 page", "10 pages") */
export function formatDocumentPages(count: number): string {
    const c = Math.max(0, Math.round(count || 0));
    return `${c} ${c === 1 ? 'page' : 'pages'}`;
}

/** Formats printable side impressions (e.g. "1 printed side", "10 printed sides") */
export function formatPrintableSides(count: number): string {
    const c = Math.max(0, Math.round(count || 0));
    return `${c} ${c === 1 ? 'printed side' : 'printed sides'}`;
}

/** Formats physical paper sheet count (e.g. "1 physical sheet", "5 physical sheets") */
export function formatPhysicalSheets(count: number): string {
    const c = Math.max(0, Math.round(count || 0));
    return `${c} ${c === 1 ? 'physical sheet' : 'physical sheets'}`;
}

export interface PaperSidesSheetsSummary {
    pages: number;
    pagesText: string;
    sidesInfo: PrintSidesInfo;
    printedSides: number;
    printedSidesText: string;
    physicalSheetsPerCopy: number;
    totalPhysicalSheets: number;
    sheetsText: string;
    duplexSavingsSheets: number;
    summary: string;
}

/**
 * Standard calculation and narrative for sides, pages, and sheets imposition.
 */
export function formatPaperSidesAndSheets(
    pages: number,
    sides: string,
    copies: number = 1
): PaperSidesSheetsSummary {
    const safePages = Math.max(0, Math.round(pages || 0));
    const safeCopies = Math.max(1, Math.round(copies || 1));
    const sidesInfo = formatPrintSidesMode(sides);

    const printedSides = safePages;
    const physicalSheetsPerCopy = sidesInfo.isDuplex
        ? Math.ceil(safePages / 2)
        : safePages;
    const totalPhysicalSheets = physicalSheetsPerCopy * safeCopies;

    const simplexEquivalentSheets = safePages * safeCopies;
    const duplexSavingsSheets = sidesInfo.isDuplex
        ? Math.max(0, simplexEquivalentSheets - totalPhysicalSheets)
        : 0;

    const pagesText = formatDocumentPages(safePages);
    const printedSidesText = formatPrintableSides(printedSides);
    const sheetsText = formatPhysicalSheets(totalPhysicalSheets);

    let summary = `${pagesText} • ${sidesInfo.shortLabel} • ${sheetsText}`;
    if (safeCopies > 1) {
        summary += ` (${safeCopies} ${safeCopies === 1 ? 'copy' : 'copies'})`;
    }
    if (duplexSavingsSheets > 0) {
        summary += ` [${duplexSavingsSheets} ${duplexSavingsSheets === 1 ? 'sheet' : 'sheets'} saved]`;
    }

    return {
        pages: safePages,
        pagesText,
        sidesInfo,
        printedSides,
        printedSidesText,
        physicalSheetsPerCopy,
        totalPhysicalSheets,
        sheetsText,
        duplexSavingsSheets,
        summary,
    };
}

// ============================================================================
// 2. Order Lifecycle & Hardware Statuses
// ============================================================================

export type UnifiedOrderStatusKey =
    | 'DRAFT'
    | 'AWAITING_PAYMENT'
    | 'PAID'
    | 'QUEUED'
    | 'PRINTING'
    | 'READY'
    | 'COMPLETED'
    | 'CANCELLED'
    | 'REFUNDED';

export interface OrderStatusDefinition {
    key: UnifiedOrderStatusKey;
    label: string;
    badgeClass: string;
    description: string;
    stepIndex: number;
    isTerminal: boolean;
}

export const ORDER_STATUS_DEFINITIONS: Record<UnifiedOrderStatusKey, OrderStatusDefinition> = {
    DRAFT: {
        key: 'DRAFT',
        label: 'Draft',
        badgeClass: 'badge-neutral',
        description: 'Customer is configuring print options and uploading documents.',
        stepIndex: 0,
        isTerminal: false,
    },
    AWAITING_PAYMENT: {
        key: 'AWAITING_PAYMENT',
        label: 'Awaiting Payment',
        badgeClass: 'badge-warning',
        description: 'Order submitted; awaiting customer payment confirmation.',
        stepIndex: 1,
        isTerminal: false,
    },
    PAID: {
        key: 'PAID',
        label: 'Payment Confirmed',
        badgeClass: 'badge-success',
        description: 'Payment authorized; order entering shop production queue.',
        stepIndex: 2,
        isTerminal: false,
    },
    QUEUED: {
        key: 'QUEUED',
        label: 'Queued for Printing',
        badgeClass: 'badge-info',
        description: 'In print queue; awaiting machine assignment and vendor print release.',
        stepIndex: 3,
        isTerminal: false,
    },
    PRINTING: {
        key: 'PRINTING',
        label: 'Printing',
        badgeClass: 'badge-accent',
        description: 'Active hardware print job currently executing.',
        stepIndex: 4,
        isTerminal: false,
    },
    READY: {
        key: 'READY',
        label: 'Ready for Pickup',
        badgeClass: 'badge-emerald',
        description: 'Printed, inspected, and packaged; ready for customer collection.',
        stepIndex: 5,
        isTerminal: false,
    },
    COMPLETED: {
        key: 'COMPLETED',
        label: 'Completed',
        badgeClass: 'badge-success',
        description: 'Collected by customer; order fulfilled.',
        stepIndex: 6,
        isTerminal: true,
    },
    CANCELLED: {
        key: 'CANCELLED',
        label: 'Cancelled',
        badgeClass: 'badge-error',
        description: 'Order cancelled before fulfillment.',
        stepIndex: -1,
        isTerminal: true,
    },
    REFUNDED: {
        key: 'REFUNDED',
        label: 'Refunded',
        badgeClass: 'badge-purple',
        description: 'Payment returned to customer wallet or source account.',
        stepIndex: -1,
        isTerminal: true,
    },
};

/**
 * Maps raw database or API status string to authoritative OrderStatusDefinition.
 */
export function formatOrderStatus(rawStatus?: string | null): OrderStatusDefinition {
    const s = String(rawStatus || '').toUpperCase().trim();

    if (s === 'DRAFT') return ORDER_STATUS_DEFINITIONS.DRAFT;
    if (s === 'AWAITING_PAYMENT' || s === 'SUBMITTED' || s === 'PENDING' || s === 'PENDING_PAYMENT') {
        return ORDER_STATUS_DEFINITIONS.AWAITING_PAYMENT;
    }
    if (s === 'PAID') return ORDER_STATUS_DEFINITIONS.PAID;
    if (s === 'QUEUED') return ORDER_STATUS_DEFINITIONS.QUEUED;
    if (s === 'PRINTING' || s === 'IN_PRINT') return ORDER_STATUS_DEFINITIONS.PRINTING;
    if (s === 'READY' || s === 'READY_FOR_PICKUP' || s === 'READY_TO_PICKUP') {
        return ORDER_STATUS_DEFINITIONS.READY;
    }
    if (s === 'COMPLETED' || s === 'FULFILLED' || s === 'PICKED_UP') {
        return ORDER_STATUS_DEFINITIONS.COMPLETED;
    }
    if (s === 'CANCELLED' || s === 'CANCELED') return ORDER_STATUS_DEFINITIONS.CANCELLED;
    if (s === 'REFUNDED') return ORDER_STATUS_DEFINITIONS.REFUNDED;

    // Fallback for custom or unknown statuses
    return {
        key: 'QUEUED',
        label: rawStatus || 'Unknown',
        badgeClass: 'badge-neutral',
        description: 'Status update recorded.',
        stepIndex: 1,
        isTerminal: false,
    };
}

export type HardwareStatusKey =
    | 'OFFLINE'
    | 'CONNECTING'
    | 'READY'
    | 'BUSY'
    | 'PRINTING'
    | 'PAPER_JAM'
    | 'OUT_OF_PAPER'
    | 'ERROR';

export interface HardwareStatusDefinition {
    key: HardwareStatusKey;
    label: string;
    badgeClass: string;
    isReadyForJobs: boolean;
}

export function formatPrinterHardwareStatus(rawStatus?: string | null): HardwareStatusDefinition {
    const s = String(rawStatus || '').toUpperCase().trim();

    if (s.includes('JAM')) {
        return { key: 'PAPER_JAM', label: 'Paper Jam', badgeClass: 'badge-error', isReadyForJobs: false };
    }
    if (s.includes('OUT_OF_PAPER') || s.includes('EMPTY')) {
        return { key: 'OUT_OF_PAPER', label: 'Out of Paper', badgeClass: 'badge-warning', isReadyForJobs: false };
    }
    if (s === 'PRINTING' || s.includes('BUSY')) {
        return { key: 'PRINTING', label: 'Printing', badgeClass: 'badge-accent', isReadyForJobs: false };
    }
    if (s === 'CONNECTING') {
        return { key: 'CONNECTING', label: 'Connecting', badgeClass: 'badge-info', isReadyForJobs: false };
    }
    if (s === 'OFFLINE' || s.includes('DISCONNECT')) {
        return { key: 'OFFLINE', label: 'Offline', badgeClass: 'badge-neutral', isReadyForJobs: false };
    }
    if (s === 'READY' || s === 'IDLE' || s === 'ONLINE') {
        return { key: 'READY', label: 'Ready', badgeClass: 'badge-success', isReadyForJobs: true };
    }

    return { key: 'ERROR', label: 'Hardware Alert', badgeClass: 'badge-error', isReadyForJobs: false };
}

// ============================================================================
// 3. Print Services, Add-ons & Paper Capabilities
// ============================================================================

export interface ServiceDefinition {
    key: string;
    label: string;
    category: 'paper_size' | 'colour_mode' | 'finishing';
    description: string;
}

export const PAPER_SIZES: Record<string, ServiceDefinition> = {
    a4: { key: 'a4', label: 'A4 Paper', category: 'paper_size', description: 'Standard document paper (210 × 297 mm)' },
    a3: { key: 'a3', label: 'A3 Paper', category: 'paper_size', description: 'Double standard paper (297 × 420 mm)' },
    legal: { key: 'legal', label: 'Legal Paper', category: 'paper_size', description: 'Extended legal documents (216 × 356 mm)' },
    letter: { key: 'letter', label: 'Letter Paper', category: 'paper_size', description: 'Standard letter paper (216 × 279 mm)' },
    a5: { key: 'a5', label: 'A5 Paper', category: 'paper_size', description: 'Booklet half-size paper (148 × 210 mm)' },
};

export const COLOUR_MODES: Record<string, ServiceDefinition> = {
    bw: { key: 'bw', label: 'Black & White', category: 'colour_mode', description: 'Monochrome laser or inkjet printing' },
    color: { key: 'color', label: 'Colour', category: 'colour_mode', description: 'Full-spectrum CMYK colour printing' },
};

export const FINISHING_SERVICES: Record<string, ServiceDefinition> = {
    spiral_binding: { key: 'spiral_binding', label: 'Spiral Binding', category: 'finishing', description: 'Plastic spiral coil with transparent plastic cover' },
    soft_cover: { key: 'soft_cover', label: 'Soft Cover', category: 'finishing', description: 'Flexible paperback binding with cardstock cover' },
    hard_cover: { key: 'hard_cover', label: 'Hard Cover', category: 'finishing', description: 'Rigid hardbound book binding with gold or black lettering' },
    corner_staple: { key: 'corner_staple', label: 'Corner Staple', category: 'finishing', description: 'Heavy-duty single or dual corner staples' },
    lamination: { key: 'lamination', label: 'Lamination', category: 'finishing', description: 'Clear heat-sealed protective plastic sleeve' },
};

/** Formats paper size (e.g. "A4 Paper", "Legal Paper") */
export function formatPaperSizeName(rawSize?: string | null): string {
    const s = String(rawSize || '').toLowerCase().trim();
    return PAPER_SIZES[s]?.label || (s ? `${s.toUpperCase()} Paper` : 'A4 Paper');
}

/** Formats colour mode (e.g. "Black & White", "Colour") */
export function formatColourModeName(rawMode?: string | null): string {
    const m = String(rawMode || '').toLowerCase().trim();
    if (m === 'color' || m === 'colour') return 'Colour';
    return 'Black & White';
}

/** Formats finishing service or add-on (e.g. "Spiral Binding", "Lamination") */
export function formatFinishingServiceName(rawName?: string | null): string {
    const raw = String(rawName || '').trim();
    const normalized = raw.toLowerCase().replace(/[\s\-]+/g, '_');
    return FINISHING_SERVICES[normalized]?.label || raw || 'Print Service';
}

// ============================================================================
// 4. Commercial & Financial Terminology
// ============================================================================

export interface CommercialTermDefinition {
    key: string;
    term: string;
    shortTerm: string;
    description: string;
}

export const COMMERCIAL_TERMS: Record<string, CommercialTermDefinition> = {
    grossOrderValue: {
        key: 'grossOrderValue',
        term: 'Gross Order Value',
        shortTerm: 'Gross',
        description: 'Total amount paid by the customer for printing and finishing services.',
    },
    platformCommission: {
        key: 'platformCommission',
        term: 'Platform Commission',
        shortTerm: 'Commission',
        description: 'Platform service fee retained by XerService based on the agreed rate card.',
    },
    vendorNetEarnings: {
        key: 'vendorNetEarnings',
        term: 'Vendor Net Earnings',
        shortTerm: 'Vendor Share',
        description: 'Net earnings credited to the shop owner after platform commission deduction.',
    },
    settlementPayout: {
        key: 'settlementPayout',
        term: 'Settlement Payout',
        shortTerm: 'Settlement',
        description: 'Consolidated financial payout transferred to the vendor bank account or UPI ID.',
    },
    payableBalance: {
        key: 'payableBalance',
        term: 'Payable Balance',
        shortTerm: 'Payable',
        description: 'Accumulated vendor net earnings eligible for disbursement in the next batch.',
    },
    settledBalance: {
        key: 'settledBalance',
        term: 'Settled Balance',
        shortTerm: 'Settled',
        description: 'Historical earnings successfully disbursed to vendor bank or UPI account.',
    },
};

export interface CommercialSummary {
    grossAmount: number;
    grossText: string;
    commissionBps: number;
    commissionPercentText: string;
    commissionAmount: number;
    commissionText: string;
    vendorNetAmount: number;
    vendorNetText: string;
    narrative: string;
}

/**
 * Calculates and formats standard commercial breakdown strings.
 */
export function formatCommercialSummary(
    grossRupees: number,
    commissionBps: number
): CommercialSummary {
    const gross = Math.max(0, Math.round(grossRupees * 100) / 100);
    const safeBps = Math.max(0, Math.round(commissionBps || 0));
    const commissionPercent = safeBps / 100;
    const commissionAmount = Math.round(gross * (safeBps / 10000) * 100) / 100;
    const vendorNetAmount = Math.max(0, Math.round((gross - commissionAmount) * 100) / 100);

    const grossText = `₹${gross.toFixed(2)}`;
    const commissionPercentText = `${commissionPercent.toFixed(2)}%`;
    const commissionText = `₹${commissionAmount.toFixed(2)}`;
    const vendorNetText = `₹${vendorNetAmount.toFixed(2)}`;

    const narrative = `Customer paid ${grossText} (Gross Order Value). At ${commissionPercentText} Platform Commission (${commissionText}), shop owner earns ${vendorNetText} (Vendor Net Earnings).`;

    return {
        grossAmount: gross,
        grossText,
        commissionBps: safeBps,
        commissionPercentText,
        commissionAmount,
        commissionText,
        vendorNetAmount,
        vendorNetText,
        narrative,
    };
}

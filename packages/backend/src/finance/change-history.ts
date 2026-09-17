/**
 * XerService Backend — Priority 4: Commercial Change History Audit Engine
 *
 * Server-authoritative explainability for order pricing and commercial commission snapshots.
 * Answers with complete mathematical and chronological provenance:
 * "Why did this order cost this amount, how was each sheet and duplex rate calculated,
 * and have shop rates or commission rules changed since order checkout?"
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface FilePricingExplanation {
    orderFileId: string;
    filename: string;
    originalPages: number;
    pageSelection: string;
    pageRange: string | null;
    printablePages: number;
    imposition: number; // pages_per_sheet (e.g. 1-up, 2-up)
    printedSidesPerCopy: number;
    sidesMode: string; // SINGLE, DOUBLE_LONG_EDGE, DOUBLE_SHORT_EDGE
    isDuplex: boolean;
    sheetsPerCopy: number;
    copies: number;
    physicalSheets: number;
    paperSize: string;
    colourMode: string; // BW, COLOUR
    appliedUnitPrice: number; // rate per sheet at checkout
    lineTotal: number;
    currentShopRate: number | null; // currently active shop rate for this configuration
    rateMatchedCurrent: boolean;
    rateDeltaExplanation: string;
    calculationText: string;
}

export interface CommissionAuditExplanation {
    appliedBps: number | null;
    appliedPercentage: number | null;
    grossAmount: number;
    platformCommissionAmount: number | null;
    vendorNetAmount: number | null;
    currentActiveBps: number | null;
    currentActivePercentage: number | null;
    commissionMatchedCurrent: boolean;
    commissionDeltaExplanation: string;
}

export interface OrderPricingExplanation {
    orderId: string;
    shopId: string;
    shopName: string;
    orderCreatedAt: string;
    orderStatus: string;
    paymentStatus: string | null;
    totalAmount: number;
    currency: string;
    fileBreakdowns: FilePricingExplanation[];
    formulaSummary: {
        totalOriginalPages: number;
        totalPrintablePages: number;
        totalPhysicalSheets: number;
        totalLineAmount: number;
        duplexSheetSavings: number;
    };
    commissionAudit: CommissionAuditExplanation;
    humanNarrative: string;
    hasCommercialChangesSinceCheckout: boolean;
}

export interface BuildCommercialExplanationParams {
    order: {
        id: string;
        shop_id: string;
        status: string;
        payment_status: string | null;
        total_amount: number;
        created_at: string;
    };
    files: Array<{
        id: string;
        original_filename: string;
        original_pages: number;
        printable_pages: number;
        physical_sheets: number;
        unit_price: number;
        line_total: number;
    }>;
    printSettings: Array<{
        order_file_id: string;
        colour_mode: string;
        sides: string;
        copies: number;
        pages_per_sheet: number;
        paper_size: string;
        page_selection: string;
        page_range: string | null;
    }>;
    currentShopPricing: Array<{
        paper_size: string;
        print_mode: string;
        sides: string;
        price_per_sheet: number;
        active: boolean;
    }>;
    ledgerRecord: {
        gross_amount: number;
        commission_bps: number | null;
        platform_commission_amount: number | null;
        vendor_net_amount: number | null;
        financial_status: string;
    } | null;
    currentCommissionRule: {
        commission_bps: number;
        is_active: boolean;
    } | null;
    shopName?: string;
}

/**
 * Pure Explanation Function
 * In-memory evaluation producing a comprehensive audit explanation.
 */
export function buildCommercialExplanation({
    order,
    files,
    printSettings,
    currentShopPricing,
    ledgerRecord,
    currentCommissionRule,
    shopName = 'Storefront',
}: BuildCommercialExplanationParams): OrderPricingExplanation {
    const settingsByFileId = new Map(printSettings.map(s => [s.order_file_id, s]));

    let totalOriginalPages = 0;
    let totalPrintablePages = 0;
    let totalPhysicalSheets = 0;
    let totalLineAmount = 0;
    let duplexSheetSavings = 0;
    let hasCommercialChanges = false;

    const fileBreakdowns: FilePricingExplanation[] = files.map(file => {
        const settings = settingsByFileId.get(file.id);
        const originalPages = Number(file.original_pages) || 0;
        const printablePages = Number(file.printable_pages) || originalPages;
        const physicalSheets = Number(file.physical_sheets) || 0;
        const unitPrice = Number(file.unit_price) || 0;
        const lineTotal = Number(file.line_total) || 0;

        const imposition = settings?.pages_per_sheet || 1;
        const printedSidesPerCopy = Math.ceil(printablePages / imposition);
        const sidesMode = settings?.sides || 'SINGLE';
        const isDuplex = sidesMode === 'DOUBLE_LONG_EDGE' || sidesMode === 'DOUBLE_SHORT_EDGE';
        const sheetsPerCopy = isDuplex ? Math.ceil(printedSidesPerCopy / 2) : printedSidesPerCopy;
        const copies = settings?.copies || 1;
        const paperSize = settings?.paper_size || 'A4';
        const colourMode = settings?.colour_mode || 'BW';
        const pageSelection = settings?.page_selection || 'ALL';
        const pageRange = settings?.page_range || null;

        // Calculate potential duplex savings (how many sheets were saved vs single-sided)
        if (isDuplex) {
            const singleSidedSheets = printedSidesPerCopy * copies;
            const saved = singleSidedSheets - physicalSheets;
            if (saved > 0) duplexSheetSavings += saved;
        }

        totalOriginalPages += originalPages;
        totalPrintablePages += printablePages;
        totalPhysicalSheets += physicalSheets;
        totalLineAmount += lineTotal;

        // Match against current active shop pricing
        const matchingCurrentPricing = currentShopPricing.find(
            p => p.active &&
                p.paper_size.toUpperCase() === paperSize.toUpperCase() &&
                p.print_mode.toUpperCase() === colourMode.toUpperCase() &&
                p.sides.toUpperCase() === sidesMode.toUpperCase()
        );

        const currentRate = matchingCurrentPricing ? Number(matchingCurrentPricing.price_per_sheet) : null;
        const rateMatched = currentRate !== null && Math.abs(currentRate - unitPrice) < 0.001;

        let rateDeltaExplanation = 'Applied rate matches current shop pricing.';
        if (currentRate === null) {
            rateDeltaExplanation = 'Rate configuration is no longer offered in the active shop catalog.';
            hasCommercialChanges = true;
        } else if (!rateMatched) {
            hasCommercialChanges = true;
            const diff = currentRate - unitPrice;
            const diffStr = diff > 0 ? `increased by ₹${diff.toFixed(2)}` : `decreased by ₹${Math.abs(diff).toFixed(2)}`;
            rateDeltaExplanation = `Shop rate was updated after this order was placed. Rate at checkout was ₹${unitPrice.toFixed(2)}/sheet, but current catalog rate is ₹${currentRate.toFixed(2)}/sheet (${diffStr}).`;
        }

        const sidesLabel = isDuplex ? 'double-sided' : 'single-sided';
        const calcText = `${printablePages} page(s) × ${copies} copy (${sidesLabel}) = ${physicalSheets} sheet(s) consumed @ ₹${unitPrice.toFixed(2)}/sheet = ₹${lineTotal.toFixed(2)}`;

        return {
            orderFileId: file.id,
            filename: file.original_filename,
            originalPages,
            pageSelection,
            pageRange,
            printablePages,
            imposition,
            printedSidesPerCopy,
            sidesMode,
            isDuplex,
            sheetsPerCopy,
            copies,
            physicalSheets,
            paperSize,
            colourMode,
            appliedUnitPrice: unitPrice,
            lineTotal,
            currentShopRate: currentRate,
            rateMatchedCurrent: rateMatched,
            rateDeltaExplanation,
            calculationText: calcText,
        };
    });

    // Commission Rule Audit
    const appliedBps = ledgerRecord?.commission_bps ?? null;
    const appliedPercentage = appliedBps !== null ? appliedBps / 100 : null;
    const grossAmount = ledgerRecord ? Number(ledgerRecord.gross_amount) : Number(order.total_amount);
    const platformCommissionAmount = ledgerRecord?.platform_commission_amount !== null && ledgerRecord?.platform_commission_amount !== undefined
        ? Number(ledgerRecord.platform_commission_amount)
        : null;
    const vendorNetAmount = ledgerRecord?.vendor_net_amount !== null && ledgerRecord?.vendor_net_amount !== undefined
        ? Number(ledgerRecord.vendor_net_amount)
        : null;

    const currentActiveBps = currentCommissionRule ? Number(currentCommissionRule.commission_bps) : null;
    const currentActivePercentage = currentActiveBps !== null ? currentActiveBps / 100 : null;

    let commissionMatched = true;
    let commissionDeltaExplanation = 'Applied commission matches active shop commission rule.';

    if (appliedBps === null) {
        commissionMatched = false;
        hasCommercialChanges = true;
        commissionDeltaExplanation = 'No commission rule was configured at the time this order was placed (UNCONFIGURED). Platform commission is unallocated.';
    } else if (currentActiveBps === null) {
        commissionMatched = false;
        hasCommercialChanges = true;
        commissionDeltaExplanation = `Order used ${appliedPercentage?.toFixed(2)}% (${appliedBps} bps), but shop currently has no active commission rule configured.`;
    } else if (appliedBps !== currentActiveBps) {
        commissionMatched = false;
        hasCommercialChanges = true;
        commissionDeltaExplanation = `Commission rate changed after order checkout. Order locked in ${appliedPercentage?.toFixed(2)}% (${appliedBps} bps), whereas current shop commission is ${currentActivePercentage?.toFixed(2)}% (${currentActiveBps} bps).`;
    }

    // Build plain-text narrative
    const dateFormatted = new Date(order.created_at).toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
    });

    let narrative = `Order #${order.id.slice(0, 8)} was placed on ${dateFormatted} at ${shopName} for ₹${Number(order.total_amount).toFixed(2)}. `;
    narrative += `The order contained ${files.length} document(s) comprising ${totalPrintablePages} printed page(s) across ${totalPhysicalSheets} physical sheet(s). `;
    if (duplexSheetSavings > 0) {
        narrative += `Double-sided printing saved ${duplexSheetSavings} physical sheet(s). `;
    }
    if (appliedPercentage !== null && platformCommissionAmount !== null && vendorNetAmount !== null) {
        narrative += `XerService fee was applied at ${appliedPercentage.toFixed(2)}% (₹${platformCommissionAmount.toFixed(2)}), leaving vendor earnings of ₹${vendorNetAmount.toFixed(2)}.`;
    } else {
        narrative += `Commercial commission has not yet been assigned for this order.`;
    }

    return {
        orderId: order.id,
        shopId: order.shop_id,
        shopName,
        orderCreatedAt: order.created_at,
        orderStatus: order.status,
        paymentStatus: order.payment_status,
        totalAmount: Number(order.total_amount),
        currency: 'INR',
        fileBreakdowns,
        formulaSummary: {
            totalOriginalPages,
            totalPrintablePages,
            totalPhysicalSheets,
            totalLineAmount,
            duplexSheetSavings,
        },
        commissionAudit: {
            appliedBps,
            appliedPercentage,
            grossAmount,
            platformCommissionAmount,
            vendorNetAmount,
            currentActiveBps,
            currentActivePercentage,
            commissionMatchedCurrent: commissionMatched,
            commissionDeltaExplanation,
        },
        humanNarrative: narrative,
        hasCommercialChangesSinceCheckout: hasCommercialChanges,
    };
}

/**
 * Server Database Fetcher Function
 * Queries order files, print settings, live pricing matrix, ledger, and rules to build explanation.
 */
export async function getOrderPricingAudit(
    sb: SupabaseClient,
    orderId: string
): Promise<OrderPricingExplanation> {
    // 1. Fetch Order
    const { data: order, error: orderErr } = await sb
        .from('orders')
        .select('id, shop_id, status, payment_status, total_amount, created_at')
        .eq('id', orderId)
        .single();
    if (orderErr || !order) throw new Error(`[CommercialAudit] Order ${orderId} not found: ${orderErr?.message}`);

    // 2. Fetch Shop Name
    const { data: shop } = await sb.from('shops').select('name').eq('id', order.shop_id).maybeSingle();
    const shopName = shop?.name || 'Storefront';

    // 3. Fetch Order Files
    const { data: files, error: filesErr } = await sb
        .from('order_files')
        .select('id, original_filename, original_pages, printable_pages, physical_sheets, unit_price, line_total')
        .eq('order_id', orderId);
    if (filesErr) throw new Error(`[CommercialAudit] Failed to fetch order files: ${filesErr.message}`);

    const fileIds = (files || []).map(f => f.id);

    // 4. Fetch Print Settings
    let printSettings: any[] = [];
    if (fileIds.length > 0) {
        const { data: settingsData, error: settingsErr } = await sb
            .from('print_settings')
            .select('order_file_id, colour_mode, sides, copies, pages_per_sheet, paper_size, page_selection, page_range')
            .in('order_file_id', fileIds);
        if (settingsErr) throw new Error(`[CommercialAudit] Failed to fetch print settings: ${settingsErr.message}`);
        printSettings = settingsData || [];
    }

    // 5. Fetch Active Shop Pricing
    const { data: shopPricing, error: pricingErr } = await sb
        .from('shop_pricing')
        .select('paper_size, print_mode, sides, price_per_sheet, active')
        .eq('shop_id', order.shop_id);
    if (pricingErr) throw new Error(`[CommercialAudit] Failed to fetch shop pricing: ${pricingErr.message}`);

    // 6. Fetch Order Financial Ledger Record
    const { data: ledgerRecord } = await sb
        .from('order_financial_ledger')
        .select('gross_amount, commission_bps, platform_commission_amount, vendor_net_amount, financial_status')
        .eq('order_id', orderId)
        .maybeSingle();

    // 7. Fetch Active Commission Rule for Shop
    const { data: commRule } = await sb
        .from('shop_commission_rules')
        .select('commission_bps, is_active')
        .eq('shop_id', order.shop_id)
        .eq('is_active', true)
        .maybeSingle();

    return buildCommercialExplanation({
        order,
        files: files || [],
        printSettings,
        currentShopPricing: shopPricing || [],
        ledgerRecord,
        currentCommissionRule: commRule,
        shopName,
    });
}

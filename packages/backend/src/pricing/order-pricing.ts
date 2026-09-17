import { PDFDocument } from 'pdf-lib';
import { getServiceRoleClient } from '../supabase/client';
import { calculateFilePricing, PageSelectionMode, PrintSides } from './pricing-engine';
import { MAX_DOCUMENT_BYTES, MAX_DOCUMENT_PAGES } from '@packages/shared';
import {
    validateAndCalculateOrderAddons,
    persistOrderFileAddonSnapshots,
    getOrderFileAddonSnapshots,
} from '../addons/addons-service';

export interface AuthoritativeQuoteResult {
    orderId: string;
    orderNumber: string;
    shopId: string;
    status: string;
    paymentStatus: string;
    totalOriginalPages: number;
    totalPrintablePages: number;
    totalSheets: number;
    printingSubtotal?: number;
    addonsSubtotal?: number;
    totalAmount: number;
    estimatedExtraMinutes?: number;
    files: Array<{
        orderFileId: string;
        originalFilename: string;
        originalPages: number;
        selectedPages: number;
        printablePages: number;
        physicalSheets: number;
        unitPrice: number;
        lineTotal: number;
        addons?: Array<{
            shopAddonId: string;
            addonName: string;
            unitPrice: number;
            quantity: number;
            totalPrice: number;
        }>;
    }>;
}

export class PricingServiceError extends Error {
    statusCode: number;
    isConflict: boolean;

    constructor(message: string, statusCode = 400, isConflict = false) {
        super(message);
        this.name = 'PricingServiceError';
        this.statusCode = statusCode;
        this.isConflict = isConflict;
    }
}

/**
 * Server-authoritative calculation and snapshot persistence for a DRAFT order.
 * Re-validates files, actual PDF byte page counts, print_settings, and active shop_pricing,
 * then atomically writes verified snapshot values via apply_verified_order_pricing RPC.
 */
export async function calculateAndPersistOrderQuote(
    orderId: string,
    authenticatedUserId: string,
    optionalFileAddons?: Array<{
        orderFileId: string;
        addons: Array<{ shopAddonId: string; quantity?: number }>;
    }>
): Promise<AuthoritativeQuoteResult> {
    const serviceClient = getServiceRoleClient();

    // 1. Authorize Order
    const { data: order, error: orderError } = await serviceClient
        .from('orders')
        .select('id, order_number, user_id, shop_id, status, payment_status, expires_at')
        .eq('id', orderId)
        .single();

    if (orderError || !order) {
        throw new PricingServiceError('Order not found.', 404);
    }

    if (order.user_id !== authenticatedUserId) {
        throw new PricingServiceError('Unauthorized: this order belongs to another account.', 403);
    }

    if (order.status !== 'DRAFT') {
        throw new PricingServiceError(
            `Cannot calculate quote for an order in "${order.status}" status. Only DRAFT orders are quotable.`,
            400
        );
    }

    if (order.payment_status !== 'UNPAID') {
        throw new PricingServiceError(
            `Cannot calculate quote for an order with payment_status "${order.payment_status}".`,
            400
        );
    }

    if (new Date(order.expires_at).getTime() <= Date.now()) {
        throw new PricingServiceError('This draft order has expired. Please create a new order.', 400);
    }

    // 2. Revalidate Shop Availability
    const { data: shop, error: shopError } = await serviceClient
        .from('shops')
        .select('id, name, status, closing_soon, closing_message')
        .eq('id', order.shop_id)
        .single();

    if (shopError || !shop) {
        throw new PricingServiceError('The print shop associated with this order could not be found.', 404);
    }

    if (shop.status !== 'OPEN') {
        throw new PricingServiceError(`This print shop (${shop.name}) is currently CLOSED and not accepting orders.`, 400);
    }

    if (shop.closing_soon) {
        const reason = shop.closing_message ? `: ${shop.closing_message}` : '.';
        throw new PricingServiceError(`This shop is closing soon and is not accepting new orders right now${reason}`, 400);
    }

    // 3. Load Real Order Files & Print Settings
    const { data: orderFiles, error: filesError } = await serviceClient
        .from('order_files')
        .select(`
            id,
            order_id,
            original_filename,
            storage_path,
            mime_type,
            file_size_bytes,
            original_pages,
            print_settings (
                id,
                colour_mode,
                sides,
                orientation,
                copies,
                pages_per_sheet,
                paper_size,
                margin,
                page_selection,
                page_range,
                scale
            )
        `)
        .eq('order_id', orderId);

    if (filesError || !orderFiles || orderFiles.length === 0) {
        throw new PricingServiceError('This order has no files attached.', 400);
    }

    // 4. Load Active Shop Pricing Matrix
    const { data: shopPricing, error: pricingError } = await serviceClient
        .from('shop_pricing')
        .select('paper_size, print_mode, sides, price_per_sheet')
        .eq('shop_id', order.shop_id)
        .eq('active', true);

    if (pricingError || !shopPricing || shopPricing.length === 0) {
        throw new PricingServiceError('No active pricing matrix is configured for this shop. Please contact the vendor.', 400);
    }

    // 5. Process & Verify Each File
    const filesToUpdate: Array<{
        order_file_id: string;
        original_filename: string;
        original_pages: number;
        selected_pages: number;
        printable_pages: number;
        physical_sheets: number;
        unit_price: number;
        line_total: number;
        settings: {
            colour_mode: string;
            sides: string;
            orientation: string;
            copies: number;
            pages_per_sheet: number;
            paper_size: string;
            margin: string;
            page_selection: string;
            page_range: string | null;
            scale: string;
        };
    }> = [];

    for (const file of orderFiles) {
        if (!file.storage_path) {
            throw new PricingServiceError(`File "${file.original_filename}" is missing its storage path.`, 400);
        }

        const rawSettings = Array.isArray(file.print_settings) ? file.print_settings[0] : file.print_settings;
        if (!rawSettings) {
            throw new PricingServiceError(`Print settings are missing for file "${file.original_filename}".`, 400);
        }

        if (file.file_size_bytes > MAX_DOCUMENT_BYTES) {
            throw new PricingServiceError(`File "${file.original_filename}" exceeds maximum 20 MB size limit.`, 413);
        }

        // Determine real page count
        let verifiedOriginalPages = 1;
        const isPdf = file.mime_type === 'application/pdf' || file.original_filename.toLowerCase().endsWith('.pdf');

        if (isPdf) {
            const { data: fileBlob, error: downloadError } = await serviceClient.storage
                .from('order-documents')
                .download(file.storage_path);

            if (downloadError || !fileBlob) {
                throw new PricingServiceError(`Could not retrieve document "${file.original_filename}" from secure storage.`, 400);
            }

            const arrayBuffer = await fileBlob.arrayBuffer();
            const bytes = new Uint8Array(arrayBuffer);

            // Verify PDF header magic bytes
            const headerString = new TextDecoder().decode(bytes.slice(0, 5));
            if (headerString !== '%PDF-') {
                throw new PricingServiceError(`File "${file.original_filename}" is not a valid PDF file.`, 422);
            }

            let pdfDoc: PDFDocument;
            try {
                pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: false });
            } catch {
                throw new PricingServiceError(`PDF "${file.original_filename}" is corrupted or password-protected. Unlocked files are required.`, 422);
            }

            verifiedOriginalPages = pdfDoc.getPageCount();
            if (verifiedOriginalPages < 1) {
                throw new PricingServiceError(`PDF "${file.original_filename}" contains no readable pages.`, 422);
            }
            if (verifiedOriginalPages > MAX_DOCUMENT_PAGES) {
                throw new PricingServiceError(
                    `PDF "${file.original_filename}" has ${verifiedOriginalPages} pages, exceeding the XerService maximum limit of ${MAX_DOCUMENT_PAGES} pages.`,
                    422
                );
            }
        } else if (file.mime_type.startsWith('image/')) {
            verifiedOriginalPages = 1;
        } else {
            throw new PricingServiceError(`Unsupported document format "${file.mime_type}" for file "${file.original_filename}".`, 415);
        }

        // Match shop pricing
        const paperSize = (rawSettings.paper_size || 'A4').toUpperCase();
        const colourMode = (rawSettings.colour_mode || 'BW').toUpperCase();
        const sides = (rawSettings.sides || 'SINGLE').toUpperCase();

        const matchedPricing = shopPricing.find(
            p => p.paper_size.toUpperCase() === paperSize &&
                 p.print_mode.toUpperCase() === colourMode &&
                 p.sides.toUpperCase() === sides
        );

        if (!matchedPricing) {
            throw new PricingServiceError(
                `This print configuration (${paperSize}, ${colourMode}, ${sides}) is not currently priced by the shop.`,
                400
            );
        }

        const unitPrice = Number(matchedPricing.price_per_sheet);

        try {
            const pricingResult = calculateFilePricing({
                originalPages: verifiedOriginalPages,
                pageSelection: (rawSettings.page_selection || 'ALL').toUpperCase() as PageSelectionMode,
                pageRange: rawSettings.page_range,
                pagesPerSheet: Math.max(1, rawSettings.pages_per_sheet || 1),
                sides: sides as PrintSides,
                copies: Math.max(1, rawSettings.copies || 1),
                unitPrice,
            });

            filesToUpdate.push({
                order_file_id: file.id,
                original_filename: file.original_filename,
                original_pages: pricingResult.originalPages,
                selected_pages: pricingResult.selectedPages,
                printable_pages: pricingResult.printablePages,
                physical_sheets: pricingResult.physicalSheets,
                unit_price: pricingResult.unitPrice,
                line_total: pricingResult.lineTotal,
                settings: {
                    colour_mode: colourMode,
                    sides,
                    orientation: (rawSettings.orientation || 'PORTRAIT').toUpperCase(),
                    copies: Math.max(1, rawSettings.copies || 1),
                    pages_per_sheet: Math.max(1, rawSettings.pages_per_sheet || 1),
                    paper_size: paperSize,
                    margin: (rawSettings.margin || 'DEFAULT').toUpperCase(),
                    page_selection: (rawSettings.page_selection || 'ALL').toUpperCase(),
                    page_range: rawSettings.page_range || null,
                    scale: (rawSettings.scale || 'DEFAULT').toUpperCase(),
                },
            });
        } catch (calcErr: unknown) {
            const msg = calcErr instanceof Error ? calcErr.message : String(calcErr);
            throw new PricingServiceError(`Calculation error for "${file.original_filename}": ${msg}`, 400);
        }
    }

    // 6. Mandatory Atomic Snapshot Write via RPC
    const rpcPayload = filesToUpdate.map(f => ({
        order_file_id: f.order_file_id,
        original_pages: f.original_pages,
        printable_pages: f.printable_pages,
        physical_sheets: f.physical_sheets,
        expected_unit_price: f.unit_price,
        expected_settings: f.settings,
    }));

    const { data: rpcData, error: rpcError } = await serviceClient.rpc(
        'apply_verified_order_pricing',
        {
            p_order_id: orderId,
            p_files: rpcPayload,
        }
    );

    if (rpcError || !rpcData) {
        const errorMsg = rpcError?.message || 'Failed to apply verified order pricing';
        const isConflict =
            errorMsg.includes('Print settings changed') ||
            errorMsg.includes('Shop pricing changed') ||
            errorMsg.includes('closing soon') ||
            errorMsg.includes('CLOSED');

        throw new PricingServiceError(errorMsg, isConflict ? 409 : 500, isConflict);
    }

    // 7. Add-ons Validation, Calculation & Snapshotting
    let fileAddonSelections = optionalFileAddons;

    if (!fileAddonSelections) {
        // Read existing snapshots for this order if available
        const existingSnapshots = await getOrderFileAddonSnapshots(orderId);
        if (existingSnapshots.length > 0) {
            fileAddonSelections = filesToUpdate.map(f => ({
                orderFileId: f.order_file_id,
                addons: existingSnapshots
                    .filter(s => s.orderFileId === f.order_file_id)
                    .map(s => ({ shopAddonId: s.shopAddonId, quantity: s.quantity })),
            }));
        }
    }

    const selectionsWithPages = (fileAddonSelections || []).map(fa => {
        const matchedFile = filesToUpdate.find(f => f.order_file_id === fa.orderFileId);
        return {
            orderFileId: fa.orderFileId,
            printablePages: matchedFile?.printable_pages || 1,
            addons: fa.addons,
        };
    });

    let addonsCalculation: {
        addonsSubtotal: number;
        maxEstimatedMinutes: number;
        snapshots: Array<any>;
    } = { addonsSubtotal: 0, maxEstimatedMinutes: 0, snapshots: [] };

    if (selectionsWithPages.length > 0) {
        try {
            addonsCalculation = await validateAndCalculateOrderAddons(
                order.shop_id,
                selectionsWithPages
            );
        } catch (addonErr: unknown) {
            const msg = addonErr instanceof Error ? addonErr.message : String(addonErr);
            throw new PricingServiceError(msg, 409, true);
        }
    }

    const printingSubtotal = Number(rpcData.totalAmount);
    const addonsSubtotal = addonsCalculation.addonsSubtotal;
    const finalTotal = Math.round((printingSubtotal + addonsSubtotal) * 100) / 100;

    // Update orders.total_amount to authoritative gross (printing + addons)
    if (addonsSubtotal > 0) {
        await serviceClient
            .from('orders')
            .update({ total_amount: finalTotal })
            .eq('id', orderId);
    }

    // Persist immutable snapshots
    await persistOrderFileAddonSnapshots(orderId, addonsCalculation.snapshots);

    return {
        ...rpcData,
        shopId: order.shop_id,
        printingSubtotal,
        addonsSubtotal,
        totalAmount: finalTotal,
        estimatedExtraMinutes: addonsCalculation.maxEstimatedMinutes,
        files: (rpcData.files || []).map((f: any) => ({
            ...f,
            addons: addonsCalculation.snapshots
                .filter(s => s.orderFileId === f.orderFileId)
                .map(s => ({
                    shopAddonId: s.shopAddonId,
                    addonName: s.addonNameSnapshot,
                    unitPrice: s.unitPriceSnapshot,
                    quantity: s.quantity,
                    totalPrice: s.totalPrice,
                })),
        })),
    } as AuthoritativeQuoteResult;
}

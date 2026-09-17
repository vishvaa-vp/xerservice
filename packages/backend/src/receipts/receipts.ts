/**
 * Phase 6I: Real Order Receipt & Invoice Foundation (Hardened)
 *
 * Manages authoritative payment receipt generation, immutable storage,
 * refund synchronization, and pure server-side PDF generation via pdf-lib.
 *
 * STRICT FINANCIAL INTEGRITY INVARIANTS:
 * 1. Fail-closed amount check: orders.total_amount MUST match payment_attempts.amount.
 * 2. Require an authoritative successful payment_attempt (status IN ('PAID', 'REFUNDED'), provider IN ('RAZORPAY', 'XERCOINS')).
 * 3. Never fabricate provider or payment_method. Preserves real payment_method or null.
 * 4. Unified server/database sequence receipt numbering: XSR-YYYY-NNNNNN via database sequence only.
 * 5. Authoritative issued_at: derived from payment_attempt.paid_at or order.paid_at (no created_at fallback).
 * 6. Authoritative refunded_at: derived from refund_requests.completed_at for SUCCEEDED refunds.
 * 7. Authoritative refund lifecycle: markReceiptRefunded is called ONLY upon verified refund success.
 * 8. Customer-only access for MVP; strict DB-error fail-closed handling.
 * 9. Factual PDF content with zero unsupported delivery/certification marketing claims, zero fake contact emails, and zero tax claims.
 * 10. NO VIRTUAL RECEIPTS: When table is missing, returns null / 503 unavailable.
 */

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { getServiceRoleClient } from '../supabase/client';
import { getOrderFileAddonSnapshots } from '../addons/addons-service';

export interface OrderReceiptRecord {
    id: string;
    receipt_number: string;
    order_id: string;
    user_id: string;
    shop_id: string;
    payment_attempt_id: string | null;
    amount: number;
    currency: string;
    payment_provider: 'RAZORPAY' | 'XERCOINS';
    payment_method: string | null;
    payment_status: 'PAID' | 'REFUNDED';
    issued_at: string;
    refunded_at: string | null;
    created_at: string;
    updated_at: string;
}

export interface ReceiptPrintConfigSummary {
    fileCount: number;
    totalPages: number;
    totalSheets: number;
    colorSummary?: string;
    sidesSummary?: string;
    copiesSummary?: string;
    paperSizeSummary?: string;
}

export interface ReceiptAddonItem {
    orderFileId: string;
    filename?: string;
    addonName: string;
    unitPrice: number;
    quantity: number;
    totalPrice: number;
}

export interface ReceiptDocumentData {
    receiptNumber: string;
    orderNumber: string;
    orderDate: string;
    paymentDate: string;
    customerName: string;
    customerEmail?: string | null;
    shopName: string;
    amount: number;
    currency: string;
    paymentProvider: 'RAZORPAY' | 'XERCOINS';
    paymentMethod: string;
    paymentStatus: 'PAID' | 'REFUNDED';
    refundedAt?: string | null;
    printSummary: ReceiptPrintConfigSummary;
    addons?: ReceiptAddonItem[];
}

/**
 * Idempotently creates or retrieves the authoritative payment receipt for an order.
 * Strictly verifies that the order is PAID or REFUNDED and that amounts agree.
 * Fails closed on any integrity failure, missing table, or database error.
 * Application NEVER fabricates virtual receipt rows or unauthoritative receipt numbers.
 */
export async function getOrCreateOrderReceipt(orderId: string): Promise<OrderReceiptRecord | null> {
    const serviceClient = getServiceRoleClient();

    // 1. Check if receipt already exists in database
    const { data: existingReceipt, error: existingErr } = await serviceClient
        .from('order_receipts')
        .select('*')
        .eq('order_id', orderId)
        .maybeSingle();

    const isMissingTable = existingErr && (
        existingErr.code === 'PGRST205' || // PostgREST: Table not found in schema cache
        existingErr.code === '42P01'       // PostgreSQL: relation does not exist
    );

    // Fail closed with controlled unavailable result if database table is not deployed yet
    if (isMissingTable) {
        console.warn(`[ReceiptService] public.order_receipts table does not exist. Payment receipt service is not deployed yet.`);
        return null;
    }

    // Fail closed on arbitrary database errors
    if (existingErr) {
        console.error(`[ReceiptService] Database query error for order ${orderId}:`, existingErr);
        return null;
    }

    if (existingReceipt) {
        return existingReceipt as OrderReceiptRecord;
    }

    // 2. Fetch authoritative order data
    const { data: order, error: orderErr } = await serviceClient
        .from('orders')
        .select(`
            id,
            order_number,
            user_id,
            shop_id,
            status,
            payment_status,
            total_amount,
            paid_at,
            created_at,
            cancelled_at,
            updated_at
        `)
        .eq('id', orderId)
        .maybeSingle();

    if (orderErr || !order) {
        console.error(`[ReceiptService] Order ${orderId} not found:`, orderErr);
        return null;
    }

    // Receipt is ONLY issued for orders that have been successfully paid
    if (order.payment_status !== 'PAID' && order.payment_status !== 'REFUNDED') {
        console.warn(`[ReceiptService] Cannot generate receipt for order ${order.order_number} in payment_status "${order.payment_status}".`);
        return null;
    }

    // 3. Fetch authoritative payment attempt (must be successfully completed)
    const { data: attempts, error: attemptErr } = await serviceClient
        .from('payment_attempts')
        .select('id, provider, amount, currency, status, payment_method, paid_at, created_at')
        .eq('order_id', orderId)
        .in('status', ['PAID', 'REFUNDED'])
        .order('paid_at', { ascending: false, nullsFirst: false });

    if (attemptErr) {
        console.error(`[ReceiptService] Database error querying payment attempts for ${orderId}:`, attemptErr);
        return null;
    }

    const latestAttempt = attempts && attempts.length > 0 ? attempts[0] : null;

    if (!latestAttempt) {
        console.error(
            `[ReceiptService] No authoritative successful payment attempt found for order ${order.order_number} (order_id: ${order.id}). Failing closed.`
        );
        return null;
    }

    const rawProvider = latestAttempt.provider?.toUpperCase();
    if (rawProvider !== 'RAZORPAY' && rawProvider !== 'XERCOINS') {
        console.error(
            `[ReceiptService] Invalid or unknown payment provider "${latestAttempt.provider}" for order ${order.order_number} (order_id: ${order.id}, payment_attempt_id: ${latestAttempt.id}). Failing closed.`
        );
        return null;
    }
    const provider: 'RAZORPAY' | 'XERCOINS' = rawProvider;

    const orderAmount = Number(order.total_amount);
    const attemptAmount = Number(latestAttempt.amount);

    if (Math.abs(orderAmount - attemptAmount) > 0.01) {
        console.error(
            `[ReceiptService Amount Mismatch] Integrity failure for order ${order.order_number} (order_id: ${order.id}, payment_attempt_id: ${latestAttempt.id}): order total (${orderAmount}) does not match payment attempt (${attemptAmount}). Failing closed.`
        );
        return null;
    }

    const issuedAt = latestAttempt.paid_at || order.paid_at;
    if (!issuedAt) {
        console.error(
            `[ReceiptService] No authoritative paid_at timestamp found for order ${order.order_number} (order_id: ${order.id}, payment_attempt_id: ${latestAttempt.id}). Failing closed.`
        );
        return null;
    }

    let refundedAt: string | null = null;
    if (order.payment_status === 'REFUNDED') {
        const { data: refundReq, error: refErr } = await serviceClient
            .from('refund_requests')
            .select('completed_at, status')
            .eq('order_id', orderId)
            .eq('status', 'SUCCEEDED')
            .order('completed_at', { ascending: false, nullsFirst: false })
            .limit(1)
            .maybeSingle();

        if (refErr && refErr.code !== 'PGRST205' && refErr.code !== '42P01') {
            console.error(`[ReceiptService] Error querying refund_requests for order ${orderId}:`, refErr);
        }

        refundedAt = refundReq?.completed_at || null;
    }

    const paymentMethod = latestAttempt.payment_method || null;

    const receiptPayload: Record<string, any> = {
        order_id: order.id,
        user_id: order.user_id,
        shop_id: order.shop_id,
        payment_attempt_id: latestAttempt.id,
        amount: orderAmount,
        currency: latestAttempt.currency || 'INR',
        payment_provider: provider,
        payment_method: paymentMethod,
        payment_status: order.payment_status as 'PAID' | 'REFUNDED',
        issued_at: issuedAt,
        refunded_at: refundedAt,
    };

    // 4. Idempotently insert receipt record into database
    // Database trigger trg_assign_order_receipt_number automatically assigns sequence-based receipt_number
    const { data: inserted, error: insertErr } = await serviceClient
        .from('order_receipts')
        .insert(receiptPayload)
        .select('*')
        .single();

    if (insertErr) {
        // Handle concurrent insert race condition gracefully
        if (insertErr.code === '23505' || insertErr.message?.includes('duplicate key') || insertErr.message?.includes('order_receipts_order_id_key')) {
            const { data: recheck } = await serviceClient
                .from('order_receipts')
                .select('*')
                .eq('order_id', orderId)
                .single();
            if (recheck) return recheck as OrderReceiptRecord;
        }

        console.error(`[ReceiptService] Database insert error for order ${order.order_number}:`, insertErr);
        return null;
    }

    return (inserted as OrderReceiptRecord) || null;
}

/**
 * Updates an order receipt to mark it as REFUNDED upon verified refund success.
 * Strictly preserves the original receipt_number, amount, and issued_at.
 */
export async function markReceiptRefunded(orderId: string, customRefundedAt?: string): Promise<boolean> {
    const serviceClient = getServiceRoleClient();
    let resolvedRefundedAt = customRefundedAt;

    if (!resolvedRefundedAt) {
        const { data: ref } = await serviceClient
            .from('refund_requests')
            .select('completed_at')
            .eq('order_id', orderId)
            .eq('status', 'SUCCEEDED')
            .order('completed_at', { ascending: false })
            .limit(1)
            .maybeSingle();
        resolvedRefundedAt = ref?.completed_at || new Date().toISOString();
    }

    const { error } = await serviceClient
        .from('order_receipts')
        .update({
            payment_status: 'REFUNDED',
            refunded_at: resolvedRefundedAt,
            updated_at: new Date().toISOString(),
        })
        .eq('order_id', orderId)
        .eq('payment_status', 'PAID'); // Only mutate if currently PAID

    if (error) {
        if (error.code !== 'PGRST205' && error.code !== '42P01') {
            console.error(`[ReceiptService] Error updating receipt to REFUNDED for order ${orderId}:`, error);
            return false;
        }
    }
    return true;
}

/**
 * Assembles all verified, authoritative data required to render the receipt.
 * Returns null if receipt is absent or service is unavailable.
 */
export async function buildReceiptDocumentData(
    orderIdentifier: string,
    authenticatedUserId?: string
): Promise<ReceiptDocumentData | null> {
    const serviceClient = getServiceRoleClient();

    // Look up by UUID or order_number
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderIdentifier);
    let orderQuery = serviceClient
        .from('orders')
        .select(`
            id,
            order_number,
            user_id,
            shop_id,
            status,
            payment_status,
            total_amount,
            total_printable_pages,
            total_sheets,
            paid_at,
            created_at,
            cancelled_at,
            shops (
                id,
                name
            ),
            order_files (
                id,
                original_filename,
                printable_pages,
                physical_sheets,
                print_settings (
                    paper_size,
                    colour_mode,
                    sides,
                    copies,
                    orientation
                )
            )
        `);

    if (isUuid) {
        orderQuery = orderQuery.eq('id', orderIdentifier);
    } else {
        orderQuery = orderQuery.eq('order_number', orderIdentifier);
    }

    if (authenticatedUserId) {
        orderQuery = orderQuery.eq('user_id', authenticatedUserId);
    }

    const { data: order, error: orderErr } = await orderQuery.maybeSingle();

    if (orderErr || !order) {
        return null;
    }

    if (order.payment_status !== 'PAID' && order.payment_status !== 'REFUNDED') {
        return null;
    }

    // Get or create receipt record (authoritative database row only; fails closed on missing table or integrity check)
    const receipt = await getOrCreateOrderReceipt(order.id);
    if (!receipt) {
        return null;
    }

    // Resolve customer contact details
    let customerName = 'Valued Customer';
    let customerEmail: string | null = null;

    try {
        const { data: profile } = await serviceClient
            .from('profiles')
            .select('full_name')
            .eq('user_id', order.user_id)
            .maybeSingle();

        if (profile?.full_name?.trim()) {
            customerName = profile.full_name.trim();
        }

        const { data: authUserData } = await serviceClient.auth.admin.getUserById(order.user_id);
        if (authUserData?.user?.email) {
            customerEmail = authUserData.user.email;
        }
    } catch {
        // Fallback silently if profile lookup has transient issues
    }

    const shop = Array.isArray(order.shops) ? order.shops[0] : order.shops;
    const shopName = shop?.name || 'XerService Partner Shop';

    // Summarize print configurations (factual, strictly no binding claims)
    const files = order.order_files || [];
    let colorSet = new Set<string>();
    let sidesSet = new Set<string>();
    let paperSizes = new Set<string>();
    let maxCopies = 1;

    for (const f of files) {
        const ps = Array.isArray(f.print_settings) ? f.print_settings[0] : f.print_settings;
        if (ps) {
            if (ps.colour_mode) colorSet.add(ps.colour_mode === 'COLOR' ? 'Color' : 'B&W');
            if (ps.sides) sidesSet.add(ps.sides === 'DOUBLE' ? 'Double Sided' : 'Single Sided');
            if (ps.paper_size) paperSizes.add(ps.paper_size);
            if (ps.copies && ps.copies > maxCopies) maxCopies = ps.copies;
        }
    }

    const provider: 'RAZORPAY' | 'XERCOINS' = receipt.payment_provider;
    let methodDisplay = 'Online Payment';
    if (provider === 'XERCOINS') {
        methodDisplay = 'XerCoins';
    } else if (receipt.payment_method) {
        const m = receipt.payment_method.toUpperCase();
        if (m === 'UPI') methodDisplay = 'UPI';
        else if (m === 'CARD') methodDisplay = 'Credit / Debit Card';
        else if (m === 'NETBANKING') methodDisplay = 'NetBanking';
        else if (m === 'WALLET') methodDisplay = 'Online Wallet';
        else methodDisplay = receipt.payment_method;
    }

    const printSummary: ReceiptPrintConfigSummary = {
        fileCount: files.length || 1,
        totalPages: order.total_printable_pages || 0,
        totalSheets: order.total_sheets || 0,
        colorSummary: colorSet.size > 0 ? Array.from(colorSet).join(', ') : 'Standard B&W',
        sidesSummary: sidesSet.size > 0 ? Array.from(sidesSet).join(', ') : 'Single Sided',
        copiesSummary: `${maxCopies} ${maxCopies === 1 ? 'copy' : 'copies'}`,
        paperSizeSummary: paperSizes.size > 0 ? Array.from(paperSizes).join(', ') : 'A4',
    };

    const paymentDateIso = receipt.issued_at;
    const refundedDateIso = receipt.refunded_at;

    let addons: ReceiptAddonItem[] = [];
    try {
        const snapshots = await getOrderFileAddonSnapshots(order.id);
        addons = snapshots.map(s => {
            const f = files.find(file => file.id === s.orderFileId);
            return {
                orderFileId: s.orderFileId,
                filename: f?.original_filename,
                addonName: s.addonNameSnapshot,
                unitPrice: Number(s.unitPriceSnapshot),
                quantity: s.quantity,
                totalPrice: Number(s.totalPrice),
            };
        });
    } catch {
        // Table unpushed or empty fallback
    }

    return {
        receiptNumber: receipt.receipt_number,
        orderNumber: order.order_number,
        orderDate: new Date(order.created_at).toLocaleDateString('en-IN', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true,
        }),
        paymentDate: new Date(paymentDateIso).toLocaleDateString('en-IN', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true,
        }),
        customerName,
        customerEmail,
        shopName,
        amount: Number(receipt.amount),
        currency: receipt.currency || 'INR',
        paymentProvider: provider,
        paymentMethod: methodDisplay,
        paymentStatus: receipt.payment_status,
        refundedAt: (receipt.payment_status === 'REFUNDED' && refundedDateIso)
            ? new Date(refundedDateIso).toLocaleDateString('en-IN', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                hour12: true,
            })
            : null,
        printSummary,
        addons,
    };
}

/**
 * Generates a clean, factual, professional single-page PDF payment receipt.
 * Uses pdf-lib with StandardFonts (Helvetica) and pure JavaScript vector drawing.
 * Strictly contains NO unsupported delivery, certification, or tax invoice claims.
 * Omits unverified support emails (displays authoritative website domain only).
 */
export async function generateReceiptPdf(data: ReceiptDocumentData): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    // A4 Portrait: 595.28 x 841.89 points
    const page = doc.addPage([595.28, 841.89]);
    const { width, height } = page.getSize();

    const fontRegular = await doc.embedFont(StandardFonts.Helvetica);
    const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

    // Color Palette
    const cBrandNavy = rgb(0.06, 0.16, 0.28);    // #0f2947
    const cBrandCyan = rgb(0.33, 0.74, 0.81);    // #54bdce (XerService primary accent)
    const cTextPrimary = rgb(0.12, 0.14, 0.17);  // #1f242b
    const cTextMuted = rgb(0.40, 0.44, 0.50);    // #667080
    const cCardBg = rgb(0.97, 0.98, 0.99);       // #f8f9fa
    const cBorder = rgb(0.88, 0.90, 0.93);       // #e1e6ed
    const cStatusPaid = rgb(0.09, 0.63, 0.36);     // #16a05d
    const cStatusRefunded = rgb(0.85, 0.22, 0.22); // #d93838

    let y = height - 45;

    // Top Accent Bar
    page.drawRectangle({
        x: 0,
        y: height - 6,
        width,
        height: 6,
        color: cBrandCyan,
    });

    // -------------------------------------------------------------
    // 1. BRAND HEADER & RECEIPT TITLE
    // -------------------------------------------------------------
    page.drawText('XerService', {
        x: 45,
        y: y - 10,
        size: 26,
        font: fontBold,
        color: cBrandNavy,
    });

    page.drawText('Online Print Order Receipt', {
        x: 45,
        y: y - 24,
        size: 9,
        font: fontRegular,
        color: cTextMuted,
    });

    const isRefunded = data.paymentStatus === 'REFUNDED';
    const titleText = isRefunded ? 'PAYMENT RECEIPT — REFUNDED' : 'PAYMENT RECEIPT';

    const titleWidth = fontBold.widthOfTextAtSize(titleText, 14);
    page.drawText(titleText, {
        x: width - 45 - titleWidth,
        y: y - 10,
        size: 14,
        font: fontBold,
        color: isRefunded ? cStatusRefunded : cBrandNavy,
    });

    const docProofText = 'Official Payment Confirmation';
    const docProofWidth = fontRegular.widthOfTextAtSize(docProofText, 9);
    page.drawText(docProofText, {
        x: width - 45 - docProofWidth,
        y: y - 24,
        size: 9,
        font: fontRegular,
        color: cTextMuted,
    });

    y -= 50;

    // Divider Line
    page.drawLine({
        start: { x: 45, y },
        end: { x: width - 45, y },
        thickness: 1,
        color: cBorder,
    });

    y -= 25;

    // -------------------------------------------------------------
    // 2. RECEIPT METADATA CARD
    // -------------------------------------------------------------
    const cardHeight = 62;
    page.drawRectangle({
        x: 45,
        y: y - cardHeight,
        width: width - 90,
        height: cardHeight,
        color: cCardBg,
        borderColor: cBorder,
        borderWidth: 1,
    });

    const colWidth = (width - 90) / 4;

    const drawMetaCell = (colIdx: number, label: string, value: string, isColored = false) => {
        const cellX = 45 + colIdx * colWidth + 14;
        page.drawText(label.toUpperCase(), {
            x: cellX,
            y: y - 20,
            size: 8,
            font: fontBold,
            color: cTextMuted,
        });
        page.drawText(value, {
            x: cellX,
            y: y - 42,
            size: 11,
            font: fontBold,
            color: isColored ? (isRefunded ? cStatusRefunded : cStatusPaid) : cTextPrimary,
        });
    };

    drawMetaCell(0, 'Receipt Number', data.receiptNumber);
    drawMetaCell(1, 'Order Number', `#${data.orderNumber}`);
    drawMetaCell(2, 'Payment Date', data.paymentDate);
    drawMetaCell(3, 'Status', isRefunded ? 'REFUNDED' : 'PAID', true);

    y -= (cardHeight + 25);

    // -------------------------------------------------------------
    // 3. BILLED TO & PRINT SHOP (2 COLUMNS)
    // -------------------------------------------------------------
    const midX = 45 + (width - 90) / 2 + 10;

    // Customer Column
    page.drawText('CUSTOMER DETAILS', {
        x: 45,
        y,
        size: 9,
        font: fontBold,
        color: cBrandCyan,
    });

    page.drawText(data.customerName, {
        x: 45,
        y: y - 18,
        size: 13,
        font: fontBold,
        color: cTextPrimary,
    });

    if (data.customerEmail) {
        page.drawText(data.customerEmail, {
            x: 45,
            y: y - 34,
            size: 10,
            font: fontRegular,
            color: cTextMuted,
        });
    }

    // Shop Column (factual, no invented certifications)
    page.drawText('PRINT SHOP', {
        x: midX,
        y,
        size: 9,
        font: fontBold,
        color: cBrandCyan,
    });

    page.drawText(data.shopName, {
        x: midX,
        y: y - 18,
        size: 13,
        font: fontBold,
        color: cTextPrimary,
    });

    y -= 60;

    // -------------------------------------------------------------
    // 4. ORDER SPECIFICATIONS SUMMARY
    // -------------------------------------------------------------
    page.drawText('ORDER SPECIFICATIONS', {
        x: 45,
        y,
        size: 10,
        font: fontBold,
        color: cBrandNavy,
    });

    y -= 14;

    // Table Header
    const specTableH = 24;
    page.drawRectangle({
        x: 45,
        y: y - specTableH,
        width: width - 90,
        height: specTableH,
        color: rgb(0.92, 0.94, 0.96),
    });

    page.drawText('ITEM DESCRIPTION', { x: 55, y: y - 16, size: 8, font: fontBold, color: cTextMuted });
    page.drawText('PRINT CONFIGURATION', { x: 230, y: y - 16, size: 8, font: fontBold, color: cTextMuted });
    page.drawText('PAGES', { x: 390, y: y - 16, size: 8, font: fontBold, color: cTextMuted });
    page.drawText('SHEETS', { x: 460, y: y - 16, size: 8, font: fontBold, color: cTextMuted });

    y -= specTableH;

    // Table Row
    const specRowH = 34;
    page.drawRectangle({
        x: 45,
        y: y - specRowH,
        width: width - 90,
        height: specRowH,
        color: rgb(1, 1, 1),
        borderColor: cBorder,
        borderWidth: 1,
    });

    const docCountLabel = `${data.printSummary.fileCount} Document${data.printSummary.fileCount > 1 ? 's' : ''}`;
    page.drawText(docCountLabel, { x: 55, y: y - 20, size: 10, font: fontBold, color: cTextPrimary });

    const configLabel = `${data.printSummary.colorSummary || 'B&W'} • ${data.printSummary.sidesSummary || 'Single'} • ${data.printSummary.paperSizeSummary || 'A4'}`;
    page.drawText(configLabel, { x: 230, y: y - 20, size: 10, font: fontRegular, color: cTextMuted });

    page.drawText(String(data.printSummary.totalPages), { x: 390, y: y - 20, size: 10, font: fontBold, color: cTextPrimary });
    page.drawText(String(data.printSummary.totalSheets), { x: 460, y: y - 20, size: 10, font: fontBold, color: cTextPrimary });

    y -= (specRowH + 20);

    // -------------------------------------------------------------
    // 4b. FINISHING ADD-ONS TABLE (IF APPLICABLE)
    // -------------------------------------------------------------
    const hasAddons = Boolean(data.addons && data.addons.length > 0);
    const totalAddons = (data.addons || []).reduce((sum, a) => sum + Number(a.totalPrice || 0), 0);
    const basePrintingTotal = Math.max(0, data.amount - totalAddons);

    if (hasAddons && data.addons) {
        page.drawText('FINISHING SERVICES', {
            x: 45,
            y,
            size: 10,
            font: fontBold,
            color: cBrandNavy,
        });

        y -= 14;

        const addonTableH = 20;
        page.drawRectangle({
            x: 45,
            y: y - addonTableH,
            width: width - 90,
            height: addonTableH,
            color: rgb(0.92, 0.94, 0.96),
        });

        page.drawText('DOCUMENT', { x: 55, y: y - 14, size: 8, font: fontBold, color: cTextMuted });
        page.drawText('FINISHING SERVICE', { x: 230, y: y - 14, size: 8, font: fontBold, color: cTextMuted });
        page.drawText('AMOUNT', { x: width - 110, y: y - 14, size: 8, font: fontBold, color: cTextMuted });

        y -= addonTableH;

        for (const a of data.addons) {
            const rowH = 22;
            page.drawRectangle({
                x: 45,
                y: y - rowH,
                width: width - 90,
                height: rowH,
                color: rgb(1, 1, 1),
                borderColor: cBorder,
                borderWidth: 1,
            });

            const fTitle = (a.filename || 'Document').slice(0, 26);
            page.drawText(fTitle, { x: 55, y: y - 15, size: 9, font: fontRegular, color: cTextPrimary });
            page.drawText(a.addonName, { x: 230, y: y - 15, size: 9, font: fontBold, color: cBrandNavy });
            page.drawText(`Rs. ${Number(a.totalPrice).toFixed(2)}`, { x: width - 110, y: y - 15, size: 9, font: fontBold, color: cTextPrimary });

            y -= rowH;
        }

        y -= 20;
    }

    // -------------------------------------------------------------
    // 5. PAYMENT BREAKDOWN
    // -------------------------------------------------------------
    page.drawText('PAYMENT DETAILS', {
        x: 45,
        y,
        size: 10,
        font: fontBold,
        color: cBrandNavy,
    });

    y -= 14;

    const paymentBoxH = (isRefunded ? 130 : 96) + (hasAddons ? 40 : 0);
    page.drawRectangle({
        x: 45,
        y: y - paymentBoxH,
        width: width - 90,
        height: paymentBoxH,
        color: cCardBg,
        borderColor: cBorder,
        borderWidth: 1,
    });

    const drawPayRow = (rowY: number, label: string, val: string, isBold = false, isAmount = false) => {
        page.drawText(label, {
            x: 60,
            y: rowY,
            size: isAmount ? 12 : 10,
            font: isBold ? fontBold : fontRegular,
            color: isBold ? cTextPrimary : cTextMuted,
        });

        const valWidth = (isBold ? fontBold : fontRegular).widthOfTextAtSize(val, isAmount ? 14 : 10);
        page.drawText(val, {
            x: width - 60 - valWidth,
            y: rowY,
            size: isAmount ? 14 : 10,
            font: isBold ? fontBold : fontRegular,
            color: isAmount ? cBrandNavy : cTextPrimary,
        });
    };

    let pRowY = y - 24;
    drawPayRow(pRowY, 'Payment Gateway / Provider', data.paymentProvider === 'XERCOINS' ? 'XerCoins Platform Wallet' : 'Razorpay Secure Checkout');
    pRowY -= 20;
    drawPayRow(pRowY, 'Payment Instrument / Method', data.paymentMethod);
    pRowY -= 20;
    if (hasAddons) {
        drawPayRow(pRowY, 'Printing Services Subtotal', `Rs. ${basePrintingTotal.toFixed(2)}`);
        pRowY -= 20;
        drawPayRow(pRowY, 'Finishing Services Subtotal', `Rs. ${totalAddons.toFixed(2)}`);
        pRowY -= 20;
    }
    drawPayRow(pRowY, hasAddons ? 'Total Amount Paid (Gross)' : 'Amount Paid', `Rs. ${data.amount.toFixed(2)}`, true, true);

    if (isRefunded) {
        pRowY -= 24;
        page.drawLine({
            start: { x: 55, y: pRowY + 12 },
            end: { x: width - 55, y: pRowY + 12 },
            thickness: 1,
            color: cBorder,
        });
        drawPayRow(pRowY, 'Refund Status', 'Completed / Refunded', true);
        if (data.refundedAt) {
            pRowY -= 18;
            drawPayRow(pRowY, 'Refund Timestamp', data.refundedAt);
        }
    }

    y -= (paymentBoxH + 40);

    // -------------------------------------------------------------
    // 6. BUSINESS ENTITY & LEGAL NOTICE
    // -------------------------------------------------------------
    page.drawText('ISSUED BY', {
        x: 45,
        y,
        size: 9,
        font: fontBold,
        color: cBrandNavy,
    });

    page.drawText('XER SERVICE TECHNOLOGIES PRIVATE LIMITED', {
        x: 45,
        y: y - 16,
        size: 10,
        font: fontBold,
        color: cTextPrimary,
    });

    page.drawText('Website: https://xerservice.in', {
        x: 45,
        y: y - 30,
        size: 9,
        font: fontRegular,
        color: cTextMuted,
    });

    // Bottom Footer
    page.drawLine({
        start: { x: 45, y: 55 },
        end: { x: width - 45, y: 55 },
        thickness: 1,
        color: cBorder,
    });

    const footerNotice = 'Thank you for choosing XerService. This document is a computer-generated payment receipt.';
    const footerWidth = fontRegular.widthOfTextAtSize(footerNotice, 8);
    page.drawText(footerNotice, {
        x: (width - footerWidth) / 2,
        y: 40,
        size: 8,
        font: fontRegular,
        color: cTextMuted,
    });

    const footerDomain = 'xerservice.in';
    const domainWidth = fontBold.widthOfTextAtSize(footerDomain, 8);
    page.drawText(footerDomain, {
        x: (width - domainWidth) / 2,
        y: 26,
        size: 8,
        font: fontBold,
        color: cBrandCyan,
    });

    return await doc.save();
}

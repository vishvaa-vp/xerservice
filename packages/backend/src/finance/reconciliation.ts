/**
 * XerService Backend — Priority 3: Financial Reconciliation Engine
 *
 * Provides server-authoritative, auditable, and non-mutating detection of
 * financial discrepancies across orders, payment ledgers, refunds, and vendor settlements:
 *
 * 1. UNALLOCATED PAID ORDERS:
 *    - Orders marked PAID/COMPLETED with missing ledger rows.
 *    - Orders in UNCONFIGURED ledger status (unassigned commission).
 *    - Monetary discrepancy between order total and ledger gross amount.
 *
 * 2. UNRESOLVED REFUNDS:
 *    - Refund requests in PENDING, PROCESSING, or FAILED status.
 *    - Cancelled/failed orders that were paid but lack a refund record.
 *    - REVERSED ledger rows without referential refund audit IDs.
 *
 * 3. SETTLEMENT MISMATCHES:
 *    - SETTLED ledger rows missing from settlement items.
 *    - Batch total arithmetic mismatches (gross, payable, order count).
 *    - Cancelled/reversed orders present inside active settlement batches.
 *    - Stale PAYABLE orders (> 14 days without settlement).
 */

import type { SupabaseClient } from '@supabase/supabase-js';

type FinancialStatus = 'UNCONFIGURED' | 'PENDING' | 'PAYABLE' | 'SETTLED' | 'REVERSED';
type SettlementBatchStatus = 'DRAFT' | 'CONFIRMED' | 'PAID' | 'CANCELLED';

export type ReconciliationCategory = 'UNALLOCATED_ORDER' | 'UNRESOLVED_REFUND' | 'SETTLEMENT_MISMATCH';
export type ReconciliationSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export type ReconciliationType =
    | 'MISSING_LEDGER'
    | 'UNCONFIGURED_COMMISSION'
    | 'AMOUNT_MISMATCH'
    | 'PENDING_REFUND'
    | 'FAILED_REFUND'
    | 'CANCELLED_WITHOUT_REFUND'
    | 'REVERSED_WITHOUT_REFUND_RECORD'
    | 'SETTLED_WITHOUT_ITEM'
    | 'BATCH_SUM_MISMATCH'
    | 'REVERSED_IN_SETTLEMENT'
    | 'STALE_PAYABLE';

export interface ReconciliationAction {
    label: string;
    deepLink: string;
    suggestedFix: string;
}

export interface ReconciliationItem {
    id: string;
    category: ReconciliationCategory;
    type: ReconciliationType;
    severity: ReconciliationSeverity;
    title: string;
    description: string;
    orderId?: string;
    shopId?: string;
    shopName?: string;
    batchId?: string;
    settlementNumber?: string;
    refundRequestId?: string;
    amount?: number;
    currency: string;
    detectedAt: string;
    action: ReconciliationAction;
}

export interface ReconciliationSummary {
    totalIssues: number;
    criticalIssues: number;
    highIssues: number;
    mediumIssues: number;
    lowIssues: number;
    unallocatedOrdersCount: number;
    unallocatedAmount: number;
    unresolvedRefundsCount: number;
    unresolvedRefundAmount: number;
    settlementMismatchesCount: number;
    isReconciled: boolean;
}

export interface ReconciliationReport {
    summary: ReconciliationSummary;
    items: ReconciliationItem[];
    generatedAt: string;
}

export interface EvaluationInputOrder {
    id: string;
    shop_id: string;
    status: string;
    payment_status: string | null;
    total_amount: number;
    created_at: string;
    updated_at?: string;
}

export interface EvaluationInputLedger {
    id: string;
    order_id: string;
    shop_id: string;
    gross_amount: number;
    platform_commission_amount: number | null;
    vendor_net_amount: number | null;
    financial_status: FinancialStatus;
    refund_request_id: string | null;
    created_at: string;
    eligible_at?: string | null;
    settled_at?: string | null;
}

export interface EvaluationInputRefund {
    id: string;
    order_id: string;
    amount: number;
    status: 'PENDING' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED';
    provider: string;
    failure_reason?: string | null;
    created_at: string;
}

export interface EvaluationInputBatch {
    id: string;
    shop_id: string;
    settlement_number: string;
    gross_order_amount: number;
    platform_commission_amount: number;
    vendor_payable_amount: number;
    order_count: number;
    status: SettlementBatchStatus;
    created_at: string;
}

export interface EvaluationInputSettlementItem {
    id: string;
    settlement_batch_id: string;
    order_financial_ledger_id: string;
    order_id: string;
    gross_amount: number;
    platform_commission_amount: number;
    vendor_payable_amount: number;
}

export interface EvaluationInputShop {
    id: string;
    name: string;
}

export interface EvaluateReconciliationParams {
    orders: EvaluationInputOrder[];
    ledgerRecords: EvaluationInputLedger[];
    refundRequests: EvaluationInputRefund[];
    settlementBatches: EvaluationInputBatch[];
    settlementItems: EvaluationInputSettlementItem[];
    shops: EvaluationInputShop[];
    asOfDate?: Date;
    stalePayableThresholdDays?: number;
}

/**
 * Pure Evaluation Function
 * Evaluates in-memory data structures without network side-effects.
 */
export function evaluateReconciliation({
    orders,
    ledgerRecords,
    refundRequests,
    settlementBatches,
    settlementItems,
    shops,
    asOfDate = new Date(),
    stalePayableThresholdDays = 14,
}: EvaluateReconciliationParams): ReconciliationReport {
    const shopMap = new Map<string, string>();
    shops.forEach(s => shopMap.set(s.id, s.name));

    const ledgerByOrderId = new Map<string, EvaluationInputLedger>();
    const ledgerById = new Map<string, EvaluationInputLedger>();
    ledgerRecords.forEach(l => {
        ledgerByOrderId.set(l.order_id, l);
        ledgerById.set(l.id, l);
    });

    const refundsByOrderId = new Map<string, EvaluationInputRefund[]>();
    refundRequests.forEach(r => {
        const existing = refundsByOrderId.get(r.order_id) || [];
        existing.push(r);
        refundsByOrderId.set(r.order_id, existing);
    });

    const settlementItemByLedgerId = new Map<string, EvaluationInputSettlementItem>();
    const itemsByBatchId = new Map<string, EvaluationInputSettlementItem[]>();
    settlementItems.forEach(item => {
        settlementItemByLedgerId.set(item.order_financial_ledger_id, item);
        const batchList = itemsByBatchId.get(item.settlement_batch_id) || [];
        batchList.push(item);
        itemsByBatchId.set(item.settlement_batch_id, batchList);
    });

    const items: ReconciliationItem[] = [];
    const nowIso = asOfDate.toISOString();
    const staleThresholdMs = stalePayableThresholdDays * 24 * 60 * 60 * 1000;

    // =========================================================================
    // 1. UNALLOCATED PAID ORDERS
    // =========================================================================

    orders.forEach(order => {
        const shopName = shopMap.get(order.shop_id) || 'Unknown Shop';
        const isPaidStatus = order.payment_status === 'PAID' ||
            ['PAID', 'QUEUED', 'PRINTING', 'READY', 'COMPLETED'].includes(order.status);
        const isCancelled = order.status === 'CANCELLED' || order.status === 'FAILED';

        const ledger = ledgerByOrderId.get(order.id);

        // Discrepancy 1A: Paid order missing from ledger
        if (isPaidStatus && !isCancelled && !ledger) {
            items.push({
                id: `unallocated:missing_ledger:${order.id}`,
                category: 'UNALLOCATED_ORDER',
                type: 'MISSING_LEDGER',
                severity: 'CRITICAL',
                title: `Missing Financial Ledger for Paid Order #${order.id.slice(0, 8)}`,
                description: `Order has paid status (${order.payment_status || order.status}) with gross total ₹${order.total_amount.toFixed(2)}, but no ledger entry exists in order_financial_ledger.`,
                orderId: order.id,
                shopId: order.shop_id,
                shopName,
                amount: order.total_amount,
                currency: 'INR',
                detectedAt: nowIso,
                action: {
                    label: 'Generate Ledger Entry',
                    deepLink: `/admin/finance?tab=shops&shopId=${order.shop_id}`,
                    suggestedFix: 'Verify successful payment attempt and allocate initial ledger entry.',
                },
            });
        }

        // Discrepancy 1B: Order total amount != Ledger gross amount
        if (ledger && Number(order.total_amount) !== Number(ledger.gross_amount)) {
            items.push({
                id: `unallocated:amount_mismatch:${order.id}`,
                category: 'UNALLOCATED_ORDER',
                type: 'AMOUNT_MISMATCH',
                severity: 'CRITICAL',
                title: `Gross Amount Mismatch on Order #${order.id.slice(0, 8)}`,
                description: `Order total amount is ₹${order.total_amount.toFixed(2)}, but ledger record #${ledger.id.slice(0, 8)} has gross amount ₹${ledger.gross_amount.toFixed(2)}.`,
                orderId: order.id,
                shopId: order.shop_id,
                shopName,
                amount: Math.abs(order.total_amount - ledger.gross_amount),
                currency: 'INR',
                detectedAt: nowIso,
                action: {
                    label: 'Audit Payment Attempt',
                    deepLink: `/admin/finance?tab=shops&shopId=${order.shop_id}`,
                    suggestedFix: 'Inspect payment attempts and verify whether a partial charge or adjustment was recorded.',
                },
            });
        }
    });

    // Discrepancy 1C: UNCONFIGURED commission rule on ledger
    ledgerRecords.forEach(ledger => {
        const shopName = shopMap.get(ledger.shop_id) || 'Unknown Shop';

        if (ledger.financial_status === 'UNCONFIGURED') {
            items.push({
                id: `unallocated:unconfigured:${ledger.id}`,
                category: 'UNALLOCATED_ORDER',
                type: 'UNCONFIGURED_COMMISSION',
                severity: 'HIGH',
                title: `Unallocated Commission on Order #${ledger.order_id.slice(0, 8)}`,
                description: `Ledger entry #${ledger.id.slice(0, 8)} is in UNCONFIGURED status. Platform fee and vendor net share (₹${ledger.gross_amount.toFixed(2)}) remain unallocated due to missing commission rule at order time.`,
                orderId: ledger.order_id,
                shopId: ledger.shop_id,
                shopName,
                amount: ledger.gross_amount,
                currency: 'INR',
                detectedAt: nowIso,
                action: {
                    label: 'Configure Shop Commission',
                    deepLink: `/admin/finance?tab=shops&shopId=${ledger.shop_id}`,
                    suggestedFix: 'Assign an active commission rule for the shop and recalculate unconfigured orders.',
                },
            });
        }
    });

    // =========================================================================
    // 2. UNRESOLVED REFUNDS
    // =========================================================================

    refundRequests.forEach(refund => {
        const ledger = ledgerByOrderId.get(refund.order_id);
        const shopId = ledger?.shop_id || '';
        const shopName = shopId ? (shopMap.get(shopId) || 'Unknown Shop') : 'Unknown Shop';

        // Discrepancy 2A: Failed refund request
        if (refund.status === 'FAILED') {
            items.push({
                id: `refund:failed:${refund.id}`,
                category: 'UNRESOLVED_REFUND',
                type: 'FAILED_REFUND',
                severity: 'CRITICAL',
                title: `Failed Refund of ₹${refund.amount.toFixed(2)} on Order #${refund.order_id.slice(0, 8)}`,
                description: `Refund request #${refund.id.slice(0, 8)} via ${refund.provider} failed. ${refund.failure_reason ? `Reason: ${refund.failure_reason}.` : 'Customer has not received their refund.'}`,
                orderId: refund.order_id,
                shopId,
                shopName,
                refundRequestId: refund.id,
                amount: refund.amount,
                currency: 'INR',
                detectedAt: nowIso,
                action: {
                    label: 'Retry or Manually Reconcile',
                    deepLink: `/admin/finance?tab=overview`,
                    suggestedFix: 'Inspect provider failure log, retry refund dispatch, or issue direct wallet compensation.',
                },
            });
        }

        // Discrepancy 2B: Pending or processing refund request
        if (refund.status === 'PENDING' || refund.status === 'PROCESSING') {
            items.push({
                id: `refund:pending:${refund.id}`,
                category: 'UNRESOLVED_REFUND',
                type: 'PENDING_REFUND',
                severity: 'HIGH',
                title: `Pending Refund of ₹${refund.amount.toFixed(2)} on Order #${refund.order_id.slice(0, 8)}`,
                description: `Refund request #${refund.id.slice(0, 8)} via ${refund.provider} is currently ${refund.status} and awaiting provider settlement.`,
                orderId: refund.order_id,
                shopId,
                shopName,
                refundRequestId: refund.id,
                amount: refund.amount,
                currency: 'INR',
                detectedAt: nowIso,
                action: {
                    label: 'Check Provider Status',
                    deepLink: `/admin/finance?tab=overview`,
                    suggestedFix: 'Verify provider webhook delivery or poll Razorpay/wallet status.',
                },
            });
        }
    });

    // Discrepancy 2C: Cancelled order that was paid but has no refund record
    orders.forEach(order => {
        const isCancelled = order.status === 'CANCELLED' || order.status === 'FAILED';
        const wasPaid = order.payment_status === 'PAID';
        const refunds = refundsByOrderId.get(order.id) || [];
        const ledger = ledgerByOrderId.get(order.id);

        if (isCancelled && wasPaid && refunds.length === 0 && ledger?.financial_status !== 'REVERSED') {
            const shopName = shopMap.get(order.shop_id) || 'Unknown Shop';
            items.push({
                id: `refund:cancelled_no_refund:${order.id}`,
                category: 'UNRESOLVED_REFUND',
                type: 'CANCELLED_WITHOUT_REFUND',
                severity: 'CRITICAL',
                title: `Cancelled Paid Order #${order.id.slice(0, 8)} Missing Refund`,
                description: `Order was cancelled after customer payment (₹${order.total_amount.toFixed(2)}), but no refund request has been initiated and ledger is not reversed.`,
                orderId: order.id,
                shopId: order.shop_id,
                shopName,
                amount: order.total_amount,
                currency: 'INR',
                detectedAt: nowIso,
                action: {
                    label: 'Initiate Refund',
                    deepLink: `/admin/finance?tab=overview`,
                    suggestedFix: 'Trigger server-side refund request and update financial ledger to REVERSED.',
                },
            });
        }
    });

    // Discrepancy 2D: REVERSED ledger entry missing refund_request_id audit link
    ledgerRecords.forEach(ledger => {
        if (ledger.financial_status === 'REVERSED' && !ledger.refund_request_id) {
            const shopName = shopMap.get(ledger.shop_id) || 'Unknown Shop';
            items.push({
                id: `refund:reversed_no_link:${ledger.id}`,
                category: 'UNRESOLVED_REFUND',
                type: 'REVERSED_WITHOUT_REFUND_RECORD',
                severity: 'MEDIUM',
                title: `Reversed Ledger #${ledger.id.slice(0, 8)} Missing Refund Audit Link`,
                description: `Ledger entry is marked REVERSED for order #${ledger.order_id.slice(0, 8)}, but refund_request_id is null in the audit trail.`,
                orderId: ledger.order_id,
                shopId: ledger.shop_id,
                shopName,
                amount: ledger.gross_amount,
                currency: 'INR',
                detectedAt: nowIso,
                action: {
                    label: 'Link Refund Audit ID',
                    deepLink: `/admin/finance?tab=shops&shopId=${ledger.shop_id}`,
                    suggestedFix: 'Audit refund records and associate the matching refund request id to maintain complete provenance.',
                },
            });
        }
    });

    // =========================================================================
    // 3. SETTLEMENT MISMATCHES
    // =========================================================================

    // Discrepancy 3A: SETTLED ledger row without settlement item
    ledgerRecords.forEach(ledger => {
        if (ledger.financial_status === 'SETTLED') {
            const hasItem = settlementItemByLedgerId.has(ledger.id);
            if (!hasItem) {
                const shopName = shopMap.get(ledger.shop_id) || 'Unknown Shop';
                items.push({
                    id: `settlement:settled_no_item:${ledger.id}`,
                    category: 'SETTLEMENT_MISMATCH',
                    type: 'SETTLED_WITHOUT_ITEM',
                    severity: 'CRITICAL',
                    title: `Settled Order #${ledger.order_id.slice(0, 8)} Not Linked to Any Settlement Batch`,
                    description: `Ledger entry #${ledger.id.slice(0, 8)} has financial_status = 'SETTLED', but is not attached to any vendor_settlement_items row.`,
                    orderId: ledger.order_id,
                    shopId: ledger.shop_id,
                    shopName,
                    amount: ledger.vendor_net_amount ?? ledger.gross_amount,
                    currency: 'INR',
                    detectedAt: nowIso,
                    action: {
                        label: 'Audit Settlement Batches',
                        deepLink: `/admin/finance?tab=settlements`,
                        suggestedFix: 'Identify whether this was settled offline and attach to a confirmed batch or revert status to PAYABLE.',
                    },
                });
            }
        }
    });

    // Discrepancy 3B: Settlement Batch Arithmetic Discrepancy
    settlementBatches.forEach(batch => {
        const batchItems = itemsByBatchId.get(batch.id) || [];
        const shopName = shopMap.get(batch.shop_id) || 'Unknown Shop';

        const sumGross = batchItems.reduce((acc, it) => acc + Number(it.gross_amount), 0);
        const sumPayable = batchItems.reduce((acc, it) => acc + Number(it.vendor_payable_amount), 0);
        const itemCount = batchItems.length;

        const grossDiff = Math.abs(Number(batch.gross_order_amount) - sumGross);
        const payableDiff = Math.abs(Number(batch.vendor_payable_amount) - sumPayable);
        const countDiff = Math.abs(Number(batch.order_count) - itemCount);

        // Allow at most 0.02 tolerance for floating point summation
        if (grossDiff > 0.02 || payableDiff > 0.02 || countDiff > 0) {
            items.push({
                id: `settlement:batch_math_mismatch:${batch.id}`,
                category: 'SETTLEMENT_MISMATCH',
                type: 'BATCH_SUM_MISMATCH',
                severity: 'CRITICAL',
                title: `Arithmetic Mismatch in Settlement Batch ${batch.settlement_number}`,
                description: `Batch header totals (Gross: ₹${batch.gross_order_amount.toFixed(2)}, Payable: ₹${batch.vendor_payable_amount.toFixed(2)}, Orders: ${batch.order_count}) do not match item sums (Gross: ₹${sumGross.toFixed(2)}, Payable: ₹${sumPayable.toFixed(2)}, Items: ${itemCount}).`,
                batchId: batch.id,
                settlementNumber: batch.settlement_number,
                shopId: batch.shop_id,
                shopName,
                amount: Math.max(grossDiff, payableDiff),
                currency: 'INR',
                detectedAt: nowIso,
                action: {
                    label: 'Review Settlement Batch',
                    deepLink: `/admin/finance?tab=settlements`,
                    suggestedFix: 'Recompute batch aggregates from verified settlement items.',
                },
            });
        }
    });

    // Discrepancy 3C: Reversed order inside active settlement batch
    settlementItems.forEach(item => {
        const ledger = ledgerById.get(item.order_financial_ledger_id);
        const batch = settlementBatches.find(b => b.id === item.settlement_batch_id);

        if (batch && batch.status !== 'CANCELLED' && ledger && ledger.financial_status === 'REVERSED') {
            const shopName = shopMap.get(batch.shop_id) || 'Unknown Shop';
            items.push({
                id: `settlement:reversed_in_batch:${item.id}`,
                category: 'SETTLEMENT_MISMATCH',
                type: 'REVERSED_IN_SETTLEMENT',
                severity: 'CRITICAL',
                title: `Reversed Order #${item.order_id.slice(0, 8)} Inside Active Batch ${batch.settlement_number}`,
                description: `Settlement batch ${batch.settlement_number} (${batch.status}) contains an item for order #${item.order_id.slice(0, 8)} whose financial ledger is REVERSED.`,
                batchId: batch.id,
                settlementNumber: batch.settlement_number,
                orderId: item.order_id,
                shopId: batch.shop_id,
                shopName,
                amount: item.vendor_payable_amount,
                currency: 'INR',
                detectedAt: nowIso,
                action: {
                    label: 'Clawback or Remove Item',
                    deepLink: `/admin/finance?tab=settlements`,
                    suggestedFix: 'Cancel the draft batch or record a manual clawback adjustment before marking paid.',
                },
            });
        }
    });

    // Discrepancy 3D: Stale PAYABLE orders (> threshold days without batching)
    ledgerRecords.forEach(ledger => {
        if (ledger.financial_status === 'PAYABLE') {
            const hasItem = settlementItemByLedgerId.has(ledger.id);
            if (!hasItem) {
                const eligibleTimestamp = new Date(ledger.eligible_at || ledger.created_at).getTime();
                const ageMs = asOfDate.getTime() - eligibleTimestamp;

                if (ageMs > staleThresholdMs) {
                    const shopName = shopMap.get(ledger.shop_id) || 'Unknown Shop';
                    const ageDays = Math.floor(ageMs / (24 * 60 * 60 * 1000));
                    items.push({
                        id: `settlement:stale_payable:${ledger.id}`,
                        category: 'SETTLEMENT_MISMATCH',
                        type: 'STALE_PAYABLE',
                        severity: 'LOW',
                        title: `Unsettled Payable Order #${ledger.order_id.slice(0, 8)} (${ageDays} Days Old)`,
                        description: `Order has been payable for ${ageDays} days (₹${(ledger.vendor_net_amount ?? ledger.gross_amount).toFixed(2)}) without being included in any settlement batch.`,
                        orderId: ledger.order_id,
                        shopId: ledger.shop_id,
                        shopName,
                        amount: ledger.vendor_net_amount ?? ledger.gross_amount,
                        currency: 'INR',
                        detectedAt: nowIso,
                        action: {
                            label: 'Generate Settlement Batch',
                            deepLink: `/admin/finance?tab=settlements`,
                            suggestedFix: 'Review shop payable balance and include into the next payout batch.',
                        },
                    });
                }
            }
        }
    });

    // Compute Summary Statistics
    let criticalIssues = 0;
    let highIssues = 0;
    let mediumIssues = 0;
    let lowIssues = 0;

    let unallocatedOrdersCount = 0;
    let unallocatedAmount = 0;
    let unresolvedRefundsCount = 0;
    let unresolvedRefundAmount = 0;
    let settlementMismatchesCount = 0;

    items.forEach(item => {
        if (item.severity === 'CRITICAL') criticalIssues++;
        else if (item.severity === 'HIGH') highIssues++;
        else if (item.severity === 'MEDIUM') mediumIssues++;
        else if (item.severity === 'LOW') lowIssues++;

        if (item.category === 'UNALLOCATED_ORDER') {
            unallocatedOrdersCount++;
            unallocatedAmount += item.amount || 0;
        } else if (item.category === 'UNRESOLVED_REFUND') {
            unresolvedRefundsCount++;
            unresolvedRefundAmount += item.amount || 0;
        } else if (item.category === 'SETTLEMENT_MISMATCH') {
            settlementMismatchesCount++;
        }
    });

    const summary: ReconciliationSummary = {
        totalIssues: items.length,
        criticalIssues,
        highIssues,
        mediumIssues,
        lowIssues,
        unallocatedOrdersCount,
        unallocatedAmount: Math.round(unallocatedAmount * 100) / 100,
        unresolvedRefundsCount,
        unresolvedRefundAmount: Math.round(unresolvedRefundAmount * 100) / 100,
        settlementMismatchesCount,
        isReconciled: items.length === 0,
    };

    return {
        summary,
        items,
        generatedAt: nowIso,
    };
}

/**
 * Server Database Fetcher Function
 * Reads remote tables in read-only mode and executes evaluateReconciliation.
 */
export async function getFinancialReconciliationReport(
    sb: SupabaseClient,
    filters?: {
        category?: ReconciliationCategory;
        severity?: ReconciliationSeverity;
        shopId?: string;
    }
): Promise<ReconciliationReport> {
    // 1. Fetch Orders
    let orderQuery = sb.from('orders').select('id, shop_id, status, payment_status, total_amount, created_at, updated_at');
    if (filters?.shopId) {
        orderQuery = orderQuery.eq('shop_id', filters.shopId);
    }
    const { data: orders, error: ordersErr } = await orderQuery;
    if (ordersErr) throw new Error(`[Reconciliation] Failed to fetch orders: ${ordersErr.message}`);

    // 2. Fetch Ledger Records
    let ledgerQuery = sb.from('order_financial_ledger').select('id, order_id, shop_id, gross_amount, platform_commission_amount, vendor_net_amount, financial_status, refund_request_id, created_at, eligible_at, settled_at');
    if (filters?.shopId) {
        ledgerQuery = ledgerQuery.eq('shop_id', filters.shopId);
    }
    const { data: ledgerRecords, error: ledgerErr } = await ledgerQuery;
    if (ledgerErr) throw new Error(`[Reconciliation] Failed to fetch ledger: ${ledgerErr.message}`);

    // 3. Fetch Refund Requests
    const { data: refundRequests, error: refundsErr } = await sb.from('refund_requests').select('id, order_id, amount, status, provider, failure_reason, created_at');
    if (refundsErr) throw new Error(`[Reconciliation] Failed to fetch refunds: ${refundsErr.message}`);

    // 4. Fetch Settlement Batches
    let batchQuery = sb.from('vendor_settlement_batches').select('id, shop_id, settlement_number, gross_order_amount, platform_commission_amount, vendor_payable_amount, order_count, status, created_at');
    if (filters?.shopId) {
        batchQuery = batchQuery.eq('shop_id', filters.shopId);
    }
    const { data: settlementBatches, error: batchesErr } = await batchQuery;
    if (batchesErr) throw new Error(`[Reconciliation] Failed to fetch batches: ${batchesErr.message}`);

    // 5. Fetch Settlement Items
    const { data: settlementItems, error: itemsErr } = await sb.from('vendor_settlement_items').select('id, settlement_batch_id, order_financial_ledger_id, order_id, gross_amount, platform_commission_amount, vendor_payable_amount');
    if (itemsErr) throw new Error(`[Reconciliation] Failed to fetch settlement items: ${itemsErr.message}`);

    // 6. Fetch Shops
    const { data: shops, error: shopsErr } = await sb.from('shops').select('id, name');
    if (shopsErr) throw new Error(`[Reconciliation] Failed to fetch shops: ${shopsErr.message}`);

    // Run pure evaluation
    const report = evaluateReconciliation({
        orders: orders || [],
        ledgerRecords: ledgerRecords || [],
        refundRequests: refundRequests || [],
        settlementBatches: settlementBatches || [],
        settlementItems: settlementItems || [],
        shops: shops || [],
    });

    // Apply optional post-filters if specified
    if (filters?.category || filters?.severity) {
        const filteredItems = report.items.filter(it => {
            if (filters.category && it.category !== filters.category) return false;
            if (filters.severity && it.severity !== filters.severity) return false;
            return true;
        });

        return {
            ...report,
            items: filteredItems,
        };
    }

    return report;
}

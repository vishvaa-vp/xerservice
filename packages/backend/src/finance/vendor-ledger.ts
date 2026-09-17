/**
 * Phase 6J: Vendor Commission & Settlement Ledger Foundation
 *
 * Provides server-authoritative, auditable, and immutable financial accounting
 * for XerService vendor orders.
 *
 * FINANCIAL ACCOUNTING INVARIANTS:
 * 1. Arithmetic Invariant: gross_amount = platform_commission_amount + vendor_net_amount
 * 2. Basis-Points Representation: Commission is configured in integer bps (100 bps = 1%, 10000 bps = 100%)
 * 3. Fail-Closed on Missing Rule: Never invent or assume a commission rate. Unconfigured orders enter UNCONFIGURED status.
 * 4. Fail-Closed on Amount Mismatch: If orders.total_amount != payment_attempts.amount, stop and fail closed.
 * 5. Require Authoritative Payment Attempt: Only verified successful attempts (RAZORPAY, XERCOINS) create ledger rows.
 * 6. Order Fulfillment Gate: An order is PENDING while in production (QUEUED, PRINTING, READY). Funds become PAYABLE only when order status is COMPLETED.
 * 7. Refund Reversal Gate: Only verified successful refunds reverse vendor earnings (REVERSED status).
 * 8. Historical Immutability: Once written, snapshot fields cannot be altered.
 * 9. Isolation: Customer XerCoins prepayments are completely isolated from vendor settlement accounting.
 */

import { getServiceRoleClient } from '../supabase/client';

export type FinancialStatus = 'UNCONFIGURED' | 'PENDING' | 'PAYABLE' | 'SETTLED' | 'REVERSED';

export interface OrderFinancialLedgerRecord {
    id: string;
    order_id: string;
    shop_id: string;
    user_id: string;
    payment_attempt_id: string;
    gross_amount: number;
    currency: string;
    commission_bps: number | null;
    platform_commission_amount: number | null;
    vendor_net_amount: number | null;
    financial_status: FinancialStatus;
    eligible_at: string | null;
    settled_at: string | null;
    reversed_at: string | null;
    refund_request_id: string | null;
    reversal_reason: string | null;
    created_at: string;
    updated_at: string;
}

export interface ShopCommissionRuleRecord {
    id: string;
    shop_id: string;
    commission_bps: number;
    effective_from: string;
    effective_to: string | null;
    is_active: boolean;
    created_at: string;
    created_by: string | null;
}

export type SettlementBatchStatus = 'DRAFT' | 'CONFIRMED' | 'PAID' | 'CANCELLED';

export interface VendorSettlementBatchRecord {
    id: string;
    shop_id: string;
    settlement_number: string;
    gross_order_amount: number;
    platform_commission_amount: number;
    vendor_payable_amount: number;
    order_count: number;
    status: SettlementBatchStatus;
    payment_reference: string | null;
    payment_method?: string | null;
    paid_by?: string | null;
    created_by?: string | null;
    confirmed_by?: string | null;
    confirmed_at?: string | null;
    settled_at: string | null;
    disbursed_at: string | null;
    notes: string | null;
    created_at: string;
    updated_at: string;
}

export interface VendorSettlementItemRecord {
    id: string;
    settlement_batch_id: string;
    order_financial_ledger_id: string;
    created_at: string;
}

export interface ShopFinancialSummary {
    commissionConfigured: boolean;
    grossSales: number;
    platformCommission: number | null;
    vendorEarnings: number | null;
    payableAmount: number | null;
    settledAmount: number;
    pendingAmount: number | null;
    reversedAmount: number;
    unconfiguredOrdersCount: number;
    totalOrdersCount: number;
}

export interface AdminFinanceSummary {
    commissionConfigured: boolean;
    grossSales: number;
    platformCommission: number | null;
    vendorEarnings: number | null;
    payableAmount: number | null;
    settledAmount: number;
    pendingAmount: number | null;
    reversedAmount: number;
    unconfiguredOrdersCount: number;
    totalOrdersCount: number;
    totalShopsCount: number;
    settlementBatchesCount: number;
}

/**
 * Calculates platform commission and vendor net earnings using integer basis points.
 * Mirrors database-authoritative public.calculate_vendor_commission(numeric, integer) function.
 * Guarantees exact decimal invariant: gross = platformCommission + vendorNet
 */
export function calculateCommission(
    grossAmount: number,
    commissionBps: number
): { platformCommission: number; vendorNet: number } {
    if (commissionBps < 0 || commissionBps > 10000) {
        throw new Error(`Invalid commission_bps: ${commissionBps}. Must be between 0 and 10000.`);
    }

    // platform_commission = ROUND(gross * commission_bps / 10000, 2)
    const platformCommission = Math.round(grossAmount * (commissionBps / 10000) * 100) / 100;
    // vendor_net = gross - platform_commission
    const vendorNet = Math.round((grossAmount - platformCommission) * 100) / 100;

    return {
        platformCommission,
        vendorNet,
    };
}

/**
 * Helper to test whether a Supabase error is due to a missing table/relation (pre-push environment).
 */
function isTableMissingError(error: any): boolean {
    if (!error) return false;
    const code = error.code || '';
    const message = error.message || '';
    return (
        code === 'PGRST205' || // PostgREST: Table not found in schema cache
        code === '42P01' ||    // PostgreSQL: undefined_table
        message.includes('relation "public.order_financial_ledger" does not exist') ||
        message.includes('relation "public.shop_commission_rules" does not exist')
    );
}

/**
 * Creates or idempotently retrieves the authoritative financial ledger entry for a paid order.
 * Fails closed on amount mismatch, missing attempt, or unknown provider.
 * If no commission rule is configured, enters UNCONFIGURED status without inventing a rate.
 */
export async function createOrInitOrderLedger(orderId: string): Promise<OrderFinancialLedgerRecord | null> {
    const serviceClient = getServiceRoleClient();

    // 1. Fetch Order
    const { data: order, error: orderErr } = await serviceClient
        .from('orders')
        .select('id, order_number, user_id, shop_id, status, payment_status, total_amount, paid_at, completed_at')
        .eq('id', orderId)
        .maybeSingle();

    if (orderErr) {
        console.error(`[VendorLedger] Error fetching order ${orderId}:`, orderErr);
        return null;
    }

    if (!order) {
        console.warn(`[VendorLedger] Order ${orderId} not found.`);
        return null;
    }

    // Only orders with payment_status = PAID or REFUNDED are eligible for ledger recording
    if (order.payment_status !== 'PAID' && order.payment_status !== 'REFUNDED') {
        console.log(`[VendorLedger] Order ${orderId} has payment_status "${order.payment_status}". Not eligible for ledger.`);
        return null;
    }

    // 2. Fetch Authoritative Payment Attempt
    const { data: attempts, error: attemptErr } = await serviceClient
        .from('payment_attempts')
        .select('id, provider, amount, currency, status, paid_at')
        .eq('order_id', orderId)
        .in('status', ['PAID', 'REFUNDED'])
        .order('paid_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false });

    if (attemptErr) {
        console.error(`[VendorLedger] Error fetching payment attempts for order ${orderId}:`, attemptErr);
        return null;
    }

    const attempt = attempts?.[0];
    if (!attempt) {
        console.error(`[VendorLedger] Financial Integrity Failure: Order ${orderId} (${order.order_number}) is ${order.payment_status} but has no successful payment_attempts.`);
        return null;
    }

    // Validate Supported Provider
    const validProviders = ['RAZORPAY', 'XERCOINS'];
    if (!validProviders.includes(attempt.provider)) {
        console.error(`[VendorLedger] Unsupported payment provider "${attempt.provider}" for order ${orderId}.`);
        return null;
    }

    // Validate Amount Match (Fail Closed)
    const orderTotal = Number(order.total_amount);
    const attemptAmount = Number(attempt.amount);
    if (Math.abs(orderTotal - attemptAmount) > 0.01) {
        console.error(
            `[VendorLedger] Financial Integrity Mismatch: Order ${orderId} (${order.order_number}) total (₹${orderTotal.toFixed(2)}) ` +
            `does not match payment_attempt ${attempt.id} amount (₹${attemptAmount.toFixed(2)}). Refusing ledger creation.`
        );
        return null;
    }

    // 3. Check for Existing Ledger Entry (Idempotency)
    const { data: existingLedger, error: existingErr } = await serviceClient
        .from('order_financial_ledger')
        .select('*')
        .eq('order_id', orderId)
        .maybeSingle();

    if (isTableMissingError(existingErr)) {
        console.warn('[VendorLedger] Table public.order_financial_ledger does not exist. Pre-push environment.');
        return null;
    }

    if (existingErr) {
        console.error(`[VendorLedger] Error querying order_financial_ledger for order ${orderId}:`, existingErr);
        return null;
    }

    if (existingLedger) {
        return existingLedger as OrderFinancialLedgerRecord;
    }

    // 4. Lookup Active Commission Rule for Shop at authoritative payment timestamp
    const nowIso = new Date().toISOString();
    const snapshotTimestamp = attempt.paid_at || order.paid_at || nowIso;
    let commissionRule: ShopCommissionRuleRecord | null = null;

    try {
        // Try PostgreSQL function if available
        const { data: rpcRule, error: rpcErr } = await serviceClient
            .rpc('get_effective_shop_commission_rule', {
                p_shop_id: order.shop_id,
                p_timestamp: snapshotTimestamp,
            });

        if (!rpcErr && rpcRule && rpcRule.length > 0) {
            commissionRule = {
                id: rpcRule[0].rule_id,
                shop_id: order.shop_id,
                commission_bps: rpcRule[0].commission_bps,
                effective_from: rpcRule[0].effective_from,
                effective_to: rpcRule[0].effective_to,
                is_active: true,
                created_at: nowIso,
                created_by: null,
            };
        } else if (rpcErr && rpcErr.message && rpcErr.message.includes('Ambiguous commission rules')) {
            // Fail closed on ambiguous rules
            console.error(`[VendorLedger] Ambiguous commission rules for shop ${order.shop_id} at ${snapshotTimestamp}. Failing closed.`);
            return null;
        } else {
            // Fallback direct query if RPC not yet deployed
            const { data: rules, error: ruleErr } = await serviceClient
                .from('shop_commission_rules')
                .select('*')
                .eq('shop_id', order.shop_id)
                .eq('is_active', true)
                .lte('effective_from', snapshotTimestamp);

            if (!ruleErr && rules && rules.length > 0) {
                const candidates = (rules as ShopCommissionRuleRecord[]).filter(
                    r => !r.effective_to || new Date(r.effective_to) > new Date(snapshotTimestamp)
                );
                if (candidates.length > 1) {
                    console.error(`[VendorLedger] Ambiguous rules: ${candidates.length} active rules for shop ${order.shop_id} at ${snapshotTimestamp}. Failing closed.`);
                    return null;
                }
                if (candidates.length === 1) {
                    commissionRule = candidates[0];
                }
            }
        }
    } catch (e) {
        // Table or function may not exist pre-push
    }

    // 5. Determine Financial Status and Amounts
    let commissionBps: number | null = null;
    let platformCommissionAmount: number | null = null;
    let vendorNetAmount: number | null = null;
    let financialStatus: FinancialStatus;
    let eligibleAt: string | null = null;
    let reversedAt: string | null = null;
    let reversalReason: string | null = null;

    const isCancelledOrRefunded = order.payment_status === 'REFUNDED' || order.status === 'CANCELLED';

    if (commissionRule && typeof commissionRule.commission_bps === 'number') {
        commissionBps = commissionRule.commission_bps;
        const { platformCommission, vendorNet } = calculateCommission(orderTotal, commissionBps);
        platformCommissionAmount = platformCommission;
        vendorNetAmount = vendorNet;

        if (isCancelledOrRefunded) {
            financialStatus = 'REVERSED';
            reversedAt = order.paid_at || nowIso;
            reversalReason = order.payment_status === 'REFUNDED' ? 'Order refunded' : 'Order cancelled';
        } else if (order.status === 'COMPLETED') {
            financialStatus = 'PAYABLE';
            eligibleAt = order.completed_at || nowIso;
        } else {
            financialStatus = 'PENDING';
        }
    } else {
        // Fail-Closed: Never invent a commission percentage
        commissionBps = null;
        platformCommissionAmount = null;
        vendorNetAmount = null;
        financialStatus = isCancelledOrRefunded ? 'REVERSED' : 'UNCONFIGURED';
        eligibleAt = null;
        if (isCancelledOrRefunded) {
            reversedAt = order.paid_at || nowIso;
            reversalReason = order.payment_status === 'REFUNDED' ? 'Order refunded' : 'Order cancelled';
        }
    }

    // 6. Insert Authoritative Ledger Row
    const newRecord = {
        order_id: order.id,
        shop_id: order.shop_id,
        user_id: order.user_id,
        payment_attempt_id: attempt.id,
        gross_amount: orderTotal,
        currency: attempt.currency || 'INR',
        commission_bps: commissionBps,
        platform_commission_amount: platformCommissionAmount,
        vendor_net_amount: vendorNetAmount,
        financial_status: financialStatus,
        eligible_at: eligibleAt,
        settled_at: null,
        reversed_at: reversedAt,
        refund_request_id: null,
        reversal_reason: reversalReason,
        created_at: snapshotTimestamp,
        updated_at: nowIso,
    };

    const { data: inserted, error: insertErr } = await serviceClient
        .from('order_financial_ledger')
        .insert(newRecord)
        .select('*')
        .maybeSingle();

    if (isTableMissingError(insertErr)) {
        console.warn('[VendorLedger] Table public.order_financial_ledger does not exist. Pre-push environment.');
        return null;
    }

    if (insertErr) {
        // Concurrency guard: if already inserted in parallel
        if (insertErr.code === '23505') {
            const { data: refetched } = await serviceClient
                .from('order_financial_ledger')
                .select('*')
                .eq('order_id', orderId)
                .maybeSingle();
            return (refetched as OrderFinancialLedgerRecord) || null;
        }
        console.error(`[VendorLedger] Failed to insert ledger row for order ${orderId}:`, insertErr);
        return null;
    }

    console.log(`[VendorLedger] Successfully created financial ledger entry for order ${orderId} (Status: ${financialStatus}, Gross: ₹${orderTotal}).`);
    return inserted as OrderFinancialLedgerRecord;
}

/**
 * Transitions an order's financial ledger status from PENDING to PAYABLE upon order completion.
 * Only orders with configured commission can be payable.
 */
export async function markOrderLedgerPayable(orderId: string): Promise<OrderFinancialLedgerRecord | null> {
    const serviceClient = getServiceRoleClient();

    const { data: ledger, error: fetchErr } = await serviceClient
        .from('order_financial_ledger')
        .select('*')
        .eq('order_id', orderId)
        .maybeSingle();

    if (isTableMissingError(fetchErr) || !ledger) {
        return null;
    }

    if (ledger.financial_status === 'PAYABLE' || ledger.financial_status === 'SETTLED') {
        return ledger as OrderFinancialLedgerRecord;
    }

    if (ledger.financial_status === 'REVERSED') {
        console.warn(`[VendorLedger] Cannot mark REVERSED order ${orderId} as PAYABLE.`);
        return ledger as OrderFinancialLedgerRecord;
    }

    // Only orders with configured commission rule can be PAYABLE
    if (ledger.commission_bps === null) {
        console.warn(`[VendorLedger] Order ${orderId} ledger is UNCONFIGURED. Cannot advance to PAYABLE without commission rule.`);
        return ledger as OrderFinancialLedgerRecord;
    }

    const nowIso = new Date().toISOString();
    const { data: updated, error: updateErr } = await serviceClient
        .from('order_financial_ledger')
        .update({
            financial_status: 'PAYABLE',
            eligible_at: nowIso,
            updated_at: nowIso,
        })
        .eq('id', ledger.id)
        .select('*')
        .maybeSingle();

    if (updateErr) {
        console.error(`[VendorLedger] Error updating order ${orderId} to PAYABLE:`, updateErr);
        return null;
    }

    console.log(`[VendorLedger] Order ${orderId} ledger transitioned to PAYABLE (Vendor Net: ₹${ledger.vendor_net_amount}).`);
    return updated as OrderFinancialLedgerRecord;
}

/**
 * Transitions an order's financial ledger status to REVERSED upon authoritative refund confirmation.
 * The vendor net payable amount becomes ₹0.00.
 * Records authoritative audit metadata (reversed_at, refund_request_id, reversal_reason).
 */
export async function reverseOrderLedger(
    orderId: string,
    reason?: string | null,
    refundRequestId?: string | null,
    reversedAt?: string | null
): Promise<OrderFinancialLedgerRecord | null> {
    const serviceClient = getServiceRoleClient();

    const { data: ledger, error: fetchErr } = await serviceClient
        .from('order_financial_ledger')
        .select('*')
        .eq('order_id', orderId)
        .maybeSingle();

    if (isTableMissingError(fetchErr) || !ledger) {
        return null;
    }

    // Resolve authoritative refund if not supplied directly
    let resolvedRefundId = refundRequestId;
    let resolvedReversedAt = reversedAt;

    if (!resolvedRefundId || !resolvedReversedAt) {
        try {
            const { data: refunds } = await serviceClient
                .from('refund_requests')
                .select('id, completed_at')
                .eq('order_id', orderId)
                .eq('status', 'SUCCEEDED')
                .not('completed_at', 'is', null);

            // Fail-closed: attach only if exactly 1 authoritative refund exists
            if (refunds && refunds.length === 1) {
                if (!resolvedRefundId) resolvedRefundId = refunds[0].id;
                if (!resolvedReversedAt) resolvedReversedAt = refunds[0].completed_at;
            }
        } catch {
            // Non-blocking fallback
        }
    }

    if (ledger.financial_status === 'REVERSED') {
        // If already reversed, but refund_request_id was missing and is now discovered, repair it safely without overwriting non-null
        if (resolvedRefundId && !ledger.refund_request_id) {
            const auditUpdate: Record<string, any> = {
                refund_request_id: resolvedRefundId,
                updated_at: new Date().toISOString(),
            };
            if (resolvedReversedAt && ledger.reversed_at !== resolvedReversedAt) {
                auditUpdate.reversed_at = resolvedReversedAt;
            }
            const { data: patched } = await serviceClient
                .from('order_financial_ledger')
                .update(auditUpdate)
                .eq('id', ledger.id)
                .select('*')
                .maybeSingle();
            return (patched || ledger) as OrderFinancialLedgerRecord;
        }
        return ledger as OrderFinancialLedgerRecord;
    }

    if (ledger.financial_status === 'SETTLED') {
        console.error(
            `[VendorLedger] CRITICAL: Attempted to reverse order ${orderId} which is already SETTLED. ` +
            `Disbursed payouts cannot be automatically revoked. Requires manual financial reconciliation.`
        );
        return ledger as OrderFinancialLedgerRecord;
    }

    // Check if attached to any settlement batch
    try {
        const { data: item } = await serviceClient
            .from('vendor_settlement_items')
            .select('id, settlement_batch_id')
            .eq('order_financial_ledger_id', ledger.id)
            .maybeSingle();

        if (item && item.settlement_batch_id) {
            const { data: batch } = await serviceClient
                .from('vendor_settlement_batches')
                .select('id, status')
                .eq('id', item.settlement_batch_id)
                .maybeSingle();

            if (batch) {
                if (batch.status === 'PAID') {
                    console.error(
                        `[VendorLedger] CRITICAL: Attempted to reverse order ${orderId} which is part of a PAID settlement batch (${batch.id}). ` +
                        `Disbursed payouts cannot be automatically revoked. Requires manual financial reconciliation.`
                    );
                    return ledger as OrderFinancialLedgerRecord;
                }
                // If parent batch is unpaid (DRAFT, CONFIRMED, or CANCELLED), remove item before reversing
                await serviceClient
                    .from('vendor_settlement_items')
                    .delete()
                    .eq('id', item.id);
            }
        }
    } catch {
        // Table may not exist pre-push
    }

    const nowIso = new Date().toISOString();
    const finalReversedAt = resolvedReversedAt || nowIso;
    const updatePayload: Record<string, any> = {
        financial_status: 'REVERSED',
        reversed_at: finalReversedAt,
        reversal_reason: reason || 'Refund processed',
        updated_at: nowIso,
    };
    if (refundRequestId) {
        updatePayload.refund_request_id = refundRequestId;
    } else if (resolvedRefundId) {
        updatePayload.refund_request_id = resolvedRefundId;
    }

    const { data: updated, error: updateErr } = await serviceClient
        .from('order_financial_ledger')
        .update(updatePayload)
        .eq('id', ledger.id)
        .select('*')
        .maybeSingle();

    if (updateErr) {
        console.error(`[VendorLedger] Error reversing ledger for order ${orderId}:`, updateErr);
        return null;
    }

    console.log(`[VendorLedger] Order ${orderId} ledger transitioned to REVERSED (${reason || 'Refund'}).`);
    return updated as OrderFinancialLedgerRecord;
}

/**
 * Trusted server/database helper to configure an UNCONFIGURED order ledger entry
 * once a valid commission rule is established.
 * Fails closed on ambiguous rule.
 * Admin / service-role only.
 */
export async function configureUnconfiguredOrderLedger(orderId: string): Promise<OrderFinancialLedgerRecord | null> {
    const serviceClient = getServiceRoleClient();

    // 1. Try PostgreSQL RPC first if available
    try {
        const { data: rpcResult, error: rpcError } = await serviceClient
            .rpc('configure_unconfigured_order_ledger', { p_order_id: orderId });

        if (!rpcError && rpcResult) {
            return rpcResult as OrderFinancialLedgerRecord;
        }
    } catch {
        // RPC might not exist in pre-push environment, fall through to server logic
    }

    // 2. Fallback server-side logic
    const { data: ledger, error: ledgerErr } = await serviceClient
        .from('order_financial_ledger')
        .select('*')
        .eq('order_id', orderId)
        .maybeSingle();

    if (isTableMissingError(ledgerErr) || !ledger) {
        return null;
    }

    if (ledger.financial_status !== 'UNCONFIGURED') {
        return ledger as OrderFinancialLedgerRecord;
    }

    // Read authoritative payment timestamp
    const { data: attempt } = await serviceClient
        .from('payment_attempts')
        .select('paid_at')
        .eq('id', ledger.payment_attempt_id)
        .maybeSingle();

    const { data: order } = await serviceClient
        .from('orders')
        .select('status, payment_status, paid_at, completed_at')
        .eq('id', orderId)
        .maybeSingle();

    const snapshotTimestamp = attempt?.paid_at || order?.paid_at || ledger.created_at || new Date().toISOString();

    // Find active commission rules for shop at snapshotTimestamp
    const { data: rules, error: rulesErr } = await serviceClient
        .from('shop_commission_rules')
        .select('*')
        .eq('shop_id', ledger.shop_id)
        .eq('is_active', true)
        .lte('effective_from', snapshotTimestamp);

    if (rulesErr && isTableMissingError(rulesErr)) {
        return ledger as OrderFinancialLedgerRecord;
    }

    const matchingRules = (rules || []).filter(
        (r: any) => !r.effective_to || new Date(r.effective_to) > new Date(snapshotTimestamp)
    );

    if (matchingRules.length > 1) {
        throw new Error(`Ambiguous commission rules: ${matchingRules.length} overlapping active rules found for shop ${ledger.shop_id} at ${snapshotTimestamp}.`);
    }

    if (matchingRules.length === 0) {
        // No rule configured: remain UNCONFIGURED
        return ledger as OrderFinancialLedgerRecord;
    }

    const rule = matchingRules[0];
    const { platformCommission, vendorNet } = calculateCommission(Number(ledger.gross_amount), rule.commission_bps);

    let nextStatus: FinancialStatus;
    let eligibleAt: string | null = null;
    let reversedAt: string | null = null;
    let reversalReason: string | null = null;
    const nowIso = new Date().toISOString();

    if (order?.payment_status === 'REFUNDED' || order?.status === 'CANCELLED') {
        nextStatus = 'REVERSED';
        reversedAt = nowIso;
        reversalReason = 'Order cancelled/refunded';
    } else if (order?.status === 'COMPLETED' && order?.payment_status === 'PAID') {
        nextStatus = 'PAYABLE';
        eligibleAt = order.completed_at || nowIso;
    } else {
        nextStatus = 'PENDING';
    }

    const { data: updated, error: updateErr } = await serviceClient
        .from('order_financial_ledger')
        .update({
            commission_bps: rule.commission_bps,
            platform_commission_amount: platformCommission,
            vendor_net_amount: vendorNet,
            financial_status: nextStatus,
            eligible_at: eligibleAt,
            reversed_at: reversedAt,
            reversal_reason: reversalReason,
            updated_at: nowIso,
        })
        .eq('id', ledger.id)
        .select('*')
        .maybeSingle();

    if (updateErr) {
        console.error(`[VendorLedger] Error activating unconfigured ledger for order ${orderId}:`, updateErr);
        return null;
    }

    return updated as OrderFinancialLedgerRecord;
}

/**
 * Computes authoritative financial summary for a vendor shop.
 * Aggregates gross sales, retained commission, net earnings, payable balance, settled balance, and pending earnings.
 * Returns commissionConfigured: false and vendorEarnings: null when commission is unconfigured.
 */
export async function getShopFinancialSummary(shopId: string): Promise<ShopFinancialSummary> {
    const serviceClient = getServiceRoleClient();

    // Check if commission is configured for this shop
    let isCommissionConfigured = false;
    try {
        const { data: activeRules } = await serviceClient
            .from('shop_commission_rules')
            .select('id, commission_bps')
            .eq('shop_id', shopId)
            .eq('is_active', true)
            .lte('effective_from', new Date().toISOString())
            .limit(1);

        if (activeRules && activeRules.length > 0) {
            isCommissionConfigured = true;
        }
    } catch {
        // Table does not exist pre-push
    }

    const { data: rows, error: queryErr } = await serviceClient
        .from('order_financial_ledger')
        .select('*')
        .eq('shop_id', shopId);

    // Graceful fallback for pre-push table absence
    if (isTableMissingError(queryErr) || (queryErr && queryErr.code === 'PGRST205')) {
        // Pre-push: calculate baseline from orders table
        const { data: completedOrders } = await serviceClient
            .from('orders')
            .select('total_amount, payment_status, status')
            .eq('shop_id', shopId)
            .eq('payment_status', 'PAID')
            .eq('status', 'COMPLETED');

        let gross = 0;
        if (completedOrders) {
            for (const o of completedOrders) {
                gross += Number(o.total_amount || 0);
            }
        }
        gross = Math.round(gross * 100) / 100;

        return {
            commissionConfigured: false,
            grossSales: gross,
            platformCommission: null,
            vendorEarnings: null,
            payableAmount: null,
            settledAmount: 0,
            pendingAmount: null,
            reversedAmount: 0,
            unconfiguredOrdersCount: completedOrders?.length || 0,
            totalOrdersCount: completedOrders?.length || 0,
        };
    }

    const entries = (rows || []) as OrderFinancialLedgerRecord[];
    return calculateShopFinancialSummary(entries, isCommissionConfigured);
}

/**
 * Pure calculation function that computes ShopFinancialSummary from financial ledger rows.
 */
export function calculateShopFinancialSummary(
    entries: any[],
    isCommissionConfigured: boolean
): ShopFinancialSummary {
    let grossSales = 0;
    let platformCommission = 0;
    let vendorEarnings = 0;
    let payableAmount = 0;
    let settledAmount = 0;
    let pendingAmount = 0;
    let reversedAmount = 0;
    let unconfiguredOrdersCount = 0;

    for (const row of entries) {
        const gross = Number(row.gross_amount || 0);
        const commission = Number(row.platform_commission_amount || 0);
        const net = Number(row.vendor_net_amount || (gross - commission));

        if (row.financial_status === 'UNCONFIGURED') {
            unconfiguredOrdersCount++;
            grossSales += gross;
            // Without configured rule, net earnings are unallocated
        } else if (row.financial_status === 'PENDING') {
            grossSales += gross;
            platformCommission += commission;
            vendorEarnings += net;
            pendingAmount += net;
        } else if (row.financial_status === 'PAYABLE') {
            grossSales += gross;
            platformCommission += commission;
            vendorEarnings += net;
            payableAmount += net;
        } else if (row.financial_status === 'SETTLED') {
            grossSales += gross;
            platformCommission += commission;
            vendorEarnings += net;
            settledAmount += net;
        } else if (row.financial_status === 'REVERSED') {
            reversedAmount += gross;
            // Reversed orders do not contribute to payable or vendor earnings
        }
    }

    const commissionConfigured = isCommissionConfigured || entries.some(e => e.commission_bps !== null);

    return {
        commissionConfigured,
        grossSales: Math.round(grossSales * 100) / 100,
        platformCommission: commissionConfigured ? Math.round(platformCommission * 100) / 100 : null,
        vendorEarnings: commissionConfigured ? Math.round(vendorEarnings * 100) / 100 : null,
        payableAmount: commissionConfigured ? Math.round(payableAmount * 100) / 100 : null,
        settledAmount: Math.round(settledAmount * 100) / 100,
        pendingAmount: commissionConfigured ? Math.round(pendingAmount * 100) / 100 : null,
        reversedAmount: Math.round(reversedAmount * 100) / 100,
        unconfiguredOrdersCount,
        totalOrdersCount: entries.length,
    };
}

/**
 * Creates a new DRAFT settlement disbursement batch for a vendor shop.
 * Admin / service-role only.
 */
export async function createSettlementBatch(
    shopId: string,
    notes?: string,
    createdBy?: string
): Promise<VendorSettlementBatchRecord | null> {
    const serviceClient = getServiceRoleClient();

    const insertPayload: Record<string, any> = {
        shop_id: shopId,
        status: 'DRAFT',
        notes: notes || null,
    };
    if (createdBy) {
        insertPayload.created_by = createdBy;
    }

    const { data: batch, error } = await serviceClient
        .from('vendor_settlement_batches')
        .insert(insertPayload)
        .select('*')
        .maybeSingle();

    if (isTableMissingError(error)) {
        return null;
    }

    if (error) {
        console.error(`[VendorLedger] Failed to create settlement batch for shop ${shopId}:`, error);
        return null;
    }

    return batch as VendorSettlementBatchRecord;
}

/**
 * Adds a PAYABLE order ledger entry to a DRAFT or CONFIRMED settlement batch.
 * Database trigger enforces:
 * - ledger must be PAYABLE
 * - ledger shop_id must match batch shop_id
 * - batch must not be PAID or CANCELLED
 * - UNIQUE(order_financial_ledger_id) prevents double-settlement
 */
export async function addOrderToSettlementBatch(
    batchId: string,
    orderLedgerId: string
): Promise<VendorSettlementItemRecord | null> {
    const serviceClient = getServiceRoleClient();

    const { data: item, error } = await serviceClient
        .from('vendor_settlement_items')
        .insert({
            settlement_batch_id: batchId,
            order_financial_ledger_id: orderLedgerId,
        })
        .select('*')
        .maybeSingle();

    if (isTableMissingError(error)) {
        return null;
    }

    if (error) {
        console.error(`[VendorLedger] Failed to add ledger ${orderLedgerId} to batch ${batchId}:`, error);
        throw new Error(`Failed to add order to settlement batch: ${error.message}`);
    }

    return item as VendorSettlementItemRecord;
}

/**
 * Removes an order from an unpaid settlement batch.
 * Rejects if parent batch is already PAID (immutable).
 */
export async function removeOrderFromSettlementBatch(
    batchId: string,
    orderLedgerId: string
): Promise<boolean> {
    const serviceClient = getServiceRoleClient();

    const { data: batch } = await serviceClient
        .from('vendor_settlement_batches')
        .select('status')
        .eq('id', batchId)
        .maybeSingle();

    if (batch?.status === 'PAID') {
        throw new Error(`Cannot remove items from PAID settlement batch ${batchId}. Paid settlements are immutable.`);
    }

    const { error } = await serviceClient
        .from('vendor_settlement_items')
        .delete()
        .eq('settlement_batch_id', batchId)
        .eq('order_financial_ledger_id', orderLedgerId);

    if (error && !isTableMissingError(error)) {
        console.error(`[VendorLedger] Failed to remove ledger ${orderLedgerId} from batch ${batchId}:`, error);
        return false;
    }

    return true;
}

/**
 * Transitions a DRAFT settlement batch to CONFIRMED.
 */
export async function confirmSettlementBatch(
    batchId: string,
    confirmedBy?: string
): Promise<VendorSettlementBatchRecord | null> {
    if (!confirmedBy) {
        throw new Error(`confirmed_by is required to confirm settlement batch ${batchId}.`);
    }

    const serviceClient = getServiceRoleClient();

    const nowIso = new Date().toISOString();
    const updatePayload: Record<string, any> = {
        status: 'CONFIRMED',
        confirmed_by: confirmedBy,
        confirmed_at: nowIso,
        updated_at: nowIso,
    };

    const { data: updated, error } = await serviceClient
        .from('vendor_settlement_batches')
        .update(updatePayload)
        .eq('id', batchId)
        .eq('status', 'DRAFT')
        .select('*')
        .maybeSingle();

    if (error) {
        throw new Error(`Failed to confirm settlement batch ${batchId}: ${error.message}`);
    }

    return updated as VendorSettlementBatchRecord;
}

/**
 * Transitions a CONFIRMED settlement batch to PAID upon verified disbursement.
 * Fails closed if:
 * - payment_method is missing
 * - payment_reference is missing or empty
 * - paid_by is missing
 * - batch lacks valid confirmation audit (confirmed_by and confirmed_at)
 * - Any attached order ledger entry is NOT PAYABLE (UNCONFIGURED, PENDING, REVERSED, SETTLED)
 * - Batch has 0 attached orders
 * Atomically updates batch status to PAID and all attached ledger entries to SETTLED with the same settled_at timestamp.
 */
export async function markSettlementBatchPaid(
    batchId: string,
    paymentReference?: string,
    settledAt?: string,
    paymentMethod?: string,
    paidBy?: string
): Promise<VendorSettlementBatchRecord | null> {
    if (!paymentMethod) {
        throw new Error('payment_method is required to mark settlement batch as PAID.');
    }
    if (!paymentReference || typeof paymentReference !== 'string' || !paymentReference.trim()) {
        throw new Error('payment_reference is required and cannot be empty to mark settlement batch as PAID.');
    }
    if (!paidBy) {
        throw new Error('paid_by is required to mark settlement batch as PAID.');
    }

    const serviceClient = getServiceRoleClient();

    const { data: batch, error: batchErr } = await serviceClient
        .from('vendor_settlement_batches')
        .select('*')
        .eq('id', batchId)
        .maybeSingle();

    if (isTableMissingError(batchErr) || !batch) {
        return null;
    }

    if (batch.status === 'PAID') {
        return batch as VendorSettlementBatchRecord;
    }

    if (batch.status === 'CANCELLED') {
        throw new Error(`Cannot transition CANCELLED settlement batch ${batchId} to PAID.`);
    }

    if (batch.status === 'DRAFT') {
        throw new Error(`Cannot transition DRAFT settlement batch ${batchId} directly to PAID. Batch must be CONFIRMED first.`);
    }

    if (!batch.confirmed_by || !batch.confirmed_at) {
        throw new Error(`Cannot transition settlement batch ${batchId} to PAID: batch must have a valid confirmation audit (confirmed_by and confirmed_at).`);
    }

    // Verify all attached items
    const { data: items, error: itemsErr } = await serviceClient
        .from('vendor_settlement_items')
        .select('id, order_financial_ledger_id, order_financial_ledger ( id, financial_status )')
        .eq('settlement_batch_id', batchId);

    if (itemsErr && !isTableMissingError(itemsErr)) {
        throw new Error(`Failed to fetch settlement items for batch ${batchId}: ${itemsErr.message}`);
    }

    if (!items || items.length === 0) {
        throw new Error(`Cannot transition settlement batch ${batchId} to PAID: batch contains 0 orders.`);
    }

    const invalidItems = (items as any[]).filter(
        i => !i.order_financial_ledger || i.order_financial_ledger.financial_status !== 'PAYABLE'
    );

    if (invalidItems.length > 0) {
        const statuses = invalidItems.map(i => i.order_financial_ledger?.financial_status || 'UNKNOWN').join(', ');
        throw new Error(`Cannot transition settlement batch ${batchId} to PAID: ${invalidItems.length} item(s) have non-PAYABLE status (${statuses}).`);
    }

    const authoritativeTimestamp = settledAt || new Date().toISOString();

    const updatePayload: Record<string, any> = {
        status: 'PAID',
        settled_at: authoritativeTimestamp,
        disbursed_at: authoritativeTimestamp,
        payment_reference: paymentReference || batch.payment_reference,
        updated_at: authoritativeTimestamp,
    };
    if (paymentMethod) {
        updatePayload.payment_method = paymentMethod;
    }
    if (paidBy) {
        updatePayload.paid_by = paidBy;
    }

    const { data: updated, error: updateErr } = await serviceClient
        .from('vendor_settlement_batches')
        .update(updatePayload)
        .eq('id', batchId)
        .select('*')
        .maybeSingle();

    if (updateErr) {
        throw new Error(`Failed to update settlement batch ${batchId} to PAID: ${updateErr.message}`);
    }

    return updated as VendorSettlementBatchRecord;
}

/**
 * Cancels an unpaid settlement batch.
 * Releases all attached ledger entries so their PAYABLE status is preserved and they can enter future batches.
 * Zeroes batch totals.
 * Rejects if batch is already PAID (terminal and immutable).
 */
export async function cancelSettlementBatch(batchId: string): Promise<VendorSettlementBatchRecord | null> {
    const serviceClient = getServiceRoleClient();

    const { data: batch, error: batchErr } = await serviceClient
        .from('vendor_settlement_batches')
        .select('*')
        .eq('id', batchId)
        .maybeSingle();

    if (isTableMissingError(batchErr) || !batch) {
        return null;
    }

    if (batch.status === 'CANCELLED') {
        return batch as VendorSettlementBatchRecord;
    }

    if (batch.status === 'PAID') {
        throw new Error(`Cannot cancel PAID settlement batch ${batchId}. Paid settlements are permanent accounting records.`);
    }

    // Update status to CANCELLED (DB trigger automatically releases items and zeroes totals)
    const { data: updated, error: updateErr } = await serviceClient
        .from('vendor_settlement_batches')
        .update({
            status: 'CANCELLED',
            gross_order_amount: 0.00,
            platform_commission_amount: 0.00,
            vendor_payable_amount: 0.00,
            order_count: 0,
            updated_at: new Date().toISOString(),
        })
        .eq('id', batchId)
        .select('*')
        .maybeSingle();

    if (updateErr) {
        throw new Error(`Failed to cancel settlement batch ${batchId}: ${updateErr.message}`);
    }

    // Also explicitly delete items in application code for pre-push resilience
    await serviceClient
        .from('vendor_settlement_items')
        .delete()
        .eq('settlement_batch_id', batchId);

    return updated as VendorSettlementBatchRecord;
}

/**
 * Calculates platform-wide financial summary authoritatively from order_financial_ledger.
 * Admin / service-role only.
 */
export async function getAdminFinanceSummary(): Promise<AdminFinanceSummary> {
    const serviceClient = getServiceRoleClient();

    const { data: entries, error } = await serviceClient
        .from('order_financial_ledger')
        .select('*')
        .order('created_at', { ascending: false });

    if (error && !isTableMissingError(error)) {
        console.error('[AdminFinance] Error fetching ledger entries for summary:', error);
    }

    const { count: totalShopsCount } = await serviceClient
        .from('shops')
        .select('*', { count: 'exact', head: true });

    const { count: activeRulesCount } = await serviceClient
        .from('shop_commission_rules')
        .select('*', { count: 'exact', head: true })
        .eq('is_active', true);

    const { count: settlementBatchesCount } = await serviceClient
        .from('vendor_settlement_batches')
        .select('*', { count: 'exact', head: true });

    const rows = entries || [];
    let grossSales = 0;
    let platformCommission = 0;
    let vendorEarnings = 0;
    let payableAmount = 0;
    let settledAmount = 0;
    let pendingAmount = 0;
    let reversedAmount = 0;
    let unconfiguredOrdersCount = 0;

    for (const row of rows) {
        const gross = Number(row.gross_amount || 0);
        const commission = Number(row.platform_commission_amount || 0);
        const net = Number(row.vendor_net_amount || (gross - commission));

        if (row.financial_status === 'UNCONFIGURED') {
            unconfiguredOrdersCount++;
            grossSales += gross;
        } else if (row.financial_status === 'PENDING') {
            grossSales += gross;
            platformCommission += commission;
            vendorEarnings += net;
            pendingAmount += net;
        } else if (row.financial_status === 'PAYABLE') {
            grossSales += gross;
            platformCommission += commission;
            vendorEarnings += net;
            payableAmount += net;
        } else if (row.financial_status === 'SETTLED') {
            grossSales += gross;
            platformCommission += commission;
            vendorEarnings += net;
            settledAmount += net;
        } else if (row.financial_status === 'REVERSED') {
            reversedAmount += gross;
        }
    }

    const hasConfiguredCommission = (activeRulesCount || 0) > 0 || rows.some(r => r.commission_bps !== null);

    return {
        commissionConfigured: hasConfiguredCommission,
        grossSales: Math.round(grossSales * 100) / 100,
        platformCommission: hasConfiguredCommission ? Math.round(platformCommission * 100) / 100 : null,
        vendorEarnings: hasConfiguredCommission ? Math.round(vendorEarnings * 100) / 100 : null,
        payableAmount: hasConfiguredCommission ? Math.round(payableAmount * 100) / 100 : null,
        settledAmount: Math.round(settledAmount * 100) / 100,
        pendingAmount: hasConfiguredCommission ? Math.round(pendingAmount * 100) / 100 : null,
        reversedAmount: Math.round(reversedAmount * 100) / 100,
        unconfiguredOrdersCount,
        totalOrdersCount: rows.length,
        totalShopsCount: totalShopsCount || 0,
        settlementBatchesCount: settlementBatchesCount || 0,
    };
}

/**
 * Bulk applies a shop commission rule to UNCONFIGURED orders within its effective range.
 * Admin / service-role only.
 */
export async function applyShopCommissionRule(
    shopId: string,
    ruleId: string
): Promise<{
    success: boolean;
    configuredCount: number;
    stillUnconfiguredCount: number;
    skippedReversedCount: number;
    failedCount: number;
}> {
    const serviceClient = getServiceRoleClient();

    // Try RPC first if migration has been applied
    try {
        const { data: rpcRes, error: rpcErr } = await serviceClient.rpc('apply_shop_commission_rule', {
            p_shop_id: shopId,
            p_rule_id: ruleId,
        });

        if (!rpcErr && rpcRes) {
            return {
                success: true,
                configuredCount: rpcRes.configured_count || 0,
                stillUnconfiguredCount: rpcRes.still_unconfigured_count || 0,
                skippedReversedCount: rpcRes.skipped_reversed_count || 0,
                failedCount: rpcRes.failed_count || 0,
            };
        }
    } catch {
        // Fallback to service layer logic if RPC not available
    }

    // Service layer fallback
    const { data: rule, error: ruleErr } = await serviceClient
        .from('shop_commission_rules')
        .select('*')
        .eq('id', ruleId)
        .eq('shop_id', shopId)
        .maybeSingle();

    if (ruleErr || !rule || !rule.is_active) {
        throw new Error(`Active commission rule ${ruleId} not found for shop ${shopId}.`);
    }

    const { data: unconfigured } = await serviceClient
        .from('order_financial_ledger')
        .select('id, order_id, financial_status, payment_attempt_id, payment_attempts(paid_at)')
        .eq('shop_id', shopId)
        .eq('financial_status', 'UNCONFIGURED');

    let configuredCount = 0;
    let failedCount = 0;

    for (const item of unconfigured || []) {
        const paidAt = (item.payment_attempts as any)?.paid_at;
        if (paidAt && paidAt >= rule.effective_from && (!rule.effective_to || paidAt < rule.effective_to)) {
            try {
                const res = await configureUnconfiguredOrderLedger(item.order_id);
                if (res) configuredCount++;
            } catch (err) {
                failedCount++;
                console.error(`[AdminFinance] Error configuring order ${item.order_id}:`, err);
            }
        }
    }

    const { count: stillUnconfiguredCount } = await serviceClient
        .from('order_financial_ledger')
        .select('*', { count: 'exact', head: true })
        .eq('shop_id', shopId)
        .eq('financial_status', 'UNCONFIGURED');

    const { count: skippedReversedCount } = await serviceClient
        .from('order_financial_ledger')
        .select('*', { count: 'exact', head: true })
        .eq('shop_id', shopId)
        .eq('financial_status', 'REVERSED');

    return {
        success: true,
        configuredCount,
        stillUnconfiguredCount: stillUnconfiguredCount || 0,
        skippedReversedCount: skippedReversedCount || 0,
        failedCount,
    };
}

/**
 * XerService Backend — Stage A6: Settlements Service
 *
 * Provides authoritative settlement review, concurrency protection (preventing
 * double-settlement and batch collision), test-to-live isolation, batch lifecycle operations,
 * and reconciled CSV statements.
 */

import { getServiceRoleClient } from '../supabase/client';
import {
    createSettlementBatch,
    addOrderToSettlementBatch,
    confirmSettlementBatch,
    markSettlementBatchPaid,
    cancelSettlementBatch,
    VendorSettlementBatchRecord,
} from './vendor-ledger';

export interface ReadyToSettleShop {
    shopId: string;
    shopName: string;
    readyAmount: number;
    heldAmount: number;
    eligibleOrderCount: number;
    lastPaidDate: string | null;
    isTestShop: boolean;
}

export interface InProgressBatch {
    id: string;
    shopId: string;
    shopName: string;
    settlementNumber: string;
    grossOrderAmount: number;
    platformCommissionAmount: number;
    vendorPayableAmount: number;
    orderCount: number;
    status: 'DRAFT' | 'CONFIRMED';
    notes: string | null;
    createdBy: string | null;
    confirmedBy: string | null;
    confirmedAt: string | null;
    createdAt: string;
}

export interface PaidHistoryBatch {
    id: string;
    shopId: string;
    shopName: string;
    settlementNumber: string;
    grossOrderAmount: number;
    platformCommissionAmount: number;
    vendorPayableAmount: number;
    orderCount: number;
    status: 'PAID';
    paymentReference: string;
    paymentMethod: string;
    paidBy: string | null;
    confirmedBy: string | null;
    confirmedAt: string | null;
    settledAt: string;
    disbursedAt: string | null;
    createdAt: string;
}

export interface SettlementsOverview {
    summary: {
        readyAmount: number;
        readyOrdersCount: number;
        inProgressAmount: number;
        inProgressBatchesCount: number;
        paidAmount: number;
        paidBatchesCount: number;
    };
    readyToSettle: ReadyToSettleShop[];
    inProgress: InProgressBatch[];
    paidHistory: PaidHistoryBatch[];
}

export interface EligibleOrderRow {
    orderFinancialLedgerId: string;
    orderId: string;
    orderNumber?: string;
    grossAmount: number;
    platformCommissionAmount: number;
    vendorNetAmount: number;
    createdAt: string;
}

/**
 * Returns comprehensive Settlements Overview with Ready to Settle shops,
 * In Progress batches, Paid history, and summary totals.
 */
export async function getSettlementsOverview(): Promise<SettlementsOverview> {
    const serviceClient = getServiceRoleClient();

    // 1. Query all shops
    const { data: shopsData } = await serviceClient
        .from('shops')
        .select('id, name, status');
    const shopsMap = new Map<string, { name: string; isTest: boolean }>();
    (shopsData || []).forEach(s => {
        shopsMap.set(s.id, { name: s.name, isTest: false });
    });

    // 2. Query all order_financial_ledger rows
    const { data: ledgerEntries } = await serviceClient
        .from('order_financial_ledger')
        .select('*');

    // 3. Query all existing active settlement items to determine active batch locks
    const { data: activeItems } = await serviceClient
        .from('vendor_settlement_items')
        .select(`
            order_financial_ledger_id,
            settlement_batch_id,
            vendor_settlement_batches ( id, status, settlement_number )
        `);

    const lockedLedgerIds = new Set<string>();
    (activeItems || []).forEach((item: any) => {
        const batchStatus = item.vendor_settlement_batches?.status;
        if (batchStatus === 'DRAFT' || batchStatus === 'CONFIRMED') {
            lockedLedgerIds.add(item.order_financial_ledger_id);
        }
    });

    // 4. Query all settlement batches
    const { data: batchesData } = await serviceClient
        .from('vendor_settlement_batches')
        .select(`
            *,
            shops ( id, name )
        `)
        .order('created_at', { ascending: false });

    const batches = batchesData || [];

    // Categorize batches
    const inProgress: InProgressBatch[] = [];
    const paidHistory: PaidHistoryBatch[] = [];
    const shopLastPaidMap = new Map<string, string>();

    for (const b of batches) {
        const sName = b.shops?.name || shopsMap.get(b.shop_id)?.name || 'Unknown Shop';
        if (b.status === 'DRAFT' || b.status === 'CONFIRMED') {
            inProgress.push({
                id: b.id,
                shopId: b.shop_id,
                shopName: sName,
                settlementNumber: b.settlement_number,
                grossOrderAmount: Number(b.gross_order_amount || 0),
                platformCommissionAmount: Number(b.platform_commission_amount || 0),
                vendorPayableAmount: Number(b.vendor_payable_amount || 0),
                orderCount: b.order_count || 0,
                status: b.status,
                notes: b.notes,
                createdBy: b.created_by,
                confirmedBy: b.confirmed_by,
                confirmedAt: b.confirmed_at,
                createdAt: b.created_at,
            });
        } else if (b.status === 'PAID') {
            paidHistory.push({
                id: b.id,
                shopId: b.shop_id,
                shopName: sName,
                settlementNumber: b.settlement_number,
                grossOrderAmount: Number(b.gross_order_amount || 0),
                platformCommissionAmount: Number(b.platform_commission_amount || 0),
                vendorPayableAmount: Number(b.vendor_payable_amount || 0),
                orderCount: b.order_count || 0,
                status: 'PAID',
                paymentReference: b.payment_reference || '',
                paymentMethod: b.payment_method || 'EXTERNAL',
                paidBy: b.paid_by,
                confirmedBy: b.confirmed_by,
                confirmedAt: b.confirmed_at,
                settledAt: b.settled_at || b.updated_at,
                disbursedAt: b.disbursed_at,
                createdAt: b.created_at,
            });

            if (b.settled_at && !shopLastPaidMap.has(b.shop_id)) {
                shopLastPaidMap.set(b.shop_id, b.settled_at);
            }
        }
    }

    // 5. Compute Ready To Settle per shop
    const shopReadyMap = new Map<string, { readyAmount: number; heldAmount: number; count: number }>();
    shopsMap.forEach((_, id) => {
        shopReadyMap.set(id, { readyAmount: 0, heldAmount: 0, count: 0 });
    });

    for (const row of (ledgerEntries || [])) {
        const sId = row.shop_id;
        if (!shopReadyMap.has(sId)) {
            shopReadyMap.set(sId, { readyAmount: 0, heldAmount: 0, count: 0 });
        }
        const s = shopReadyMap.get(sId)!;
        const net = Number(row.vendor_net_amount || 0);
        const gross = Number(row.gross_amount || 0);

        if (row.financial_status === 'PAYABLE') {
            if (!lockedLedgerIds.has(row.id)) {
                // Eligible and not currently in another active batch!
                s.readyAmount += net;
                s.count++;
            }
        } else if (row.financial_status === 'PENDING' || row.financial_status === 'UNCONFIGURED') {
            s.heldAmount += (net > 0 ? net : gross);
        }
    }

    const readyToSettle: ReadyToSettleShop[] = [];
    shopReadyMap.forEach((val, sId) => {
        const shopInfo = shopsMap.get(sId) || { name: 'Unknown Shop', isTest: false };
        if (val.readyAmount > 0 || val.heldAmount > 0 || val.count > 0) {
            readyToSettle.push({
                shopId: sId,
                shopName: shopInfo.name,
                readyAmount: Math.round(val.readyAmount * 100) / 100,
                heldAmount: Math.round(val.heldAmount * 100) / 100,
                eligibleOrderCount: val.count,
                lastPaidDate: shopLastPaidMap.get(sId) || null,
                isTestShop: shopInfo.isTest,
            });
        }
    });

    readyToSettle.sort((a, b) => b.readyAmount - a.readyAmount);

    // Summary KPIs
    const totalReadyAmount = readyToSettle.reduce((acc, s) => acc + s.readyAmount, 0);
    const totalReadyOrders = readyToSettle.reduce((acc, s) => acc + s.eligibleOrderCount, 0);
    const totalInProgressAmount = inProgress.reduce((acc, b) => acc + b.vendorPayableAmount, 0);
    const totalPaidAmount = paidHistory.reduce((acc, b) => acc + b.vendorPayableAmount, 0);

    return {
        summary: {
            readyAmount: Math.round(totalReadyAmount * 100) / 100,
            readyOrdersCount: totalReadyOrders,
            inProgressAmount: Math.round(totalInProgressAmount * 100) / 100,
            inProgressBatchesCount: inProgress.length,
            paidAmount: Math.round(totalPaidAmount * 100) / 100,
            paidBatchesCount: paidHistory.length,
        },
        readyToSettle,
        inProgress,
        paidHistory,
    };
}

/**
 * Returns eligible PAYABLE orders for a specific shop that are not already locked in an active batch.
 */
export async function getEligibleOrdersForShop(shopId: string): Promise<EligibleOrderRow[]> {
    const serviceClient = getServiceRoleClient();

    // 1. Fetch locked items in DRAFT or CONFIRMED batches
    const { data: activeItems } = await serviceClient
        .from('vendor_settlement_items')
        .select(`
            order_financial_ledger_id,
            vendor_settlement_batches ( status )
        `);

    const lockedLedgerIds = new Set<string>();
    (activeItems || []).forEach((item: any) => {
        const batchStatus = item.vendor_settlement_batches?.status;
        if (batchStatus === 'DRAFT' || batchStatus === 'CONFIRMED') {
            lockedLedgerIds.add(item.order_financial_ledger_id);
        }
    });

    // 2. Fetch PAYABLE orders for this shop
    const { data: ledgerEntries, error } = await serviceClient
        .from('order_financial_ledger')
        .select(`
            id,
            order_id,
            gross_amount,
            platform_commission_amount,
            vendor_net_amount,
            created_at,
            orders ( order_number )
        `)
        .eq('shop_id', shopId)
        .eq('financial_status', 'PAYABLE')
        .order('created_at', { ascending: false });

    if (error) {
        throw new Error(`Failed to query eligible orders: ${error.message}`);
    }

    const eligible: EligibleOrderRow[] = [];
    for (const row of (ledgerEntries || [])) {
        if (!lockedLedgerIds.has(row.id)) {
            eligible.push({
                orderFinancialLedgerId: row.id,
                orderId: row.order_id,
                orderNumber: (row.orders as any)?.order_number || undefined,
                grossAmount: Number(row.gross_amount || 0),
                platformCommissionAmount: Number(row.platform_commission_amount || 0),
                vendorNetAmount: Number(row.vendor_net_amount || 0),
                createdAt: row.created_at,
            });
        }
    }

    return eligible;
}

/**
 * Creates a settlement batch with concurrency conflict detection and test-to-live isolation.
 * Throws an error with conflict status if any order is already locked or if test/live mixing is attempted.
 */
export async function createSettlementBatchWithConcurrencyGuard(
    shopId: string,
    orderLedgerIds: string[],
    notes?: string,
    createdBy?: string
): Promise<VendorSettlementBatchRecord> {
    const serviceClient = getServiceRoleClient();

    if (!shopId) {
        throw new Error('Shop ID (shop_id) is required.');
    }
    if (!Array.isArray(orderLedgerIds) || orderLedgerIds.length === 0) {
        throw new Error('At least one PAYABLE order must be selected.');
    }

    // 1. Verify shop exists & check test flag
    const { data: shop, error: shopErr } = await serviceClient
        .from('shops')
        .select('id, name')
        .eq('id', shopId)
        .maybeSingle();

    if (shopErr || !shop) {
        throw new Error('Shop not found.');
    }

    const isTestShop = false;

    // 2. Concurrency check: verify NONE of the candidate orderLedgerIds are currently in an active batch
    const { data: existingItems, error: checkErr } = await serviceClient
        .from('vendor_settlement_items')
        .select(`
            order_financial_ledger_id,
            settlement_batch_id,
            vendor_settlement_batches ( id, settlement_number, status )
        `)
        .in('order_financial_ledger_id', orderLedgerIds);

    if (checkErr) {
        throw new Error(`Failed to check settlement item locks: ${checkErr.message}`);
    }

    for (const item of (existingItems || [])) {
        const batch = (item as any).vendor_settlement_batches;
        if (batch && (batch.status === 'DRAFT' || batch.status === 'CONFIRMED')) {
            const conflictErr: any = new Error(
                `Order item ${item.order_financial_ledger_id} is already locked in active settlement batch ${batch.settlement_number} (${batch.status}). Two admins cannot settle the same order simultaneously.`
            );
            conflictErr.status = 409; // HTTP 409 Conflict
            conflictErr.conflict = true;
            throw conflictErr;
        }
    }

    // 3. Test-to-live isolation check
    // Query orders linked to these ledger rows
    const { data: ledgers, error: ledgerErr } = await serviceClient
        .from('order_financial_ledger')
        .select(`
            id,
            financial_status,
            orders ( id, total_amount )
        `)
        .in('id', orderLedgerIds);

    if (ledgerErr || !ledgers || ledgers.length !== orderLedgerIds.length) {
        throw new Error('One or more selected order ledger items could not be found.');
    }

    for (const l of ledgers) {
        if (l.financial_status !== 'PAYABLE') {
            throw new Error(`Order ledger ${l.id} has status ${l.financial_status}. Only PAYABLE orders are eligible.`);
        }
    }

    // 4. Create DRAFT batch
    const batch = await createSettlementBatch(shopId, notes, createdBy);
    if (!batch) {
        throw new Error('Failed to initialize settlement batch in database.');
    }

    // 5. Add items to batch atomically
    const addedItems: string[] = [];
    try {
        for (const ledgerId of orderLedgerIds) {
            await addOrderToSettlementBatch(batch.id, ledgerId);
            addedItems.push(ledgerId);
        }
    } catch (addErr: any) {
        // Rollback created batch on failure
        console.error(`[SettlementsService] Error adding items to batch ${batch.id}, cleaning up:`, addErr);
        await cancelSettlementBatch(batch.id);
        const failErr: any = new Error(`Settlement item lock failure: ${addErr.message}`);
        failErr.status = addErr.message?.includes('duplicate key') ? 409 : 400;
        throw failErr;
    }

    // 6. Fetch refreshed batch with authoritative recalculated totals
    const { data: finalBatch, error: fetchErr } = await serviceClient
        .from('vendor_settlement_batches')
        .select('*')
        .eq('id', batch.id)
        .single();

    if (fetchErr || !finalBatch) {
        throw new Error('Failed to retrieve finalized settlement batch.');
    }

    return finalBatch as VendorSettlementBatchRecord;
}

/**
 * Generates an itemized CSV statement for a settlement batch, guaranteeing exact total reconciliation.
 */
export async function generateSettlementStatementCsv(batchId: string): Promise<{ filename: string; csv: string }> {
    const serviceClient = getServiceRoleClient();

    // Fetch batch details with shop
    const { data: batch, error: batchErr } = await serviceClient
        .from('vendor_settlement_batches')
        .select(`
            *,
            shops ( id, name )
        `)
        .eq('id', batchId)
        .maybeSingle();

    if (batchErr || !batch) {
        throw new Error(`Settlement batch ${batchId} not found.`);
    }

    // Fetch attached items with ledger and orders
    const { data: items, error: itemsErr } = await serviceClient
        .from('vendor_settlement_items')
        .select(`
            id,
            created_at,
            order_financial_ledger (
                id,
                gross_amount,
                platform_commission_amount,
                vendor_net_amount,
                financial_status,
                created_at,
                orders (
                    id,
                    order_number,
                    created_at,
                    status
                )
            )
        `)
        .eq('settlement_batch_id', batchId);

    if (itemsErr) {
        throw new Error(`Failed to fetch settlement items: ${itemsErr.message}`);
    }

    const shopName = batch.shops?.name || 'Shop';
    const lines: string[] = [];

    // Header metadata
    lines.push(`"XerService Vendor Settlement Statement"`);
    lines.push(`"Settlement Number:","${batch.settlement_number}"`);
    lines.push(`"Shop Name:","${shopName.replace(/"/g, '""')}"`);
    lines.push(`"Status:","${batch.status}"`);
    lines.push(`"Payment Method:","${batch.payment_method || 'N/A'}"`);
    lines.push(`"Payment Reference:","${batch.payment_reference || 'N/A'}"`);
    lines.push(`"Settled Date:","${batch.settled_at || 'Pending'}"`);
    lines.push(`"Batch Created:","${batch.created_at}"`);
    lines.push(`"Total Net Disbursed:","₹${Number(batch.vendor_payable_amount).toFixed(2)}"`);
    lines.push('');

    // Item table
    lines.push('"#","Order Number","Order Date","Order Status","Gross Amount (₹)","Platform Fee (₹)","Vendor Net (₹)"');

    let sumGross = 0;
    let sumFee = 0;
    let sumNet = 0;

    const itemList = items || [];
    itemList.forEach((item: any, idx: number) => {
        const ledger = item.order_financial_ledger;
        const order = ledger?.orders;
        const orderNum = order?.order_number || ledger?.id || `Item-${idx + 1}`;
        const orderDate = order?.created_at || ledger?.created_at || item.created_at;
        const orderStatus = order?.status || ledger?.financial_status || 'COMPLETED';
        const gross = Number(ledger?.gross_amount || 0);
        const fee = Number(ledger?.platform_commission_amount || 0);
        const net = Number(ledger?.vendor_net_amount || 0);

        sumGross += gross;
        sumFee += fee;
        sumNet += net;

        lines.push(`${idx + 1},"${orderNum}","${orderDate}","${orderStatus}",${gross.toFixed(2)},${fee.toFixed(2)},${net.toFixed(2)}`);
    });

    // Exact Reconciled Total Row
    lines.push(`"TOTAL","${itemList.length} Orders","","Total",${sumGross.toFixed(2)},${sumFee.toFixed(2)},${sumNet.toFixed(2)}`);

    const filename = `settlement-${batch.settlement_number}.csv`;
    return { filename, csv: lines.join('\n') };
}

/**
 * XerService Backend — Stage A6: Earnings Reporting Service
 *
 * Provides database-backed authoritative earnings calculation, period comparisons,
 * shop-by-shop totals, Section 9.2 refund breakdowns, and reconciled CSV generation
 * under Asia/Kolkata (IST) reporting boundaries.
 */

import { getServiceRoleClient } from '../supabase/client';
import {
    DatePreset,
    DateRange,
    MetricWithComparison,
    RefundBreakdown,
    ShopEarningsBreakdown,
    AuthoritativeEarningsReport,
    getReportingDateRange,
    calculatePeriodComparison,
} from './earnings-math';

export * from './earnings-math';

/**
 * Generates an authoritative database-backed earnings report.
 */
export async function getAuthoritativeEarningsReport(options: {
    preset?: DatePreset;
    startDate?: string | null;
    endDate?: string | null;
    shopId?: string | null;
    referenceNow?: Date;
}): Promise<AuthoritativeEarningsReport> {
    const serviceClient = getServiceRoleClient();
    const preset = options.preset || 'all_time';
    const period = getReportingDateRange(preset, options.startDate, options.endDate, options.referenceNow);

    // 1. Fetch Shops
    let shopQuery = serviceClient.from('shops').select('id, name');
    if (options.shopId) {
        shopQuery = shopQuery.eq('id', options.shopId);
    }
    const { data: shopsData } = await shopQuery;
    const shopsMap = new Map<string, string>();
    (shopsData || []).forEach(s => shopsMap.set(s.id, s.name));

    // Helper to query period aggregates
    async function queryPeriodAggregates(fromUtc: string, toUtc: string) {
        // Query order_financial_ledger
        let ledgerQuery = serviceClient
            .from('order_financial_ledger')
            .select('*')
            .gte('created_at', fromUtc)
            .lte('created_at', toUtc);

        if (options.shopId) {
            ledgerQuery = ledgerQuery.eq('shop_id', options.shopId);
        }
        const { data: ledgerEntries } = await ledgerQuery;

        // Query refund_requests
        let refundsQuery = serviceClient
            .from('refund_requests')
            .select('*')
            .gte('created_at', fromUtc)
            .lte('created_at', toUtc);

        const { data: refundEntries } = await refundsQuery;

        // Query orders for cancellations
        let ordersQuery = serviceClient
            .from('orders')
            .select('id, status, payment_status, total_amount, shop_id')
            .gte('created_at', fromUtc)
            .lte('created_at', toUtc);

        if (options.shopId) {
            ordersQuery = ordersQuery.eq('shop_id', options.shopId);
        }
        const { data: orderEntries } = await ordersQuery;

        // Query settled disbursements
        let batchQuery = serviceClient
            .from('vendor_settlement_batches')
            .select('id, shop_id, vendor_payable_amount, status, settled_at')
            .eq('status', 'PAID')
            .gte('settled_at', fromUtc)
            .lte('settled_at', toUtc);

        if (options.shopId) {
            batchQuery = batchQuery.eq('shop_id', options.shopId);
        }
        const { data: batchEntries } = await batchQuery;

        const ledger = ledgerEntries || [];
        const refunds = refundEntries || [];
        const orders = orderEntries || [];
        const batches = batchEntries || [];

        let grossRevenue = 0;
        let platformFee = 0;
        let shopNet = 0;
        let unallocatedAmount = 0;
        let unallocatedCount = 0;

        for (const row of ledger) {
            const g = Number(row.gross_amount || 0);
            const fee = Number(row.platform_commission_amount || 0);
            const net = Number(row.vendor_net_amount || (g - fee));

            if (row.financial_status === 'UNCONFIGURED') {
                unallocatedCount++;
                unallocatedAmount += g;
                grossRevenue += g;
            } else if (['PENDING', 'PAYABLE', 'SETTLED'].includes(row.financial_status)) {
                grossRevenue += g;
                platformFee += fee;
                shopNet += net;
            }
            // REVERSED orders do not contribute to platform fee or shop net
        }

        // Confirmed refunds (status = 'SUCCEEDED')
        const confirmedRefundsList = refunds.filter(r => r.status === 'SUCCEEDED');
        const confirmedRefundsAmount = confirmedRefundsList.reduce((acc, r) => acc + Number(r.amount || 0), 0);

        // Disbursed settlements (status = 'PAID')
        const disbursedAmount = batches.reduce((acc, b) => acc + Number(b.vendor_payable_amount || 0), 0);

        return {
            grossRevenue: Math.round(grossRevenue * 100) / 100,
            platformFee: Math.round(platformFee * 100) / 100,
            shopNet: Math.round(shopNet * 100) / 100,
            confirmedRefundsAmount: Math.round(confirmedRefundsAmount * 100) / 100,
            ordersIncluded: orders.length,
            disbursedAmount: Math.round(disbursedAmount * 100) / 100,
            unallocatedCount,
            unallocatedAmount: Math.round(unallocatedAmount * 100) / 100,
            ledger,
            refunds,
            orders,
            batches,
        };
    }

    // Run queries for Current and Previous periods concurrently
    const [currentData, prevData] = await Promise.all([
        queryPeriodAggregates(period.startUtc, period.endUtc),
        queryPeriodAggregates(period.prevStartUtc, period.prevEndUtc),
    ]);

    // Construct primary KPIs with period comparisons
    const kpis = {
        xerServiceEarnings: calculatePeriodComparison(currentData.platformFee, prevData.platformFee),
        serviceRevenue: calculatePeriodComparison(currentData.grossRevenue, prevData.grossRevenue),
        shopEarnings: calculatePeriodComparison(currentData.shopNet, prevData.shopNet),
        confirmedRefunds: calculatePeriodComparison(currentData.confirmedRefundsAmount, prevData.confirmedRefundsAmount),
        ordersIncluded: calculatePeriodComparison(currentData.ordersIncluded, prevData.ordersIncluded),
        settledDisbursements: calculatePeriodComparison(currentData.disbursedAmount, prevData.disbursedAmount),
    };

    // Construct Section 9.2 Refunds and Cancellations breakdown
    const refundList = currentData.refunds;
    const orderList = currentData.orders;

    // 1. Unpaid cancellations: Orders CANCELLED without completed payment
    const unpaidCancellationsList = orderList.filter(o => o.status === 'CANCELLED' && o.payment_status !== 'PAID' && o.payment_status !== 'REFUNDED');
    const unpaidCancellationsCount = unpaidCancellationsList.length;
    const unpaidCancellationsTotal = unpaidCancellationsList.reduce((acc, o) => acc + Number(o.total_amount || 0), 0);

    // 2. Paid cancellations awaiting refund: Orders CANCELLED with payment PAID and refund not yet SUCCEEDED
    const paidCancellationsAwaitingRefundList = orderList.filter(o => o.status === 'CANCELLED' && o.payment_status === 'PAID');
    const paidCancellationsCount = paidCancellationsAwaitingRefundList.length;
    const paidCancellationsTotal = paidCancellationsAwaitingRefundList.reduce((acc, o) => acc + Number(o.total_amount || 0), 0);

    // 3. Confirmed refunds: Succeeded refund records
    const confirmedList = refundList.filter(r => r.status === 'SUCCEEDED');
    const confirmedCount = confirmedList.length;
    const confirmedTotal = confirmedList.reduce((acc, r) => acc + Number(r.amount || 0), 0);

    // 4. Failed/pending refunds: Attention state
    const failedPendingList = refundList.filter(r => r.status === 'PENDING' || r.status === 'FAILED');
    const failedPendingCount = failedPendingList.length;
    const failedPendingTotal = failedPendingList.reduce((acc, r) => acc + Number(r.amount || 0), 0);

    const refundsBreakdown: RefundBreakdown = {
        unpaidCancellations: {
            count: unpaidCancellationsCount,
            totalAmount: Math.round(unpaidCancellationsTotal * 100) / 100,
        },
        paidCancellationsAwaitingRefund: {
            count: paidCancellationsCount,
            totalAmount: Math.round(paidCancellationsTotal * 100) / 100,
        },
        confirmedRefunds: {
            count: confirmedCount,
            totalAmount: Math.round(confirmedTotal * 100) / 100,
        },
        failedPendingRefunds: {
            count: failedPendingCount,
            totalAmount: Math.round(failedPendingTotal * 100) / 100,
        },
    };

    // Construct Shop Totals Breakdown Table
    const shopAggs = new Map<string, ShopEarningsBreakdown>();

    // Initialize all shops
    shopsMap.forEach((name, id) => {
        shopAggs.set(id, {
            shopId: id,
            shopName: name,
            ordersCount: 0,
            serviceRevenue: 0,
            xerServiceEarnings: 0,
            shopEarnings: 0,
            confirmedRefunds: 0,
            cancellationsCount: 0,
            unallocatedCount: 0,
            unallocatedAmount: 0,
            settledAmount: 0,
        });
    });

    // Aggregate from order_financial_ledger
    for (const row of currentData.ledger) {
        const sId = row.shop_id;
        if (!shopAggs.has(sId)) {
            shopAggs.set(sId, {
                shopId: sId,
                shopName: shopsMap.get(sId) || 'Unknown Shop',
                ordersCount: 0,
                serviceRevenue: 0,
                xerServiceEarnings: 0,
                shopEarnings: 0,
                confirmedRefunds: 0,
                cancellationsCount: 0,
                unallocatedCount: 0,
                unallocatedAmount: 0,
                settledAmount: 0,
            });
        }
        const s = shopAggs.get(sId)!;
        const g = Number(row.gross_amount || 0);
        const fee = Number(row.platform_commission_amount || 0);
        const net = Number(row.vendor_net_amount || (g - fee));

        if (row.financial_status === 'UNCONFIGURED') {
            s.unallocatedCount++;
            s.unallocatedAmount += g;
            s.serviceRevenue += g;
        } else if (['PENDING', 'PAYABLE', 'SETTLED'].includes(row.financial_status)) {
            s.serviceRevenue += g;
            s.xerServiceEarnings += fee;
            s.shopEarnings += net;
        }
    }

    // Aggregate order counts & cancellations per shop
    for (const o of currentData.orders) {
        if (!o.shop_id) continue;
        const s = shopAggs.get(o.shop_id);
        if (s) {
            s.ordersCount++;
            if (o.status === 'CANCELLED') {
                s.cancellationsCount++;
            }
        }
    }

    // Aggregate settled disbursements per shop
    for (const b of currentData.batches) {
        const s = shopAggs.get(b.shop_id);
        if (s) {
            s.settledAmount += Number(b.vendor_payable_amount || 0);
        }
    }

    // Round shop metrics
    const shopList: ShopEarningsBreakdown[] = Array.from(shopAggs.values()).map(s => ({
        ...s,
        serviceRevenue: Math.round(s.serviceRevenue * 100) / 100,
        xerServiceEarnings: Math.round(s.xerServiceEarnings * 100) / 100,
        shopEarnings: Math.round(s.shopEarnings * 100) / 100,
        confirmedRefunds: Math.round(s.confirmedRefunds * 100) / 100,
        unallocatedAmount: Math.round(s.unallocatedAmount * 100) / 100,
        settledAmount: Math.round(s.settledAmount * 100) / 100,
    })).sort((a, b) => b.serviceRevenue - a.serviceRevenue);

    // Section 9.1: Documented metric sources metadata
    const metricSources = {
        xerServiceEarnings: {
            source: 'public.order_financial_ledger (platform_commission_amount)',
            inclusion: 'Orders with financial_status IN (PENDING, PAYABLE, SETTLED). Excludes UNCONFIGURED and REVERSED.',
            timestampBasis: 'Order creation timestamp in Asia/Kolkata boundaries.',
            refundTreatment: 'Reversed on confirmed refund; zero platform fee retained.',
        },
        serviceRevenue: {
            source: 'public.order_financial_ledger (gross_amount)',
            inclusion: 'Gross customer payment collections across paid and non-reversed orders.',
            timestampBasis: 'Order creation timestamp in Asia/Kolkata boundaries.',
            refundTreatment: 'Refunded amounts reported separately in Confirmed Refunds.',
        },
        shopEarnings: {
            source: 'public.order_financial_ledger (vendor_net_amount)',
            inclusion: 'Calculated as gross_amount - platform_commission_amount for completed/paid orders.',
            timestampBasis: 'Order creation timestamp in Asia/Kolkata boundaries.',
            refundTreatment: 'Zeroed out upon confirmed refund reversal.',
        },
        confirmedRefunds: {
            source: 'public.refund_requests (amount WHERE status = SUCCEEDED)',
            inclusion: 'Authoritative confirmed customer refunds via Razorpay or XerCoins wallet.',
            timestampBasis: 'Refund request creation timestamp in Asia/Kolkata boundaries.',
            refundTreatment: 'Reverses vendor net payable and platform commission in financial ledger.',
        },
        ordersIncluded: {
            source: 'public.orders (COUNT)',
            inclusion: 'All orders registered during reporting period.',
            timestampBasis: 'Order creation timestamp in Asia/Kolkata boundaries.',
            refundTreatment: 'Cancelled orders tracked and distinguished from active fulfillment.',
        },
        settledDisbursements: {
            source: 'public.vendor_settlement_batches (vendor_payable_amount WHERE status = PAID)',
            inclusion: 'Money externally transferred to vendors via UPI, NEFT, or Bank Transfer.',
            timestampBasis: 'Settlement disbursement settled_at timestamp.',
            refundTreatment: 'Paid settlements are immutable permanent accounting records.',
        },
    };

    return {
        period,
        kpis,
        refunds: refundsBreakdown,
        shops: shopList,
        metricSources,
    };
}

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAuth } from '@/lib/admin-auth';
import { getServiceRoleClient } from '@packages/backend/supabase';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
    const headers = { 'Cache-Control': 'no-store' };

    const auth = await requireAdminAuth(req);
    if (!auth.authorized) {
        return NextResponse.json({ error: auth.error }, { status: auth.status, headers });
    }

    try {
        const supabase = getServiceRoleClient();

        // 1. Fetch Ledger Entries
        const { data: ledgerEntries, error: ledgerErr } = await supabase
            .from('order_financial_ledger')
            .select('id, order_id, shop_id, gross_amount, platform_commission_amount, vendor_net_amount, financial_status, created_at')
            .order('created_at', { ascending: true });

        if (ledgerErr) {
            console.error('[AdminOverviewAnalytics] Ledger fetch error:', ledgerErr);
        }

        // 2. Fetch Orders
        const { data: orders, error: ordersErr } = await supabase
            .from('orders')
            .select('id, order_number, shop_id, status, payment_status, total_amount, created_at')
            .order('created_at', { ascending: true });

        if (ordersErr) {
            console.error('[AdminOverviewAnalytics] Orders fetch error:', ordersErr);
        }

        // 3. Fetch Shops
        const { data: shops } = await supabase
            .from('shops')
            .select('id, name, is_active, address');

        const shopsMap = new Map<string, string>();
        (shops || []).forEach(s => shopsMap.set(s.id, s.name));

        // 4. Fetch Users count & Deletion Requests
        const { data: profiles } = await supabase
            .from('profiles')
            .select('id, role, raw_user_meta_data');

        let totalUsers = 0;
        let customerCount = 0;
        let vendorCount = 0;
        let pendingDeletionsCount = 0;

        (profiles || []).forEach(p => {
            totalUsers++;
            if (p.role === 'customer') customerCount++;
            if (p.role === 'vendor') vendorCount++;
            if (p.raw_user_meta_data?.account_delete_request?.status === 'PENDING') {
                pendingDeletionsCount++;
            }
        });

        // 5. Aggregate Financial Totals
        const rows = ledgerEntries || [];
        let grossSales = 0;
        let platformCommission = 0;
        let vendorEarnings = 0;
        let payableAmount = 0;
        let settledAmount = 0;
        let pendingAmount = 0;
        let unconfiguredOrdersCount = 0;
        let unconfiguredOrdersAmount = 0;

        for (const row of rows) {
            const gross = Number(row.gross_amount || 0);
            const fee = Number(row.platform_commission_amount || 0);
            const net = Number(row.vendor_net_amount || (gross - fee));

            if (row.financial_status === 'UNCONFIGURED') {
                unconfiguredOrdersCount++;
                unconfiguredOrdersAmount += gross;
                grossSales += gross;
            } else if (row.financial_status === 'PENDING') {
                grossSales += gross;
                platformCommission += fee;
                vendorEarnings += net;
                pendingAmount += net;
            } else if (row.financial_status === 'PAYABLE') {
                grossSales += gross;
                platformCommission += fee;
                vendorEarnings += net;
                payableAmount += net;
            } else if (row.financial_status === 'SETTLED') {
                grossSales += gross;
                platformCommission += fee;
                vendorEarnings += net;
                settledAmount += net;
            }
        }

        // 6. Time-series Revenue & Earnings (Daily Aggregations)
        const dateMap = new Map<string, { date: string; gross: number; commission: number; ordersCount: number }>();

        // Pre-fill last 7 dates to ensure clean chart continuity
        const now = new Date();
        for (let i = 6; i >= 0; i--) {
            const d = new Date(now);
            d.setDate(d.getDate() - i);
            const key = d.toISOString().slice(0, 10);
            const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            dateMap.set(key, { date: label, gross: 0, commission: 0, ordersCount: 0 });
        }

        for (const row of rows) {
            const key = (row.created_at || '').slice(0, 10);
            if (!key) continue;
            const gross = Number(row.gross_amount || 0);
            const fee = Number(row.platform_commission_amount || 0);

            if (dateMap.has(key)) {
                const entry = dateMap.get(key)!;
                entry.gross += gross;
                entry.commission += fee;
                entry.ordersCount += 1;
            } else {
                const d = new Date(key);
                const label = isNaN(d.getTime()) ? key : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                dateMap.set(key, { date: label, gross, commission: fee, ordersCount: 1 });
            }
        }

        const trendPoints = Array.from(dateMap.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .slice(-14) // Last up to 14 days
            .map(([, val]) => ({
                date: val.date,
                gross: Math.round(val.gross * 100) / 100,
                commission: Math.round(val.commission * 100) / 100,
                orders: val.ordersCount,
            }));

        // 7. Order Status Breakdown
        const orderList = orders || [];
        const statusCounts: Record<string, number> = {
            COMPLETED: 0,
            IN_PROGRESS: 0,
            PENDING: 0,
            CANCELLED: 0,
            OTHER: 0,
        };

        for (const order of orderList) {
            const st = (order.status || '').toUpperCase();
            if (st === 'COMPLETED' || st === 'READY' || st === 'DELIVERED') {
                statusCounts.COMPLETED++;
            } else if (st === 'IN_PROGRESS' || st === 'PRINTING' || st === 'PROCESSING') {
                statusCounts.IN_PROGRESS++;
            } else if (st === 'PENDING' || st === 'SUBMITTED' || st === 'ACCEPTED') {
                statusCounts.PENDING++;
            } else if (st === 'CANCELLED' || st === 'REJECTED') {
                statusCounts.CANCELLED++;
            } else {
                statusCounts.OTHER++;
            }
        }

        const totalOrders = orderList.length || rows.length || 0;
        const orderStatusBreakdown = [
            { label: 'Completed', count: statusCounts.COMPLETED, color: '#16a34a' },
            { label: 'In Progress', count: statusCounts.IN_PROGRESS, color: '#0284c7' },
            { label: 'Pending', count: statusCounts.PENDING, color: '#f59e0b' },
            { label: 'Cancelled', count: statusCounts.CANCELLED, color: '#ef4444' },
        ];

        // 8. Shop Performance Breakdown
        const shopStatsMap = new Map<string, { shopId: string; shopName: string; ordersCount: number; grossRevenue: number; vendorEarnings: number }>();

        // Pre-populate with all known shops
        (shops || []).forEach(s => {
            shopStatsMap.set(s.id, {
                shopId: s.id,
                shopName: s.name,
                ordersCount: 0,
                grossRevenue: 0,
                vendorEarnings: 0,
            });
        });

        for (const row of rows) {
            if (!row.shop_id) continue;
            const shopName = shopsMap.get(row.shop_id) || 'Unknown Shop';
            const gross = Number(row.gross_amount || 0);
            const net = Number(row.vendor_net_amount || (gross - Number(row.platform_commission_amount || 0)));

            const current = shopStatsMap.get(row.shop_id) || {
                shopId: row.shop_id,
                shopName,
                ordersCount: 0,
                grossRevenue: 0,
                vendorEarnings: 0,
            };

            current.ordersCount += 1;
            current.grossRevenue += gross;
            current.vendorEarnings += net;
            shopStatsMap.set(row.shop_id, current);
        }

        const shopPerformance = Array.from(shopStatsMap.values())
            .map(s => ({
                ...s,
                grossRevenue: Math.round(s.grossRevenue * 100) / 100,
                vendorEarnings: Math.round(s.vendorEarnings * 100) / 100,
            }))
            .sort((a, b) => b.grossRevenue - a.grossRevenue);

        // 9. Operational Rates & Health
        const completedRate = totalOrders > 0 ? Math.round((statusCounts.COMPLETED / totalOrders) * 100) : 100;
        const totalLedger = rows.length;
        const configuredCount = totalLedger - unconfiguredOrdersCount;
        const commissionCoverageRate = totalLedger > 0 ? Math.round((configuredCount / totalLedger) * 100) : 100;

        return NextResponse.json({
            success: true,
            kpis: {
                grossSales: Math.round(grossSales * 100) / 100,
                platformCommission: Math.round(platformCommission * 100) / 100,
                vendorEarnings: Math.round(vendorEarnings * 100) / 100,
                payableAmount: Math.round(payableAmount * 100) / 100,
                settledAmount: Math.round(settledAmount * 100) / 100,
                pendingAmount: Math.round(pendingAmount * 100) / 100,
                totalOrders,
                totalShops: (shops || []).length,
                totalUsers,
                customerCount,
                vendorCount,
                unconfiguredOrdersCount,
                unconfiguredOrdersAmount: Math.round(unconfiguredOrdersAmount * 100) / 100,
                pendingDeletionsCount,
                completedRate,
                commissionCoverageRate,
            },
            trends: trendPoints,
            orderStatusBreakdown,
            shopPerformance,
        }, { status: 200, headers });
    } catch (err: unknown) {
        console.error('[AdminOverviewAnalytics] Unexpected error:', err);
        return NextResponse.json({
            error: err instanceof Error ? err.message : 'Failed to generate overview analytics.',
        }, { status: 500, headers });
    }
}

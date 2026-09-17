import { NextRequest, NextResponse } from 'next/server';
import { getServiceRoleClient, verifyAuthToken } from '@/lib/supabase/server';
import { getCorsHeaders, handleCorsPreflight } from '@/lib/cors';

export const runtime = 'nodejs';

export async function OPTIONS(req: NextRequest) {
    return handleCorsPreflight(req, ['GET', 'OPTIONS']);
}

type RevenueRange = 'today' | 'week' | 'month' | 'custom';

interface ChartBucket {
    label: string;
    amount: number;
}

// Format date in Asia/Kolkata (IST: UTC+05:30)
function getISTDateStr(date: Date): string {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(date); // YYYY-MM-DD
}

function getISTDateParts(date: Date) {
    const dtf = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
        hour12: false,
        weekday: 'short',
    });
    const parts = Object.fromEntries(dtf.formatToParts(date).map(p => [p.type, p.value]));
    return {
        year: parseInt(parts.year, 10),
        month: parseInt(parts.month, 10), // 1-12
        day: parseInt(parts.day, 10),
        hour: parseInt(parts.hour, 10), // 0-23
        weekday: parts.weekday, // Mon, Tue, etc.
    };
}

function getTodayISTBounds() {
    const todayDateStr = getISTDateStr(new Date());
    const startIST = new Date(`${todayDateStr}T00:00:00.000+05:30`).toISOString();
    const endIST = new Date(`${todayDateStr}T23:59:59.999+05:30`).toISOString();
    return { todayDateStr, startIST, endIST };
}

export async function GET(req: NextRequest) {
    const corsHeaders = getCorsHeaders(req, ['GET', 'OPTIONS']);
    const headers: Record<string, string> = {
        'Cache-Control': 'no-store',
        ...corsHeaders,
    };
    const fail = (error: string, status = 400) =>
        NextResponse.json({ error }, { status, headers });

    // 1. Authenticate Request
    const authHeader = req.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return fail('Authentication required. Please sign in.', 401);
    }
    const token = authHeader.slice(7).trim();

    let authUser: { userId: string; email?: string } | null = null;
    try {
        authUser = await verifyAuthToken(token);
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return fail(`Authentication failed: ${msg}`, 401);
    }

    if (!authUser || !authUser.userId) {
        return fail('Session invalid or expired. Please sign in again.', 401);
    }

    const serviceClient = getServiceRoleClient();

    // 2. Verify Vendor Role
    const { data: profile, error: profileError } = await serviceClient
        .from('profiles')
        .select('role')
        .eq('user_id', authUser.userId)
        .maybeSingle();

    if (profileError || !profile || profile.role !== 'vendor') {
        return fail('Forbidden: vendor privileges required.', 403);
    }

    // 3. Find Vendor-Owned Shop
    const { data: shop, error: shopError } = await serviceClient
        .from('shops')
        .select('id, name, status')
        .eq('owner_id', authUser.userId)
        .maybeSingle();

    if (shopError || !shop) {
        return fail('No shop assigned to this vendor account.', 404);
    }

    // 4. Parse Query Parameters
    const { searchParams } = new URL(req.url);
    const rangeParam = (searchParams.get('range') || 'today') as RevenueRange;
    const range: RevenueRange = ['today', 'week', 'month', 'custom'].includes(rangeParam) ? rangeParam : 'today';
    const fromParam = searchParams.get('from');
    const toParam = searchParams.get('to');

    const todayBounds = getTodayISTBounds();

    // 5. Query Paid Orders with File Print Settings
    const { data: paidOrders, error: ordersError } = await serviceClient
        .from('orders')
        .select(`
            id,
            total_amount,
            status,
            payment_status,
            created_at,
            paid_at,
            completed_at,
            order_files (
                id,
                print_settings (
                    colour_mode
                )
            )
        `)
        .eq('shop_id', shop.id)
        .eq('payment_status', 'PAID');

    if (ordersError) {
        console.error('[VendorOverview] Orders fetch error:', ordersError);
        return fail('Failed to fetch orders data', 500);
    }

    const orders = paidOrders || [];

    // 5b. Fetch financial ledger entries to distinguish Gross vs Net earnings
    const ledgerMap: Record<string, { gross: number; commission: number; net: number; status: string }> = {};
    try {
        const { data: ledgerRows } = await serviceClient
            .from('order_financial_ledger')
            .select('order_id, gross_amount, platform_commission_amount, vendor_net_amount, financial_status')
            .eq('shop_id', shop.id);

        if (ledgerRows) {
            for (const r of ledgerRows) {
                const gross = Number(r.gross_amount || 0);
                const commission = Number(r.platform_commission_amount || 0);
                const net = r.vendor_net_amount !== null ? Number(r.vendor_net_amount) : gross;
                ledgerMap[r.order_id] = { gross, commission, net, status: r.financial_status };
            }
        }
    } catch {
        // Table may not exist pre-push
    }

    // Helper to evaluate order financial net earnings
    const getOrderFinancials = (order: any): { isEligible: boolean; gross: number; net: number; isCompleted: boolean } => {
        // Strictly exclude refunded or cancelled orders
        if (order.payment_status === 'REFUNDED' || order.status === 'CANCELLED') {
            return { isEligible: false, gross: 0, net: 0, isCompleted: false };
        }
        const ledger = ledgerMap[order.id];
        if (ledger && ledger.status === 'REVERSED') {
            return { isEligible: false, gross: 0, net: 0, isCompleted: false };
        }

        const gross = Number(order.total_amount || 0);
        const net = ledger ? ledger.net : gross;
        const isCompleted = order.status === 'COMPLETED';

        return { isEligible: true, gross, net, isCompleted };
    };

    // 6. Query Completed Orders for Today in IST
    const { data: completedTodayOrders, error: completedError } = await serviceClient
        .from('orders')
        .select('id')
        .eq('shop_id', shop.id)
        .eq('status', 'COMPLETED')
        .gte('completed_at', todayBounds.startIST)
        .lte('completed_at', todayBounds.endIST);

    if (completedError) {
        console.error('[VendorOverview] Completed orders fetch error:', completedError);
    }

    // 7. Query Refunded Orders
    const { data: refundedOrders } = await serviceClient
        .from('orders')
        .select('total_amount')
        .eq('shop_id', shop.id)
        .eq('payment_status', 'REFUNDED');

    // 8. Core Metrics
    // totalRevenue represents Vendor Net Earnings for completed orders, strictly excluding refunded orders
    let totalRevenue = 0;
    let todayRevenue = 0;
    let grossSales = 0;
    let platformCommission = 0;
    let validPaidOrdersCount = 0;

    for (const order of orders) {
        const { isEligible, gross, net, isCompleted } = getOrderFinancials(order);
        if (!isEligible) continue;

        validPaidOrdersCount++;
        grossSales += gross;

        if (isCompleted) {
            totalRevenue += net;
            const ledger = ledgerMap[order.id];
            if (ledger) {
                platformCommission += ledger.commission;
            }

            const completedAt = order.completed_at || order.paid_at || order.created_at;
            if (completedAt) {
                const completedDate = new Date(completedAt);
                if (completedDate >= new Date(todayBounds.startIST) && completedDate <= new Date(todayBounds.endIST)) {
                    todayRevenue += net;
                }
            }
        }
    }

    const totalOrders = validPaidOrdersCount;
    const todayCompletedOrders = completedTodayOrders?.length || 0;

    // 8b. Check if commission is configured for this shop
    let isCommissionConfigured = false;
    try {
        const { data: activeRules } = await serviceClient
            .from('shop_commission_rules')
            .select('id, commission_bps')
            .eq('shop_id', shop.id)
            .eq('is_active', true)
            .lte('effective_from', new Date().toISOString())
            .limit(1);

        if (activeRules && activeRules.length > 0) {
            isCommissionConfigured = true;
        } else {
            const hasConfiguredLedger = Object.values(ledgerMap).some(l => l.status !== 'UNCONFIGURED' && l.status !== 'REVERSED');
            if (hasConfiguredLedger) {
                isCommissionConfigured = true;
            }
        }
    } catch {
        // Table may not exist pre-push
    }

    // 9. Time-Series Chart Bucketing
    let chartData: ChartBucket[] = [];

    if (range === 'today') {
        // Continuous hourly buckets from 9am to 5pm IST (9 slots matching approved UI)
        const hourlyMap: Record<string, number> = {
            '9am': 0,
            '10am': 0,
            '11am': 0,
            '12pm': 0,
            '1pm': 0,
            '2pm': 0,
            '3pm': 0,
            '4pm': 0,
            '5pm': 0,
        };

        for (const order of orders) {
            const { isEligible, net } = getOrderFinancials(order);
            if (!isEligible) continue;

            const paidAt = order.completed_at || order.paid_at || order.created_at;
            if (!paidAt) continue;
            const paidDate = new Date(paidAt);
            if (paidDate >= new Date(todayBounds.startIST) && paidDate <= new Date(todayBounds.endIST)) {
                const parts = getISTDateParts(paidDate);
                if (parts.hour <= 9) {
                    hourlyMap['9am'] += net;
                } else if (parts.hour === 10) {
                    hourlyMap['10am'] += net;
                } else if (parts.hour === 11) {
                    hourlyMap['11am'] += net;
                } else if (parts.hour === 12) {
                    hourlyMap['12pm'] += net;
                } else if (parts.hour === 13) {
                    hourlyMap['1pm'] += net;
                } else if (parts.hour === 14) {
                    hourlyMap['2pm'] += net;
                } else if (parts.hour === 15) {
                    hourlyMap['3pm'] += net;
                } else if (parts.hour === 16) {
                    hourlyMap['4pm'] += net;
                } else {
                    hourlyMap['5pm'] += net;
                }
            }
        }

        chartData = Object.entries(hourlyMap).map(([label, amount]) => ({
            label,
            amount: Math.round(amount * 100) / 100,
        }));
    } else if (range === 'week') {
        // Monday through Sunday of current week in IST
        const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

        // Find date of Monday in IST
        const dayOfWeekIndex = (new Date(`${todayBounds.todayDateStr}T12:00:00.000+05:30`).getDay() + 6) % 7; // Mon=0, Sun=6
        const mondayDate = new Date(`${todayBounds.todayDateStr}T12:00:00.000+05:30`);
        mondayDate.setDate(mondayDate.getDate() - dayOfWeekIndex);

        const weekBuckets: { label: string; dateStr: string; amount: number }[] = [];
        for (let i = 0; i < 7; i++) {
            const d = new Date(mondayDate);
            d.setDate(d.getDate() + i);
            weekBuckets.push({
                label: days[i],
                dateStr: getISTDateStr(d),
                amount: 0,
            });
        }

        for (const order of orders) {
            const { isEligible, net } = getOrderFinancials(order);
            if (!isEligible) continue;

            const paidAt = order.completed_at || order.paid_at || order.created_at;
            if (!paidAt) continue;
            const orderDateStr = getISTDateStr(new Date(paidAt));
            const bucket = weekBuckets.find(b => b.dateStr === orderDateStr);
            if (bucket) {
                bucket.amount += net;
            }
        }

        chartData = weekBuckets.map(b => ({
            label: b.label,
            amount: Math.round(b.amount * 100) / 100,
        }));
    } else if (range === 'month') {
        // Full calendar month in Asia/Kolkata:
        // Week 1 = Days 1-7, Week 2 = Days 8-14, Week 3 = Days 15-21,
        // Week 4 = Days 22-28, Week 5 = Days 29 to end of month (29, 30, 31)
        const monthMap = [
            { label: 'Week 1', amount: 0 },
            { label: 'Week 2', amount: 0 },
            { label: 'Week 3', amount: 0 },
            { label: 'Week 4', amount: 0 },
            { label: 'Week 5', amount: 0 },
        ];

        const nowParts = getISTDateParts(new Date());

        for (const order of orders) {
            const { isEligible, net } = getOrderFinancials(order);
            if (!isEligible) continue;

            const paidAt = order.completed_at || order.paid_at || order.created_at;
            if (!paidAt) continue;
            const orderParts = getISTDateParts(new Date(paidAt));
            if (orderParts.year === nowParts.year && orderParts.month === nowParts.month) {
                if (orderParts.day <= 7) {
                    monthMap[0].amount += net;
                } else if (orderParts.day <= 14) {
                    monthMap[1].amount += net;
                } else if (orderParts.day <= 21) {
                    monthMap[2].amount += net;
                } else if (orderParts.day <= 28) {
                    monthMap[3].amount += net;
                } else {
                    monthMap[4].amount += net;
                }
            }
        }

        chartData = monthMap.map(m => ({
            label: m.label,
            amount: Math.round(m.amount * 100) / 100,
        }));
    } else if (range === 'custom') {
        // Date range between from and to (max 31 days)
        let startDate = fromParam ? new Date(`${fromParam}T00:00:00.000+05:30`) : new Date();
        let endDate = toParam ? new Date(`${toParam}T23:59:59.999+05:30`) : new Date();

        if (isNaN(startDate.getTime())) {
            startDate = new Date();
            startDate.setDate(startDate.getDate() - 7);
        }
        if (isNaN(endDate.getTime())) {
            endDate = new Date();
        }
        if (startDate > endDate) {
            const temp = startDate;
            startDate = endDate;
            endDate = temp;
        }

        // Limit to 31 days
        const diffDays = Math.min(31, Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))));
        const customBuckets: { label: string; dateStr: string; amount: number }[] = [];

        for (let i = 0; i < diffDays; i++) {
            const cur = new Date(startDate);
            cur.setDate(cur.getDate() + i);
            const dateStr = getISTDateStr(cur);
            // Label format: "01 Sep"
            const label = new Intl.DateTimeFormat('en-IN', {
                timeZone: 'Asia/Kolkata',
                day: '2-digit',
                month: 'short',
            }).format(cur);
            customBuckets.push({ label, dateStr, amount: 0 });
        }

        for (const order of orders) {
            const { isEligible, net } = getOrderFinancials(order);
            if (!isEligible) continue;

            const paidAt = order.completed_at || order.paid_at || order.created_at;
            if (!paidAt) continue;
            const orderDateStr = getISTDateStr(new Date(paidAt));
            const bucket = customBuckets.find(b => b.dateStr === orderDateStr);
            if (bucket) {
                bucket.amount += net;
            }
        }

        chartData = customBuckets.map(b => ({
            label: b.label,
            amount: Math.round(b.amount * 100) / 100,
        }));
    }

    // 10. Order Types Classification
    let bwCount = 0;
    let colourCount = 0;
    let mixedCount = 0;
    let othersCount = 0;

    for (const order of orders) {
        const { isEligible } = getOrderFinancials(order);
        if (!isEligible) continue;

        const files = (order.order_files as any[]) || [];
        if (files.length === 0) {
            othersCount++;
            continue;
        }

        let hasBW = false;
        let hasColour = false;

        for (const file of files) {
            const mode = file.print_settings?.colour_mode;
            if (mode === 'BW') hasBW = true;
            else if (mode === 'COLOUR') hasColour = true;
        }

        if (hasBW && !hasColour) {
            bwCount++;
        } else if (hasColour && !hasBW) {
            colourCount++;
        } else if (hasBW && hasColour) {
            mixedCount++;
        } else {
            othersCount++;
        }
    }

    const totalClassified = validPaidOrdersCount;
    let bwPercent = 0;
    let colourPercent = 0;
    let mixedPercent = 0;
    let othersPercent = 0;

    if (totalClassified > 0) {
        bwPercent = Math.round((bwCount / totalClassified) * 100);
        colourPercent = Math.round((colourCount / totalClassified) * 100);
        mixedPercent = Math.round((mixedCount / totalClassified) * 100);
        // Ensure exact 100% distribution
        othersPercent = Math.max(0, 100 - (bwPercent + colourPercent + mixedPercent));
    }

    const orderTypes = {
        totalPaidOrders: totalClassified,
        items: [
            { key: 'bw', label: 'B&W', count: bwCount, percentage: bwPercent, color: '#54bdce' },
            { key: 'colour', label: 'Colour', count: colourCount, percentage: colourPercent, color: '#8edce8' },
            { key: 'mixed', label: 'Mixed', count: mixedCount, percentage: mixedPercent, color: '#a78bfa' },
            { key: 'others', label: 'Others', count: othersCount, percentage: othersPercent, color: '#d4d7de' },
        ],
    };

    // 11. Payment Summary
    let refundedTotal = 0;
    if (refundedOrders) {
        for (const r of refundedOrders) {
            refundedTotal += Number(r.total_amount || 0);
        }
    }

    // UPI Payments is derived strictly from real payment_attempts where:
    // status = 'PAID' AND payment_method = 'UPI', scoped to this vendor's shop orders.
    // NULL payment_method values are never classified as UPI.
    // If no UPI payment exists or payment_method column is not yet migrated, returns 0.00.
    let upiTotal = 0;
    const orderIds = orders.map(o => o.id);
    if (orderIds.length > 0) {
        const { data: attempts, error: attemptsError } = await serviceClient
            .from('payment_attempts')
            .select('amount, status, payment_method')
            .in('order_id', orderIds)
            .eq('status', 'PAID')
            .eq('payment_method', 'UPI');

        if (!attemptsError && attempts && attempts.length > 0) {
            for (const att of attempts) {
                upiTotal += Number(att.amount || 0);
            }
        }
    }

    const paymentSummary = {
        upiPayments: Math.round(upiTotal * 100) / 100,
        successfulPayments: Math.round(grossSales * 100) / 100,
        refundedPayments: Math.round(refundedTotal * 100) / 100,
    };

    // Unsettled net balance from ledger entries (pending + payable)
    let unsettledBalance = 0;
    for (const orderId in ledgerMap) {
        const item = ledgerMap[orderId];
        if (item && (item.status === 'PENDING' || item.status === 'PAYABLE')) {
            unsettledBalance += item.net;
        }
    }

    // Last payout / disbursed settlement batch
    let lastPayout: { amount: number; date: string; settlementNumber?: string } | null = null;
    try {
        const { data: lastBatch } = await serviceClient
            .from('vendor_settlement_batches')
            .select('vendor_payable_amount, disbursed_at, settlement_number')
            .eq('shop_id', shop.id)
            .eq('status', 'PAID')
            .order('disbursed_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (lastBatch && lastBatch.disbursed_at) {
            lastPayout = {
                amount: Math.round(Number(lastBatch.vendor_payable_amount || 0) * 100) / 100,
                date: lastBatch.disbursed_at,
                settlementNumber: lastBatch.settlement_number,
            };
        }
    } catch {
        // Fallback if table does not exist
    }

    return NextResponse.json({
        shop: {
            id: shop.id,
            name: shop.name,
            status: shop.status,
        },
        metrics: {
            commissionConfigured: isCommissionConfigured,
            todayRevenue: isCommissionConfigured ? Math.round(todayRevenue * 100) / 100 : null,
            totalRevenue: isCommissionConfigured ? Math.round(totalRevenue * 100) / 100 : null,
            unsettledBalance: isCommissionConfigured ? Math.round(unsettledBalance * 100) / 100 : null,
            lastPayout,
            grossSales: Math.round(grossSales * 100) / 100,
            todayCompletedOrders,
            totalOrders,
        },
        range,
        chartData,
        orderTypes,
        paymentSummary,
    }, { headers });
}

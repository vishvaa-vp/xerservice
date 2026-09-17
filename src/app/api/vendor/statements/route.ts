import { NextRequest, NextResponse } from 'next/server';
import { getServiceRoleClient, verifyAuthToken } from '@/lib/supabase/server';
import { getCorsHeaders, handleCorsPreflight } from '@/lib/cors';

export const runtime = 'nodejs';

export async function OPTIONS(req: NextRequest) {
    return handleCorsPreflight(req, ['GET', 'OPTIONS']);
}

export async function GET(req: NextRequest) {
    const corsHeaders = getCorsHeaders(req, ['GET', 'OPTIONS']);
    const headers: Record<string, string> = {
        'Cache-Control': 'no-store',
        ...corsHeaders,
    };
    const fail = (error: string, status = 400) =>
        NextResponse.json({ error }, { status, headers });

    // 1. Authenticate vendor
    const authHeader = req.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return fail('Authentication required.', 401);
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
        return fail('Invalid session.', 401);
    }

    const serviceClient = getServiceRoleClient();

    // 2. Verify vendor role
    const { data: profile } = await serviceClient
        .from('profiles')
        .select('role')
        .eq('user_id', authUser.userId)
        .maybeSingle();

    if (!profile || profile.role !== 'vendor') {
        return fail('Forbidden: vendor role required.', 403);
    }

    // 3. Locate shop
    const { data: shop } = await serviceClient
        .from('shops')
        .select('id, name, status, description, owner_id')
        .eq('owner_id', authUser.userId)
        .maybeSingle();

    if (!shop) {
        return fail('Shop not found for this vendor.', 404);
    }

    // 4. Parse Query Parameters
    const searchParams = req.nextUrl.searchParams;
    const period = searchParams.get('period') || 'all';
    const customFrom = searchParams.get('from');
    const customTo = searchParams.get('to');
    const searchQuery = (searchParams.get('search') || '').trim().toLowerCase();
    const format = searchParams.get('format') || 'json';

    // Determine Date Range [fromDate, toDate]
    const now = new Date();
    let fromDate: Date;
    let toDate: Date = new Date(now.getTime() + 86400000); // end of buffer

    if (customFrom && customTo) {
        fromDate = new Date(customFrom);
        toDate = new Date(new Date(customTo).getTime() + 86400000);
    } else if (period === 'today') {
        fromDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    } else if (period === '7d') {
        fromDate = new Date(now.getTime() - 7 * 86400000);
    } else if (period === 'month') {
        fromDate = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
    } else {
        // 'all'
        fromDate = new Date(0); // 1970-01-01
    }

    const fromIso = fromDate.toISOString();
    const toIso = toDate.toISOString();

    // 5. Fetch Ledger Records
    const { data: allLedgerRows, error: ledgerError } = await serviceClient
        .from('order_financial_ledger')
        .select(`
            id,
            order_id,
            shop_id,
            gross_amount,
            vendor_net_amount,
            financial_status,
            eligible_at,
            settled_at,
            reversed_at,
            created_at,
            updated_at
        `)
        .eq('shop_id', shop.id);

    if (ledgerError) {
        return fail(`Failed to load ledger records: ${ledgerError.message}`, 500);
    }

    // Fetch Linked Orders for Order Numbers
    const orderIds = Array.from(new Set((allLedgerRows || []).map(r => r.order_id)));
    let orderMap = new Map<string, { order_number: string; status: string }>();
    if (orderIds.length > 0) {
        const { data: orders } = await serviceClient
            .from('orders')
            .select('id, order_number, status')
            .in('id', orderIds);
        if (orders) {
            orders.forEach(o => orderMap.set(o.id, { order_number: o.order_number, status: o.status }));
        }
    }

    // 6. Fetch Settlement Batches
    const { data: allBatches, error: batchesError } = await serviceClient
        .from('vendor_settlement_batches')
        .select(`
            id,
            settlement_number,
            gross_order_amount,
            vendor_payable_amount,
            order_count,
            status,
            payment_reference,
            settled_at,
            disbursed_at,
            created_at
        `)
        .eq('shop_id', shop.id);

    if (batchesError) {
        return fail(`Failed to load settlement batches: ${batchesError.message}`, 500);
    }

    // 7. Calculate Passbook Balances
    // (a) Transactions prior to fromDate
    let priorCredits = 0;
    let priorRefunds = 0;
    let priorPayouts = 0;

    // (b) Transactions inside period [fromDate, toDate]
    let earnedInPeriod = 0;
    let adjustmentsInPeriod = 0;
    let paymentsReceivedInPeriod = 0;

    // (c) Sub-balances
    let pendingFulfillment = 0;
    let readyToReceive = 0;

    interface RawTx {
        id: string;
        date: string;
        type: 'EARNING' | 'REFUND' | 'PAYMENT';
        reference: string;
        orderId?: string;
        description: string;
        grossAmount?: number;
        credit: number | null;
        debit: number | null;
    }

    const allTx: RawTx[] = [];

    // Process Ledger rows
    (allLedgerRows || []).forEach(row => {
        const net = Number(row.vendor_net_amount || 0);
        const gross = Number(row.gross_amount || 0);
        const orderInfo = orderMap.get(row.order_id);
        const orderNum = orderInfo?.order_number || row.order_id.slice(0, 8);

        if (row.financial_status === 'PENDING') {
            pendingFulfillment += net;
        } else if (row.financial_status === 'PAYABLE') {
            readyToReceive += net;
        }

        // Earned credit: eligible when completed / settled
        if (['PAYABLE', 'SETTLED'].includes(row.financial_status)) {
            const earnDate = row.eligible_at || row.created_at;
            if (earnDate < fromIso) {
                priorCredits += net;
            } else if (earnDate <= toIso) {
                earnedInPeriod += net;
            }

            allTx.push({
                id: `earn-${row.id}`,
                date: earnDate,
                type: 'EARNING',
                reference: orderNum,
                orderId: row.order_id,
                description: `Order #${orderNum} earnings`,
                grossAmount: gross,
                credit: net,
                debit: null,
            });
        }

        // Refund/Reversal debit
        if (row.financial_status === 'REVERSED') {
            const revDate = row.reversed_at || row.updated_at || row.created_at;
            if (revDate < fromIso) {
                priorRefunds += net;
            } else if (revDate <= toIso) {
                adjustmentsInPeriod += net;
            }

            allTx.push({
                id: `rev-${row.id}`,
                date: revDate,
                type: 'REFUND',
                reference: orderNum,
                orderId: row.order_id,
                description: `Order #${orderNum} refund reversal`,
                grossAmount: gross,
                credit: null,
                debit: net,
            });
        }
    });

    // Process Settlement Batches
    (allBatches || []).forEach(batch => {
        if (batch.status === 'PAID') {
            const paidDate = batch.disbursed_at || batch.settled_at || batch.created_at;
            const amt = Number(batch.vendor_payable_amount || 0);

            if (paidDate < fromIso) {
                priorPayouts += amt;
            } else if (paidDate <= toIso) {
                paymentsReceivedInPeriod += amt;
            }

            allTx.push({
                id: `payout-${batch.id}`,
                date: paidDate,
                type: 'PAYMENT',
                reference: batch.settlement_number || batch.id.slice(0, 8),
                description: `Payout settlement (${batch.payment_reference || 'Disbursed'})`,
                grossAmount: Number(batch.gross_order_amount || amt),
                credit: null,
                debit: amt,
            });
        }
    });

    const isAllTime = period === 'all' && (!customFrom || customFrom === '1970-01-01');
    const openingBalance = isAllTime ? 0 : Math.round((priorCredits - priorRefunds - priorPayouts) * 100) / 100;
    const closingBalance = Math.round((openingBalance + earnedInPeriod - adjustmentsInPeriod - paymentsReceivedInPeriod) * 100) / 100;

    // 8. Sort Chronologically & Compute Running Balance
    allTx.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    let running = openingBalance;
    const calculatedTx = allTx.map(tx => {
        if (tx.credit !== null) running += tx.credit;
        if (tx.debit !== null) running -= tx.debit;
        return {
            ...tx,
            runningBalance: Math.round(running * 100) / 100,
        };
    });

    // Filter by period bounds for display
    let periodTx = calculatedTx.filter(tx => tx.date >= fromIso && tx.date <= toIso);

    // Apply search query filter if provided
    if (searchQuery) {
        periodTx = periodTx.filter(tx =>
            tx.reference.toLowerCase().includes(searchQuery) ||
            tx.description.toLowerCase().includes(searchQuery) ||
            tx.type.toLowerCase().includes(searchQuery)
        );
    }

    // Sort reverse-chronologically for presentation
    periodTx.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    // Masked Payment Account for shop
    const paymentAccount = 'UPI: ven***@okhdfcbank';

    // 9. Return CSV if requested
    if (format === 'csv') {
        const csvLines = [
            `"Date","Reference","Description","Type","Gross (₹)","Credit (₹)","Debit (₹)","Balance (₹)"`,
            ...periodTx.map(t => {
                const creditStr = t.credit !== null ? t.credit.toFixed(2) : '';
                const debitStr = t.debit !== null ? t.debit.toFixed(2) : '';
                const grossStr = t.grossAmount !== undefined ? t.grossAmount.toFixed(2) : '';
                return `"${t.date}","${t.reference}","${t.description.replace(/"/g, '""')}","${t.type}","${grossStr}","${creditStr}","${debitStr}","${t.runningBalance.toFixed(2)}"`;
            })
        ];

        const csvContent = csvLines.join('\n');
        return new NextResponse(csvContent, {
            status: 200,
            headers: {
                ...headers,
                'Content-Type': 'text/csv; charset=utf-8',
                'Content-Disposition': `attachment; filename="statement_${shop.id}_${period}.csv"`,
            },
        });
    }

    // 10. Return JSON Response (Strict privacy: NO commission rates/basis points)
    return NextResponse.json({
        shop: {
            id: shop.id,
            name: shop.name,
            paymentAccount,
        },
        period: {
            name: period,
            from: fromDate.toISOString().slice(0, 10),
            to: (period === 'all' ? now : toDate).toISOString().slice(0, 10),
        },
        summary: {
            openingBalance: Math.round(openingBalance * 100) / 100,
            earnedInPeriod: Math.round(earnedInPeriod * 100) / 100,
            adjustmentsInPeriod: Math.round(adjustmentsInPeriod * 100) / 100,
            paymentsReceivedInPeriod: Math.round(paymentsReceivedInPeriod * 100) / 100,
            closingBalance: Math.round(closingBalance * 100) / 100,
            readyToReceive: Math.round(readyToReceive * 100) / 100,
            pendingFulfillment: Math.round(pendingFulfillment * 100) / 100,
        },
        transactions: periodTx,
    }, { status: 200, headers });
}

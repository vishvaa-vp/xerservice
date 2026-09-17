import { NextRequest, NextResponse } from 'next/server';
import { getServiceRoleClient, verifyAuthToken } from '@/lib/supabase/server';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
    const headers = { 'Cache-Control': 'no-store' };
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
        .select('id, name')
        .eq('owner_id', authUser.userId)
        .maybeSingle();

    if (shopError || !shop) {
        return fail('No shop assigned to this vendor account.', 404);
    }

    // 4. Parse Pagination and Filter Query Parameters
    const { searchParams } = new URL(req.url);
    const statusFilter = searchParams.get('status');
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '50', 10)));
    const offset = (page - 1) * limit;

    // 5. Query order_financial_ledger
    try {
        let query = serviceClient
            .from('order_financial_ledger')
            .select(`
                id,
                order_id,
                gross_amount,
                currency,
                commission_bps,
                platform_commission_amount,
                vendor_net_amount,
                financial_status,
                eligible_at,
                settled_at,
                created_at,
                orders (
                    id,
                    order_number,
                    status,
                    payment_status,
                    total_amount,
                    paid_at,
                    completed_at
                )
            `, { count: 'exact' })
            .eq('shop_id', shop.id)
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);

        if (statusFilter) {
            query = query.eq('financial_status', statusFilter);
        }

        const { data: ledgerRows, count, error: ledgerErr } = await query;

        // Fallback for pre-push environment if table is missing
        if (ledgerErr && (ledgerErr.code === 'PGRST205' || ledgerErr.code === '42P01')) {
            const { data: orders, count: orderCount } = await serviceClient
                .from('orders')
                .select('id, order_number, status, payment_status, total_amount, paid_at, completed_at', { count: 'exact' })
                .eq('shop_id', shop.id)
                .in('payment_status', ['PAID', 'REFUNDED'])
                .order('created_at', { ascending: false })
                .range(offset, offset + limit - 1);

            const fallbackRows = (orders || []).map(o => ({
                id: `fallback-${o.id}`,
                order_id: o.id,
                gross_amount: Number(o.total_amount),
                currency: 'INR',
                commission_bps: null,
                platform_commission_amount: null,
                vendor_net_amount: null,
                financial_status: o.payment_status === 'REFUNDED' ? 'REVERSED' : 'UNCONFIGURED',
                eligible_at: null,
                settled_at: null,
                created_at: o.paid_at || new Date().toISOString(),
                orders: o,
            }));

            return NextResponse.json({
                orders: fallbackRows,
                total: orderCount || fallbackRows.length,
                page,
                limit,
            }, { headers });
        }

        if (ledgerErr) {
            console.error('[VendorFinanceOrders] Query error:', ledgerErr);
            return fail('Failed to fetch financial orders.', 500);
        }

        // Whitelist vendor-safe fields: strictly strip private commission rates and platform fees per Astraplan 8.4
        const sanitizedRows = (ledgerRows || []).map((row: any) => ({
            id: row.id,
            order_id: row.order_id,
            gross_amount: row.gross_amount,
            currency: row.currency,
            vendor_net_amount: row.vendor_net_amount,
            financial_status: row.financial_status,
            eligible_at: row.eligible_at,
            settled_at: row.settled_at,
            created_at: row.created_at,
            orders: row.orders,
        }));

        return NextResponse.json({
            orders: sanitizedRows,
            total: count || 0,
            page,
            limit,
        }, { headers });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[VendorFinanceOrders] Exception:', msg);
        return fail(`Failed to load orders: ${msg}`, 500);
    }
}

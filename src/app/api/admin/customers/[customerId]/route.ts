import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAuth } from '@/lib/admin-auth';
import { getServiceRoleClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

/** GET /api/admin/customers/[customerId]
 *  Returns detailed customer profile, metrics, order history, and refunds.
 */
export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ customerId: string }> }
) {
    const auth = await requireAdminAuth(req);
    if (!auth.authorized) {
        return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { customerId } = await params;
    if (!customerId) {
        return NextResponse.json({ error: 'Customer ID is required.' }, { status: 400 });
    }

    const sb = getServiceRoleClient();

    try {
        // 1. Fetch auth user
        const { data: authData, error: authErr } = await sb.auth.admin.getUserById(customerId);
        if (authErr || !authData?.user) {
            return NextResponse.json({ error: 'Customer account not found.' }, { status: 404 });
        }
        const u = authData.user;

        // 2. Fetch profile
        const { data: profile, error: profileErr } = await sb
            .from('profiles')
            .select('user_id, full_name, phone, role, created_at, updated_at')
            .eq('user_id', customerId)
            .maybeSingle();

        if (profileErr) throw new Error(profileErr.message);

        // 3. Fetch orders
        const { data: orders, error: ordersErr } = await sb
            .from('orders')
            .select('id, order_number, status, payment_status, total_amount, shop_id, created_at')
            .eq('user_id', customerId)
            .order('created_at', { ascending: false });

        if (ordersErr) throw new Error(ordersErr.message);

        // 4. Fetch shop names for orders
        const shopIds = Array.from(new Set((orders ?? []).map(o => o.shop_id).filter(Boolean)));
        const shopMap: Record<string, string> = {};
        if (shopIds.length > 0) {
            const { data: shops } = await sb
                .from('shops')
                .select('id, name')
                .in('id', shopIds);

            for (const s of (shops ?? [])) {
                shopMap[s.id] = s.name;
            }
        }

        // 5. Fetch refunds
        const { data: refunds, error: refundsErr } = await sb
            .from('refund_requests')
            .select('id, order_id, amount, status, reason, created_at')
            .eq('user_id', customerId)
            .order('created_at', { ascending: false });

        if (refundsErr) throw new Error(refundsErr.message);

        // 6. Calculate metrics
        let completedOrders = 0;
        let paidOrders = 0;
        let grossSpend = 0;
        for (const o of (orders ?? [])) {
            if (o.status === 'COMPLETED') completedOrders++;
            if (o.payment_status === 'COMPLETED') {
                paidOrders++;
                grossSpend += Number(o.total_amount) || 0;
            }
        }

        let refundAmount = 0;
        for (const r of (refunds ?? [])) {
            if (r.status === 'SUCCEEDED') {
                refundAmount += Number(r.amount) || 0;
            }
        }

        grossSpend = Math.round(grossSpend * 100) / 100;
        refundAmount = Math.round(refundAmount * 100) / 100;
        const netSpend = Math.max(0, Math.round((grossSpend - refundAmount) * 100) / 100);

        const isDisabled = u.banned_until ? new Date(u.banned_until) > new Date() : false;
        const isPending = !isDisabled && (!u.last_sign_in_at || (!u.email_confirmed_at && Boolean(u.email)));
        const accountCategory = isDisabled ? 'inactive' : isPending ? 'pending' : 'active';

        const enrichedOrders = (orders ?? []).map(o => ({
            id: o.id,
            orderNumber: o.order_number,
            shopName: shopMap[o.shop_id] || 'Unknown Shop',
            status: o.status,
            paymentStatus: o.payment_status,
            totalAmount: Number(o.total_amount) || 0,
            createdAt: o.created_at,
        }));

        return NextResponse.json({
            customer: {
                userId: u.id,
                fullName: profile?.full_name ?? null,
                email: u.email ?? null,
                phone: profile?.phone ?? null,
                role: profile?.role ?? 'customer',
                accountStatus: isDisabled ? 'disabled' : isPending ? 'pending' : 'active',
                accountCategory,
                isDisabled,
                isPending,
                lastSignInAt: u.last_sign_in_at ?? null,
                createdAt: profile?.created_at ?? u.created_at,
                metrics: {
                    completedOrders,
                    paidOrders,
                    totalOrders: (orders ?? []).length,
                    grossSpend,
                    refundAmount,
                    netSpend,
                },
                orders: enrichedOrders,
                refunds: refunds ?? [],
            }
        }, {
            status: 200,
            headers: { 'Cache-Control': 'no-store' },
        });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}

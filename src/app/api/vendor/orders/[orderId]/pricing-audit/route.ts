import { NextRequest, NextResponse } from 'next/server';
import { getServiceRoleClient, verifyAuthToken } from '@/lib/supabase/server';
import { getOrderPricingAudit } from '@packages/backend/finance';

export const runtime = 'nodejs';

export async function GET(
    req: NextRequest,
    context: { params: Promise<{ orderId: string }> }
) {
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

    const sb = getServiceRoleClient();

    // 2. Verify Vendor Role
    const { data: profile, error: profileError } = await sb
        .from('profiles')
        .select('role')
        .eq('user_id', authUser.userId)
        .maybeSingle();

    if (profileError || !profile || profile.role !== 'vendor') {
        return fail('Forbidden: vendor privileges required.', 403);
    }

    // 3. Find Vendor-Owned Shop
    const { data: shop, error: shopError } = await sb
        .from('shops')
        .select('id, name')
        .eq('owner_id', authUser.userId)
        .maybeSingle();

    if (shopError || !shop) {
        return fail('No shop assigned to this vendor account.', 404);
    }

    const { orderId } = await context.params;
    if (!orderId) {
        return fail('Order ID is required.', 400);
    }

    // 4. Verify Order belongs to this vendor's shop (tenant isolation)
    const { data: order, error: orderErr } = await sb
        .from('orders')
        .select('id, shop_id')
        .eq('id', orderId)
        .maybeSingle();

    if (orderErr || !order) {
        return fail('Order not found.', 404);
    }

    if (order.shop_id !== shop.id) {
        return fail('Forbidden: You do not have permission to audit orders from other shops.', 403);
    }

    // 5. Generate Audit
    try {
        const audit = await getOrderPricingAudit(sb, orderId);
        return NextResponse.json({ success: true, audit }, { status: 200, headers });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[VendorCommercialAudit] Error auditing order ${orderId}:`, msg);
        return fail(`Failed to audit order: ${msg}`, 500);
    }
}

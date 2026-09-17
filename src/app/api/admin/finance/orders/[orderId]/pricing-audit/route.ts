import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAuth } from '@/lib/admin-auth';
import { getServiceRoleClient } from '@/lib/supabase/server';
import { getOrderPricingAudit } from '@packages/backend/finance';

export const runtime = 'nodejs';

export async function GET(
    req: NextRequest,
    context: { params: Promise<{ orderId: string }> }
) {
    const headers = { 'Cache-Control': 'no-store' };

    const auth = await requireAdminAuth(req);
    if (!auth.authorized) {
        return NextResponse.json({ error: auth.error }, { status: auth.status, headers });
    }

    const { orderId } = await context.params;
    if (!orderId) {
        return NextResponse.json({ error: 'Order ID is required.' }, { status: 400, headers });
    }

    try {
        const sb = getServiceRoleClient();
        const audit = await getOrderPricingAudit(sb, orderId);
        return NextResponse.json({ success: true, audit }, { status: 200, headers });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[AdminCommercialAudit] Error auditing order ${orderId}:`, msg);
        const status = msg.includes('not found') ? 404 : 500;
        return NextResponse.json({ error: msg }, { status, headers });
    }
}

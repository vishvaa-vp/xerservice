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

    // 4. Query Settlement Batches
    try {
        const { data: batches, error: batchErr } = await serviceClient
            .from('vendor_settlement_batches')
            .select(`
                id,
                settlement_number,
                gross_order_amount,
                platform_commission_amount,
                vendor_payable_amount,
                order_count,
                status,
                payment_reference,
                disbursed_at,
                notes,
                created_at,
                vendor_settlement_items (
                    id,
                    order_financial_ledger_id
                )
            `)
            .eq('shop_id', shop.id)
            .order('created_at', { ascending: false });

        if (batchErr && (batchErr.code === 'PGRST205' || batchErr.code === '42P01')) {
            // Pre-push fallback
            return NextResponse.json({ settlements: [] }, { headers });
        }

        if (batchErr) {
            console.error('[VendorSettlements] Query error:', batchErr);
            return fail('Failed to fetch settlements.', 500);
        }

        // Whitelist vendor-safe fields: strip platform_commission_amount per Astraplan 8.4
        const sanitizedBatches = (batches || []).map((b: any) => ({
            id: b.id,
            settlement_number: b.settlement_number,
            gross_order_amount: b.gross_order_amount,
            vendor_payable_amount: b.vendor_payable_amount,
            order_count: b.order_count,
            status: b.status,
            payment_reference: b.payment_reference,
            disbursed_at: b.disbursed_at,
            notes: b.notes,
            created_at: b.created_at,
            vendor_settlement_items: b.vendor_settlement_items,
        }));

        return NextResponse.json({ settlements: sanitizedBatches }, { headers });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[VendorSettlements] Exception:', msg);
        return fail(`Failed to load settlements: ${msg}`, 500);
    }
}

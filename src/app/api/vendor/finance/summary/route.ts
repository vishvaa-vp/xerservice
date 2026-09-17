import { NextRequest, NextResponse } from 'next/server';
import { getServiceRoleClient, verifyAuthToken } from '@/lib/supabase/server';
import { getShopFinancialSummary } from '@/lib/vendor-ledger';

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
        .select('id, name, status')
        .eq('owner_id', authUser.userId)
        .maybeSingle();

    if (shopError || !shop) {
        return fail('No shop assigned to this vendor account.', 404);
    }

    // 4. Retrieve Authoritative Financial Summary
    try {
        const summary = await getShopFinancialSummary(shop.id);
        // Whitelist vendor-safe fields: strip private platform commission per Astraplan 8.4
        const { platformCommission: _omit, ...vendorSafeSummary } = summary as any;
        return NextResponse.json({
            shop: {
                id: shop.id,
                name: shop.name,
            },
            summary: vendorSafeSummary,
        }, { headers });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[VendorFinanceSummary] Exception:', msg);
        return fail(`Failed to load financial summary: ${msg}`, 500);
    }
}

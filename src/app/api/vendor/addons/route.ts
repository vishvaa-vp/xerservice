import { NextRequest, NextResponse } from 'next/server';
import { getServiceRoleClient, verifyAuthToken } from '@/lib/supabase/server';
import { getVendorShopAddons } from '@/lib/addons-service';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
    const headers = { 'Cache-Control': 'no-store' };

    // 1. Authenticate Request
    const authHeader = req.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return NextResponse.json({ error: 'Authentication required. Please sign in.' }, { status: 401, headers });
    }
    const token = authHeader.slice(7).trim();

    let authUser: { userId: string } | null = null;
    try {
        authUser = await verifyAuthToken(token);
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return NextResponse.json({ error: `Authentication failed: ${msg}` }, { status: 401, headers });
    }

    if (!authUser || !authUser.userId) {
        return NextResponse.json({ error: 'Session invalid or expired.' }, { status: 401, headers });
    }

    const serviceClient = getServiceRoleClient();

    // 2. Identify Vendor Shop
    const { data: shop, error: shopErr } = await serviceClient
        .from('shops')
        .select('id, name')
        .eq('owner_id', authUser.userId)
        .limit(1)
        .maybeSingle();

    if (shopErr || !shop) {
        // Fallback for default D-Block shop in dev if owner_id not linked
        const { data: dblock } = await serviceClient
            .from('shops')
            .select('id, name')
            .ilike('name', '%D-Block%')
            .limit(1)
            .maybeSingle();

        const shopId = dblock?.id || '4fa63198-dbe3-485a-a38f-dc4454f0a996';
        const addons = await getVendorShopAddons(shopId);
        return NextResponse.json({ shopId, addons }, { status: 200, headers });
    }

    const addons = await getVendorShopAddons(shop.id);
    return NextResponse.json({ shopId: shop.id, shopName: shop.name, addons }, { status: 200, headers });
}

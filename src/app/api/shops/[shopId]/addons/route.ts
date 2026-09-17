import { NextRequest, NextResponse } from 'next/server';
import { getShopAvailableAddons } from '@/lib/addons-service';

export const runtime = 'nodejs';

interface RouteContext {
    params: Promise<{ shopId: string }>;
}

export async function GET(req: NextRequest, context: RouteContext) {
    const headers = { 'Cache-Control': 'no-store' };
    const params = await context.params;
    const shopId = params?.shopId;

    if (!shopId) {
        return NextResponse.json({ error: 'Shop ID is required.' }, { status: 400, headers });
    }

    try {
        const addons = await getShopAvailableAddons(shopId);
        const formatted = (addons || []).map((a: any) => ({
            id: a.shopAddonId || a.id,
            shopAddonId: a.shopAddonId || a.id,
            addonId: a.addonId || a.addon_id,
            name: a.name || a.addon?.name,
            description: a.description || a.addon?.description,
            imageUrl: a.imageUrl || a.image_url || a.addon?.image_url || null,
            image_url: a.imageUrl || a.image_url || a.addon?.image_url || null,
            price: Number(a.price ?? a.base_price ?? a.addon?.base_price ?? 0),
            base_price: Number(a.price ?? a.base_price ?? a.addon?.base_price ?? 0),
            estimatedMinutes: Number(a.estimatedMinutes ?? a.estimated_minutes ?? a.addon?.estimated_prep_time_minutes ?? 0),
            minPages: Number(a.minPages ?? a.min_pages ?? a.addon?.min_page_limit ?? 1),
            maxPages: Number(a.maxPages ?? a.max_pages ?? a.addon?.max_page_limit ?? 1000),
            isAvailable: true,
            is_available: true,
            addon: {
                id: a.addonId || a.id,
                name: a.name || a.addon?.name,
                description: a.description || a.addon?.description,
                image_url: a.imageUrl || a.image_url || a.addon?.image_url || null,
                base_price: Number(a.price ?? a.base_price ?? a.addon?.base_price ?? 0),
                estimated_prep_time_minutes: Number(a.estimatedMinutes ?? a.estimated_minutes ?? a.addon?.estimated_prep_time_minutes ?? 0),
                min_page_limit: Number(a.minPages ?? a.min_pages ?? a.addon?.min_page_limit ?? 1),
                max_page_limit: Number(a.maxPages ?? a.max_pages ?? a.addon?.max_page_limit ?? 1000),
                is_active: true,
            },
        }));
        return NextResponse.json({ shopId, addons: formatted }, { status: 200, headers });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return NextResponse.json({ error: msg }, { status: 500, headers });
    }
}

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAuth } from '@/lib/admin-auth';
import { getServiceRoleClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

/**
 * GET /api/admin/vendors/[userId]/shops/[shopId]/addons
 * Returns all assigned add-ons for this shop as well as unassigned global catalogue items.
 */
export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ userId: string; shopId: string }> }
) {
    const auth = await requireAdminAuth(req);
    if (!auth.authorized) {
        return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { shopId } = await params;
    if (!shopId) {
        return NextResponse.json({ error: 'Shop ID is required.' }, { status: 400 });
    }

    const sb = getServiceRoleClient();

    try {
        // 1. Fetch assigned shop_addons joined with addons
        const { data: shopAddons, error: saErr } = await sb
            .from('shop_addons')
            .select(`
                id,
                shop_id,
                addon_id,
                price,
                is_available,
                addons (
                    id,
                    name,
                    description,
                    image_url,
                    estimated_minutes,
                    min_pages,
                    max_pages,
                    is_active
                )
            `)
            .eq('shop_id', shopId);

        if (saErr) throw new Error(saErr.message);

        // 2. Fetch all active global catalogue items
        const { data: allAddons, error: aErr } = await sb
            .from('addons')
            .select('id, name, description, image_url, estimated_minutes, min_pages, max_pages, is_active')
            .eq('is_active', true)
            .order('name', { ascending: true });

        if (aErr) throw new Error(aErr.message);

        const assignedAddonIds = new Set((shopAddons || []).map(sa => sa.addon_id));
        const availableCatalogue = (allAddons || []).filter(a => !assignedAddonIds.has(a.id));

        return NextResponse.json({
            shopId,
            assigned: shopAddons || [],
            availableCatalogue,
        }, {
            status: 200,
            headers: { 'Cache-Control': 'no-store' }
        });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}

/**
 * POST /api/admin/vendors/[userId]/shops/[shopId]/addons
 * Assigns a global catalogue add-on to this shop with a shop-specific price.
 */
export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ userId: string; shopId: string }> }
) {
    const auth = await requireAdminAuth(req);
    if (!auth.authorized) {
        return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { shopId } = await params;
    if (!shopId) {
        return NextResponse.json({ error: 'Shop ID is required.' }, { status: 400 });
    }

    const sb = getServiceRoleClient();

    try {
        const body = await req.json();
        const { addonId, price, isAvailable = true } = body;

        if (!addonId) {
            return NextResponse.json({ error: 'addonId is required.' }, { status: 400 });
        }

        const numPrice = Number(price);
        if (!Number.isFinite(numPrice) || numPrice < 0) {
            return NextResponse.json({ error: 'Price must be a non-negative number.' }, { status: 400 });
        }
        const roundedPrice = Math.round(numPrice * 100) / 100;

        // Check if catalogue add-on exists
        const { data: catalogueItem, error: catErr } = await sb
            .from('addons')
            .select('id, name')
            .eq('id', addonId)
            .single();

        if (catErr || !catalogueItem) {
            return NextResponse.json({ error: 'Catalogue add-on not found.' }, { status: 404 });
        }

        // Check if already assigned
        const { data: existingAssignment } = await sb
            .from('shop_addons')
            .select('id')
            .eq('shop_id', shopId)
            .eq('addon_id', addonId)
            .maybeSingle();

        if (existingAssignment) {
            return NextResponse.json({ error: 'This add-on is already assigned to this shop.' }, { status: 409 });
        }

        // Insert new assignment
        const { data: created, error: insertErr } = await sb
            .from('shop_addons')
            .insert({
                shop_id: shopId,
                addon_id: addonId,
                price: roundedPrice,
                is_available: Boolean(isAvailable),
            })
            .select(`
                id,
                shop_id,
                addon_id,
                price,
                is_available,
                addons (
                    id,
                    name,
                    description,
                    image_url,
                    estimated_minutes,
                    min_pages,
                    max_pages
                )
            `)
            .single();

        if (insertErr) throw new Error(insertErr.message);

        return NextResponse.json({
            success: true,
            assignment: created,
        }, { status: 201 });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return NextResponse.json({ error: msg }, { status: 400 });
    }
}

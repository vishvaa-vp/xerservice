import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAuth } from '@/lib/admin-auth';
import { getServiceRoleClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

/**
 * PATCH /api/admin/vendors/[userId]/shops/[shopId]/addons/[shopAddonId]
 * Updates price or availability for a specific shop add-on assignment.
 */
export async function PATCH(
    req: NextRequest,
    { params }: { params: Promise<{ userId: string; shopId: string; shopAddonId: string }> }
) {
    const auth = await requireAdminAuth(req);
    if (!auth.authorized) {
        return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { shopId, shopAddonId } = await params;
    if (!shopId || !shopAddonId) {
        return NextResponse.json({ error: 'Shop ID and Shop Add-on ID are required.' }, { status: 400 });
    }

    const sb = getServiceRoleClient();

    try {
        const body = await req.json();
        const updatePayload: Record<string, any> = {
            updated_at: new Date().toISOString(),
        };

        if ('price' in body) {
            const numPrice = Number(body.price);
            if (!Number.isFinite(numPrice) || numPrice < 0) {
                return NextResponse.json({ error: 'Price must be a non-negative number.' }, { status: 400 });
            }
            updatePayload.price = Math.round(numPrice * 100) / 100;
        }

        if ('isAvailable' in body) {
            updatePayload.is_available = Boolean(body.isAvailable);
        }

        const { data: updated, error: updateErr } = await sb
            .from('shop_addons')
            .update(updatePayload)
            .eq('id', shopAddonId)
            .eq('shop_id', shopId)
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

        if (updateErr || !updated) {
            return NextResponse.json({ error: updateErr?.message || 'Shop add-on assignment not found.' }, { status: 404 });
        }

        return NextResponse.json({
            success: true,
            assignment: updated,
        }, { status: 200 });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return NextResponse.json({ error: msg }, { status: 400 });
    }
}

/**
 * DELETE /api/admin/vendors/[userId]/shops/[shopId]/addons/[shopAddonId]
 * Removes an add-on assignment from this shop without deleting the global catalogue entry.
 */
export async function DELETE(
    req: NextRequest,
    { params }: { params: Promise<{ userId: string; shopId: string; shopAddonId: string }> }
) {
    const auth = await requireAdminAuth(req);
    if (!auth.authorized) {
        return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { shopId, shopAddonId } = await params;
    if (!shopId || !shopAddonId) {
        return NextResponse.json({ error: 'Shop ID and Shop Add-on ID are required.' }, { status: 400 });
    }

    const sb = getServiceRoleClient();

    try {
        const { error: delErr } = await sb
            .from('shop_addons')
            .delete()
            .eq('id', shopAddonId)
            .eq('shop_id', shopId);

        if (delErr) throw new Error(delErr.message);

        return NextResponse.json({
            success: true,
            removedId: shopAddonId,
        }, { status: 200 });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return NextResponse.json({ error: msg }, { status: 400 });
    }
}

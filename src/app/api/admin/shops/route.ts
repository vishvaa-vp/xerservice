import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAuth } from '@/lib/admin-auth';
import { getServiceRoleClient } from '@/lib/supabase/server';
import { serializeShopProfileMetadata, parseShopProfileMetadata, PublishStatus, TradingStatus } from '@/lib/shop-profile';

export const runtime = 'nodejs';

/**
 * POST /api/admin/shops
 * Safely creates a new print shop without overwriting existing shops.
 * Enforces one-owner/one-shop rule and initializes publishStatus (default DRAFT).
 */
export async function POST(req: NextRequest) {
    const auth = await requireAdminAuth(req);
    if (!auth.authorized) {
        return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const sb = getServiceRoleClient();

    try {
        const body = await req.json();
        const {
            name,
            ownerId,
            address,
            status = 'CLOSED',
            publishStatus = 'DRAFT',
            openTime = '09:00',
            closeTime = '18:00',
            photos = [],
            contactPhone = null,
        } = body;

        if (!name || typeof name !== 'string' || !name.trim()) {
            return NextResponse.json({ error: 'Shop name is required.' }, { status: 400 });
        }

        if (!ownerId || typeof ownerId !== 'string') {
            return NextResponse.json({ error: 'Owner vendor ID is required.' }, { status: 400 });
        }

        // Verify that owner profile exists and has role = 'vendor'
        const { data: ownerProfile, error: profErr } = await sb
            .from('profiles')
            .select('user_id, full_name, role')
            .eq('user_id', ownerId)
            .maybeSingle();

        if (profErr || !ownerProfile) {
            return NextResponse.json({ error: 'Assigned vendor owner not found.' }, { status: 404 });
        }

        if (ownerProfile.role !== 'vendor') {
            return NextResponse.json({ error: 'Assigned owner must have vendor role.' }, { status: 400 });
        }

        // Enforce 1-owner/1-shop rule: check if vendor already owns an existing shop
        const { data: existingShop } = await sb
            .from('shops')
            .select('id, name')
            .eq('owner_id', ownerId)
            .maybeSingle();

        if (existingShop) {
            return NextResponse.json({
                error: `Vendor "${ownerProfile.full_name || ownerId}" already owns an active shop ("${existingShop.name}"). Single-owner rule prevents silent reassignment.`
            }, { status: 409 });
        }

        // Validate trading status & publish status
        const validStatus: TradingStatus = ['OPEN', 'PAUSED', 'CLOSED'].includes(status.toUpperCase())
            ? status.toUpperCase()
            : 'CLOSED';

        const validPublish: PublishStatus = ['DRAFT', 'PUBLISHED', 'ARCHIVED'].includes(publishStatus.toUpperCase())
            ? publishStatus.toUpperCase()
            : 'DRAFT';

        // Serialize metadata envelope
        const serializedDescription = serializeShopProfileMetadata({
            address: address ? String(address).trim() : null,
            publishStatus: validPublish,
            photos: Array.isArray(photos) ? photos : [],
            contactPhone: contactPhone ? String(contactPhone).trim() : null,
        });

        // Insert new shop
        const { data: createdShop, error: insertErr } = await sb
            .from('shops')
            .insert({
                name: name.trim(),
                owner_id: ownerId,
                description: serializedDescription,
                status: validStatus,
                open_time: openTime,
                close_time: closeTime,
                closing_soon: false,
                closing_message: null,
            })
            .select('id, name, description, status, owner_id, open_time, close_time, closing_soon, closing_message, created_at')
            .single();

        if (insertErr) throw new Error(insertErr.message);

        const meta = parseShopProfileMetadata(createdShop.description);

        return NextResponse.json({
            success: true,
            shop: {
                id: createdShop.id,
                name: createdShop.name,
                ownerId: createdShop.owner_id,
                shopStatus: createdShop.status as TradingStatus,
                publishStatus: meta.publishStatus,
                address: meta.address,
                photos: meta.photos,
                contactPhone: meta.contactPhone,
                openTime: createdShop.open_time,
                closeTime: createdShop.close_time,
                createdAt: createdShop.created_at,
            }
        }, { status: 201 });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return NextResponse.json({ error: msg }, { status: 400 });
    }
}

import { NextRequest, NextResponse } from 'next/server';
import { getServiceRoleClient, verifyAuthToken } from '@/lib/supabase/server';
import { getCorsHeaders, handleCorsPreflight } from '@/lib/cors';
import { parseShopProfileMetadata, serializeShopProfileMetadata, TradingStatus } from '@/lib/shop-profile';
import { evaluateShopSetupReadiness } from '@/lib/setup-readiness';
import { buildShopCustomerPreview } from '@/lib/customer-preview';

export const runtime = 'nodejs';

export async function OPTIONS(req: NextRequest) {
    return handleCorsPreflight(req, ['GET', 'PATCH', 'OPTIONS']);
}

export async function GET(req: NextRequest) {
    const corsHeaders = getCorsHeaders(req, ['GET', 'PATCH', 'OPTIONS']);
    const headers: Record<string, string> = {
        'Cache-Control': 'no-store',
        ...corsHeaders,
    };
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
        .select('role, phone')
        .eq('user_id', authUser.userId)
        .maybeSingle();

    if (profileError || !profile || profile.role !== 'vendor') {
        return fail('Forbidden: vendor privileges required.', 403);
    }

    // 3. Find Vendor-Owned Shop
    const { data: shop, error: shopError } = await serviceClient
        .from('shops')
        .select('id, name, description, status, owner_id, open_time, close_time, closing_soon, closing_message, created_at, updated_at')
        .eq('owner_id', authUser.userId)
        .maybeSingle();

    if (shopError || !shop) {
        return fail('No shop assigned to this vendor account.', 404);
    }

    const meta = parseShopProfileMetadata(shop.description);

    // 4. Fetch Pricing & Commission for Readiness Evaluation
    const { data: pricingRows } = await serviceClient
        .from('shop_pricing')
        .select('paper_size, print_mode, sides, price_per_sheet, active')
        .eq('shop_id', shop.id);

    const { data: activeRules } = await serviceClient
        .from('shop_commission_rules')
        .select('*')
        .eq('shop_id', shop.id)
        .eq('is_active', true);

    const activeRule = (activeRules || []).find(r => r.is_active);

    const readiness = evaluateShopSetupReadiness({
        shop,
        metadata: meta,
        ownerPhone: profile.phone,
        pricingRows: pricingRows || [],
        activeCommissionRule: activeRule || null,
    });

    const { data: shopAddons } = await serviceClient
        .from('shop_addons')
        .select(`
            id,
            addon_id,
            price,
            available,
            addons (
                name,
                price_unit
            )
        `)
        .eq('shop_id', shop.id);

    const customerPreview = buildShopCustomerPreview({
        shop,
        metadata: meta,
        pricingRows: pricingRows || [],
        addons: shopAddons || [],
    });

    return NextResponse.json({
        shop: {
            id: shop.id,
            name: shop.name,
            ownerId: shop.owner_id,
            status: shop.status as TradingStatus,
            publishStatus: meta.publishStatus,
            address: meta.address,
            contactPhone: meta.contactPhone,
            photos: meta.photos,
            openTime: shop.open_time || '09:00',
            closeTime: shop.close_time || '20:00',
            closingSoon: Boolean(shop.closing_soon),
            closingMessage: shop.closing_message,
            commercialTerms: {
                settlementCycle: 'Daily (T+1)',
                commercialPlan: 'Standard Platform Terms',
            },
            updatedAt: shop.updated_at,
            readiness,
            customerPreview,
        },
    }, { status: 200, headers });
}

export async function PATCH(req: NextRequest) {
    const corsHeaders = getCorsHeaders(req, ['GET', 'PATCH', 'OPTIONS']);
    const headers: Record<string, string> = {
        'Cache-Control': 'no-store',
        ...corsHeaders,
    };
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
        .select('role, phone')
        .eq('user_id', authUser.userId)
        .maybeSingle();

    if (profileError || !profile || profile.role !== 'vendor') {
        return fail('Forbidden: vendor privileges required.', 403);
    }

    // 3. Find Vendor-Owned Shop
    const { data: existingShop, error: shopError } = await serviceClient
        .from('shops')
        .select('id, name, description, status, owner_id, open_time, close_time, closing_soon, closing_message')
        .eq('owner_id', authUser.userId)
        .maybeSingle();

    if (shopError || !existingShop) {
        return fail('No shop assigned to this vendor account.', 404);
    }

    try {
        const body = await req.json();
        const currentMeta = parseShopProfileMetadata(existingShop.description);

        const newName = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : existingShop.name;

        let newStatus = existingShop.status;
        if (body.status && ['OPEN', 'PAUSED', 'CLOSED'].includes(String(body.status).toUpperCase())) {
            newStatus = String(body.status).toUpperCase();
        }

        const newAddress = 'address' in body
            ? (typeof body.address === 'string' ? body.address.trim() : null)
            : currentMeta.address;

        const newContactPhone = 'contactPhone' in body
            ? (typeof body.contactPhone === 'string' ? body.contactPhone.trim() : null)
            : currentMeta.contactPhone;

        const newPhotos = Array.isArray(body.photos) ? body.photos : currentMeta.photos;
        const newOpenTime = 'openTime' in body ? body.openTime : ('open_time' in body ? body.open_time : existingShop.open_time);
        const newCloseTime = 'closeTime' in body ? body.closeTime : ('close_time' in body ? body.close_time : existingShop.close_time);
        const newClosingSoon = 'closingSoon' in body
            ? Boolean(body.closingSoon)
            : ('closing_soon' in body ? Boolean(body.closing_soon) : existingShop.closing_soon);
        const newClosingMessage = 'closingMessage' in body
            ? (body.closingMessage ? String(body.closingMessage) : null)
            : ('closing_message' in body ? (body.closing_message ? String(body.closing_message) : null) : existingShop.closing_message);

        // Serialize metadata
        const serializedDescription = serializeShopProfileMetadata({
            address: newAddress,
            publishStatus: currentMeta.publishStatus,
            photos: newPhotos,
            contactPhone: newContactPhone,
        });

        const updatePayload: Record<string, any> = {
            name: newName,
            status: newStatus,
            description: serializedDescription,
            open_time: newOpenTime,
            close_time: newCloseTime,
            closing_soon: newClosingSoon,
            closing_message: newClosingMessage,
            updated_at: new Date().toISOString(),
        };

        const { data: updatedShop, error: updateErr } = await serviceClient
            .from('shops')
            .update(updatePayload)
            .eq('id', existingShop.id)
            .select('id, name, description, status, owner_id, open_time, close_time, closing_soon, closing_message, updated_at')
            .single();

        if (updateErr) throw new Error(updateErr.message);

        const updatedMeta = parseShopProfileMetadata(updatedShop.description);

        const { data: pricingRows } = await serviceClient
            .from('shop_pricing')
            .select('paper_size, print_mode, sides, price_per_sheet, active')
            .eq('shop_id', updatedShop.id);

        const { data: activeRules } = await serviceClient
            .from('shop_commission_rules')
            .select('*')
            .eq('shop_id', updatedShop.id)
            .eq('is_active', true);

        const activeRule = (activeRules || []).find(r => r.is_active);

        const readiness = evaluateShopSetupReadiness({
            shop: updatedShop,
            metadata: updatedMeta,
            ownerPhone: profile.phone,
            pricingRows: pricingRows || [],
            activeCommissionRule: activeRule || null,
        });

        return NextResponse.json({
            success: true,
            shop: {
                id: updatedShop.id,
                name: updatedShop.name,
                ownerId: updatedShop.owner_id,
                status: updatedShop.status as TradingStatus,
                publishStatus: updatedMeta.publishStatus,
                address: updatedMeta.address,
                contactPhone: updatedMeta.contactPhone,
                photos: updatedMeta.photos,
                openTime: updatedShop.open_time,
                closeTime: updatedShop.close_time,
                closingSoon: Boolean(updatedShop.closing_soon),
                closingMessage: updatedShop.closing_message,
                commercialTerms: {
                    settlementCycle: 'Daily (T+1)',
                    commercialPlan: 'Standard Platform Terms',
                },
                updatedAt: updatedShop.updated_at,
                readiness,
            },
        }, { status: 200, headers });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return fail(msg, 400);
    }
}

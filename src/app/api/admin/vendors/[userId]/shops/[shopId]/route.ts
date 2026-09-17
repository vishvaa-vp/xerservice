import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAuth } from '@/lib/admin-auth';
import { getServiceRoleClient } from '@/lib/supabase/server';
import { calculateShopFinancialSummary } from '@/lib/vendor-ledger';
import { parseShopProfileMetadata, serializeShopProfileMetadata, PublishStatus, TradingStatus } from '@/lib/shop-profile';
import { evaluateShopSetupReadiness } from '@/lib/setup-readiness';
import { buildShopCustomerPreview } from '@/lib/customer-preview';

export const runtime = 'nodejs';

/**
 * GET /api/admin/vendors/[vendorId]/shops/[shopId]
 * Returns full dedicated shop workspace payload:
 * - Shop profile (identity, address, operating hours, publish visibility, trading status, photos)
 * - Owner details
 * - Financial summary & ledger
 * - Active commission rule
 * - Configured print pricing matrix
 * - Assigned add-ons catalogue
 * - Recent orders
 */
export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ userId: string; shopId: string }> }
) {
    const auth = await requireAdminAuth(req);
    if (!auth.authorized) {
        return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { userId, shopId } = await params;
    const vendorId = userId;
    if (!shopId || !vendorId) {
        return NextResponse.json({ error: 'Vendor ID and Shop ID are required.' }, { status: 400 });
    }

    const sb = getServiceRoleClient();

    try {
        // 1. Fetch shop
        const { data: shop, error: shopErr } = await sb
            .from('shops')
            .select('id, name, description, status, owner_id, open_time, close_time, closing_soon, closing_message, created_at, updated_at')
            .eq('id', shopId)
            .maybeSingle();

        if (shopErr || !shop) {
            return NextResponse.json({ error: 'Shop not found.' }, { status: 404 });
        }

        // 2. Fetch owner profile
        const { data: ownerProfile, error: profileErr } = await sb
            .from('profiles')
            .select('user_id, full_name, phone, role, created_at')
            .eq('user_id', vendorId)
            .maybeSingle();

        if (profileErr || !ownerProfile) {
            return NextResponse.json({ error: 'Owner vendor profile not found.' }, { status: 404 });
        }

        // Fetch owner email
        const { data: authUser } = await sb.auth.admin.getUserById(vendorId);

        // 3. Parse profile metadata
        const meta = parseShopProfileMetadata(shop.description);

        // 4. Commission rules
        const { data: rules } = await sb
            .from('shop_commission_rules')
            .select('*')
            .eq('shop_id', shopId)
            .order('effective_from', { ascending: false });

        const activeRule = (rules || []).find(r => r.is_active);

        // 5. Financial ledger entries
        const { data: ledgers, error: ledgersErr } = await sb
            .from('order_financial_ledger')
            .select(`
                id,
                order_id,
                shop_id,
                gross_amount,
                currency,
                commission_bps,
                platform_commission_amount,
                vendor_net_amount,
                financial_status,
                eligible_at,
                settled_at,
                reversed_at,
                refund_request_id,
                reversal_reason,
                created_at,
                orders (
                    order_number,
                    status,
                    paid_at,
                    cancelled_at
                )
            `)
            .eq('shop_id', shopId)
            .order('created_at', { ascending: false });

        if (ledgersErr) throw new Error(ledgersErr.message);

        const summary = calculateShopFinancialSummary(ledgers || [], !!activeRule);

        // 6. Configured print pricing matrix from shop_pricing
        const { data: pricingRows } = await sb
            .from('shop_pricing')
            .select('id, paper_size, print_mode, sides, price_per_sheet, active')
            .eq('shop_id', shopId)
            .order('paper_size', { ascending: true });

        // 7. Assigned add-ons from shop_addons & addons
        const { data: shopAddons } = await sb
            .from('shop_addons')
            .select(`
                id,
                addon_id,
                price,
                available,
                addons (
                    id,
                    name,
                    category,
                    price_unit,
                    image_url
                )
            `)
            .eq('shop_id', shopId);

        // 8. Recent orders for this shop
        const { data: orders } = await sb
            .from('orders')
            .select('id, order_number, status, payment_status, total_amount, created_at')
            .eq('shop_id', shopId)
            .order('created_at', { ascending: false })
            .limit(20);

        const readiness = evaluateShopSetupReadiness({
            shop: {
                id: shop.id,
                name: shop.name,
                open_time: shop.open_time,
                close_time: shop.close_time,
                status: shop.status,
            },
            metadata: meta,
            ownerPhone: ownerProfile.phone,
            pricingRows: pricingRows || [],
            activeCommissionRule: activeRule || null,
        });

        return NextResponse.json({
            shop: {
                id: shop.id,
                name: shop.name,
                ownerId: shop.owner_id,
                shopStatus: shop.status as TradingStatus,
                publishStatus: meta.publishStatus as PublishStatus,
                address: meta.address,
                photos: meta.photos,
                contactPhone: meta.contactPhone,
                openTime: shop.open_time,
                closeTime: shop.close_time,
                closingSoon: Boolean(shop.closing_soon),
                closingMessage: shop.closing_message,
                createdAt: shop.created_at,
                updatedAt: shop.updated_at,
            },
            owner: {
                userId: ownerProfile.user_id,
                fullName: ownerProfile.full_name,
                email: authUser?.user?.email || null,
                phone: ownerProfile.phone,
                role: ownerProfile.role,
                createdAt: ownerProfile.created_at,
            },
            summary,
            activeRule: activeRule ? {
                id: activeRule.id,
                commission_bps: activeRule.commission_bps,
                commissionPercentage: activeRule.commission_bps / 100,
                effective_from: activeRule.effective_from,
                effective_to: activeRule.effective_to,
            } : null,
            rules: rules || [],
            pricing: pricingRows || [],
            addons: (shopAddons || []).map((sa: any) => ({
                id: sa.id,
                addonId: sa.addon_id,
                price: Number(sa.price),
                available: sa.available,
                name: sa.addons?.name || 'Add-on',
                category: sa.addons?.category || null,
                priceUnit: sa.addons?.price_unit || null,
                imageUrl: sa.addons?.image_url || null,
            })),
            recentOrders: orders || [],
            ledgers: (ledgers || []).map((l: any) => ({
                id: l.id,
                orderId: l.order_id,
                orderNumber: l.orders?.order_number || l.order_id.slice(0, 8),
                orderStatus: l.orders?.status,
                grossAmount: Number(l.gross_amount),
                currency: l.currency,
                commissionPercentage: l.commission_bps !== null ? l.commission_bps / 100 : null,
                platformCommissionAmount: l.platform_commission_amount !== null ? Number(l.platform_commission_amount) : null,
                vendorNetAmount: l.vendor_net_amount !== null ? Number(l.vendor_net_amount) : null,
                financialStatus: l.financial_status,
                paidAt: l.orders?.paid_at,
                createdAt: l.created_at,
            })),
            readiness,
            customerPreview: buildShopCustomerPreview({
                shop,
                metadata: meta,
                pricingRows: pricingRows || [],
                addons: shopAddons || [],
            }),
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
 * PATCH /api/admin/vendors/[vendorId]/shops/[shopId]
 * Updates shop profile details safely without overwriting other shops:
 * - name, address, trading status (OPEN/PAUSED/CLOSED), publish state (DRAFT/PUBLISHED/ARCHIVED),
 *   hours (open_time, close_time, closing_soon, closing_message), photos, contactPhone.
 */
export async function PATCH(
    req: NextRequest,
    { params }: { params: Promise<{ userId: string; shopId: string }> }
) {
    const auth = await requireAdminAuth(req);
    if (!auth.authorized) {
        return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { userId, shopId } = await params;
    const vendorId = userId;
    if (!shopId) {
        return NextResponse.json({ error: 'Shop ID is required.' }, { status: 400 });
    }

    const sb = getServiceRoleClient();

    try {
        const body = await req.json();

        // 1. Fetch current shop row
        const { data: existingShop, error: getErr } = await sb
            .from('shops')
            .select('id, name, description, status, owner_id, open_time, close_time, closing_soon, closing_message')
            .eq('id', shopId)
            .maybeSingle();

        if (getErr || !existingShop) {
            return NextResponse.json({ error: 'Shop not found.' }, { status: 404 });
        }

        const currentMeta = parseShopProfileMetadata(existingShop.description);

        // 2. Validate & Merge fields
        const newName = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : existingShop.name;

        let newStatus = existingShop.status;
        if (body.status && ['OPEN', 'PAUSED', 'CLOSED'].includes(body.status.toUpperCase())) {
            newStatus = body.status.toUpperCase();
        }

        let newPublishStatus = currentMeta.publishStatus;
        if (body.publishStatus && ['DRAFT', 'PUBLISHED', 'ARCHIVED'].includes(body.publishStatus.toUpperCase())) {
            newPublishStatus = body.publishStatus.toUpperCase() as PublishStatus;
        }

        const newAddress = 'address' in body ? (typeof body.address === 'string' ? body.address.trim() : null) : currentMeta.address;
        const newPhotos = Array.isArray(body.photos) ? body.photos : currentMeta.photos;
        const newContactPhone = 'contactPhone' in body ? (typeof body.contactPhone === 'string' ? body.contactPhone.trim() : null) : currentMeta.contactPhone;

        const newOpenTime = 'open_time' in body ? body.open_time : existingShop.open_time;
        const newCloseTime = 'close_time' in body ? body.close_time : existingShop.close_time;
        const newClosingSoon = 'closing_soon' in body ? Boolean(body.closing_soon) : existingShop.closing_soon;
        const newClosingMessage = 'closing_message' in body ? (body.closing_message ? String(body.closing_message) : null) : existingShop.closing_message;

        // Serialize metadata envelope
        const serializedDescription = serializeShopProfileMetadata({
            address: newAddress,
            publishStatus: newPublishStatus,
            photos: newPhotos,
            contactPhone: newContactPhone,
        });

        // Check readiness guard if attempting to publish
        if (newPublishStatus === 'PUBLISHED') {
            const { data: ownerProf } = await sb
                .from('profiles')
                .select('phone')
                .eq('user_id', existingShop.owner_id)
                .maybeSingle();

            const { data: pricingRows } = await sb
                .from('shop_pricing')
                .select('paper_size, print_mode, sides, price_per_sheet, active')
                .eq('shop_id', shopId);

            const { data: activeRules } = await sb
                .from('shop_commission_rules')
                .select('*')
                .eq('shop_id', shopId)
                .eq('is_active', true);

            const activeRule = (activeRules || []).find(r => r.is_active);

            const prePublishReadiness = evaluateShopSetupReadiness({
                shop: {
                    ...existingShop,
                    name: newName,
                    status: newStatus,
                    open_time: newOpenTime,
                    close_time: newCloseTime,
                },
                metadata: {
                    address: newAddress,
                    publishStatus: newPublishStatus,
                    photos: newPhotos,
                    contactPhone: newContactPhone,
                },
                ownerPhone: ownerProf?.phone,
                pricingRows: pricingRows || [],
                activeCommissionRule: activeRule || null,
            });

            if (!prePublishReadiness.isReadyToPublish && !body.forcePublish) {
                return NextResponse.json({
                    error: `Cannot publish shop: ${prePublishReadiness.blockersCount} setup requirement(s) missing.`,
                    readiness: prePublishReadiness,
                    requiresForce: true,
                }, { status: 422 });
            }
        }

        // 3. Strictly update only this shop row
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

        const { data: updatedShop, error: updateErr } = await sb
            .from('shops')
            .update(updatePayload)
            .eq('id', shopId)
            .select('id, name, description, status, owner_id, open_time, close_time, closing_soon, closing_message, updated_at')
            .single();

        if (updateErr) throw new Error(updateErr.message);

        const updatedMeta = parseShopProfileMetadata(updatedShop.description);

        const { data: ownerProf } = await sb
            .from('profiles')
            .select('phone')
            .eq('user_id', updatedShop.owner_id)
            .maybeSingle();

        const { data: pricingRows } = await sb
            .from('shop_pricing')
            .select('paper_size, print_mode, sides, price_per_sheet, active')
            .eq('shop_id', shopId);

        const { data: activeRules } = await sb
            .from('shop_commission_rules')
            .select('*')
            .eq('shop_id', shopId)
            .eq('is_active', true);

        const activeRule = (activeRules || []).find(r => r.is_active);

        const postReadiness = evaluateShopSetupReadiness({
            shop: updatedShop,
            metadata: updatedMeta,
            ownerPhone: ownerProf?.phone,
            pricingRows: pricingRows || [],
            activeCommissionRule: activeRule || null,
        });

        return NextResponse.json({
            success: true,
            shop: {
                id: updatedShop.id,
                name: updatedShop.name,
                ownerId: updatedShop.owner_id,
                shopStatus: updatedShop.status as TradingStatus,
                publishStatus: updatedMeta.publishStatus as PublishStatus,
                address: updatedMeta.address,
                photos: updatedMeta.photos,
                contactPhone: updatedMeta.contactPhone,
                openTime: updatedShop.open_time,
                closeTime: updatedShop.close_time,
                closingSoon: Boolean(updatedShop.closing_soon),
                closingMessage: updatedShop.closing_message,
                updatedAt: updatedShop.updated_at,
            },
            readiness: postReadiness,
        }, { status: 200 });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return NextResponse.json({ error: msg }, { status: 400 });
    }
}

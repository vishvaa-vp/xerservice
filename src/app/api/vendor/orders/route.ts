import { NextRequest, NextResponse } from 'next/server';
import { getServiceRoleClient, verifyAuthToken } from '@/lib/supabase/server';
import { getOrderFileAddonSnapshots } from '@/lib/addons-service';
import { getCorsHeaders, handleCorsPreflight } from '@/lib/cors';

export const runtime = 'nodejs';

export async function OPTIONS(req: NextRequest) {
    return handleCorsPreflight(req, ['GET', 'OPTIONS']);
}

export async function GET(req: NextRequest) {
    const corsHeaders = getCorsHeaders(req, ['GET', 'OPTIONS']);
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
        .select('role')
        .eq('user_id', authUser.userId)
        .maybeSingle();

    if (profileError || !profile || profile.role !== 'vendor') {
        return fail('Forbidden: vendor privileges required.', 403);
    }

    // 3. Find Vendor-Owned Shop
    const { data: shop, error: shopError } = await serviceClient
        .from('shops')
        .select('id, name, status, closing_soon')
        .eq('owner_id', authUser.userId)
        .maybeSingle();

    if (shopError || !shop) {
        return fail('No shop assigned to this vendor account.', 404);
    }

    // 4. Load Active Queue Orders
    // Only payment_status = 'PAID' and status IN ('QUEUED', 'PRINTING', 'READY')
    // Oldest confirmed orders first (created_at ASC)
    const { data: orders, error: ordersError } = await serviceClient
        .from('orders')
        .select(`
            id,
            order_number,
            user_id,
            shop_id,
            status,
            payment_status,
            total_original_pages,
            total_printable_pages,
            total_sheets,
            total_amount,
            created_at,
            updated_at,
            paid_at,
            printing_started_at,
            ready_at,
            completed_at,
            order_files (
                id,
                original_filename,
                mime_type,
                file_size_bytes,
                original_pages,
                printable_pages,
                physical_sheets,
                print_settings (
                    colour_mode,
                    sides,
                    orientation,
                    copies,
                    pages_per_sheet,
                    paper_size,
                    margin,
                    page_selection,
                    page_range,
                    scale,
                    include_filename_page_numbers
                )
            )
        `)
        .eq('shop_id', shop.id)
        .eq('payment_status', 'PAID')
        .in('status', ['QUEUED', 'PRINTING', 'READY'])
        .order('created_at', { ascending: true });

    if (ordersError) {
        console.error('[VendorOrders] Error fetching queue orders:', ordersError);
        return fail('Failed to fetch active queue orders.', 500);
    }

    // 5. Fetch minimal customer profile info (full_name only) for the order owners
    const userIds = Array.from(new Set((orders || []).map(o => o.user_id).filter(Boolean)));
    const userProfilesMap: Record<string, { full_name: string | null }> = {};

    if (userIds.length > 0) {
        const { data: customerProfiles } = await serviceClient
            .from('profiles')
            .select('user_id, full_name')
            .in('user_id', userIds);

        if (customerProfiles) {
            for (const cp of customerProfiles) {
                userProfilesMap[cp.user_id] = { full_name: cp.full_name };
            }
        }
    }

    // 5b. Identify orders with active cancellation/refund requests
    const orderIds = (orders || []).map(o => o.id);
    const activeRefundMap = new Set<string>();

    if (orderIds.length > 0) {
        try {
            const { data: activeRefunds } = await serviceClient
                .from('refund_requests')
                .select('order_id')
                .in('order_id', orderIds)
                .in('status', ['PENDING', 'PROCESSING']);

            if (activeRefunds) {
                for (const r of activeRefunds) {
                    activeRefundMap.add(r.order_id);
                }
            }
        } catch {
            // Table may not exist pre-push
        }
    }

    // 6. Map orders with minimal customer info and file add-ons
    const enrichedOrders = await Promise.all((orders || []).map(async order => {
        let addonSnapshots: any[] = [];
        try {
            addonSnapshots = await getOrderFileAddonSnapshots(order.id);
        } catch {
            throw new Error('Finishing requirements could not be loaded. Retry before printing.');
        }

        const filesWithAddons = (order.order_files || []).map((file: any) => ({
            ...file,
            addons: addonSnapshots.filter(a => a.orderFileId === file.id),
        }));

        return {
            ...order,
            order_files: filesWithAddons,
            customerName: userProfilesMap[order.user_id]?.full_name || 'Customer',
            has_active_refund: activeRefundMap.has(order.id),
        };
    })).catch(() => null);
    if (!enrichedOrders) return fail('Could not load finishing requirements. Please retry.', 503);

    return NextResponse.json({
        shop: {
            id: shop.id,
            name: shop.name,
            status: shop.status,
            closing_soon: shop.closing_soon,
        },
        orders: enrichedOrders,
    }, { status: 200, headers });
}

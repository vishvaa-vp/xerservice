import { NextRequest, NextResponse } from 'next/server';
import { getServiceRoleClient, verifyCustomerToken } from '@/lib/supabase/server';

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
        authUser = await verifyCustomerToken(token);
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return fail(`Authentication failed: ${msg}`, 401);
    }

    if (!authUser || !authUser.userId) {
        return fail('Session invalid or expired. Please sign in again.', 401);
    }

    const serviceClient = getServiceRoleClient();
    const nowIso = new Date().toISOString();

    // 2. Query Orders strictly for the authenticated customer
    // Rules:
    // - Non-draft placed orders (AWAITING_PAYMENT, QUEUED, PRINTING, READY, COMPLETED, CANCELLED) always returned
    // - DRAFT orders returned ONLY if active and not expired (expires_at > now())
    // - Do not download Storage file contents (only metadata: filename, pages, print settings, history)
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
            expires_at,
            created_at,
            updated_at,
            paid_at,
            printing_started_at,
            ready_at,
            completed_at,
            cancelled_at,
            shops (
                id,
                name,
                status,
                closing_soon
            ),
            order_files (
                id,
                original_filename,
                mime_type,
                file_size_bytes,
                original_pages,
                printable_pages,
                physical_sheets,
                unit_price,
                line_total,
                created_at,
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
            ),
            order_status_history (
                id,
                from_status,
                to_status,
                changed_by,
                created_at
            )
        `)
        .eq('user_id', authUser.userId)
        .or(`status.neq.DRAFT,expires_at.gt.${nowIso}`)
        .order('created_at', { ascending: false });

    if (ordersError) {
        console.error('[Customer Orders API] Failed to fetch orders:', ordersError);
        return fail('Failed to fetch orders.', 500);
    }

    const now = Date.now();

    // 3. Defensive in-memory filter: exclude any expired drafts
    const validOrders = (orders || []).filter((order) => {
        if (order.status === 'DRAFT') {
            const exp = new Date(order.expires_at).getTime();
            return Number.isFinite(exp) && exp > now;
        }
        return true;
    });

    // 4. Format response and ensure status history is ordered chronologically
    const formattedOrders = validOrders.map((order) => {
        const history = Array.isArray(order.order_status_history)
            ? [...order.order_status_history].sort(
                (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
            )
            : [];

        const shop = Array.isArray(order.shops) ? order.shops[0] : order.shops;
        const files = Array.isArray(order.order_files) ? order.order_files : [];

        return {
            ...order,
            shop: shop || null,
            order_files: files,
            order_status_history: history,
        };
    });

    return NextResponse.json({ orders: formattedOrders }, { headers });
}

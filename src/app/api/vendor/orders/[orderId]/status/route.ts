import { NextRequest, NextResponse } from 'next/server';
import { getServiceRoleClient, verifyAuthToken } from '@/lib/supabase/server';
import { createNotification } from '@/lib/notifications';
import { markOrderLedgerPayable } from '@/lib/vendor-ledger';
import { getCorsHeaders, handleCorsPreflight } from '@/lib/cors';

export const runtime = 'nodejs';

export async function OPTIONS(req: NextRequest) {
    return handleCorsPreflight(req, ['POST', 'OPTIONS']);
}

export async function POST(
    req: NextRequest,
    context: { params: Promise<{ orderId: string }> }
) {
    const corsHeaders = getCorsHeaders(req, ['POST', 'OPTIONS']);
    const headers: Record<string, string> = {
        'Cache-Control': 'no-store',
        ...corsHeaders,
    };
    const fail = (error: string, status = 400) =>
        NextResponse.json({ error }, { status, headers });

    const { orderId } = await context.params;
    if (!orderId) {
        return fail('Missing orderId parameter.', 400);
    }

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

    // 2. Parse Request Body
    let body;
    try {
        body = await req.json();
    } catch {
        return fail('Invalid request body.', 400);
    }

    const { expectedStatus, newStatus } = body || {};
    if (!expectedStatus || !newStatus) {
        return fail('Missing required parameters: expectedStatus and newStatus are required.', 400);
    }

    // 3. Strict State Machine Validation
    // Allowed transitions:
    //   QUEUED -> PRINTING
    //   PRINTING -> READY
    //   READY -> COMPLETED
    const isLegalTransition =
        (expectedStatus === 'QUEUED' && newStatus === 'PRINTING') ||
        (expectedStatus === 'PRINTING' && newStatus === 'READY') ||
        (expectedStatus === 'READY' && newStatus === 'COMPLETED');

    if (!isLegalTransition) {
        return fail(
            `Illegal status transition requested: "${expectedStatus}" -> "${newStatus}". ` +
            `Permitted transitions: QUEUED -> PRINTING, PRINTING -> READY, READY -> COMPLETED.`,
            400
        );
    }

    const serviceClient = getServiceRoleClient();

    // 4. Verify Vendor Role
    const { data: profile, error: profileError } = await serviceClient
        .from('profiles')
        .select('role')
        .or(`id.eq.${authUser.userId},user_id.eq.${authUser.userId}`)
        .maybeSingle();

    if (profileError || !profile || profile.role !== 'vendor') {
        return fail('Forbidden: vendor privileges required.', 403);
    }

    // 5. Verify Order & Shop Ownership
    const { data: order, error: orderError } = await serviceClient
        .from('orders')
        .select(`
            id,
            order_number,
            user_id,
            shop_id,
            status,
            payment_status,
            shops (
                id,
                owner_id
            )
        `)
        .eq('id', orderId)
        .maybeSingle();

    if (orderError || !order) {
        return fail('Order not found.', 404);
    }

    const shop = Array.isArray(order.shops) ? order.shops[0] : order.shops;
    if (!shop || shop.owner_id !== authUser.userId) {
        return fail('Forbidden: you do not own the shop associated with this order.', 403);
    }

    if (order.payment_status !== 'PAID') {
        return fail('Forbidden: order must be PAID before processing.', 403);
    }

    if (order.status !== expectedStatus) {
        return fail(`Conflict: current order status is "${order.status}", expected "${expectedStatus}".`, 409);
    }

    // Guard against active cancellation/refund before transitioning QUEUED -> PRINTING
    if (expectedStatus === 'QUEUED' && newStatus === 'PRINTING') {
        try {
            const { data: activeRefund } = await serviceClient
                .from('refund_requests')
                .select('id, status')
                .eq('order_id', orderId)
                .in('status', ['PENDING', 'PROCESSING'])
                .maybeSingle();

            if (activeRefund) {
                return fail('Order cancellation/refund is already in progress.', 409);
            }
        } catch {
            // Table may not exist pre-push
        }
    }

    // 6. Execute Transition via Database RPC Exclusively (Zero Fallback)
    try {
        const { data: rpcResult, error: rpcError } = await serviceClient.rpc(
            'transition_vendor_order_status',
            {
                p_order_id: orderId,
                p_expected_status: expectedStatus,
                p_new_status: newStatus,
            }
        );

        if (rpcError || !rpcResult) {
            console.error('[VendorStatus] Database RPC error:', rpcError);
            const errorMsg = rpcError?.message || 'Database error during status transition.';

            if (errorMsg.includes('already in progress')) {
                return fail(errorMsg, 409);
            }

            // If the RPC is not installed on the database, fail cleanly with 500 server error
            if (rpcError?.code === 'PGRST202') {
                return fail(
                    'Order status transition RPC is not installed on the database. Please apply migration 20260909050000_create_vendor_status_rpc.sql.',
                    500
                );
            }

            return fail(errorMsg, 400);
        }

        // In-app notifications to customer on status progress
        try {
            const orderShortId = order.order_number || orderId.slice(0, 8);
            if (newStatus === 'PRINTING') {
                await createNotification({
                    userId: order.user_id,
                    orderId: order.id,
                    shopId: order.shop_id,
                    type: 'PRINTING_STARTED',
                    title: 'Printing Started',
                    message: `Your order #${orderShortId} is now being printed.`,
                    metadata: { order_id: order.id, order_number: orderShortId },
                    dedupeKey: `printing-started:${order.id}`,
                });
            } else if (newStatus === 'READY') {
                await createNotification({
                    userId: order.user_id,
                    orderId: order.id,
                    shopId: order.shop_id,
                    type: 'ORDER_READY',
                    title: 'Ready for Pickup',
                    message: `Your order #${orderShortId} is ready for pickup!`,
                    metadata: { order_id: order.id, order_number: orderShortId },
                    dedupeKey: `ready:${order.id}`,
                });
            } else if (newStatus === 'COMPLETED') {
                await createNotification({
                    userId: order.user_id,
                    orderId: order.id,
                    shopId: order.shop_id,
                    type: 'ORDER_COMPLETED',
                    title: 'Order Completed',
                    message: `Your order #${orderShortId} has been completed. Thank you!`,
                    metadata: { order_id: order.id, order_number: orderShortId },
                    dedupeKey: `completed:${order.id}`,
                });
            }
        } catch (notifErr) {
            console.error('[VendorStatus] Notification error on status transition:', notifErr);
        }

        // Phase 6J: If order completed, mark vendor ledger entry as PAYABLE
        if (newStatus === 'COMPLETED') {
            try {
                await markOrderLedgerPayable(orderId);
            } catch (ledgerErr) {
                console.warn('[VendorStatus] Non-blocking markOrderLedgerPayable error:', ledgerErr);
            }
        }

        return NextResponse.json({
            success: true,
            order: rpcResult,
        }, { status: 200, headers });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[VendorStatus] Exception during status transition:', msg);
        return fail(`Status transition failed: ${msg}`, 500);
    }
}

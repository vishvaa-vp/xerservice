import { NextRequest, NextResponse } from 'next/server';
import { getServiceRoleClient, verifyAuthToken } from '@/lib/supabase/server';
import { createRazorpayRefund } from '@/lib/razorpay';
import { createNotification } from '@/lib/notifications';
import { markReceiptRefunded } from '@/lib/receipts';
import { reverseOrderLedger } from '@/lib/vendor-ledger';

export const runtime = 'nodejs';

interface RouteContext {
    params: Promise<{
        orderId: string;
    }>;
}

export async function POST(req: NextRequest, context: RouteContext) {
    const headers = { 'Cache-Control': 'no-store' };
    const fail = (error: string, status = 400, extra: Record<string, any> = {}) =>
        NextResponse.json({ error, ...extra }, { status, headers });

    const { orderId } = await context.params;
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!orderId || !uuidRegex.test(orderId)) {
        return fail('Invalid order ID.', 400);
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
    let body: { reason?: string } = {};
    try {
        body = await req.json();
    } catch {
        // Body is required for vendor cancellation
    }

    const reason = (body?.reason || '').trim();
    if (!reason) {
        return fail('Cancellation reason is required for vendor cancellations (e.g., "Paper Out", "Machine Maintenance").', 400);
    }

    const serviceClient = getServiceRoleClient();
    const nowIso = new Date().toISOString();

    // 3. Verify Vendor Role
    const { data: profile, error: profileError } = await serviceClient
        .from('profiles')
        .select('role')
        .eq('user_id', authUser.userId)
        .maybeSingle();

    if (profileError || !profile || profile.role !== 'vendor') {
        return fail('Forbidden: vendor privileges required.', 403);
    }

    // 4. Load Order & Verify Shop Ownership
    const { data: order, error: orderError } = await serviceClient
        .from('orders')
        .select(`
            id,
            order_number,
            user_id,
            shop_id,
            status,
            payment_status,
            total_amount,
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

    // 5. Strict Vendor State Machine Validation
    if (order.status === 'CANCELLED') {
        return fail('This order has already been cancelled.', 400);
    }

    if (order.status !== 'QUEUED') {
        return fail(
            `Vendors can only cancel orders in QUEUED status before printing begins. Current order status is "${order.status}".`,
            400
        );
    }

    if (order.payment_status !== 'PAID') {
        return fail(`Cannot process cancellation for order with payment status "${order.payment_status}". Must be PAID.`, 400);
    }

    // 6. Find Authoritative Successful Payment Attempt
    const { data: attempt, error: attemptError } = await serviceClient
        .from('payment_attempts')
        .select('id, provider, amount, razorpay_payment_id, status')
        .eq('order_id', orderId)
        .eq('status', 'PAID')
        .order('paid_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (attemptError || !attempt) {
        console.error('[VendorCancel] No paid payment attempt found for queued order:', attemptError);
        return fail('Unable to identify original payment method for refund. Please contact support.', 500);
    }

    // 7a. XerCoins Wallet Refund Flow (Atomic Postgres RPC)
    if (attempt.provider === 'XERCOINS') {
        const idempotencyKey = `refund:vendor:xercoins:${orderId}`;

        try {
            const { data: rpcResult, error: rpcError } = await serviceClient.rpc(
                'refund_xercoins_order',
                {
                    p_order_id: orderId,
                    p_requested_by: authUser.userId,
                    p_role: 'VENDOR',
                    p_reason: `Vendor Cancellation: ${reason}`,
                    p_idempotency_key: idempotencyKey,
                }
            );

            if (rpcError) {
                console.error('[VendorCancel] XerCoins refund RPC error:', rpcError);
                if (rpcError.message?.includes('already in progress') || rpcError.message?.includes('already being processed')) {
                    return fail('Order cancellation/refund is already in progress.', 409);
                }
                if (rpcError.message?.includes('already been refunded') || rpcError.message?.includes('already CANCELLED')) {
                    return fail('Order has already been refunded.', 400);
                }
                return fail(`Refund failed: ${rpcError.message}`, 500);
            }

            const resObj = typeof rpcResult === 'string' ? JSON.parse(rpcResult) : rpcResult;
            const refAmount = Number(resObj?.amount_refunded || order.total_amount);
            const orderShortId = order.order_number || order.id.slice(0, 8);

            // In-app notifications for customer and vendor
            try {
                // 1. Customer: ORDER_CANCELLED
                await createNotification({
                    userId: order.user_id,
                    orderId: order.id,
                    shopId: order.shop_id,
                    type: 'ORDER_CANCELLED',
                    title: 'Order Cancelled by Shop',
                    message: `Order #${orderShortId} was cancelled by the shop (${reason}). ₹${refAmount.toFixed(2)} refunded to your XerCoins wallet.`,
                    metadata: { order_id: order.id, order_number: orderShortId, amount: refAmount, provider: 'XERCOINS', reason },
                    dedupeKey: `order-cancelled:${order.id}`,
                });

                // 2. Customer: REFUND_SUCCESS
                await createNotification({
                    userId: order.user_id,
                    orderId: order.id,
                    shopId: order.shop_id,
                    type: 'REFUND_SUCCESS',
                    title: 'Refund Processed (XerCoins)',
                    message: `₹${refAmount.toFixed(2)} refunded to your XerCoins wallet for order #${orderShortId}.`,
                    metadata: { order_id: order.id, order_number: orderShortId, amount: refAmount, provider: 'XERCOINS' },
                    dedupeKey: `refund-success:${order.id}`,
                });

                // 3. Vendor: ORDER_CANCELLED
                await createNotification({
                    userId: authUser.userId,
                    orderId: order.id,
                    shopId: order.shop_id,
                    type: 'ORDER_CANCELLED',
                    title: 'Order Cancelled',
                    message: `You cancelled order #${orderShortId}. Customer refunded ₹${refAmount.toFixed(2)} via XerCoins.`,
                    metadata: { order_id: order.id, order_number: orderShortId, reason },
                    dedupeKey: `vendor-order-cancelled:${order.id}`,
                });
            } catch (notifErr) {
                console.error('[VendorCancel] Notification error on XerCoins cancel:', notifErr);
            }

            // Phase 6I: Update order receipt to REFUNDED
            try {
                await markReceiptRefunded(order.id);
            } catch (rcptErr) {
                console.warn('[VendorCancel] Non-blocking receipt refund update error:', rcptErr);
            }

            // Phase 6J: Reversal on XerCoins refund
            try {
                await reverseOrderLedger(
                    order.id,
                    `Vendor Cancellation: ${reason}`,
                    resObj?.refund_id,
                    new Date().toISOString()
                );
            } catch (ledgerErr) {
                console.warn('[VendorCancel] Non-blocking ledger reversal error:', ledgerErr);
            }

            return NextResponse.json({
                success: true,
                orderId: order.id,
                orderNumber: order.order_number,
                status: 'CANCELLED',
                paymentStatus: 'REFUNDED',
                refund: {
                    provider: 'XERCOINS',
                    amount: refAmount,
                    destination: 'Customer XerCoins Wallet',
                    status: 'SUCCEEDED',
                },
                message: `Order #${order.order_number} cancelled by vendor. Customer has been refunded ₹${refAmount.toFixed(2)} in XerCoins.`,
            }, { status: 200, headers });
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error('[VendorCancel] XerCoins refund exception:', msg);
            return fail(`Refund exception: ${msg}`, 500);
        }
    }

    // 7b. Razorpay Gateway Refund Flow
    if (attempt.provider === 'RAZORPAY') {
        const razorpayPaymentId = attempt.razorpay_payment_id;
        if (!razorpayPaymentId) {
            return fail('Missing Razorpay payment reference. Cannot issue gateway refund.', 400);
        }

        const refundAmount = Number(attempt.amount || order.total_amount);
        if (refundAmount <= 0) {
            return fail('Invalid payment attempt amount. Cannot issue refund.', 400);
        }
        const amountPaise = Math.round(refundAmount * 100);
        const idempotencyKey = `refund:vendor:razorpay:${orderId}`;

        // Phase 1: Atomically register PROCESSING refund_request BEFORE external gateway call
        let refundRecordId: string | null = null;

        const { data: initResult, error: initError } = await serviceClient.rpc(
            'initiate_order_refund_request',
            {
                p_order_id: orderId,
                p_requested_by: authUser.userId,
                p_role: 'VENDOR',
                p_reason: `Vendor Cancellation: ${reason}`,
                p_idempotency_key: idempotencyKey,
            }
        );

        if (initError) {
            if (initError.message?.includes('already being processed') || initError.message?.includes('already in progress')) {
                return fail('Refund is already being processed for this order.', 409);
            }
            if (initError.message?.includes('already been refunded') || initError.message?.includes('already cancelled')) {
                return fail('This order has already been cancelled or refunded.', 400);
            }
            if (initError.message?.includes('Cannot cancel and refund order in')) {
                return fail(initError.message, 400);
            }

            // Fallback for pre-push table access
            if (initError.code === 'PGRST202') {
                try {
                    const { data: existingRefund } = await serviceClient
                        .from('refund_requests')
                        .select('id, status, provider_refund_id')
                        .eq('order_id', orderId)
                        .in('status', ['PENDING', 'PROCESSING', 'SUCCEEDED'])
                        .maybeSingle();

                    if (existingRefund) {
                        if (existingRefund.status === 'SUCCEEDED') {
                            return fail('This order has already been refunded.', 400);
                        }
                        return fail('Refund is already being processed for this order.', 409);
                    }

                    const { data: newRef, error: insertRefErr } = await serviceClient
                        .from('refund_requests')
                        .insert({
                            order_id: orderId,
                            user_id: order.user_id,
                            payment_attempt_id: attempt.id,
                            provider: 'RAZORPAY',
                            amount: refundAmount,
                            status: 'PROCESSING',
                            reason: `Vendor Cancellation: ${reason}`,
                            requested_by: authUser.userId,
                            requested_by_role: 'VENDOR',
                            idempotency_key: idempotencyKey,
                        })
                        .select('id')
                        .maybeSingle();

                    if (insertRefErr) {
                        if (insertRefErr.code === '23505') {
                            return fail('Refund is already being processed for this order.', 409);
                        }
                        console.error('[VendorCancel] Error inserting refund_requests:', insertRefErr);
                    } else {
                        refundRecordId = newRef?.id || null;
                    }
                } catch (e) {
                    console.warn('[VendorCancel] Pre-push fallback for refund_requests:', e);
                }
            } else {
                return fail(`Failed to initiate refund: ${initError.message}`, 500);
            }
        } else {
            const initObj = typeof initResult === 'string' ? JSON.parse(initResult) : initResult;
            refundRecordId = initObj?.refund_request_id || null;
        }

        // Phase 2: Call authoritative Razorpay refund API
        let rzpRefund;
        try {
            rzpRefund = await createRazorpayRefund(razorpayPaymentId, {
                amountPaise,
                notes: {
                    order_id: orderId,
                    order_number: order.order_number,
                    vendor_id: authUser.userId,
                    reason,
                },
                receipt: `rcpt_vnd_${order.order_number}`,
            });
        } catch (rzpErr: unknown) {
            const errorMsg = rzpErr instanceof Error ? rzpErr.message : String(rzpErr);
            console.error('[VendorCancel] Razorpay refund API dispatch error:', errorMsg);

            // Distinguish ambiguous network failure from deterministic provider rejection
            const isNetworkError =
                errorMsg.toLowerCase().includes('network') ||
                errorMsg.toLowerCase().includes('timeout') ||
                errorMsg.toLowerCase().includes('econnrefused') ||
                errorMsg.toLowerCase().includes('fetch failed') ||
                errorMsg.toLowerCase().includes('econnreset') ||
                errorMsg.toLowerCase().includes('socket');

            if (isNetworkError) {
                // KEEP status = 'PROCESSING'. Do NOT send another refund. Await webhook reconciliation.
                if (refundRecordId) {
                    await serviceClient
                        .from('refund_requests')
                        .update({
                            status: 'PROCESSING',
                            failure_reason: `Network timeout during gateway dispatch: ${errorMsg}. Awaiting webhook reconciliation.`,
                            updated_at: new Date().toISOString(),
                        })
                        .eq('id', refundRecordId);
                }

                return NextResponse.json({
                    success: false,
                    status: 'PROCESSING',
                    orderId: order.id,
                    orderNumber: order.order_number,
                    error: 'Refund dispatch timed out. The refund is currently PROCESSING and will be reconciled via gateway webhook.',
                }, { status: 504, headers });
            }

            // Deterministic gateway rejection
            if (refundRecordId) {
                await serviceClient
                    .from('refund_requests')
                    .update({
                        status: 'FAILED',
                        failure_reason: errorMsg,
                        updated_at: new Date().toISOString(),
                    })
                    .eq('id', refundRecordId);
            }

            return fail(`Payment gateway refund rejected: ${errorMsg}. Order remains queued.`, 400);
        }

        // Phase 3: Synchronize refund status based on gateway confirmation
        const isRefundSucceeded = rzpRefund?.status === 'processed';

        if (refundRecordId) {
            await serviceClient
                .from('refund_requests')
                .update({
                    status: isRefundSucceeded ? 'SUCCEEDED' : 'PROCESSING',
                    provider_refund_id: rzpRefund.id,
                    completed_at: isRefundSucceeded ? new Date().toISOString() : null,
                    updated_at: new Date().toISOString(),
                })
                .eq('id', refundRecordId);
        }

        await serviceClient
            .from('payment_attempts')
            .update({
                status: 'REFUNDED',
                updated_at: new Date().toISOString(),
            })
            .eq('id', attempt.id);

        const orderCancelPayload: Record<string, any> = {
            status: 'CANCELLED',
            payment_status: 'REFUNDED',
            cancelled_at: nowIso,
            updated_at: nowIso,
            cancelled_by: authUser.userId,
            cancellation_reason: `Vendor: ${reason}`,
        };

        let { error: orderCancelErr } = await serviceClient
            .from('orders')
            .update(orderCancelPayload)
            .eq('id', orderId);

        if (orderCancelErr && (orderCancelErr.message?.includes('cancelled_by') || orderCancelErr.message?.includes('cancellation_reason'))) {
            delete orderCancelPayload.cancelled_by;
            delete orderCancelPayload.cancellation_reason;
            const retry = await serviceClient.from('orders').update(orderCancelPayload).eq('id', orderId);
            orderCancelErr = retry.error;
        }

        if (orderCancelErr) {
            console.error('[VendorCancel] Error updating order to CANCELLED after refund:', orderCancelErr);
        }

        // Phase 6I: Update order receipt to REFUNDED only upon authoritative refund success
        if (isRefundSucceeded) {
            try {
                await markReceiptRefunded(orderId, nowIso);
            } catch (rcptErr) {
                console.warn('[VendorCancel] Non-blocking receipt refund update error:', rcptErr);
            }

            // Phase 6J: Reversal on Razorpay refund
            try {
                await reverseOrderLedger(
                    orderId,
                    `Vendor Cancellation: ${reason}`,
                    refundRecordId,
                    new Date().toISOString()
                );
            } catch (ledgerErr) {
                console.warn('[VendorCancel] Non-blocking ledger reversal error:', ledgerErr);
            }
        }

        // In-app notifications for customer and vendor
        try {
            const orderShortId = order.order_number || order.id.slice(0, 8);

            // 1. Customer: ORDER_CANCELLED
            await createNotification({
                userId: order.user_id,
                orderId: order.id,
                shopId: order.shop_id,
                type: 'ORDER_CANCELLED',
                title: 'Order Cancelled by Shop',
                message: isRefundSucceeded
                    ? `Order #${orderShortId} was cancelled by the shop (${reason}). A refund of ₹${refundAmount.toFixed(2)} has been completed.`
                    : `Order #${orderShortId} was cancelled by the shop (${reason}). Your refund is being processed.`,
                metadata: {
                    order_id: order.id,
                    order_number: orderShortId,
                    amount: refundAmount,
                    provider: 'RAZORPAY',
                    reason,
                    refund_status: isRefundSucceeded ? 'SUCCEEDED' : 'PROCESSING',
                },
                dedupeKey: `order-cancelled:${order.id}`,
            });

            // 2. Customer: REFUND_SUCCESS - ONLY if gateway confirmed processed!
            if (isRefundSucceeded) {
                await createNotification({
                    userId: order.user_id,
                    orderId: order.id,
                    shopId: order.shop_id,
                    type: 'REFUND_SUCCESS',
                    title: 'Refund Processed',
                    message: `Your refund of ₹${refundAmount.toFixed(2)} for order #${orderShortId} has been processed successfully.`,
                    metadata: {
                        order_id: order.id,
                        order_number: orderShortId,
                        amount: refundAmount,
                        refund_id: rzpRefund.id,
                    },
                    dedupeKey: `refund-success:${order.id}`,
                });
            }

            // 3. Vendor: ORDER_CANCELLED
            await createNotification({
                userId: authUser.userId,
                orderId: order.id,
                shopId: order.shop_id,
                type: 'ORDER_CANCELLED',
                title: 'Order Cancelled',
                message: `You cancelled order #${orderShortId}. Refund of ₹${refundAmount.toFixed(2)} initiated to customer.`,
                metadata: { order_id: order.id, order_number: orderShortId, reason },
                dedupeKey: `vendor-order-cancelled:${order.id}`,
            });
        } catch (notifErr) {
            console.error('[VendorCancel] Notification error on Razorpay cancel:', notifErr);
        }

        return NextResponse.json({
            success: true,
            orderId: order.id,
            orderNumber: order.order_number,
            status: 'CANCELLED',
            paymentStatus: 'REFUNDED',
            refund: {
                provider: 'RAZORPAY',
                refundId: rzpRefund.id,
                amount: refundAmount,
                status: 'SUCCEEDED',
            },
            message: `Order #${order.order_number} cancelled. Refund of ₹${refundAmount.toFixed(2)} initiated to customer.`,
        }, { status: 200, headers });
    }

    return fail(`Unknown payment provider: ${attempt.provider}`, 400);
}

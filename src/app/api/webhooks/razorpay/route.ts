import { NextRequest, NextResponse } from 'next/server';
import { getServiceRoleClient } from '@/lib/supabase/server';
import { verifyWebhookSignature, mapRazorpayPaymentMethod, fetchRazorpayPayment, createRazorpayRefund } from '@/lib/razorpay';
import { createNotification } from '@/lib/notifications';
import { getOrCreateOrderReceipt, markReceiptRefunded } from '@/lib/receipts';
import { createOrInitOrderLedger, reverseOrderLedger } from '@/lib/vendor-ledger';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
    const headers = { 'Cache-Control': 'no-store' };

    // 1. Read Raw Request Body for Cryptographic Signature Verification
    const rawBody = await req.text();
    const signature = req.headers.get('x-razorpay-signature');

    if (!signature) {
        return NextResponse.json({ error: 'Missing X-Razorpay-Signature header.' }, { status: 400, headers });
    }

    let isSignatureValid = false;
    try {
        isSignatureValid = verifyWebhookSignature(rawBody, signature);
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[Webhook] Signature verification error:', msg);
        return NextResponse.json({ error: 'Webhook configuration error.' }, { status: 500, headers });
    }

    if (!isSignatureValid) {
        console.warn('[Webhook] Invalid signature received from IP:', req.headers.get('x-forwarded-for') || 'unknown');
        return NextResponse.json({ error: 'Invalid webhook signature.' }, { status: 400, headers });
    }

    // 2. Parse Event JSON
    let eventPayload;
    try {
        eventPayload = JSON.parse(rawBody);
    } catch {
        return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400, headers });
    }

    const eventType = eventPayload?.event as string;
    const eventId =
        req.headers.get('x-razorpay-event-id') ||
        eventPayload?.event_id ||
        eventPayload?.id;

    if (!eventId || !eventType) {
        return NextResponse.json({ error: 'Malformed webhook event structure.' }, { status: 400, headers });
    }

    const serviceClient = getServiceRoleClient();

    // 3. Webhook Idempotency Check
    const { data: existingEvent } = await serviceClient
        .from('payment_webhook_events')
        .select('id, processed_at')
        .eq('event_id', eventId)
        .maybeSingle();

    if (existingEvent) {
        console.log(`[Webhook] Event ${eventId} (${eventType}) was already processed at ${existingEvent.processed_at}. Acknowledging.`);
        return NextResponse.json({ status: 'ok', message: 'Event already processed.' }, { status: 200, headers });
    }

    // Record Event in Webhook Events Log
    const { error: insertEventError } = await serviceClient
        .from('payment_webhook_events')
        .insert({
            provider: 'RAZORPAY',
            event_id: eventId,
            event_type: eventType,
        });

    if (insertEventError) {
        // In case of a concurrent duplicate insert
        if (insertEventError.code === '23505') {
            return NextResponse.json({ status: 'ok', message: 'Concurrent event already logged.' }, { status: 200, headers });
        }
        console.error('[Webhook] Failed to insert payment_webhook_events:', insertEventError);
    }

    // 4. Handle Specific Event Types
    const paymentEntity = eventPayload.payload?.payment?.entity;
    const orderEntity = eventPayload.payload?.order?.entity;

    const rzpOrderId = paymentEntity?.order_id || orderEntity?.id;
    const rzpPaymentId = paymentEntity?.id;
    const amountPaise = paymentEntity?.amount || orderEntity?.amount;
    const currency = paymentEntity?.currency || orderEntity?.currency;

    if (eventType === 'payment.captured' || eventType === 'order.paid') {
        if (!rzpOrderId) {
            console.warn(`[Webhook] Missing order_id in ${eventType} payload.`);
            return NextResponse.json({ status: 'ok', warning: 'Missing order_id' }, { status: 200, headers });
        }

        // Validate Currency
        if (currency !== 'INR') {
            console.error(`[Webhook] Unexpected currency "${currency}" received for order ${rzpOrderId}`);
            return NextResponse.json({ error: `Currency ${currency} not supported.` }, { status: 400, headers });
        }

        // Find Payment Attempt
        const { data: attempt, error: attemptError } = await serviceClient
            .from('payment_attempts')
            .select('id, order_id, amount, currency, status, paid_at, razorpay_payment_id')
            .eq('razorpay_order_id', rzpOrderId)
            .maybeSingle();

        if (attemptError || !attempt) {
            console.error(`[Webhook] No payment_attempts found for razorpay_order_id ${rzpOrderId}`);
            return NextResponse.json({ status: 'ok', warning: 'Payment attempt not found' }, { status: 200, headers });
        }

        // Validate Amount Match (Paise vs Rupees)
        const expectedPaise = Math.round(Number(attempt.amount) * 100);
        if (amountPaise !== expectedPaise) {
            console.error(`[Webhook] Amount mismatch for ${rzpOrderId}: expected ${expectedPaise} paise, received ${amountPaise} paise`);
            return NextResponse.json({ error: 'Amount mismatch between gateway and database attempt.' }, { status: 400, headers });
        }

        // Atomically Transition payment_attempts to PAID (Idempotent)
        const nowIso = new Date().toISOString();
        const effectivePaidAt = attempt.paid_at || nowIso;
        const effectivePaymentId = rzpPaymentId || attempt.razorpay_payment_id;

        // Extract trusted payment method from payment entity or server fetch
        let trustedMethod: string | null = null;
        if (paymentEntity?.method) {
            trustedMethod = mapRazorpayPaymentMethod(paymentEntity.method);
        } else if (effectivePaymentId) {
            // If event is order.paid without paymentEntity.method, securely fetch the payment server-side
            const fetchedPayment = await fetchRazorpayPayment(effectivePaymentId);
            if (fetchedPayment?.method) {
                trustedMethod = mapRazorpayPaymentMethod(fetchedPayment.method);
            }
        }

        const finalMethod = trustedMethod || (attempt as any).payment_method || null;

        // Check if the order was already paid via another provider (XERCOINS)
        const { data: walletPayment } = await serviceClient
            .from('payment_attempts')
            .select('id, provider, status, paid_at')
            .eq('order_id', attempt.order_id)
            .eq('provider', 'XERCOINS')
            .eq('status', 'PAID')
            .maybeSingle();

        if (walletPayment) {
            console.error(
                `[Webhook Conflict] CRITICAL: Order ${attempt.order_id} was already paid via XERCOINS at ${walletPayment.paid_at}. ` +
                `Incoming Razorpay ${eventType} (payment ${effectivePaymentId}, amount ₹${amountPaise / 100}) detected as dual-payment conflict! ` +
                `Preserving original wallet payment. Razorpay payment attempt ${attempt.id} flagged for reconciliation/refund.`
            );

            const conflictPayload: Record<string, any> = {
                razorpay_payment_id: effectivePaymentId,
                status: 'AUTHORIZED',
                updated_at: nowIso,
            };
            if (finalMethod) {
                conflictPayload.payment_method = finalMethod;
            }

            let { error: conflictError } = await serviceClient
                .from('payment_attempts')
                .update(conflictPayload)
                .eq('id', attempt.id);

            if (conflictError && (conflictError.code === 'PGRST204' || conflictError.message?.includes('payment_method'))) {
                delete conflictPayload.payment_method;
                await serviceClient.from('payment_attempts').update(conflictPayload).eq('id', attempt.id);
            }

            // Return 200 with conflict flag to acknowledge webhook without double-queuing order
            return NextResponse.json({
                status: 'ok',
                conflict: true,
                warning: 'DUAL_PAYMENT_CONFLICT',
                message: 'Order was already paid via XerCoins. Razorpay transaction requires manual reconciliation/refund.',
                orderId: attempt.order_id,
                walletPaymentAttemptId: walletPayment.id,
                razorpayPaymentId: effectivePaymentId,
            }, { status: 200, headers });
        }

        const updatePayload: Record<string, any> = {
            status: 'PAID',
            razorpay_payment_id: effectivePaymentId,
            paid_at: effectivePaidAt,
            updated_at: nowIso,
        };
        if (finalMethod) {
            updatePayload.payment_method = finalMethod;
        }

        let { error: updateAttemptError } = await serviceClient
            .from('payment_attempts')
            .update(updatePayload)
            .eq('id', attempt.id);

        if (updateAttemptError && (updateAttemptError.code === 'PGRST204' || updateAttemptError.message?.includes('payment_method'))) {
            delete updatePayload.payment_method;
            const retry = await serviceClient
                .from('payment_attempts')
                .update(updatePayload)
                .eq('id', attempt.id);
            updateAttemptError = retry.error;
        }

        // Retrieve current order to prevent regressing already advanced statuses
        const { data: currentOrder } = await serviceClient
            .from('orders')
            .select(`
                id,
                order_number,
                user_id,
                shop_id,
                status,
                payment_status,
                paid_at,
                shops (
                    id,
                    name,
                    owner_id
                )
            `)
            .eq('id', attempt.order_id)
            .single();

        if (currentOrder) {
            if (currentOrder.status === 'CANCELLED') {
                console.warn(
                    `[Webhook Late Capture] CRITICAL: Received ${eventType} for order ${currentOrder.id} ` +
                    `which was already CANCELLED. Initiating automated refund for payment ${effectivePaymentId}.`
                );

                // 1. Record financial truth on orders table as PAID first
                await serviceClient
                    .from('orders')
                    .update({
                        payment_status: 'PAID',
                        paid_at: currentOrder.paid_at || effectivePaidAt,
                        updated_at: nowIso,
                    })
                    .eq('id', attempt.order_id);

                // 2. Check if payment attempt or order is already REFUNDED
                if (attempt.status === 'REFUNDED' || currentOrder.payment_status === 'REFUNDED') {
                    console.log(
                        `[Webhook Late Capture] Order ${attempt.order_id} or attempt ${attempt.id} is already REFUNDED. ` +
                        `Skipping duplicate refund dispatch.`
                    );
                    return NextResponse.json({
                        status: 'ok',
                        warning: 'ALREADY_REFUNDED',
                        orderId: attempt.order_id,
                    }, { status: 200, headers });
                }

                // 3. Atomically create or verify active refund request BEFORE calling Razorpay API
                const refundIdempotencyKey = `late_capture_refund:${attempt.order_id}`;
                let refundRecordId: string | null = null;
                let canDispatchRefund = false;

                try {
                    const { data: rpcResult, error: rpcErr } = await serviceClient.rpc(
                        'initiate_order_refund_request',
                        {
                            p_order_id: attempt.order_id,
                            p_requested_by: null,
                            p_role: 'SYSTEM',
                            p_reason: 'Automated refund: Late payment capture on cancelled order',
                            p_idempotency_key: refundIdempotencyKey,
                        }
                    );

                    if (rpcErr) {
                        // Check if RPC rejected due to an existing active or succeeded refund
                        if (
                            rpcErr.message?.includes('already being processed') ||
                            rpcErr.message?.includes('already been refunded') ||
                            rpcErr.message?.includes('uq_active_refund_per_order') ||
                            rpcErr.code === '23505'
                        ) {
                            console.log(
                                `[Webhook Late Capture] Refund request already active or completed for order ${attempt.order_id} ` +
                                `(${rpcErr.message}). Skipping duplicate Razorpay refund dispatch.`
                            );
                            return NextResponse.json({
                                status: 'ok',
                                warning: 'REFUND_ALREADY_IN_PROGRESS',
                                orderId: attempt.order_id,
                            }, { status: 200, headers });
                        }

                        // Fallback if RPC does not exist yet (pre-push environment)
                        if (rpcErr.code === 'PGRST202' || rpcErr.message?.includes('function') || rpcErr.message?.includes('does not exist')) {
                            const { data: existingRefund } = await serviceClient
                                .from('refund_requests')
                                .select('id, status')
                                .eq('order_id', attempt.order_id)
                                .in('status', ['PENDING', 'PROCESSING', 'SUCCEEDED'])
                                .maybeSingle();

                            if (existingRefund) {
                                console.log(
                                    `[Webhook Late Capture] Existing refund request (${existingRefund.status}) found for order ${attempt.order_id}. ` +
                                    `Skipping duplicate refund call.`
                                );
                                return NextResponse.json({
                                    status: 'ok',
                                    warning: 'REFUND_ALREADY_IN_PROGRESS',
                                    orderId: attempt.order_id,
                                }, { status: 200, headers });
                            }

                            const { data: insertedRefund, error: insertErr } = await serviceClient
                                .from('refund_requests')
                                .insert({
                                    order_id: attempt.order_id,
                                    user_id: (currentOrder as any).user_id || '00000000-0000-0000-0000-000000000000',
                                    payment_attempt_id: attempt.id,
                                    provider: 'RAZORPAY',
                                    amount: attempt.amount || (amountPaise / 100),
                                    status: 'PROCESSING',
                                    reason: 'Automated refund: Late payment capture on cancelled order',
                                    requested_by_role: 'SYSTEM',
                                    idempotency_key: refundIdempotencyKey,
                                    created_at: nowIso,
                                    updated_at: nowIso,
                                })
                                .select('id')
                                .maybeSingle();

                            if (insertErr) {
                                if (insertErr.code === '23505' || insertErr.message?.includes('unique')) {
                                    console.log(`[Webhook Late Capture] Concurrent refund insertion prevented by unique constraint for order ${attempt.order_id}. Skipping.`);
                                    return NextResponse.json({
                                        status: 'ok',
                                        warning: 'REFUND_ALREADY_IN_PROGRESS',
                                        orderId: attempt.order_id,
                                    }, { status: 200, headers });
                                }
                            } else if (insertedRefund?.id) {
                                refundRecordId = insertedRefund.id;
                                canDispatchRefund = true;
                            }
                        } else {
                            console.error('[Webhook Late Capture] Unexpected RPC error initiating refund:', rpcErr);
                            return NextResponse.json({ error: 'Failed to initiate refund lifecycle.' }, { status: 500, headers });
                        }
                    } else if (rpcResult?.refund_request_id) {
                        refundRecordId = rpcResult.refund_request_id;
                        canDispatchRefund = true;
                    }
                } catch (lifecycleErr) {
                    console.error('[Webhook Late Capture] Error managing refund lifecycle:', lifecycleErr);
                }

                // If pre-push table is absent entirely, ensure single dispatch via payment attempt status
                if (!canDispatchRefund && !refundRecordId) {
                    const { data: recheckAttempt } = await serviceClient
                        .from('payment_attempts')
                        .select('status')
                        .eq('id', attempt.id)
                        .single();

                    if (recheckAttempt?.status === 'REFUNDED') {
                        return NextResponse.json({ status: 'ok', warning: 'ALREADY_REFUNDED' }, { status: 200, headers });
                    }
                    canDispatchRefund = true;
                }

                // 4. Only the caller that successfully created the active refund request may call Razorpay API
                if (!canDispatchRefund) {
                    console.log(`[Webhook Late Capture] Not authorized to dispatch refund for order ${attempt.order_id}. Skipping.`);
                    return NextResponse.json({
                        status: 'ok',
                        warning: 'REFUND_ALREADY_IN_PROGRESS',
                        orderId: attempt.order_id,
                    }, { status: 200, headers });
                }

                let rzpRefundId: string | null = null;
                if (effectivePaymentId) {
                    try {
                        const refundResult = await createRazorpayRefund(effectivePaymentId, {
                            amountPaise,
                            notes: {
                                order_id: attempt.order_id,
                                refund_request_id: refundRecordId || '',
                                reason: 'Late capture on already cancelled order',
                            },
                        });
                        rzpRefundId = refundResult?.id || null;
                    } catch (refundErr: any) {
                        const errorMsg = refundErr instanceof Error ? refundErr.message : String(refundErr);
                        console.error('[Webhook Late Capture] Failed to auto-refund late capture:', errorMsg);

                        const isTimeout =
                            errorMsg.includes('timeout') ||
                            errorMsg.includes('ETIMEDOUT') ||
                            errorMsg.includes('ECONNRESET') ||
                            errorMsg.includes('AbortError') ||
                            errorMsg.includes('504');

                        if (refundRecordId) {
                            if (isTimeout) {
                                // Network timeout: keep status PROCESSING and await webhook reconciliation
                                await serviceClient
                                    .from('refund_requests')
                                    .update({
                                        status: 'PROCESSING',
                                        failure_reason: `Network timeout during gateway dispatch: ${errorMsg}. Awaiting webhook reconciliation.`,
                                        updated_at: new Date().toISOString(),
                                    })
                                    .eq('id', refundRecordId);
                            } else {
                                await serviceClient
                                    .from('refund_requests')
                                    .update({
                                        status: 'FAILED',
                                        failure_reason: errorMsg,
                                        updated_at: new Date().toISOString(),
                                    })
                                    .eq('id', refundRecordId);
                            }
                        }

                        return NextResponse.json({
                            status: 'ok',
                            warning: isTimeout ? 'GATEWAY_TIMEOUT_AWAITING_WEBHOOK' : 'GATEWAY_REJECTED',
                            orderId: attempt.order_id,
                        }, { status: 200, headers });
                    }
                }

                // 5. Gateway call succeeded: synchronize database state
                if (rzpRefundId) {
                    if (refundRecordId) {
                        await serviceClient
                            .from('refund_requests')
                            .update({
                                status: 'SUCCEEDED',
                                provider_refund_id: rzpRefundId,
                                completed_at: nowIso,
                                updated_at: nowIso,
                            })
                            .eq('id', refundRecordId);
                    }

                    await serviceClient
                        .from('orders')
                        .update({
                            payment_status: 'REFUNDED',
                            updated_at: nowIso,
                        })
                        .eq('id', attempt.order_id);

                    await serviceClient
                        .from('payment_attempts')
                        .update({ status: 'REFUNDED', updated_at: nowIso })
                        .eq('id', attempt.id);

                    // Phase 6I: Update order receipt to REFUNDED
                    try {
                        await markReceiptRefunded(attempt.order_id, nowIso);
                    } catch (rcptErr) {
                        console.warn('[Webhook Late Capture] Non-blocking receipt refund update error:', rcptErr);
                    }

                    // Phase 6J: Reversal on late capture refund
                    try {
                        await reverseOrderLedger(
                            attempt.order_id,
                            'Late payment capture on cancelled order',
                            refundRecordId,
                            nowIso
                        );
                    } catch (ledgerErr) {
                        console.warn('[Webhook Late Capture] Non-blocking ledger reversal error:', ledgerErr);
                    }
                }

                // Customer in-app notification for late capture auto-refund
                try {
                    const orderShortId = currentOrder.order_number || attempt.order_id.slice(0, 8);
                    const amountNum = Number(attempt.amount || 0);
                    await createNotification({
                        userId: currentOrder.user_id,
                        orderId: attempt.order_id,
                        shopId: currentOrder.shop_id,
                        type: 'REFUND_SUCCESS',
                        title: 'Refund Processed',
                        message: `A payment received after cancellation for order #${orderShortId} (₹${amountNum.toFixed(2)}) has been refunded.`,
                        metadata: {
                            order_id: attempt.order_id,
                            refund_id: rzpRefundId,
                            amount: amountNum,
                        },
                        dedupeKey: `refund-success:${attempt.order_id}`,
                    });
                } catch (notifErr) {
                    console.error('[Webhook Late Capture] Notification error:', notifErr);
                }

                return NextResponse.json({
                    status: 'ok',
                    warning: 'LATE_CAPTURE_REFUNDED',
                    orderId: attempt.order_id,
                    refundId: rzpRefundId,
                }, { status: 200, headers });
            }

            // Keep status QUEUED or advance AWAITING_PAYMENT -> QUEUED
            const targetStatus = currentOrder.status === 'AWAITING_PAYMENT' ? 'QUEUED' : currentOrder.status;

            const { error: updateOrderError } = await serviceClient
                .from('orders')
                .update({
                    status: targetStatus,
                    payment_status: 'PAID',
                    paid_at: currentOrder.paid_at || effectivePaidAt,
                    updated_at: nowIso,
                })
                .eq('id', attempt.order_id);

            if (updateOrderError) {
                console.error(`[Webhook] Error updating order ${attempt.order_id} to QUEUED:`, updateOrderError);
                return NextResponse.json({ error: 'Database error updating order status.' }, { status: 500, headers });
            }

            // Phase 6I: Authoritative order receipt creation
            try {
                await getOrCreateOrderReceipt(attempt.order_id);
            } catch (receiptErr) {
                console.warn('[Webhook] Non-blocking receipt creation error:', receiptErr);
            }

            // Phase 6J: Vendor financial ledger initialization
            try {
                await createOrInitOrderLedger(attempt.order_id);
            } catch (ledgerErr) {
                console.warn('[Webhook] Non-blocking ledger creation error:', ledgerErr);
            }

            // In-app notifications for payment success (Customer) & new order (Vendor)
            try {
                const shop = Array.isArray(currentOrder.shops) ? currentOrder.shops[0] : currentOrder.shops;
                const orderShortId = currentOrder.order_number || attempt.order_id.slice(0, 8);
                const amountNum = Number(attempt.amount || 0);

                // 1. Customer: PAYMENT_SUCCESS
                await createNotification({
                    userId: currentOrder.user_id,
                    orderId: attempt.order_id,
                    shopId: currentOrder.shop_id,
                    type: 'PAYMENT_SUCCESS',
                    title: 'Payment Successful',
                    message: `Payment of ₹${amountNum.toFixed(2)} received for order #${orderShortId}. Your order is queued for printing.`,
                    metadata: {
                        order_id: attempt.order_id,
                        order_number: currentOrder.order_number,
                        amount: amountNum,
                        provider: 'RAZORPAY',
                    },
                    dedupeKey: `payment-success:${attempt.order_id}`,
                });

                // 2. Vendor: NEW_ORDER
                if (shop?.owner_id) {
                    await createNotification({
                        userId: shop.owner_id,
                        orderId: attempt.order_id,
                        shopId: currentOrder.shop_id,
                        type: 'NEW_ORDER',
                        title: 'New Order Received',
                        message: `New order #${orderShortId} has been placed and paid (₹${amountNum.toFixed(2)}).`,
                        metadata: {
                            order_id: attempt.order_id,
                            order_number: currentOrder.order_number,
                            amount: amountNum,
                            shop_name: shop.name,
                        },
                        dedupeKey: `new-order:${attempt.order_id}`,
                    });
                }
            } catch (notifErr) {
                console.error('[Webhook] Notification error on payment capture:', notifErr);
            }
        }

        console.log(`[Webhook] Order ${attempt.order_id} and payment attempt ${attempt.id} successfully synchronized to PAID/QUEUED.`);
    } else if (eventType === 'payment.authorized') {
        // payment.authorized: CREATED -> AUTHORIZED only.
        // MUST NEVER regress a PAID attempt.
        if (rzpOrderId) {
            const { data: attempt } = await serviceClient
                .from('payment_attempts')
                .select('id, status, razorpay_payment_id')
                .eq('razorpay_order_id', rzpOrderId)
                .maybeSingle();

            if (attempt) {
                let authMethod: string | null = null;
                if (paymentEntity?.method) {
                    authMethod = mapRazorpayPaymentMethod(paymentEntity.method);
                }

                if (attempt.status === 'PAID') {
                    console.log(`[Webhook] payment.authorized received for ${rzpOrderId}, but attempt is already PAID. Preserving PAID status.`);
                    if (authMethod && !(attempt as any).payment_method) {
                        await serviceClient
                            .from('payment_attempts')
                            .update({
                                payment_method: authMethod,
                                updated_at: new Date().toISOString(),
                            })
                            .eq('id', attempt.id)
                            .eq('status', 'PAID');
                    }
                } else if (attempt.status === 'CREATED') {
                    const authPayload: Record<string, any> = {
                        status: 'AUTHORIZED',
                        razorpay_payment_id: rzpPaymentId || attempt.razorpay_payment_id,
                        updated_at: new Date().toISOString(),
                    };
                    if (authMethod) {
                        authPayload.payment_method = authMethod;
                    }

                    let { error: authError } = await serviceClient
                        .from('payment_attempts')
                        .update(authPayload)
                        .eq('id', attempt.id)
                        .neq('status', 'PAID'); // Concurrency guard

                    if (authError && (authError.code === 'PGRST204' || authError.message?.includes('payment_method'))) {
                        delete authPayload.payment_method;
                        await serviceClient
                            .from('payment_attempts')
                            .update(authPayload)
                            .eq('id', attempt.id)
                            .neq('status', 'PAID');
                    }

                    console.log(`[Webhook] payment.authorized: attempt ${attempt.id} transitioned CREATED -> AUTHORIZED.`);
                }
            }
        }
    } else if (eventType === 'payment.failed') {
        // payment.failed: MUST NEVER regress a successful PAID attempt.
        if (rzpOrderId) {
            const { data: attempt } = await serviceClient
                .from('payment_attempts')
                .select('id, status')
                .eq('razorpay_order_id', rzpOrderId)
                .maybeSingle();

            if (attempt) {
                if (attempt.status === 'PAID') {
                    console.log(`[Webhook] Stale payment.failed received for already PAID attempt ${rzpOrderId}. Ignoring.`);
                } else {
                    await serviceClient
                        .from('payment_attempts')
                        .update({
                            status: 'FAILED',
                            updated_at: new Date().toISOString(),
                        })
                        .eq('id', attempt.id)
                        .neq('status', 'PAID'); // Concurrency guard

                    console.log(`[Webhook] Payment attempt for ${rzpOrderId} marked FAILED.`);
                }
            }
        }
    } else if (eventType === 'refund.processed' || eventType === 'refund.created') {
        const refundEntity = eventPayload.payload?.refund?.entity;
        const refundPaymentId = refundEntity?.payment_id;
        const refundId = refundEntity?.id;

        if (refundPaymentId) {
            const { data: attempt } = await serviceClient
                .from('payment_attempts')
                .select('id, order_id, status')
                .eq('razorpay_payment_id', refundPaymentId)
                .maybeSingle();

            if (attempt) {
                // Strict idempotency: If payment_attempt is already marked REFUNDED, return immediately
                if (attempt.status === 'REFUNDED') {
                    console.log(`[Webhook] refund.processed received for already REFUNDED attempt ${attempt.id}. Idempotent return.`);
                    return NextResponse.json({ status: 'ok', idempotent: true }, { status: 200, headers });
                }

                await serviceClient
                    .from('payment_attempts')
                    .update({
                        status: 'REFUNDED',
                        updated_at: new Date().toISOString(),
                    })
                    .eq('id', attempt.id)
                    .neq('status', 'REFUNDED');

                await serviceClient
                    .from('orders')
                    .update({
                        status: 'CANCELLED',
                        payment_status: 'REFUNDED',
                        updated_at: new Date().toISOString(),
                    })
                    .eq('id', attempt.order_id)
                    .neq('payment_status', 'REFUNDED');

                // Phase 6I: Update order receipt to REFUNDED
                try {
                    await markReceiptRefunded(attempt.order_id);
                } catch (rcptErr) {
                    console.warn('[Webhook] Non-blocking receipt refund update error:', rcptErr);
                }

                let refundCompletedAt = new Date().toISOString();
                let refundRequestId: string | undefined;

                try {
                    const { data: refUpdated } = await serviceClient
                        .from('refund_requests')
                        .update({
                            status: 'SUCCEEDED',
                            provider_refund_id: refundId,
                            completed_at: refundCompletedAt,
                            updated_at: refundCompletedAt,
                        })
                        .eq('payment_attempt_id', attempt.id)
                        .select('id, completed_at')
                        .maybeSingle();

                    if (refUpdated) {
                        refundRequestId = refUpdated.id;
                        if (refUpdated.completed_at) {
                            refundCompletedAt = refUpdated.completed_at;
                        }
                    }
                } catch {
                    // Ignore pre-push table absence
                }

                // Phase 6J: Reversal on refund.processed
                try {
                    await reverseOrderLedger(
                        attempt.order_id,
                        'Refund processed via Razorpay',
                        refundRequestId,
                        refundCompletedAt
                    );
                } catch (ledgerErr) {
                    console.warn('[Webhook] Non-blocking ledger reversal error:', ledgerErr);
                }

                console.log(`[Webhook] refund.processed synchronized for order ${attempt.order_id}, refund ${refundId}.`);

                // In-app notification for refund.processed
                try {
                    const { data: ord } = await serviceClient
                        .from('orders')
                        .select('id, order_number, user_id, shop_id')
                        .eq('id', attempt.order_id)
                        .maybeSingle();

                    if (ord?.user_id) {
                        const orderShortId = ord.order_number || ord.id.slice(0, 8);
                        await createNotification({
                            userId: ord.user_id,
                            orderId: ord.id,
                            shopId: ord.shop_id,
                            type: 'REFUND_SUCCESS',
                            title: 'Refund Processed',
                            message: `Your refund for order #${orderShortId} has been processed successfully.`,
                            metadata: {
                                order_id: ord.id,
                                refund_id: refundId,
                            },
                            dedupeKey: `refund-success:${ord.id}`,
                        });
                    }
                } catch (notifErr) {
                    console.error('[Webhook] Notification error on refund.processed:', notifErr);
                }
            }
        }
    } else if (eventType === 'refund.failed') {
        const refundEntity = eventPayload.payload?.refund?.entity;
        const refundPaymentId = refundEntity?.payment_id;
        const refundId = refundEntity?.id;

        console.error(`[Webhook] refund.failed received for payment ${refundPaymentId}, refund ${refundId}.`);
        if (refundPaymentId) {
            try {
                await serviceClient
                    .from('refund_requests')
                    .update({
                        status: 'FAILED',
                        failure_reason: refundEntity?.error_description || 'Refund failed by gateway',
                        updated_at: new Date().toISOString(),
                    })
                    .eq('provider_refund_id', refundId);
            } catch {
                // Ignore pre-push table absence
            }

            // In-app notification for refund.failed
            try {
                const { data: attemptRow } = await serviceClient
                    .from('payment_attempts')
                    .select('id, order_id')
                    .eq('razorpay_payment_id', refundPaymentId)
                    .maybeSingle();

                if (attemptRow?.order_id) {
                    const { data: ord } = await serviceClient
                        .from('orders')
                        .select('id, order_number, user_id, shop_id')
                        .eq('id', attemptRow.order_id)
                        .maybeSingle();

                    if (ord?.user_id) {
                        const orderShortId = ord.order_number || ord.id.slice(0, 8);
                        await createNotification({
                            userId: ord.user_id,
                            orderId: ord.id,
                            shopId: ord.shop_id,
                            type: 'REFUND_FAILED',
                            title: 'Refund Failed',
                            message: `Refund processing for order #${orderShortId} failed at gateway. Our team has been alerted.`,
                            metadata: {
                                order_id: ord.id,
                                refund_id: refundId,
                                reason: refundEntity?.error_description || null,
                            },
                            dedupeKey: `refund-failed:${refundId || ord.id}`,
                        });
                    }
                }
            } catch (notifErr) {
                console.error('[Webhook] Notification error on refund.failed:', notifErr);
            }
        }
    }

    return NextResponse.json({ status: 'ok' }, { status: 200, headers });
}

import { NextRequest, NextResponse } from 'next/server';
import { getServiceRoleClient, verifyCustomerToken } from '@/lib/supabase/server';
import { calculateAndPersistOrderQuote, PricingServiceError } from '@/lib/order-pricing-service';
import { createRazorpayOrder, getRazorpayCredentials } from '@/lib/razorpay';
import { applyRateLimit } from '@/lib/rate-limit';
import { validateMutationOrigin } from '@/lib/origin-check';

export const runtime = 'nodejs';

interface RouteContext {
    params: Promise<{
        orderId: string;
    }>;
}

export async function POST(req: NextRequest, context: RouteContext) {
    const headers = { 'Cache-Control': 'no-store' };
    const fail = (error: string, status = 400) =>
        NextResponse.json({ error }, { status, headers });

    // Rate Limiting (30 requests / 60 seconds per client IP)
    const { isLimited, response: limitRes } = await applyRateLimit(req, {
        limit: 30,
        windowSeconds: 60,
        prefix: 'pay-prepare',
    });
    if (isLimited && limitRes) return limitRes;

    // Origin Check
    const originCheck = validateMutationOrigin(req);
    if (!originCheck.isValid && originCheck.response) return originCheck.response;

    const params = await context.params;
    const orderId = params?.orderId;
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
        authUser = await verifyCustomerToken(token);
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return fail(`Authentication failed: ${msg}`, 401);
    }

    if (!authUser || !authUser.userId) {
        return fail('Session invalid or expired. Please sign in again.', 401);
    }
    const authenticatedUserId = authUser.userId;

    // 2. Load Server Credentials
    let serviceClient;
    try {
        serviceClient = getServiceRoleClient();
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return fail(msg, 503);
    }

    let rzpKeyId: string;
    try {
        const creds = getRazorpayCredentials();
        rzpKeyId = creds.keyId;
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return fail(msg, 503);
    }

    // 3. Load Order to Check Current Status
    const { data: order, error: orderError } = await serviceClient
        .from('orders')
        .select('id, order_number, user_id, shop_id, status, payment_status, total_amount, expires_at')
        .eq('id', orderId)
        .single();

    if (orderError || !order) {
        return fail('Order not found.', 404);
    }

    if (order.user_id !== authenticatedUserId) {
        return fail('Unauthorized: this order belongs to another account.', 403);
    }

    if (order.payment_status === 'PAID') {
        return fail('This order has already been paid.', 400);
    }

    // Cross-provider check: reject if already paid via XERCOINS or another attempt
    const { data: paidAttempt } = await serviceClient
        .from('payment_attempts')
        .select('id, provider, status')
        .eq('order_id', orderId)
        .eq('status', 'PAID')
        .limit(1)
        .maybeSingle();

    if (paidAttempt) {
        return fail(`This order has already been paid via ${paidAttempt.provider || 'another payment method'}.`, 400);
    }

    if (new Date(order.expires_at).getTime() <= Date.now()) {
        return fail('This order has expired. Please create a new order.', 400);
    }

    // 4. Handle Existing AWAITING_PAYMENT with active payment_attempt (prevent duplicate orders)
    if (order.status === 'AWAITING_PAYMENT') {
        const { data: existingAttempt } = await serviceClient
            .from('payment_attempts')
            .select('id, razorpay_order_id, amount, currency, status')
            .eq('order_id', orderId)
            .eq('status', 'CREATED')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (existingAttempt && existingAttempt.razorpay_order_id) {
            return NextResponse.json({
                razorpayKeyId: rzpKeyId,
                razorpayOrderId: existingAttempt.razorpay_order_id,
                amount: Math.round(Number(existingAttempt.amount) * 100),
                currency: existingAttempt.currency,
                orderNumber: order.order_number,
                orderId: order.id,
            }, { status: 200, headers });
        }
    }

    if (order.status !== 'DRAFT') {
        return fail(`Cannot prepare payment for order in "${order.status}" status.`, 400);
    }

    // 5. Re-run Authoritative Pricing Calculation for DRAFT orders
    let quote;
    try {
        quote = await calculateAndPersistOrderQuote(orderId, authenticatedUserId);
    } catch (err: unknown) {
        if (err instanceof PricingServiceError) {
            return fail(err.message, err.statusCode);
        }
        const msg = err instanceof Error ? err.message : String(err);
        return fail(`Pricing recalculation error: ${msg}`, 500);
    }

    if (!quote || quote.totalAmount <= 0) {
        return fail('Invalid order total amount for payment.', 400);
    }

    const amountPaise = Math.round(quote.totalAmount * 100);

    // 6. Check for safe reuse of an existing CREATED attempt matching exact amount
    const { data: matchedAttempt } = await serviceClient
        .from('payment_attempts')
        .select('id, razorpay_order_id, amount, currency, status')
        .eq('order_id', orderId)
        .eq('status', 'CREATED')
        .eq('amount', quote.totalAmount)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (matchedAttempt && matchedAttempt.razorpay_order_id) {
        // Transition order DRAFT -> AWAITING_PAYMENT if not already transitioned
        await serviceClient
            .from('orders')
            .update({ status: 'AWAITING_PAYMENT', updated_at: new Date().toISOString() })
            .eq('id', orderId)
            .eq('status', 'DRAFT');

        return NextResponse.json({
            razorpayKeyId: rzpKeyId,
            razorpayOrderId: matchedAttempt.razorpay_order_id,
            amount: amountPaise,
            currency: 'INR',
            orderNumber: quote.orderNumber,
            orderId: orderId,
        }, { status: 200, headers });
    }

    // 7. Create Razorpay Order via TEST API
    let rzpOrder;
    try {
        rzpOrder = await createRazorpayOrder({
            amountPaise,
            currency: 'INR',
            receipt: quote.orderNumber,
            notes: {
                xer_order_id: orderId,
                order_number: quote.orderNumber,
                shop_id: quote.shopId,
            },
        });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return fail(`Gateway order creation failed: ${msg}`, 502);
    }

    // 8. Atomically Record payment_attempts and Advance Order to AWAITING_PAYMENT
    const { error: insertAttemptError } = await serviceClient
        .from('payment_attempts')
        .insert({
            order_id: orderId,
            provider: 'RAZORPAY',
            razorpay_order_id: rzpOrder.id,
            amount: quote.totalAmount,
            currency: 'INR',
            status: 'CREATED',
        });

    if (insertAttemptError) {
        console.error('[PaymentPrepare] Failed to insert payment_attempts row:', insertAttemptError);
        return fail('Database error recording payment attempt.', 500);
    }

    const { error: updateOrderError } = await serviceClient
        .from('orders')
        .update({
            status: 'AWAITING_PAYMENT',
            updated_at: new Date().toISOString(),
        })
        .eq('id', orderId)
        .eq('status', 'DRAFT');

    if (updateOrderError) {
        console.error('[PaymentPrepare] Failed to transition order to AWAITING_PAYMENT:', updateOrderError);
        return fail('Database error updating order status to AWAITING_PAYMENT.', 500);
    }

    return NextResponse.json({
        razorpayKeyId: rzpKeyId,
        razorpayOrderId: rzpOrder.id,
        amount: amountPaise,
        currency: 'INR',
        orderNumber: quote.orderNumber,
        orderId: orderId,
    }, { status: 200, headers });
}

import { NextRequest, NextResponse } from 'next/server';
import { getServiceRoleClient, verifyCustomerToken } from '@/lib/supabase/server';
import { calculateAndPersistOrderQuote, PricingServiceError } from '@/lib/order-pricing-service';
import { createNotification } from '@/lib/notifications';
import { getOrCreateOrderReceipt } from '@/lib/receipts';
import { createOrInitOrderLedger } from '@/lib/vendor-ledger';
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
    const fail = (error: string, status = 400, extra: Record<string, any> = {}) =>
        NextResponse.json({ error, ...extra }, { status, headers });

    // Rate Limiting (30 requests / 60 seconds per client IP)
    const { isLimited, response: limitRes } = await applyRateLimit(req, {
        limit: 30,
        windowSeconds: 60,
        prefix: 'pay-wallet',
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

    if (new Date(order.expires_at).getTime() <= Date.now()) {
        return fail('This order has expired. Please create a new order.', 400);
    }

    if (order.status === 'AWAITING_PAYMENT') {
        return fail('Another payment is already in progress for this order.', 400);
    }

    if (order.status !== 'DRAFT') {
        return fail(`Cannot pay for order in "${order.status}" status. Only DRAFT orders are eligible for wallet payment.`, 400);
    }

    // 4. Pre-check active or completed payment attempts
    const { data: activeAttempt } = await serviceClient
        .from('payment_attempts')
        .select('id, provider, status')
        .eq('order_id', orderId)
        .in('status', ['CREATED', 'AUTHORIZED', 'PAID'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (activeAttempt) {
        if (activeAttempt.provider === 'RAZORPAY') {
            if (activeAttempt.status === 'PAID') {
                return fail('This order has already been paid via Razorpay.', 400);
            }
            return fail('Another payment is already in progress for this order.', 400);
        }
        if (activeAttempt.provider === 'XERCOINS' && activeAttempt.status === 'PAID') {
            // Let the RPC process idempotent replay if it matches
        }
    }

    // 5. Re-run Authoritative Pricing Calculation for DRAFT orders
    try {
        await calculateAndPersistOrderQuote(orderId, authenticatedUserId);
    } catch (err: unknown) {
        if (err instanceof PricingServiceError) {
            return fail(err.message, err.statusCode);
        }
        const msg = err instanceof Error ? err.message : String(err);
        return fail(`Pricing calculation error: ${msg}`, 500);
    }

    // 6. Execute Atomic Wallet Payment RPC
    const idempotencyKey = `wallet-payment:${orderId}`;
    const { data: paymentResult, error: rpcError } = await serviceClient.rpc(
        'pay_order_with_wallet',
        {
            p_user_id: authenticatedUserId,
            p_order_id: orderId,
            p_idempotency_key: idempotencyKey,
        }
    );

    if (rpcError) {
        if (rpcError.message?.includes('Another payment is already in progress for this order.')) {
            return fail('Another payment is already in progress for this order.', 400);
        }
        if (rpcError.message?.includes('Order settings changed. Please recalculate.')) {
            return fail('Order settings changed. Please recalculate.', 400);
        }
        if (rpcError.message?.includes('already been paid')) {
            return fail(rpcError.message, 400);
        }
        return fail(`Wallet checkout error: ${rpcError.message}`, 500);
    }

    const result = typeof paymentResult === 'string' ? JSON.parse(paymentResult) : paymentResult;

    if (!result || result.success === false) {
        if (result?.error_code === 'INSUFFICIENT_FUNDS') {
            return fail('Insufficient XerCoins balance. Please choose another payment method or add credits.', 400, {
                code: 'INSUFFICIENT_FUNDS',
                currentBalance: result.current_balance,
                requiredAmount: result.required_amount,
            });
        }
        return fail(result?.error_message || 'Wallet payment failed.', 400);
    }

    // Phase 6I: Authoritative order receipt creation
    try {
        await getOrCreateOrderReceipt(orderId);
    } catch (rcptErr) {
        console.warn('[WalletPayment] Non-blocking receipt creation error:', rcptErr);
    }

    // Phase 6J: Vendor financial ledger initialization
    try {
        await createOrInitOrderLedger(orderId);
    } catch (ledgerErr) {
        console.warn('[WalletPayment] Non-blocking ledger creation error:', ledgerErr);
    }

    // In-app notifications for payment success (Customer) & new order (Vendor)
    try {
        const { data: orderDetails } = await serviceClient
            .from('orders')
            .select(`
                id,
                order_number,
                user_id,
                shop_id,
                shops (
                    id,
                    name,
                    owner_id
                )
            `)
            .eq('id', orderId)
            .maybeSingle();

        if (orderDetails) {
            const shop = Array.isArray(orderDetails.shops) ? orderDetails.shops[0] : orderDetails.shops;
            const orderNum = result.order_number || orderDetails.order_number || orderId.slice(0, 8);
            const debitedNum = Number(result.amount_debited || 0);

            // 1. Customer: PAYMENT_SUCCESS
            await createNotification({
                userId: authenticatedUserId,
                orderId: orderId,
                shopId: orderDetails.shop_id,
                type: 'PAYMENT_SUCCESS',
                title: 'Payment Successful (XerCoins)',
                message: `Paid ₹${debitedNum.toFixed(2)} with XerCoins for order #${orderNum}. Your order is queued for printing.`,
                metadata: {
                    order_id: orderId,
                    order_number: orderNum,
                    amount: debitedNum,
                    provider: 'XERCOINS',
                    new_balance: Number(result.new_balance),
                },
                dedupeKey: `payment-success:${orderId}`,
            });

            // 2. Vendor: NEW_ORDER
            if (shop?.owner_id) {
                await createNotification({
                    userId: shop.owner_id,
                    orderId: orderId,
                    shopId: orderDetails.shop_id,
                    type: 'NEW_ORDER',
                    title: 'New Order Received',
                    message: `New order #${orderNum} has been placed and paid via XerCoins (₹${debitedNum.toFixed(2)}).`,
                    metadata: {
                        order_id: orderId,
                        order_number: orderNum,
                        amount: debitedNum,
                        shop_name: shop.name,
                    },
                    dedupeKey: `new-order:${orderId}`,
                });
            }
        }
    } catch (notifErr) {
        console.error('[Wallet Payment] Failed to send notifications:', notifErr);
    }

    return NextResponse.json({
        success: true,
        orderId: result.order_id,
        orderNumber: result.order_number,
        status: result.status,
        paymentStatus: result.payment_status,
        newBalance: Number(result.new_balance),
        amountDebited: Number(result.amount_debited),
        transactionId: result.transaction_id,
    }, { status: 200, headers });
}

import { NextRequest, NextResponse } from 'next/server';
import { getServiceRoleClient, verifyCustomerToken } from '@/lib/supabase/server';
import { verifyPaymentSignature, mapRazorpayPaymentMethod, fetchRazorpayPayment } from '@/lib/razorpay';
import { applyRateLimit } from '@/lib/rate-limit';
import { validateMutationOrigin } from '@/lib/origin-check';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
    const headers = { 'Cache-Control': 'no-store' };
    const fail = (error: string, status = 400) =>
        NextResponse.json({ error }, { status, headers });

    // Rate Limiting (30 requests / 60 seconds per client IP)
    const { isLimited, response: limitRes } = await applyRateLimit(req, {
        limit: 30,
        windowSeconds: 60,
        prefix: 'pay-verify',
    });
    if (isLimited && limitRes) return limitRes;

    // Origin Check
    const originCheck = validateMutationOrigin(req);
    if (!originCheck.isValid && originCheck.response) return originCheck.response;

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

    // 2. Parse Request Body
    let body;
    try {
        body = await req.json();
    } catch {
        return fail('Invalid request body.', 400);
    }

    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = body || {};

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
        return fail('Missing required payment parameters.', 400);
    }

    // 3. Verify Payment Signature Server-Side
    let isSignatureValid = false;
    try {
        isSignatureValid = verifyPaymentSignature({
            orderId: razorpay_order_id,
            paymentId: razorpay_payment_id,
            signature: razorpay_signature,
        });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return fail(`Signature verification error: ${msg}`, 500);
    }

    if (!isSignatureValid) {
        return fail('Payment signature verification failed. Untrusted payment.', 400);
    }

    // 4. Retrieve Database Payment Attempt and Confirm User Ownership
    const serviceClient = getServiceRoleClient();

    const { data: attempt, error: attemptError } = await serviceClient
        .from('payment_attempts')
        .select(`
            id,
            order_id,
            amount,
            currency,
            status,
            razorpay_payment_id,
            orders (
                id,
                order_number,
                user_id,
                status,
                payment_status
            )
        `)
        .eq('razorpay_order_id', razorpay_order_id)
        .single();

    if (attemptError || !attempt) {
        return fail('Payment attempt record not found.', 404);
    }

    const parentOrder = Array.isArray(attempt.orders) ? attempt.orders[0] : attempt.orders;
    if (!parentOrder || parentOrder.user_id !== authUser.userId) {
        return fail('Unauthorized: payment attempt does not belong to your account.', 403);
    }

    // 5. Update Payment Attempt without status regression
    // If already marked PAID by the webhook (which is the final capture authority),
    // NEVER regress status back to AUTHORIZED.
    // NOTE: Browser-supplied payment_method is strictly IGNORED.
    // Payment method must only come from verified Razorpay server fetch.
    let trustedMethod: string | null = null;
    const rzpPayment = await fetchRazorpayPayment(razorpay_payment_id);
    if (rzpPayment?.method) {
        trustedMethod = mapRazorpayPaymentMethod(rzpPayment.method);
    }

    if (attempt.status !== 'PAID') {
        const verifyPayload: Record<string, any> = {
            status: 'AUTHORIZED',
            razorpay_payment_id: razorpay_payment_id,
            updated_at: new Date().toISOString(),
        };
        if (trustedMethod) {
            verifyPayload.payment_method = trustedMethod;
        }

        let { error: updateAttemptError } = await serviceClient
            .from('payment_attempts')
            .update(verifyPayload)
            .eq('id', attempt.id)
            .neq('status', 'PAID'); // Concurrency guard

        if (updateAttemptError && (updateAttemptError.code === 'PGRST204' || updateAttemptError.message?.includes('payment_method'))) {
            delete verifyPayload.payment_method;
            await serviceClient
                .from('payment_attempts')
                .update(verifyPayload)
                .eq('id', attempt.id)
                .neq('status', 'PAID');
        }
    } else {
        // Status is already PAID. Never regress status.
        if (trustedMethod || !attempt.razorpay_payment_id) {
            const safeUpdate: Record<string, any> = {
                razorpay_payment_id: razorpay_payment_id,
                updated_at: new Date().toISOString(),
            };
            if (trustedMethod) {
                safeUpdate.payment_method = trustedMethod;
            }
            let { error: safeError } = await serviceClient
                .from('payment_attempts')
                .update(safeUpdate)
                .eq('id', attempt.id)
                .eq('status', 'PAID');

            if (safeError && (safeError.code === 'PGRST204' || safeError.message?.includes('payment_method'))) {
                delete safeUpdate.payment_method;
                await serviceClient
                    .from('payment_attempts')
                    .update(safeUpdate)
                    .eq('id', attempt.id)
                    .eq('status', 'PAID');
            }
        }
    }

    return NextResponse.json({
        verified: true,
        orderId: parentOrder.id,
        orderNumber: parentOrder.order_number,
        paymentStatus: attempt.status === 'PAID' ? 'PAID' : 'AUTHORIZED',
    }, { status: 200, headers });
}

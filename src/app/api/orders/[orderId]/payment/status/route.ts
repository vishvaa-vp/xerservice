import { NextRequest, NextResponse } from 'next/server';
import { getServiceRoleClient, verifyCustomerToken } from '@/lib/supabase/server';

export async function GET(req: NextRequest, context: { params: Promise<{ orderId: string }> }) {
    const headers = { 'Cache-Control': 'no-store' };
    const fail = (error: string, status: number) => NextResponse.json({ error }, { status, headers });
    const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || '';
    try {
        const user = await verifyCustomerToken(token);
        if (!user) return fail('Customer sign-in required.', 401);
        const { orderId } = await context.params;
        const client = getServiceRoleClient();
        const { data: order, error } = await client.from('orders').select('id, order_number, status, payment_status').eq('id', orderId).eq('user_id', user.userId).maybeSingle();
        if (error) return fail('Payment status is temporarily unavailable.', 503);
        if (!order) return fail('Order not found.', 404);
        const { data: attempts, error: attemptsError } = await client.from('payment_attempts').select('status').eq('order_id', order.id).order('created_at', { ascending: false }).limit(10);
        if (attemptsError) return fail('Payment confirmation is temporarily unavailable.', 503);
        const pending = attempts?.some(attempt => ['CREATED', 'AUTHORIZED', 'PAID'].includes(attempt.status));
        return NextResponse.json({ orderId: order.id, orderNumber: order.order_number, orderStatus: order.status, paymentStatus: order.payment_status, safeToRetry: order.payment_status !== 'PAID' && Boolean(attempts?.length) && !pending }, { headers });
    } catch { return fail('Payment confirmation is temporarily unavailable. Please retry.', 503); }
}

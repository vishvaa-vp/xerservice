import { NextRequest, NextResponse } from 'next/server';
import { verifyCustomerToken } from '@/lib/supabase/server';
import { calculateAndPersistOrderQuote, PricingServiceError } from '@/lib/order-pricing-service';

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

    // 2. Perform Authoritative Calculation & Snapshot
    try {
        const body = await req.json().catch(() => ({}));
        const quoteResult = await calculateAndPersistOrderQuote(orderId, authUser.userId, body?.fileAddons);
        return NextResponse.json(quoteResult, { status: 200, headers });
    } catch (err: unknown) {
        if (err instanceof PricingServiceError) {
            return fail(err.message, err.statusCode);
        }
        const msg = err instanceof Error ? err.message : String(err);
        return fail(`Pricing error: ${msg}`, 500);
    }
}

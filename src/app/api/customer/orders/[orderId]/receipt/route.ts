import { NextRequest, NextResponse } from 'next/server';
import { getServiceRoleClient, verifyCustomerToken } from '@/lib/supabase/server';
import { buildReceiptDocumentData, generateReceiptPdf } from '@/lib/receipts';
import { applyRateLimit, getClientIp } from '@/lib/rate-limit';

export const runtime = 'nodejs';

interface RouteContext {
    params: Promise<{
        orderId: string;
    }>;
}

export async function GET(req: NextRequest, context: RouteContext) {
    const fail = (error: string, status = 400) =>
        NextResponse.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });

    const params = await context.params;
    const orderIdParam = params?.orderId?.trim();
    if (!orderIdParam) {
        return fail('Missing order ID parameter.', 400);
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
        console.warn('[ReceiptDownload] Token verification failed:', err);
        return fail('Authentication failed. Please sign in again.', 401);
    }

    if (!authUser || !authUser.userId) {
        return fail('Session invalid or expired. Please sign in again.', 401);
    }

    // Rate Limiting: 30 receipt downloads / 60 seconds per user+IP
    const { isLimited, response: limitRes } = await applyRateLimit(req, {
        limit: 30,
        windowSeconds: 60,
        prefix: 'receipt-dl',
        identifier: `${authUser.userId}:${getClientIp(req)}`,
    });
    if (isLimited && limitRes) return limitRes;

    // 2. Query order by UUID or order_number and confirm ownership
    const serviceClient = getServiceRoleClient();
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderIdParam);

    let orderQuery = serviceClient
        .from('orders')
        .select('id, order_number, user_id, payment_status')
        .eq('user_id', authUser.userId);

    if (isUuid) {
        orderQuery = orderQuery.eq('id', orderIdParam);
    } else {
        orderQuery = orderQuery.eq('order_number', orderIdParam);
    }

    const { data: order, error: orderErr } = await orderQuery.maybeSingle();

    if (orderErr || !order) {
        // Obscure order existence if unauthorized or absent
        return fail('Order not found or unauthorized access.', 404);
    }

    // 3. Ensure order is in a paid or refunded state
    if (order.payment_status !== 'PAID' && order.payment_status !== 'REFUNDED') {
        return fail('Receipt is only available for successfully paid orders.', 400);
    }

    // 4. Assemble authoritative receipt document data
    const documentData = await buildReceiptDocumentData(order.id, authUser.userId);
    if (!documentData) {
        return fail('Payment receipt service is not available yet.', 503);
    }

    const wantsJson = req.nextUrl.searchParams.get('format') === 'json' || req.headers.get('accept')?.includes('application/json');
    if (wantsJson) {
        return NextResponse.json({ receipt: documentData }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
    }

    // 5. Generate PDF server-side using pdf-lib
    try {
        const pdfBytes = await generateReceiptPdf(documentData);

        const filename = `XerService-Receipt-${order.order_number}.pdf`;
        return new NextResponse(Buffer.from(pdfBytes), {
            status: 200,
            headers: {
                'Content-Type': 'application/pdf',
                'Content-Disposition': `attachment; filename="${filename}"`,
                'Content-Length': String(pdfBytes.byteLength),
                'Cache-Control': 'private, no-cache, no-store, must-revalidate',
            },
        });
    } catch (pdfErr) {
        console.error('[ReceiptEndpoint] PDF generation error:', pdfErr);
        return fail('Internal error generating receipt PDF.', 500);
    }
}

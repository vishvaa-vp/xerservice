import { NextRequest, NextResponse } from 'next/server';
import { getServiceRoleClient, verifyCustomerToken } from '@/lib/supabase/server';

export const runtime = 'nodejs';

export async function GET(
    req: NextRequest,
    context: { params: Promise<{ orderId: string; fileId: string }> }
) {
    const headers = { 'Cache-Control': 'no-store' };
    const fail = (error: string, status = 400) =>
        NextResponse.json({ error }, { status, headers });

    const { orderId, fileId } = await context.params;

    if (!orderId || !fileId) {
        return fail('Missing orderId or fileId parameter.', 400);
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

    const serviceClient = getServiceRoleClient();

    // 2. Look up order by UUID or order_number and ensure ownership
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId);
    let orderQuery = serviceClient
        .from('orders')
        .select('id, order_number, user_id')
        .eq('user_id', authUser.userId);

    if (isUuid) {
        orderQuery = orderQuery.eq('id', orderId);
    } else {
        orderQuery = orderQuery.eq('order_number', orderId);
    }

    const { data: order, error: orderError } = await orderQuery.maybeSingle();

    if (orderError || !order) {
        return fail('Order not found or unauthorized access.', 404);
    }

    // 3. Verify file attachment belongs to this order
    const { data: fileRecord, error: fileError } = await serviceClient
        .from('order_files')
        .select('id, order_id, original_filename, storage_path, mime_type')
        .eq('id', fileId)
        .eq('order_id', order.id)
        .maybeSingle();

    if (fileError || !fileRecord || !fileRecord.storage_path) {
        return fail('File attachment not found for this order.', 404);
    }

    // 4. Generate Short-Lived Signed Download URL (60 seconds)
    const { data: signedData, error: signError } = await serviceClient
        .storage
        .from('order-documents')
        .createSignedUrl(fileRecord.storage_path, 60, {
            download: fileRecord.original_filename,
        });

    if (signError || !signedData?.signedUrl) {
        console.error('[Customer File Download] Failed to generate signed URL:', signError);
        return fail('Failed to generate secure document download URL.', 500);
    }

    return NextResponse.json({
        downloadUrl: signedData.signedUrl,
        filename: fileRecord.original_filename,
    }, { headers });
}

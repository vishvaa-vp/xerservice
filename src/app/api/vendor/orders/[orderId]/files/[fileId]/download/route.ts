import { preparePrintPdf } from '@/lib/prepare-print-pdf';
import { fromDbPrintSettings } from '@/lib/print-settings';
import { NextRequest, NextResponse } from 'next/server';
import { getServiceRoleClient, verifyAuthToken } from '@/lib/supabase/server';
import { getCorsHeaders, handleCorsPreflight } from '@/lib/cors';

export const runtime = 'nodejs';

export async function OPTIONS(req: NextRequest) {
    return handleCorsPreflight(req, ['GET', 'OPTIONS']);
}

export async function GET(
    req: NextRequest,
    context: { params: Promise<{ orderId: string; fileId: string }> }
) {
    const corsHeaders = getCorsHeaders(req, ['GET', 'OPTIONS']);
    const headers: Record<string, string> = {
        'Cache-Control': 'no-store',
        ...corsHeaders,
    };
    const fail = (error: string, status = 400) =>
        NextResponse.json({ error }, { status, headers });

    const { orderId, fileId } = await context.params;

    if (!orderId || !fileId) {
        return fail('Missing orderId or fileId parameter.', 400);
    }

    // 1. Authenticate Request (via Bearer header or ?token= query param for inline viewer)
    const authHeader = req.headers.get('authorization');
    const queryToken = req.nextUrl.searchParams.get('token');
    const token = (authHeader && authHeader.startsWith('Bearer '))
        ? authHeader.slice(7).trim()
        : queryToken?.trim();

    if (!token) {
        return fail('Authentication required. Please sign in.', 401);
    }

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

    const serviceClient = getServiceRoleClient();

    // 2. Verify Vendor Role
    const { data: profile, error: profileError } = await serviceClient
        .from('profiles')
        .select('role')
        .eq('user_id', authUser.userId)
        .maybeSingle();

    if (profileError || !profile || profile.role !== 'vendor') {
        return fail('Forbidden: vendor privileges required.', 403);
    }

    // 3. Find Vendor-Owned Shop
    const { data: shop, error: shopError } = await serviceClient
        .from('shops')
        .select('id, name, status, owner_id')
        .eq('owner_id', authUser.userId)
        .maybeSingle();

    if (shopError || !shop) {
        return fail('Forbidden: no shop registered for this vendor account.', 403);
    }

    // 4. Verify Order Exists & Belongs to Vendor's Shop
    const { data: order, error: orderError } = await serviceClient
        .from('orders')
        .select('id, shop_id, status, payment_status')
        .eq('id', orderId)
        .maybeSingle();

    if (orderError || !order) {
        return fail('Order not found.', 404);
    }

    if (order.shop_id !== shop.id) {
        return fail('Forbidden: you do not own the shop associated with this order.', 403);
    }

    // 5. Verify Order Status & Payment Status
    if (order.status === 'CANCELLED') {
        return fail('Forbidden: document access not permitted for cancelled orders.', 409);
    }

    if (order.payment_status !== 'PAID') {
        return fail('Forbidden: document access permitted only for paid orders.', 403);
    }

    if (!['QUEUED', 'PRINTING', 'READY'].includes(order.status)) {
        return fail(`Forbidden: document access not available for order in status ${order.status}.`, 403);
    }

    // 6. Verify File Attachment Belongs to this Order
    const { data: fileRecord, error: fileError } = await serviceClient
        .from('order_files')
        .select('id, order_id, original_filename, storage_path, mime_type, print_settings (*)')
        .eq('id', fileId)
        .eq('order_id', order.id)
        .maybeSingle();

    if (fileError || !fileRecord || !fileRecord.storage_path) {
        return fail('File attachment not found for this order.', 404);
    }

    const inlineRequested = req.nextUrl.searchParams.get('inline') === 'true';
    if (inlineRequested) {
        // Stream binary document content directly to authorized client
        const { data: fileBlob, error: downloadErr } = await serviceClient
            .storage
            .from('order-documents')
            .download(fileRecord.storage_path);

        if (downloadErr || !fileBlob) {
            console.error('[VendorDownload] Error downloading blob for inline view:', downloadErr);
            return fail('Failed to fetch document content from storage.', 500);
        }

        let arrayBuffer = await fileBlob.arrayBuffer();
        if (req.nextUrl.searchParams.get('prepared') === 'true') {
            const raw = Array.isArray(fileRecord.print_settings) ? fileRecord.print_settings[0] : fileRecord.print_settings;
            if (!raw) return fail('Print settings are missing. Refresh the order before printing.', 409);
            try {
                const prepared = await preparePrintPdf(arrayBuffer, fromDbPrintSettings(raw), fileRecord.original_filename || 'document.pdf');
                arrayBuffer = new Uint8Array(prepared).buffer;
            } catch { return fail('The print layout could not be prepared. Review the document and settings.', 422); }
        }
        return new NextResponse(arrayBuffer, {
            status: 200,
            headers: {
                'Content-Type': fileRecord.mime_type || 'application/pdf',
                'Content-Disposition': `inline; filename="${encodeURIComponent(fileRecord.original_filename || 'document.pdf')}"`,
                'Cache-Control': 'private, no-cache, no-store, must-revalidate',
                ...corsHeaders,
            },
        });
    }

    // 7. Generate Short-Lived Signed Download URL (60 seconds) for external viewer/download
    const { data: signedData, error: signError } = await serviceClient
        .storage
        .from('order-documents')
        .createSignedUrl(fileRecord.storage_path, 60);

    if (signError || !signedData?.signedUrl) {
        console.error('[VendorDownload] Error generating signed URL:', signError);
        return fail('Failed to generate document download link.', 500);
    }

    const downloadRequested = req.nextUrl.searchParams.get('download') === 'true';
    if (downloadRequested) {
        return NextResponse.redirect(signedData.signedUrl);
    }

    return NextResponse.json({
        signedUrl: signedData.signedUrl,
        filename: fileRecord.original_filename,
        mimeType: fileRecord.mime_type,
        expiresInSeconds: 60,
    }, { status: 200, headers });
}

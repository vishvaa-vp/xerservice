import { NextRequest, NextResponse } from 'next/server';
import { verifyCustomerToken, getServiceRoleClient } from '@/lib/supabase/server';
import { deleteCustomerWhatsAppFile } from '@packages/backend/whatsapp';

export const runtime = 'nodejs';

/**
 * DELETE /api/customer/whatsapp/files/[id]
 * Safely deletes an imported WhatsApp file for the authenticated customer.
 */
export async function DELETE(
    req: NextRequest,
    context: { params: Promise<{ id: string }> }
) {
    const headers = { 'Cache-Control': 'no-store' };

    const authHeader = req.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return NextResponse.json({ error: 'Authentication required.' }, { status: 401, headers });
    }

    try {
        const token = authHeader.slice(7).trim();
        const verified = await verifyCustomerToken(token);
        if (!verified || !verified.userId) {
            return NextResponse.json({ error: 'Session expired or invalid.' }, { status: 401, headers });
        }

        const { id: fileId } = await context.params;

        if (!fileId) {
            return NextResponse.json({ error: 'fileId is required.' }, { status: 400, headers });
        }

        const sb = getServiceRoleClient();
        const { data: upload } = await sb
            .from('whatsapp_uploads')
            .select('id, storage_path')
            .eq('id', fileId)
            .eq('user_id', verified.userId)
            .maybeSingle();

        let uploadDeleted = false;
        if (upload) {
            if (upload.storage_path) {
                await sb.storage.from('order-documents').remove([upload.storage_path]).catch(() => {});
            }
            await sb.from('whatsapp_uploads').delete().eq('id', fileId).eq('user_id', verified.userId);
            uploadDeleted = true;
        }

        const backendDeleted = await deleteCustomerWhatsAppFile(verified.userId, fileId);

        if (!uploadDeleted && !backendDeleted) {
            return NextResponse.json(
                { error: 'File not found or not owned by user.' },
                { status: 404, headers }
            );
        }

        return NextResponse.json(
            { success: true, message: 'File successfully deleted.' },
            { status: 200, headers }
        );
    } catch (err: unknown) {
        console.error('[DELETE /api/customer/whatsapp/files/[id]] Error:', err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : 'Failed to delete file.' },
            { status: 500, headers }
        );
    }
}

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAuth } from '@/lib/admin-auth';
import { addTicketMessage, SupportServiceError } from '@packages/backend/support';
import { getServiceRoleClient } from '@packages/backend/supabase/client';

export const runtime = 'nodejs';

export async function POST(
    req: NextRequest,
    context: { params: Promise<{ ticketId: string }> }
) {
    const headers = { 'Cache-Control': 'no-store' };

    const auth = await requireAdminAuth(req);
    if (!auth.authorized) {
        return NextResponse.json({ error: auth.error }, { status: auth.status, headers });
    }

    const { ticketId } = await context.params;

    try {
        const body = await req.json().catch(() => ({}));
        const messageText = body.message;
        const isInternalNote = Boolean(body.isInternalNote);
        const attachments = body.attachments || [];

        if (!messageText || !messageText.trim()) {
            return NextResponse.json(
                { error: 'Message text cannot be blank.' },
                { status: 400, headers }
            );
        }

        const adminId = auth.user?.userId || null;
        const adminName = auth.user?.fullName || 'Admin Support';

        const savedMessage = await addTicketMessage(
            ticketId,
            {
                message: messageText,
                isInternalNote,
                attachments,
            },
            {
                role: 'admin',
                userId: adminId,
                name: adminName,
            }
        );

        return NextResponse.json(
            { success: true, message: savedMessage },
            { status: 201, headers }
        );
    } catch (err: unknown) {
        if (err instanceof SupportServiceError) {
            return NextResponse.json({ error: err.message }, { status: err.statusCode, headers });
        }
        console.error('[POST /api/admin/support/[ticketId]/messages] Error:', err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : 'Failed to post message.' },
            { status: 500, headers }
        );
    }
}

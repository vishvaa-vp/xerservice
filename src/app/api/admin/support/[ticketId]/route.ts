import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAuth } from '@/lib/admin-auth';
import {
    getTicketDetail,
    updateTicketStatus,
    SupportServiceError,
    SupportTicketStatus,
    SupportTicketPriority,
} from '@packages/backend/support';

export const runtime = 'nodejs';

export async function GET(
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
        const detail = await getTicketDetail(ticketId, {
            role: 'admin',
            userId: auth.user?.userId,
        });

        return NextResponse.json(
            { success: true, ...detail },
            { status: 200, headers }
        );
    } catch (err: unknown) {
        if (err instanceof SupportServiceError) {
            return NextResponse.json({ error: err.message }, { status: err.statusCode, headers });
        }
        console.error('[GET /api/admin/support/[ticketId]] Error:', err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : 'Failed to retrieve ticket details.' },
            { status: 500, headers }
        );
    }
}

export async function PATCH(
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
        const status = body.status as SupportTicketStatus | undefined;
        const priority = body.priority as SupportTicketPriority | undefined;
        const assignedTo = body.assignedTo !== undefined ? body.assignedTo : undefined;

        if (status && !['open', 'waiting', 'resolved', 'closed'].includes(status)) {
            return NextResponse.json({ error: 'Invalid status value.' }, { status: 400, headers });
        }
        if (priority && !['low', 'normal', 'high', 'urgent'].includes(priority)) {
            return NextResponse.json({ error: 'Invalid priority value.' }, { status: 400, headers });
        }

        const updated = await updateTicketStatus(ticketId, {
            status,
            priority,
            assignedTo,
        });

        return NextResponse.json(
            { success: true, ticket: updated },
            { status: 200, headers }
        );
    } catch (err: unknown) {
        if (err instanceof SupportServiceError) {
            return NextResponse.json({ error: err.message }, { status: err.statusCode, headers });
        }
        console.error('[PATCH /api/admin/support/[ticketId]] Error:', err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : 'Failed to update ticket.' },
            { status: 500, headers }
        );
    }
}

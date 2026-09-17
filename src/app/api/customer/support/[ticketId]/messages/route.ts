import { NextRequest, NextResponse } from 'next/server';
import { verifyCustomerToken } from '@/lib/supabase/server';
import { addTicketMessage, SupportServiceError } from '@packages/backend/support';
import { getServiceRoleClient } from '@packages/backend/supabase/client';

export const runtime = 'nodejs';

export async function POST(
    req: NextRequest,
    context: { params: Promise<{ ticketId: string }> }
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

        const { ticketId } = await context.params;
        const body = await req.json().catch(() => ({}));
        const messageText = body.message;

        if (!messageText || !messageText.trim()) {
            return NextResponse.json({ error: 'Message content cannot be blank.' }, { status: 400, headers });
        }

        // Get customer name from profile
        const sb = getServiceRoleClient();
        const { data: prof } = await sb
            .from('profiles')
            .select('full_name')
            .eq('user_id', verified.userId)
            .maybeSingle();

        const customerName = prof?.full_name || 'Customer';

        const savedMessage = await addTicketMessage(
            ticketId,
            {
                message: messageText,
                isInternalNote: false, // Strictly enforced: customer cannot post internal notes
                attachments: body.attachments || [],
            },
            {
                role: 'customer',
                userId: verified.userId,
                name: customerName,
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
        console.error('[POST /api/customer/support/[ticketId]/messages] Error:', err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : 'Failed to post message.' },
            { status: 500, headers }
        );
    }
}

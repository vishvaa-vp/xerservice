import { NextRequest, NextResponse } from 'next/server';
import { verifyCustomerToken } from '@/lib/supabase/server';
import { confirmLink, WhatsAppServiceError } from '@packages/backend/whatsapp';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
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

        const body = await req.json().catch(() => ({}));

        const result = await confirmLink(verified.userId, body.challengeId);

        return NextResponse.json(
            {
                success: true,
                message: 'WhatsApp connected successfully.',
                link: {
                    id: result.link.id,
                    status: result.link.status,
                    linkedAt: result.link.linked_at,
                    orderUpdatesOptIn: result.link.order_updates_opt_in,
                },
            },
            { status: 200, headers }
        );
    } catch (err: unknown) {
        if (err instanceof WhatsAppServiceError) {
            return NextResponse.json({ error: err.message }, { status: err.statusCode, headers });
        }
        console.error('[POST /api/customer/whatsapp/confirm] Error:', err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : 'Failed to confirm WhatsApp link.' },
            { status: 500, headers }
        );
    }
}

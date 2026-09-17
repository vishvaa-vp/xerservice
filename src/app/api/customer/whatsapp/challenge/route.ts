import { NextRequest, NextResponse } from 'next/server';
import { verifyCustomerToken } from '@/lib/supabase/server';
import { createLinkChallenge, WhatsAppServiceError } from '@packages/backend/whatsapp';

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

        const challenge = await createLinkChallenge(verified.userId, {
            intendedPhone: body.intendedPhone,
            orderUpdatesOptIn: body.orderUpdatesOptIn !== false,
        });

        return NextResponse.json({ success: true, ...challenge }, { status: 201, headers });
    } catch (err: unknown) {
        if (err instanceof WhatsAppServiceError) {
            return NextResponse.json({ error: err.message }, { status: err.statusCode, headers });
        }
        console.error('[POST /api/customer/whatsapp/challenge] Error:', err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : 'Failed to create linking challenge.' },
            { status: 500, headers }
        );
    }
}

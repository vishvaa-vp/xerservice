import { NextRequest, NextResponse } from 'next/server';
import { verifyCustomerToken } from '@/lib/supabase/server';
import { disconnectLink, WhatsAppServiceError } from '@packages/backend/whatsapp';

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

        await disconnectLink(verified.userId);

        return NextResponse.json(
            { success: true, message: 'WhatsApp unlinked successfully.' },
            { status: 200, headers }
        );
    } catch (err: unknown) {
        if (err instanceof WhatsAppServiceError) {
            return NextResponse.json({ error: err.message }, { status: err.statusCode, headers });
        }
        console.error('[POST /api/customer/whatsapp/disconnect] Error:', err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : 'Failed to disconnect WhatsApp.' },
            { status: 500, headers }
        );
    }
}

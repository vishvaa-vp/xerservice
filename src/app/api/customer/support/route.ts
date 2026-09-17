import { NextRequest, NextResponse } from 'next/server';
import { verifyCustomerToken } from '@/lib/supabase/server';
import { getCustomerTickets, SupportServiceError } from '@packages/backend/support';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
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

        const tickets = await getCustomerTickets(verified.userId);

        return NextResponse.json({ success: true, tickets }, { status: 200, headers });
    } catch (err: unknown) {
        if (err instanceof SupportServiceError) {
            return NextResponse.json({ error: err.message }, { status: err.statusCode, headers });
        }
        console.error('[GET /api/customer/support] Error:', err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : 'Failed to retrieve tickets.' },
            { status: 500, headers }
        );
    }
}

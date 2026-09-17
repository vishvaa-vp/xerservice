import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAuth } from '@/lib/admin-auth';
import { getAdminTicketsList, SupportServiceError } from '@packages/backend/support';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
    const headers = { 'Cache-Control': 'no-store' };

    const auth = await requireAdminAuth(req);
    if (!auth.authorized) {
        return NextResponse.json({ error: auth.error }, { status: auth.status, headers });
    }

    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status') || 'all';
    const priority = searchParams.get('priority') || 'all';
    const source = searchParams.get('source') || 'all';
    const shopId = searchParams.get('shopId') || 'all';
    const search = searchParams.get('search') || '';
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '25', 10);

    try {
        const result = await getAdminTicketsList({
            status,
            priority,
            source,
            shopId,
            search,
            page,
            limit,
        });

        return NextResponse.json(
            {
                success: true,
                summary: result.summary,
                pagination: result.pagination,
                tickets: result.tickets,
            },
            { status: 200, headers }
        );
    } catch (err: unknown) {
        if (err instanceof SupportServiceError) {
            return NextResponse.json({ error: err.message }, { status: err.statusCode, headers });
        }
        console.error('[GET /api/admin/support] Error:', err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : 'Failed to retrieve support tickets.' },
            { status: 500, headers }
        );
    }
}

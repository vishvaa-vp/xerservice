import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAuth } from '@/lib/admin-auth';
import { generateSettlementStatementCsv } from '@packages/backend/finance';

export const runtime = 'nodejs';

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const headers = { 'Cache-Control': 'no-store' };

    const auth = await requireAdminAuth(req);
    if (!auth.authorized) {
        return NextResponse.json({ error: auth.error }, { status: auth.status, headers });
    }

    const { id } = await params;
    if (!id) {
        return NextResponse.json({ error: 'Settlement ID is required.' }, { status: 400, headers });
    }

    try {
        const { filename, csv } = await generateSettlementStatementCsv(id);
        return new NextResponse(csv, {
            status: 200,
            headers: {
                ...headers,
                'Content-Type': 'text/csv; charset=utf-8',
                'Content-Disposition': `attachment; filename="${filename}"`,
            },
        });
    } catch (csvErr: unknown) {
        const msg = csvErr instanceof Error ? csvErr.message : String(csvErr);
        return NextResponse.json({ error: msg }, { status: 404, headers });
    }
}

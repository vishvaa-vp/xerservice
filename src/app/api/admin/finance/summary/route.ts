import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAuth } from '@/lib/admin-auth';
import { getAdminFinanceSummary } from '@/lib/vendor-ledger';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
    const headers = { 'Cache-Control': 'no-store' };

    const auth = await requireAdminAuth(req);
    if (!auth.authorized) {
        return NextResponse.json({ error: auth.error }, { status: auth.status, headers });
    }

    try {
        const summary = await getAdminFinanceSummary();
        return NextResponse.json(summary, { status: 200, headers });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[AdminFinance] Error generating finance summary:', msg);
        return NextResponse.json({ error: `Failed to generate summary: ${msg}` }, { status: 500, headers });
    }
}

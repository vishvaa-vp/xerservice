import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAuth } from '@/lib/admin-auth';
import { confirmSettlementBatch } from '@/lib/vendor-ledger';

export const runtime = 'nodejs';

export async function POST(
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
        const updated = await confirmSettlementBatch(id, auth.user?.userId);
        if (!updated) {
            return NextResponse.json({ error: 'Failed to confirm settlement batch. Ensure it exists and is in DRAFT status.' }, { status: 400, headers });
        }

        return NextResponse.json({
            success: true,
            message: `Settlement batch ${updated.settlement_number} is now CONFIRMED.`,
            settlement: updated,
        }, { status: 200, headers });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[AdminFinance] Error confirming settlement ${id}:`, msg);
        return NextResponse.json({ error: msg }, { status: 400, headers });
    }
}

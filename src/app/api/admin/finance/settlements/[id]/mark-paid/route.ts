import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAuth } from '@/lib/admin-auth';
import { markSettlementBatchPaid } from '@/lib/vendor-ledger';

export const runtime = 'nodejs';

const ALLOWED_PAYMENT_METHODS = ['UPI', 'NEFT', 'IMPS', 'BANK_TRANSFER', 'OTHER'];

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
        const body = await req.json();
        const { payment_method, payment_reference, settled_at } = body;

        if (!payment_method || !ALLOWED_PAYMENT_METHODS.includes(payment_method)) {
            return NextResponse.json({
                error: `Invalid or missing payment method: ${payment_method}. Allowed: ${ALLOWED_PAYMENT_METHODS.join(', ')}.`,
            }, { status: 400, headers });
        }

        if (!payment_reference || typeof payment_reference !== 'string' || !payment_reference.trim()) {
            return NextResponse.json({
                error: 'A valid external payment reference (transaction ID / UTR / reference number) is required.',
            }, { status: 400, headers });
        }

        const updated = await markSettlementBatchPaid(
            id,
            payment_reference.trim(),
            settled_at || new Date().toISOString(),
            payment_method,
            auth.user?.userId
        );

        if (!updated) {
            return NextResponse.json({ error: 'Failed to update settlement to PAID. Verify batch exists and is CONFIRMED.' }, { status: 400, headers });
        }

        return NextResponse.json({
            success: true,
            message: `Settlement ${updated.settlement_number} marked as PAID. Attached order ledgers are now SETTLED.`,
            settlement: updated,
        }, { status: 200, headers });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[AdminFinance] Error marking settlement ${id} as PAID:`, msg);
        return NextResponse.json({ error: msg }, { status: 400, headers });
    }
}

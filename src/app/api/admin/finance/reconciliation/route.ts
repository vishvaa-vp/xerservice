import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAuth } from '@/lib/admin-auth';
import { getServiceRoleClient } from '@/lib/supabase/server';
import {
    getFinancialReconciliationReport,
    ReconciliationCategory,
    ReconciliationSeverity,
} from '@packages/backend/finance';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
    const headers = { 'Cache-Control': 'no-store' };

    const auth = await requireAdminAuth(req);
    if (!auth.authorized) {
        return NextResponse.json({ error: auth.error }, { status: auth.status, headers });
    }

    try {
        const { searchParams } = new URL(req.url);
        const categoryParam = searchParams.get('category');
        const severityParam = searchParams.get('severity');
        const shopId = searchParams.get('shopId') || undefined;

        let category: ReconciliationCategory | undefined = undefined;
        if (categoryParam && ['UNALLOCATED_ORDER', 'UNRESOLVED_REFUND', 'SETTLEMENT_MISMATCH'].includes(categoryParam)) {
            category = categoryParam as ReconciliationCategory;
        }

        let severity: ReconciliationSeverity | undefined = undefined;
        if (severityParam && ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].includes(severityParam)) {
            severity = severityParam as ReconciliationSeverity;
        }

        const sb = getServiceRoleClient();
        const report = await getFinancialReconciliationReport(sb, {
            category,
            severity,
            shopId,
        });

        return NextResponse.json({ success: true, report }, { status: 200, headers });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[AdminReconciliation] Error generating reconciliation report:', msg);
        return NextResponse.json(
            { error: `Failed to generate reconciliation report: ${msg}` },
            { status: 500, headers }
        );
    }
}

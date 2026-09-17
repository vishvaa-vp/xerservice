import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAuth } from '@/lib/admin-auth';
import {
    getAuthoritativeEarningsReport,
    generateEarningsCsv,
    DatePreset,
} from '@packages/backend/finance';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
    const headers = { 'Cache-Control': 'no-store' };

    const auth = await requireAdminAuth(req);
    if (!auth.authorized) {
        return NextResponse.json({ error: auth.error }, { status: auth.status, headers });
    }

    const { searchParams } = new URL(req.url);
    const preset = (searchParams.get('preset') as DatePreset) || 'all_time';
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const shopId = searchParams.get('shopId');
    const exportFormat = searchParams.get('export');

    try {
        const report = await getAuthoritativeEarningsReport({
            preset,
            startDate,
            endDate,
            shopId,
        });

        if (exportFormat === 'csv') {
            const csvData = generateEarningsCsv(report);
            return new NextResponse(csvData, {
                status: 200,
                headers: {
                    ...headers,
                    'Content-Type': 'text/csv; charset=utf-8',
                    'Content-Disposition': `attachment; filename="earnings-${preset}-${new Date().toISOString().slice(0, 10)}.csv"`,
                },
            });
        }

        return NextResponse.json({ success: true, report }, { status: 200, headers });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[AdminEarningsAPI] Error generating earnings report:', msg);
        return NextResponse.json({ error: msg }, { status: 500, headers });
    }
}

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAuth } from '@/lib/admin-auth';
import { getServiceRoleClient } from '@/lib/supabase/server';
import { applyShopCommissionRule } from '@/lib/vendor-ledger';

export const runtime = 'nodejs';

export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ ruleId: string }> }
) {
    const headers = { 'Cache-Control': 'no-store' };

    const auth = await requireAdminAuth(req);
    if (!auth.authorized) {
        return NextResponse.json({ error: auth.error }, { status: auth.status, headers });
    }

    const { ruleId } = await params;
    if (!ruleId) {
        return NextResponse.json({ error: 'Rule ID is required.' }, { status: 400, headers });
    }

    const serviceClient = getServiceRoleClient();

    try {
        const { data: rule, error: ruleErr } = await serviceClient
            .from('shop_commission_rules')
            .select('*')
            .eq('id', ruleId)
            .maybeSingle();

        if (ruleErr || !rule) {
            return NextResponse.json({ error: 'Commission rule not found.' }, { status: 404, headers });
        }

        if (!rule.is_active) {
            return NextResponse.json({ error: 'Cannot apply an inactive commission rule.' }, { status: 400, headers });
        }

        const result = await applyShopCommissionRule(rule.shop_id, rule.id);

        return NextResponse.json({
            ...result,
            message: `Applied commission rule to ${result.configuredCount} eligible order(s).`,
        }, { status: 200, headers });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[AdminFinance] Error applying rule ${ruleId}:`, msg);
        return NextResponse.json({ error: msg }, { status: 500, headers });
    }
}

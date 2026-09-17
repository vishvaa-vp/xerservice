import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAuth } from '@/lib/admin-auth';
import { getServiceRoleClient } from '@/lib/supabase/server';
import { calculateShopFinancialSummary } from '@/lib/vendor-ledger';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
    const headers = { 'Cache-Control': 'no-store' };

    const auth = await requireAdminAuth(req);
    if (!auth.authorized) {
        return NextResponse.json({ error: auth.error }, { status: auth.status, headers });
    }

    const serviceClient = getServiceRoleClient();

    try {
        const { data: shops, error: shopsErr } = await serviceClient
            .from('shops')
            .select('id, name, description, status, owner_id, created_at')
            .order('name', { ascending: true });

        if (shopsErr) {
            throw new Error(`Failed to fetch shops: ${shopsErr.message}`);
        }

        const { data: activeRules, error: rulesErr } = await serviceClient
            .from('shop_commission_rules')
            .select('*')
            .eq('is_active', true);

        const activeRuleMap = new Map((activeRules || []).map(r => [r.shop_id, r]));

        const { data: ledgers, error: ledgersErr } = await serviceClient
            .from('order_financial_ledger')
            .select('*');

        const ledgerByShop = new Map<string, any[]>();
        for (const l of ledgers || []) {
            const list = ledgerByShop.get(l.shop_id) || [];
            list.push(l);
            ledgerByShop.set(l.shop_id, list);
        }

        const shopSummaries = (shops || []).map(shop => {
            const shopLedgers = ledgerByShop.get(shop.id) || [];
            const activeRule = activeRuleMap.get(shop.id);
            const summary = calculateShopFinancialSummary(shopLedgers, !!activeRule);

            return {
                shopId: shop.id,
                shopName: shop.name,
                shopStatus: shop.status,
                address: shop.description || null,
                description: shop.description || null,
                activeCommissionRule: activeRule ? {
                    id: activeRule.id,
                    commission_bps: activeRule.commission_bps,
                    commissionPercentage: activeRule.commission_bps / 100,
                    effective_from: activeRule.effective_from,
                    effective_to: activeRule.effective_to,
                } : null,
                ...summary,
            };
        });

        return NextResponse.json({ shops: shopSummaries }, { status: 200, headers });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[AdminFinance] Error fetching shop finances:', msg);
        return NextResponse.json({ error: `Failed to fetch shop finances: ${msg}` }, { status: 500, headers });
    }
}

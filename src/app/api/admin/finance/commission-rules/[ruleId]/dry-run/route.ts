import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAuth } from '@/lib/admin-auth';
import { getServiceRoleClient } from '@/lib/supabase/server';
import { calculateCommission } from '@/lib/vendor-ledger';

export const runtime = 'nodejs';

export async function POST(
    req: NextRequest,
    context: { params: Promise<{ ruleId: string }> }
) {
    const headers = { 'Cache-Control': 'no-store' };

    const auth = await requireAdminAuth(req);
    if (!auth.authorized) {
        return NextResponse.json({ error: auth.error }, { status: auth.status, headers });
    }

    const { ruleId } = await context.params;
    const serviceClient = getServiceRoleClient();

    try {
        // Fetch commission rule
        const { data: rule, error: ruleErr } = await serviceClient
            .from('shop_commission_rules')
            .select(`
                *,
                shops ( id, name )
            `)
            .eq('id', ruleId)
            .maybeSingle();

        if (ruleErr || !rule) {
            return NextResponse.json({ error: `Commission rule ${ruleId} not found.` }, { status: 404, headers });
        }

        // Fetch unconfigured or pending orders for this shop
        const { data: ledgerRows, error: ledgerErr } = await serviceClient
            .from('order_financial_ledger')
            .select(`
                id,
                order_id,
                gross_amount,
                financial_status,
                payment_attempt_id,
                payment_attempts ( paid_at ),
                orders ( order_number, status, payment_status, created_at )
            `)
            .eq('shop_id', rule.shop_id)
            .in('financial_status', ['UNCONFIGURED', 'PENDING']);

        if (ledgerErr) {
            return NextResponse.json({ error: `Failed to query ledger orders: ${ledgerErr.message}` }, { status: 500, headers });
        }

        let evaluatedCount = 0;
        let projectedGross = 0;
        let projectedFee = 0;
        let projectedNet = 0;

        const simulatedOrders = [];

        for (const item of ledgerRows || []) {
            const paidAt = (item.payment_attempts as any)?.paid_at || (item.orders as any)?.created_at || new Date().toISOString();
            const fallsInWindow = paidAt >= rule.effective_from && (!rule.effective_to || paidAt < rule.effective_to);

            if (fallsInWindow) {
                evaluatedCount++;
                const gross = Number(item.gross_amount || 0);
                const { platformCommission, vendorNet } = calculateCommission(gross, rule.commission_bps);

                projectedGross += gross;
                projectedFee += platformCommission;
                projectedNet += vendorNet;

                simulatedOrders.push({
                    orderId: item.order_id,
                    orderNumber: (item.orders as any)?.order_number || item.order_id,
                    currentStatus: item.financial_status,
                    grossAmount: gross,
                    projectedCommission: platformCommission,
                    projectedVendorNet: vendorNet,
                });
            }
        }

        return NextResponse.json({
            success: true,
            dryRun: true,
            rule: {
                id: rule.id,
                shopId: rule.shop_id,
                shopName: rule.shops?.name || 'Shop',
                commissionBps: rule.commission_bps,
                commissionPercentage: rule.commission_bps / 100,
                effectiveFrom: rule.effective_from,
                effectiveTo: rule.effective_to,
                isActive: rule.is_active,
            },
            evaluatedCount,
            projectedGross: Math.round(projectedGross * 100) / 100,
            projectedFee: Math.round(projectedFee * 100) / 100,
            projectedNet: Math.round(projectedNet * 100) / 100,
            simulatedOrders,
        }, { status: 200, headers });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return NextResponse.json({ error: msg }, { status: 500, headers });
    }
}

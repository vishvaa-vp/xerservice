import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAuth } from '@/lib/admin-auth';
import { getServiceRoleClient } from '@/lib/supabase/server';
import { calculateShopFinancialSummary } from '@/lib/vendor-ledger';

export const runtime = 'nodejs';

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ shopId: string }> }
) {
    const headers = { 'Cache-Control': 'no-store' };

    const auth = await requireAdminAuth(req);
    if (!auth.authorized) {
        return NextResponse.json({ error: auth.error }, { status: auth.status, headers });
    }

    const { shopId } = await params;
    if (!shopId) {
        return NextResponse.json({ error: 'Shop ID is required.' }, { status: 400, headers });
    }

    const serviceClient = getServiceRoleClient();

    try {
        const { data: shop, error: shopErr } = await serviceClient
            .from('shops')
            .select('id, name, description, status, owner_id, created_at')
            .eq('id', shopId)
            .maybeSingle();

        if (shopErr || !shop) {
            return NextResponse.json({ error: 'Shop not found.' }, { status: 404, headers });
        }

        // Active and historical commission rules
        const { data: rules } = await serviceClient
            .from('shop_commission_rules')
            .select('*')
            .eq('shop_id', shopId)
            .order('effective_from', { ascending: false });

        const activeRule = (rules || []).find(r => r.is_active);

        // Fetch ledger entries with joined order data
        const { data: ledgers, error: ledgersErr } = await serviceClient
            .from('order_financial_ledger')
            .select(`
                id,
                order_id,
                shop_id,
                gross_amount,
                currency,
                commission_bps,
                platform_commission_amount,
                vendor_net_amount,
                financial_status,
                eligible_at,
                settled_at,
                reversed_at,
                refund_request_id,
                reversal_reason,
                created_at,
                updated_at,
                orders (
                    order_number,
                    status,
                    paid_at,
                    cancelled_at
                )
            `)
            .eq('shop_id', shopId)
            .order('created_at', { ascending: false });

        if (ledgersErr) {
            throw new Error(`Failed to fetch shop ledgers: ${ledgersErr.message}`);
        }

        const summary = calculateShopFinancialSummary(ledgers || [], !!activeRule);

        const formattedLedgers = (ledgers || []).map((row: any) => ({
            id: row.id,
            orderId: row.order_id,
            orderNumber: row.orders?.order_number || row.order_id.slice(0, 8),
            orderStatus: row.orders?.status,
            grossAmount: Number(row.gross_amount),
            currency: row.currency,
            commissionBps: row.commission_bps,
            commissionPercentage: row.commission_bps !== null ? row.commission_bps / 100 : null,
            platformCommissionAmount: row.platform_commission_amount !== null ? Number(row.platform_commission_amount) : null,
            vendorNetAmount: row.vendor_net_amount !== null ? Number(row.vendor_net_amount) : null,
            financialStatus: row.financial_status,
            paidAt: row.orders?.paid_at,
            eligibleAt: row.eligible_at,
            settledAt: row.settled_at,
            reversedAt: row.reversed_at,
            refundRequestId: row.refund_request_id,
            reversalReason: row.reversal_reason,
            createdAt: row.created_at,
        }));

        return NextResponse.json({
            shop: {
                id: shop.id,
                name: shop.name,
                address: shop.description || null,
                description: shop.description || null,
                status: shop.status,
            },
            summary,
            activeRule: activeRule ? {
                id: activeRule.id,
                commission_bps: activeRule.commission_bps,
                commissionPercentage: activeRule.commission_bps / 100,
                effective_from: activeRule.effective_from,
                effective_to: activeRule.effective_to,
            } : null,
            rules: rules || [],
            ledgers: formattedLedgers,
        }, { status: 200, headers });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[AdminFinance] Error fetching details for shop ${shopId}:`, msg);
        return NextResponse.json({ error: `Failed to fetch shop details: ${msg}` }, { status: 500, headers });
    }
}

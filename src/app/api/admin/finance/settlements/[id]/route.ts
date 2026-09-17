import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAuth } from '@/lib/admin-auth';
import { getServiceRoleClient } from '@/lib/supabase/server';

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

    const { searchParams } = new URL(req.url);
    if (searchParams.get('export') === 'csv') {
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

    const serviceClient = getServiceRoleClient();

    try {
        const { data: batch, error: batchErr } = await serviceClient
            .from('vendor_settlement_batches')
            .select(`
                *,
                shops ( id, name, description )
            `)
            .eq('id', id)
            .maybeSingle();

        if (batchErr || !batch) {
            return NextResponse.json({ error: 'Settlement batch not found.' }, { status: 404, headers });
        }

        // Fetch attached items with financial ledger & order details
        const { data: items, error: itemsErr } = await serviceClient
            .from('vendor_settlement_items')
            .select(`
                id,
                created_at,
                order_financial_ledger (
                    id,
                    order_id,
                    gross_amount,
                    commission_bps,
                    platform_commission_amount,
                    vendor_net_amount,
                    financial_status,
                    eligible_at,
                    settled_at,
                    orders (
                        order_number,
                        status,
                        paid_at
                    )
                )
            `)
            .eq('settlement_batch_id', id);

        if (itemsErr) {
            throw new Error(`Failed to fetch settlement items: ${itemsErr.message}`);
        }

        const formattedItems = (items || []).map((item: any) => {
            const l = item.order_financial_ledger;
            return {
                itemId: item.id,
                ledgerId: l?.id,
                orderId: l?.order_id,
                orderNumber: l?.orders?.order_number || l?.order_id?.slice(0, 8),
                orderStatus: l?.orders?.status,
                grossAmount: Number(l?.gross_amount || 0),
                commissionBps: l?.commission_bps,
                platformCommissionAmount: Number(l?.platform_commission_amount || 0),
                vendorNetAmount: Number(l?.vendor_net_amount || 0),
                financialStatus: l?.financial_status,
                paidAt: l?.orders?.paid_at,
                eligibleAt: l?.eligible_at,
                settledAt: l?.settled_at,
            };
        });

        return NextResponse.json({
            settlement: {
                id: batch.id,
                shopId: batch.shop_id,
                shopName: batch.shops?.name || 'Unknown Shop',
                shopAddress: batch.shops?.description || null,
                settlementNumber: batch.settlement_number,
                grossOrderAmount: Number(batch.gross_order_amount),
                platformCommissionAmount: Number(batch.platform_commission_amount),
                vendorPayableAmount: Number(batch.vendor_payable_amount),
                orderCount: batch.order_count,
                status: batch.status,
                paymentReference: batch.payment_reference,
                paymentMethod: batch.payment_method,
                paidBy: batch.paid_by,
                createdBy: batch.created_by,
                confirmedBy: batch.confirmed_by,
                confirmedAt: batch.confirmed_at,
                settledAt: batch.settled_at,
                disbursedAt: batch.disbursed_at,
                notes: batch.notes,
                createdAt: batch.created_at,
                updatedAt: batch.updated_at,
            },
            orders: formattedItems,
        }, { status: 200, headers });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return NextResponse.json({ error: msg }, { status: 500, headers });
    }
}

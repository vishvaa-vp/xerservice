import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAuth } from '@/lib/admin-auth';
import { getServiceRoleClient } from '@/lib/supabase/server';
import {
    getSettlementsOverview,
    getEligibleOrdersForShop,
    createSettlementBatchWithConcurrencyGuard,
} from '@packages/backend/finance';
import { applyRateLimit, getClientIp } from '@/lib/rate-limit';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
    const headers = { 'Cache-Control': 'no-store' };

    const auth = await requireAdminAuth(req);
    if (!auth.authorized) {
        return NextResponse.json({ error: auth.error }, { status: auth.status, headers });
    }

    const { searchParams } = new URL(req.url);
    const shopId = searchParams.get('shopId');
    const status = searchParams.get('status');
    const isEligible = searchParams.get('eligible') === 'true';
    const isOverview = searchParams.get('overview') === 'true';

    try {
        // Mode 1: Fetch eligible orders for a specific shop
        if (isEligible && shopId) {
            const eligibleOrders = await getEligibleOrdersForShop(shopId);
            return NextResponse.json({ eligibleOrders }, { status: 200, headers });
        }

        // Mode 2: Return settlements overview (Ready, In Progress, Paid History)
        if (isOverview || (!shopId && !status)) {
            const overview = await getSettlementsOverview();
            return NextResponse.json(overview, { status: 200, headers });
        }

        // Mode 3: Filtered list (backward compatible)
        const serviceClient = getServiceRoleClient();
        let query = serviceClient
            .from('vendor_settlement_batches')
            .select(`
                *,
                shops ( id, name, description )
            `)
            .order('created_at', { ascending: false });

        if (shopId) {
            query = query.eq('shop_id', shopId);
        }
        if (status) {
            query = query.eq('status', status);
        }

        const { data: batches, error } = await query;
        if (error) {
            throw new Error(`Failed to query settlements: ${error.message}`);
        }

        const formatted = (batches || []).map((b: any) => ({
            id: b.id,
            shopId: b.shop_id,
            shopName: b.shops?.name || 'Unknown Shop',
            settlementNumber: b.settlement_number,
            grossOrderAmount: Number(b.gross_order_amount),
            platformCommissionAmount: Number(b.platform_commission_amount),
            vendorPayableAmount: Number(b.vendor_payable_amount),
            orderCount: b.order_count,
            status: b.status,
            paymentReference: b.payment_reference,
            paymentMethod: b.payment_method,
            paidBy: b.paid_by,
            createdBy: b.created_by,
            confirmedBy: b.confirmed_by,
            confirmedAt: b.confirmed_at,
            settledAt: b.settled_at,
            disbursedAt: b.disbursed_at,
            notes: b.notes,
            createdAt: b.created_at,
            updatedAt: b.updated_at,
        }));

        return NextResponse.json({ settlements: formatted }, { status: 200, headers });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return NextResponse.json({ error: msg }, { status: 500, headers });
    }
}

export async function POST(req: NextRequest) {
    const headers = { 'Cache-Control': 'no-store' };

    const auth = await requireAdminAuth(req);
    if (!auth.authorized) {
        return NextResponse.json({ error: auth.error }, { status: auth.status, headers });
    }

    // Rate Limiting: 20 settlement batch creation requests / 60 seconds per admin+IP
    const { isLimited, response: limitRes } = await applyRateLimit(req, {
        limit: 20,
        windowSeconds: 60,
        prefix: 'admin-settle',
        identifier: `${auth.user?.userId || 'admin'}:${getClientIp(req)}`,
    });
    if (isLimited && limitRes) return limitRes;

    try {
        const body = await req.json();
        const { shop_id, order_ledger_ids, notes } = body;

        if (!shop_id) {
            return NextResponse.json({ error: 'Shop ID (shop_id) is required.' }, { status: 400, headers });
        }

        if (!Array.isArray(order_ledger_ids) || order_ledger_ids.length === 0) {
            return NextResponse.json({ error: 'At least one PAYABLE order (order_ledger_ids) must be selected for settlement.' }, { status: 400, headers });
        }

        // Create settlement batch with concurrency conflict detection
        const finalBatch = await createSettlementBatchWithConcurrencyGuard(
            shop_id,
            order_ledger_ids,
            notes,
            auth.user?.userId
        );

        return NextResponse.json({
            success: true,
            message: `Settlement batch ${finalBatch.settlement_number} created with ${finalBatch.order_count} order(s).`,
            settlement: {
                id: finalBatch.id,
                shopId: finalBatch.shop_id,
                settlementNumber: finalBatch.settlement_number,
                grossOrderAmount: Number(finalBatch.gross_order_amount),
                platformCommissionAmount: Number(finalBatch.platform_commission_amount),
                vendorPayableAmount: Number(finalBatch.vendor_payable_amount),
                orderCount: finalBatch.order_count,
                status: finalBatch.status,
                createdAt: finalBatch.created_at,
            },
        }, { status: 201, headers });
    } catch (err: any) {
        const msg = err instanceof Error ? err.message : String(err);
        const statusCode = err?.status || (msg.includes('already locked') || msg.includes('cannot settle the same') ? 409 : 400);
        console.error('[AdminFinance] Error creating settlement batch:', msg);
        return NextResponse.json({ error: msg }, { status: statusCode, headers });
    }
}

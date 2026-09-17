import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAuth } from '@/lib/admin-auth';
import { getServiceRoleClient } from '@/lib/supabase/server';
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

    const serviceClient = getServiceRoleClient();

    try {
        let query = serviceClient
            .from('shop_commission_rules')
            .select(`
                *,
                shops ( id, name )
            `)
            .order('effective_from', { ascending: false });

        if (shopId) {
            query = query.eq('shop_id', shopId);
        }

        const { data: rules, error } = await query;
        if (error) {
            throw new Error(`Failed to query commission rules: ${error.message}`);
        }

        const formatted = (rules || []).map((r: any) => ({
            id: r.id,
            shopId: r.shop_id,
            shopName: r.shops?.name || 'Unknown Shop',
            commissionBps: r.commission_bps,
            commissionPercentage: r.commission_bps / 100,
            effectiveFrom: r.effective_from,
            effectiveTo: r.effective_to,
            isActive: r.is_active,
            createdAt: r.created_at,
            createdBy: r.created_by,
        }));

        return NextResponse.json({ rules: formatted }, { status: 200, headers });
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

    // Rate Limiting: 20 commission rule creation requests / 60 seconds per admin+IP
    const { isLimited, response: limitRes } = await applyRateLimit(req, {
        limit: 20,
        windowSeconds: 60,
        prefix: 'admin-comm',
        identifier: `${auth.user?.userId || 'admin'}:${getClientIp(req)}`,
    });
    if (isLimited && limitRes) return limitRes;

    const serviceClient = getServiceRoleClient();

    try {
        const body = await req.json();
        const { shop_id, commission_percentage, effective_from, effective_to, close_previous } = body;

        if (!shop_id) {
            return NextResponse.json({ error: 'Shop ID (shop_id) is required.' }, { status: 400, headers });
        }

        // Verify shop exists
        const { data: shop, error: shopErr } = await serviceClient
            .from('shops')
            .select('id, name')
            .eq('id', shop_id)
            .maybeSingle();

        if (shopErr || !shop) {
            return NextResponse.json({ error: 'Shop does not exist.' }, { status: 404, headers });
        }

        // Validate percentage
        const pctNum = Number(commission_percentage);
        if (isNaN(pctNum) || pctNum < 0 || pctNum > 100) {
            return NextResponse.json({
                error: `Invalid commission percentage: ${commission_percentage}. Must be between 0% and 100%.`,
            }, { status: 400, headers });
        }

        // Validate precision: reject more than 2 decimal places
        const pctStr = String(commission_percentage).trim();
        const decimalParts = pctStr.split('.');
        if (decimalParts.length === 2 && decimalParts[1].length > 2) {
            return NextResponse.json({
                error: `Commission percentage cannot have more than 2 decimal places. Received: ${commission_percentage}.`,
            }, { status: 400, headers });
        }

        // Convert server-side to basis points
        const commission_bps = Math.round(pctNum * 100);
        if (commission_bps < 0 || commission_bps > 10000) {
            return NextResponse.json({
                error: `Invalid commission basis points: ${commission_bps}. Must be between 0 and 10000.`,
            }, { status: 400, headers });
        }

        const effectiveFromIso = effective_from ? new Date(effective_from).toISOString() : new Date().toISOString();
        let effectiveToIso: string | null = null;

        if (effective_to) {
            effectiveToIso = new Date(effective_to).toISOString();
            if (new Date(effectiveToIso) <= new Date(effectiveFromIso)) {
                return NextResponse.json({
                    error: 'Effective To date must be strictly after Effective From date.',
                }, { status: 400, headers });
            }
        }

        // If requested, close previous active rule that ends at or after effectiveFromIso
        if (close_previous) {
            await serviceClient
                .from('shop_commission_rules')
                .update({
                    effective_to: effectiveFromIso,
                    updated_at: new Date().toISOString(),
                })
                .eq('shop_id', shop_id)
                .eq('is_active', true)
                .or(`effective_to.is.null,effective_to.gt.${effectiveFromIso}`);
        }

        // Check for overlapping active rules
        const { data: existingRules } = await serviceClient
            .from('shop_commission_rules')
            .select('*')
            .eq('shop_id', shop_id)
            .eq('is_active', true);

        for (const existing of existingRules || []) {
            const exStart = new Date(existing.effective_from).getTime();
            const exEnd = existing.effective_to ? new Date(existing.effective_to).getTime() : Infinity;
            const newStart = new Date(effectiveFromIso).getTime();
            const newEnd = effectiveToIso ? new Date(effectiveToIso).getTime() : Infinity;

            // Overlap condition: max(start1, start2) < min(end1, end2)
            if (Math.max(exStart, newStart) < Math.min(exEnd, newEnd)) {
                return NextResponse.json({
                    error: `Overlapping active commission rule exists (${existing.commission_bps / 100}%, effective from ${existing.effective_from}). Close or adjust the existing rule first.`,
                }, { status: 400, headers });
            }
        }

        // Insert new rule
        const { data: rule, error: insertErr } = await serviceClient
            .from('shop_commission_rules')
            .insert({
                shop_id,
                commission_bps,
                effective_from: effectiveFromIso,
                effective_to: effectiveToIso,
                is_active: true,
                created_by: auth.user?.userId || null,
            })
            .select('*')
            .single();

        if (insertErr) {
            if (insertErr.message?.includes('Overlapping active commission rule exists')) {
                return NextResponse.json({ error: 'Overlapping active commission rule exists for this shop.' }, { status: 400, headers });
            }
            throw new Error(`Failed to create commission rule: ${insertErr.message}`);
        }

        return NextResponse.json({
            success: true,
            message: `Commission rule created: ${commission_percentage}% (${commission_bps} bps).`,
            rule: {
                id: rule.id,
                shopId: rule.shop_id,
                commissionBps: rule.commission_bps,
                commissionPercentage: rule.commission_bps / 100,
                effectiveFrom: rule.effective_from,
                effectiveTo: rule.effective_to,
                isActive: rule.is_active,
                createdAt: rule.created_at,
            },
        }, { status: 201, headers });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[AdminFinance] Error creating commission rule:', msg);
        return NextResponse.json({ error: msg }, { status: 500, headers });
    }
}

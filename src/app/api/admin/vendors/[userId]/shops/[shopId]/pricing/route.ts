import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAuth } from '@/lib/admin-auth';
import { getServiceRoleClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

const VALID_PAPER_SIZES = ['A4'] as const;
const VALID_PRINT_MODES = ['BW', 'COLOUR'] as const;
const DISPLAY_SIDES = ['SINGLE', 'DOUBLE'] as const;
const DB_SIDES = ['SINGLE', 'DOUBLE_LONG_EDGE', 'DOUBLE_SHORT_EDGE', 'DOUBLE'] as const;

export interface MatrixRow {
    paper_size: typeof VALID_PAPER_SIZES[number];
    print_mode: typeof VALID_PRINT_MODES[number];
    sides: typeof DISPLAY_SIDES[number];
    price_per_sheet: number;
    active: boolean;
    configured: boolean;
}

/**
 * GET /api/admin/vendors/[userId]/shops/[shopId]/pricing
 * Returns clean rate matrix (4 A4 combinations: BW & Colour for Single and Double-sided) for the shop.
 */
export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ userId: string; shopId: string }> }
) {
    const auth = await requireAdminAuth(req);
    if (!auth.authorized) {
        return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { shopId } = await params;
    if (!shopId) {
        return NextResponse.json({ error: 'Shop ID is required.' }, { status: 400 });
    }

    const sb = getServiceRoleClient();

    try {
        const { data: dbRows, error: dbErr } = await sb
            .from('shop_pricing')
            .select('id, paper_size, print_mode, sides, price_per_sheet, active')
            .eq('shop_id', shopId);

        if (dbErr) throw new Error(dbErr.message);

        const dbMap = new Map<string, { price_per_sheet: number; active: boolean }>();
        for (const row of dbRows || []) {
            const key = `${row.paper_size.toUpperCase()}:${row.print_mode.toUpperCase()}:${row.sides.toUpperCase()}`;
            dbMap.set(key, {
                price_per_sheet: Number(row.price_per_sheet),
                active: Boolean(row.active),
            });
        }

        const matrix: MatrixRow[] = [];
        for (const paper of VALID_PAPER_SIZES) {
            for (const mode of VALID_PRINT_MODES) {
                for (const side of DISPLAY_SIDES) {
                    let found = dbMap.get(`${paper}:${mode}:${side}`);
                    if (!found && side === 'DOUBLE') {
                        // Check DOUBLE_LONG_EDGE or DOUBLE_SHORT_EDGE from DB
                        found = dbMap.get(`${paper}:${mode}:DOUBLE_LONG_EDGE`) || dbMap.get(`${paper}:${mode}:DOUBLE_SHORT_EDGE`);
                    }

                    matrix.push({
                        paper_size: paper,
                        print_mode: mode,
                        sides: side,
                        price_per_sheet: found ? found.price_per_sheet : 0,
                        active: found ? found.active : false,
                        configured: Boolean(found),
                    });
                }
            }
        }

        return NextResponse.json({
            shopId,
            matrix,
            totalRows: matrix.length,
            configuredRows: matrix.filter(m => m.configured).length,
            activeRows: matrix.filter(m => m.active).length,
        }, {
            status: 200,
            headers: { 'Cache-Control': 'no-store' },
        });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}

/**
 * PUT /api/admin/vendors/[userId]/shops/[shopId]/pricing
 * Upserts pricing matrix rows for the specified shop.
 */
export async function PUT(
    req: NextRequest,
    { params }: { params: Promise<{ userId: string; shopId: string }> }
) {
    const auth = await requireAdminAuth(req);
    if (!auth.authorized) {
        return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { shopId } = await params;
    if (!shopId) {
        return NextResponse.json({ error: 'Shop ID is required.' }, { status: 400 });
    }

    const sb = getServiceRoleClient();

    try {
        const body = await req.json();
        const rawRates = body?.rates;

        if (!Array.isArray(rawRates) || rawRates.length === 0) {
            return NextResponse.json({ error: 'Payload must contain a non-empty "rates" array.' }, { status: 400 });
        }

        const rowsToUpsert: Array<{
            shop_id: string;
            paper_size: string;
            print_mode: string;
            sides: string;
            price_per_sheet: number;
            active: boolean;
            updated_at: string;
        }> = [];

        for (const [idx, item] of rawRates.entries()) {
            const paper = String(item.paper_size || '').toUpperCase();
            const mode = String(item.print_mode || '').toUpperCase();
            const side = String(item.sides || '').toUpperCase();

            if (!VALID_PAPER_SIZES.includes(paper as any)) {
                return NextResponse.json({
                    error: `Invalid paper_size "${item.paper_size}" at index ${idx}. Must be one of: ${VALID_PAPER_SIZES.join(', ')}`
                }, { status: 400 });
            }

            if (!VALID_PRINT_MODES.includes(mode as any)) {
                return NextResponse.json({
                    error: `Invalid print_mode "${item.print_mode}" at index ${idx}. Must be one of: ${VALID_PRINT_MODES.join(', ')}`
                }, { status: 400 });
            }

            if (!DB_SIDES.includes(side as any)) {
                return NextResponse.json({
                    error: `Invalid sides "${item.sides}" at index ${idx}. Must be SINGLE or DOUBLE.`
                }, { status: 400 });
            }

            const rawPrice = Number(item.price_per_sheet);
            if (!Number.isFinite(rawPrice) || rawPrice < 0) {
                return NextResponse.json({
                    error: `Invalid price_per_sheet "${item.price_per_sheet}" at index ${idx}. Must be a non-negative number.`
                }, { status: 400 });
            }

            const roundedPrice = Math.round(rawPrice * 100) / 100;
            const active = typeof item.active === 'boolean' ? item.active : true;
            const now = new Date().toISOString();

            if (side === 'DOUBLE') {
                // Expand DOUBLE into both DB constraint compliant rows
                rowsToUpsert.push({
                    shop_id: shopId,
                    paper_size: paper,
                    print_mode: mode,
                    sides: 'DOUBLE_LONG_EDGE',
                    price_per_sheet: roundedPrice,
                    active,
                    updated_at: now,
                });
                rowsToUpsert.push({
                    shop_id: shopId,
                    paper_size: paper,
                    print_mode: mode,
                    sides: 'DOUBLE_SHORT_EDGE',
                    price_per_sheet: roundedPrice,
                    active,
                    updated_at: now,
                });
            } else {
                rowsToUpsert.push({
                    shop_id: shopId,
                    paper_size: paper,
                    print_mode: mode,
                    sides: side,
                    price_per_sheet: roundedPrice,
                    active,
                    updated_at: now,
                });
            }
        }

        // Upsert rows into shop_pricing with conflict on unique constraint
        const { data: upserted, error: upsertErr } = await sb
            .from('shop_pricing')
            .upsert(rowsToUpsert, {
                onConflict: 'shop_id,paper_size,print_mode,sides',
            })
            .select('id, paper_size, print_mode, sides, price_per_sheet, active');

        if (upsertErr) throw new Error(upsertErr.message);

        return NextResponse.json({
            success: true,
            shopId,
            updatedCount: upserted?.length || 0,
            rates: upserted,
        }, { status: 200 });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return NextResponse.json({ error: msg }, { status: 400 });
    }
}

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAuth } from '@/lib/admin-auth';
import { getServiceRoleClient } from '@/lib/supabase/server';
import { calculateShopFinancialSummary } from '@/lib/vendor-ledger';
import { parseShopProfileMetadata, PublishStatus, TradingStatus } from '@/lib/shop-profile';
import { normalizePhoneNumber } from '@/lib/phone';

export const runtime = 'nodejs';

/** GET /api/admin/vendors
 *  List all vendor accounts with enriched shop profiles, separated trading status
 *  (OPEN / PAUSED / CLOSED) and publish state (DRAFT / PUBLISHED / ARCHIVED),
 *  and financial summaries.
 *  Supports ?search=, ?status=, ?publish=.
 */
export async function GET(req: NextRequest) {
    const auth = await requireAdminAuth(req);
    if (!auth.authorized) {
        return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    try {
        const sb = getServiceRoleClient();
        const url = new URL(req.url);
        const search = url.searchParams.get('search')?.trim().toLowerCase() ?? '';
        const statusFilter = url.searchParams.get('status')?.trim().toUpperCase() ?? 'ALL';
        const publishFilter = url.searchParams.get('publish')?.trim().toUpperCase() ?? 'ALL';

        // 1. Fetch profiles with role = 'vendor'
        const { data: profiles, error: profileErr } = await sb
            .from('profiles')
            .select('user_id, full_name, phone, role, created_at')
            .eq('role', 'vendor');

        if (profileErr) throw new Error(profileErr.message);

        const vendorIds = (profiles ?? []).map((p: { user_id: string }) => p.user_id);

        // 2. Fetch all shops (both assigned and unassigned)
        const { data: shops, error: shopErr } = await sb
            .from('shops')
            .select('id, name, description, status, owner_id, open_time, close_time, closing_soon, closing_message, created_at')
            .order('name', { ascending: true });

        if (shopErr) throw new Error(shopErr.message);

        // 3. Fetch active commission rules
        const { data: activeRules } = await sb
            .from('shop_commission_rules')
            .select('*')
            .eq('is_active', true);

        const ruleMap = new Map((activeRules || []).map(r => [r.shop_id, r]));

        // 4. Fetch financial ledgers
        const { data: ledgers } = await sb
            .from('order_financial_ledger')
            .select('*');

        const ledgerByShop = new Map<string, any[]>();
        for (const l of ledgers || []) {
            const list = ledgerByShop.get(l.shop_id) || [];
            list.push(l);
            ledgerByShop.set(l.shop_id, list);
        }

        // Build enriched shop map by owner_id and by shop id
        const shopMap: Record<string, any> = {};
        const enrichedShopsList = (shops || []).map(s => {
            const shopLedgers = ledgerByShop.get(s.id) || [];
            const rule = ruleMap.get(s.id);
            const fin = calculateShopFinancialSummary(shopLedgers, !!rule);
            const meta = parseShopProfileMetadata(s.description);

            const enriched = {
                shopId: s.id,
                shopName: s.name,
                ownerId: s.owner_id || null,
                shopStatus: s.status as TradingStatus,
                publishStatus: meta.publishStatus as PublishStatus,
                address: meta.address,
                photos: meta.photos,
                contactPhone: meta.contactPhone,
                openTime: s.open_time,
                closeTime: s.close_time,
                closingSoon: Boolean(s.closing_soon),
                closingMessage: s.closing_message,
                commissionConfigured: fin.commissionConfigured,
                grossSales: fin.grossSales,
                platformCommission: fin.platformCommission,
                vendorEarnings: fin.vendorEarnings,
                payableAmount: fin.payableAmount,
                totalOrdersCount: fin.totalOrdersCount,
                activeCommissionRule: rule ? {
                    id: rule.id,
                    commission_bps: rule.commission_bps,
                    commissionPercentage: rule.commission_bps / 100,
                } : null,
                createdAt: s.created_at,
            };

            if (s.owner_id) {
                shopMap[s.owner_id] = enriched;
            }

            return enriched;
        });

        // 5. Fetch auth users for email + ban status
        const { data: authData, error: authErr } = await sb.auth.admin.listUsers({ perPage: 1000, page: 1 });
        if (authErr) throw new Error(authErr.message);

        const authMap: Record<string, { email?: string; banned_until?: string | null; last_sign_in_at?: string | null }> = {};
        for (const u of (authData?.users ?? [])) {
            authMap[u.id] = {
                email: u.email,
                banned_until: u.banned_until ?? null,
                last_sign_in_at: u.last_sign_in_at ?? null,
            };
        }

        let vendors = (profiles ?? []).map((p: { user_id: string; full_name: string | null; phone: string | null; role: string; created_at: string }) => {
            const authInfo = authMap[p.user_id] ?? {};
            const isDisabled = authInfo.banned_until
                ? new Date(authInfo.banned_until) > new Date()
                : false;
            const shop = shopMap[p.user_id] ?? null;

            return {
                userId: p.user_id,
                email: authInfo.email ?? null,
                fullName: p.full_name ?? null,
                phone: p.phone ?? null,
                role: p.role,
                isDisabled,
                shop,
                lastSignInAt: authInfo.last_sign_in_at ?? null,
                createdAt: p.created_at,
            };
        });

        // Filters
        if (statusFilter && statusFilter !== 'ALL') {
            vendors = vendors.filter(v => v.shop && v.shop.shopStatus === statusFilter);
        }

        if (publishFilter && publishFilter !== 'ALL') {
            vendors = vendors.filter(v => v.shop && v.shop.publishStatus === publishFilter);
        }

        if (search) {
            vendors = vendors.filter(v =>
                (v.fullName ?? '').toLowerCase().includes(search) ||
                (v.email ?? '').toLowerCase().includes(search) ||
                (v.phone ?? '').toLowerCase().includes(search) ||
                (v.shop?.shopName ?? '').toLowerCase().includes(search) ||
                (v.shop?.address ?? '').toLowerCase().includes(search)
            );
        }

        vendors.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

        // Calculate aggregate summary
        let totalShops = enrichedShopsList.length;
        let openShops = 0;
        let publishedShops = 0;
        let totalPayable = 0;
        let totalEarnings = 0;

        for (const s of enrichedShopsList) {
            if (s.shopStatus === 'OPEN') openShops++;
            if (s.publishStatus === 'PUBLISHED') publishedShops++;
            totalPayable += (s.payableAmount || 0);
            totalEarnings += (s.vendorEarnings || 0);
        }

        return NextResponse.json({
            vendors,
            shops: enrichedShopsList,
            summary: {
                totalVendors: vendors.length,
                totalShops,
                openShops,
                publishedShops,
                totalPayable: Math.round(totalPayable * 100) / 100,
                totalEarnings: Math.round(totalEarnings * 100) / 100,
            }
        }, {
            status: 200,
            headers: { 'Cache-Control': 'no-store' }
        });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}

/** POST /api/admin/vendors
 *  Create a new vendor account. Optionally assign to a shop.
 */
export async function POST(req: NextRequest) {
    const auth = await requireAdminAuth(req);
    if (!auth.authorized) {
        return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    try {
        const body = await req.json();
        const { email, password, fullName, phone, shopId } = body;

        if (!email || typeof email !== 'string') {
            return NextResponse.json({ error: 'Email is required.' }, { status: 400 });
        }
        if (!password || typeof password !== 'string' || password.length < 6) {
            return NextResponse.json({ error: 'Password must be at least 6 characters.' }, { status: 400 });
        }

        let normalizedPhone: string | null = null;
        if (phone && typeof phone === 'string' && phone.trim()) {
            normalizedPhone = normalizePhoneNumber(phone);
            if (!normalizedPhone) {
                return NextResponse.json({ error: 'Invalid phone format. Please provide a valid 10-digit Indian mobile number.' }, { status: 400 });
            }
        }

        const sb = getServiceRoleClient();

        const userMeta: Record<string, string> = { full_name: fullName ?? '' };
        if (normalizedPhone) {
            userMeta.phone = normalizedPhone;
        }

        const { data: created, error: createErr } = await sb.auth.admin.createUser({
            email: email.trim().toLowerCase(),
            password,
            email_confirm: true,
            user_metadata: userMeta,
        });

        if (createErr) throw new Error(createErr.message);

        const newUserId = created.user!.id;

        await sb.from('profiles').upsert({
            user_id: newUserId,
            full_name: fullName ?? null,
            phone: normalizedPhone,
            role: 'vendor',
        }, { onConflict: 'user_id' });

        let assignedShop = null;
        if (shopId && typeof shopId === 'string') {
            const { data: shopRow, error: shopErr } = await sb
                .from('shops')
                .update({ owner_id: newUserId })
                .eq('id', shopId)
                .select('id, name, status')
                .maybeSingle();

            if (shopErr) throw new Error(`Shop assignment failed: ${shopErr.message}`);
            if (shopRow) {
                assignedShop = { shopId: shopRow.id, shopName: shopRow.name, shopStatus: shopRow.status };
            }
        }

        return NextResponse.json({
            vendor: {
                userId: newUserId,
                email: created.user!.email,
                fullName: fullName ?? null,
                phone: normalizedPhone,
                role: 'vendor',
                isDisabled: false,
                shop: assignedShop,
                createdAt: created.user!.created_at,
            }
        }, { status: 201 });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return NextResponse.json({ error: msg }, { status: 400 });
    }
}

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAuth } from '@/lib/admin-auth';
import { getServiceRoleClient } from '@/lib/supabase/server';
import { normalizePhoneNumber } from '@/lib/phone';

export const runtime = 'nodejs';

export interface AdminUserRecord {
    userId: string;
    name: string | null;
    fullName: string | null;
    email: string | null;
    phone: string | null;
    role: 'customer' | 'vendor' | 'admin';
    assignedShop: {
        id: string;
        name: string;
        status: string;
    } | null;
    shop: {
        shopId: string;
        shopName: string;
        shopStatus: string;
    } | null;
    accountStatus: 'active' | 'disabled' | 'pending' | 'inactive';
    accountCategory: 'active' | 'inactive' | 'pending';
    isDisabled: boolean;
    isPending: boolean;
    orderCount: number;
    completedOrders: number;
    paidOrders: number;
    grossSpend: number;
    refundAmount: number;
    netSpend: number;
    latestOrderAt: string | null;
    lastSignInAt: string | null;
    createdAt: string;
    created: string;
}

/** GET /api/admin/users
 *  Unified endpoint to list customer and vendor accounts with KPI summaries.
 *  Supports filters: ?search= & ?role= & ?status=
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
        const roleFilter = url.searchParams.get('role')?.trim().toLowerCase() ?? 'all';
        const statusFilter = url.searchParams.get('status')?.trim().toLowerCase() ?? 'all';
        const shopIdFilter = url.searchParams.get('shopId')?.trim() ?? '';
        const pageParam = url.searchParams.get('page');
        const limitParam = url.searchParams.get('limit');

        // 1. List all auth users
        const { data: authData, error: authErr } = await sb.auth.admin.listUsers({ perPage: 1000, page: 1 });
        if (authErr) throw new Error(authErr.message);

        const allAuthUsers = authData?.users ?? [];

        // 2. Fetch all profiles
        const { data: profiles, error: profileErr } = await sb
            .from('profiles')
            .select('user_id, full_name, phone, role, created_at, updated_at');

        if (profileErr) throw new Error(profileErr.message);

        // 3. Fetch all shops to map vendor assignments
        const { data: shops, error: shopErr } = await sb
            .from('shops')
            .select('id, name, status, owner_id');

        if (shopErr) throw new Error(shopErr.message);

        const shopOwnerMap: Record<string, { id: string; name: string; status: string }> = {};
        for (const s of (shops ?? [])) {
            if (s.owner_id) {
                shopOwnerMap[s.owner_id] = { id: s.id, name: s.name, status: s.status };
            }
        }

        // 4. Fetch orders & refunds for truthful metrics
        const { data: orders, error: orderErr } = await sb
            .from('orders')
            .select('id, user_id, status, payment_status, total_amount, created_at');

        if (orderErr) throw new Error(orderErr.message);

        const { data: refunds } = await sb
            .from('refund_requests')
            .select('user_id, amount, status')
            .eq('status', 'SUCCEEDED');

        const orderCountMap: Record<string, number> = {};
        const completedOrdersMap: Record<string, number> = {};
        const paidOrdersMap: Record<string, number> = {};
        const grossSpendMap: Record<string, number> = {};
        const latestOrderMap: Record<string, string> = {};

        for (const o of (orders ?? [])) {
            if (o.user_id) {
                orderCountMap[o.user_id] = (orderCountMap[o.user_id] ?? 0) + 1;

                if (o.status === 'COMPLETED') {
                    completedOrdersMap[o.user_id] = (completedOrdersMap[o.user_id] ?? 0) + 1;
                }

                if (o.payment_status === 'COMPLETED') {
                    paidOrdersMap[o.user_id] = (paidOrdersMap[o.user_id] ?? 0) + 1;
                    const amt = Number(o.total_amount) || 0;
                    grossSpendMap[o.user_id] = (grossSpendMap[o.user_id] ?? 0) + amt;
                }

                if (o.created_at) {
                    if (!latestOrderMap[o.user_id] || new Date(o.created_at) > new Date(latestOrderMap[o.user_id])) {
                        latestOrderMap[o.user_id] = o.created_at;
                    }
                }
            }
        }

        const refundMap: Record<string, number> = {};
        for (const r of (refunds ?? [])) {
            if (r.user_id) {
                refundMap[r.user_id] = (refundMap[r.user_id] ?? 0) + (Number(r.amount) || 0);
            }
        }

        // 5. Auth user lookup
        const authLookup: Record<string, {
            email?: string;
            banned_until?: string | null;
            last_sign_in_at?: string | null;
            email_confirmed_at?: string | null;
        }> = {};
        for (const u of allAuthUsers) {
            authLookup[u.id] = {
                email: u.email,
                banned_until: u.banned_until ?? null,
                last_sign_in_at: u.last_sign_in_at ?? null,
                email_confirmed_at: u.email_confirmed_at ?? null,
            };
        }

        // 6. Build all user records with mutually exclusive access categories
        const allUserRecords: AdminUserRecord[] = (profiles ?? []).map((p: any) => {
            const a = authLookup[p.user_id] ?? {};
            const isDisabled = a.banned_until
                ? new Date(a.banned_until) > new Date()
                : false;
            const isPending = !isDisabled && (!a.last_sign_in_at || (!a.email_confirmed_at && Boolean(a.email)));
            const accountCategory: 'active' | 'inactive' | 'pending' = isDisabled
                ? 'inactive'
                : isPending
                ? 'pending'
                : 'active';

            const shopObj = shopOwnerMap[p.user_id] ?? null;
            const gross = Math.round((grossSpendMap[p.user_id] ?? 0) * 100) / 100;
            const refAmt = Math.round((refundMap[p.user_id] ?? 0) * 100) / 100;
            const net = Math.max(0, Math.round((gross - refAmt) * 100) / 100);

            return {
                userId: p.user_id,
                name: p.full_name ?? null,
                fullName: p.full_name ?? null,
                email: a.email ?? null,
                phone: p.phone ?? null,
                role: p.role as 'customer' | 'vendor' | 'admin',
                assignedShop: shopObj,
                shop: shopObj ? { shopId: shopObj.id, shopName: shopObj.name, shopStatus: shopObj.status } : null,
                accountStatus: isDisabled ? 'disabled' : isPending ? 'pending' : 'active',
                accountCategory,
                isDisabled,
                isPending,
                orderCount: orderCountMap[p.user_id] ?? 0,
                completedOrders: completedOrdersMap[p.user_id] ?? 0,
                paidOrders: paidOrdersMap[p.user_id] ?? 0,
                grossSpend: gross,
                refundAmount: refAmt,
                netSpend: net,
                latestOrderAt: latestOrderMap[p.user_id] ?? null,
                lastSignInAt: a.last_sign_in_at ?? null,
                createdAt: p.created_at,
                created: p.created_at,
            };
        });

        // 7. Calculate overall KPI summaries (unfiltered)
        const summary = {
            totalUsers: allUserRecords.length,
            customers: allUserRecords.filter(u => u.role === 'customer').length,
            vendors: allUserRecords.filter(u => u.role === 'vendor').length,
            active: allUserRecords.filter(u => u.accountCategory === 'active').length,
            inactive: allUserRecords.filter(u => u.accountCategory === 'inactive').length,
            disabled: allUserRecords.filter(u => u.accountCategory === 'inactive').length,
            pending: allUserRecords.filter(u => u.accountCategory === 'pending').length,
        };

        // 8. Apply search and filters
        let filtered = allUserRecords;

        if (roleFilter && roleFilter !== 'all') {
            filtered = filtered.filter(u => u.role === roleFilter);
        }

        if (statusFilter && statusFilter !== 'all') {
            if (statusFilter === 'active') {
                filtered = filtered.filter(u => u.accountCategory === 'active');
            } else if (statusFilter === 'disabled' || statusFilter === 'inactive') {
                filtered = filtered.filter(u => u.accountCategory === 'inactive');
            } else if (statusFilter === 'pending') {
                filtered = filtered.filter(u => u.accountCategory === 'pending');
            }
        }

        if (shopIdFilter && shopIdFilter !== 'all') {
            filtered = filtered.filter(u => u.assignedShop?.id === shopIdFilter);
        }

        if (search) {
            filtered = filtered.filter(u =>
                (u.name ?? '').toLowerCase().includes(search) ||
                (u.email ?? '').toLowerCase().includes(search) ||
                (u.phone ?? '').toLowerCase().includes(search) ||
                (u.assignedShop?.name ?? '').toLowerCase().includes(search)
            );
        }

        // Sort: newest first
        filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

        // Pagination
        let paginatedUsers = filtered;
        let paginationMeta = {
            total: filtered.length,
            page: 1,
            limit: filtered.length,
            totalPages: 1,
        };

        if (pageParam) {
            const pageNum = Math.max(1, parseInt(pageParam, 10) || 1);
            const limitNum = Math.min(100, Math.max(1, parseInt(limitParam || '20', 10) || 20));
            const total = filtered.length;
            const totalPages = Math.ceil(total / limitNum) || 1;
            paginatedUsers = filtered.slice((pageNum - 1) * limitNum, pageNum * limitNum);
            paginationMeta = {
                total,
                page: pageNum,
                limit: limitNum,
                totalPages,
            };
        }

        // Also provide customer-only array for backwards compatibility
        const customers = paginatedUsers.filter(u => u.role === 'customer');

        return NextResponse.json({
            summary,
            pagination: paginationMeta,
            users: paginatedUsers,
            customers,
        }, {
            status: 200,
            headers: { 'Cache-Control': 'no-store' },
        });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}

/** POST /api/admin/users
 *  Create a new customer or vendor account.
 *  - Default role = 'customer'
 *  - Role 'admin' is strictly forbidden
 *  - If role = 'vendor', requires an existing shop assignment
 *  - Password handled server-side only; never returned or stored in plain text
 */
export async function POST(req: NextRequest) {
    const auth = await requireAdminAuth(req);
    if (!auth.authorized) {
        return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    try {
        const body = await req.json();
        const {
            email,
            password,
            fullName,
            phone,
            role: rawRole,
            shopId,
            shopName,
            shopAddress,
            shopContactPhone,
            openingTime,
            closingTime,
        } = body;

        const role = (rawRole || 'customer').trim().toLowerCase();

        // Security check: Never permit creating admin accounts
        if (role === 'admin') {
            return NextResponse.json(
                { error: 'Forbidden: Assigning administrator role via this endpoint is strictly prohibited.' },
                { status: 403 }
            );
        }

        if (role !== 'customer' && role !== 'vendor') {
            return NextResponse.json(
                { error: "Invalid role specified. Permitted roles are 'customer' and 'vendor'." },
                { status: 400 }
            );
        }

        if (!email || typeof email !== 'string' || !email.includes('@')) {
            return NextResponse.json({ error: 'A valid email address is required.' }, { status: 400 });
        }

        if (!password || typeof password !== 'string' || password.length < 6) {
            return NextResponse.json({ error: 'Password must be at least 6 characters.' }, { status: 400 });
        }

        const sb = getServiceRoleClient();

        // If vendor: require either new shop fields (primary flow) or existing shopId (legacy/fallback)
        let assignedShop = null;
        if (role === 'vendor') {
            if (shopName) {
                if (!shopName.trim()) {
                    return NextResponse.json({ error: 'Shop Name is required.' }, { status: 400 });
                }
                if (!shopAddress || !shopAddress.trim()) {
                    return NextResponse.json({ error: 'Shop Address is required.' }, { status: 400 });
                }
            } else if (shopId && typeof shopId === 'string') {
                const { data: existingShop, error: shopFindErr } = await sb
                    .from('shops')
                    .select('id, name, status, owner_id')
                    .eq('id', shopId)
                    .maybeSingle();

                if (shopFindErr || !existingShop) {
                    return NextResponse.json({ error: 'Selected shop does not exist.' }, { status: 400 });
                }

                assignedShop = { id: existingShop.id, name: existingShop.name, status: existingShop.status };
            } else {
                return NextResponse.json(
                    { error: 'Print shop details (Shop Name and Shop Address) are required when creating a vendor account.' },
                    { status: 400 }
                );
            }
        }

        // Check duplicate email
        const cleanEmail = email.trim().toLowerCase();
        const { data: existingAuthUsers } = await sb.auth.admin.listUsers({ perPage: 1000, page: 1 });
        const emailInUse = (existingAuthUsers?.users ?? []).some(u => u.email?.toLowerCase() === cleanEmail);
        if (emailInUse) {
            return NextResponse.json(
                { error: 'A user with this email address already exists.' },
                { status: 400 }
            );
        }

        // Phone normalization (E.164)
        let normalizedPhone: string | null = null;
        if (phone && typeof phone === 'string' && phone.trim()) {
            normalizedPhone = normalizePhoneNumber(phone);
            if (!normalizedPhone) {
                return NextResponse.json(
                    { error: 'Invalid phone format. Please provide a valid 10-digit Indian mobile number.' },
                    { status: 400 }
                );
            }
        }

        // Prepare user metadata
        const userMeta: Record<string, string> = { full_name: fullName ? fullName.trim() : '' };
        if (normalizedPhone) {
            userMeta.phone = normalizedPhone;
        }

        // Create Supabase Auth user server-side
        const { data: created, error: createErr } = await sb.auth.admin.createUser({
            email: cleanEmail,
            password,
            email_confirm: true,
            user_metadata: userMeta,
        });

        if (createErr) {
            if (createErr.message.includes('already registered') || createErr.message.includes('already exists')) {
                return NextResponse.json({ error: 'A user with this email address already exists.' }, { status: 400 });
            }
            throw new Error(createErr.message);
        }

        const newUserId = created.user!.id;

        // Upsert profile
        const { error: profileUpsertErr } = await sb.from('profiles').upsert({
            user_id: newUserId,
            full_name: fullName ? fullName.trim() : null,
            phone: normalizedPhone,
            role,
        }, { onConflict: 'user_id' });

        if (profileUpsertErr) {
            await sb.auth.admin.deleteUser(newUserId);
            throw new Error(`Profile creation failed: ${profileUpsertErr.message}`);
        }

        // Handle shop creation or binding for vendor
        if (role === 'vendor') {
            if (shopName) {
                const formatTime = (t?: string | null, fallback = '09:00:00') => {
                    if (!t || typeof t !== 'string' || !t.trim()) return fallback;
                    const clean = t.trim();
                    if (/^\d{2}:\d{2}$/.test(clean)) return `${clean}:00`;
                    if (/^\d{2}:\d{2}:\d{2}$/.test(clean)) return clean;
                    return fallback;
                };

                const shopDesc = [
                    shopAddress.trim(),
                    shopContactPhone?.trim() ? `Contact: ${shopContactPhone.trim()}` : null,
                ].filter(Boolean).join(' | ');

                const { data: createdShop, error: shopCreateErr } = await sb
                    .from('shops')
                    .insert({
                        owner_id: newUserId,
                        name: shopName.trim(),
                        description: shopDesc,
                        status: 'OPEN',
                        open_time: formatTime(openingTime, '09:00:00'),
                        close_time: formatTime(closingTime, '18:00:00'),
                        closing_soon: false,
                    })
                    .select('id, name, status')
                    .single();

                if (shopCreateErr) {
                    await sb.auth.admin.deleteUser(newUserId);
                    throw new Error(`Failed to create print shop: ${shopCreateErr.message}`);
                }

                assignedShop = { id: createdShop.id, name: createdShop.name, status: createdShop.status };
            } else if (shopId) {
                const { error: shopUpdateErr } = await sb
                    .from('shops')
                    .update({ owner_id: newUserId })
                    .eq('id', shopId);

                if (shopUpdateErr) {
                    console.error('[AdminUsers] Failed to bind shop owner:', shopUpdateErr);
                }
            }
        }

        let inviteLink: string | null = null;
        if (body.sendInvite) {
            try {
                const { data: linkData } = await sb.auth.admin.generateLink({
                    type: 'recovery',
                    email: cleanEmail,
                });
                inviteLink = linkData?.properties?.action_link ?? null;
            } catch (linkErr) {
                console.warn('[AdminUsers] Failed to generate invite link:', linkErr);
            }
        }

        return NextResponse.json({
            user: {
                userId: newUserId,
                name: fullName ? fullName.trim() : null,
                fullName: fullName ? fullName.trim() : null,
                email: created.user!.email,
                phone: normalizedPhone,
                role,
                assignedShop,
                shop: assignedShop ? { shopId: assignedShop.id, shopName: assignedShop.name, shopStatus: assignedShop.status } : null,
                accountStatus: 'active',
                accountCategory: 'active',
                isDisabled: false,
                isPending: false,
                orderCount: 0,
                completedOrders: 0,
                paidOrders: 0,
                grossSpend: 0,
                refundAmount: 0,
                netSpend: 0,
                latestOrderAt: null,
                lastSignInAt: null,
                createdAt: created.user!.created_at,
                created: created.user!.created_at,
            },
            inviteLink,
        }, { status: 201 });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return NextResponse.json({ error: msg }, { status: 400 });
    }
}

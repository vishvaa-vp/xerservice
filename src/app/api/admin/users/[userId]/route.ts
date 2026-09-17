import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAuth } from '@/lib/admin-auth';
import { getServiceRoleClient } from '@/lib/supabase/server';
import { normalizePhoneNumber } from '@/lib/phone';

export const runtime = 'nodejs';

/** GET /api/admin/users/[userId]
 *  Returns full user profile + assigned shop + order history.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
    const auth = await requireAdminAuth(req);
    if (!auth.authorized) {
        return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { userId } = await params;
    const sb = getServiceRoleClient();

    try {
        // Auth user info
        const { data: authUser, error: authErr } = await sb.auth.admin.getUserById(userId);
        if (authErr || !authUser?.user) {
            return NextResponse.json({ error: 'User not found.' }, { status: 404 });
        }

        // Profile
        const { data: profile, error: profileErr } = await sb
            .from('profiles')
            .select('user_id, full_name, phone, role, created_at, updated_at')
            .eq('user_id', userId)
            .maybeSingle();

        if (profileErr) throw new Error(profileErr.message);

        // Assigned shop (if vendor)
        const { data: assignedShop } = await sb
            .from('shops')
            .select('id, name, status')
            .eq('owner_id', userId)
            .maybeSingle();

        // Orders
        const { data: orders, error: ordersErr } = await sb
            .from('orders')
            .select('id, order_number, status, payment_status, total_amount, created_at')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(10);

        if (ordersErr) throw new Error(ordersErr.message);

        const { count: orderCount } = await sb
            .from('orders')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', userId);

        const u = authUser.user;
        const isDisabled = u.banned_until ? new Date(u.banned_until) > new Date() : false;

        return NextResponse.json({
            user: {
                userId: u.id,
                name: profile?.full_name ?? null,
                fullName: profile?.full_name ?? null,
                email: u.email ?? null,
                phone: profile?.phone ?? null,
                role: profile?.role ?? 'customer',
                assignedShop: assignedShop ? { id: assignedShop.id, name: assignedShop.name, status: assignedShop.status } : null,
                shop: assignedShop ? { shopId: assignedShop.id, shopName: assignedShop.name, shopStatus: assignedShop.status } : null,
                accountStatus: isDisabled ? 'disabled' : 'active',
                isDisabled,
                bannedUntil: u.banned_until ?? null,
                lastSignInAt: u.last_sign_in_at ?? null,
                createdAt: profile?.created_at ?? u.created_at,
                created: profile?.created_at ?? u.created_at,
                updatedAt: profile?.updated_at ?? null,
                orderCount: orderCount ?? 0,
                recentOrders: orders ?? [],
            }
        }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}

/** PATCH /api/admin/users/[userId]
 *  Actions: disable | enable | update (fullName, phone, role, shopId)
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
    const auth = await requireAdminAuth(req);
    if (!auth.authorized) {
        return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { userId } = await params;
    const sb = getServiceRoleClient();

    try {
        const body = await req.json();
        const { action, fullName, phone, role: newRole, shopId } = body;

        if (!action) {
            return NextResponse.json({ error: 'action is required (disable | enable | update).' }, { status: 400 });
        }

        // Fetch target profile to verify permissions
        const { data: targetProfile } = await sb
            .from('profiles')
            .select('role')
            .eq('user_id', userId)
            .maybeSingle();

        if (action === 'disable') {
            // Self-disable guard
            if (auth.user?.userId === userId) {
                return NextResponse.json({ error: 'Cannot disable your own administrator account.' }, { status: 400 });
            }

            // Protect other admins from being disabled
            if (targetProfile?.role === 'admin') {
                return NextResponse.json({ error: 'Administrator accounts cannot be disabled via this interface.' }, { status: 403 });
            }

            // Ban for 100 years (~876600 hours)
            const { error } = await sb.auth.admin.updateUserById(userId, { ban_duration: '876600h' });
            if (error) throw new Error(error.message);
            return NextResponse.json({ success: true, action: 'disable' }, { status: 200 });
        }

        if (action === 'enable') {
            const { error } = await sb.auth.admin.updateUserById(userId, { ban_duration: 'none' });
            if (error) throw new Error(error.message);
            return NextResponse.json({ success: true, action: 'enable' }, { status: 200 });
        }

        if (action === 'update') {
            // Security: Strictly forbid role escalation to admin
            if (newRole === 'admin') {
                return NextResponse.json(
                    { error: 'Forbidden: Assigning administrator role via this endpoint is strictly prohibited.' },
                    { status: 403 }
                );
            }

            // Security: Forbid modifying existing admin accounts via general user management
            if (targetProfile?.role === 'admin') {
                return NextResponse.json(
                    { error: 'Modifying administrator accounts is not permitted through this endpoint.' },
                    { status: 403 }
                );
            }

            const updates: Record<string, string | null> = {};
            if (fullName !== undefined) updates.full_name = fullName ? fullName.trim() : null;

            if (phone !== undefined) {
                if (phone && typeof phone === 'string' && phone.trim()) {
                    const normalized = normalizePhoneNumber(phone);
                    if (!normalized) {
                        return NextResponse.json({ error: 'Invalid phone format. Please provide a valid 10-digit Indian mobile number.' }, { status: 400 });
                    }
                    updates.phone = normalized;
                } else {
                    updates.phone = null;
                }
            }

            if (newRole !== undefined) {
                if (newRole !== 'customer' && newRole !== 'vendor') {
                    return NextResponse.json({ error: "Invalid role. Role must be 'customer' or 'vendor'." }, { status: 400 });
                }
                updates.role = newRole;
            }

            // If switching to vendor or reassigning shop
            if (newRole === 'vendor' || (targetProfile?.role === 'vendor' && shopId !== undefined)) {
                if (shopId) {
                    const { data: validShop } = await sb
                        .from('shops')
                        .select('id')
                        .eq('id', shopId)
                        .maybeSingle();

                    if (!validShop) {
                        return NextResponse.json({ error: 'Specified shop does not exist.' }, { status: 400 });
                    }

                    // Unassign vendor from previous shop if any
                    await sb.from('shops').update({ owner_id: null }).eq('owner_id', userId);
                    // Assign new shop
                    await sb.from('shops').update({ owner_id: userId }).eq('id', shopId);
                }
            } else if (newRole === 'customer' && targetProfile?.role === 'vendor') {
                // Unassign any shop owned by this vendor when changing role to customer
                await sb.from('shops').update({ owner_id: null }).eq('owner_id', userId);
            }

            if (Object.keys(updates).length > 0) {
                const { error } = await sb.from('profiles').update(updates).eq('user_id', userId);
                if (error) throw new Error(error.message);
            }

            return NextResponse.json({ success: true, action: 'update' }, { status: 200 });
        }

        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}

/** DELETE /api/admin/users/[userId]
 *  Permanently deletes an account ONLY if it has NO historical orders or financial records.
 *  If protected historical records exist, strictly rejects with 409 Conflict.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
    const auth = await requireAdminAuth(req);
    if (!auth.authorized) {
        return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { userId } = await params;
    const sb = getServiceRoleClient();

    try {
        // Self-delete guard
        if (auth.user?.userId === userId) {
            return NextResponse.json({ error: 'Cannot delete your own administrator account.' }, { status: 400 });
        }

        // Fetch target profile
        const { data: targetProfile } = await sb
            .from('profiles')
            .select('user_id, role, full_name')
            .eq('user_id', userId)
            .maybeSingle();

        if (targetProfile?.role === 'admin') {
            return NextResponse.json({ error: 'Administrator accounts cannot be deleted.' }, { status: 403 });
        }

        // 1. Audit Check: Orders placed by this user
        const { count: userOrdersCount } = await sb
            .from('orders')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', userId);

        // 2. Audit Check: If vendor, check if vendor's shop(s) have orders
        let vendorShopOrdersCount = 0;
        const { data: ownedShops } = await sb
            .from('shops')
            .select('id')
            .eq('owner_id', userId);

        if (ownedShops && ownedShops.length > 0) {
            const shopIds = ownedShops.map(s => s.id);
            const { count: shopOrders } = await sb
                .from('orders')
                .select('id', { count: 'exact', head: true })
                .in('shop_id', shopIds);
            vendorShopOrdersCount = shopOrders ?? 0;
        }

        // 3. Audit Check: Financial Ledger
        const { count: ledgerCount } = await sb
            .from('order_financial_ledger')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', userId);

        // 4. Audit Check: Refunds
        const { count: refundsCount } = await sb
            .from('refund_requests')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', userId);

        // 5. Audit Check: Receipts
        const { count: receiptsCount } = await sb
            .from('order_receipts')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', userId);

        // 6. Audit Check: Wallet Transactions
        const { count: walletTxCount } = await sb
            .from('wallet_transactions')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', userId);

        const totalProtectedRecords =
            (userOrdersCount ?? 0) +
            vendorShopOrdersCount +
            (ledgerCount ?? 0) +
            (refundsCount ?? 0) +
            (receiptsCount ?? 0) +
            (walletTxCount ?? 0);

        if (totalProtectedRecords > 0) {
            return NextResponse.json({
                error: 'Account cannot be permanently deleted because it has protected historical records that must be retained for audit integrity. You can disable the account instead.',
                canDelete: false,
                isProtected: true,
                details: {
                    userOrders: userOrdersCount ?? 0,
                    vendorShopOrders: vendorShopOrdersCount,
                    ledgerEntries: ledgerCount ?? 0,
                    refundRequests: refundsCount ?? 0,
                    receipts: receiptsCount ?? 0,
                    walletTransactions: walletTxCount ?? 0,
                },
            }, { status: 409 });
        }

        // Account is safe for permanent deletion:
        // A. If vendor owns empty shops, delete unutilized shops
        if (ownedShops && ownedShops.length > 0) {
            for (const s of ownedShops) {
                // Delete any shop add-on assignments first
                await sb.from('shop_addon_assignments').delete().eq('shop_id', s.id);
                // Delete shop
                await sb.from('shops').delete().eq('id', s.id);
            }
        }

        // B. Clean up disposable non-financial records
        await sb.from('notifications').delete().eq('user_id', userId);
        await sb.from('notification_outbox').delete().eq('user_id', userId);
        await sb.from('wallet_accounts').delete().eq('user_id', userId);

        // C. Delete profile
        await sb.from('profiles').delete().eq('user_id', userId);

        // D. Delete Supabase Auth user
        const { error: authDelErr } = await sb.auth.admin.deleteUser(userId);
        if (authDelErr) {
            throw new Error(`Failed to delete auth user: ${authDelErr.message}`);
        }

        return NextResponse.json({
            success: true,
            deletedUserId: userId,
            message: 'Account permanently deleted.',
        }, { status: 200 });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}

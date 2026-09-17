import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAuth } from '@/lib/admin-auth';
import { getServiceRoleClient } from '@/lib/supabase/server';
import { normalizePhoneNumber } from '@/lib/phone';

export const runtime = 'nodejs';

/** GET /api/admin/vendors/[userId]
 *  Returns full vendor profile + assigned shop + order stats.
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
            return NextResponse.json({ error: 'Vendor not found.' }, { status: 404 });
        }

        // Profile
        const { data: profile, error: profileErr } = await sb
            .from('profiles')
            .select('user_id, full_name, phone, role, created_at, updated_at')
            .eq('user_id', userId)
            .maybeSingle();

        if (profileErr) throw new Error(profileErr.message);

        // Assigned shop (owner_id = userId)
        const { data: shop, error: shopErr } = await sb
            .from('shops')
            .select('id, name, description, status, open_time, close_time')
            .eq('owner_id', userId)
            .maybeSingle();

        if (shopErr) throw new Error(shopErr.message);

        const u = authUser.user;
        const isDisabled = u.banned_until ? new Date(u.banned_until) > new Date() : false;

        return NextResponse.json({
            vendor: {
                userId: u.id,
                email: u.email ?? null,
                fullName: profile?.full_name ?? null,
                phone: profile?.phone ?? null,
                role: profile?.role ?? 'vendor',
                isDisabled,
                bannedUntil: u.banned_until ?? null,
                lastSignInAt: u.last_sign_in_at ?? null,
                createdAt: profile?.created_at ?? u.created_at,
                updatedAt: profile?.updated_at ?? null,
                shop: shop ? {
                    shopId: shop.id,
                    shopName: shop.name,
                    shopDescription: shop.description,
                    shopStatus: shop.status,
                    openTime: shop.open_time,
                    closeTime: shop.close_time,
                } : null,
            }
        }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}

/** PATCH /api/admin/vendors/[userId]
 *  Actions: disable | enable | assign_shop | update (fullName, phone)
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
        const { action, shopId, fullName, phone } = body;

        if (!action) {
            return NextResponse.json({ error: 'action is required (disable | enable | assign_shop | update).' }, { status: 400 });
        }

        if (action === 'disable') {
            const { error } = await sb.auth.admin.updateUserById(userId, { ban_duration: '876600h' });
            if (error) throw new Error(error.message);
            return NextResponse.json({ success: true, action: 'disable' }, { status: 200 });
        }

        if (action === 'enable') {
            const { error } = await sb.auth.admin.updateUserById(userId, { ban_duration: 'none' });
            if (error) throw new Error(error.message);
            return NextResponse.json({ success: true, action: 'enable' }, { status: 200 });
        }

        if (action === 'assign_shop') {
            if (!shopId || typeof shopId !== 'string') {
                return NextResponse.json({ error: 'shopId is required for assign_shop action.' }, { status: 400 });
            }
            // Unassign vendor from any shop they currently own
            await sb.from('shops').update({ owner_id: null }).eq('owner_id', userId);

            // Assign the new shop
            const { data: shopRow, error: shopErr } = await sb
                .from('shops')
                .update({ owner_id: userId })
                .eq('id', shopId)
                .select('id, name, status')
                .maybeSingle();

            if (shopErr) throw new Error(shopErr.message);

            return NextResponse.json({ success: true, action: 'assign_shop', shop: shopRow }, { status: 200 });
        }

        if (action === 'update') {
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

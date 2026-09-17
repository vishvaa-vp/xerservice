import { NextRequest, NextResponse } from 'next/server';
import { getServiceRoleClient, verifyCustomerToken } from '@/lib/supabase/server';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
    const headers = { 'Cache-Control': 'no-store' };
    const fail = (error: string, status = 400) =>
        NextResponse.json({ error }, { status, headers });

    // 1. Authenticate Request
    const authHeader = req.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return fail('Authentication required. Please sign in.', 401);
    }
    const token = authHeader.slice(7).trim();

    let authUser: { userId: string; email?: string } | null = null;
    try {
        authUser = await verifyCustomerToken(token);
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return fail(`Authentication failed: ${msg}`, 401);
    }

    if (!authUser || !authUser.userId) {
        return fail('Session invalid or expired. Please sign in again.', 401);
    }

    const serviceClient = getServiceRoleClient();
    const userId = authUser.userId;

    try {
        // 2. Check for in-progress orders (QUEUED, PRINTING, READY)
        const { data: activeOrders, error: activeErr } = await serviceClient
            .from('orders')
            .select('id, order_number, status')
            .eq('user_id', userId)
            .in('status', ['QUEUED', 'PRINTING', 'READY']);

        if (activeErr) {
            console.error('[AccountDelete] Error querying active orders:', activeErr);
            return fail('Could not verify active order status. Please try again later.');
        }

        if (activeOrders && activeOrders.length > 0) {
            const orderRefs = activeOrders.map(o => o.order_number || o.id.slice(0, 8)).join(', ');
            return fail(`Cannot delete account while you have ${activeOrders.length} active print order(s) in progress (${orderRefs}). Please wait until your orders are collected or cancelled.`);
        }

        // 3. Clean up DRAFT orders and their temporary storage files
        const { data: draftOrders } = await serviceClient
            .from('orders')
            .select('id')
            .eq('user_id', userId)
            .eq('status', 'DRAFT');

        if (draftOrders && draftOrders.length > 0) {
            const draftIds = draftOrders.map(d => d.id);
            const { data: draftFiles } = await serviceClient
                .from('order_files')
                .select('storage_path')
                .in('order_id', draftIds);

            if (draftFiles && draftFiles.length > 0) {
                const paths = draftFiles.map(f => f.storage_path).filter(Boolean);
                if (paths.length > 0) {
                    await serviceClient.storage.from('order-documents').remove(paths);
                }
            }

            await serviceClient.from('order_files').delete().in('order_id', draftIds);
            await serviceClient.from('orders').delete().in('id', draftIds);
        }

        // 4. Clean up user notifications
        await serviceClient.from('notifications').delete().eq('user_id', userId);

        // 5. Anonymize PII in public.profiles (financial orders retain restricted FK reference)
        await serviceClient.from('profiles').update({
            full_name: 'Deleted Account',
            phone: null,
            avatar_url: null,
            updated_at: new Date().toISOString()
        }).eq('user_id', userId);

        // 6. Anonymize auth.users email to immediately free original email for re-registration
        const freedEmail = `deleted_${Date.now()}_${userId.replace(/-/g, '').slice(0, 12)}@deleted.xerservice.internal`;
        const { error: authUpdateErr } = await serviceClient.auth.admin.updateUserById(userId, {
            email: freedEmail,
            user_metadata: {
                full_name: 'Deleted Account',
                deleted_at: new Date().toISOString()
            }
        });

        if (authUpdateErr) {
            console.error('[AccountDelete] Failed to anonymize auth user email:', authUpdateErr);
            // Non-fatal if profile was anonymized, but log error
        }

        // 7. Revoke all active sessions
        await serviceClient.auth.admin.signOut(userId, 'global').catch(() => {});

        return NextResponse.json({
            success: true,
            message: 'Your account has been deleted and personal information anonymized.'
        }, { headers });

    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[AccountDelete] Unexpected error during account deletion:', err);
        return fail(`Failed to delete account: ${msg}`, 500);
    }
}

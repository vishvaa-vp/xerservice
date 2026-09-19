import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAuth } from '@/lib/admin-auth';
import { getServiceRoleClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

/**
 * POST /api/admin/users/[userId]/delete-request
 * Action: 'approve' | 'reject'
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
    const auth = await requireAdminAuth(req);
    if (!auth.authorized) {
        return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { userId } = await params;
    const body = await req.json().catch(() => ({}));
    const action = body.action || 'reject'; // 'approve' | 'reject'
    const sb = getServiceRoleClient();

    try {
        const { data: authData, error: authErr } = await sb.auth.admin.getUserById(userId);
        if (authErr || !authData.user) {
            return NextResponse.json({ error: 'User not found.' }, { status: 404 });
        }

        if (action === 'reject') {
            // Reject deletion request and restore account
            const currentMeta = authData.user.user_metadata || {};
            await sb.auth.admin.updateUserById(userId, {
                user_metadata: {
                    ...currentMeta,
                    delete_request: null,
                },
            });

            // Notify user
            try {
                await sb.from('notifications').insert({
                    user_id: userId,
                    title: 'Account Deletion Request Cancelled',
                    message: body.reason || 'Your account deletion request was reviewed and cancelled by the administrator.',
                    type: 'info',
                });
            } catch {
                // Non-fatal notification failure
            }

            return NextResponse.json({
                success: true,
                message: 'Account deletion request has been rejected and cancelled.',
            });
        }

        if (action === 'approve') {
            // Check active in-flight orders
            const { data: activeOrders } = await sb
                .from('orders')
                .select('id, order_number, status')
                .eq('user_id', userId)
                .in('status', ['QUEUED', 'PRINTING', 'READY']);

            if (activeOrders && activeOrders.length > 0) {
                return NextResponse.json({
                    error: `Cannot approve deletion while user has ${activeOrders.length} active print order(s) in progress.`
                }, { status: 400 });
            }

            // Clean up DRAFT orders and their temporary storage files
            const { data: draftOrders } = await sb
                .from('orders')
                .select('id')
                .eq('user_id', userId)
                .eq('status', 'DRAFT');

            if (draftOrders && draftOrders.length > 0) {
                const draftIds = draftOrders.map(d => d.id);
                const { data: draftFiles } = await sb
                    .from('order_files')
                    .select('storage_path')
                    .in('order_id', draftIds);

                if (draftFiles && draftFiles.length > 0) {
                    const paths = draftFiles.map(f => f.storage_path).filter(Boolean);
                    if (paths.length > 0) {
                        try {
                            await sb.storage.from('order-documents').remove(paths);
                        } catch {
                            // Non-fatal
                        }
                    }
                }

                try {
                    await sb.from('order_files').delete().in('order_id', draftIds);
                    await sb.from('orders').delete().in('id', draftIds);
                } catch {
                    // Non-fatal
                }
            }

            // Check if user has protected historical financial records
            const { count: userOrdersCount } = await sb
                .from('orders')
                .select('id', { count: 'exact', head: true })
                .eq('user_id', userId);

            const { count: ledgerCount } = await sb
                .from('order_financial_ledger')
                .select('id', { count: 'exact', head: true })
                .eq('user_id', userId);

            const { count: refundsCount } = await sb
                .from('refund_requests')
                .select('id', { count: 'exact', head: true })
                .eq('user_id', userId);

            const { count: receiptsCount } = await sb
                .from('order_receipts')
                .select('id', { count: 'exact', head: true })
                .eq('user_id', userId);

            const { count: walletTxCount } = await sb
                .from('wallet_transactions')
                .select('id', { count: 'exact', head: true })
                .eq('user_id', userId);

            const hasProtectedRecords =
                (userOrdersCount ?? 0) > 0 ||
                (ledgerCount ?? 0) > 0 ||
                (refundsCount ?? 0) > 0 ||
                (receiptsCount ?? 0) > 0 ||
                (walletTxCount ?? 0) > 0;

            if (hasProtectedRecords) {
                // Retention-Safe PII Anonymization
                try {
                    await sb.from('notifications').delete().eq('user_id', userId);
                } catch {}

                await sb.from('profiles').update({
                    full_name: 'Deleted Account',
                    phone: null,
                    avatar_url: null,
                    updated_at: new Date().toISOString()
                }).eq('user_id', userId);

                const freedEmail = `deleted_${Date.now()}_${userId.replace(/-/g, '').slice(0, 12)}@deleted.xerservice.internal`;
                await sb.auth.admin.updateUserById(userId, {
                    email: freedEmail,
                    user_metadata: {
                        full_name: 'Deleted Account',
                        deleted_at: new Date().toISOString(),
                        delete_request: null,
                    }
                });

                try {
                    await sb.auth.admin.signOut(userId, 'global');
                } catch {}

                return NextResponse.json({
                    success: true,
                    message: 'Account deletion approved and user personal details safely anonymized.',
                });
            } else {
                // Complete Deletion for accounts with 0 historical records
                try {
                    await sb.from('notifications').delete().eq('user_id', userId);
                    await sb.from('notification_outbox').delete().eq('user_id', userId);
                    await sb.from('wallet_accounts').delete().eq('user_id', userId);
                    await sb.from('profiles').delete().eq('user_id', userId);
                    await sb.auth.admin.deleteUser(userId);
                } catch {
                    // Non-fatal
                }

                return NextResponse.json({
                    success: true,
                    message: 'Account permanently deleted.',
                });
            }
        }

        return NextResponse.json({ error: 'Invalid action.' }, { status: 400 });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}

import { NextRequest, NextResponse } from 'next/server';
import { getServiceRoleClient, verifyCustomerToken } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

/**
 * GET /api/customer/account/delete-request
 * Check current deletion request status for the customer.
 */
export async function GET(req: NextRequest) {
    const headers = { 'Cache-Control': 'no-store' };
    const authHeader = req.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return NextResponse.json({ error: 'Authentication required.' }, { status: 401, headers });
    }

    try {
        const token = authHeader.slice(7).trim();
        const verified = await verifyCustomerToken(token);
        if (!verified || !verified.userId) {
            return NextResponse.json({ error: 'Session invalid or expired.' }, { status: 401, headers });
        }

        const sb = getServiceRoleClient();
        const { data: authData, error: authErr } = await sb.auth.admin.getUserById(verified.userId);
        if (authErr || !authData.user) {
            return NextResponse.json({ error: 'Account not found.' }, { status: 404, headers });
        }

        const deleteRequest = authData.user.user_metadata?.delete_request || null;
        return NextResponse.json({
            deleteRequest: deleteRequest?.status === 'PENDING' ? deleteRequest : null,
        }, { headers });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return NextResponse.json({ error: msg }, { status: 500, headers });
    }
}

/**
 * POST /api/customer/account/delete-request
 * Submit or cancel an account deletion request.
 */
export async function POST(req: NextRequest) {
    const headers = { 'Cache-Control': 'no-store' };
    const authHeader = req.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return NextResponse.json({ error: 'Authentication required.' }, { status: 401, headers });
    }

    try {
        const token = authHeader.slice(7).trim();
        const verified = await verifyCustomerToken(token);
        if (!verified || !verified.userId) {
            return NextResponse.json({ error: 'Session invalid or expired.' }, { status: 401, headers });
        }

        const body = await req.json().catch(() => ({}));
        const action = body.action || 'request'; // 'request' | 'cancel'
        const sb = getServiceRoleClient();
        const { data: authData, error: authErr } = await sb.auth.admin.getUserById(verified.userId);
        if (authErr || !authData.user) {
            return NextResponse.json({ error: 'Account not found.' }, { status: 404, headers });
        }

        if (action === 'cancel') {
            const currentMeta = authData.user.user_metadata || {};
            const { error: updateErr } = await sb.auth.admin.updateUserById(verified.userId, {
                user_metadata: {
                    ...currentMeta,
                    delete_request: null,
                },
            });

            if (updateErr) {
                return NextResponse.json({ error: `Failed to cancel deletion request: ${updateErr.message}` }, { status: 500, headers });
            }

            return NextResponse.json({
                success: true,
                message: 'Account deletion request has been cancelled.',
                deleteRequest: null,
            }, { headers });
        }

        // Action: 'request'
        const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
        const password = typeof body.password === 'string' ? body.password : '';

        if (!reason || reason.length < 3) {
            return NextResponse.json({ error: 'Please provide a valid reason for account deletion.' }, { status: 400, headers });
        }

        // Password verification (if account has email and password was provided)
        const email = authData.user.email;
        const providers: string[] = authData.user.app_metadata?.providers || [];
        const isEmailAuth = providers.includes('email');

        if (isEmailAuth && password) {
            const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
            const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
            if (supabaseUrl && supabaseAnonKey && email) {
                const client = createClient(supabaseUrl, supabaseAnonKey);
                const { error: signInErr } = await client.auth.signInWithPassword({
                    email,
                    password,
                });
                if (signInErr) {
                    return NextResponse.json({ error: 'Incorrect password. Please verify and try again.' }, { status: 400, headers });
                }
            }
        } else if (isEmailAuth && !password) {
            return NextResponse.json({ error: 'Please enter your password to confirm deletion request.' }, { status: 400, headers });
        }

        // Check for active orders (QUEUED, PRINTING, READY)
        const { data: activeOrders, error: activeErr } = await sb
            .from('orders')
            .select('id, order_number, status')
            .eq('user_id', verified.userId)
            .in('status', ['QUEUED', 'PRINTING', 'READY']);

        if (activeErr) {
            console.error('[DeleteRequest] Error querying active orders:', activeErr);
            return NextResponse.json({ error: 'Could not verify active orders. Please try again.' }, { status: 500, headers });
        }

        if (activeOrders && activeOrders.length > 0) {
            const orderRefs = activeOrders.map(o => o.order_number || o.id.slice(0, 8)).join(', ');
            return NextResponse.json({
                error: `Cannot request deletion while you have ${activeOrders.length} active print order(s) in progress (${orderRefs}). Please collect or cancel them first.`
            }, { status: 400, headers });
        }

        const deleteRequestObj = {
            status: 'PENDING',
            reason,
            requested_at: new Date().toISOString(),
        };

        const currentMeta = authData.user.user_metadata || {};
        const { error: updateErr } = await sb.auth.admin.updateUserById(verified.userId, {
            user_metadata: {
                ...currentMeta,
                delete_request: deleteRequestObj,
            },
        });

        if (updateErr) {
            return NextResponse.json({ error: `Failed to record deletion request: ${updateErr.message}` }, { status: 500, headers });
        }

        return NextResponse.json({
            success: true,
            message: 'Your account deletion request has been submitted for administrative review.',
            deleteRequest: deleteRequestObj,
        }, { headers });

    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return NextResponse.json({ error: msg }, { status: 500, headers });
    }
}

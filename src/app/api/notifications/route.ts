import { NextRequest, NextResponse } from 'next/server';
import { getServiceRoleClient, verifyAuthToken } from '@/lib/supabase/server';

export const runtime = 'nodejs';

/**
 * Tolerates strictly known pre-deployment missing table errors before migration push:
 * - PostgreSQL error code: '42P01' (undefined_table)
 * - PostgREST error code: 'PGRST205' (table not found in schema cache)
 * - Explicit table-not-found relation messages
 *
 * All other errors (PGRST204 column not found, PGRST202 function not found,
 * permission issues, network timeouts, invalid queries)
 * MUST NOT be swallowed and will return HTTP 500.
 */
function isPreDeploymentMissingTableError(error: { code?: string; message?: string } | null): boolean {
    if (!error) return false;
    if (error.code === '42P01') return true;
    if (error.code === 'PGRST205') return true;
    if (typeof error.message === 'string') {
        const lower = error.message.toLowerCase();
        if (
            lower.includes('relation "notifications" does not exist') ||
            lower.includes('relation "public.notifications" does not exist') ||
            lower.includes("could not find the table 'notifications'") ||
            lower.includes("could not find the table 'public.notifications'") ||
            lower.includes("could not find the 'notifications' table")
        ) {
            return true;
        }
    }
    return false;
}

export async function GET(req: NextRequest) {
    const headers = { 'Cache-Control': 'no-store, no-cache, must-revalidate' };
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
        authUser = await verifyAuthToken(token);
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return fail(`Authentication failed: ${msg}`, 401);
    }

    if (!authUser || !authUser.userId) {
        return fail('Session invalid or expired. Please sign in again.', 401);
    }

    const userId = authUser.userId;

    // 2. Load Service Role Client
    let serviceClient;
    try {
        serviceClient = getServiceRoleClient();
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return fail(msg, 503);
    }

    try {
        // 3. Query notifications
        const { data: notifications, error: notifError } = await serviceClient
            .from('notifications')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(50);

        if (notifError) {
            // Handle only explicit pre-push / table not yet migrated errors gracefully
            if (isPreDeploymentMissingTableError(notifError)) {
                return NextResponse.json({ notifications: [], unreadCount: 0 }, { status: 200, headers });
            }
            console.error('[Notifications API] Unexpected error loading notifications:', notifError);
            return fail(`Failed to load notifications: ${notifError.message}`, 500);
        }

        // 4. Query unread count
        const { count, error: countError } = await serviceClient
            .from('notifications')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', userId)
            .eq('is_read', false);

        if (countError) {
            if (isPreDeploymentMissingTableError(countError)) {
                return NextResponse.json({ notifications: [], unreadCount: 0 }, { status: 200, headers });
            }
            console.error('[Notifications API] Unexpected error counting unread notifications:', countError);
            return fail(`Failed to count unread notifications: ${countError.message}`, 500);
        }

        return NextResponse.json({
            notifications: notifications || [],
            unreadCount: count || 0,
        }, { status: 200, headers });

    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return fail(`Unexpected error: ${msg}`, 500);
    }
}

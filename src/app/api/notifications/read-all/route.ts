import { NextRequest, NextResponse } from 'next/server';
import { getServiceRoleClient, verifyAuthToken } from '@/lib/supabase/server';

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
        const { data, error } = await serviceClient
            .from('notifications')
            .update({
                is_read: true,
                read_at: new Date().toISOString(),
            })
            .eq('user_id', userId)
            .eq('is_read', false)
            .select('id');

        if (error) {
            if (error.code === '42P01' || error.message?.includes('does not exist')) {
                return NextResponse.json({ success: true, count: 0 }, { status: 200, headers });
            }
            return fail(`Failed to mark all notifications as read: ${error.message}`, 500);
        }

        const count = data ? data.length : 0;
        return NextResponse.json({ success: true, count }, { status: 200, headers });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return fail(`Unexpected error: ${msg}`, 500);
    }
}

import { NextRequest, NextResponse } from 'next/server';
import { getServiceRoleClient, verifyAuthToken } from '@/lib/supabase/server';

export const runtime = 'nodejs';

interface RouteContext {
    params: Promise<{
        id: string;
    }>;
}

export async function POST(req: NextRequest, context: RouteContext) {
    const headers = { 'Cache-Control': 'no-store' };
    const fail = (error: string, status = 400) =>
        NextResponse.json({ error }, { status, headers });

    const { id } = await context.params;
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!id || !uuidRegex.test(id)) {
        return fail('Invalid notification ID.', 400);
    }

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
            .eq('id', id)
            .eq('user_id', userId)
            .select('id')
            .maybeSingle();

        if (error) {
            if (error.code === '42P01' || error.message?.includes('does not exist')) {
                return NextResponse.json({ success: true, id }, { status: 200, headers });
            }
            return fail(`Failed to mark notification as read: ${error.message}`, 500);
        }

        if (!data) {
            return fail('Notification not found or access denied.', 404);
        }

        return NextResponse.json({ success: true, id: data.id }, { status: 200, headers });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return fail(`Unexpected error: ${msg}`, 500);
    }
}

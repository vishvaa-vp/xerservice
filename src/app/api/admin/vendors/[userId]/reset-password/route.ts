import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAuth } from '@/lib/admin-auth';
import { getServiceRoleClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

/** POST /api/admin/vendors/[userId]/reset-password
 *  Generates a Supabase recovery link and returns it to the admin.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
    const auth = await requireAdminAuth(req);
    if (!auth.authorized) {
        return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { userId } = await params;
    const sb = getServiceRoleClient();

    try {
        // Get user email
        const { data: authUser, error: userErr } = await sb.auth.admin.getUserById(userId);
        if (userErr || !authUser?.user?.email) {
            return NextResponse.json({ error: 'Vendor not found or has no email address.' }, { status: 404 });
        }

        const { data: linkData, error: linkErr } = await sb.auth.admin.generateLink({
            type: 'recovery',
            email: authUser.user.email,
        });

        if (linkErr) throw new Error(linkErr.message);

        const link = linkData?.properties?.action_link ?? null;

        if (!link) {
            return NextResponse.json({ error: 'Failed to generate recovery link.' }, { status: 500 });
        }

        return NextResponse.json({
            success: true,
            link,
            email: authUser.user.email,
        }, { status: 200 });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}

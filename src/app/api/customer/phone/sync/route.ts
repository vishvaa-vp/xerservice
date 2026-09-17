import { NextRequest, NextResponse } from 'next/server';
import { getServiceRoleClient } from '@/lib/supabase/server';
import { syncVerifiedPhoneToProfile } from '@/lib/phone-sync';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
    try {
        const authHeader = req.headers.get('Authorization');
        if (!authHeader?.startsWith('Bearer ')) {
            return NextResponse.json({ error: 'Unauthorized: Missing bearer token' }, { status: 401 });
        }
        const token = authHeader.replace('Bearer ', '').trim();

        const serviceClient = getServiceRoleClient();
        const { data: { user }, error: userError } = await serviceClient.auth.getUser(token);

        if (userError || !user) {
            return NextResponse.json({ error: 'Unauthorized: Invalid token' }, { status: 401 });
        }

        // Trusted sync: reads auth.users.phone for authenticated user.id ONLY.
        // Accepts NO client-supplied phone parameter from the request body!
        const result = await syncVerifiedPhoneToProfile(user.id);

        if (!result.success) {
            const status = result.error?.includes('already linked') ? 409 : 400;
            return NextResponse.json({ error: result.error }, { status });
        }

        return NextResponse.json({
            success: true,
            phone: result.phone,
        });
    } catch (err: any) {
        return NextResponse.json(
            { error: err?.message || 'Internal server error during phone synchronization' },
            { status: 500 }
        );
    }
}

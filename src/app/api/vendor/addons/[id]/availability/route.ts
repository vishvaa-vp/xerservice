import { NextRequest, NextResponse } from 'next/server';
import { getServiceRoleClient, verifyAuthToken } from '@/lib/supabase/server';
import { updateVendorAddonAvailability } from '@/lib/addons-service';

export const runtime = 'nodejs';

interface RouteContext {
    params: Promise<{ id: string }>;
}

export async function PATCH(req: NextRequest, context: RouteContext) {
    const headers = { 'Cache-Control': 'no-store' };

    // 1. Authenticate Request
    const authHeader = req.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return NextResponse.json({ error: 'Authentication required. Please sign in.' }, { status: 401, headers });
    }
    const token = authHeader.slice(7).trim();

    let authUser: { userId: string } | null = null;
    try {
        authUser = await verifyAuthToken(token);
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return NextResponse.json({ error: `Authentication failed: ${msg}` }, { status: 401, headers });
    }

    if (!authUser || !authUser.userId) {
        return NextResponse.json({ error: 'Session invalid or expired.' }, { status: 401, headers });
    }

    const params = await context.params;
    const shopAddonId = params?.id;
    if (!shopAddonId) {
        return NextResponse.json({ error: 'Add-on ID is required.' }, { status: 400, headers });
    }

    // Security enforcement: Vendors are strictly forbidden from modifying or toggling add-ons.
    // All add-on controls (creation, pricing, availability, deletion) are strictly for Admin.
    return NextResponse.json({
        error: 'Forbidden: Vendors cannot enable or disable add-ons. All add-on controls and availability are strictly managed by Admin.'
    }, { status: 403, headers });
}

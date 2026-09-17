import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAuth } from '@/lib/admin-auth';
import { listAdminAddons, createAdminAddon } from '@/lib/addons-service';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
    const auth = await requireAdminAuth(req);
    if (!auth.authorized) {
        return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    try {
        const addons = await listAdminAddons();
        return NextResponse.json({ addons }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    const auth = await requireAdminAuth(req);
    if (!auth.authorized) {
        return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    try {
        const body = await req.json();
        if (!body.name || typeof body.name !== 'string') {
            return NextResponse.json({ error: 'Add-on name is required.' }, { status: 400 });
        }

        const addon = await createAdminAddon({
            name: body.name,
            description: body.description,
            imageUrl: body.imageUrl,
            estimatedMinutes: body.estimatedMinutes ? Number(body.estimatedMinutes) : 0,
            minPages: body.minPages ? Number(body.minPages) : 1,
            maxPages: body.maxPages ? Number(body.maxPages) : 1000,
            price: body.price ? Number(body.price) : 0,
            shopIds: Array.isArray(body.shopIds) ? body.shopIds : undefined,
            shopAssignments: Array.isArray(body.shopAssignments) ? body.shopAssignments : undefined,
        });

        return NextResponse.json({ addon }, { status: 201 });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return NextResponse.json({ error: msg }, { status: 400 });
    }
}

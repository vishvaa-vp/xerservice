import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAuth } from '@/lib/admin-auth';
import { updateAdminAddon, deleteAdminAddon } from '@/lib/addons-service';

export const runtime = 'nodejs';

interface RouteContext {
    params: Promise<{ id: string }>;
}

export async function PUT(req: NextRequest, context: RouteContext) {
    const auth = await requireAdminAuth(req);
    if (!auth.authorized) {
        return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const params = await context.params;
    const id = params?.id;
    if (!id) {
        return NextResponse.json({ error: 'Add-on ID is required.' }, { status: 400 });
    }

    try {
        const body = await req.json();
        const shopAssignments = Array.isArray(body.shopAssignments)
            ? body.shopAssignments
            : Array.isArray(body.shopIds)
                ? body.shopIds.map((shopId: string) => ({
                    shopId,
                    price: body.price !== undefined ? Number(body.price) : undefined,
                    isAvailable: true,
                }))
                : undefined;

        await updateAdminAddon(id, {
            name: body.name,
            description: body.description,
            imageUrl: body.imageUrl,
            estimatedMinutes: body.estimatedMinutes !== undefined ? Number(body.estimatedMinutes) : undefined,
            minPages: body.minPages !== undefined ? Number(body.minPages) : undefined,
            maxPages: body.maxPages !== undefined ? Number(body.maxPages) : undefined,
            isActive: body.isActive !== undefined ? Boolean(body.isActive) : undefined,
            shopAssignments,
        });

        return NextResponse.json({ success: true, message: 'Add-on updated successfully.' });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return NextResponse.json({ error: msg }, { status: 400 });
    }
}

export async function DELETE(req: NextRequest, context: RouteContext) {
    const auth = await requireAdminAuth(req);
    if (!auth.authorized) {
        return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const params = await context.params;
    const id = params?.id;
    if (!id) {
        return NextResponse.json({ error: 'Add-on ID is required.' }, { status: 400 });
    }

    try {
        const result = await deleteAdminAddon(id);
        return NextResponse.json({
            success: true,
            deleted: result.deleted,
            softDisabled: result.softDisabled,
            message: result.softDisabled
                ? 'Add-on has order history and was marked inactive to preserve past orders.'
                : 'Add-on was deleted.',
        });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}

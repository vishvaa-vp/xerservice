import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAuth } from '@/lib/admin-auth';
import { getServiceRoleClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_IMAGE_BYTES = 2 * 1024 * 1024; // 2 MB

export async function POST(req: NextRequest) {
    const auth = await requireAdminAuth(req);
    if (!auth.authorized) {
        return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    try {
        const formData = await req.formData();
        const file = formData.get('file') as File | null;

        if (!file) {
            return NextResponse.json({ error: 'No image file provided.' }, { status: 400 });
        }

        if (!ALLOWED_MIME_TYPES.includes(file.type)) {
            return NextResponse.json({
                error: `Unsupported image format (${file.type}). Allowed formats: PNG, JPEG, WebP.`
            }, { status: 415 });
        }

        if (file.size > MAX_IMAGE_BYTES) {
            return NextResponse.json({
                error: `Image size exceeds 2 MB limit (${Math.round(file.size / 1024)} KB).`
            }, { status: 413 });
        }

        const bytes = await file.arrayBuffer();
        const buffer = Buffer.from(bytes);
        const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
        const filename = `addon_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;

        const serviceClient = getServiceRoleClient();

        const BUCKET_NAME = 'addon-images';

        try {
            const { error: uploadError } = await serviceClient.storage
                .from(BUCKET_NAME)
                .upload(filename, buffer, {
                    contentType: file.type,
                    upsert: true,
                });

            if (uploadError) {
                // Fallback: return data URL
                const base64 = buffer.toString('base64');
                const dataUrl = `data:${file.type};base64,${base64}`;
                return NextResponse.json({ imageUrl: dataUrl }, { status: 200 });
            }

            const { data: publicUrlData } = serviceClient.storage
                .from(BUCKET_NAME)
                .getPublicUrl(filename);

            return NextResponse.json({ imageUrl: publicUrlData.publicUrl }, { status: 200 });
        } catch {
            const base64 = buffer.toString('base64');
            const dataUrl = `data:${file.type};base64,${base64}`;
            return NextResponse.json({ imageUrl: dataUrl }, { status: 200 });
        }
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return NextResponse.json({ error: `Image upload failed: ${msg}` }, { status: 500 });
    }
}

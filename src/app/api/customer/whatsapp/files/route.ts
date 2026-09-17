import { NextRequest, NextResponse } from 'next/server';
import { verifyCustomerToken } from '@/lib/supabase/server';
import { listCustomerWhatsAppFiles } from '@packages/backend/whatsapp';
import { getServiceRoleClient } from '@packages/backend/supabase';
import { listCustomerWhatsAppUploads, prepareWhatsAppUploadForCart } from '@/lib/whatsapp/cart-service';

export const runtime = 'nodejs';

/**
 * GET /api/customer/whatsapp/files
 * Returns all active, validated, unexpired WhatsApp imported files for the authenticated customer.
 * Queries both whatsapp_uploads (downloaded/cart_ready) and whatsapp_imported_files without duplicates.
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
            return NextResponse.json({ error: 'Session expired or invalid.' }, { status: 401, headers });
        }

        // 1. Fetch downloaded / cart_ready files from whatsapp_uploads
        const uploads = await listCustomerWhatsAppUploads(verified.userId);

        // 2. Fetch existing imported files from whatsapp_imported_files
        const backendFiles = await listCustomerWhatsAppFiles(verified.userId);

        const seenIds = new Set<string>();
        const files: Array<{
            id: string;
            originalFilename: string;
            mimeType: string;
            fileSize: number;
            pageCount: number;
            validationStatus: string;
            createdAt: string;
            expiresAt: string;
            storagePath: string;
        }> = [];

        for (const up of uploads) {
            if (up.storage_path) {
                seenIds.add(up.id);
                const expiry = new Date(new Date(up.created_at).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
                files.push({
                    id: up.id,
                    originalFilename: up.filename,
                    mimeType: up.mime_type,
                    fileSize: 0,
                    pageCount: 1,
                    validationStatus: 'valid',
                    createdAt: up.created_at,
                    expiresAt: expiry,
                    storagePath: up.storage_path,
                });
            }
        }

        for (const f of backendFiles) {
            if (!seenIds.has(f.id) && f.storage_path) {
                seenIds.add(f.id);
                files.push({
                    id: f.id,
                    originalFilename: f.original_filename,
                    mimeType: f.mime_type,
                    fileSize: Number(f.file_size) || 0,
                    pageCount: f.page_count || 1,
                    validationStatus: f.validation_status,
                    createdAt: f.created_at,
                    expiresAt: f.expires_at,
                    storagePath: f.storage_path,
                });
            }
        }

        return NextResponse.json(
            {
                success: true,
                files,
            },
            { status: 200, headers }
        );
    } catch (err: unknown) {
        console.error('[GET /api/customer/whatsapp/files] Error:', err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : 'Failed to list WhatsApp files.' },
            { status: 500, headers }
        );
    }
}

/**
 * POST /api/customer/whatsapp/files
 * Converts an imported WhatsApp file into a cart-ready item with print defaults.
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
            return NextResponse.json({ error: 'Session expired or invalid.' }, { status: 401, headers });
        }

        const body = await req.json().catch(() => ({}));
        const { fileId, shopId, color, sides, copies, orientation } = body;

        if (!fileId) {
            return NextResponse.json({ error: 'fileId is required.' }, { status: 400, headers });
        }

        const sb = getServiceRoleClient();

        // 1. Check whatsapp_uploads table first
        const { data: uploadRecord } = await sb
            .from('whatsapp_uploads')
            .select('*')
            .eq('id', fileId)
            .eq('user_id', verified.userId)
            .maybeSingle();

        if (uploadRecord && uploadRecord.storage_path && (uploadRecord.status === 'downloaded' || uploadRecord.status === 'cart_ready')) {
            const prepResult = await prepareWhatsAppUploadForCart(uploadRecord.id, {
                shopId: shopId || '',
                copies: copies || 1,
            });

            if (prepResult.success && prepResult.cartItem) {
                return NextResponse.json(
                    {
                        success: true,
                        message: 'WhatsApp document prepared for cart.',
                        cartItem: {
                            ...prepResult.cartItem,
                            color: color || prepResult.cartItem.color,
                            sides: sides || prepResult.cartItem.sides,
                            orientation: orientation || prepResult.cartItem.orientation,
                        },
                    },
                    { status: 200, headers }
                );
            }
        }

        // 2. Fall back to whatsapp_imported_files
        const { data: file, error: fileErr } = await sb
            .from('whatsapp_imported_files')
            .select('*')
            .eq('id', fileId)
            .eq('user_id', verified.userId)
            .eq('validation_status', 'valid')
            .maybeSingle();

        if (fileErr || !file) {
            return NextResponse.json(
                { error: 'Imported file not found or not yet validated.' },
                { status: 404, headers }
            );
        }

        const cartItem = {
            id: file.id,
            fileName: file.original_filename,
            pages: file.page_count || 1,
            fileSize: file.file_size,
            mimeType: file.mime_type,
            storagePath: file.storage_path,
            source: 'whatsapp' as const,
            shopId: shopId || '',
            color: color || 'bw',
            sides: sides || 'single',
            copies: copies || 1,
            orientation: orientation || 'portrait',
            paperSize: 'a4',
            createdAt: new Date().toISOString(),
        };

        return NextResponse.json(
            {
                success: true,
                message: 'WhatsApp document prepared for cart.',
                cartItem,
            },
            { status: 200, headers }
        );
    } catch (err: unknown) {
        console.error('[POST /api/customer/whatsapp/files] Error:', err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : 'Failed to prepare WhatsApp file for cart.' },
            { status: 500, headers }
        );
    }
}

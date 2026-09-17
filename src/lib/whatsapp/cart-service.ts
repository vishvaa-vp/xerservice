import { getServiceRoleClient } from '../supabase/server';
import type { WhatsAppUploadRecord } from './upload-service';

export interface WhatsAppCartItem {
    id: string;             // WhatsApp upload ID
    uploadId: string;       // Explicit WhatsApp upload ID
    userId: string;         // User ownership
    fileName: string;       // Preserved original filename
    mimeType: string;       // Preserved MIME type
    storagePath: string;    // Preserved exact Supabase storage path (no duplication)
    pages: number;          // Page count
    fileSize?: number;      // File size in bytes if available
    source: 'whatsapp';     // Source tag recognized by XerService cart
    shopId: string;         // Defaults to empty string ('') per XerService convention
    color: 'bw';            // XerService default: black & white
    sides: 'single';        // XerService default: single-sided
    copies: number;         // XerService default: 1 copy
    orientation: 'portrait';// XerService default: portrait
    paperSize: 'a4';        // XerService default: A4
    totalAmount: number;    // Calculated when shop is selected
    createdAt: string;
}

export interface PrepareCartResult {
    success: boolean;
    status: 'cart_ready' | 'skipped_unlinked' | 'rejected_missing_path' | 'rejected_invalid_status' | 'failed';
    error?: string;
    cartItem?: WhatsAppCartItem;
    record?: WhatsAppUploadRecord;
}

/**
 * Reusable function that converts a downloaded WhatsApp upload into the
 * existing XerService file/cart representation.
 *
 * Rules:
 * 1. Only process whatsapp_uploads where:
 *    - status = 'downloaded' (or already 'cart_ready')
 *    - user_id is not null
 *    - storage_path is not null
 * 2. Does NOT duplicate files in Supabase Storage.
 * 3. Preserves: filename, MIME type, storage path, user ownership, upload ID.
 * 4. Uses existing XerService print defaults (a4, bw, single, portrait, copies: 1).
 * 5. Updates whatsapp_uploads.status = 'cart_ready'.
 * 6. Idempotent: Processing twice returns the existing cart item without duplicate records.
 * 7. If user_id is null: do nothing, keep waiting for account linking.
 */
export async function prepareWhatsAppUploadForCart(
    uploadId: string,
    options?: {
        shopId?: string;
        copies?: number;
    }
): Promise<PrepareCartResult> {
    const sb = getServiceRoleClient();

    // 1. Fetch upload record from public.whatsapp_uploads
    const { data: upload, error: fetchErr } = await sb
        .from('whatsapp_uploads')
        .select('*')
        .eq('id', uploadId)
        .maybeSingle();

    if (fetchErr || !upload) {
        return {
            success: false,
            status: 'failed',
            error: `Upload record not found for ID: ${uploadId}`,
        };
    }

    // 2. Rule 9: If user_id is null, do nothing and keep waiting for account linking
    if (!upload.user_id) {
        return {
            success: false,
            status: 'skipped_unlinked',
            error: 'Unlinked upload: user_id is null. Awaiting customer account linking.',
            record: upload as WhatsAppUploadRecord,
        };
    }

    // 3. Rule 1: Validate storage_path is not null
    if (!upload.storage_path) {
        console.warn(`[WhatsApp Cart Service] Upload ${uploadId} is missing storage_path. Cannot prepare cart item.`);
        return {
            success: false,
            status: 'rejected_missing_path',
            error: 'Cannot prepare cart item: storage_path is null. Media must be downloaded first.',
            record: upload as WhatsAppUploadRecord,
        };
    }

    // 4. Rule 1: Validate status
    // Must be 'downloaded' or already 'cart_ready' (for idempotency)
    if (upload.status !== 'downloaded' && upload.status !== 'cart_ready') {
        console.warn(`[WhatsApp Cart Service] Upload ${uploadId} has invalid status '${upload.status}'. Must be 'downloaded'.`);
        return {
            success: false,
            status: 'rejected_invalid_status',
            error: `Invalid status '${upload.status}'. Only downloaded uploads can be prepared for cart.`,
            record: upload as WhatsAppUploadRecord,
        };
    }

    // 5. Build canonical XerService cart item representation with existing defaults
    const cartItem: WhatsAppCartItem = {
        id: upload.id,
        uploadId: upload.id,
        userId: upload.user_id,
        fileName: upload.filename,
        mimeType: upload.mime_type,
        storagePath: upload.storage_path,
        pages: 1, // Default 1 page
        source: 'whatsapp',
        shopId: options?.shopId || '',
        color: 'bw',
        sides: 'single',
        copies: (options?.copies && options.copies > 0) ? options.copies : 1,
        orientation: 'portrait',
        paperSize: 'a4',
        totalAmount: 0,
        createdAt: upload.created_at || new Date().toISOString(),
    };

    // 6. Idempotently ensure presence in whatsapp_imported_files for backward-compatible listing
    const { data: existingImported } = await sb
        .from('whatsapp_imported_files')
        .select('id')
        .eq('id', upload.id)
        .maybeSingle();

    if (!existingImported) {
        await sb.from('whatsapp_imported_files').insert({
            id: upload.id,
            user_id: upload.user_id,
            source_message_id: upload.whatsapp_message_id || upload.id,
            media_id: upload.media_id,
            original_filename: upload.filename,
            storage_path: upload.storage_path,
            mime_type: upload.mime_type,
            file_size: 0,
            page_count: 1,
            validation_status: 'valid',
            expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        });
    }

    // 7. Update whatsapp_uploads.status = 'cart_ready'
    let updatedRecord = upload;
    if (upload.status !== 'cart_ready') {
        const { data: updated, error: updateErr } = await sb
            .from('whatsapp_uploads')
            .update({
                status: 'cart_ready',
                updated_at: new Date().toISOString(),
            })
            .eq('id', upload.id)
            .select('*')
            .single();

        if (!updateErr && updated) {
            updatedRecord = updated;
        }
    }

    return {
        success: true,
        status: 'cart_ready',
        cartItem,
        record: updatedRecord as WhatsAppUploadRecord,
    };
}

/**
 * Lists all cart-ready or downloaded WhatsApp files for a customer.
 * Queries whatsapp_uploads strictly isolated by userId.
 */
export async function listCustomerWhatsAppUploads(userId: string) {
    if (!userId) return [];
    const sb = getServiceRoleClient();

    const { data, error } = await sb
        .from('whatsapp_uploads')
        .select('*')
        .eq('user_id', userId)
        .in('status', ['downloaded', 'cart_ready'])
        .not('storage_path', 'is', null)
        .order('created_at', { ascending: false });

    if (error) {
        console.error('[listCustomerWhatsAppUploads] Error:', error);
        return [];
    }

    return data || [];
}

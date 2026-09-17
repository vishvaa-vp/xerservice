import { getServiceRoleClient } from '../supabase/server';
import { normalizePhoneNumber, normalizePhoneDigits } from '../phone';
import { isMediaDownloadEnabled, processAndStoreWhatsAppUpload } from './media-service';


export interface WhatsAppIncomingMedia {
    messageId: string;
    senderPhone: string;
    type: 'document' | 'image';
    mediaId: string;
    filename: string;
    mimeType: string;
    sha256?: string | null;
}

export interface WhatsAppUploadRecord {
    id: string;
    whatsapp_message_id: string;
    whatsapp_number: string;
    user_id: string | null;
    media_id: string;
    filename: string;
    mime_type: string;
    sha256: string | null;
    storage_path: string | null;
    status: string;
    created_at: string;
    updated_at: string;
}

export interface IngestDocumentResult {
    success: boolean;
    isDuplicate: boolean;
    matchedUser: {
        userId: string;
        fullName?: string | null;
        phone?: string | null;
    } | null;
    record: WhatsAppUploadRecord | null;
}

/**
 * Finds an existing XerService user matching the given phone number.
 * Looks up by canonical Indian E.164 (+91XXXXXXXXXX) in public.profiles,
 * and falls back to active links in public.whatsapp_links.
 */
export async function findUserByPhone(rawPhone: string) {
    const normalizedE164 = normalizePhoneNumber(rawPhone);
    const normalizedDigits = normalizePhoneDigits(rawPhone);
    const sb = getServiceRoleClient();

    if (!normalizedE164) {
        return null;
    }

    // 1. First check public.profiles (verified canonical phone)
    const { data: profile, error: profileErr } = await sb
        .from('profiles')
        .select('user_id, full_name, phone')
        .eq('phone', normalizedE164)
        .maybeSingle();

    if (!profileErr && profile && profile.user_id) {
        return {
            userId: profile.user_id as string,
            fullName: profile.full_name as string | null,
            phone: profile.phone as string | null,
        };
    }

    // 2. Check public.whatsapp_links (active linked WhatsApp account)
    const { data: link, error: linkErr } = await sb
        .from('whatsapp_links')
        .select('user_id, phone_number, sender_id')
        .eq('status', 'active')
        .or(`phone_number.eq.${normalizedE164},sender_id.eq.${normalizedDigits}`)
        .maybeSingle();

    if (!linkErr && link && link.user_id) {
        const { data: linkedProfile } = await sb
            .from('profiles')
            .select('full_name')
            .eq('user_id', link.user_id)
            .maybeSingle();

        return {
            userId: link.user_id as string,
            fullName: linkedProfile?.full_name || null,
            phone: link.phone_number as string | null,
        };
    }

    return null;
}

/**
 * Records an incoming WhatsApp document/media upload into public.whatsapp_uploads.
 * Idempotent: If the message ID already exists, returns the existing record without creating a duplicate.
 */
export async function recordWhatsAppUpload(
    input: WhatsAppIncomingMedia
): Promise<IngestDocumentResult> {
    const sb = getServiceRoleClient();
    const normalizedPhone = normalizePhoneNumber(input.senderPhone) || input.senderPhone;

    // 1. Idempotency Check: see if this WhatsApp message ID has already been recorded
    if (input.messageId) {
        const { data: existing, error: existingErr } = await sb
            .from('whatsapp_uploads')
            .select('*')
            .eq('whatsapp_message_id', input.messageId)
            .maybeSingle();

        if (!existingErr && existing) {
            return {
                success: true,
                isDuplicate: true,
                matchedUser: existing.user_id ? { userId: existing.user_id } : null,
                record: existing as WhatsAppUploadRecord,
            };
        }
    }

    // 2. Look up existing XerService user by phone
    const matchedUser = await findUserByPhone(input.senderPhone);

    // 3. Insert record into public.whatsapp_uploads
    const { data: newUpload, error: insertErr } = await sb
        .from('whatsapp_uploads')
        .insert({
            whatsapp_message_id: input.messageId,
            whatsapp_number: normalizedPhone,
            user_id: matchedUser ? matchedUser.userId : null,
            media_id: input.mediaId,
            filename: input.filename,
            mime_type: input.mimeType,
            sha256: input.sha256 || null,
            storage_path: null,
            status: 'received',
        })
        .select('*')
        .single();

    if (insertErr) {
        // Handle race condition where another concurrent delivery completed first
        if (insertErr.code === '23505') {
            const { data: raceExisting } = await sb
                .from('whatsapp_uploads')
                .select('*')
                .eq('whatsapp_message_id', input.messageId)
                .maybeSingle();

            return {
                success: true,
                isDuplicate: true,
                matchedUser,
                record: raceExisting as WhatsAppUploadRecord,
            };
        }
        console.error('[WhatsApp Webhook] Failed to insert whatsapp_upload record:', insertErr);
        throw insertErr;
    }

    // If live media download is enabled and user is identified, process download in background
    if (isMediaDownloadEnabled() && matchedUser) {
        processAndStoreWhatsAppUpload(newUpload.id).catch(() => {
            console.error('[WhatsApp Webhook] Background media processing failed.');
        });
    }

    return {
        success: true,
        isDuplicate: false,
        matchedUser,
        record: newUpload as WhatsAppUploadRecord,
    };
}

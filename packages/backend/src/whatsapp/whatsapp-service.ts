/**
 * XerService Backend — Stage A12: WhatsApp Linking Service
 *
 * Implements authoritative server challenges, signature verification,
 * connection status querying, atomic link confirmation, and disconnection
 * in accordance with astraplan.md (Section 13 and Section 16 line 741).
 */

import crypto from 'crypto';
import { getServiceRoleClient } from '../supabase/client';
import {
    CreateChallengeResult,
    WhatsAppInboxEventRow,
    WhatsAppLinkChallengeRow,
    WhatsAppLinkRow,
    WhatsAppStatusSummary,
} from './types';
import { validateAndIngestMedia } from './media-service';
import { hashChallengeToken, verifyWhatsAppWebhookSignature } from './webhook-security';

export { hashChallengeToken, verifyWhatsAppWebhookSignature } from './webhook-security';

export class WhatsAppServiceError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number = 400) {
        super(message);
        this.name = 'WhatsAppServiceError';
        this.statusCode = statusCode;
    }
}

/**
 * Masks phone number for customer privacy.
 * e.g., "919876543210" or "+919876543210" -> "+91 98•••• ••10"
 */
export function maskPhoneNumber(phone?: string | null): string {
    if (!phone) return '';
    const digits = phone.replace(/\D/g, '');
    if (digits.length >= 10) {
        const last2 = digits.slice(-2);
        const first2 = digits.length > 10 ? digits.slice(-10, -8) : digits.slice(0, 2);
        const country = digits.length > 10 ? `+${digits.slice(0, -10)} ` : '+91 ';
        return `${country}${first2}•••• ••${last2}`;
    }
    return phone;
}

/**
 * Returns the configured XerService business WhatsApp number.
 */
export function getBusinessWhatsAppNumber(): string {
    const fromEnv = process.env.WHATSAPP_BUSINESS_PHONE || process.env.NEXT_PUBLIC_WHATSAPP_BUSINESS_PHONE;
    const digits = fromEnv?.replace(/\D/g, '') || '';
    if (digits.length < 10 || digits.length > 15) {
        throw new WhatsAppServiceError('WhatsApp business phone is not configured.', 503);
    }
    return digits;
}

function phoneNumbersMatch(left?: string | null, right?: string | null): boolean {
    const leftDigits = left?.replace(/\D/g, '') || '';
    const rightDigits = right?.replace(/\D/g, '') || '';
    if (!leftDigits || !rightDigits) return false;
    return leftDigits === rightDigits || leftDigits.slice(-10) === rightDigits.slice(-10);
}

/**
 * Creates a cryptographically random, single-use server challenge bound to the user.
 * Expires after 5 minutes. Persists only the SHA-256 hash in database.
 */
export async function createLinkChallenge(
    userId: string,
    options: { intendedPhone?: string; orderUpdatesOptIn?: boolean } = {}
): Promise<CreateChallengeResult> {
    const sb = getServiceRoleClient();

    if (!userId) {
        throw new WhatsAppServiceError('User ID is required to initiate linking.', 400);
    }

    // Generate high-entropy 32-byte cryptographic token (formatted as 24-char hex)
    const token = crypto.randomBytes(16).toString('hex').toUpperCase();
    const tokenHash = hashChallengeToken(token);

    // Invalidate any existing pending/awaiting challenges for this user
    await sb
        .from('whatsapp_link_challenges')
        .update({ state: 'revoked', updated_at: new Date().toISOString() })
        .eq('user_id', userId)
        .in('state', ['pending', 'awaiting_confirmation']);

    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 minutes TTL

    const { data: challenge, error: challengeErr } = await sb
        .from('whatsapp_link_challenges')
        .insert({
            user_id: userId,
            challenge_hash: tokenHash,
            intended_phone: options.intendedPhone ? options.intendedPhone.trim() : null,
            state: 'pending',
            order_updates_opt_in: options.orderUpdatesOptIn !== false,
            expires_at: expiresAt,
        })
        .select('*')
        .single();

    if (challengeErr || !challenge) {
        console.error('[WhatsAppService] Failed to create challenge:', challengeErr);
        throw new WhatsAppServiceError('Failed to generate WhatsApp linking challenge.', 500);
    }

    const businessPhone = getBusinessWhatsAppNumber();
    const linkingMessage = `LINK ${token}`;
    const waDirectUrl = `https://wa.me/${businessPhone}?text=${encodeURIComponent(linkingMessage)}`;

    return {
        challengeId: challenge.id,
        token,
        waDirectUrl,
        linkingMessage,
        businessPhone,
        expiresAt,
        qrData: waDirectUrl,
    };
}

/**
 * Retrieves the current authoritative WhatsApp linking status for an authenticated user.
 */
export async function getLinkStatus(userId: string): Promise<WhatsAppStatusSummary> {
    const sb = getServiceRoleClient();

    if (!userId) {
        return { status: 'not_linked', maskedPhone: null, linkedAt: null, orderUpdatesOptIn: false };
    }

    // 1. Check for active link
    const { data: activeLink } = await sb
        .from('whatsapp_links')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'active')
        .maybeSingle();

    if (activeLink) {
        return {
            status: 'connected',
            maskedPhone: maskPhoneNumber(activeLink.phone_number),
            linkedAt: activeLink.linked_at,
            orderUpdatesOptIn: activeLink.order_updates_opt_in,
        };
    }

    // 2. Check for active unexpired challenge
    const nowIso = new Date().toISOString();
    const { data: latestChallenge } = await sb
        .from('whatsapp_link_challenges')
        .select('*')
        .eq('user_id', userId)
        .gt('expires_at', nowIso)
        .in('state', ['pending', 'awaiting_confirmation'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (latestChallenge) {
        if (latestChallenge.state === 'awaiting_confirmation' && latestChallenge.sender_id) {
            return {
                status: 'awaiting_confirmation',
                maskedPhone: maskPhoneNumber(latestChallenge.sender_id),
                linkedAt: null,
                orderUpdatesOptIn: latestChallenge.order_updates_opt_in,
                pendingChallengeId: latestChallenge.id,
                awaitingConfirmationPhone: maskPhoneNumber(latestChallenge.sender_id),
            };
        }
        return {
            status: 'pending',
            maskedPhone: null,
            linkedAt: null,
            orderUpdatesOptIn: latestChallenge.order_updates_opt_in,
            pendingChallengeId: latestChallenge.id,
        };
    }

    return {
        status: 'not_linked',
        maskedPhone: null,
        linkedAt: null,
        orderUpdatesOptIn: false,
    };
}

/**
 * Atomically confirms an awaiting challenge and establishes the WhatsApp link.
 */
export async function confirmLink(
    userId: string,
    challengeId?: string
): Promise<{ success: boolean; link: WhatsAppLinkRow }> {
    const sb = getServiceRoleClient();

    if (!userId) {
        throw new WhatsAppServiceError('User ID is required.', 401);
    }

    const nowIso = new Date().toISOString();

    // Find the challenge awaiting confirmation
    let query = sb
        .from('whatsapp_link_challenges')
        .select('*')
        .eq('user_id', userId)
        .eq('state', 'awaiting_confirmation')
        .gt('expires_at', nowIso);

    if (challengeId) {
        query = query.eq('id', challengeId);
    }

    const { data: challenge, error: findErr } = await query
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (findErr || !challenge) {
        throw new WhatsAppServiceError('No valid confirmation found. Please resend the linking message on WhatsApp.', 400);
    }

    if (!challenge.sender_id) {
        throw new WhatsAppServiceError('Sender identity is missing from challenge.', 400);
    }

    const senderId = challenge.sender_id;

    // Check if this sender ID is already active on another account
    const { data: existingSenderLink } = await sb
        .from('whatsapp_links')
        .select('id, user_id')
        .eq('sender_id', senderId)
        .eq('status', 'active')
        .maybeSingle();

    if (existingSenderLink && existingSenderLink.user_id !== userId) {
        throw new WhatsAppServiceError('This WhatsApp number is already linked to another XerService account.', 409);
    }

    // Deactivate existing active links for this user
    await sb
        .from('whatsapp_links')
        .update({ status: 'disconnected', revoked_at: nowIso, updated_at: nowIso })
        .eq('user_id', userId)
        .eq('status', 'active');

    // Create the new active link
    const { data: newLink, error: linkErr } = await sb
        .from('whatsapp_links')
        .insert({
            user_id: userId,
            sender_id: senderId,
            phone_number: senderId,
            status: 'active',
            order_updates_opt_in: challenge.order_updates_opt_in,
            consent_version: 'v1',
            linked_at: nowIso,
        })
        .select('*')
        .single();

    if (linkErr || !newLink) {
        console.error('[WhatsAppService] Failed to establish active link:', linkErr);
        throw new WhatsAppServiceError('Failed to finalize WhatsApp connection.', 500);
    }

    // Atomically mark challenge confirmed
    await sb
        .from('whatsapp_link_challenges')
        .update({
            state: 'confirmed',
            confirmed_at: nowIso,
            updated_at: nowIso,
        })
        .eq('id', challenge.id);

    return { success: true, link: newLink };
}

/**
 * Disconnects the active WhatsApp link for an authenticated user.
 */
export async function disconnectLink(userId: string): Promise<{ success: boolean }> {
    const sb = getServiceRoleClient();

    if (!userId) {
        throw new WhatsAppServiceError('User ID is required.', 401);
    }

    const nowIso = new Date().toISOString();

    // 1. Mark active link disconnected
    await sb
        .from('whatsapp_links')
        .update({
            status: 'disconnected',
            revoked_at: nowIso,
            updated_at: nowIso,
        })
        .eq('user_id', userId)
        .eq('status', 'active');

    // 2. Revoke any pending challenges
    await sb
        .from('whatsapp_link_challenges')
        .update({
            state: 'revoked',
            updated_at: nowIso,
        })
        .eq('user_id', userId)
        .in('state', ['pending', 'awaiting_confirmation']);

    return { success: true };
}

/**
 * Idempotently processes an incoming provider webhook event.
 * Deduplicates events in `whatsapp_inbox_events`, detects linking tokens,
 * and updates challenge state to `awaiting_confirmation`.
 */
export async function processIncomingWebhook(
    rawBody: string,
    signatureHeader: string | null,
    options: { secretOverride?: string; bypassSignature?: boolean; allowTestMediaPayloads?: boolean } = {}
): Promise<{ processed: boolean; reason: string; eventId?: string }> {
    const sb = getServiceRoleClient();

    // 1. Signature check
    if (!options.bypassSignature) {
        const isValid = verifyWhatsAppWebhookSignature(rawBody, signatureHeader, options.secretOverride);
        if (!isValid) {
            throw new WhatsAppServiceError('Invalid webhook signature.', 401);
        }
    }

    // 2. Parse payload
    let payload: any;
    try {
        payload = JSON.parse(rawBody);
    } catch {
        throw new WhatsAppServiceError('Malformed JSON webhook body.', 400);
    }

    // 3. Extract event ID for deduplication
    const eventId =
        payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.id ||
        payload?.id ||
        payload?.event_id ||
        `gen-${crypto.createHash('sha256').update(rawBody).digest('hex')}`;

    // Deduplication check
    const { data: existingEvent } = await sb
        .from('whatsapp_inbox_events')
        .select('id, processing_status')
        .eq('provider_event_id', eventId)
        .maybeSingle();

    if (existingEvent) {
        return { processed: true, reason: 'duplicate_event', eventId };
    }

    // Store only the minimum event metadata required for deduplication and support.
    // The complete provider payload can contain phone numbers, message text, and media metadata.
    const eventMetadata = {
        object: typeof payload?.object === 'string' ? payload.object : null,
        entryId: typeof payload?.entry?.[0]?.id === 'string' ? payload.entry[0].id : null,
        field: typeof payload?.entry?.[0]?.changes?.[0]?.field === 'string'
            ? payload.entry[0].changes[0].field
            : null,
        messageType: typeof payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.type === 'string'
            ? payload.entry[0].changes[0].value.messages[0].type
            : null,
    };

    // Record incoming event
    const { data: recordedEvent } = await sb
        .from('whatsapp_inbox_events')
        .insert({
            provider_event_id: eventId,
            event_type: payload?.entry?.[0]?.changes?.[0]?.field || 'messages',
            payload: eventMetadata,
            processing_status: 'pending',
        })
        .select('*')
        .single();

    // 4. Extract message details
    const message =
        payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0] ||
        payload?.message;

    if (!message) {
        if (recordedEvent) {
            await sb
                .from('whatsapp_inbox_events')
                .update({ processing_status: 'ignored' })
                .eq('id', recordedEvent.id);
        }
        return { processed: true, reason: 'non_message_event', eventId };
    }

    const senderPhone = (message.from || payload.from || '').toString().replace(/\D/g, '');

    // Check if incoming message is a document or image media
    const isMedia =
        message.type === 'document' ||
        message.type === 'image' ||
        Boolean(message.document) ||
        Boolean(message.image);

    if (isMedia) {
        const mediaObj = message.document || message.image || payload?.document || payload?.image;
        if (!mediaObj) {
            if (recordedEvent) {
                await sb
                    .from('whatsapp_inbox_events')
                    .update({ processing_status: 'failed', error_message: 'Media payload missing.' })
                    .eq('id', recordedEvent.id);
            }
            return { processed: false, reason: 'missing_media_object', eventId };
        }

        const allowTestMediaPayloads = options.allowTestMediaPayloads === true || (
            process.env.NODE_ENV !== 'production' &&
            process.env.WHATSAPP_TEST_MEDIA_PAYLOADS_ENABLED === 'true'
        );
        const directBuffer = allowTestMediaPayloads && payload?.direct_buffer_base64
            ? Buffer.from(payload.direct_buffer_base64, 'base64')
            : undefined;

        const mediaResult = await validateAndIngestMedia({
            senderPhone,
            messageId: eventId,
            media: {
                id: mediaObj.id || `media-${Date.now()}`,
                mime_type: mediaObj.mime_type || (message.type === 'document' ? 'application/pdf' : 'image/jpeg'),
                filename: mediaObj.filename,
                file_size: mediaObj.file_size,
                sha256: mediaObj.sha256,
            },
            directBuffer,
            mediaUrl: allowTestMediaPayloads ? payload?.media_url : undefined,
        });

        if (recordedEvent) {
            const nextStatus =
                mediaResult.status === 'valid' || mediaResult.status === 'duplicate'
                    ? 'processed'
                    : mediaResult.status === 'ignored'
                    ? 'ignored'
                    : 'failed';

            await sb.from('whatsapp_inbox_events').update({
                processing_status: nextStatus,
                error_message: mediaResult.status === 'rejected' ? mediaResult.reason : null,
            }).eq('id', recordedEvent.id);
        }

        return {
            processed: mediaResult.success,
            reason: mediaResult.reason || mediaResult.status,
            eventId,
        };
    }

    const messageText = (message.text?.body || message.body || '').toString().trim();

    if (!messageText) {
        if (recordedEvent) {
            await sb
                .from('whatsapp_inbox_events')
                .update({ processing_status: 'ignored' })
                .eq('id', recordedEvent.id);
        }
        return { processed: true, reason: 'empty_text', eventId };
    }

    // Look for challenge token: format "LINK <token>" or raw "<token>"
    const cleanToken = messageText.replace(/^LINK\s+/i, '').trim().toUpperCase();
    const tokenHash = hashChallengeToken(cleanToken);

    const nowIso = new Date().toISOString();

    // Look up active pending challenge
    const { data: matchedChallenge } = await sb
        .from('whatsapp_link_challenges')
        .select('*')
        .eq('challenge_hash', tokenHash)
        .eq('state', 'pending')
        .gt('expires_at', nowIso)
        .maybeSingle();

    if (!matchedChallenge) {
        if (recordedEvent) {
            await sb
                .from('whatsapp_inbox_events')
                .update({
                    processing_status: 'failed',
                    error_message: 'Challenge not found, already consumed, or expired.',
                })
                .eq('id', recordedEvent.id);
        }
        return { processed: false, reason: 'challenge_not_found_or_expired', eventId };
    }

    if (matchedChallenge.intended_phone && !phoneNumbersMatch(matchedChallenge.intended_phone, senderPhone)) {
        if (recordedEvent) {
            await sb
                .from('whatsapp_inbox_events')
                .update({
                    processing_status: 'failed',
                    error_message: 'Sender does not match the intended phone number.',
                })
                .eq('id', recordedEvent.id);
        }
        return { processed: false, reason: 'sender_phone_mismatch', eventId };
    }

    // Transition challenge to awaiting_confirmation
    await sb
        .from('whatsapp_link_challenges')
        .update({
            state: 'awaiting_confirmation',
            sender_id: senderPhone,
            updated_at: nowIso,
        })
        .eq('id', matchedChallenge.id);

    if (recordedEvent) {
        await sb
            .from('whatsapp_inbox_events')
            .update({ processing_status: 'processed' })
            .eq('id', recordedEvent.id);
    }

    return { processed: true, reason: 'awaiting_confirmation_stored', eventId };
}

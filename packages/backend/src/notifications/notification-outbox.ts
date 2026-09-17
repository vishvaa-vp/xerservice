import { getServiceRoleClient } from '../supabase/client';

export type NotificationType =
    | 'PAYMENT_SUCCESS'
    | 'NEW_ORDER'
    | 'PRINTING_STARTED'
    | 'ORDER_READY'
    | 'ORDER_COMPLETED'
    | 'ORDER_CANCELLED'
    | 'REFUND_SUCCESS'
    | 'REFUND_FAILED'
    | 'GENERAL';

export type NotificationChannel = 'SMS' | 'EMAIL' | 'WHATSAPP';

export type OutboxEventType = NotificationType | 'OTP';

export type OutboxStatus = 'PENDING' | 'PROCESSING' | 'SENT' | 'FAILED' | 'SKIPPED';

export interface ExternalNotificationConfig {
    isGloballyEnabled: boolean;
    smsProvider: string;
    emailProvider: string;
    whatsappProvider: string;
}

export interface QueueExternalNotificationParams {
    userId: string;
    notificationId?: string | null;
    orderId?: string | null;
    channel: NotificationChannel;
    eventType: OutboxEventType;
    templateKey: string;
    safePayload: Record<string, any>;
    dedupeKey: string;
    destination?: string | null;
}

export interface NotificationOutboxRecord {
    id: string;
    user_id: string;
    notification_id: string | null;
    order_id: string | null;
    channel: NotificationChannel;
    event_type: OutboxEventType;
    destination: string | null;
    template_key: string;
    payload: Record<string, any>;
    status: OutboxStatus;
    attempt_count: number;
    provider: string | null;
    provider_message_id: string | null;
    last_error: string | null;
    dedupe_key: string;
    created_at: string;
    processed_at: string | null;
}

export interface SendResult {
    success: boolean;
    providerMessageId?: string | null;
    error?: string | null;
    skipped?: boolean;
}

export interface ExternalNotificationProvider {
    sendSms(params: { to: string; templateKey: string; payload: Record<string, any> }): Promise<SendResult>;
    sendEmail(params: { to: string; templateKey: string; payload: Record<string, any> }): Promise<SendResult>;
    sendWhatsApp(params: { to: string; templateKey: string; payload: Record<string, any> }): Promise<SendResult>;
}

/**
 * Server-only configuration resolver.
 * Missing environment variables strictly default to disabled.
 */
export function getExternalNotificationConfig(): ExternalNotificationConfig {
    const rawGlobal = process.env.EXTERNAL_NOTIFICATIONS_ENABLED;
    const isGloballyEnabled = rawGlobal ? rawGlobal.trim().toLowerCase() === 'true' : false;

    // Missing env vars strictly default to 'disabled'
    const smsProvider = (process.env.SMS_PROVIDER || 'disabled').trim().toLowerCase();
    const emailProvider = (process.env.EMAIL_PROVIDER || 'disabled').trim().toLowerCase();
    const whatsappProvider = (process.env.WHATSAPP_PROVIDER || 'disabled').trim().toLowerCase();

    return {
        isGloballyEnabled,
        smsProvider,
        emailProvider,
        whatsappProvider,
    };
}

/**
 * Checks channel-specific delivery status.
 * Global kill switch overrides all channel-level configurations.
 */
export function isChannelEnabled(channel: NotificationChannel): { enabled: boolean; provider: string; reason?: string } {
    const config = getExternalNotificationConfig();

    // 1. Global kill switch overrides everything
    if (!config.isGloballyEnabled) {
        return {
            enabled: false,
            provider: 'disabled',
            reason: 'External notifications are disabled.',
        };
    }

    // 2. Channel-specific check
    let provider = 'disabled';
    if (channel === 'SMS') {
        provider = config.smsProvider;
    } else if (channel === 'EMAIL') {
        provider = config.emailProvider;
    } else if (channel === 'WHATSAPP') {
        provider = config.whatsappProvider;
    }

    if (!provider || provider === 'disabled') {
        return {
            enabled: false,
            provider: 'disabled',
            reason: `External ${channel.toLowerCase()} delivery is disabled.`,
        };
    }

    return { enabled: true, provider };
}

/**
 * Strict Pre-Deployment Missing Table Error Guard.
 * Tolerates ONLY 42P01 (undefined_table) and PGRST205 (table not found in PostgREST schema cache).
 * NEVER swallows PGRST204 (column error), PGRST202 (function error), permissions, timeouts, or syntax errors.
 */
export function isOutboxMissingTableError(error: any): boolean {
    if (!error) return false;

    // Explicitly reject column errors and function errors
    if (
        error.code === 'PGRST204' ||
        error.code === 'PGRST202' ||
        error.code === '42703' ||
        error.code === '42883'
    ) {
        return false;
    }

    // Explicitly reject permission errors
    if (
        error.code === '42501' ||
        error.code === '28000' ||
        error.code === '28P01' ||
        error.message?.toLowerCase().includes('permission denied')
    ) {
        return false;
    }

    // Explicitly reject timeouts and query syntax errors
    if (
        error.code === '57014' ||
        error.code === '42601' ||
        error.message?.toLowerCase().includes('timeout')
    ) {
        return false;
    }

    // Allowed missing table error codes: 42P01 or PGRST205
    if (error.code === '42P01' || error.code === 'PGRST205') {
        return true;
    }

    // Explicit relation messages
    const msg = (error.message || '').toLowerCase();
    if (
        msg.includes('relation "notification_outbox" does not exist') ||
        msg.includes('relation "public.notification_outbox" does not exist') ||
        msg.includes("could not find the table 'notification_outbox'") ||
        msg.includes("could not find the table 'public.notification_outbox'")
    ) {
        return true;
    }

    return false;
}

/**
 * Disabled Notification Provider for MVP launch.
 * Safely marks messages as SKIPPED without making any network calls or using paid third-party APIs.
 */
export class DisabledNotificationProvider implements ExternalNotificationProvider {
    async sendSms(): Promise<SendResult> {
        return { success: false, skipped: true, error: 'External SMS provider not configured.' };
    }
    async sendEmail(): Promise<SendResult> {
        return { success: false, skipped: true, error: 'External Email provider not configured.' };
    }
    async sendWhatsApp(): Promise<SendResult> {
        return { success: false, skipped: true, error: 'External WhatsApp provider not configured.' };
    }
}

import { normalizePhoneNumber, isValidIndianMobile, formatPhoneDisplay } from '@packages/shared';
export { normalizePhoneNumber, isValidIndianMobile, formatPhoneDisplay };

/**
 * Normalizes and validates email addresses.
 * Lowercases and strips whitespace. Returns null if invalid.
 */
export function normalizeEmail(raw?: string | null): string | null {
    if (!raw || typeof raw !== 'string') return null;

    const cleaned = raw.trim().toLowerCase();
    if (!cleaned) return null;

    // Standard RFC-compliant practical regex
    const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+$/;
    if (emailRegex.test(cleaned)) {
        return cleaned;
    }

    return null;
}

/**
 * Authoritative Server Contact Resolver
 * Fetches user email from Supabase Auth admin and phone from public.profiles / auth.users.
 */
export async function resolveUserContact(userId: string): Promise<{ email: string | null; phone: string | null }> {
    if (!userId) return { email: null, phone: null };

    try {
        const serviceClient = getServiceRoleClient();

        // 1. Fetch user from Supabase Auth
        let authEmail: string | null = null;
        let authPhone: string | null = null;

        try {
            const { data: authUser, error: authError } = await serviceClient.auth.admin.getUserById(userId);
            if (!authError && authUser?.user) {
                authEmail = authUser.user.email || null;
                authPhone = authUser.user.phone || null;
            }
        } catch (authErr) {
            console.warn('[Outbox] Error fetching auth user details for user:', userId, authErr);
        }

        // 2. Fetch phone from public.profiles
        let profilePhone: string | null = null;
        try {
            const { data: profile, error: profileError } = await serviceClient
                .from('profiles')
                .select('phone')
                .eq('user_id', userId)
                .maybeSingle();

            if (!profileError && profile?.phone) {
                profilePhone = profile.phone;
            }
        } catch (profErr) {
            console.warn('[Outbox] Error fetching profile for user:', userId, profErr);
        }

        const resolvedEmail = normalizeEmail(authEmail);

        // Prioritize authoritative verified phone data from Supabase Auth
        let resolvedPhone: string | null = null;
        const normalizedAuthPhone = normalizePhoneNumber(authPhone);
        const normalizedProfilePhone = normalizePhoneNumber(profilePhone);

        if (normalizedAuthPhone) {
            resolvedPhone = normalizedAuthPhone;
            if (normalizedProfilePhone && normalizedProfilePhone !== normalizedAuthPhone) {
                console.warn(
                    `[Outbox] Contact phone mismatch for user ${userId}: profiles.phone (${normalizedProfilePhone}) != auth.users.phone (${normalizedAuthPhone}). Prioritizing authoritative auth.users.phone.`
                );
            }
        } else {
            // auth.users.phone is NULL: profile phone must NOT be trusted as verified
            if (normalizedProfilePhone) {
                console.warn(
                    `[Outbox] Disregarding unverified profile phone (${normalizedProfilePhone}) for user ${userId} because auth.users.phone is unverified.`
                );
            }
            resolvedPhone = null;
        }

        return { email: resolvedEmail, phone: resolvedPhone };
    } catch (err) {
        console.error('[Outbox] Exception resolving user contact:', err);
        return { email: null, phone: null };
    }
}

/**
 * Strips all sensitive credentials, document paths, secrets, and card details from the outbox payload.
 */
export function sanitizeOutboxPayload(payload: Record<string, any> = {}, isOtp = false): Record<string, any> {
    const sensitiveKeys = [
        'storage_path',
        'document_path',
        'signed_url',
        'file_url',
        'key_secret',
        'webhook_secret',
        'access_token',
        'secret',
        'password',
        'card',
        'cvv',
        'service_role_key',
        'jwt',
    ];

    if (!isOtp) {
        sensitiveKeys.push('otp', 'otp_code', 'pin');
    }

    const safe: Record<string, any> = {};
    for (const [key, value] of Object.entries(payload)) {
        const lowerKey = key.toLowerCase();
        if (!sensitiveKeys.some((s) => lowerKey.includes(s))) {
            safe[key] = value;
        }
    }

    return safe;
}

/**
 * Formats standard deduplication keys: {channel}:{event-slug}:{order_id}
 */
export function generateOutboxDedupeKey(
    channel: NotificationChannel,
    eventType: string,
    referenceId: string
): string {
    const channelSlug = channel.toLowerCase();
    const eventSlug = eventType.toLowerCase().replace(/_/g, '-');
    return `${channelSlug}:${eventSlug}:${referenceId}`;
}

/**
 * Returns the configured notification provider.
 * Defaults to DisabledNotificationProvider when EXTERNAL_NOTIFICATIONS_ENABLED !== 'true'.
 */
export function getNotificationProvider(): ExternalNotificationProvider {
    const config = getExternalNotificationConfig();
    if (!config.isGloballyEnabled) {
        return new DisabledNotificationProvider();
    }
    // Future integrations for Twilio, Gupshup, Resend, SendGrid, WhatsApp Business API plug in here.
    return new DisabledNotificationProvider();
}

/**
 * Authoritative Server Helper to enqueue an external notification row.
 * In disabled mode, rows are directly inserted as SKIPPED (never PENDING).
 * Handles payload sanitization, deduplication errors, contact normalization,
 * and pre-push table absence gracefully without failing core application flows.
 */
export async function queueExternalNotification(
    params: QueueExternalNotificationParams
): Promise<NotificationOutboxRecord | null> {
    if (!params.userId || !params.channel || !params.eventType || !params.templateKey || !params.dedupeKey) {
        console.warn('[Outbox] Missing required parameters for external notification:', params);
        return null;
    }

    try {
        const serviceClient = getServiceRoleClient();

        // 1. Resolve and normalize destination
        let destination = params.destination ? params.destination.trim() : null;

        if (params.channel === 'SMS' || params.channel === 'WHATSAPP') {
            const normalized = normalizePhoneNumber(destination);
            if (normalized) {
                destination = normalized;
            } else {
                const contact = await resolveUserContact(params.userId);
                destination = contact.phone;
            }
        } else if (params.channel === 'EMAIL') {
            const normalized = normalizeEmail(destination);
            if (normalized) {
                destination = normalized;
            } else {
                const contact = await resolveUserContact(params.userId);
                destination = contact.email;
            }
        }

        // 2. Determine initial status based on destination validity and provider configuration
        let initialStatus: OutboxStatus;
        let initialProvider: string | null = null;
        let initialError: string | null = null;
        let processedAt: string | null = null;
        let attemptCount = 0;

        if (!destination) {
            // Missing or invalid destination -> SKIPPED immediately
            initialStatus = 'SKIPPED';
            initialProvider = 'disabled';
            initialError = params.channel === 'EMAIL'
                ? 'No valid email address available for user.'
                : 'No valid Indian mobile number available for user.';
            processedAt = new Date().toISOString();
        } else {
            // Check global and channel-specific delivery enablement
            const channelCheck = isChannelEnabled(params.channel);

            if (!channelCheck.enabled) {
                // When disabled, insert directly as SKIPPED with provider='disabled' (NEVER PENDING)
                initialStatus = 'SKIPPED';
                initialProvider = 'disabled';
                initialError = channelCheck.reason || 'External notifications are disabled.';
                processedAt = new Date().toISOString();
            } else {
                // Only future enabled + configured provider may create PENDING
                initialStatus = 'PENDING';
                initialProvider = channelCheck.provider;
                initialError = null;
                processedAt = null;
            }
        }

        // 3. Sanitize payload
        const safePayload = sanitizeOutboxPayload(params.safePayload, params.eventType === 'OTP');

        const recordPayload = {
            user_id: params.userId,
            notification_id: params.notificationId || null,
            order_id: params.orderId || null,
            channel: params.channel,
            event_type: params.eventType,
            destination: destination || null,
            template_key: params.templateKey.trim(),
            payload: safePayload,
            status: initialStatus,
            attempt_count: attemptCount,
            provider: initialProvider,
            provider_message_id: null,
            last_error: initialError,
            dedupe_key: params.dedupeKey.trim(),
            processed_at: processedAt,
        };

        // 4. Insert into public.notification_outbox
        const { data, error } = await serviceClient
            .from('notification_outbox')
            .insert(recordPayload)
            .select('*')
            .maybeSingle();

        if (error) {
            // Deduplication collision (23505) -> Already enqueued
            if (error.code === '23505' || error.message?.includes('duplicate key') || error.message?.includes('dedupe_key')) {
                console.log(`[Outbox] Duplicate outbox entry prevented for dedupe_key "${params.dedupeKey}".`);
                return null;
            }

            // Pre-push environment graceful fallback (table not yet created)
            if (isOutboxMissingTableError(error)) {
                console.warn('[Outbox] notification_outbox table does not exist yet (Pre-push). Skipping insertion.');
                return null;
            }

            console.error('[Outbox] Error inserting outbox notification:', error);
            return null;
        }

        return data as NotificationOutboxRecord;
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[Outbox] Exception queueing external notification:', msg);
        return null;
    }
}

/**
 * Worker function to process pending outbox entries.
 * Processes ONLY rows with status = 'PENDING'.
 * Uses atomic status claiming to prevent double-processing across concurrent workers.
 *
 * NOTE: In MVP launch, there is NO background worker, cron, or setInterval invoking this.
 * It is available for on-demand worker invocations when an external provider is configured.
 */
export async function processPendingExternalNotifications(
    limit = 10
): Promise<{ processed: number; skipped: number; sent: number; failed: number }> {
    const result = { processed: 0, skipped: 0, sent: 0, failed: 0 };

    try {
        const serviceClient = getServiceRoleClient();

        // 1. Fetch batch of ONLY PENDING rows
        const { data: pendingRows, error } = await serviceClient
            .from('notification_outbox')
            .select('*')
            .eq('status', 'PENDING')
            .order('created_at', { ascending: true })
            .limit(limit);

        if (error) {
            if (isOutboxMissingTableError(error)) {
                // Table not created yet
                return result;
            }
            console.error('[OutboxWorker] Error fetching pending outbox records:', error);
            return result;
        }

        if (!pendingRows || pendingRows.length === 0) {
            return result;
        }

        const provider = getNotificationProvider();
        const config = getExternalNotificationConfig();

        for (const row of pendingRows) {
            // 2. Atomic claim: transition from PENDING to PROCESSING
            const { data: claimedRow, error: claimError } = await serviceClient
                .from('notification_outbox')
                .update({
                    status: 'PROCESSING',
                    attempt_count: (row.attempt_count || 0) + 1,
                })
                .eq('id', row.id)
                .eq('status', 'PENDING')
                .select('*')
                .maybeSingle();

            if (claimError || !claimedRow) {
                // Concurrently claimed by another worker; continue to next row
                continue;
            }

            result.processed++;

            // 3. Check for destination validity
            if (!claimedRow.destination) {
                await serviceClient
                    .from('notification_outbox')
                    .update({
                        status: 'SKIPPED',
                        provider: 'disabled',
                        last_error: 'No valid destination available for delivery.',
                        processed_at: new Date().toISOString(),
                    })
                    .eq('id', claimedRow.id);

                result.skipped++;
                continue;
            }

            // 4. If provider is disabled, mark SKIPPED
            if (!config.isGloballyEnabled) {
                await serviceClient
                    .from('notification_outbox')
                    .update({
                        status: 'SKIPPED',
                        provider: 'disabled',
                        last_error: 'External notifications are disabled.',
                        processed_at: new Date().toISOString(),
                    })
                    .eq('id', claimedRow.id);

                result.skipped++;
                continue;
            }

            // 5. Active delivery branch (for future enabled providers)
            try {
                let sendRes: SendResult;
                if (claimedRow.channel === 'SMS') {
                    sendRes = await provider.sendSms({
                        to: claimedRow.destination,
                        templateKey: claimedRow.template_key,
                        payload: claimedRow.payload,
                    });
                } else if (claimedRow.channel === 'EMAIL') {
                    sendRes = await provider.sendEmail({
                        to: claimedRow.destination,
                        templateKey: claimedRow.template_key,
                        payload: claimedRow.payload,
                    });
                } else {
                    sendRes = await provider.sendWhatsApp({
                        to: claimedRow.destination,
                        templateKey: claimedRow.template_key,
                        payload: claimedRow.payload,
                    });
                }

                if (sendRes.success) {
                    await serviceClient
                        .from('notification_outbox')
                        .update({
                            status: 'SENT',
                            provider: claimedRow.provider || 'active',
                            provider_message_id: sendRes.providerMessageId || null,
                            processed_at: new Date().toISOString(),
                        })
                        .eq('id', claimedRow.id);
                    result.sent++;
                } else if (sendRes.skipped) {
                    await serviceClient
                        .from('notification_outbox')
                        .update({
                            status: 'SKIPPED',
                            last_error: sendRes.error || 'Skipped by provider.',
                            processed_at: new Date().toISOString(),
                        })
                        .eq('id', claimedRow.id);
                    result.skipped++;
                } else {
                    const finalStatus: OutboxStatus = claimedRow.attempt_count >= 3 ? 'FAILED' : 'PENDING';
                    await serviceClient
                        .from('notification_outbox')
                        .update({
                            status: finalStatus,
                            last_error: sendRes.error || 'Delivery failed.',
                            processed_at: finalStatus === 'FAILED' ? new Date().toISOString() : null,
                        })
                        .eq('id', claimedRow.id);

                    if (finalStatus === 'FAILED') result.failed++;
                }
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                const finalStatus: OutboxStatus = claimedRow.attempt_count >= 3 ? 'FAILED' : 'PENDING';
                await serviceClient
                    .from('notification_outbox')
                    .update({
                        status: finalStatus,
                        last_error: msg,
                        processed_at: finalStatus === 'FAILED' ? new Date().toISOString() : null,
                    })
                    .eq('id', claimedRow.id);

                if (finalStatus === 'FAILED') result.failed++;
            }
        }
    } catch (err) {
        console.error('[OutboxWorker] Exception processing outbox:', err);
    }

    return result;
}

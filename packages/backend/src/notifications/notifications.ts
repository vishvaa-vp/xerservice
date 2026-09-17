import { getServiceRoleClient } from '../supabase/client';
import {
    NotificationChannel,
    NotificationType,
    queueExternalNotification,
    generateOutboxDedupeKey,
} from './notification-outbox';

export * from './notification-outbox';

export interface CreateNotificationParams {
    userId: string;
    orderId?: string | null;
    shopId?: string | null;
    type: NotificationType;
    title: string;
    message: string;
    metadata?: Record<string, any>;
    dedupeKey?: string | null;
}

export interface NotificationRecord {
    id: string;
    user_id: string;
    order_id: string | null;
    shop_id: string | null;
    type: NotificationType;
    title: string;
    message: string;
    is_read: boolean;
    metadata: Record<string, any>;
    dedupe_key: string | null;
    created_at: string;
    read_at: string | null;
}

/**
 * Strips sensitive keys (document paths, storage URLs, secrets) from metadata
 */
function sanitizeNotificationMetadata(metadata: Record<string, any> = {}): Record<string, any> {
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
    ];

    const safe: Record<string, any> = {};
    for (const [key, value] of Object.entries(metadata)) {
        const lowerKey = key.toLowerCase();
        if (!sensitiveKeys.some((s) => lowerKey.includes(s))) {
            safe[key] = value;
        }
    }
    return safe;
}

/**
 * Automatically chains external notification outbox enqueuing for supported order events.
 * Executes non-blockingly and safely degrades without failing the main flow.
 */
async function dispatchExternalOutboxForEvent(
    params: CreateNotificationParams,
    notificationRecord: NotificationRecord | null
): Promise<void> {
    try {
        if (!params.orderId && params.type !== 'GENERAL') {
            return;
        }

        // Map event types to appropriate channels and template keys
        let channels: NotificationChannel[] = [];
        let templateKey = '';

        switch (params.type) {
            case 'PAYMENT_SUCCESS':
                channels = ['SMS', 'EMAIL'];
                templateKey = 'customer_payment_success';
                break;
            case 'NEW_ORDER':
                channels = ['SMS', 'EMAIL'];
                templateKey = 'vendor_new_order';
                break;
            case 'PRINTING_STARTED':
                channels = ['SMS'];
                templateKey = 'customer_printing_started';
                break;
            case 'ORDER_READY':
                channels = ['SMS', 'EMAIL'];
                templateKey = 'customer_order_ready';
                break;
            case 'ORDER_COMPLETED':
                channels = ['SMS'];
                templateKey = 'customer_order_completed';
                break;
            case 'ORDER_CANCELLED':
                channels = ['SMS', 'EMAIL'];
                templateKey = params.shopId ? 'vendor_order_cancelled' : 'customer_order_cancelled';
                break;
            case 'REFUND_SUCCESS':
                channels = ['SMS', 'EMAIL'];
                templateKey = 'customer_refund_success';
                break;
            case 'REFUND_FAILED':
                channels = ['SMS', 'EMAIL'];
                templateKey = 'customer_refund_failed';
                break;
            default:
                return;
        }

        const safePayload = {
            order_id: params.orderId,
            order_number: params.metadata?.order_number,
            shop_name: params.metadata?.shop_name,
            amount: params.metadata?.amount || params.metadata?.total_amount,
            status: params.metadata?.status,
            refund_status: params.metadata?.refund_status,
            customer_name: params.metadata?.customer_name,
            cancellation_reason: params.metadata?.reason || params.metadata?.cancellation_reason,
            title: params.title,
            message: params.message,
        };

        const referenceId = params.orderId || params.userId;

        for (const channel of channels) {
            const dedupeKey = generateOutboxDedupeKey(channel, params.type, referenceId);
            await queueExternalNotification({
                userId: params.userId,
                notificationId: notificationRecord?.id || null,
                orderId: params.orderId || null,
                channel,
                eventType: params.type,
                templateKey,
                safePayload,
                dedupeKey,
            });
        }
    } catch (err) {
        console.warn('[Notifications] Non-fatal error dispatching external outbox notification:', err);
    }
}

/**
 * Authoritative Server-Side Notification Dispatcher
 * Automatically deduplicates using dedupeKey and safely degrades if table is not yet pushed.
 * Also queues provider-independent external notification outbox rows for supported events.
 */
export async function createNotification(
    params: CreateNotificationParams
): Promise<NotificationRecord | null> {
    if (!params.userId || !params.type || !params.title || !params.message) {
        console.warn('[Notifications] Missing required fields for notification:', params);
        return null;
    }

    try {
        const serviceClient = getServiceRoleClient();
        const safeMetadata = sanitizeNotificationMetadata(params.metadata);

        const payload: Record<string, any> = {
            user_id: params.userId,
            order_id: params.orderId || null,
            shop_id: params.shopId || null,
            type: params.type,
            title: params.title.trim(),
            message: params.message.trim(),
            metadata: safeMetadata,
            dedupe_key: params.dedupeKey ? params.dedupeKey.trim() : null,
        };

        const { data, error } = await serviceClient
            .from('notifications')
            .insert(payload)
            .select('*')
            .maybeSingle();

        if (error) {
            // Unique violation on dedupe_key -> duplicate event gracefully prevented
            if (error.code === '23505' || error.message?.includes('duplicate key') || error.message?.includes('dedupe_key')) {
                console.log(`[Notifications] Deduplication key "${params.dedupeKey}" already exists. Skipping duplicate notification.`);
                return null;
            }

            // If table does not exist yet (pre-push environment)
            if (error.code === '42P01' || error.message?.includes('does not exist')) {
                console.warn('[Notifications] notifications table does not exist yet on database (Pre-push). Skipping insertion.');
                // Still attempt outbox queueing for parity
                await dispatchExternalOutboxForEvent(params, null);
                return null;
            }

            console.error('[Notifications] Error inserting notification:', error);
            return null;
        }

        const notificationRecord = data as NotificationRecord;

        // Chain external outbox enqueuing for order events
        await dispatchExternalOutboxForEvent(params, notificationRecord);

        return notificationRecord;
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[Notifications] Exception creating notification:', msg);
        return null;
    }
}

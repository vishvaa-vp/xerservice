/**
 * XerService Backend — Stage A12: WhatsApp Linking Types
 */

export type WhatsAppLinkStatus = 'not_linked' | 'pending' | 'awaiting_confirmation' | 'connected';

export interface WhatsAppLinkRow {
    id: string;
    user_id: string;
    sender_id: string;
    phone_number: string;
    status: 'active' | 'disconnected';
    order_updates_opt_in: boolean;
    consent_version: string;
    linked_at: string;
    revoked_at: string | null;
    created_at: string;
    updated_at: string;
}

export interface WhatsAppLinkChallengeRow {
    id: string;
    user_id: string;
    challenge_hash: string;
    intended_phone: string | null;
    sender_id: string | null;
    state: 'pending' | 'awaiting_confirmation' | 'confirmed' | 'expired' | 'revoked';
    order_updates_opt_in: boolean;
    attempts: number;
    expires_at: string;
    confirmed_at: string | null;
    created_at: string;
    updated_at: string;
}

export interface WhatsAppInboxEventRow {
    id: string;
    provider_event_id: string | null;
    event_type: string;
    payload: Record<string, unknown>;
    processing_status: 'pending' | 'processed' | 'ignored' | 'failed';
    retry_count: number;
    error_message: string | null;
    created_at: string;
}

export interface WhatsAppImportedFileRow {
    id: string;
    user_id: string;
    source_message_id: string;
    media_id: string;
    original_filename: string;
    storage_path: string;
    mime_type: string;
    file_size: number;
    page_count: number | null;
    validation_status: 'quarantined' | 'valid' | 'rejected';
    expires_at: string;
    created_at: string;
}

export interface CreateChallengeResult {
    challengeId: string;
    token: string;
    waDirectUrl: string;
    linkingMessage: string;
    businessPhone: string;
    expiresAt: string;
    qrData: string;
}

export interface WhatsAppStatusSummary {
    status: WhatsAppLinkStatus;
    maskedPhone: string | null;
    linkedAt: string | null;
    orderUpdatesOptIn: boolean;
    pendingChallengeId?: string | null;
    awaitingConfirmationPhone?: string | null;
}

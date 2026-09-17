-- =============================================================
-- Migration: Create External Notification Outbox System (Phase 6G)
-- Table: notification_outbox
-- Security: Strict Row Level Security (RLS).
--           Revoke all permissions from PUBLIC, anon, and authenticated roles.
--           Browser clients can never SELECT, INSERT, UPDATE, or DELETE outbox rows.
--           Only trusted backend service_role can manage outbox rows.
-- =============================================================

-- 1. Create notification_outbox table
CREATE TABLE IF NOT EXISTS public.notification_outbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    notification_id UUID NULL REFERENCES public.notifications(id) ON DELETE SET NULL,
    order_id UUID NULL REFERENCES public.orders(id) ON DELETE SET NULL,
    channel TEXT NOT NULL CHECK (channel IN ('SMS', 'EMAIL', 'WHATSAPP')),
    event_type TEXT NOT NULL CHECK (event_type IN (
        'PAYMENT_SUCCESS',
        'NEW_ORDER',
        'PRINTING_STARTED',
        'ORDER_READY',
        'ORDER_COMPLETED',
        'ORDER_CANCELLED',
        'REFUND_SUCCESS',
        'REFUND_FAILED',
        'OTP',
        'GENERAL'
    )),
    destination TEXT NULL,
    template_key TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN (
        'PENDING',
        'PROCESSING',
        'SENT',
        'FAILED',
        'SKIPPED'
    )),
    attempt_count INTEGER NOT NULL DEFAULT 0,
    provider TEXT NULL,
    provider_message_id TEXT NULL,
    last_error TEXT NULL,
    dedupe_key TEXT UNIQUE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    processed_at TIMESTAMPTZ NULL
);

-- 2. Performance Indexes
-- Efficient polling for pending outbox items
CREATE INDEX IF NOT EXISTS idx_notification_outbox_status_created_at
    ON public.notification_outbox (status, created_at);

-- User outbox lookup
CREATE INDEX IF NOT EXISTS idx_notification_outbox_user_id_created_at
    ON public.notification_outbox (user_id, created_at DESC);

-- Order linkage index
CREATE INDEX IF NOT EXISTS idx_notification_outbox_order_id
    ON public.notification_outbox (order_id);

-- In-app notification linkage index
CREATE INDEX IF NOT EXISTS idx_notification_outbox_notification_id
    ON public.notification_outbox (notification_id);

-- 3. Row Level Security (RLS)
ALTER TABLE public.notification_outbox ENABLE ROW LEVEL SECURITY;

-- 4. Permissions: Fully revoke all client/browser operations
-- Browser users have ZERO direct access to the notification outbox
REVOKE ALL ON public.notification_outbox FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.notification_outbox TO service_role;

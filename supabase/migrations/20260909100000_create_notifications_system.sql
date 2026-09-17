-- =============================================================
-- Migration: Create Authoritative Notifications & Alerts System (Phase 6F)
-- Tables: notifications
-- Security: Strict Row Level Security (RLS). Authenticated users can SELECT
--           and UPDATE (is_read, read_at) only their own notifications.
--           INSERT and DELETE revoked from public/browser roles.
--           Trusted notifications created exclusively via service_role.
-- Publication: Added to supabase_realtime for instant delivery.
-- =============================================================

-- 1. Create notifications table
CREATE TABLE IF NOT EXISTS public.notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    order_id UUID NULL REFERENCES public.orders(id) ON DELETE SET NULL,
    shop_id UUID NULL REFERENCES public.shops(id) ON DELETE SET NULL,
    type TEXT NOT NULL CHECK (type IN (
        'PAYMENT_SUCCESS',
        'NEW_ORDER',
        'PRINTING_STARTED',
        'ORDER_READY',
        'ORDER_COMPLETED',
        'ORDER_CANCELLED',
        'REFUND_SUCCESS',
        'REFUND_FAILED',
        'GENERAL'
    )),
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    is_read BOOLEAN NOT NULL DEFAULT false,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    dedupe_key TEXT UNIQUE NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    read_at TIMESTAMPTZ NULL
);

-- 2. Performance Indexes
CREATE INDEX IF NOT EXISTS idx_notifications_user_id_created_at
    ON public.notifications (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id_is_read
    ON public.notifications (user_id, is_read);

CREATE INDEX IF NOT EXISTS idx_notifications_order_id
    ON public.notifications (order_id);

CREATE INDEX IF NOT EXISTS idx_notifications_shop_id
    ON public.notifications (shop_id);

-- 3. Row Level Security (RLS)
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- 3.1 Policy: Authenticated users can only read their own notifications
DROP POLICY IF EXISTS notifications_select_own ON public.notifications;
CREATE POLICY notifications_select_own ON public.notifications
    FOR SELECT
    TO authenticated
    USING (user_id = auth.uid());

-- 3.2 Policy: Authenticated users can update only their own notifications (read state)
DROP POLICY IF EXISTS notifications_update_own ON public.notifications;
CREATE POLICY notifications_update_own ON public.notifications
    FOR UPDATE
    TO authenticated
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

-- 3.3 Trigger: Prevent clients from mutating protected fields (title, message, type, user_id, etc.)
CREATE OR REPLACE FUNCTION public.handle_notification_update_protection()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    -- Allow service_role to update any field if necessary
    IF current_user = 'service_role' OR current_setting('request.jwt.claim.role', true) = 'service_role' THEN
        RETURN NEW;
    END IF;

    -- For regular authenticated users, verify that protected columns remain unchanged
    IF (OLD.user_id != NEW.user_id OR
        OLD.order_id IS DISTINCT FROM NEW.order_id OR
        OLD.shop_id IS DISTINCT FROM NEW.shop_id OR
        OLD.type != NEW.type OR
        OLD.title != NEW.title OR
        OLD.message != NEW.message OR
        OLD.metadata IS DISTINCT FROM NEW.metadata OR
        OLD.dedupe_key IS DISTINCT FROM NEW.dedupe_key OR
        OLD.created_at != NEW.created_at) THEN
        RAISE EXCEPTION 'Clients may only update is_read and read_at fields on notifications.';
    END IF;

    -- Automatically set read_at timestamp when is_read transitions from false to true
    IF OLD.is_read = false AND NEW.is_read = true AND NEW.read_at IS NULL THEN
        NEW.read_at := now();
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notifications_protect_fields ON public.notifications;
CREATE TRIGGER trg_notifications_protect_fields
    BEFORE UPDATE ON public.notifications
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_notification_update_protection();

-- 4. Permissions: Browser roles cannot INSERT or DELETE notifications directly
REVOKE INSERT, DELETE ON public.notifications FROM PUBLIC, anon, authenticated;
GRANT SELECT, UPDATE (is_read, read_at) ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;

-- 5. Realtime Publication
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND tablename = 'notifications'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
    END IF;
EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN undefined_object THEN NULL;
END $$;

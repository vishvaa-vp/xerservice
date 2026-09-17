-- =============================================================
-- Migration: Create Payments Schema & Webhook Idempotency (Phase 5C)
-- Tables: payment_attempts, payment_webhook_events
-- Security: Strict RLS. Customers can only view their own payment attempts.
--           No client INSERT/UPDATE. Service-role only for writes.
-- =============================================================

-- =============================================================
-- 1. PAYMENT_ATTEMPTS TABLE
-- Tracks payment attempts for print orders via payment providers (Razorpay)
-- =============================================================
CREATE TABLE IF NOT EXISTS public.payment_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
    provider TEXT NOT NULL DEFAULT 'RAZORPAY',
    razorpay_order_id TEXT UNIQUE,
    razorpay_payment_id TEXT UNIQUE,
    amount NUMERIC(10,2) NOT NULL CHECK (amount >= 0.00),
    currency TEXT NOT NULL DEFAULT 'INR',
    status TEXT NOT NULL DEFAULT 'CREATED' CHECK (
        status IN ('CREATED', 'AUTHORIZED', 'PAID', 'FAILED', 'REFUNDED')
    ),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    paid_at TIMESTAMPTZ
);

-- Indexes for efficient lookup
CREATE INDEX IF NOT EXISTS idx_payment_attempts_order_id
    ON public.payment_attempts(order_id);

CREATE INDEX IF NOT EXISTS idx_payment_attempts_rzp_order_id
    ON public.payment_attempts(razorpay_order_id);

CREATE INDEX IF NOT EXISTS idx_payment_attempts_rzp_payment_id
    ON public.payment_attempts(razorpay_payment_id);

CREATE INDEX IF NOT EXISTS idx_payment_attempts_status
    ON public.payment_attempts(status);

-- updated_at trigger
DROP TRIGGER IF EXISTS trg_payment_attempts_updated_at ON public.payment_attempts;
CREATE TRIGGER trg_payment_attempts_updated_at
    BEFORE UPDATE ON public.payment_attempts
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();

-- =============================================================
-- 2. PAYMENT_WEBHOOK_EVENTS TABLE
-- Deduplication log to prevent processing duplicate webhook events
-- =============================================================
CREATE TABLE IF NOT EXISTS public.payment_webhook_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider TEXT NOT NULL DEFAULT 'RAZORPAY',
    event_id TEXT UNIQUE NOT NULL,
    event_type TEXT NOT NULL,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_webhook_events_event_id
    ON public.payment_webhook_events(event_id);

-- =============================================================
-- 3. ROW LEVEL SECURITY (RLS)
-- =============================================================

-- Enable RLS
ALTER TABLE public.payment_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_webhook_events ENABLE ROW LEVEL SECURITY;

-- Customers can view payment attempts for their own orders
CREATE POLICY "Customers can view own payment attempts"
    ON public.payment_attempts
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.orders
            WHERE orders.id = payment_attempts.order_id
              AND orders.user_id = auth.uid()
        )
    );

-- Vendors can view payment attempts for orders placed with their shops
CREATE POLICY "Vendors can view assigned shop payment attempts"
    ON public.payment_attempts
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.orders
            JOIN public.shops ON shops.id = orders.shop_id
            JOIN public.profiles ON profiles.user_id = auth.uid()
            WHERE orders.id = payment_attempts.order_id
              AND shops.owner_id = auth.uid()
              AND profiles.role = 'vendor'
        )
    );

-- Note:
-- NO INSERT, UPDATE, or DELETE policies are granted to authenticated or anon clients.
-- All write operations are executed exclusively by server-side routes using service_role.
-- payment_webhook_events has NO client-facing policies (service_role only).

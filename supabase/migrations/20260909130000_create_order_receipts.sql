-- =============================================================
-- Migration: Create Order Receipts Schema & Auditable Backfill (Phase 6I Final Pre-Push)
-- Table: public.order_receipts
-- Sequence: public.order_receipt_number_seq
-- Function: public.generate_order_receipt_number(integer)
-- Security: Strict Row Level Security (RLS). Customers can only SELECT their own receipts.
--           No vendor SELECT policy (Customer-only for MVP).
--           Generator function & sequence strictly restricted: REVOKE from PUBLIC, anon, authenticated.
--           GRANT EXECUTE / USAGE strictly to service_role.
--           Single authoritative assignment mechanism via BEFORE INSERT trigger.
--           Immutable financial snapshot fields protected by database trigger.
--           No client INSERT/UPDATE/DELETE. Service role only for generation.
-- NOTE: DO NOT run supabase db push automatically until reviewed.
-- =============================================================

-- =============================================================
-- 1. RECEIPT NUMBER SEQUENCE & GENERATOR FUNCTION
-- Concurrency-safe monotonic sequence for server-generated receipt numbers
-- Target format: XSR-YYYY-NNNNNN (e.g. XSR-2026-100009)
-- =============================================================
CREATE SEQUENCE IF NOT EXISTS public.order_receipt_number_seq
    START WITH 100001
    INCREMENT BY 1
    MINVALUE 100001
    NO CYCLE;

CREATE OR REPLACE FUNCTION public.generate_order_receipt_number(p_year integer DEFAULT NULL)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_year integer;
    v_seq bigint;
BEGIN
    v_year := COALESCE(p_year, EXTRACT(YEAR FROM now())::integer);
    v_seq := nextval('public.order_receipt_number_seq');
    RETURN 'XSR-' || v_year::text || '-' || lpad(v_seq::text, 6, '0');
END;
$$;

-- Explicitly lock down the generator function
REVOKE ALL ON FUNCTION public.generate_order_receipt_number(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.generate_order_receipt_number(integer) FROM anon;
REVOKE ALL ON FUNCTION public.generate_order_receipt_number(integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.generate_order_receipt_number(integer) TO service_role;

-- Explicitly protect the sequence from client manipulation
REVOKE ALL ON SEQUENCE public.order_receipt_number_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.order_receipt_number_seq TO service_role;

-- =============================================================
-- 2. ORDER_RECEIPTS TABLE
-- Authoritative payment and order receipt records
-- =============================================================
CREATE TABLE IF NOT EXISTS public.order_receipts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    receipt_number TEXT NOT NULL UNIQUE,
    order_id UUID NOT NULL UNIQUE REFERENCES public.orders(id) ON DELETE RESTRICT,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    shop_id UUID NOT NULL REFERENCES public.shops(id) ON DELETE RESTRICT,
    payment_attempt_id UUID NULL REFERENCES public.payment_attempts(id) ON DELETE RESTRICT,
    amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0.00),
    currency TEXT NOT NULL DEFAULT 'INR',
    payment_provider TEXT NOT NULL CHECK (payment_provider IN ('RAZORPAY', 'XERCOINS')),
    payment_method TEXT NULL,
    payment_status TEXT NOT NULL CHECK (payment_status IN ('PAID', 'REFUNDED')),
    issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    refunded_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for non-unique foreign keys and status queries
-- (Note: receipt_number and order_id already have implicit unique indexes)
CREATE INDEX IF NOT EXISTS idx_order_receipts_user_id
    ON public.order_receipts(user_id);

CREATE INDEX IF NOT EXISTS idx_order_receipts_shop_id
    ON public.order_receipts(shop_id);

CREATE INDEX IF NOT EXISTS idx_order_receipts_payment_status
    ON public.order_receipts(payment_status);

COMMENT ON TABLE public.order_receipts IS
    'Authoritative, immutable payment and order receipt registry for all successfully paid XerService print orders.';

-- =============================================================
-- 3. INSERT TRIGGER: SINGLE AUTHORITATIVE NUMBER ASSIGNMENT
-- Ensures receipt_number is assigned exactly once per insert using the sequence.
-- Derives the year component from authoritative issued_at.
-- Does not duplicate nextval() calls.
-- =============================================================
CREATE OR REPLACE FUNCTION public.assign_order_receipt_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_year integer;
BEGIN
    IF NEW.receipt_number IS NULL OR trim(NEW.receipt_number) = '' THEN
        v_year := EXTRACT(YEAR FROM COALESCE(NEW.issued_at, now()))::integer;
        NEW.receipt_number := public.generate_order_receipt_number(v_year);
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assign_order_receipt_number ON public.order_receipts;
CREATE TRIGGER trg_assign_order_receipt_number
    BEFORE INSERT ON public.order_receipts
    FOR EACH ROW
    EXECUTE FUNCTION public.assign_order_receipt_number();

-- =============================================================
-- 4. UPDATED_AT TRIGGER
-- =============================================================
DROP TRIGGER IF EXISTS trg_order_receipts_updated_at ON public.order_receipts;
CREATE TRIGGER trg_order_receipts_updated_at
    BEFORE UPDATE ON public.order_receipts
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();

-- =============================================================
-- 5. FINANCIAL SNAPSHOT IMMUTABILITY TRIGGER
-- Prevents mutation of core financial fields after creation.
-- Only payment_status ('REFUNDED'), refunded_at, and updated_at may be modified.
-- Rejects REFUNDED -> PAID regressions and arbitrary refunded_at changes.
-- =============================================================
CREATE OR REPLACE FUNCTION public.protect_order_receipt_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.receipt_number IS DISTINCT FROM OLD.receipt_number THEN
        RAISE EXCEPTION 'receipt_number is immutable and cannot be modified';
    END IF;

    IF NEW.order_id IS DISTINCT FROM OLD.order_id THEN
        RAISE EXCEPTION 'order_id is immutable and cannot be modified';
    END IF;

    IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
        RAISE EXCEPTION 'user_id is immutable and cannot be modified';
    END IF;

    IF NEW.shop_id IS DISTINCT FROM OLD.shop_id THEN
        RAISE EXCEPTION 'shop_id is immutable and cannot be modified';
    END IF;

    IF NEW.payment_attempt_id IS DISTINCT FROM OLD.payment_attempt_id THEN
        RAISE EXCEPTION 'payment_attempt_id is immutable and cannot be modified';
    END IF;

    IF NEW.amount IS DISTINCT FROM OLD.amount THEN
        RAISE EXCEPTION 'amount is immutable and cannot be modified';
    END IF;

    IF NEW.currency IS DISTINCT FROM OLD.currency THEN
        RAISE EXCEPTION 'currency is immutable and cannot be modified';
    END IF;

    IF NEW.payment_provider IS DISTINCT FROM OLD.payment_provider THEN
        RAISE EXCEPTION 'payment_provider is immutable and cannot be modified';
    END IF;

    IF NEW.payment_method IS DISTINCT FROM OLD.payment_method THEN
        RAISE EXCEPTION 'payment_method is immutable and cannot be modified';
    END IF;

    IF NEW.issued_at IS DISTINCT FROM OLD.issued_at THEN
        RAISE EXCEPTION 'issued_at is immutable and cannot be modified';
    END IF;

    IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'created_at is immutable and cannot be modified';
    END IF;

    -- Lifecycle mutation checks:
    -- Only allowed transition is payment_status: PAID -> REFUNDED
    IF OLD.payment_status = 'REFUNDED' AND NEW.payment_status IS DISTINCT FROM 'REFUNDED' THEN
        RAISE EXCEPTION 'Cannot revert a REFUNDED receipt to %', NEW.payment_status;
    END IF;

    -- refunded_at: only allowed transition is NULL -> non-null timestamp when payment_status becomes REFUNDED
    IF OLD.refunded_at IS NOT NULL AND NEW.refunded_at IS DISTINCT FROM OLD.refunded_at THEN
        RAISE EXCEPTION 'refunded_at is immutable once set and cannot be modified';
    END IF;

    IF NEW.payment_status = 'PAID' AND NEW.refunded_at IS NOT NULL THEN
        RAISE EXCEPTION 'refunded_at must be NULL when payment_status is PAID';
    END IF;

    IF NEW.payment_status = 'REFUNDED' AND NEW.refunded_at IS NULL THEN
        RAISE EXCEPTION 'refunded_at cannot be NULL when payment_status is REFUNDED';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_order_receipt_immutability ON public.order_receipts;
CREATE TRIGGER trg_protect_order_receipt_immutability
    BEFORE UPDATE ON public.order_receipts
    FOR EACH ROW
    EXECUTE FUNCTION public.protect_order_receipt_immutability();

-- =============================================================
-- 6. ROW LEVEL SECURITY (RLS) - CUSTOMER-ONLY ACCESS FOR MVP
-- =============================================================
ALTER TABLE public.order_receipts ENABLE ROW LEVEL SECURITY;

-- Customer can SELECT only their own receipts
DROP POLICY IF EXISTS "Customers can view own order receipts" ON public.order_receipts;
CREATE POLICY "Customers can view own order receipts"
    ON public.order_receipts
    FOR SELECT
    TO authenticated
    USING (user_id = auth.uid());

-- Explicitly ensure vendor policy is removed for MVP
DROP POLICY IF EXISTS "Vendors can view shop order receipts" ON public.order_receipts;

-- Disallow client INSERT, UPDATE, DELETE (writes are performed exclusively by service role)
REVOKE ALL ON public.order_receipts FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.order_receipts FROM authenticated;
GRANT SELECT ON public.order_receipts TO authenticated;

-- =============================================================
-- 7. DETERMINISTIC, AUDITABLE BACKFILL FOR EXISTING REAL PAID & REFUNDED ORDERS
--
-- Invariants:
-- 1. Excludes orders that already have an order_receipt BEFORE calling nextval().
--    Re-running this backfill will NOT advance order_receipt_number_seq.
-- 2. Requires an authoritative successful payment_attempt (PAID or REFUNDED).
-- 3. Strict amount verification (abs(o.total_amount - pa.amount) <= 0.01).
-- 4. No provider fabrication: requires provider IN ('RAZORPAY', 'XERCOINS').
-- 5. Preserves exact payment_method (stores NULL if legitimately NULL without inventing 'OTHER').
-- 6. issued_at is derived from authoritative payment_paid_at / order_paid_at (no fallback to created_at).
-- 7. refunded_at is derived from authoritative refund_requests.completed_at for SUCCEEDED refunds.
-- 8. Deterministic ordering by COALESCE(payment paid_at, order paid_at, order created_at) ASC, order_number ASC.
-- =============================================================
WITH eligible_orders AS (
    SELECT
        o.id AS order_id,
        o.user_id,
        o.shop_id,
        pa.id AS payment_attempt_id,
        o.total_amount,
        pa.currency,
        pa.provider,
        pa.payment_method,
        o.payment_status,
        pa.paid_at AS payment_paid_at,
        o.paid_at AS order_paid_at,
        o.created_at AS order_created_at,
        rf.completed_at AS refund_completed_at,
        COALESCE(pa.paid_at, o.paid_at, o.created_at) AS sort_ts
    FROM public.orders o
    JOIN LATERAL (
        SELECT id, provider, payment_method, currency, amount, paid_at
        FROM public.payment_attempts
        WHERE order_id = o.id
          AND status IN ('PAID', 'REFUNDED')
          AND provider IN ('RAZORPAY', 'XERCOINS')
        ORDER BY paid_at DESC NULLS LAST, created_at DESC
        LIMIT 1
    ) pa ON true
    LEFT JOIN LATERAL (
        SELECT completed_at
        FROM public.refund_requests
        WHERE order_id = o.id AND status = 'SUCCEEDED'
        ORDER BY completed_at DESC NULLS LAST, created_at DESC
        LIMIT 1
    ) rf ON true
    WHERE o.payment_status IN ('PAID', 'REFUNDED')
      AND abs(o.total_amount - pa.amount) <= 0.01
      -- CRITICAL: Filter existing receipts BEFORE nextval is called to guarantee sequence safety
      AND NOT EXISTS (
          SELECT 1 FROM public.order_receipts r WHERE r.order_id = o.id
      )
    ORDER BY COALESCE(pa.paid_at, o.paid_at, o.created_at) ASC, o.order_number ASC
)
INSERT INTO public.order_receipts (
    receipt_number,
    order_id,
    user_id,
    shop_id,
    payment_attempt_id,
    amount,
    currency,
    payment_provider,
    payment_method,
    payment_status,
    issued_at,
    refunded_at,
    created_at,
    updated_at
)
SELECT
    public.generate_order_receipt_number(EXTRACT(YEAR FROM coalesce(eo.payment_paid_at, eo.order_paid_at))::integer),
    eo.order_id,
    eo.user_id,
    eo.shop_id,
    eo.payment_attempt_id,
    eo.total_amount,
    coalesce(eo.currency, 'INR'),
    eo.provider,
    eo.payment_method,
    eo.payment_status,
    coalesce(eo.payment_paid_at, eo.order_paid_at),
    CASE WHEN eo.payment_status = 'REFUNDED' THEN eo.refund_completed_at ELSE NULL END,
    coalesce(eo.payment_paid_at, eo.order_paid_at),
    now()
FROM eligible_orders eo
ORDER BY eo.sort_ts ASC;

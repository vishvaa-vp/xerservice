-- =============================================================
-- Migration: Create Vendor Financial Ledger & Settlement Schema (Phase 6J Final Hardened)
-- Tables:
--   1. public.shop_commission_rules (Basis points with overlap protection)
--   2. public.order_financial_ledger (Authoritative order-level accounting ledger)
--   3. public.vendor_settlement_batches (Manual settlement batch headers with derived totals)
--   4. public.vendor_settlement_items (Settlement line-items linking ledger entries)
-- Sequences:
--   public.vendor_settlement_number_seq
-- Functions:
--   public.calculate_vendor_commission(numeric, integer) -> DB authoritative calculation
--   public.get_effective_shop_commission_rule(uuid, timestamptz) -> Fail-closed rule lookup
--   public.configure_unconfigured_order_ledger(uuid) -> Trusted activation
--   public.generate_vendor_settlement_number(integer) -> Format XSS-YYYY-NNNNNN
-- Security: Strict Row Level Security (RLS).
--           Vendors can SELECT only their own shop's rules, ledger, batches, and items.
--           Customers have NO access to vendor finances.
--           Immutability triggers prevent modification of financial snapshots.
--           Client INSERT/UPDATE/DELETE strictly revoked from anon & authenticated.
-- NOTE: DO NOT run supabase db push automatically until reviewed.
-- =============================================================

-- =============================================================
-- 1. AUTHORITATIVE COMMISSION CALCULATION FUNCTION (NUMERIC)
-- Formula: platform_commission = ROUND(gross * bps / 10000.0, 2)
--          vendor_net = gross - platform_commission
-- Invariant: gross = platform_commission + vendor_net
-- =============================================================
CREATE OR REPLACE FUNCTION public.calculate_vendor_commission(
    p_gross_amount NUMERIC,
    p_commission_bps INTEGER
)
RETURNS TABLE (
    platform_commission_amount NUMERIC(12,2),
    vendor_net_amount NUMERIC(12,2)
)
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = public, pg_temp
AS $$
DECLARE
    v_commission NUMERIC(12,2);
BEGIN
    IF p_commission_bps < 0 OR p_commission_bps > 10000 THEN
        RAISE EXCEPTION 'Invalid commission_bps: %. Must be between 0 and 10000.', p_commission_bps;
    END IF;

    -- Standard 2-decimal arithmetic using PostgreSQL NUMERIC
    v_commission := ROUND((p_gross_amount * p_commission_bps / 10000.0), 2);
    RETURN QUERY SELECT v_commission, ROUND((p_gross_amount - v_commission), 2);
END;
$$;

REVOKE ALL ON FUNCTION public.calculate_vendor_commission(NUMERIC, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.calculate_vendor_commission(NUMERIC, INTEGER) TO service_role;

-- =============================================================
-- 2. SHOP COMMISSION RULES TABLE & OVERLAP PROTECTION
-- Tracks platform commission rates per shop in basis points (100 bps = 1%, 10000 bps = 100%)
-- Prevents ambiguous overlapping active commission windows for the same shop
-- =============================================================
CREATE TABLE IF NOT EXISTS public.shop_commission_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id UUID NOT NULL REFERENCES public.shops(id) ON DELETE RESTRICT,
    commission_bps INTEGER NOT NULL CHECK (commission_bps >= 0 AND commission_bps <= 10000),
    effective_from TIMESTAMPTZ NOT NULL DEFAULT now(),
    effective_to TIMESTAMPTZ NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by UUID NULL REFERENCES auth.users(id),
    CONSTRAINT chk_commission_rules_dates CHECK (effective_to IS NULL OR effective_to > effective_from)
);

CREATE INDEX IF NOT EXISTS idx_shop_commission_rules_lookup
    ON public.shop_commission_rules(shop_id, is_active, effective_from DESC);

COMMENT ON TABLE public.shop_commission_rules IS
    'Configured platform commission basis points per shop. If no active rule exists, financial ledger enters UNCONFIGURED status.';

-- Trigger to prevent ambiguous overlapping effective ranges for the same shop
CREATE OR REPLACE FUNCTION public.check_shop_commission_rule_overlap()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.is_active = true THEN
        IF EXISTS (
            SELECT 1 FROM public.shop_commission_rules
            WHERE shop_id = NEW.shop_id
              AND id != COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
              AND is_active = true
              AND tstzrange(effective_from, COALESCE(effective_to, 'infinity'::timestamptz), '[)') &&
                  tstzrange(NEW.effective_from, COALESCE(NEW.effective_to, 'infinity'::timestamptz), '[)')
        ) THEN
            RAISE EXCEPTION 'Overlapping active commission rule exists for shop %.', NEW.shop_id;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_shop_commission_rule_overlap ON public.shop_commission_rules;
CREATE TRIGGER trg_check_shop_commission_rule_overlap
    BEFORE INSERT OR UPDATE ON public.shop_commission_rules
    FOR EACH ROW
    EXECUTE FUNCTION public.check_shop_commission_rule_overlap();

-- Authoritative rule lookup function: exactly 1 matching rule => use rule; > 1 => FAIL CLOSED; 0 => empty
CREATE OR REPLACE FUNCTION public.get_effective_shop_commission_rule(
    p_shop_id UUID,
    p_timestamp TIMESTAMPTZ DEFAULT now()
)
RETURNS TABLE (
    rule_id UUID,
    commission_bps INTEGER,
    effective_from TIMESTAMPTZ,
    effective_to TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_count
    FROM public.shop_commission_rules
    WHERE shop_id = p_shop_id
      AND is_active = true
      AND effective_from <= p_timestamp
      AND (effective_to IS NULL OR effective_to > p_timestamp);

    IF v_count > 1 THEN
        RAISE EXCEPTION 'Ambiguous commission rules: % overlapping active rules found for shop % at %.',
            v_count, p_shop_id, p_timestamp;
    END IF;

    RETURN QUERY
    SELECT r.id, r.commission_bps, r.effective_from, r.effective_to
    FROM public.shop_commission_rules r
    WHERE r.shop_id = p_shop_id
      AND r.is_active = true
      AND r.effective_from <= p_timestamp
      AND (r.effective_to IS NULL OR r.effective_to > p_timestamp)
    LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.get_effective_shop_commission_rule(UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_effective_shop_commission_rule(UUID, TIMESTAMPTZ) TO service_role;

-- =============================================================
-- 3. ORDER FINANCIAL LEDGER TABLE
-- Authoritative financial allocation per successfully paid order
-- Includes auditable reversal metadata (reversed_at, refund_request_id, reversal_reason)
-- =============================================================
CREATE TABLE IF NOT EXISTS public.order_financial_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL UNIQUE REFERENCES public.orders(id) ON DELETE RESTRICT,
    shop_id UUID NOT NULL REFERENCES public.shops(id) ON DELETE RESTRICT,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    payment_attempt_id UUID NOT NULL REFERENCES public.payment_attempts(id) ON DELETE RESTRICT,
    gross_amount NUMERIC(12,2) NOT NULL CHECK (gross_amount >= 0.00),
    currency TEXT NOT NULL DEFAULT 'INR',
    commission_bps INTEGER NULL CHECK (commission_bps >= 0 AND commission_bps <= 10000),
    platform_commission_amount NUMERIC(12,2) NULL CHECK (platform_commission_amount >= 0.00),
    vendor_net_amount NUMERIC(12,2) NULL CHECK (vendor_net_amount >= 0.00),
    financial_status TEXT NOT NULL CHECK (financial_status IN ('UNCONFIGURED', 'PENDING', 'PAYABLE', 'SETTLED', 'REVERSED')),
    eligible_at TIMESTAMPTZ NULL,
    settled_at TIMESTAMPTZ NULL,
    reversed_at TIMESTAMPTZ NULL,
    refund_request_id UUID NULL,
    reversal_reason TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_ledger_commission_arithmetic CHECK (
        (commission_bps IS NOT NULL AND platform_commission_amount IS NOT NULL AND vendor_net_amount IS NOT NULL AND (gross_amount = platform_commission_amount + vendor_net_amount))
        OR
        (commission_bps IS NULL AND platform_commission_amount IS NULL AND vendor_net_amount IS NULL AND financial_status IN ('UNCONFIGURED', 'REVERSED'))
    ),
    CONSTRAINT chk_ledger_payable_eligibility CHECK (
        financial_status != 'PAYABLE' OR eligible_at IS NOT NULL
    ),
    CONSTRAINT chk_ledger_settled_eligibility CHECK (
        financial_status != 'SETTLED' OR (settled_at IS NOT NULL AND eligible_at IS NOT NULL)
    ),
    CONSTRAINT chk_ledger_reversed_audit CHECK (
        financial_status != 'REVERSED' OR reversed_at IS NOT NULL
    )
);

CREATE INDEX IF NOT EXISTS idx_order_financial_ledger_shop_status
    ON public.order_financial_ledger(shop_id, financial_status);

CREATE INDEX IF NOT EXISTS idx_order_financial_ledger_order_id
    ON public.order_financial_ledger(order_id);

CREATE INDEX IF NOT EXISTS idx_order_financial_ledger_payment_attempt_id
    ON public.order_financial_ledger(payment_attempt_id);

COMMENT ON TABLE public.order_financial_ledger IS
    'Authoritative accounting ledger tracking gross payments, platform commission, vendor earnings, and settlement status.';

-- =============================================================
-- 4. FINANCIAL LEDGER IMMUTABILITY & LIFECYCLE TRIGGER
-- Prevents tampering of snapshot fields, protects settled rows, and enforces legal transitions
-- =============================================================
CREATE OR REPLACE FUNCTION public.protect_order_financial_ledger_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_batch_status TEXT;
    v_item_id UUID;
BEGIN
    -- 1. Disallow Deletion of Financial Ledger Rows
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Financial ledger entries are permanent and cannot be deleted.';
    END IF;

    -- 2. Validate Snapshot Immutability on Update
    IF TG_OP = 'UPDATE' THEN
        IF OLD.order_id != NEW.order_id THEN
            RAISE EXCEPTION 'Field order_id is immutable.';
        END IF;

        IF OLD.shop_id != NEW.shop_id THEN
            RAISE EXCEPTION 'Field shop_id is immutable.';
        END IF;

        IF OLD.user_id != NEW.user_id THEN
            RAISE EXCEPTION 'Field user_id is immutable.';
        END IF;

        IF OLD.payment_attempt_id != NEW.payment_attempt_id THEN
            RAISE EXCEPTION 'Field payment_attempt_id is immutable.';
        END IF;

        IF OLD.gross_amount != NEW.gross_amount THEN
            RAISE EXCEPTION 'Field gross_amount is immutable.';
        END IF;

        IF OLD.currency != NEW.currency THEN
            RAISE EXCEPTION 'Field currency is immutable.';
        END IF;

        -- Once commission is configured, it is permanently locked
        IF OLD.commission_bps IS NOT NULL THEN
            IF NEW.commission_bps IS DISTINCT FROM OLD.commission_bps THEN
                RAISE EXCEPTION 'Field commission_bps is immutable once configured.';
            END IF;
            IF NEW.platform_commission_amount IS DISTINCT FROM OLD.platform_commission_amount THEN
                RAISE EXCEPTION 'Field platform_commission_amount is immutable once configured.';
            END IF;
            IF NEW.vendor_net_amount IS DISTINCT FROM OLD.vendor_net_amount THEN
                RAISE EXCEPTION 'Field vendor_net_amount is immutable once configured.';
            END IF;
        END IF;

        -- 3. Validate Terminal States
        IF OLD.financial_status = 'SETTLED' AND NEW.financial_status != 'SETTLED' THEN
            RAISE EXCEPTION 'SETTLED financial ledger status is final and cannot be transitioned.';
        END IF;

        IF OLD.financial_status = 'REVERSED' AND NEW.financial_status != 'REVERSED' THEN
            RAISE EXCEPTION 'REVERSED financial ledger status is terminal and cannot be transitioned.';
        END IF;

        -- 4. Validate Permitted Lifecycle Transitions
        IF OLD.financial_status != NEW.financial_status THEN
            IF OLD.financial_status = 'UNCONFIGURED' AND NEW.financial_status NOT IN ('PENDING', 'PAYABLE', 'REVERSED') THEN
                RAISE EXCEPTION 'Illegal financial status transition from UNCONFIGURED to %.', NEW.financial_status;
            ELSIF OLD.financial_status = 'PENDING' AND NEW.financial_status NOT IN ('PAYABLE', 'REVERSED') THEN
                RAISE EXCEPTION 'Illegal financial status transition from PENDING to %.', NEW.financial_status;
            ELSIF OLD.financial_status = 'PAYABLE' AND NEW.financial_status NOT IN ('SETTLED', 'REVERSED') THEN
                RAISE EXCEPTION 'Illegal financial status transition from PAYABLE to %.', NEW.financial_status;
            END IF;
        END IF;

        -- 5. Automatically handle reversal workflow and protect against reversing settled entries
        IF NEW.financial_status = 'REVERSED' AND OLD.financial_status != 'REVERSED' THEN
            -- Locate any settlement item referencing this ledger
            SELECT vsb.status, vsi.id INTO v_batch_status, v_item_id
            FROM public.vendor_settlement_items vsi
            JOIN public.vendor_settlement_batches vsb ON vsb.id = vsi.settlement_batch_id
            WHERE vsi.order_financial_ledger_id = OLD.id;

            IF v_batch_status IS NOT NULL THEN
                IF v_batch_status = 'PAID' THEN
                    RAISE EXCEPTION 'Cannot reverse ledger entry %: linked settlement batch is already PAID. Payout has already been disbursed. Manual adjustment required.', OLD.id;
                ELSE
                    -- Batch is unpaid (DRAFT, CONFIRMED, or CANCELLED)
                    -- Safely remove item from the unpaid batch; trigger recalculates batch totals
                    DELETE FROM public.vendor_settlement_items
                    WHERE id = v_item_id;
                END IF;
            END IF;

            NEW.reversed_at := COALESCE(NEW.reversed_at, now());
            NEW.reversal_reason := COALESCE(NEW.reversal_reason, 'Refund processed');
        END IF;

        NEW.updated_at := now();
        RETURN NEW;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_order_financial_ledger_immutability ON public.order_financial_ledger;
CREATE TRIGGER trg_order_financial_ledger_immutability
    BEFORE UPDATE OR DELETE ON public.order_financial_ledger
    FOR EACH ROW
    EXECUTE FUNCTION public.protect_order_financial_ledger_immutability();

-- =============================================================
-- 5. UNCONFIGURED LEDGER ACTIVATION PROCEDURE
-- Trusted database procedure to configure UNCONFIGURED ledger rows once a rule is added
-- Admin/service role only. Fails closed on ambiguous rule.
-- =============================================================
CREATE OR REPLACE FUNCTION public.configure_unconfigured_order_ledger(p_order_id UUID)
RETURNS public.order_financial_ledger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_ledger public.order_financial_ledger%ROWTYPE;
    v_order RECORD;
    v_attempt RECORD;
    v_timestamp TIMESTAMPTZ;
    v_rule RECORD;
    v_calc RECORD;
    v_status TEXT;
    v_eligible_at TIMESTAMPTZ;
BEGIN
    -- 1. Load existing UNCONFIGURED ledger
    SELECT * INTO v_ledger
    FROM public.order_financial_ledger
    WHERE order_id = p_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Financial ledger entry not found for order %.', p_order_id;
    END IF;

    IF v_ledger.financial_status != 'UNCONFIGURED' THEN
        -- If already configured or reversed, return as is (idempotent)
        RETURN v_ledger;
    END IF;

    -- 2. Read authoritative payment timestamp
    SELECT * INTO v_attempt
    FROM public.payment_attempts
    WHERE id = v_ledger.payment_attempt_id;

    SELECT * INTO v_order
    FROM public.orders
    WHERE id = p_order_id;

    v_timestamp := COALESCE(v_attempt.paid_at, v_order.paid_at, v_ledger.created_at);

    -- 3. Find exactly one valid commission rule at timestamp
    SELECT * INTO v_rule
    FROM public.get_effective_shop_commission_rule(v_ledger.shop_id, v_timestamp);

    IF v_rule.rule_id IS NULL THEN
        -- No rule configured: remain UNCONFIGURED
        RETURN v_ledger;
    END IF;

    -- 4. Calculate commission using DB NUMERIC
    SELECT * INTO v_calc
    FROM public.calculate_vendor_commission(v_ledger.gross_amount, v_rule.commission_bps);

    -- 5. Determine new financial status based on current order state
    IF v_order.payment_status = 'REFUNDED' OR v_order.status = 'CANCELLED' THEN
        v_status := 'REVERSED';
        v_eligible_at := NULL;
    ELSIF v_order.status = 'COMPLETED' AND v_order.payment_status = 'PAID' THEN
        v_status := 'PAYABLE';
        v_eligible_at := COALESCE(v_order.completed_at, now());
    ELSE
        v_status := 'PENDING';
        v_eligible_at := NULL;
    END IF;

    -- 6. Update ledger row
    UPDATE public.order_financial_ledger
    SET commission_bps = v_rule.commission_bps,
        platform_commission_amount = v_calc.platform_commission_amount,
        vendor_net_amount = v_calc.vendor_net_amount,
        financial_status = v_status,
        eligible_at = v_eligible_at,
        updated_at = now()
    WHERE id = v_ledger.id
    RETURNING * INTO v_ledger;

    RETURN v_ledger;
END;
$$;

REVOKE ALL ON FUNCTION public.configure_unconfigured_order_ledger(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.configure_unconfigured_order_ledger(UUID) TO service_role;

-- =============================================================
-- 6. SETTLEMENT NUMBER SEQUENCE & GENERATOR FUNCTION
-- Format: XSS-YYYY-NNNNNN (e.g. XSS-2026-100001)
-- =============================================================
CREATE SEQUENCE IF NOT EXISTS public.vendor_settlement_number_seq
    START WITH 100001
    INCREMENT BY 1
    MINVALUE 100001
    NO CYCLE;

CREATE OR REPLACE FUNCTION public.generate_vendor_settlement_number(p_year integer DEFAULT NULL)
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
    v_seq := nextval('public.vendor_settlement_number_seq');
    RETURN 'XSS-' || v_year::text || '-' || lpad(v_seq::text, 6, '0');
END;
$$;

REVOKE ALL ON FUNCTION public.generate_vendor_settlement_number(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_vendor_settlement_number(integer) TO service_role;

REVOKE ALL ON SEQUENCE public.vendor_settlement_number_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.vendor_settlement_number_seq TO service_role;

-- =============================================================
-- 7. VENDOR SETTLEMENT BATCHES TABLE
-- Administrative batches representing manual external disbursements (UPI/NEFT/RTGS)
-- Totals are authoritatively maintained from attached items
-- =============================================================
CREATE TABLE IF NOT EXISTS public.vendor_settlement_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id UUID NOT NULL REFERENCES public.shops(id) ON DELETE RESTRICT,
    settlement_number TEXT NOT NULL UNIQUE DEFAULT public.generate_vendor_settlement_number(),
    gross_order_amount NUMERIC(12,2) NOT NULL DEFAULT 0.00 CHECK (gross_order_amount >= 0.00),
    platform_commission_amount NUMERIC(12,2) NOT NULL DEFAULT 0.00 CHECK (platform_commission_amount >= 0.00),
    vendor_payable_amount NUMERIC(12,2) NOT NULL DEFAULT 0.00 CHECK (vendor_payable_amount >= 0.00),
    order_count INTEGER NOT NULL DEFAULT 0 CHECK (order_count >= 0),
    status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'CONFIRMED', 'PAID', 'CANCELLED')),
    payment_reference TEXT NULL,
    settled_at TIMESTAMPTZ NULL,
    disbursed_at TIMESTAMPTZ NULL,
    notes TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_settlement_batch_arithmetic CHECK (
        gross_order_amount = platform_commission_amount + vendor_payable_amount
    ),
    CONSTRAINT chk_settlement_batch_settled_at CHECK (
        status != 'PAID' OR settled_at IS NOT NULL
    )
);

CREATE INDEX IF NOT EXISTS idx_vendor_settlement_batches_shop_id
    ON public.vendor_settlement_batches(shop_id);

CREATE INDEX IF NOT EXISTS idx_vendor_settlement_batches_status
    ON public.vendor_settlement_batches(status);

COMMENT ON TABLE public.vendor_settlement_batches IS
    'Manual settlement disbursement batches grouping payable orders for external bank/UPI transfer.';

-- Deletion protection trigger: Batches cannot be deleted; unpaid batches must be CANCELLED
CREATE OR REPLACE FUNCTION public.protect_vendor_settlement_batch_deletion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF OLD.status = 'PAID' THEN
        RAISE EXCEPTION 'PAID settlement batches are permanent accounting records and cannot be deleted.';
    END IF;
    RAISE EXCEPTION 'Settlement batches cannot be deleted. Transition status to CANCELLED instead.';
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_vendor_settlement_batch_deletion ON public.vendor_settlement_batches;
CREATE TRIGGER trg_protect_vendor_settlement_batch_deletion
    BEFORE DELETE ON public.vendor_settlement_batches
    FOR EACH ROW
    EXECUTE FUNCTION public.protect_vendor_settlement_batch_deletion();

-- =============================================================
-- 8. VENDOR SETTLEMENT ITEMS TABLE & STRICT ELIGIBILITY
-- Junction linking individual order financial ledger rows to a settlement batch
-- Database strictly enforces:
--   - financial_status = 'PAYABLE' only (rejects UNCONFIGURED, PENDING, REVERSED, SETTLED)
--   - ledger.shop_id = batch.shop_id
--   - Parent batch must be DRAFT or CONFIRMED (rejects adding to PAID or CANCELLED)
--   - UNIQUE(order_financial_ledger_id) prevents double settlement
-- =============================================================
CREATE TABLE IF NOT EXISTS public.vendor_settlement_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    settlement_batch_id UUID NOT NULL REFERENCES public.vendor_settlement_batches(id) ON DELETE RESTRICT,
    order_financial_ledger_id UUID NOT NULL UNIQUE REFERENCES public.order_financial_ledger(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vendor_settlement_items_batch
    ON public.vendor_settlement_items(settlement_batch_id);

COMMENT ON TABLE public.vendor_settlement_items IS
    'Line items connecting order ledger rows to settlement batches. Unique constraint prevents double-settlement.';

-- Settlement Item Eligibility Trigger
CREATE OR REPLACE FUNCTION public.validate_vendor_settlement_item_eligibility()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_ledger RECORD;
    v_batch RECORD;
BEGIN
    SELECT * INTO v_ledger FROM public.order_financial_ledger WHERE id = NEW.order_financial_ledger_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order financial ledger % does not exist.', NEW.order_financial_ledger_id;
    END IF;

    SELECT * INTO v_batch FROM public.vendor_settlement_batches WHERE id = NEW.settlement_batch_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Vendor settlement batch % does not exist.', NEW.settlement_batch_id;
    END IF;

    -- Parent batch status check: cannot add to PAID or CANCELLED
    IF v_batch.status = 'PAID' THEN
        RAISE EXCEPTION 'Cannot add settlement items to a PAID batch. Paid settlements are immutable.';
    END IF;

    IF v_batch.status = 'CANCELLED' THEN
        RAISE EXCEPTION 'Cannot add settlement items to a CANCELLED batch.';
    END IF;

    -- Strict financial status check: only PAYABLE orders may be settled
    IF v_ledger.financial_status != 'PAYABLE' THEN
        RAISE EXCEPTION 'Cannot add order ledger % with status % to settlement batch. Only PAYABLE orders are eligible.',
            v_ledger.id, v_ledger.financial_status;
    END IF;

    -- Shop matching check
    IF v_ledger.shop_id != v_batch.shop_id THEN
        RAISE EXCEPTION 'Ledger shop (%) does not match batch shop (%).', v_ledger.shop_id, v_batch.shop_id;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_vendor_settlement_item ON public.vendor_settlement_items;
CREATE TRIGGER trg_validate_vendor_settlement_item
    BEFORE INSERT ON public.vendor_settlement_items
    FOR EACH ROW
    EXECUTE FUNCTION public.validate_vendor_settlement_item_eligibility();

-- Settlement Item Immutability Trigger
CREATE OR REPLACE FUNCTION public.protect_vendor_settlement_item_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_batch_status TEXT;
BEGIN
    SELECT status INTO v_batch_status
    FROM public.vendor_settlement_batches
    WHERE id = OLD.settlement_batch_id;

    IF v_batch_status = 'PAID' THEN
        IF TG_OP = 'DELETE' THEN
            RAISE EXCEPTION 'Cannot delete settlement item %: parent batch % is already PAID and immutable.',
                OLD.id, OLD.settlement_batch_id;
        ELSIF TG_OP = 'UPDATE' THEN
            RAISE EXCEPTION 'Cannot update settlement item %: parent batch % is already PAID and immutable.',
                OLD.id, OLD.settlement_batch_id;
        END IF;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF NEW.settlement_batch_id != OLD.settlement_batch_id THEN
            RAISE EXCEPTION 'Field settlement_batch_id is immutable on settlement items.';
        END IF;
        IF NEW.order_financial_ledger_id != OLD.order_financial_ledger_id THEN
            RAISE EXCEPTION 'Field order_financial_ledger_id is immutable on settlement items.';
        END IF;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_vendor_settlement_item_immutability ON public.vendor_settlement_items;
CREATE TRIGGER trg_protect_vendor_settlement_item_immutability
    BEFORE UPDATE OR DELETE ON public.vendor_settlement_items
    FOR EACH ROW
    EXECUTE FUNCTION public.protect_vendor_settlement_item_immutability();

-- Trigger to recalculate batch totals authoritatively from attached items
CREATE OR REPLACE FUNCTION public.recalculate_vendor_settlement_batch_totals()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_batch_id UUID;
    v_batch_status TEXT;
    v_gross NUMERIC(12,2);
    v_commission NUMERIC(12,2);
    v_net NUMERIC(12,2);
    v_count INTEGER;
BEGIN
    v_batch_id := COALESCE(NEW.settlement_batch_id, OLD.settlement_batch_id);

    SELECT status INTO v_batch_status
    FROM public.vendor_settlement_batches
    WHERE id = v_batch_id;

    -- If batch is CANCELLED or PAID, totals are not recalculated from items
    IF v_batch_status = 'CANCELLED' OR v_batch_status = 'PAID' THEN
        RETURN NULL;
    END IF;

    SELECT
        COALESCE(SUM(l.gross_amount), 0.00),
        COALESCE(SUM(l.platform_commission_amount), 0.00),
        COALESCE(SUM(l.vendor_net_amount), 0.00),
        COUNT(l.id)
    INTO v_gross, v_commission, v_net, v_count
    FROM public.vendor_settlement_items i
    JOIN public.order_financial_ledger l ON l.id = i.order_financial_ledger_id
    WHERE i.settlement_batch_id = v_batch_id;

    UPDATE public.vendor_settlement_batches
    SET gross_order_amount = v_gross,
        platform_commission_amount = v_commission,
        vendor_payable_amount = v_net,
        order_count = v_count,
        updated_at = now()
    WHERE id = v_batch_id;

    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_recalculate_batch_totals ON public.vendor_settlement_items;
CREATE TRIGGER trg_recalculate_batch_totals
    AFTER INSERT OR DELETE OR UPDATE ON public.vendor_settlement_items
    FOR EACH ROW
    EXECUTE FUNCTION public.recalculate_vendor_settlement_batch_totals();

-- Trigger to manage batch status transitions, PAID immutability, precondition validation, and atomic settlement
CREATE OR REPLACE FUNCTION public.sync_vendor_settlement_batch_paid()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_invalid_count INTEGER;
    v_invalid_statuses TEXT;
    v_settled_at TIMESTAMPTZ;
BEGIN
    -- 1. Validate Immutability when batch is already PAID
    IF OLD.status = 'PAID' THEN
        IF NEW.status != 'PAID' THEN
            RAISE EXCEPTION 'PAID settlement batch status is terminal and cannot be reverted or transitioned to %.', NEW.status;
        END IF;
        IF NEW.shop_id != OLD.shop_id THEN
            RAISE EXCEPTION 'Field shop_id is immutable on PAID settlement batches.';
        END IF;
        IF NEW.settlement_number != OLD.settlement_number THEN
            RAISE EXCEPTION 'Field settlement_number is immutable on PAID settlement batches.';
        END IF;
        IF NEW.gross_order_amount != OLD.gross_order_amount OR
           NEW.platform_commission_amount != OLD.platform_commission_amount OR
           NEW.vendor_payable_amount != OLD.vendor_payable_amount OR
           NEW.order_count != OLD.order_count THEN
            RAISE EXCEPTION 'Financial totals are immutable on PAID settlement batches.';
        END IF;
        IF NEW.settled_at IS DISTINCT FROM OLD.settled_at THEN
            RAISE EXCEPTION 'Field settled_at is immutable on PAID settlement batches.';
        END IF;
    END IF;

    -- 2. Validate Terminal State of CANCELLED
    IF OLD.status = 'CANCELLED' AND NEW.status != 'CANCELLED' THEN
        RAISE EXCEPTION 'CANCELLED settlement batch status is terminal and cannot be transitioned to %.', NEW.status;
    END IF;

    -- 3. Status Transition Matrix
    IF OLD.status != NEW.status THEN
        IF OLD.status = 'DRAFT' AND NEW.status NOT IN ('CONFIRMED', 'CANCELLED') THEN
            RAISE EXCEPTION 'Illegal status transition for settlement batch from DRAFT to %. Must be CONFIRMED or CANCELLED.', NEW.status;
        ELSIF OLD.status = 'CONFIRMED' AND NEW.status NOT IN ('PAID', 'CANCELLED') THEN
            RAISE EXCEPTION 'Illegal status transition for settlement batch from CONFIRMED to %. Must be PAID or CANCELLED.', NEW.status;
        END IF;
    END IF;

    -- 4. Transition to PAID Precondition & Atomic Settlement
    IF NEW.status = 'PAID' AND OLD.status != 'PAID' THEN
        -- Verify that ALL attached ledger entries are strictly PAYABLE
        SELECT COUNT(*), string_agg(DISTINCT l.financial_status, ', ')
        INTO v_invalid_count, v_invalid_statuses
        FROM public.vendor_settlement_items i
        JOIN public.order_financial_ledger l ON l.id = i.order_financial_ledger_id
        WHERE i.settlement_batch_id = NEW.id
          AND l.financial_status != 'PAYABLE';

        IF v_invalid_count > 0 THEN
            RAISE EXCEPTION 'Cannot transition settlement batch % to PAID: % attached ledger item(s) have non-PAYABLE status (%).',
                NEW.id, v_invalid_count, v_invalid_statuses;
        END IF;

        -- Batch must contain at least 1 order to be paid
        IF NEW.order_count <= 0 THEN
            RAISE EXCEPTION 'Cannot transition settlement batch % to PAID: batch contains 0 orders.', NEW.id;
        END IF;

        -- Authoritative settlement timestamp
        v_settled_at := COALESCE(NEW.settled_at, NEW.disbursed_at, now());
        NEW.settled_at := v_settled_at;
        NEW.disbursed_at := COALESCE(NEW.disbursed_at, v_settled_at);

        -- Atomically transition all attached ledger entries to SETTLED with the exact same timestamp
        UPDATE public.order_financial_ledger
        SET financial_status = 'SETTLED',
            settled_at = v_settled_at,
            updated_at = v_settled_at
        WHERE id IN (
            SELECT order_financial_ledger_id
            FROM public.vendor_settlement_items
            WHERE settlement_batch_id = NEW.id
        );
    END IF;

    -- 5. Transition to CANCELLED: Zero batch totals
    IF NEW.status = 'CANCELLED' AND OLD.status != 'CANCELLED' THEN
        NEW.gross_order_amount := 0.00;
        NEW.platform_commission_amount := 0.00;
        NEW.vendor_payable_amount := 0.00;
        NEW.order_count := 0;
    END IF;

    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_vendor_settlement_batch_paid ON public.vendor_settlement_batches;
CREATE TRIGGER trg_sync_vendor_settlement_batch_paid
    BEFORE UPDATE ON public.vendor_settlement_batches
    FOR EACH ROW
    EXECUTE FUNCTION public.sync_vendor_settlement_batch_paid();

-- Trigger to release attached ledger items when batch transitions to CANCELLED
CREATE OR REPLACE FUNCTION public.release_cancelled_settlement_batch_items()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.status = 'CANCELLED' AND OLD.status != 'CANCELLED' THEN
        -- Delete all items attached to this batch so the UNIQUE constraint on order_financial_ledger_id is freed
        DELETE FROM public.vendor_settlement_items
        WHERE settlement_batch_id = NEW.id;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_release_cancelled_settlement_batch_items ON public.vendor_settlement_batches;
CREATE TRIGGER trg_release_cancelled_settlement_batch_items
    AFTER UPDATE OF status ON public.vendor_settlement_batches
    FOR EACH ROW
    WHEN (NEW.status = 'CANCELLED' AND OLD.status != 'CANCELLED')
    EXECUTE FUNCTION public.release_cancelled_settlement_batch_items();

-- =============================================================
-- 9. ROW LEVEL SECURITY (RLS) POLICIES
-- Strict isolation: Vendors can only view their own shop records.
-- =============================================================
ALTER TABLE public.shop_commission_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_financial_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_settlement_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_settlement_items ENABLE ROW LEVEL SECURITY;

-- 9a. shop_commission_rules RLS
DROP POLICY IF EXISTS vendor_select_shop_commission_rules ON public.shop_commission_rules;
CREATE POLICY vendor_select_shop_commission_rules
    ON public.shop_commission_rules
    FOR SELECT
    TO authenticated
    USING (
        shop_id IN (
            SELECT s.id FROM public.shops s WHERE s.owner_id = auth.uid()
        )
    );

-- 9b. order_financial_ledger RLS
DROP POLICY IF EXISTS vendor_select_own_shop_ledger ON public.order_financial_ledger;
CREATE POLICY vendor_select_own_shop_ledger
    ON public.order_financial_ledger
    FOR SELECT
    TO authenticated
    USING (
        shop_id IN (
            SELECT s.id FROM public.shops s WHERE s.owner_id = auth.uid()
        )
    );

-- 9c. vendor_settlement_batches RLS
DROP POLICY IF EXISTS vendor_select_own_settlement_batches ON public.vendor_settlement_batches;
CREATE POLICY vendor_select_own_settlement_batches
    ON public.vendor_settlement_batches
    FOR SELECT
    TO authenticated
    USING (
        shop_id IN (
            SELECT s.id FROM public.shops s WHERE s.owner_id = auth.uid()
        )
    );

-- 9d. vendor_settlement_items RLS
DROP POLICY IF EXISTS vendor_select_own_settlement_items ON public.vendor_settlement_items;
CREATE POLICY vendor_select_own_settlement_items
    ON public.vendor_settlement_items
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM public.vendor_settlement_batches b
            JOIN public.shops s ON s.id = b.shop_id
            WHERE b.id = vendor_settlement_items.settlement_batch_id
              AND s.owner_id = auth.uid()
        )
    );

-- =============================================================
-- 10. REVOKE DIRECT CLIENT MUTATIONS
-- Client apps cannot INSERT, UPDATE, or DELETE financial ledger data directly
-- =============================================================
REVOKE INSERT, UPDATE, DELETE ON TABLE public.shop_commission_rules FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.order_financial_ledger FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.vendor_settlement_batches FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.vendor_settlement_items FROM anon, authenticated;

REVOKE ALL ON FUNCTION public.protect_vendor_settlement_batch_deletion() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_vendor_settlement_item_eligibility() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.protect_vendor_settlement_item_immutability() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.recalculate_vendor_settlement_batch_totals() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_vendor_settlement_batch_paid() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_cancelled_settlement_batch_items() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.protect_vendor_settlement_batch_deletion() TO service_role;
GRANT EXECUTE ON FUNCTION public.validate_vendor_settlement_item_eligibility() TO service_role;
GRANT EXECUTE ON FUNCTION public.protect_vendor_settlement_item_immutability() TO service_role;
GRANT EXECUTE ON FUNCTION public.recalculate_vendor_settlement_batch_totals() TO service_role;
GRANT EXECUTE ON FUNCTION public.sync_vendor_settlement_batch_paid() TO service_role;
GRANT EXECUTE ON FUNCTION public.release_cancelled_settlement_batch_items() TO service_role;

-- =============================================================
-- 11. HISTORICAL ORDERS BACKFILL QUERY
-- Safely backfills all existing paid and refunded orders into order_financial_ledger.
-- Does NOT invent a commission percentage (status = UNCONFIGURED or REVERSED).
-- Populates reversed_at and reversal_reason for refunded orders.
-- Idempotent: ON CONFLICT (order_id) DO NOTHING.
-- =============================================================
DO $$
DECLARE
    v_order RECORD;
    v_attempt RECORD;
    v_status TEXT;
    v_eligible_at TIMESTAMPTZ;
    v_reversed_at TIMESTAMPTZ;
    v_reversal_reason TEXT;
BEGIN
    FOR v_order IN
        SELECT
            o.id AS order_id,
            o.shop_id,
            o.user_id,
            o.total_amount,
            o.status,
            o.payment_status,
            o.paid_at,
            o.completed_at
        FROM public.orders o
        WHERE o.payment_status IN ('PAID', 'REFUNDED')
        ORDER BY o.created_at ASC
    LOOP
        -- Find authoritative payment attempt for this order
        SELECT pa.id, pa.amount, pa.currency
        INTO v_attempt
        FROM public.payment_attempts pa
        WHERE pa.order_id = v_order.order_id
          AND pa.status IN ('PAID', 'REFUNDED')
        ORDER BY pa.created_at DESC
        LIMIT 1;

        IF v_attempt.id IS NOT NULL THEN
            -- Determine initial financial status
            -- If commission is unconfigured, status MUST be UNCONFIGURED (or REVERSED if refunded)
            IF v_order.payment_status = 'REFUNDED' OR v_order.status = 'CANCELLED' THEN
                v_status := 'REVERSED';
                v_eligible_at := NULL;
                v_reversed_at := COALESCE(v_order.paid_at, now());
                v_reversal_reason := 'Historical refund backfill';
            ELSE
                v_status := 'UNCONFIGURED';
                v_eligible_at := NULL;
                v_reversed_at := NULL;
                v_reversal_reason := NULL;
            END IF;

            INSERT INTO public.order_financial_ledger (
                order_id,
                shop_id,
                user_id,
                payment_attempt_id,
                gross_amount,
                currency,
                commission_bps,
                platform_commission_amount,
                vendor_net_amount,
                financial_status,
                eligible_at,
                settled_at,
                reversed_at,
                refund_request_id,
                reversal_reason,
                created_at,
                updated_at
            ) VALUES (
                v_order.order_id,
                v_order.shop_id,
                v_order.user_id,
                v_attempt.id,
                v_order.total_amount,
                COALESCE(v_attempt.currency, 'INR'),
                NULL,
                NULL,
                NULL,
                v_status,
                v_eligible_at,
                NULL,
                v_reversed_at,
                NULL,
                v_reversal_reason,
                COALESCE(v_order.paid_at, now()),
                now()
            )
            ON CONFLICT (order_id) DO NOTHING;
        END IF;
    END LOOP;
END;
$$;

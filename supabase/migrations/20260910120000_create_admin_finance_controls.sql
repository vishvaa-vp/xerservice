-- ==============================================================================
-- XerService Backend — Phase 6K: Admin Finance & Commission Controls
-- Migration: 20260910120000_create_admin_finance_controls.sql
--
-- PURPOSE:
-- 1. Add audit metadata to public.vendor_settlement_batches:
--    - payment_reference (TEXT NULL, verified present)
--    - payment_method (UPI, NEFT, IMPS, BANK_TRANSFER, OTHER)
--    - paid_by (Admin user reference)
--    - created_by (Admin user reference)
--    - confirmed_by (Admin user reference)
--    - confirmed_at (Confirmation timestamp)
-- 2. Enforce database-level PAID and CONFIRMED audit invariants:
--    - status = 'PAID' requires payment_method, non-empty payment_reference, paid_by, settled_at, disbursed_at
--    - status IN ('CONFIRMED', 'PAID') requires confirmed_by and confirmed_at
-- 3. Enforce strict post-PAID immutability across all financial and audit fields.
-- 4. Provide trusted bulk-activation procedure for shop commission rules.
-- 5. Revoke execution from PUBLIC, anon, authenticated; grant only to service_role.
-- ==============================================================================

BEGIN;

-- 1. Add audit metadata columns to public.vendor_settlement_batches
ALTER TABLE public.vendor_settlement_batches
    ADD COLUMN IF NOT EXISTS payment_reference TEXT NULL,
    ADD COLUMN IF NOT EXISTS payment_method TEXT NULL,
    ADD COLUMN IF NOT EXISTS paid_by UUID NULL REFERENCES auth.users(id),
    ADD COLUMN IF NOT EXISTS created_by UUID NULL REFERENCES auth.users(id),
    ADD COLUMN IF NOT EXISTS confirmed_by UUID NULL REFERENCES auth.users(id),
    ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ NULL;

-- 2. Check constraints for settlement batches
-- 2a. Allowed payment methods
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_settlement_batch_payment_method'
    ) THEN
        ALTER TABLE public.vendor_settlement_batches
            ADD CONSTRAINT chk_settlement_batch_payment_method
            CHECK (payment_method IS NULL OR payment_method IN ('UPI', 'NEFT', 'IMPS', 'BANK_TRANSFER', 'OTHER'));
    END IF;
END;
$$;

-- 2b. CONFIRMED audit invariant: status IN ('CONFIRMED', 'PAID') requires confirmed_by AND confirmed_at
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_settlement_batch_confirmed_audit'
    ) THEN
        ALTER TABLE public.vendor_settlement_batches
            ADD CONSTRAINT chk_settlement_batch_confirmed_audit
            CHECK (
                status NOT IN ('CONFIRMED', 'PAID') OR (
                    confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL
                )
            );
    END IF;
END;
$$;

-- 2c. PAID audit invariant: status = 'PAID' requires payment_method, non-empty payment_reference, paid_by, settled_at, disbursed_at
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_settlement_batch_paid_audit'
    ) THEN
        ALTER TABLE public.vendor_settlement_batches
            ADD CONSTRAINT chk_settlement_batch_paid_audit
            CHECK (
                status != 'PAID' OR (
                    payment_method IS NOT NULL
                    AND payment_reference IS NOT NULL
                    AND length(trim(payment_reference)) > 0
                    AND paid_by IS NOT NULL
                    AND settled_at IS NOT NULL
                    AND disbursed_at IS NOT NULL
                )
            );
    END IF;
END;
$$;

-- 3. Update sync_vendor_settlement_batch_paid to enforce audit invariants and post-PAID immutability
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
        IF NEW.disbursed_at IS DISTINCT FROM OLD.disbursed_at THEN
            RAISE EXCEPTION 'Field disbursed_at is immutable on PAID settlement batches.';
        END IF;
        IF NEW.confirmed_by IS DISTINCT FROM OLD.confirmed_by THEN
            RAISE EXCEPTION 'Field confirmed_by is immutable on PAID settlement batches.';
        END IF;
        IF NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at THEN
            RAISE EXCEPTION 'Field confirmed_at is immutable on PAID settlement batches.';
        END IF;
        IF NEW.payment_reference IS DISTINCT FROM OLD.payment_reference THEN
            RAISE EXCEPTION 'Field payment_reference is immutable on PAID settlement batches.';
        END IF;
        IF NEW.payment_method IS DISTINCT FROM OLD.payment_method THEN
            RAISE EXCEPTION 'Field payment_method is immutable on PAID settlement batches.';
        END IF;
        IF NEW.paid_by IS DISTINCT FROM OLD.paid_by THEN
            RAISE EXCEPTION 'Field paid_by is immutable on PAID settlement batches.';
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

    -- 4. Transition from DRAFT to CONFIRMED: require confirmed_by and record confirmed_at
    IF OLD.status = 'DRAFT' AND NEW.status = 'CONFIRMED' THEN
        IF NEW.confirmed_by IS NULL THEN
            RAISE EXCEPTION 'confirmed_by is required when confirming settlement batch.';
        END IF;
        NEW.confirmed_at := COALESCE(NEW.confirmed_at, now());
    END IF;

    -- 5. Transition to PAID Precondition & Atomic Settlement
    IF NEW.status = 'PAID' AND OLD.status != 'PAID' THEN
        -- Verify payout audit metadata
        IF NEW.payment_method IS NULL THEN
            RAISE EXCEPTION 'payment_method cannot be null when marking settlement batch as PAID.';
        END IF;
        IF NEW.payment_reference IS NULL OR length(trim(NEW.payment_reference)) = 0 THEN
            RAISE EXCEPTION 'payment_reference cannot be empty when marking settlement batch as PAID.';
        END IF;
        IF NEW.paid_by IS NULL THEN
            RAISE EXCEPTION 'paid_by cannot be null when marking settlement batch as PAID.';
        END IF;
        IF NEW.confirmed_by IS NULL OR NEW.confirmed_at IS NULL THEN
            RAISE EXCEPTION 'PAID settlement batch requires a prior confirmation audit (confirmed_by and confirmed_at).';
        END IF;

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
        UPDATE public.order_financial_ledger l
        SET financial_status = 'SETTLED',
            settled_at = v_settled_at,
            updated_at = now()
        FROM public.vendor_settlement_items i
        WHERE i.settlement_batch_id = NEW.id
          AND l.id = i.order_financial_ledger_id;
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

-- 4. Bulk Apply Commission Rule Procedure
-- Iterates over unconfigured orders for a shop falling within a rule window and activates them
CREATE OR REPLACE FUNCTION public.apply_shop_commission_rule(
    p_shop_id UUID,
    p_rule_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_rule RECORD;
    v_row RECORD;
    v_configured_count INTEGER := 0;
    v_skipped_reversed_count INTEGER := 0;
    v_still_unconfigured_count INTEGER := 0;
    v_failed_count INTEGER := 0;
BEGIN
    -- Fetch and validate rule
    SELECT id, shop_id, commission_bps, effective_from, effective_to, is_active
    INTO v_rule
    FROM public.shop_commission_rules
    WHERE id = p_rule_id AND shop_id = p_shop_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Commission rule % not found for shop %.', p_rule_id, p_shop_id;
    END IF;

    IF NOT v_rule.is_active THEN
        RAISE EXCEPTION 'Commission rule % is inactive.', p_rule_id;
    END IF;

    -- Iterate over UNCONFIGURED ledger rows for this shop whose authoritative payment falls in the rule window
    FOR v_row IN
        SELECT l.id, l.order_id, l.financial_status, pa.paid_at
        FROM public.order_financial_ledger l
        JOIN public.payment_attempts pa ON pa.id = l.payment_attempt_id
        WHERE l.shop_id = p_shop_id
          AND l.financial_status = 'UNCONFIGURED'
          AND pa.paid_at >= v_rule.effective_from
          AND (v_rule.effective_to IS NULL OR pa.paid_at < v_rule.effective_to)
        ORDER BY l.created_at ASC
    LOOP
        BEGIN
            PERFORM public.configure_unconfigured_order_ledger(v_row.order_id);
            v_configured_count := v_configured_count + 1;
        EXCEPTION WHEN OTHERS THEN
            v_failed_count := v_failed_count + 1;
            RAISE NOTICE 'Failed to configure ledger for order %: %', v_row.order_id, SQLERRM;
        END;
    END LOOP;

    -- Count remaining unconfigured orders for this shop
    SELECT COUNT(*) INTO v_still_unconfigured_count
    FROM public.order_financial_ledger
    WHERE shop_id = p_shop_id AND financial_status = 'UNCONFIGURED';

    -- Count reversed orders for this shop (these safely remain reversed)
    SELECT COUNT(*) INTO v_skipped_reversed_count
    FROM public.order_financial_ledger
    WHERE shop_id = p_shop_id AND financial_status = 'REVERSED';

    RETURN jsonb_build_object(
        'success', true,
        'shop_id', p_shop_id,
        'rule_id', p_rule_id,
        'configured_count', v_configured_count,
        'still_unconfigured_count', v_still_unconfigured_count,
        'skipped_reversed_count', v_skipped_reversed_count,
        'failed_count', v_failed_count
    );
END;
$$;

-- 5. Revoke function permissions from PUBLIC, anon, and authenticated; Grant only to service_role
REVOKE ALL ON FUNCTION public.sync_vendor_settlement_batch_paid() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_vendor_settlement_batch_paid() FROM anon;
REVOKE ALL ON FUNCTION public.sync_vendor_settlement_batch_paid() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.sync_vendor_settlement_batch_paid() TO service_role;

REVOKE ALL ON FUNCTION public.apply_shop_commission_rule(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_shop_commission_rule(UUID, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.apply_shop_commission_rule(UUID, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.apply_shop_commission_rule(UUID, UUID) TO service_role;

COMMIT;

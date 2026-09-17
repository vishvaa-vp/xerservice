-- ==============================================================================
-- XerService Backend — Phase 6J Corrective Migration
-- Migration: 20260910110000_fix_vendor_ledger_refund_audit.sql
--
-- PURPOSE:
-- Repair historical REVERSED order_financial_ledger audit metadata only.
--
-- AUDIT FINDINGS:
-- - 6 historical refunded orders exist in order_financial_ledger with financial_status = 'REVERSED'.
-- - Previously, their refund_request_id was NULL and reversed_at was incorrectly set to orders.paid_at.
-- - Each of the 6 orders has exactly ONE authoritative refund_requests row with:
--     order_id = ledger.order_id
--     payment_attempt_id = ledger.payment_attempt_id
--     status = 'SUCCEEDED'
--     completed_at IS NOT NULL
--
-- ACTIONS:
-- 1. Temporarily drop trg_order_financial_ledger_immutability to allow atomic audit metadata update.
-- 2. Strictly match each REVERSED ledger row against public.refund_requests.
-- 3. Fail-closed: require exactly ONE authoritative successful refund per reversed row.
-- 4. Set refund_request_id = refund_requests.id (only if currently NULL; never silently overwrite non-null).
-- 5. Set reversed_at = refund_requests.completed_at (authoritative refund completion timestamp, never paid_at or cancelled_at).
-- 6. Preserve all immutable fields: order_id, shop_id, user_id, payment_attempt_id, gross_amount, currency, commission_bps, platform_commission_amount, vendor_net_amount, created_at.
-- 7. Add foreign key constraint fk_order_financial_ledger_refund_request and index for referential integrity.
-- 8. Immediately restore the exact hardened trg_order_financial_ledger_immutability trigger definition.
-- ==============================================================================

BEGIN;

-- 1. Temporarily drop the immutability trigger during migration
DROP TRIGGER IF EXISTS trg_order_financial_ledger_immutability ON public.order_financial_ledger;

-- 2. Audit and repair historical REVERSED rows in order_financial_ledger
DO $$
DECLARE
    v_ledger RECORD;
    v_refund RECORD;
    v_refund_count INTEGER;
    v_repaired_count INTEGER := 0;
BEGIN
    FOR v_ledger IN
        SELECT id, order_id, payment_attempt_id, refund_request_id, reversed_at, financial_status
        FROM public.order_financial_ledger
        WHERE financial_status = 'REVERSED'
        ORDER BY created_at ASC
    LOOP
        -- If refund_request_id is already non-null, verify it exists and do not overwrite
        IF v_ledger.refund_request_id IS NOT NULL THEN
            SELECT COUNT(*) INTO v_refund_count
            FROM public.refund_requests
            WHERE id = v_ledger.refund_request_id
              AND status = 'SUCCEEDED'
              AND completed_at IS NOT NULL;

            IF v_refund_count != 1 THEN
                RAISE EXCEPTION 'Ledger entry % has invalid existing refund_request_id % (count: %)',
                    v_ledger.id, v_ledger.refund_request_id, v_refund_count;
            END IF;

            -- Row already has authoritative refund_request_id, skip repair
            CONTINUE;
        END IF;

        -- Strict matching hierarchy:
        -- 1. same order_id
        -- 2. same payment_attempt_id
        -- 3. status = 'SUCCEEDED'
        -- 4. completed_at IS NOT NULL
        SELECT COUNT(*) INTO v_refund_count
        FROM public.refund_requests
        WHERE order_id = v_ledger.order_id
          AND payment_attempt_id = v_ledger.payment_attempt_id
          AND status = 'SUCCEEDED'
          AND completed_at IS NOT NULL;

        -- Fail-closed: exactly one authoritative successful refund must exist
        IF v_refund_count = 0 THEN
            RAISE EXCEPTION 'FAIL-CLOSED: Zero matching successful refunds found for REVERSED ledger entry % (order_id: %, payment_attempt_id: %). Cannot fabricate refund reference.',
                v_ledger.id, v_ledger.order_id, v_ledger.payment_attempt_id;
        ELSIF v_refund_count > 1 THEN
            RAISE EXCEPTION 'FAIL-CLOSED: Ambiguous successful refunds (% found) for REVERSED ledger entry % (order_id: %, payment_attempt_id: %). Cannot guess authoritative reference.',
                v_refund_count, v_ledger.id, v_ledger.order_id, v_ledger.payment_attempt_id;
        END IF;

        -- Fetch the single authoritative refund record
        SELECT id, completed_at INTO v_refund
        FROM public.refund_requests
        WHERE order_id = v_ledger.order_id
          AND payment_attempt_id = v_ledger.payment_attempt_id
          AND status = 'SUCCEEDED'
          AND completed_at IS NOT NULL
        LIMIT 1;

        -- Perform precise, narrowly scoped update
        UPDATE public.order_financial_ledger
        SET refund_request_id = v_refund.id,
            reversed_at = v_refund.completed_at,
            reversal_reason = COALESCE(reversal_reason, 'Historical successful refund backfill'),
            updated_at = now()
        WHERE id = v_ledger.id
          AND financial_status = 'REVERSED';

        v_repaired_count := v_repaired_count + 1;
        RAISE NOTICE 'Repaired ledger entry % (order_id: %): refund_request_id = %, reversed_at = %',
            v_ledger.id, v_ledger.order_id, v_refund.id, v_refund.completed_at;
    END LOOP;

    RAISE NOTICE 'Phase 6J Repair: Successfully repaired % historical REVERSED ledger rows.', v_repaired_count;
END;
$$;

-- 3. Post-repair validation: verify invariants on all REVERSED rows
DO $$
DECLARE
    v_invalid_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_invalid_count
    FROM public.order_financial_ledger l
    LEFT JOIN public.refund_requests rr ON rr.id = l.refund_request_id
    WHERE l.financial_status = 'REVERSED'
      AND (
          l.refund_request_id IS NULL
          OR l.reversed_at IS NULL
          OR l.reversal_reason IS NULL
          OR rr.id IS NULL
          OR rr.status != 'SUCCEEDED'
          OR rr.completed_at IS NULL
          OR l.reversed_at != rr.completed_at
      );

    IF v_invalid_count > 0 THEN
        RAISE EXCEPTION 'POST-REPAIR VALIDATION FAILED: % REVERSED ledger rows failed audit invariants.', v_invalid_count;
    END IF;
END;
$$;

-- 4. Foreign Key and Index for refund_request_id integrity
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_order_financial_ledger_refund_request'
    ) THEN
        ALTER TABLE public.order_financial_ledger
            ADD CONSTRAINT fk_order_financial_ledger_refund_request
            FOREIGN KEY (refund_request_id) REFERENCES public.refund_requests(id)
            ON DELETE RESTRICT;
    END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_order_financial_ledger_refund_request_id
    ON public.order_financial_ledger(refund_request_id);

-- 5. Immediately restore the exact hardened immutability trigger definition
CREATE TRIGGER trg_order_financial_ledger_immutability
    BEFORE UPDATE OR DELETE ON public.order_financial_ledger
    FOR EACH ROW
    EXECUTE FUNCTION public.protect_order_financial_ledger_immutability();

COMMIT;

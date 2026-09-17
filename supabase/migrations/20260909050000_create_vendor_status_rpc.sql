-- =============================================================
-- Migration: Create Atomic Vendor Order Status Transition RPC
-- File: supabase/migrations/20260909050000_create_vendor_status_rpc.sql
-- Security: service_role execution only, row-level FOR UPDATE locking,
--           strict state machine validation, paid status requirement
-- =============================================================

CREATE OR REPLACE FUNCTION public.transition_vendor_order_status(
    p_order_id UUID,
    p_expected_status TEXT,
    p_new_status TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_order RECORD;
    v_result JSONB;
BEGIN
    -- 1. Validate Input Parameters
    IF p_order_id IS NULL OR p_expected_status IS NULL OR p_new_status IS NULL THEN
        RAISE EXCEPTION 'Missing required arguments: order_id, expected_status, new_status are required';
    END IF;

    -- 2. Lock Order Row FOR UPDATE to guarantee concurrency safety
    SELECT * INTO v_order
    FROM public.orders
    WHERE id = p_order_id
    FOR UPDATE;

    IF v_order.id IS NULL THEN
        RAISE EXCEPTION 'Order with ID % not found', p_order_id;
    END IF;

    -- 3. Verify Payment Status is PAID
    IF v_order.payment_status != 'PAID' THEN
        RAISE EXCEPTION 'Cannot transition order status for order %: payment_status is % (must be PAID)',
            p_order_id, v_order.payment_status;
    END IF;

    -- 4. Verify Current Status Matches Expected Status
    IF v_order.status != p_expected_status THEN
        RAISE EXCEPTION 'Order status mismatch for %: current status is %, expected %',
            p_order_id, v_order.status, p_expected_status;
    END IF;

    -- 5. Validate Legal State Machine Transition
    -- Permitted vendor transitions ONLY:
    --   QUEUED   -> PRINTING
    --   PRINTING -> READY
    --   READY    -> COMPLETED
    -- All other combinations are strictly rejected:
    --   QUEUED   -> READY
    --   QUEUED   -> COMPLETED
    --   PRINTING -> COMPLETED
    --   READY    -> PRINTING
    --   COMPLETED-> READY
    --   ANY      -> DRAFT / AWAITING_PAYMENT / CANCELLED / QUEUED
    IF NOT (
        (p_expected_status = 'QUEUED' AND p_new_status = 'PRINTING') OR
        (p_expected_status = 'PRINTING' AND p_new_status = 'READY') OR
        (p_expected_status = 'READY' AND p_new_status = 'COMPLETED')
    ) THEN
        RAISE EXCEPTION 'Invalid vendor order status transition: from % to % is not allowed',
            p_expected_status, p_new_status;
    END IF;

    -- 6. Perform the Status Update
    -- Triggers will automatically:
    --   - Update updated_at
    --   - Set milestone timestamp (printing_started_at, ready_at, completed_at) via trg_orders_timestamps_and_security
    --   - Record transition in public.order_status_history via trg_order_status_history
    UPDATE public.orders
    SET
        status = p_new_status,
        updated_at = now()
    WHERE id = p_order_id
    RETURNING * INTO v_order;

    -- 7. Return Updated Order Information as JSONB
    v_result := jsonb_build_object(
        'id', v_order.id,
        'order_number', v_order.order_number,
        'status', v_order.status,
        'payment_status', v_order.payment_status,
        'shop_id', v_order.shop_id,
        'printing_started_at', v_order.printing_started_at,
        'ready_at', v_order.ready_at,
        'completed_at', v_order.completed_at,
        'updated_at', v_order.updated_at
    );

    RETURN v_result;
END;
$$;

-- -------------------------------------------------------------
-- SECURITY & PRIVILEGE CONFIGURATION
-- Execute privilege restricted strictly to service_role backend.
-- Authenticated/anon browser clients cannot invoke this function directly.
-- -------------------------------------------------------------
REVOKE ALL ON FUNCTION public.transition_vendor_order_status(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transition_vendor_order_status(UUID, TEXT, TEXT) TO service_role;

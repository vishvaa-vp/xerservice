-- =============================================================
-- Migration: Order Cancellation & Refund Engine (Phase 6E)
-- File: supabase/migrations/20260909090000_create_cancellation_and_refund_engine.sql
-- Security: service_role execution only for RPCs, strict RLS, row-level locking
-- =============================================================

-- 1. Extend public.orders with cancellation audit fields
ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS cancelled_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS cancellation_reason TEXT NULL;

-- 2. Create authoritative refund_requests table
CREATE TABLE IF NOT EXISTS public.refund_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    payment_attempt_id UUID NULL REFERENCES public.payment_attempts(id) ON DELETE RESTRICT,
    provider TEXT NOT NULL CHECK (provider IN ('RAZORPAY', 'XERCOINS')),
    amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    status TEXT NOT NULL CHECK (status IN ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED')),
    reason TEXT NULL,
    requested_by UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
    requested_by_role TEXT NULL CHECK (requested_by_role IN ('CUSTOMER', 'VENDOR', 'ADMIN', 'SYSTEM')),
    provider_refund_id TEXT NULL,
    failure_reason TEXT NULL,
    idempotency_key TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ NULL
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_refund_requests_order_id ON public.refund_requests(order_id);
CREATE INDEX IF NOT EXISTS idx_refund_requests_user_id ON public.refund_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_refund_requests_status ON public.refund_requests(status);

-- 2b. Enforce at most ONE active or successful refund lifecycle per order
-- FAILED refunds are excluded and therefore retryable.
-- SUCCEEDED permanently blocks any secondary full refund for the same order.
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_refund_per_order
    ON public.refund_requests (order_id)
    WHERE status IN ('PENDING', 'PROCESSING', 'SUCCEEDED');

-- 3. Row Level Security for refund_requests
ALTER TABLE public.refund_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS refund_requests_customer_select ON public.refund_requests;
CREATE POLICY refund_requests_customer_select ON public.refund_requests
    FOR SELECT TO authenticated
    USING (user_id = auth.uid());

DROP POLICY IF EXISTS refund_requests_vendor_select ON public.refund_requests;
CREATE POLICY refund_requests_vendor_select ON public.refund_requests
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.orders o
            JOIN public.shops s ON s.id = o.shop_id
            WHERE o.id = refund_requests.order_id
              AND s.owner_id = auth.uid()
        )
    );

-- Browser roles cannot INSERT, UPDATE, DELETE directly on refund_requests
REVOKE INSERT, UPDATE, DELETE ON public.refund_requests FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.refund_requests TO service_role;

-- 4. Harden transition_vendor_order_status to block QUEUED -> PRINTING when refund is in progress
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
    IF NOT (
        (p_expected_status = 'QUEUED' AND p_new_status = 'PRINTING') OR
        (p_expected_status = 'PRINTING' AND p_new_status = 'READY') OR
        (p_expected_status = 'READY' AND p_new_status = 'COMPLETED')
    ) THEN
        RAISE EXCEPTION 'Invalid vendor order status transition: from % to % is not allowed',
            p_expected_status, p_new_status;
    END IF;

    -- 5b. Guard against concurrent active refund requests when moving QUEUED -> PRINTING
    IF p_expected_status = 'QUEUED' AND p_new_status = 'PRINTING' THEN
        IF EXISTS (
            SELECT 1 FROM public.refund_requests
            WHERE order_id = p_order_id
              AND status IN ('PENDING', 'PROCESSING')
        ) THEN
            RAISE EXCEPTION 'Order cancellation/refund is already in progress.';
        END IF;
    END IF;

    -- 6. Perform the Status Update
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

REVOKE ALL ON FUNCTION public.transition_vendor_order_status(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transition_vendor_order_status(UUID, TEXT, TEXT) TO service_role;

-- 5. Atomic Razorpay / Gateway Refund Request Initiation RPC
-- Locks order FOR UPDATE, validates eligibility, guarantees partial unique index exclusivity,
-- and inserts refund_request in PROCESSING status BEFORE external dispatch.
CREATE OR REPLACE FUNCTION public.initiate_order_refund_request(
    p_order_id UUID,
    p_requested_by UUID,
    p_role TEXT,
    p_reason TEXT,
    p_idempotency_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_order RECORD;
    v_attempt RECORD;
    v_existing RECORD;
    v_refund_id UUID;
    v_now TIMESTAMPTZ := now();
BEGIN
    -- 1. Validate Input
    IF p_order_id IS NULL OR p_idempotency_key IS NULL THEN
        RAISE EXCEPTION 'Missing required arguments: order_id and idempotency_key are required';
    END IF;

    -- 2. Lock Order Row FOR UPDATE (Serializes with Start Printing & Other Cancellations)
    SELECT * INTO v_order
    FROM public.orders
    WHERE id = p_order_id
    FOR UPDATE;

    IF v_order.id IS NULL THEN
        RAISE EXCEPTION 'Order with ID % not found', p_order_id;
    END IF;

    -- 3. Verify Order State
    IF v_order.status = 'CANCELLED' THEN
        IF v_order.payment_status = 'REFUNDED' THEN
            RAISE EXCEPTION 'Order has already been refunded.';
        END IF;
        -- Allow SYSTEM role to initiate refund for late-captured payments on cancelled orders
        IF NOT (p_role = 'SYSTEM' AND v_order.payment_status = 'PAID') THEN
            RAISE EXCEPTION 'Order is already cancelled.';
        END IF;
    END IF;

    IF v_order.status != 'QUEUED' AND NOT (v_order.status = 'CANCELLED' AND p_role = 'SYSTEM') THEN
        RAISE EXCEPTION 'Cannot cancel and refund order in "%" status (only QUEUED orders can be cancelled and refunded)', v_order.status;
    END IF;

    IF v_order.payment_status != 'PAID' THEN
        RAISE EXCEPTION 'Cannot refund order with payment_status "%" (must be PAID)', v_order.payment_status;
    END IF;

    -- 4. Check for Any Existing Active / Succeeded Refund Request
    SELECT * INTO v_existing
    FROM public.refund_requests
    WHERE order_id = p_order_id
      AND status IN ('PENDING', 'PROCESSING', 'SUCCEEDED')
    LIMIT 1;

    IF v_existing.id IS NOT NULL THEN
        IF v_existing.status IN ('PENDING', 'PROCESSING') THEN
            RAISE EXCEPTION 'Refund is already being processed.';
        ELSIF v_existing.status = 'SUCCEEDED' THEN
            RAISE EXCEPTION 'Order has already been refunded.';
        END IF;
    END IF;

    -- 5. Find Successful Payment Attempt (Trusted Financial Record)
    SELECT * INTO v_attempt
    FROM public.payment_attempts
    WHERE order_id = p_order_id
      AND status = 'PAID'
    ORDER BY paid_at DESC NULLS LAST, created_at DESC
    LIMIT 1
    FOR UPDATE;

    IF v_attempt.id IS NULL THEN
        RAISE EXCEPTION 'No successful payment attempt found for order %', p_order_id;
    END IF;

    IF v_attempt.amount <= 0 THEN
        RAISE EXCEPTION 'Invalid payment amount % for order %', v_attempt.amount, p_order_id;
    END IF;

    -- 6. Insert Authoritative Refund Request in PROCESSING Status
    INSERT INTO public.refund_requests (
        order_id,
        user_id,
        payment_attempt_id,
        provider,
        amount,
        status,
        reason,
        requested_by,
        requested_by_role,
        idempotency_key,
        created_at,
        updated_at
    ) VALUES (
        p_order_id,
        v_order.user_id,
        v_attempt.id,
        v_attempt.provider,
        v_attempt.amount,
        'PROCESSING',
        p_reason,
        p_requested_by,
        p_role,
        p_idempotency_key,
        v_now,
        v_now
    ) RETURNING id INTO v_refund_id;

    RETURN jsonb_build_object(
        'success', true,
        'refund_request_id', v_refund_id,
        'order_id', v_order.id,
        'order_number', v_order.order_number,
        'user_id', v_order.user_id,
        'provider', v_attempt.provider,
        'amount', v_attempt.amount,
        'payment_attempt_id', v_attempt.id,
        'razorpay_payment_id', v_attempt.razorpay_payment_id
    );
END;
$$;

REVOKE ALL ON FUNCTION public.initiate_order_refund_request(UUID, UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.initiate_order_refund_request(UUID, UUID, TEXT, TEXT, TEXT) TO service_role;

-- 6. Atomic XerCoins Refund RPC
CREATE OR REPLACE FUNCTION public.refund_xercoins_order(
    p_order_id UUID,
    p_requested_by UUID,
    p_role TEXT DEFAULT 'CUSTOMER',
    p_reason TEXT DEFAULT NULL,
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_order RECORD;
    v_wallet RECORD;
    v_attempt RECORD;
    v_existing_refund RECORD;
    v_before NUMERIC(12,2);
    v_after NUMERIC(12,2);
    v_tx_id UUID;
    v_refund_id UUID;
    v_now TIMESTAMPTZ := now();
    v_key TEXT;
BEGIN
    -- 1. Validate Input
    IF p_order_id IS NULL THEN
        RAISE EXCEPTION 'Missing required argument: p_order_id is required';
    END IF;

    v_key := COALESCE(p_idempotency_key, 'refund:xercoins:' || p_order_id::text);

    -- 2. Fast Path: Idempotency Replay Check
    SELECT * INTO v_existing_refund
    FROM public.refund_requests
    WHERE idempotency_key = v_key;

    IF v_existing_refund.id IS NOT NULL AND v_existing_refund.status = 'SUCCEEDED' THEN
        SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
        SELECT * INTO v_wallet FROM public.wallet_accounts WHERE user_id = v_order.user_id;

        RETURN jsonb_build_object(
            'success', true,
            'idempotent_replay', true,
            'order_id', v_order.id,
            'order_number', v_order.order_number,
            'status', v_order.status,
            'payment_status', v_order.payment_status,
            'amount_refunded', v_existing_refund.amount,
            'new_balance', COALESCE(v_wallet.balance, 0.00),
            'refund_id', v_existing_refund.id
        );
    END IF;

    -- 3. Lock Order Row FOR UPDATE (Serializes with Start Printing)
    SELECT * INTO v_order
    FROM public.orders
    WHERE id = p_order_id
    FOR UPDATE;

    IF v_order.id IS NULL THEN
        RAISE EXCEPTION 'Order with ID % not found', p_order_id;
    END IF;

    -- 4. Check If Order Is Already Cancelled / Refunded
    IF v_order.status = 'CANCELLED' THEN
        IF v_order.payment_status = 'REFUNDED' THEN
            SELECT * INTO v_wallet FROM public.wallet_accounts WHERE user_id = v_order.user_id;
            RETURN jsonb_build_object(
                'success', true,
                'idempotent_replay', true,
                'order_id', v_order.id,
                'order_number', v_order.order_number,
                'status', v_order.status,
                'payment_status', v_order.payment_status,
                'amount_refunded', v_order.total_amount,
                'new_balance', COALESCE(v_wallet.balance, 0.00)
            );
        END IF;
        RAISE EXCEPTION 'Order % is already CANCELLED', p_order_id;
    END IF;

    -- 5. Verify State Eligibility (Must be QUEUED and PAID)
    IF v_order.status != 'QUEUED' THEN
        RAISE EXCEPTION 'Cannot cancel and refund order in "%" status (only QUEUED orders can be cancelled and refunded)', v_order.status;
    END IF;

    IF v_order.payment_status != 'PAID' THEN
        RAISE EXCEPTION 'Cannot refund order with payment_status "%" (must be PAID)', v_order.payment_status;
    END IF;

    -- 6. Check partial unique index: Ensure no other active refund is in progress
    SELECT * INTO v_existing_refund
    FROM public.refund_requests
    WHERE order_id = p_order_id
      AND status IN ('PENDING', 'PROCESSING', 'SUCCEEDED')
    LIMIT 1;

    IF v_existing_refund.id IS NOT NULL THEN
        IF v_existing_refund.status IN ('PENDING', 'PROCESSING') THEN
            RAISE EXCEPTION 'Order cancellation/refund is already in progress.';
        ELSIF v_existing_refund.status = 'SUCCEEDED' THEN
            RAISE EXCEPTION 'Order has already been refunded.';
        END IF;
    END IF;

    -- 7. Lock Payment Attempt FOR UPDATE
    SELECT * INTO v_attempt
    FROM public.payment_attempts
    WHERE order_id = p_order_id
      AND provider = 'XERCOINS'
      AND status = 'PAID'
    ORDER BY created_at DESC
    LIMIT 1
    FOR UPDATE;

    IF v_attempt.id IS NULL THEN
        RAISE EXCEPTION 'No successful XerCoins payment found for order %', p_order_id;
    END IF;

    IF v_attempt.amount <= 0 THEN
        RAISE EXCEPTION 'Invalid payment amount % for order %', v_attempt.amount, p_order_id;
    END IF;

    -- 8. Lock Customer Wallet Account FOR UPDATE
    SELECT * INTO v_wallet
    FROM public.wallet_accounts
    WHERE user_id = v_order.user_id
    FOR UPDATE;

    IF v_wallet.id IS NULL THEN
        RAISE EXCEPTION 'Wallet account not found for customer %', v_order.user_id;
    END IF;

    v_before := v_wallet.balance;
    v_after := v_before + v_attempt.amount;

    -- 9. Increment Wallet Balance
    UPDATE public.wallet_accounts
    SET balance = v_after, updated_at = v_now
    WHERE id = v_wallet.id;

    -- 10. Insert Immutable Wallet Transaction
    INSERT INTO public.wallet_transactions (
        wallet_id,
        user_id,
        order_id,
        type,
        source,
        amount,
        balance_before,
        balance_after,
        reference,
        idempotency_key
    ) VALUES (
        v_wallet.id,
        v_order.user_id,
        p_order_id,
        'REFUND',
        'ORDER_REFUND',
        v_attempt.amount,
        v_before,
        v_after,
        'Refund for Cancelled Order #' || v_order.order_number,
        v_key
    ) RETURNING id INTO v_tx_id;

    -- 11. Record Completed Refund Request (Status = SUCCEEDED)
    INSERT INTO public.refund_requests (
        order_id,
        user_id,
        payment_attempt_id,
        provider,
        amount,
        status,
        reason,
        requested_by,
        requested_by_role,
        provider_refund_id,
        idempotency_key,
        completed_at,
        created_at,
        updated_at
    ) VALUES (
        p_order_id,
        v_order.user_id,
        v_attempt.id,
        'XERCOINS',
        v_attempt.amount,
        'SUCCEEDED',
        p_reason,
        p_requested_by,
        p_role,
        v_tx_id::text,
        v_key,
        v_now,
        v_now,
        v_now
    ) RETURNING id INTO v_refund_id;

    -- 12. Update Payment Attempt to REFUNDED
    UPDATE public.payment_attempts
    SET status = 'REFUNDED', updated_at = v_now
    WHERE id = v_attempt.id;

    -- 13. Update Order to CANCELLED and REFUNDED
    UPDATE public.orders
    SET
        status = 'CANCELLED',
        payment_status = 'REFUNDED',
        cancelled_by = p_requested_by,
        cancellation_reason = p_reason,
        cancelled_at = v_now,
        updated_at = v_now
    WHERE id = p_order_id
    RETURNING * INTO v_order;

    -- 14. Return Structured Response
    RETURN jsonb_build_object(
        'success', true,
        'order_id', v_order.id,
        'order_number', v_order.order_number,
        'status', v_order.status,
        'payment_status', v_order.payment_status,
        'amount_refunded', v_order.total_amount,
        'new_balance', v_after,
        'transaction_id', v_tx_id,
        'refund_id', v_refund_id
    );
END;
$$;

REVOKE ALL ON FUNCTION public.refund_xercoins_order(UUID, UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_xercoins_order(UUID, UUID, TEXT, TEXT, TEXT) TO service_role;

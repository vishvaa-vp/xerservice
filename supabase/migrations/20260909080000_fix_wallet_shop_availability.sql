-- =============================================================
-- Migration: Fix Wallet Shop Availability Check (Phase 6D Bugfix)
-- File: supabase/migrations/20260909080000_fix_wallet_shop_availability.sql
-- Purpose: Replace invalid reference to nonexistent column 'shops.is_active'
--          with authoritative shop availability columns:
--          shops.status ('OPEN', 'PAUSED', 'CLOSED') and shops.closing_soon (BOOLEAN).
-- Security: SECURITY DEFINER, SET search_path = public, pg_temp, service_role only.
-- =============================================================

CREATE OR REPLACE FUNCTION public.pay_order_with_wallet(
    p_user_id UUID,
    p_order_id UUID,
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_order RECORD;
    v_shop RECORD;
    v_wallet public.wallet_accounts;
    v_existing_tx RECORD;
    v_existing_attempt RECORD;
    v_before NUMERIC(12,2);
    v_after NUMERIC(12,2);
    v_tx_id UUID;
    v_attempt_id UUID;
    v_now TIMESTAMPTZ := now();
    v_file RECORD;
    v_settings RECORD;
    v_current_price NUMERIC(10,2);
    v_calculated_total NUMERIC(10,2) := 0.00;
    v_file_count INTEGER := 0;
BEGIN
    -- 1. Validate Input Parameters
    IF p_user_id IS NULL OR p_order_id IS NULL THEN
        RAISE EXCEPTION 'Missing required arguments: user_id and order_id are required';
    END IF;

    -- 2. Check Idempotency Key first (Fast path if already processed by this key)
    IF p_idempotency_key IS NOT NULL THEN
        SELECT * INTO v_existing_tx
        FROM public.wallet_transactions
        WHERE idempotency_key = p_idempotency_key;

        IF v_existing_tx.id IS NOT NULL THEN
            SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
            SELECT * INTO v_wallet FROM public.wallet_accounts WHERE id = v_existing_tx.wallet_id;

            RETURN jsonb_build_object(
                'success', true,
                'idempotent_replay', true,
                'order_id', v_order.id,
                'order_number', v_order.order_number,
                'status', v_order.status,
                'payment_status', v_order.payment_status,
                'amount_debited', v_existing_tx.amount,
                'new_balance', v_wallet.balance,
                'transaction_id', v_existing_tx.id
            );
        END IF;
    END IF;

    -- 3. Lock Order Row FOR UPDATE to guarantee concurrency isolation
    SELECT * INTO v_order
    FROM public.orders
    WHERE id = p_order_id
    FOR UPDATE;

    IF v_order.id IS NULL THEN
        RAISE EXCEPTION 'Order with ID % not found', p_order_id;
    END IF;

    -- 4. Verify Ownership
    IF v_order.user_id != p_user_id THEN
        RAISE EXCEPTION 'Unauthorized: order does not belong to the authenticated user';
    END IF;

    -- 5. If Order Already Paid: check if it matches our idempotency replay
    IF v_order.payment_status = 'PAID' THEN
        IF p_idempotency_key IS NOT NULL THEN
            SELECT * INTO v_existing_tx
            FROM public.wallet_transactions
            WHERE idempotency_key = p_idempotency_key;

            IF v_existing_tx.id IS NOT NULL THEN
                SELECT * INTO v_wallet FROM public.wallet_accounts WHERE user_id = p_user_id;
                RETURN jsonb_build_object(
                    'success', true,
                    'idempotent_replay', true,
                    'order_id', v_order.id,
                    'order_number', v_order.order_number,
                    'status', v_order.status,
                    'payment_status', v_order.payment_status,
                    'amount_debited', v_existing_tx.amount,
                    'new_balance', COALESCE(v_wallet.balance, 0.00),
                    'transaction_id', v_existing_tx.id
                );
            END IF;
        END IF;

        RAISE EXCEPTION 'This order has already been paid.';
    END IF;

    -- 6. Enforce Strict Order Eligibility (DRAFT + UNPAID ONLY)
    -- Do NOT allow wallet payment directly from AWAITING_PAYMENT
    -- (AWAITING_PAYMENT indicates an external Razorpay payment is in progress).
    IF v_order.status = 'AWAITING_PAYMENT' THEN
        RAISE EXCEPTION 'Another payment is already in progress for this order.';
    END IF;

    IF v_order.status != 'DRAFT' THEN
        RAISE EXCEPTION 'Cannot pay for order in status % (only DRAFT orders are eligible for wallet payment)', v_order.status;
    END IF;

    IF v_order.payment_status != 'UNPAID' THEN
        RAISE EXCEPTION 'Cannot pay for order with payment_status % (must be UNPAID)', v_order.payment_status;
    END IF;

    -- 7. Cross-Provider Payment Attempt Safety Check
    -- Reject if ANY active Razorpay attempt exists (CREATED, AUTHORIZED, PAID),
    -- or any completed XERCOINS PAID attempt exists.
    -- FAILED or REFUNDED attempts are historical and do not block payment.
    SELECT * INTO v_existing_attempt
    FROM public.payment_attempts
    WHERE order_id = p_order_id
      AND status IN ('CREATED', 'AUTHORIZED', 'PAID')
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_existing_attempt.id IS NOT NULL THEN
        IF v_existing_attempt.provider = 'RAZORPAY' THEN
            IF v_existing_attempt.status = 'PAID' THEN
                RAISE EXCEPTION 'This order has already been paid via Razorpay.';
            ELSE
                RAISE EXCEPTION 'Another payment is already in progress for this order.';
            END IF;
        ELSIF v_existing_attempt.provider = 'XERCOINS' THEN
            IF v_existing_attempt.status = 'PAID' THEN
                RAISE EXCEPTION 'This order has already been paid via XerCoins.';
            END IF;
        END IF;
    END IF;

    -- 8. Validate Expiry and Total Amount
    IF v_order.expires_at <= v_now THEN
        RAISE EXCEPTION 'Cannot pay for expired order (expired at %)', v_order.expires_at;
    END IF;

    IF v_order.total_amount <= 0.00 THEN
        RAISE EXCEPTION 'Order total amount must be strictly greater than 0.00';
    END IF;

    -- 9. Validate Shop Availability (Using authoritative status & closing_soon columns)
    SELECT * INTO v_shop
    FROM public.shops
    WHERE id = v_order.shop_id;

    IF v_shop.id IS NULL THEN
        RAISE EXCEPTION 'Print shop for order % not found', p_order_id;
    END IF;

    IF v_shop.status <> 'OPEN' THEN
        RAISE EXCEPTION 'Shop is currently not accepting orders.';
    END IF;

    IF COALESCE(v_shop.closing_soon, false) = true THEN
        RAISE EXCEPTION 'Shop is closing soon and is not accepting new orders.';
    END IF;

    -- 10. CONCURRENCY-SAFE STALE QUOTE & SETTINGS RACE PROTECTION
    -- Verify that order files, print settings, and active shop pricing have not changed
    -- since the authoritative quote was calculated.
    SELECT COUNT(*) INTO v_file_count
    FROM public.order_files
    WHERE order_id = p_order_id;

    IF v_file_count = 0 THEN
        RAISE EXCEPTION 'Order settings changed. Please recalculate.';
    END IF;

    FOR v_file IN
        SELECT id, original_pages, printable_pages, physical_sheets, unit_price, line_total, updated_at
        FROM public.order_files
        WHERE order_id = p_order_id
        FOR UPDATE
    LOOP
        -- Check if print settings exist and lock row
        SELECT * INTO v_settings
        FROM public.print_settings
        WHERE order_file_id = v_file.id
        FOR UPDATE;

        IF v_settings.id IS NULL THEN
            RAISE EXCEPTION 'Order settings changed. Please recalculate.';
        END IF;

        -- If settings were updated after the quote was snapshot onto order_files or orders
        IF v_settings.updated_at > v_file.updated_at OR v_settings.updated_at > v_order.updated_at THEN
            RAISE EXCEPTION 'Order settings changed. Please recalculate.';
        END IF;

        -- Revalidate live active shop pricing for this exact configuration
        SELECT price_per_sheet INTO v_current_price
        FROM public.shop_pricing
        WHERE shop_id = v_order.shop_id
          AND paper_size = v_settings.paper_size
          AND print_mode = v_settings.colour_mode
          AND sides = v_settings.sides
          AND active = true;

        IF v_current_price IS NULL OR v_current_price != v_file.unit_price THEN
            RAISE EXCEPTION 'Order settings changed. Please recalculate.';
        END IF;

        -- Verify line total calculation
        IF v_file.line_total != ROUND(v_file.physical_sheets * v_current_price, 2) THEN
            RAISE EXCEPTION 'Order settings changed. Please recalculate.';
        END IF;

        v_calculated_total := v_calculated_total + v_file.line_total;
    END LOOP;

    -- Verify that the order's total_amount matches the freshly verified sum
    IF v_order.total_amount != v_calculated_total THEN
        RAISE EXCEPTION 'Order settings changed. Please recalculate.';
    END IF;

    -- 11. Ensure Customer Wallet Exists and Lock FOR UPDATE
    PERFORM public.get_or_create_wallet_account(p_user_id);

    SELECT * INTO v_wallet
    FROM public.wallet_accounts
    WHERE user_id = p_user_id
    FOR UPDATE;

    -- 12. Enforce Sufficient Balance
    IF v_wallet.balance < v_order.total_amount THEN
        RETURN jsonb_build_object(
            'success', false,
            'error_code', 'INSUFFICIENT_FUNDS',
            'error_message', 'Insufficient XerCoins balance',
            'current_balance', v_wallet.balance,
            'required_amount', v_order.total_amount
        );
    END IF;

    v_before := v_wallet.balance;
    v_after := v_before - v_order.total_amount;

    -- 13. Decrement Wallet Balance
    UPDATE public.wallet_accounts
    SET balance = v_after, updated_at = v_now
    WHERE id = v_wallet.id;

    -- 14. Record Immutable Ledger Transaction
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
        p_user_id,
        p_order_id,
        'DEBIT',
        'ORDER_PAYMENT',
        v_order.total_amount,
        v_before,
        v_after,
        'Order Payment for ' || v_order.order_number,
        p_idempotency_key
    ) RETURNING id INTO v_tx_id;

    -- 15. Record Successful Payment Attempt
    INSERT INTO public.payment_attempts (
        order_id,
        provider,
        amount,
        currency,
        status,
        payment_method,
        paid_at
    ) VALUES (
        p_order_id,
        'XERCOINS',
        v_order.total_amount,
        'INR',
        'PAID',
        'WALLET',
        v_now
    ) RETURNING id INTO v_attempt_id;

    -- 16. Transition Order to PAID and QUEUED
    UPDATE public.orders
    SET
        status = 'QUEUED',
        payment_status = 'PAID',
        paid_at = v_now,
        updated_at = v_now
    WHERE id = p_order_id
    RETURNING * INTO v_order;

    -- 17. Return Order and Ledger Confirmation
    RETURN jsonb_build_object(
        'success', true,
        'order_id', v_order.id,
        'order_number', v_order.order_number,
        'status', v_order.status,
        'payment_status', v_order.payment_status,
        'amount_debited', v_order.total_amount,
        'new_balance', v_after,
        'transaction_id', v_tx_id,
        'payment_attempt_id', v_attempt_id
    );
END;
$$;

-- -------------------------------------------------------------
-- SECURITY & PRIVILEGE CONFIGURATION
-- Execution strictly restricted to service_role backend.
-- Public, anon, and authenticated browser clients cannot invoke directly.
-- -------------------------------------------------------------
REVOKE ALL ON FUNCTION public.pay_order_with_wallet(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pay_order_with_wallet(UUID, UUID, TEXT) TO service_role;

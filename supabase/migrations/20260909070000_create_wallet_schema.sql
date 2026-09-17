-- =============================================================
-- Migration: Create Authoritative XerCoins Wallet Ledger & Atomic Checkout (Phase 6D)
-- Tables: wallet_accounts, wallet_transactions
-- Alterations: payment_attempts provider constraint check
-- Security: Strict Row Level Security (RLS). Customers can only SELECT their own records.
--           No client INSERT, UPDATE, or DELETE permitted.
--           All mutations performed exclusively via SECURITY DEFINER service_role RPCs.
-- =============================================================

-- =============================================================
-- 1. PAYMENT_ATTEMPTS PROVIDER COMPATIBILITY
-- Ensure payment_attempts table explicitly permits 'XERCOINS' provider
-- =============================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'payment_attempts_provider_check'
    ) THEN
        ALTER TABLE public.payment_attempts
            ADD CONSTRAINT payment_attempts_provider_check
            CHECK (provider IN ('RAZORPAY', 'XERCOINS'));
    END IF;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- =============================================================
-- 2. WALLET_ACCOUNTS TABLE
-- Tracks authoritative credit balance for each XerService customer
-- =============================================================
CREATE TABLE IF NOT EXISTS public.wallet_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    balance NUMERIC(12,2) NOT NULL DEFAULT 0.00 CHECK (balance >= 0.00),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wallet_accounts_user_id
    ON public.wallet_accounts(user_id);

-- Attach updated_at trigger
DROP TRIGGER IF EXISTS trg_wallet_accounts_updated_at ON public.wallet_accounts;
CREATE TRIGGER trg_wallet_accounts_updated_at
    BEFORE UPDATE ON public.wallet_accounts
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();

COMMENT ON TABLE public.wallet_accounts IS
    'Authoritative XerCoins customer balance store. Enforces non-negative balance constraint.';

-- =============================================================
-- 3. WALLET_TRANSACTIONS TABLE
-- Immutable append-only financial ledger tracking all credit movements
-- =============================================================
CREATE TABLE IF NOT EXISTS public.wallet_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_id UUID NOT NULL REFERENCES public.wallet_accounts(id) ON DELETE RESTRICT,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    order_id UUID NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
    type TEXT NOT NULL CHECK (type IN ('CREDIT', 'DEBIT', 'REFUND', 'ADJUSTMENT')),
    source TEXT NOT NULL CHECK (source IN ('PROMOTIONAL', 'ORDER_PAYMENT', 'ORDER_REFUND', 'ADMIN_ADJUSTMENT', 'RAZORPAY_TOPUP')),
    amount NUMERIC(12,2) NOT NULL CHECK (amount > 0.00),
    balance_before NUMERIC(12,2) NOT NULL CHECK (balance_before >= 0.00),
    balance_after NUMERIC(12,2) NOT NULL CHECK (balance_after >= 0.00),
    reference TEXT NULL,
    idempotency_key TEXT UNIQUE NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wallet_transactions_wallet_id
    ON public.wallet_transactions(wallet_id);

CREATE INDEX IF NOT EXISTS idx_wallet_transactions_user_id
    ON public.wallet_transactions(user_id);

CREATE INDEX IF NOT EXISTS idx_wallet_transactions_order_id
    ON public.wallet_transactions(order_id);

CREATE INDEX IF NOT EXISTS idx_wallet_transactions_created_at
    ON public.wallet_transactions(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_wallet_transactions_idempotency
    ON public.wallet_transactions(idempotency_key);

COMMENT ON TABLE public.wallet_transactions IS
    'Immutable append-only ledger of all XerCoins movements with idempotency protection.';

-- =============================================================
-- 4. ROW LEVEL SECURITY (RLS)
-- =============================================================
ALTER TABLE public.wallet_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;

-- Customers can view only their own wallet account
CREATE POLICY "Customers can view own wallet account"
    ON public.wallet_accounts
    FOR SELECT
    TO authenticated
    USING (user_id = auth.uid());

-- Customers can view only their own wallet transactions
CREATE POLICY "Customers can view own wallet transactions"
    ON public.wallet_transactions
    FOR SELECT
    TO authenticated
    USING (user_id = auth.uid());

-- Note:
-- NO INSERT, UPDATE, or DELETE policies are granted to authenticated or anon clients.
-- All mutations are conducted strictly via server-side service_role functions.

-- =============================================================
-- 5. ATOMIC POSTGRESQL FUNCTIONS (RPCs)
-- =============================================================

-- -------------------------------------------------------------
-- 5A. GET OR CREATE WALLET ACCOUNT
-- Lazily provisions a wallet account with 0.00 balance upon first customer access
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_or_create_wallet_account(
    p_user_id UUID
)
RETURNS public.wallet_accounts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_wallet public.wallet_accounts;
BEGIN
    IF p_user_id IS NULL THEN
        RAISE EXCEPTION 'user_id parameter cannot be null';
    END IF;

    SELECT * INTO v_wallet
    FROM public.wallet_accounts
    WHERE user_id = p_user_id;

    IF v_wallet.id IS NULL THEN
        INSERT INTO public.wallet_accounts (user_id, balance)
        VALUES (p_user_id, 0.00)
        ON CONFLICT (user_id) DO UPDATE
            SET updated_at = now()
        RETURNING * INTO v_wallet;
    END IF;

    RETURN v_wallet;
END;
$$;

-- -------------------------------------------------------------
-- 5B. CREDIT WALLET
-- Safely credits a customer wallet with idempotency and row-level locking
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.credit_wallet(
    p_user_id UUID,
    p_amount NUMERIC,
    p_source TEXT,
    p_reference TEXT DEFAULT NULL,
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_wallet public.wallet_accounts;
    v_before NUMERIC(12,2);
    v_after NUMERIC(12,2);
    v_tx_id UUID;
    v_existing_tx RECORD;
BEGIN
    IF p_user_id IS NULL OR p_amount IS NULL OR p_source IS NULL THEN
        RAISE EXCEPTION 'Missing required arguments: user_id, amount, and source are required';
    END IF;

    IF p_amount <= 0.00 THEN
        RAISE EXCEPTION 'Credit amount must be strictly greater than 0.00';
    END IF;

    IF p_source NOT IN ('PROMOTIONAL', 'ORDER_PAYMENT', 'ORDER_REFUND', 'ADMIN_ADJUSTMENT', 'RAZORPAY_TOPUP') THEN
        RAISE EXCEPTION 'Invalid credit source: %', p_source;
    END IF;

    -- Check idempotency
    IF p_idempotency_key IS NOT NULL THEN
        SELECT * INTO v_existing_tx
        FROM public.wallet_transactions
        WHERE idempotency_key = p_idempotency_key;

        IF v_existing_tx.id IS NOT NULL THEN
            SELECT * INTO v_wallet
            FROM public.wallet_accounts
            WHERE id = v_existing_tx.wallet_id;

            RETURN jsonb_build_object(
                'success', true,
                'idempotent_replay', true,
                'transaction_id', v_existing_tx.id,
                'wallet_id', v_wallet.id,
                'user_id', p_user_id,
                'amount', v_existing_tx.amount,
                'balance', v_wallet.balance
            );
        END IF;
    END IF;

    -- Ensure wallet exists
    PERFORM public.get_or_create_wallet_account(p_user_id);

    -- Row-level lock FOR UPDATE
    SELECT * INTO v_wallet
    FROM public.wallet_accounts
    WHERE user_id = p_user_id
    FOR UPDATE;

    v_before := v_wallet.balance;
    v_after := v_before + p_amount;

    -- Update balance
    UPDATE public.wallet_accounts
    SET balance = v_after, updated_at = now()
    WHERE id = v_wallet.id;

    -- Insert ledger record
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
        NULL,
        'CREDIT',
        p_source,
        p_amount,
        v_before,
        v_after,
        p_reference,
        p_idempotency_key
    ) RETURNING id INTO v_tx_id;

    RETURN jsonb_build_object(
        'success', true,
        'transaction_id', v_tx_id,
        'wallet_id', v_wallet.id,
        'user_id', p_user_id,
        'amount_credited', p_amount,
        'balance_before', v_before,
        'new_balance', v_after
    );
END;
$$;

-- -------------------------------------------------------------
-- 5C. DEBIT WALLET FOR ORDER
-- Safely debits a customer wallet with idempotency and balance check
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.debit_wallet_for_order(
    p_user_id UUID,
    p_order_id UUID,
    p_amount NUMERIC,
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_wallet public.wallet_accounts;
    v_before NUMERIC(12,2);
    v_after NUMERIC(12,2);
    v_tx_id UUID;
    v_existing_tx RECORD;
BEGIN
    IF p_user_id IS NULL OR p_order_id IS NULL OR p_amount IS NULL THEN
        RAISE EXCEPTION 'Missing required arguments: user_id, order_id, and amount are required';
    END IF;

    IF p_amount <= 0.00 THEN
        RAISE EXCEPTION 'Debit amount must be strictly greater than 0.00';
    END IF;

    -- Check idempotency
    IF p_idempotency_key IS NOT NULL THEN
        SELECT * INTO v_existing_tx
        FROM public.wallet_transactions
        WHERE idempotency_key = p_idempotency_key;

        IF v_existing_tx.id IS NOT NULL THEN
            SELECT * INTO v_wallet
            FROM public.wallet_accounts
            WHERE id = v_existing_tx.wallet_id;

            RETURN jsonb_build_object(
                'success', true,
                'idempotent_replay', true,
                'transaction_id', v_existing_tx.id,
                'wallet_id', v_wallet.id,
                'user_id', p_user_id,
                'amount', v_existing_tx.amount,
                'balance', v_wallet.balance
            );
        END IF;
    END IF;

    -- Ensure wallet exists
    PERFORM public.get_or_create_wallet_account(p_user_id);

    -- Row-level lock FOR UPDATE
    SELECT * INTO v_wallet
    FROM public.wallet_accounts
    WHERE user_id = p_user_id
    FOR UPDATE;

    IF v_wallet.balance < p_amount THEN
        RAISE EXCEPTION 'Insufficient XerCoins balance: balance is %, required is %',
            v_wallet.balance, p_amount;
    END IF;

    v_before := v_wallet.balance;
    v_after := v_before - p_amount;

    -- Update balance
    UPDATE public.wallet_accounts
    SET balance = v_after, updated_at = now()
    WHERE id = v_wallet.id;

    -- Insert ledger record
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
        p_amount,
        v_before,
        v_after,
        'Order Payment',
        p_idempotency_key
    ) RETURNING id INTO v_tx_id;

    RETURN jsonb_build_object(
        'success', true,
        'transaction_id', v_tx_id,
        'wallet_id', v_wallet.id,
        'user_id', p_user_id,
        'amount_debited', p_amount,
        'balance_before', v_before,
        'new_balance', v_after
    );
END;
$$;

-- -------------------------------------------------------------
-- 5D. ATOMIC PAY ORDER WITH WALLET
-- Executes atomic order checkout, wallet balance deduction, payment attempt logging,
-- and order QUEUED transition inside a single isolated transaction.
-- Concurrency-Safe:
--   1. Rejects non-DRAFT orders (e.g. AWAITING_PAYMENT where Razorpay is active).
--   2. Verifies NO active Razorpay attempt (CREATED, AUTHORIZED, PAID) exists.
--   3. Prevents dual-charging and guarantees at most ONE payment provider per order.
--   4. Detects stale pricing or modified settings/files/pricing and ABORTS before any money is deducted.
-- -------------------------------------------------------------
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
    -- (AWAITING_PAYMENT means an external Razorpay checkout is in progress).
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
    -- Query payment_attempts for p_order_id under the lock.
    -- Reject if ANY active Razorpay attempt exists (CREATED, AUTHORIZED, PAID),
    -- or any completed XERCOINS PAID attempt exists.
    -- Note: FAILED or REFUNDED attempts are historical and do not block payment.
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

    -- 9. Validate Shop Status
    SELECT * INTO v_shop
    FROM public.shops
    WHERE id = v_order.shop_id;

    IF v_shop.id IS NULL OR NOT v_shop.is_active THEN
        RAISE EXCEPTION 'Print shop is inactive or does not exist';
    END IF;

    IF v_shop.status != 'OPEN' OR v_shop.closing_soon = true THEN
        RAISE EXCEPTION 'Print shop is currently closed or closing soon';
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
-- 6. SECURITY & PRIVILEGE CONFIGURATION
-- Execution strictly restricted to service_role backend.
-- Public, anon, and authenticated browser clients cannot invoke directly.
-- -------------------------------------------------------------
REVOKE ALL ON FUNCTION public.get_or_create_wallet_account(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_or_create_wallet_account(UUID) TO service_role;

REVOKE ALL ON FUNCTION public.credit_wallet(UUID, NUMERIC, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.credit_wallet(UUID, NUMERIC, TEXT, TEXT, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.debit_wallet_for_order(UUID, UUID, NUMERIC, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.debit_wallet_for_order(UUID, UUID, NUMERIC, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.pay_order_with_wallet(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pay_order_with_wallet(UUID, UUID, TEXT) TO service_role;

-- =============================================================
-- Migration: Create XerService Orders Schema (Phase 4 - Hardened)
-- Tables: orders, order_files, print_settings, order_status_history
-- Security: Strict Row Level Security (RLS), Authoritative Sequence
--           Order Numbers, Ownership Consistency Enforcement,
--           Protected Pricing Snapshots, and Status Audit Triggers
-- =============================================================

-- =============================================================
-- 1. CONCURRENCY-SAFE ORDER NUMBER SEQUENCE
-- Generates human-readable order numbers (e.g. XS-100001, XS-100002)
--
-- Security & Design Architecture Note on Order Numbers:
-- 1. Display vs Security Identifier:
--    Order numbers (e.g. XS-100001) are human-readable display numbers designed for
--    physical student interaction, receipts, and the vendor queue screen.
-- 2. Predictability / Guessability:
--    Because order numbers are backed by a monotonic PostgreSQL sequence, they are
--    predictable and sequential. They MUST NEVER be treated as authorization tokens or
--    unguessable secret keys.
-- 3. Authoritative Security Boundary:
--    Security and data isolation are strictly enforced by the unguessable UUID primary key
--    ('id' column) and PostgreSQL Row Level Security (RLS) policies tied to auth.uid()
--    and verified vendor shop ownership. An attacker guessing 'XS-100042' is completely
--    prevented by RLS from reading, modifying, or deleting any order data.
-- =============================================================
CREATE SEQUENCE IF NOT EXISTS public.order_number_seq
    START WITH 100001
    INCREMENT BY 1
    MINVALUE 100001
    NO CYCLE;

-- =============================================================
-- 2. ORDERS TABLE
-- Root print order entity tracking status workflow and financial totals
-- =============================================================
CREATE TABLE IF NOT EXISTS public.orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_number TEXT UNIQUE NOT NULL,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    shop_id UUID NOT NULL REFERENCES public.shops(id) ON DELETE RESTRICT,
    status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (
        status IN ('DRAFT', 'AWAITING_PAYMENT', 'QUEUED', 'PRINTING', 'READY', 'COMPLETED', 'CANCELLED')
    ),
    payment_status TEXT NOT NULL DEFAULT 'UNPAID' CHECK (
        payment_status IN ('UNPAID', 'PAID', 'FAILED', 'REFUNDED')
    ),
    total_original_pages INTEGER NOT NULL DEFAULT 0 CHECK (total_original_pages >= 0),
    total_printable_pages INTEGER NOT NULL DEFAULT 0 CHECK (total_printable_pages >= 0),
    total_sheets INTEGER NOT NULL DEFAULT 0 CHECK (total_sheets >= 0),
    total_amount NUMERIC(10,2) NOT NULL DEFAULT 0.00 CHECK (total_amount >= 0.00),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '12 hours'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    paid_at TIMESTAMPTZ,
    printing_started_at TIMESTAMPTZ,
    ready_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ
);

-- =============================================================
-- Authoritative single source of truth for order insertion defaults:
-- 1. Unconditionally assigns sequence-generated order number on every INSERT.
--    Clients cannot supply, override, or spoof their own order_number.
-- 2. Unconditionally enforces 12-hour draft expiry on every INSERT.
--    Clients cannot choose, manipulate, or extend their initial expires_at;
--    any client-supplied expires_at is strictly ignored and overwritten.
--
-- Privilege & Path Security:
-- Defined with SECURITY DEFINER and explicit SET search_path = public, pg_temp
-- to ensure deterministic, un-hijackable execution with sequence progression rights
-- when invoked by authenticated customer connections.
-- =============================================================
CREATE OR REPLACE FUNCTION public.handle_order_insert_defaults()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    -- Authoritative sequence-generated order number
    NEW.order_number := 'XS-' || nextval('public.order_number_seq')::text;

    -- Authoritative 12-hour draft expiry enforcement (client-provided value overwritten)
    NEW.expires_at := now() + interval '12 hours';

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_order_insert_defaults ON public.orders;
DROP TRIGGER IF EXISTS trg_set_order_number ON public.orders;
CREATE TRIGGER trg_order_insert_defaults
    BEFORE INSERT ON public.orders
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_order_insert_defaults();

-- =============================================================
-- 3. ORDER_FILES TABLE
-- Document attachments per order with immutable pricing snapshots
-- =============================================================
CREATE TABLE IF NOT EXISTS public.order_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    original_filename TEXT NOT NULL,
    storage_path TEXT,
    mime_type TEXT NOT NULL,
    file_size_bytes BIGINT NOT NULL CHECK (file_size_bytes >= 0),
    original_pages INTEGER NOT NULL DEFAULT 0 CHECK (original_pages >= 0),
    printable_pages INTEGER NOT NULL DEFAULT 0 CHECK (printable_pages >= 0),
    physical_sheets INTEGER NOT NULL DEFAULT 0 CHECK (physical_sheets >= 0),
    unit_price NUMERIC(10,2) NOT NULL DEFAULT 0.00 CHECK (unit_price >= 0.00),
    line_total NUMERIC(10,2) NOT NULL DEFAULT 0.00 CHECK (line_total >= 0.00),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================================
-- 4. PRINT_SETTINGS TABLE
-- Per-file print configuration (1:1 with order_files)
-- =============================================================
CREATE TABLE IF NOT EXISTS public.print_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_file_id UUID UNIQUE NOT NULL REFERENCES public.order_files(id) ON DELETE CASCADE,
    colour_mode TEXT NOT NULL DEFAULT 'BW' CHECK (colour_mode IN ('BW', 'COLOUR')),
    sides TEXT NOT NULL DEFAULT 'SINGLE' CHECK (sides IN ('SINGLE', 'DOUBLE_LONG_EDGE', 'DOUBLE_SHORT_EDGE')),
    orientation TEXT NOT NULL DEFAULT 'PORTRAIT' CHECK (orientation IN ('PORTRAIT', 'LANDSCAPE')),
    copies INTEGER NOT NULL DEFAULT 1 CHECK (copies >= 1),
    pages_per_sheet INTEGER NOT NULL DEFAULT 1 CHECK (pages_per_sheet >= 1),
    paper_size TEXT NOT NULL DEFAULT 'A4',
    margin TEXT NOT NULL DEFAULT 'DEFAULT',
    page_selection TEXT NOT NULL DEFAULT 'ALL' CHECK (page_selection IN ('ALL', 'ODD', 'EVEN', 'RANGE')),
    page_range TEXT,
    scale TEXT NOT NULL DEFAULT 'DEFAULT',
    include_filename_page_numbers BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================================
-- 5. ORDER_STATUS_HISTORY TABLE
-- Audit log of order transitions across the order lifecycle
-- =============================================================
CREATE TABLE IF NOT EXISTS public.order_status_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    from_status TEXT CHECK (
        from_status IS NULL OR from_status IN ('DRAFT', 'AWAITING_PAYMENT', 'QUEUED', 'PRINTING', 'READY', 'COMPLETED', 'CANCELLED')
    ),
    to_status TEXT NOT NULL CHECK (
        to_status IN ('DRAFT', 'AWAITING_PAYMENT', 'QUEUED', 'PRINTING', 'READY', 'COMPLETED', 'CANCELLED')
    ),
    changed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================================
-- 6. AUTOMATIC STATUS HISTORY TRIGGER
-- Logs initial status on creation and every status transition
-- =============================================================
CREATE OR REPLACE FUNCTION public.handle_order_status_history()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO public.order_status_history (
            order_id,
            from_status,
            to_status,
            changed_by,
            created_at
        ) VALUES (
            NEW.id,
            NULL,
            NEW.status,
            auth.uid(),
            now()
        );
    ELSIF TG_OP = 'UPDATE' THEN
        IF OLD.status IS DISTINCT FROM NEW.status THEN
            INSERT INTO public.order_status_history (
                order_id,
                from_status,
                to_status,
                changed_by,
                created_at
            ) VALUES (
                NEW.id,
                OLD.status,
                NEW.status,
                auth.uid(),
                now()
            );
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_order_status_history ON public.orders;
CREATE TRIGGER trg_order_status_history
    AFTER INSERT OR UPDATE OF status ON public.orders
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_order_status_history();

-- =============================================================
-- 7. ORDER TIMESTAMPS & SECURITY TAMPER PREVENTION TRIGGER
-- Records milestone timestamps and strictly prevents clients from
-- modifying sensitive financial, payment, calculated totals, or ownership fields.
-- =============================================================
CREATE OR REPLACE FUNCTION public.handle_order_timestamps_and_security()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_jwt_role TEXT;
BEGIN
    -- 1. Always update updated_at timestamp
    NEW.updated_at := now();

    -- 2. Security checks for client-initiated updates (authenticated or anon)
    -- Performed BEFORE milestone timestamp assignment so that any client-supplied
    -- milestone timestamps (e.g. cancelled_at, paid_at) are detected and rejected.
    v_jwt_role := COALESCE(
        auth.jwt() ->> 'role',
        current_setting('request.jwt.claim.role', true),
        ''
    );

    IF v_jwt_role IN ('authenticated', 'anon') THEN
        -- Never permit altering primary ownership, shop identity, or sequence order number
        IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
            RAISE EXCEPTION 'Cannot modify order user_id';
        END IF;

        IF NEW.order_number IS DISTINCT FROM OLD.order_number THEN
            RAISE EXCEPTION 'Cannot modify order_number';
        END IF;

        IF NEW.shop_id IS DISTINCT FROM OLD.shop_id THEN
            RAISE EXCEPTION 'Cannot modify order shop_id';
        END IF;

        -- Customer role protection
        IF EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND role = 'customer') THEN
            -- Customers cannot modify system-calculated page/sheet totals or total_amount
            IF NEW.total_original_pages IS DISTINCT FROM OLD.total_original_pages THEN
                RAISE EXCEPTION 'Customers cannot modify total_original_pages directly';
            END IF;

            IF NEW.total_printable_pages IS DISTINCT FROM OLD.total_printable_pages THEN
                RAISE EXCEPTION 'Customers cannot modify total_printable_pages directly';
            END IF;

            IF NEW.total_sheets IS DISTINCT FROM OLD.total_sheets THEN
                RAISE EXCEPTION 'Customers cannot modify total_sheets directly';
            END IF;

            IF NEW.total_amount IS DISTINCT FROM OLD.total_amount THEN
                RAISE EXCEPTION 'Customers cannot modify total_amount directly';
            END IF;

            -- Customers cannot modify payment status or payment timestamp
            IF NEW.payment_status IS DISTINCT FROM OLD.payment_status THEN
                RAISE EXCEPTION 'Customers cannot modify payment_status directly';
            END IF;

            IF NEW.paid_at IS DISTINCT FROM OLD.paid_at THEN
                RAISE EXCEPTION 'Customers cannot modify paid_at directly';
            END IF;

            -- Customers cannot modify fulfillment milestone timestamps
            IF NEW.printing_started_at IS DISTINCT FROM OLD.printing_started_at THEN
                RAISE EXCEPTION 'Customers cannot modify printing_started_at directly';
            END IF;

            IF NEW.ready_at IS DISTINCT FROM OLD.ready_at THEN
                RAISE EXCEPTION 'Customers cannot modify ready_at directly';
            END IF;

            IF NEW.completed_at IS DISTINCT FROM OLD.completed_at THEN
                RAISE EXCEPTION 'Customers cannot modify completed_at directly';
            END IF;

            -- Customers cannot modify cancelled_at directly; cancellation is managed automatically by trigger
            IF NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at THEN
                RAISE EXCEPTION 'Customers cannot modify cancelled_at directly; cancellation is managed automatically by trigger';
            END IF;

            -- Customers cannot modify expires_at
            IF NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
                RAISE EXCEPTION 'Customers cannot modify expires_at directly';
            END IF;

            -- Customers may only stay in DRAFT or transition to CANCELLED
            -- (DRAFT -> AWAITING_PAYMENT is handled exclusively by server-side checkout logic)
            IF OLD.status = 'DRAFT' AND NEW.status NOT IN ('DRAFT', 'CANCELLED') THEN
                RAISE EXCEPTION 'Customers cannot transition order status from DRAFT to % directly; must proceed through checkout', NEW.status;
            END IF;

            -- Customers cannot modify status once order has progressed beyond DRAFT
            IF OLD.status != 'DRAFT' AND NEW.status IS DISTINCT FROM OLD.status THEN
                RAISE EXCEPTION 'Customers cannot modify order status once submitted';
            END IF;
        END IF;
    END IF;

    -- 3. Status milestone timestamps (records timestamp once, never overwrites past values)
    IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
        IF NEW.status = 'PRINTING' AND OLD.printing_started_at IS NULL THEN
            NEW.printing_started_at := now();
        ELSIF NEW.status = 'READY' AND OLD.ready_at IS NULL THEN
            NEW.ready_at := now();
        ELSIF NEW.status = 'COMPLETED' AND OLD.completed_at IS NULL THEN
            NEW.completed_at := now();
        ELSIF NEW.status = 'CANCELLED' AND OLD.cancelled_at IS NULL THEN
            NEW.cancelled_at := now();
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_orders_timestamps_and_security ON public.orders;
CREATE TRIGGER trg_orders_timestamps_and_security
    BEFORE UPDATE ON public.orders
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_order_timestamps_and_security();

-- =============================================================
-- 8. ORDER_FILES SECURITY TRIGGER
-- Enforces ownership consistency with parent order and protects
-- system-calculated pricing snapshots on INSERT and UPDATE.
-- =============================================================
CREATE OR REPLACE FUNCTION public.handle_order_files_security()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_jwt_role TEXT;
    v_order_user_id UUID;
    v_order_status TEXT;
BEGIN
    -- 1. Enforce ownership consistency: order_files.user_id MUST equal parent orders.user_id
    SELECT user_id, status INTO v_order_user_id, v_order_status
    FROM public.orders
    WHERE id = NEW.order_id;

    IF v_order_user_id IS NULL THEN
        RAISE EXCEPTION 'Parent order % does not exist', NEW.order_id;
    END IF;

    IF NEW.user_id IS DISTINCT FROM v_order_user_id THEN
        RAISE EXCEPTION 'order_files.user_id (%) must match parent orders.user_id (%)', NEW.user_id, v_order_user_id;
    END IF;

    -- 2. Client role checks
    v_jwt_role := COALESCE(
        auth.jwt() ->> 'role',
        current_setting('request.jwt.claim.role', true),
        ''
    );

    IF v_jwt_role IN ('authenticated', 'anon') THEN
        IF TG_OP = 'INSERT' THEN
            -- Customer cannot insert non-zero pricing snapshot values
            IF EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND role = 'customer') THEN
                IF NEW.printable_pages != 0 OR NEW.physical_sheets != 0 OR NEW.unit_price != 0.00 OR NEW.line_total != 0.00 THEN
                    RAISE EXCEPTION 'Pricing snapshots on initial file upload must be 0; will be computed by backend pricing logic';
                END IF;
            END IF;
        ELSIF TG_OP = 'UPDATE' THEN
            -- Cannot modify parent order link or user ownership
            IF NEW.order_id IS DISTINCT FROM OLD.order_id THEN
                RAISE EXCEPTION 'Cannot modify order_id of an attached file';
            END IF;

            IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
                RAISE EXCEPTION 'Cannot modify user_id of an attached file';
            END IF;

            IF EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND role = 'customer') THEN
                -- Parent order must be in DRAFT for customer edits
                IF v_order_status != 'DRAFT' THEN
                    RAISE EXCEPTION 'Cannot modify files on non-draft orders';
                END IF;

                -- Customers cannot modify system-calculated pricing snapshots
                IF NEW.printable_pages IS DISTINCT FROM OLD.printable_pages THEN
                    RAISE EXCEPTION 'Customers cannot modify printable_pages directly';
                END IF;

                IF NEW.physical_sheets IS DISTINCT FROM OLD.physical_sheets THEN
                    RAISE EXCEPTION 'Customers cannot modify physical_sheets directly';
                END IF;

                IF NEW.unit_price IS DISTINCT FROM OLD.unit_price THEN
                    RAISE EXCEPTION 'Customers cannot modify unit_price directly';
                END IF;

                IF NEW.line_total IS DISTINCT FROM OLD.line_total THEN
                    RAISE EXCEPTION 'Customers cannot modify line_total directly';
                END IF;
            END IF;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_order_files_security ON public.order_files;
CREATE TRIGGER trg_order_files_security
    BEFORE INSERT OR UPDATE ON public.order_files
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_order_files_security();

-- updated_at triggers for order_files and print_settings
DROP TRIGGER IF EXISTS trg_order_files_updated_at ON public.order_files;
CREATE TRIGGER trg_order_files_updated_at
    BEFORE UPDATE ON public.order_files
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS trg_print_settings_updated_at ON public.print_settings;
CREATE TRIGGER trg_print_settings_updated_at
    BEFORE UPDATE ON public.print_settings
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();

-- =============================================================
-- 9. ROW LEVEL SECURITY (RLS) POLICIES
-- =============================================================

-- -------------------------------------------------------------
-- ORDERS RLS
-- -------------------------------------------------------------
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

-- Customer SELECT: Customers can only view their own orders
CREATE POLICY "Customers can view own orders"
    ON public.orders
    FOR SELECT
    TO authenticated
    USING (user_id = auth.uid());

-- Vendor SELECT: Vendors can view orders assigned to shops they own
CREATE POLICY "Vendors can view assigned shop orders"
    ON public.orders
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.shops
            JOIN public.profiles ON profiles.user_id = auth.uid()
            WHERE shops.id = orders.shop_id
            AND shops.owner_id = auth.uid()
            AND profiles.role = 'vendor'
        )
    );

-- -------------------------------------------------------------
-- SECURITY & BUSINESS LOGIC: SHOP AVAILABILITY ON DRAFT CREATION
--
-- The "Customers can insert own orders" policy enforces that at initial
-- draft order creation:
--   1. The target shop exists (shops.id = orders.shop_id)
--   2. The shop is currently OPEN (shops.status = 'OPEN')
--   3. The shop is not closing soon (shops.closing_soon = false)
--
-- Note on Draft Lifetime vs. Checkout Re-Validation:
-- This check prevents creating orders against closed shops at draft time.
-- However, because draft orders may remain open for up to a 12-hour window before
-- submission, the shop's operational status could change while the customer is configuring
-- their documents. The server-side checkout/payment confirmation workflow
-- MUST re-validate that the shop is still OPEN and closing_soon = false
-- immediately before taking payment and advancing the order to AWAITING_PAYMENT / QUEUED.
-- -------------------------------------------------------------
-- Customer INSERT: Customers can create orders strictly in DRAFT with UNPAID status, 0 counts/totals,
-- and only when the target shop is currently OPEN and not closing soon.
CREATE POLICY "Customers can insert own orders"
    ON public.orders
    FOR INSERT
    TO authenticated
    WITH CHECK (
        user_id = auth.uid()
        AND status = 'DRAFT'
        AND payment_status = 'UNPAID'
        AND total_original_pages = 0
        AND total_printable_pages = 0
        AND total_sheets = 0
        AND total_amount = 0.00
        AND paid_at IS NULL
        AND printing_started_at IS NULL
        AND ready_at IS NULL
        AND completed_at IS NULL
        AND cancelled_at IS NULL
        AND EXISTS (
            SELECT 1 FROM public.shops
            WHERE shops.id = orders.shop_id
            AND shops.status = 'OPEN'
            AND shops.closing_soon = false
        )
    );

-- Customer UPDATE: Customers can only update their own DRAFT orders (limited to DRAFT or CANCELLED)
CREATE POLICY "Customers can update own draft orders"
    ON public.orders
    FOR UPDATE
    TO authenticated
    USING (
        user_id = auth.uid()
        AND status = 'DRAFT'
    )
    WITH CHECK (
        user_id = auth.uid()
        AND status IN ('DRAFT', 'CANCELLED')
    );

-- -------------------------------------------------------------
-- ORDER_FILES RLS
-- -------------------------------------------------------------
ALTER TABLE public.order_files ENABLE ROW LEVEL SECURITY;

-- Customer SELECT: Customers can view their own files
CREATE POLICY "Customers can view own order files"
    ON public.order_files
    FOR SELECT
    TO authenticated
    USING (user_id = auth.uid());

-- Vendor SELECT: Vendors can view files belonging to orders for their shop
CREATE POLICY "Vendors can view files for assigned shop orders"
    ON public.order_files
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.orders
            JOIN public.shops ON shops.id = orders.shop_id
            JOIN public.profiles ON profiles.user_id = auth.uid()
            WHERE orders.id = order_files.order_id
            AND shops.owner_id = auth.uid()
            AND profiles.role = 'vendor'
        )
    );

-- Customer INSERT: Customers can attach files only to their own DRAFT orders with 0 pricing snapshots
CREATE POLICY "Customers can insert own draft order files"
    ON public.order_files
    FOR INSERT
    TO authenticated
    WITH CHECK (
        user_id = auth.uid()
        AND printable_pages = 0
        AND physical_sheets = 0
        AND unit_price = 0.00
        AND line_total = 0.00
        AND EXISTS (
            SELECT 1 FROM public.orders
            WHERE orders.id = order_files.order_id
            AND orders.user_id = auth.uid()
            AND orders.status = 'DRAFT'
        )
    );

-- Customer UPDATE: Customers can update file metadata only on their own DRAFT orders
CREATE POLICY "Customers can update own draft order files"
    ON public.order_files
    FOR UPDATE
    TO authenticated
    USING (
        user_id = auth.uid()
        AND EXISTS (
            SELECT 1 FROM public.orders
            WHERE orders.id = order_files.order_id
            AND orders.user_id = auth.uid()
            AND orders.status = 'DRAFT'
        )
    )
    WITH CHECK (
        user_id = auth.uid()
        AND EXISTS (
            SELECT 1 FROM public.orders
            WHERE orders.id = order_files.order_id
            AND orders.user_id = auth.uid()
            AND orders.status = 'DRAFT'
        )
    );

-- Customer DELETE: Customers can remove files only from their own DRAFT orders
CREATE POLICY "Customers can delete own draft order files"
    ON public.order_files
    FOR DELETE
    TO authenticated
    USING (
        user_id = auth.uid()
        AND EXISTS (
            SELECT 1 FROM public.orders
            WHERE orders.id = order_files.order_id
            AND orders.user_id = auth.uid()
            AND orders.status = 'DRAFT'
        )
    );

-- -------------------------------------------------------------
-- PRINT_SETTINGS RLS
-- Customer print choices remain fully editable while order is in DRAFT
-- -------------------------------------------------------------
ALTER TABLE public.print_settings ENABLE ROW LEVEL SECURITY;

-- Customer SELECT: Customers can view settings for their own files
CREATE POLICY "Customers can view own print settings"
    ON public.print_settings
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.order_files
            WHERE order_files.id = print_settings.order_file_id
            AND order_files.user_id = auth.uid()
        )
    );

-- Vendor SELECT: Vendors can view settings for orders assigned to their shop
CREATE POLICY "Vendors can view print settings for assigned shop orders"
    ON public.print_settings
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.order_files
            JOIN public.orders ON orders.id = order_files.order_id
            JOIN public.shops ON shops.id = orders.shop_id
            JOIN public.profiles ON profiles.user_id = auth.uid()
            WHERE order_files.id = print_settings.order_file_id
            AND shops.owner_id = auth.uid()
            AND profiles.role = 'vendor'
        )
    );

-- Customer INSERT: Customers can insert print settings for their own DRAFT files
CREATE POLICY "Customers can insert print settings for own draft files"
    ON public.print_settings
    FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.order_files
            JOIN public.orders ON orders.id = order_files.order_id
            WHERE order_files.id = print_settings.order_file_id
            AND order_files.user_id = auth.uid()
            AND orders.status = 'DRAFT'
        )
    );

-- Customer UPDATE: Customers can update print settings for their own DRAFT files
CREATE POLICY "Customers can update print settings for own draft files"
    ON public.print_settings
    FOR UPDATE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.order_files
            JOIN public.orders ON orders.id = order_files.order_id
            WHERE order_files.id = print_settings.order_file_id
            AND order_files.user_id = auth.uid()
            AND orders.status = 'DRAFT'
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.order_files
            JOIN public.orders ON orders.id = order_files.order_id
            WHERE order_files.id = print_settings.order_file_id
            AND order_files.user_id = auth.uid()
            AND orders.status = 'DRAFT'
        )
    );

-- Customer DELETE: Customers can delete print settings for their own DRAFT files
CREATE POLICY "Customers can delete print settings for own draft files"
    ON public.print_settings
    FOR DELETE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.order_files
            JOIN public.orders ON orders.id = order_files.order_id
            WHERE order_files.id = print_settings.order_file_id
            AND order_files.user_id = auth.uid()
            AND orders.status = 'DRAFT'
        )
    );

-- -------------------------------------------------------------
-- ORDER_STATUS_HISTORY RLS
-- -------------------------------------------------------------
ALTER TABLE public.order_status_history ENABLE ROW LEVEL SECURITY;

-- Customer SELECT: Customers can view status history for their own orders
CREATE POLICY "Customers can view status history for own orders"
    ON public.order_status_history
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.orders
            WHERE orders.id = order_status_history.order_id
            AND orders.user_id = auth.uid()
        )
    );

-- Vendor SELECT: Vendors can view status history for orders belonging to their shop
CREATE POLICY "Vendors can view status history for assigned shop orders"
    ON public.order_status_history
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.orders
            JOIN public.shops ON shops.id = orders.shop_id
            JOIN public.profiles ON profiles.user_id = auth.uid()
            WHERE orders.id = order_status_history.order_id
            AND shops.owner_id = auth.uid()
            AND profiles.role = 'vendor'
        )
    );

-- NOTE: No INSERT, UPDATE, or DELETE policies are granted to authenticated or anon clients
-- on public.order_status_history. All status history records are inserted exclusively by
-- the SECURITY DEFINER trigger trg_order_status_history, preventing any client falsification.

-- =============================================================
-- 10. PERFORMANCE INDEXES
-- Optimizes customer queries, vendor queue queries, and status filtering
-- =============================================================
CREATE INDEX IF NOT EXISTS idx_orders_user_id ON public.orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_shop_id ON public.orders(shop_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON public.orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_payment_status ON public.orders(payment_status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON public.orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_vendor_queue ON public.orders(shop_id, status, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_orders_draft_expiry ON public.orders(expires_at) WHERE status = 'DRAFT';

CREATE INDEX IF NOT EXISTS idx_order_files_order_id ON public.order_files(order_id);
CREATE INDEX IF NOT EXISTS idx_order_files_user_id ON public.order_files(user_id);

CREATE INDEX IF NOT EXISTS idx_print_settings_order_file_id ON public.print_settings(order_file_id);

CREATE INDEX IF NOT EXISTS idx_order_status_history_order_id ON public.order_status_history(order_id);
CREATE INDEX IF NOT EXISTS idx_order_status_history_created_at ON public.order_status_history(created_at ASC);

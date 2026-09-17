-- =============================================================
-- Migration: Create Admin Controlled Print Add-on System
-- Filename: supabase/migrations/20260911010000_create_admin_controlled_print_addons.sql
-- Security: Strict RLS, Admin Master Control, Vendor Read-Only Availability Toggle,
--           Immutable Per-File Pricing Snapshots, Page-Limit Validation
-- =============================================================

-- 1. ADDONS TABLE (Global Catalog Managed Strictly by Admin)
CREATE TABLE IF NOT EXISTS public.addons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    image_url TEXT,
    estimated_minutes INTEGER NOT NULL DEFAULT 0 CHECK (estimated_minutes >= 0),
    min_pages INTEGER NOT NULL DEFAULT 1 CHECK (min_pages >= 1),
    max_pages INTEGER NOT NULL DEFAULT 1000 CHECK (max_pages >= min_pages),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. SHOP_ADDONS TABLE (Shop Assignment & Base Pricing)
CREATE TABLE IF NOT EXISTS public.shop_addons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id UUID NOT NULL REFERENCES public.shops(id) ON DELETE RESTRICT,
    addon_id UUID NOT NULL REFERENCES public.addons(id) ON DELETE RESTRICT,
    price NUMERIC(10,2) NOT NULL CHECK (price >= 0.00),
    is_available BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_shop_addon UNIQUE (shop_id, addon_id)
);

-- 3. ORDER_FILE_ADDONS TABLE (Per-File Immutable Snapshots)
CREATE TABLE IF NOT EXISTS public.order_file_addons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    order_file_id UUID NOT NULL REFERENCES public.order_files(id) ON DELETE CASCADE,
    shop_addon_id UUID NOT NULL REFERENCES public.shop_addons(id) ON DELETE RESTRICT,
    addon_name_snapshot TEXT NOT NULL,
    unit_price_snapshot NUMERIC(10,2) NOT NULL CHECK (unit_price_snapshot >= 0.00),
    quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 1),
    total_price NUMERIC(10,2) NOT NULL CHECK (total_price >= 0.00),
    estimated_minutes_snapshot INTEGER NOT NULL DEFAULT 0 CHECK (estimated_minutes_snapshot >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_order_file_addon UNIQUE (order_file_id, shop_addon_id)
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_shop_addons_shop_id ON public.shop_addons(shop_id);
CREATE INDEX IF NOT EXISTS idx_shop_addons_addon_id ON public.shop_addons(addon_id);
CREATE INDEX IF NOT EXISTS idx_order_file_addons_order_id ON public.order_file_addons(order_id);
CREATE INDEX IF NOT EXISTS idx_order_file_addons_order_file_id ON public.order_file_addons(order_file_id);

-- =============================================================
-- 4. ROW LEVEL SECURITY POLICIES
-- =============================================================

ALTER TABLE public.addons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_addons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_file_addons ENABLE ROW LEVEL SECURITY;

-- Addons RLS
DROP POLICY IF EXISTS addons_select_policy ON public.addons;
CREATE POLICY addons_select_policy ON public.addons
    FOR SELECT TO public
    USING (true);

DROP POLICY IF EXISTS addons_admin_mutation ON public.addons;
CREATE POLICY addons_admin_mutation ON public.addons
    FOR ALL TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.user_id = auth.uid() AND p.role = 'admin'
        )
    );

-- Shop Addons RLS
DROP POLICY IF EXISTS shop_addons_select_policy ON public.shop_addons;
CREATE POLICY shop_addons_select_policy ON public.shop_addons
    FOR SELECT TO public
    USING (true);

-- Only Admin can mutate shop_addons (Insert, Update, Delete)
DROP POLICY IF EXISTS shop_addons_admin_all ON public.shop_addons;
CREATE POLICY shop_addons_admin_all ON public.shop_addons
    FOR ALL TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.user_id = auth.uid() AND p.role = 'admin'
        )
    );

-- Remove vendor update policy: Vendors CANNOT enable, disable, or modify add-ons
DROP POLICY IF EXISTS shop_addons_vendor_update ON public.shop_addons;

-- Order File Addons RLS
DROP POLICY IF EXISTS order_file_addons_select ON public.order_file_addons;
CREATE POLICY order_file_addons_select ON public.order_file_addons
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.orders o
            WHERE o.id = order_file_addons.order_id AND (
                o.user_id = auth.uid() OR
                EXISTS (SELECT 1 FROM public.shops s WHERE s.id = o.shop_id AND s.owner_id = auth.uid()) OR
                EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid() AND p.role = 'admin')
            )
        )
    );

REVOKE INSERT, UPDATE, DELETE ON public.order_file_addons FROM public, anon, authenticated;
GRANT ALL ON public.order_file_addons TO service_role;
GRANT ALL ON public.addons TO service_role;
GRANT ALL ON public.shop_addons TO service_role;

-- =============================================================
-- 5. ADMIN-ONLY MUTATION ENFORCEMENT TRIGGER
-- Vendors cannot create, update, or delete add-ons or toggle availability.
-- All add-on controls are strictly for Admin.
-- =============================================================

CREATE OR REPLACE FUNCTION public.enforce_vendor_shop_addon_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_is_admin BOOLEAN;
BEGIN
    SELECT (role = 'admin') INTO v_is_admin
    FROM public.profiles
    WHERE user_id = auth.uid();

    IF v_is_admin IS TRUE THEN
        RETURN NEW;
    END IF;

    -- Non-admin (Vendor or Customer): strictly blocked
    RAISE EXCEPTION 'Vendors cannot modify add-ons or toggle availability. All add-on controls are strictly managed by Admin.';
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_vendor_shop_addon_immutability ON public.shop_addons;
CREATE TRIGGER trg_enforce_vendor_shop_addon_immutability
    BEFORE UPDATE ON public.shop_addons
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_vendor_shop_addon_immutability();

-- =============================================================
-- 6. SEED STANDARD PRINT FINISHING ADD-ONS (Catalog)
-- =============================================================

INSERT INTO public.addons (name, description, estimated_minutes, min_pages, max_pages, is_active)
VALUES
    ('Spiral Binding', 'Durable plastic/wire coil binding with transparent protective covers for reports and projects.', 10, 10, 200, true),
    ('Stapling', 'Corner or edge heavy-duty industrial stapling for multi-page assignments and documents.', 2, 2, 50, true),
    ('Lamination', 'Thermal water-resistant, glossy protective coating for certificates, posters, and ID cards.', 5, 1, 10, true),
    ('Transparent Cover', 'Clear protective acetate front cover with stiff backing sheet.', 3, 5, 150, true),
    ('Soft Binding', 'Professional book-style spine tape binding for dissertations and comprehensive manuals.', 15, 20, 300, true)
ON CONFLICT (name) DO NOTHING;

-- Seed default assignment for D-Block Reprography ITECH
DO $$
DECLARE
    v_dblock_id UUID;
    v_spiral_id UUID;
    v_staple_id UUID;
BEGIN
    SELECT id INTO v_dblock_id FROM public.shops WHERE name ILIKE '%D-Block%' LIMIT 1;
    SELECT id INTO v_spiral_id FROM public.addons WHERE name = 'Spiral Binding' LIMIT 1;
    SELECT id INTO v_staple_id FROM public.addons WHERE name = 'Stapling' LIMIT 1;

    IF v_dblock_id IS NOT NULL THEN
        IF v_spiral_id IS NOT NULL THEN
            INSERT INTO public.shop_addons (shop_id, addon_id, price, is_available)
            VALUES (v_dblock_id, v_spiral_id, 30.00, true)
            ON CONFLICT (shop_id, addon_id) DO NOTHING;
        END IF;
        IF v_staple_id IS NOT NULL THEN
            INSERT INTO public.shop_addons (shop_id, addon_id, price, is_available)
            VALUES (v_dblock_id, v_staple_id, 5.00, true)
            ON CONFLICT (shop_id, addon_id) DO NOTHING;
        END IF;
    END IF;
END $$;

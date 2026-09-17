-- =============================================================
-- Migration: Create Initial XerService Schema (Security Hardened v2)
-- Tables: profiles, shops, shop_pricing
-- Security: Strict Row Level Security (RLS) & Auth Triggers
-- =============================================================

-- Enable pgcrypto for UUID generation if not already enabled
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================================
-- 1. PROFILES TABLE
-- Linked to Supabase auth.users for user details and roles
-- =============================================================
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name TEXT,
    phone TEXT,
    avatar_url TEXT,
    role TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer', 'vendor', 'admin')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- -------------------------------------------------------------
-- Profiles RLS Policies
-- -------------------------------------------------------------
-- Policy: Users can only read their own profile
CREATE POLICY "Users can view own profile"
    ON public.profiles
    FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

-- Policy: Users can only update their own profile details
CREATE POLICY "Users can update own profile"
    ON public.profiles
    FOR UPDATE
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- -------------------------------------------------------------
-- Trigger: Prevent Role Privilege Escalation
-- Prevents anon/authenticated client requests from modifying profiles.role
-- while permitting service_role backend and direct DB admin operations.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prevent_profile_role_escalation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_jwt_role TEXT;
BEGIN
    -- Extract the JWT role from the request context
    v_jwt_role := COALESCE(
        auth.jwt() ->> 'role',
        current_setting('request.jwt.claim.role', true),
        ''
    );

    -- Check if role column is being changed
    IF NEW.role IS DISTINCT FROM OLD.role THEN
        -- If update originates from client JWT context (authenticated or anon), disallow changing role
        IF v_jwt_role IN ('authenticated', 'anon') THEN
            NEW.role := OLD.role;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_role_escalation ON public.profiles;
CREATE TRIGGER trg_prevent_role_escalation
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.prevent_profile_role_escalation();

-- -------------------------------------------------------------
-- Trigger: Profile Auto-Creation on auth.users Signup
-- Automatically creates matching public.profiles row on auth signup
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_full_name TEXT;
    v_phone TEXT;
BEGIN
    -- Extract full_name from OAuth/email metadata when present
    v_full_name := COALESCE(
        NEW.raw_user_meta_data->>'full_name',
        NEW.raw_user_meta_data->>'name',
        NULL
    );

    -- Extract phone from auth.users column or metadata when present
    v_phone := COALESCE(
        NEW.phone,
        NEW.raw_user_meta_data->>'phone',
        NULL
    );

    -- Strictly enforce role = 'customer' (ignores any client-provided metadata role)
    INSERT INTO public.profiles (
        user_id,
        full_name,
        phone,
        avatar_url,
        role
    ) VALUES (
        NEW.id,
        v_full_name,
        v_phone,
        NEW.raw_user_meta_data->>'avatar_url',
        'customer'
    )
    ON CONFLICT (user_id) DO NOTHING;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();

-- =============================================================
-- 2. SHOPS TABLE
-- Represents print shops / reprography centers with owner binding
-- =============================================================
CREATE TABLE IF NOT EXISTS public.shops (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'CLOSED' CHECK (status IN ('OPEN', 'PAUSED', 'CLOSED')),
    open_time TIME,
    close_time TIME,
    closing_soon BOOLEAN NOT NULL DEFAULT false,
    closing_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.shops ENABLE ROW LEVEL SECURITY;

-- -------------------------------------------------------------
-- Shops RLS Policies
-- -------------------------------------------------------------
-- Policy: Authenticated users (customers & vendors) can read shops
CREATE POLICY "Authenticated users can read shops"
    ON public.shops
    FOR SELECT
    TO authenticated
    USING (true);

-- Policy: Guest visitors can read shops (needed for homepage browsing)
CREATE POLICY "Guest visitors can read shops"
    ON public.shops
    FOR SELECT
    TO anon
    USING (true);

-- Policy: Vendors can ONLY update their own shop if they have the 'vendor' role
-- Customers cannot update shops even if assigned as owner
CREATE POLICY "Vendors can update own shop"
    ON public.shops
    FOR UPDATE
    TO authenticated
    USING (
        owner_id = auth.uid()
        AND EXISTS (
            SELECT 1 FROM public.profiles
            WHERE profiles.user_id = auth.uid()
            AND profiles.role = 'vendor'
        )
    )
    WITH CHECK (
        owner_id = auth.uid()
        AND EXISTS (
            SELECT 1 FROM public.profiles
            WHERE profiles.user_id = auth.uid()
            AND profiles.role = 'vendor'
        )
    );

-- NOTE on Shop Creation:
-- Self-service client shop insertion is intentionally disabled for this MVP.
-- Shops are onboarded exclusively by admin or backend service_role operations.

-- =============================================================
-- 3. SHOP_PRICING TABLE
-- Per-sheet pricing matrix per shop, paper size, and print mode
-- =============================================================
CREATE TABLE IF NOT EXISTS public.shop_pricing (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id UUID NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
    paper_size TEXT NOT NULL,
    print_mode TEXT NOT NULL CHECK (print_mode IN ('BW', 'COLOUR')),
    sides TEXT NOT NULL CHECK (sides IN ('SINGLE', 'DOUBLE_LONG_EDGE', 'DOUBLE_SHORT_EDGE')),
    price_per_sheet NUMERIC(10,2) NOT NULL CHECK (price_per_sheet >= 0),
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_shop_pricing_config UNIQUE (shop_id, paper_size, print_mode, sides)
);

-- Enable Row Level Security
ALTER TABLE public.shop_pricing ENABLE ROW LEVEL SECURITY;

-- -------------------------------------------------------------
-- Shop Pricing RLS Policies
-- -------------------------------------------------------------
-- Policy: Authenticated users can read active pricing (or vendors can read all for their own shop)
CREATE POLICY "Authenticated users can read active pricing"
    ON public.shop_pricing
    FOR SELECT
    TO authenticated
    USING (
        active = true
        OR EXISTS (
            SELECT 1 FROM public.shops
            JOIN public.profiles ON profiles.user_id = auth.uid()
            WHERE shops.id = shop_pricing.shop_id
            AND shops.owner_id = auth.uid()
            AND profiles.role = 'vendor'
        )
    );

-- Policy: Guest visitors can read active pricing for calculator/preview
CREATE POLICY "Guest visitors can read active pricing"
    ON public.shop_pricing
    FOR SELECT
    TO anon
    USING (active = true);

-- Policy: ONLY verified vendors owning the related shop can insert pricing
CREATE POLICY "Vendors can insert pricing for own shop"
    ON public.shop_pricing
    FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.shops
            JOIN public.profiles ON profiles.user_id = auth.uid()
            WHERE shops.id = shop_pricing.shop_id
            AND shops.owner_id = auth.uid()
            AND profiles.role = 'vendor'
        )
    );

-- Policy: ONLY verified vendors owning the related shop can update pricing
CREATE POLICY "Vendors can update pricing for own shop"
    ON public.shop_pricing
    FOR UPDATE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.shops
            JOIN public.profiles ON profiles.user_id = auth.uid()
            WHERE shops.id = shop_pricing.shop_id
            AND shops.owner_id = auth.uid()
            AND profiles.role = 'vendor'
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.shops
            JOIN public.profiles ON profiles.user_id = auth.uid()
            WHERE shops.id = shop_pricing.shop_id
            AND shops.owner_id = auth.uid()
            AND profiles.role = 'vendor'
        )
    );

-- Policy: ONLY verified vendors owning the related shop can delete pricing
CREATE POLICY "Vendors can delete pricing for own shop"
    ON public.shop_pricing
    FOR DELETE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.shops
            JOIN public.profiles ON profiles.user_id = auth.uid()
            WHERE shops.id = shop_pricing.shop_id
            AND shops.owner_id = auth.uid()
            AND profiles.role = 'vendor'
        )
    );

-- =============================================================
-- INDEXES
-- Optimize foreign keys, auth lookups, and query filters
-- =============================================================
CREATE INDEX IF NOT EXISTS idx_profiles_user_id ON public.profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_shops_status ON public.shops(status);
CREATE INDEX IF NOT EXISTS idx_shops_owner_id ON public.shops(owner_id);
CREATE INDEX IF NOT EXISTS idx_shop_pricing_shop_id ON public.shop_pricing(shop_id);

-- =============================================================
-- TRIGGERS: updated_at auto-timestamp
-- =============================================================
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_profiles_updated_at ON public.profiles;
CREATE TRIGGER trg_profiles_updated_at
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS trg_shops_updated_at ON public.shops;
CREATE TRIGGER trg_shops_updated_at
    BEFORE UPDATE ON public.shops
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS trg_shop_pricing_updated_at ON public.shop_pricing;
CREATE TRIGGER trg_shop_pricing_updated_at
    BEFORE UPDATE ON public.shop_pricing
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();

-- =============================================================
-- DEVELOPMENT SEED DATA
-- Test shop and baseline pricing (owner_id NULL for development)
-- =============================================================
DO $$
DECLARE
    v_shop_id UUID;
BEGIN
    -- Only insert test shop if not already present
    SELECT id INTO v_shop_id FROM public.shops WHERE name = 'D-Block Reprography ITECH' LIMIT 1;

    IF v_shop_id IS NULL THEN
        INSERT INTO public.shops (
            owner_id,
            name,
            description,
            status,
            open_time,
            close_time,
            closing_soon,
            closing_message
        ) VALUES (
            NULL, -- Development seed row has no assigned auth user yet
            'D-Block Reprography ITECH',
            'College reprography and instant document printing center.',
            'OPEN',
            '09:00:00',
            '16:30:00',
            false,
            NULL
        ) RETURNING id INTO v_shop_id;

        -- Insert baseline seed pricing for D-Block Reprography ITECH
        INSERT INTO public.shop_pricing (
            shop_id,
            paper_size,
            print_mode,
            sides,
            price_per_sheet,
            active
        ) VALUES
            (v_shop_id, 'A4', 'BW', 'SINGLE', 2.00, true),
            (v_shop_id, 'A4', 'COLOUR', 'SINGLE', 7.00, true);
    END IF;
END $$;

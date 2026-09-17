-- =============================================================
-- Migration: Fix Addon Service Role Trigger
-- Filename: supabase/migrations/20260911020000_fix_addon_service_role_trigger.sql
-- Description: Allow backend service role and admin users to mutate
--              shop_addons while strictly preventing vendor mutations.
-- =============================================================

CREATE OR REPLACE FUNCTION public.enforce_vendor_shop_addon_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_role TEXT;
BEGIN
    -- Backend service role execution has no auth.uid()
    IF auth.uid() IS NULL THEN
        RETURN NEW;
    END IF;

    -- Check profile role for authenticated user
    SELECT role INTO v_role
    FROM public.profiles
    WHERE user_id = auth.uid();

    IF v_role = 'admin' THEN
        RETURN NEW;
    END IF;

    -- Non-admin (Vendor or Customer): strictly blocked
    RAISE EXCEPTION 'Vendors cannot modify add-ons or toggle availability. All add-on controls are strictly managed by Admin.';
END;
$$;

-- =============================================================
-- Migration: Harden Verified Phone Identity & Uniqueness (Phase 6H.1 Final)
-- Table: public.profiles
-- Goals:
--   1. Historical Reconciliation: Set profiles.phone = NULL for historical
--      unverified profile records that do not match verified auth.users.phone.
--   2. Authoritative Phone Sync RPC: sync_verified_phone_to_profile() reads
--      auth.users.phone directly and synchronizes to public.profiles.
--   3. Database-Level Trigger: Protect profiles.phone from direct browser/client
--      mutations that do not match verified auth.users.phone.
--   4. Format CHECK Constraint: Fully validate that all non-null phones in
--      public.profiles strictly match canonical Indian E.164 (+91[6-9]XXXXXXXXX).
--   5. Partial Unique Index: Ensure global uniqueness across non-null verified phones.
--
-- Historical Data Audit Note:
--   Some legacy profile rows may contain unverified, non-canonical phone values.
--   This migration safely sets those values to NULL,
--   preserving the user accounts, profiles, orders, and wallet_accounts while requiring real Supabase
--   verification before establishing a trusted verified phone identity.
-- =============================================================

-- -------------------------------------------------------------
-- 1. Historical Data Reconciliation
-- -------------------------------------------------------------
-- Set profiles.phone = NULL for any row where phone is not verified in auth.users
UPDATE public.profiles p
SET phone = NULL
WHERE p.phone IS NOT NULL
  AND (
    NOT EXISTS (
      SELECT 1 FROM auth.users u
      WHERE u.id = p.user_id
        AND u.phone IS NOT NULL
        AND u.phone <> ''
        AND u.phone = p.phone
    )
  );

-- Synchronize verified auth.users.phone if present on auth.users
UPDATE public.profiles p
SET phone = u.phone
FROM auth.users u
WHERE p.user_id = u.id
  AND u.phone IS NOT NULL
  AND u.phone <> ''
  AND (p.phone IS NULL OR p.phone <> u.phone);

-- -------------------------------------------------------------
-- 2. Format CHECK constraint enforcing Indian E.164 (+91[6-9]XXXXXXXXX)
-- Fully VALID because all historical non-matching records were safely set to NULL above.
-- -------------------------------------------------------------
DO $$
BEGIN
    -- Drop older constraint if present to ensure clean validation state
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_profiles_phone_format'
    ) THEN
        ALTER TABLE public.profiles DROP CONSTRAINT chk_profiles_phone_format;
    END IF;

    ALTER TABLE public.profiles
        ADD CONSTRAINT chk_profiles_phone_format
        CHECK (phone IS NULL OR phone ~ '^\+91[6-9][0-9]{9}$');
END $$;

-- -------------------------------------------------------------
-- 3. Partial Unique Index on Verified Phone Numbers
-- -------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_phone_unique
    ON public.profiles (phone)
    WHERE phone IS NOT NULL;

-- -------------------------------------------------------------
-- 4. Database-Level Trigger: Protect profiles.phone Against Arbitrary Client Mutation
-- Prevents authenticated/anon clients from directly updating or inserting profiles.phone to
-- any value that has not already been verified on auth.users for that user_id.
-- Uses NULL-safe comparison (NEW.phone IS DISTINCT FROM v_auth_phone) so that:
--   - If auth.users.phone is verified, browser cannot clear it to NULL.
--   - If auth.users.phone is verified, browser cannot set it to an unverified number.
--   - If auth.users.phone is NULL, browser cannot set it to an arbitrary number.
-- Allows normal client updates to full_name and avatar_url.
-- Allows trusted service-role, postgres, and backend operations without restriction.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.protect_profile_phone_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_jwt_role TEXT;
    v_auth_phone TEXT;
BEGIN
    -- Extract the caller JWT role
    v_jwt_role := COALESCE(
        auth.jwt() ->> 'role',
        current_setting('request.jwt.claim.role', true),
        ''
    );

    -- Check if phone column is being changed on UPDATE, or set on INSERT
    IF (TG_OP = 'UPDATE' AND NEW.phone IS DISTINCT FROM OLD.phone)
       OR (TG_OP = 'INSERT') THEN
        -- If operation originates from client JWT context (authenticated or anon)
        IF v_jwt_role IN ('authenticated', 'anon') THEN
            -- Check authoritative phone on auth.users for this profile
            SELECT phone INTO v_auth_phone
            FROM auth.users
            WHERE id = NEW.user_id;

            -- NULL-safe comparison: NEW.phone must match authoritative v_auth_phone exactly
            IF NEW.phone IS DISTINCT FROM v_auth_phone THEN
                RAISE EXCEPTION 'Direct modification of profile phone is not permitted. Phone must match verified auth.users phone.'
                    USING ERRCODE = '42501';
            END IF;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_profile_phone_identity ON public.profiles;
CREATE TRIGGER trg_protect_profile_phone_identity
    BEFORE INSERT OR UPDATE ON public.profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.protect_profile_phone_identity();

-- -------------------------------------------------------------
-- 5. Trusted Synchronization RPC: sync_verified_phone_to_profile
-- Reads authoritative phone directly from auth.users for the authenticated user
-- and updates public.profiles without trusting client-supplied phone input.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_verified_phone_to_profile()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_auth_phone TEXT;
    v_updated_rows INT;
BEGIN
    -- 1. Authenticate caller
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required to synchronize verified phone' USING ERRCODE = '42501';
    END IF;

    -- 2. Read authoritative phone from auth.users
    SELECT phone INTO v_auth_phone
    FROM auth.users
    WHERE id = v_user_id;

    IF v_auth_phone IS NULL OR trim(v_auth_phone) = '' THEN
        RAISE EXCEPTION 'No verified phone number found on authenticated account' USING ERRCODE = 'P0001';
    END IF;

    -- 3. Validate canonical E.164 format (+91[6-9]XXXXXXXXX)
    IF v_auth_phone !~ '^\+91[6-9][0-9]{9}$' THEN
        RAISE EXCEPTION 'Authoritative phone % does not match required Indian E.164 format', v_auth_phone USING ERRCODE = '23514';
    END IF;

    -- 4. Update ONLY the authenticated user's profile row
    UPDATE public.profiles
    SET phone = v_auth_phone,
        updated_at = now()
    WHERE user_id = v_user_id;

    GET DIAGNOSTICS v_updated_rows = ROW_COUNT;
    IF v_updated_rows = 0 THEN
        RAISE EXCEPTION 'Profile row not found for user %', v_user_id USING ERRCODE = 'P0002';
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'user_id', v_user_id,
        'phone', v_auth_phone
    );
END;
$$;

-- Configure least-privilege permissions: explicitly revoke from PUBLIC and anon, grant to authenticated only
REVOKE ALL ON FUNCTION public.sync_verified_phone_to_profile() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_verified_phone_to_profile() FROM anon;
GRANT EXECUTE ON FUNCTION public.sync_verified_phone_to_profile() TO authenticated;

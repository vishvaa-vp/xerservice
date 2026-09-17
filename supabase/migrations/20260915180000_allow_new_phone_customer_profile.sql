-- =============================================================
-- Migration: Allow New Phone OTP Customer Profile Creation & Hardened Sync
-- Tables: public.profiles, auth.users
-- Purpose:
--   1. Harden public.handle_new_user() trigger so that if auth.users.phone
--      is saved without '+' (for example, an Indian country code followed by
--      a 10-digit mobile number), it is canonicalized before insertion, avoiding
--      chk_profiles_phone_format constraint violations. If phone cannot be
--      canonicalized, it safely defaults to NULL during auth signup so the
--      account is saved and subsequent sync handles authoritative linking.
--   2. Harden public.protect_profile_phone_identity() trigger function to
--      canonicalize auth.users.phone when comparing against profiles.phone,
--      preventing false-positive rejections when GoTrue stores phone without '+'.
--   3. Harden sync_verified_phone_to_profile() RPC to upsert the customer
--      profile if not already present, ensuring new phone users have their
--      profile correctly created with role = 'customer'.
-- =============================================================

-- -------------------------------------------------------------
-- 1. Hardened Trigger: Profile Auto-Creation on auth.users Signup
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_full_name TEXT;
    v_raw_phone TEXT;
    v_canonical_phone TEXT;
BEGIN
    -- Extract full_name from OAuth/email metadata when present
    v_full_name := COALESCE(
        NEW.raw_user_meta_data->>'full_name',
        NEW.raw_user_meta_data->>'name',
        NULL
    );

    -- Extract phone from auth.users column or metadata when present
    v_raw_phone := COALESCE(
        NEW.phone,
        NEW.raw_user_meta_data->>'phone',
        NULL
    );

    -- Canonicalize phone for Indian E.164 (+91[6-9]XXXXXXXXX)
    IF v_raw_phone IS NOT NULL AND trim(v_raw_phone) <> '' THEN
        IF v_raw_phone ~ '^\+91[6-9][0-9]{9}$' THEN
            v_canonical_phone := v_raw_phone;
        ELSIF v_raw_phone ~ '^91[6-9][0-9]{9}$' THEN
            v_canonical_phone := '+' || v_raw_phone;
        ELSIF v_raw_phone ~ '^[6-9][0-9]{9}$' THEN
            v_canonical_phone := '+91' || v_raw_phone;
        ELSE
            -- Non-conforming phone; set NULL so insert succeeds without constraint failure
            v_canonical_phone := NULL;
        END IF;
    ELSE
        v_canonical_phone := NULL;
    END IF;

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
        v_canonical_phone,
        NEW.raw_user_meta_data->>'avatar_url',
        'customer'
    )
    ON CONFLICT (user_id) DO UPDATE
    SET phone = COALESCE(public.profiles.phone, EXCLUDED.phone),
        full_name = COALESCE(public.profiles.full_name, EXCLUDED.full_name),
        updated_at = now();

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();

-- -------------------------------------------------------------
-- 2. Hardened Trigger: Protect profiles.phone Against Client Tampering
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
    v_canonical_auth_phone TEXT;
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

            -- Canonicalize authoritative phone from auth.users (handles GoTrue storing without '+')
            IF v_auth_phone IS NOT NULL AND trim(v_auth_phone) <> '' THEN
                IF v_auth_phone ~ '^\+91[6-9][0-9]{9}$' THEN
                    v_canonical_auth_phone := v_auth_phone;
                ELSIF v_auth_phone ~ '^91[6-9][0-9]{9}$' THEN
                    v_canonical_auth_phone := '+' || v_auth_phone;
                ELSIF v_auth_phone ~ '^[6-9][0-9]{9}$' THEN
                    v_canonical_auth_phone := '+91' || v_auth_phone;
                ELSE
                    v_canonical_auth_phone := NULL;
                END IF;
            ELSE
                v_canonical_auth_phone := NULL;
            END IF;

            -- NULL-safe comparison: NEW.phone must match authoritative canonical phone
            IF NEW.phone IS DISTINCT FROM v_canonical_auth_phone THEN
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
-- 3. Hardened Synchronization RPC: sync_verified_phone_to_profile
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
    v_canonical_phone TEXT;
    v_full_name TEXT;
BEGIN
    -- 1. Authenticate caller
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required to synchronize verified phone' USING ERRCODE = '42501';
    END IF;

    -- 2. Read authoritative phone from auth.users
    SELECT phone, COALESCE(raw_user_meta_data->>'full_name', raw_user_meta_data->>'name', NULL)
    INTO v_auth_phone, v_full_name
    FROM auth.users
    WHERE id = v_user_id;

    IF v_auth_phone IS NULL OR trim(v_auth_phone) = '' THEN
        RAISE EXCEPTION 'No verified phone number found on authenticated account' USING ERRCODE = 'P0001';
    END IF;

    -- 3. Validate and canonicalize canonical E.164 format (+91[6-9]XXXXXXXXX)
    IF v_auth_phone ~ '^\+91[6-9][0-9]{9}$' THEN
        v_canonical_phone := v_auth_phone;
    ELSIF v_auth_phone ~ '^91[6-9][0-9]{9}$' THEN
        v_canonical_phone := '+' || v_auth_phone;
    ELSIF v_auth_phone ~ '^[6-9][0-9]{9}$' THEN
        v_canonical_phone := '+91' || v_auth_phone;
    ELSE
        RAISE EXCEPTION 'Authoritative phone % does not match required Indian E.164 format', v_auth_phone USING ERRCODE = '23514';
    END IF;

    -- 4. Upsert profile row for user_id
    INSERT INTO public.profiles (
        user_id,
        phone,
        full_name,
        role,
        updated_at
    ) VALUES (
        v_user_id,
        v_canonical_phone,
        COALESCE(v_full_name, 'Customer (' || right(v_canonical_phone, 4) || ')'),
        'customer',
        now()
    )
    ON CONFLICT (user_id) DO UPDATE
    SET phone = v_canonical_phone,
        updated_at = now();

    RETURN jsonb_build_object(
        'success', true,
        'user_id', v_user_id,
        'phone', v_canonical_phone
    );
END;
$$;

REVOKE ALL ON FUNCTION public.sync_verified_phone_to_profile() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_verified_phone_to_profile() FROM anon;
GRANT EXECUTE ON FUNCTION public.sync_verified_phone_to_profile() TO authenticated;

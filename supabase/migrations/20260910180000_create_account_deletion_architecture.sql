-- ============================================================================
-- Migration: 20260910180000_create_account_deletion_architecture.sql
-- Description: Account deletion and PII anonymization architecture
-- Note: DO NOT PUSH automatically. Prepared for Phase 6 production migrations.
-- ============================================================================

-- Documenting Account Deletion & Referential Integrity Architecture:
-- 1. Financial Records Protection:
--    - public.orders, public.order_receipts, public.order_financial_ledger,
--      public.wallet_transactions, public.refund_requests reference auth.users(id)
--      with ON DELETE RESTRICT.
--    - Direct hard deletion of auth.users would violate foreign key constraints
--      and corrupt regulatory financial audit trails.
-- 2. Anonymization Strategy:
--    - Customer accounts requesting deletion must have 0 orders in progress
--      (status NOT IN ('QUEUED', 'PRINTING', 'READY')).
--    - Any draft orders and associated temporary files are pruned.
--    - All rows in public.notifications for the user are deleted.
--    - public.profiles row is scrubbed:
--        full_name -> 'Deleted Account'
--        phone -> NULL
--        avatar_url -> NULL
--    - auth.users row is anonymized:
--        email -> 'deleted_<timestamp>_<uuid>@deleted.xerservice.internal'
--        phone -> NULL
--      This frees the customer's real email address so they can re-register in the future.
--    - All sessions are revoked globally via auth.admin.signOut().

-- Optional Helper RPC for atomic DB-level account anonymization (for future use):
CREATE OR REPLACE FUNCTION public.anonymize_user_profile(target_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    -- Only allow execution by service role or user themselves
    IF auth.uid() <> target_user_id AND current_setting('role', true) <> 'service_role' THEN
        RAISE EXCEPTION 'Unauthorized profile anonymization attempt.';
    END IF;

    UPDATE public.profiles
    SET full_name = 'Deleted Account',
        phone = NULL,
        avatar_url = NULL,
        updated_at = NOW()
    WHERE user_id = target_user_id;

    DELETE FROM public.notifications
    WHERE user_id = target_user_id;
END;
$$;

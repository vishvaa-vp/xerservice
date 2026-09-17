-- =============================================================
-- Migration: Add payment_method to payment_attempts (Phase 6B Follow-up)
-- Table: payment_attempts
-- Purpose: Persist verified payment method (UPI, CARD, NETBANKING, WALLET, OTHER)
--          received directly from authoritative Razorpay server/webhook payloads.
-- NOTE: DO NOT run supabase db push until ready to deploy payment method telemetry.
-- =============================================================

ALTER TABLE public.payment_attempts
    ADD COLUMN IF NOT EXISTS payment_method TEXT CHECK (
        payment_method IS NULL OR payment_method IN ('UPI', 'CARD', 'NETBANKING', 'WALLET', 'OTHER')
    );

COMMENT ON COLUMN public.payment_attempts.payment_method IS
    'Authoritative payment instrument type populated strictly from verified Razorpay webhook/server API payloads.';

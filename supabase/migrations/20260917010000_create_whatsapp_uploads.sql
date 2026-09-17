-- =============================================================
-- Migration: Create WhatsApp Uploads Schema
-- Table: public.whatsapp_uploads
-- Purpose:
--   1. Stores metadata for incoming WhatsApp media (documents/images).
--   2. Links uploads to identified XerService user (nullable if unlinked/unregistered).
--   3. Idempotent tracking via unique whatsapp_message_id.
--   4. Prepares media for quarantine validation, storage, and cart integration.
-- =============================================================

CREATE TABLE IF NOT EXISTS public.whatsapp_uploads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    whatsapp_message_id TEXT UNIQUE,
    whatsapp_number TEXT NOT NULL,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    media_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    sha256 TEXT,
    storage_path TEXT,
    status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'pending_download', 'downloaded', 'failed', 'cart_ready')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for efficient lookups
CREATE INDEX IF NOT EXISTS idx_whatsapp_uploads_message_id ON public.whatsapp_uploads (whatsapp_message_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_uploads_number ON public.whatsapp_uploads (whatsapp_number);
CREATE INDEX IF NOT EXISTS idx_whatsapp_uploads_user_id ON public.whatsapp_uploads (user_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_uploads_media_id ON public.whatsapp_uploads (media_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_uploads_status ON public.whatsapp_uploads (status);

-- Enable Row Level Security
ALTER TABLE public.whatsapp_uploads ENABLE ROW LEVEL SECURITY;

-- 1. Service role full access
CREATE POLICY "Service role full access on whatsapp_uploads"
    ON public.whatsapp_uploads FOR ALL
    USING (auth.jwt() ->> 'role' = 'service_role')
    WITH CHECK (auth.jwt() ->> 'role' = 'service_role');

-- 2. Customer view own uploads
CREATE POLICY "Customers can view own whatsapp_uploads"
    ON public.whatsapp_uploads FOR SELECT
    USING (auth.uid() = user_id);

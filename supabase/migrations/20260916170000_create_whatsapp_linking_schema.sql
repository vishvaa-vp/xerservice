-- =============================================================
-- Migration: Stage A12 WhatsApp Linking and Ingestion Schema
-- Tables: public.whatsapp_links, public.whatsapp_link_challenges,
--         public.whatsapp_inbox_events, public.whatsapp_imported_files
-- Purpose:
--   1. Associates verified WhatsApp sender identities with customer accounts.
--   2. Authoritative server-generated challenges with 5-minute TTL.
--   3. Deduplication of incoming provider events.
--   4. Quarantined file import storage and status lifecycle.
-- =============================================================

-- 1. Create whatsapp_links table
CREATE TABLE IF NOT EXISTS public.whatsapp_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    sender_id TEXT NOT NULL,
    phone_number TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disconnected')),
    order_updates_opt_in BOOLEAN NOT NULL DEFAULT true,
    consent_version TEXT NOT NULL DEFAULT 'v1',
    linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Active uniqueness constraints: one active link per user, one active link per sender
CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_links_active_user
    ON public.whatsapp_links (user_id)
    WHERE status = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_links_active_sender
    ON public.whatsapp_links (sender_id)
    WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_whatsapp_links_user_id ON public.whatsapp_links (user_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_links_sender_id ON public.whatsapp_links (sender_id);

-- 2. Create whatsapp_link_challenges table
CREATE TABLE IF NOT EXISTS public.whatsapp_link_challenges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    challenge_hash TEXT NOT NULL UNIQUE,
    intended_phone TEXT,
    sender_id TEXT,
    state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'awaiting_confirmation', 'confirmed', 'expired', 'revoked')),
    order_updates_opt_in BOOLEAN NOT NULL DEFAULT true,
    attempts INTEGER NOT NULL DEFAULT 0,
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '5 minutes'),
    confirmed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_challenges_user_id ON public.whatsapp_link_challenges (user_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_challenges_state ON public.whatsapp_link_challenges (state);
CREATE INDEX IF NOT EXISTS idx_whatsapp_challenges_expires ON public.whatsapp_link_challenges (expires_at);

-- 3. Create whatsapp_inbox_events table
CREATE TABLE IF NOT EXISTS public.whatsapp_inbox_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_event_id TEXT UNIQUE,
    event_type TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    processing_status TEXT NOT NULL DEFAULT 'pending' CHECK (processing_status IN ('pending', 'processed', 'ignored', 'failed')),
    retry_count INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_events_provider_id ON public.whatsapp_inbox_events (provider_event_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_events_status ON public.whatsapp_inbox_events (processing_status);

-- 4. Create whatsapp_imported_files table
CREATE TABLE IF NOT EXISTS public.whatsapp_imported_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    source_message_id TEXT NOT NULL,
    media_id TEXT NOT NULL,
    original_filename TEXT NOT NULL,
    storage_path TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    file_size BIGINT NOT NULL,
    page_count INTEGER,
    validation_status TEXT NOT NULL DEFAULT 'quarantined' CHECK (validation_status IN ('quarantined', 'valid', 'rejected')),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '7 days'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_imported_files_user ON public.whatsapp_imported_files (user_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_imported_files_status ON public.whatsapp_imported_files (validation_status);

-- 5. Row Level Security (RLS)
ALTER TABLE public.whatsapp_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_link_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_inbox_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_imported_files ENABLE ROW LEVEL SECURITY;

-- Service role bypass policies (full access)
CREATE POLICY "Service role full access on whatsapp_links"
    ON public.whatsapp_links FOR ALL
    USING (auth.jwt() ->> 'role' = 'service_role')
    WITH CHECK (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Service role full access on whatsapp_link_challenges"
    ON public.whatsapp_link_challenges FOR ALL
    USING (auth.jwt() ->> 'role' = 'service_role')
    WITH CHECK (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Service role full access on whatsapp_inbox_events"
    ON public.whatsapp_inbox_events FOR ALL
    USING (auth.jwt() ->> 'role' = 'service_role')
    WITH CHECK (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Service role full access on whatsapp_imported_files"
    ON public.whatsapp_imported_files FOR ALL
    USING (auth.jwt() ->> 'role' = 'service_role')
    WITH CHECK (auth.jwt() ->> 'role' = 'service_role');

-- Customer access policies: Customers can view their own links and challenges
CREATE POLICY "Customers can view own active whatsapp_links"
    ON public.whatsapp_links FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Customers can view own whatsapp_link_challenges"
    ON public.whatsapp_link_challenges FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Customers can view own imported files"
    ON public.whatsapp_imported_files FOR SELECT
    USING (auth.uid() = user_id);

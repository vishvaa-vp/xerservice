-- =============================================================
-- Migration: Create Order Documents Storage Bucket & Security (Phase 5A)
-- Bucket: order-documents (PRIVATE)
-- Access: Customers can upload/read/delete only within users/<user_id>/...
-- Security: Strict Row Level Security (RLS) on storage.objects
-- =============================================================

-- 1. Insert private bucket if not exists
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'order-documents',
    'order-documents',
    false,
    20971520, -- 20 MB (20 * 1024 * 1024 bytes)
    ARRAY[
        'application/pdf',
        'image/jpeg',
        'image/png',
        'image/webp'
    ]
)
ON CONFLICT (id) DO UPDATE SET
    public = false,
    file_size_limit = 20971520,
    allowed_mime_types = ARRAY[
        'application/pdf',
        'image/jpeg',
        'image/png',
        'image/webp'
    ];

-- 2. Storage RLS Policies for order-documents
-- Note: storage.objects has RLS enabled by default in Supabase.

-- Customer INSERT: Customers may upload documents only into their own user folder:
-- users/<auth.uid()>/orders/<order_id>/<file_id>/<filename>
DROP POLICY IF EXISTS "Customers can upload own order documents" ON storage.objects;
CREATE POLICY "Customers can upload own order documents"
    ON storage.objects
    FOR INSERT
    TO authenticated
    WITH CHECK (
        bucket_id = 'order-documents'
        AND (name LIKE ('users/' || auth.uid()::text || '/%'))
    );

-- Customer SELECT: Customers may read/download documents only from their own user folder:
DROP POLICY IF EXISTS "Customers can view own order documents" ON storage.objects;
CREATE POLICY "Customers can view own order documents"
    ON storage.objects
    FOR SELECT
    TO authenticated
    USING (
        bucket_id = 'order-documents'
        AND (name LIKE ('users/' || auth.uid()::text || '/%'))
    );

-- Customer DELETE: Customers may delete documents only from their own user folder:
DROP POLICY IF EXISTS "Customers can delete own order documents" ON storage.objects;
CREATE POLICY "Customers can delete own order documents"
    ON storage.objects
    FOR DELETE
    TO authenticated
    USING (
        bucket_id = 'order-documents'
        AND (name LIKE ('users/' || auth.uid()::text || '/%'))
    );

-- Customer UPDATE: Customers are not permitted to overwrite existing uploaded documents.
-- Instead, modifications occur by deleting and uploading a new file.

-- NOTE: No vendor access policies are granted on storage.objects in this phase.
-- Vendor document access will be granted in a future phase via authorized server-side signed URLs.
-- No anon or public access is granted.

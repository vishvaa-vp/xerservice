-- Restrictive policies compose with existing ownership, draft, and pricing policies.
-- Vendor/admin server operations use the existing authenticated, authorized APIs.
BEGIN;
DO $$
DECLARE target_table text;
BEGIN
  FOREACH target_table IN ARRAY ARRAY['orders', 'order_files', 'print_settings'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS customer_role_insert ON public.%I', target_table);
    EXECUTE format('CREATE POLICY customer_role_insert ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND role = ''customer''))', target_table);
    EXECUTE format('DROP POLICY IF EXISTS customer_role_update ON public.%I', target_table);
    EXECUTE format('CREATE POLICY customer_role_update ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND role = ''customer'')) WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND role = ''customer''))', target_table);
    EXECUTE format('DROP POLICY IF EXISTS customer_role_delete ON public.%I', target_table);
    EXECUTE format('CREATE POLICY customer_role_delete ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND role = ''customer''))', target_table);
  END LOOP;
END $$;
DROP POLICY IF EXISTS customer_document_upload_role ON storage.objects;
CREATE POLICY customer_document_upload_role ON storage.objects AS RESTRICTIVE
FOR INSERT TO authenticated WITH CHECK (
  bucket_id <> 'order-documents' OR EXISTS (
    SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND role = 'customer'
  )
);
ALTER TABLE public.print_settings ADD COLUMN IF NOT EXISTS custom_scale numeric NOT NULL DEFAULT 100 CHECK (custom_scale BETWEEN 10 AND 200);
COMMIT;

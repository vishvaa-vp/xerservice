-- =============================================================
-- Migration: Create Atomic Verified Order Pricing Function (Phase 5B - Hardened)
-- Function: public.apply_verified_order_pricing(UUID, JSONB)
-- Security: SECURITY DEFINER, service_role execution only.
--           Explicitly revoked from public, anon, and authenticated
--           to prevent client-side bypass or arbitrary price submission.
-- Protections:
--   1. Parent order lock (FOR UPDATE), status = 'DRAFT', payment_status = 'UNPAID', unexpired
--   2. Authoritative live shop verification: status = 'OPEN', closing_soon = false
--   3. Exact file-set validation: no missing, extra, foreign, or duplicate files
--   4. Settings race protection: aborts with conflict if print_settings changed mid-calculation
--   5. Shop price race protection: verifies active shop_pricing matches expected price
--   6. Validated bounds: original_pages >= 1, printable_pages >= 1, physical_sheets >= 1
--   7. Orders totals atomicity: updates orders totals while keeping DRAFT & UNPAID
-- =============================================================

CREATE OR REPLACE FUNCTION public.apply_verified_order_pricing(
    p_order_id UUID,
    p_files JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_order RECORD;
    v_shop RECORD;
    v_file RECORD;
    v_curr_settings RECORD;
    v_file_elem JSONB;
    v_unique_payload_file_count INTEGER;
    v_payload_count INTEGER;
    v_db_file_count INTEGER;
    v_current_price NUMERIC(10,2);
    v_line_total NUMERIC(10,2);
    v_total_original_pages INTEGER := 0;
    v_total_printable_pages INTEGER := 0;
    v_total_sheets INTEGER := 0;
    v_total_amount NUMERIC(10,2) := 0.00;
    v_result_files JSONB := '[]'::JSONB;
BEGIN
    -- 1. Lock and validate parent order
    SELECT * INTO v_order
    FROM public.orders
    WHERE id = p_order_id
    FOR UPDATE;

    IF v_order.id IS NULL THEN
        RAISE EXCEPTION 'Order % not found', p_order_id;
    END IF;

    IF v_order.status != 'DRAFT' THEN
        RAISE EXCEPTION 'Order % is not in DRAFT status (current status: %)', p_order_id, v_order.status;
    END IF;

    IF v_order.payment_status != 'UNPAID' THEN
        RAISE EXCEPTION 'Order % has payment_status %; only UNPAID orders can be quoted', p_order_id, v_order.payment_status;
    END IF;

    IF v_order.expires_at <= now() THEN
        RAISE EXCEPTION 'Order % has expired at %', p_order_id, v_order.expires_at;
    END IF;

    -- 2. Authoritative live shop verification
    SELECT status, closing_soon, closing_message INTO v_shop
    FROM public.shops
    WHERE id = v_order.shop_id;

    IF v_shop.status IS NULL THEN
        RAISE EXCEPTION 'Shop for order % not found', p_order_id;
    END IF;

    IF v_shop.status != 'OPEN' THEN
        RAISE EXCEPTION 'Shop is currently CLOSED and cannot accept print orders';
    END IF;

    IF v_shop.closing_soon THEN
        RAISE EXCEPTION 'Shop is closing soon and is not accepting new orders right now';
    END IF;

    -- 3. Exact File Set Validation
    v_payload_count := jsonb_array_length(p_files);

    IF v_payload_count = 0 THEN
        RAISE EXCEPTION 'Pricing payload cannot be empty';
    END IF;

    -- Check for duplicate order_file_ids in payload
    SELECT COUNT(DISTINCT (elem->>'order_file_id')::UUID)
    INTO v_unique_payload_file_count
    FROM jsonb_array_elements(p_files) AS elem;

    IF v_unique_payload_file_count != v_payload_count THEN
        RAISE EXCEPTION 'Duplicate order_file_id found in pricing payload';
    END IF;

    -- Check database file count for this order
    SELECT COUNT(*) INTO v_db_file_count
    FROM public.order_files
    WHERE order_id = p_order_id;

    IF v_db_file_count = 0 THEN
        RAISE EXCEPTION 'Order % has no files attached', p_order_id;
    END IF;

    IF v_db_file_count != v_payload_count THEN
        RAISE EXCEPTION 'Payload file count (%) does not match order file count (%) for order %',
            v_payload_count, v_db_file_count, p_order_id;
    END IF;

    -- Verify every payload file belongs to this order (no foreign or extra files)
    IF EXISTS (
        SELECT 1
        FROM jsonb_array_elements(p_files) AS elem
        WHERE (elem->>'order_file_id')::UUID NOT IN (
            SELECT id FROM public.order_files WHERE order_id = p_order_id
        )
    ) THEN
        RAISE EXCEPTION 'Pricing payload contains files that do not belong to order %', p_order_id;
    END IF;

    -- 4. Process each file with race protection and data validation
    FOR v_file_elem IN SELECT * FROM jsonb_array_elements(p_files)
    LOOP
        SELECT id, original_filename INTO v_file
        FROM public.order_files
        WHERE id = (v_file_elem->>'order_file_id')::UUID
          AND order_id = p_order_id;

        -- Validate numerical bounds
        IF (v_file_elem->>'original_pages') IS NULL OR (v_file_elem->>'original_pages')::INTEGER < 1 THEN
            RAISE EXCEPTION 'original_pages must be an integer >= 1 for file %', v_file.id;
        END IF;

        IF (v_file_elem->>'printable_pages') IS NULL OR (v_file_elem->>'printable_pages')::INTEGER < 1 THEN
            RAISE EXCEPTION 'printable_pages must be an integer >= 1 for file %', v_file.id;
        END IF;

        IF (v_file_elem->>'physical_sheets') IS NULL OR (v_file_elem->>'physical_sheets')::INTEGER < 1 THEN
            RAISE EXCEPTION 'physical_sheets must be an integer >= 1 for file %', v_file.id;
        END IF;

        -- 4A. Settings Race Protection: compare current DB settings with calculation settings
        SELECT * INTO v_curr_settings
        FROM public.print_settings
        WHERE order_file_id = v_file.id;

        IF v_curr_settings.id IS NULL THEN
            RAISE EXCEPTION 'Print settings missing for file %', v_file.id;
        END IF;

        IF v_curr_settings.colour_mode IS DISTINCT FROM (v_file_elem->'expected_settings'->>'colour_mode')
           OR v_curr_settings.sides IS DISTINCT FROM (v_file_elem->'expected_settings'->>'sides')
           OR v_curr_settings.orientation IS DISTINCT FROM (v_file_elem->'expected_settings'->>'orientation')
           OR v_curr_settings.copies IS DISTINCT FROM (v_file_elem->'expected_settings'->>'copies')::INTEGER
           OR v_curr_settings.pages_per_sheet IS DISTINCT FROM (v_file_elem->'expected_settings'->>'pages_per_sheet')::INTEGER
           OR v_curr_settings.paper_size IS DISTINCT FROM (v_file_elem->'expected_settings'->>'paper_size')
           OR v_curr_settings.margin IS DISTINCT FROM (v_file_elem->'expected_settings'->>'margin')
           OR v_curr_settings.page_selection IS DISTINCT FROM (v_file_elem->'expected_settings'->>'page_selection')
           OR v_curr_settings.page_range IS DISTINCT FROM (v_file_elem->'expected_settings'->>'page_range')
           OR v_curr_settings.scale IS DISTINCT FROM (v_file_elem->'expected_settings'->>'scale')
        THEN
            RAISE EXCEPTION 'Print settings changed while pricing. Please calculate again.';
        END IF;

        -- 4B. Shop Price Race Protection: re-read active shop_pricing for current configuration
        SELECT price_per_sheet INTO v_current_price
        FROM public.shop_pricing
        WHERE shop_id = v_order.shop_id
          AND paper_size = v_curr_settings.paper_size
          AND print_mode = v_curr_settings.colour_mode
          AND sides = v_curr_settings.sides
          AND active = true;

        IF v_current_price IS NULL THEN
            RAISE EXCEPTION 'This print configuration is not currently priced by the shop';
        END IF;

        IF v_current_price != (v_file_elem->>'expected_unit_price')::NUMERIC(10,2) THEN
            RAISE EXCEPTION 'Shop pricing changed while calculating quote. Please recalculate.';
        END IF;

        -- Compute line total authoritatively in database
        v_line_total := ROUND((v_file_elem->>'physical_sheets')::INTEGER * v_current_price, 2);

        -- Apply verified snapshots to order_files
        UPDATE public.order_files
        SET original_pages = (v_file_elem->>'original_pages')::INTEGER,
            printable_pages = (v_file_elem->>'printable_pages')::INTEGER,
            physical_sheets = (v_file_elem->>'physical_sheets')::INTEGER,
            unit_price = v_current_price,
            line_total = v_line_total,
            updated_at = now()
        WHERE id = v_file.id;
    END LOOP;

    -- 5. Calculate authoritative order totals from updated order_files
    SELECT
        COALESCE(SUM(original_pages), 0),
        COALESCE(SUM(printable_pages), 0),
        COALESCE(SUM(physical_sheets), 0),
        COALESCE(SUM(line_total), 0.00)
    INTO
        v_total_original_pages,
        v_total_printable_pages,
        v_total_sheets,
        v_total_amount
    FROM public.order_files
    WHERE order_id = p_order_id;

    -- 6. Update parent orders totals (strictly preserves DRAFT and UNPAID status)
    UPDATE public.orders
    SET total_original_pages = v_total_original_pages,
        total_printable_pages = v_total_printable_pages,
        total_sheets = v_total_sheets,
        total_amount = v_total_amount,
        updated_at = now()
    WHERE id = p_order_id;

    -- 7. Build and return result summary
    SELECT jsonb_agg(
        jsonb_build_object(
            'orderFileId', f.id,
            'originalFilename', f.original_filename,
            'originalPages', f.original_pages,
            'printablePages', f.printable_pages,
            'physicalSheets', f.physical_sheets,
            'unitPrice', f.unit_price,
            'lineTotal', f.line_total
        )
    ) INTO v_result_files
    FROM public.order_files f
    WHERE f.order_id = p_order_id;

    RETURN jsonb_build_object(
        'orderId', v_order.id,
        'orderNumber', v_order.order_number,
        'status', v_order.status,
        'paymentStatus', v_order.payment_status,
        'totalOriginalPages', v_total_original_pages,
        'totalPrintablePages', v_total_printable_pages,
        'totalSheets', v_total_sheets,
        'totalAmount', v_total_amount,
        'files', v_result_files
    );
END;
$$;

-- Security & Permissions:
-- Strictly revoke execution from PUBLIC, anon, and authenticated clients.
-- Only the server-side service_role key can execute this function.
REVOKE EXECUTE ON FUNCTION public.apply_verified_order_pricing(UUID, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.apply_verified_order_pricing(UUID, JSONB) FROM anon;
REVOKE EXECUTE ON FUNCTION public.apply_verified_order_pricing(UUID, JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.apply_verified_order_pricing(UUID, JSONB) TO service_role;

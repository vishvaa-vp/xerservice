-- =============================================================
-- Migration: Stage A7 Support Tickets and Messages System
-- Tables: public.support_tickets, public.support_messages
-- Purpose:
--   1. Authoritative persistence for customer/vendor support issues,
--      contact inquiries, and order disputes.
--   2. Enforces strict privacy: internal admin notes cannot be accessed
--      by customers or vendors.
--   3. Auto-generates human-readable sequential ticket numbers (TICK-1001).
--   4. Links tickets to user profiles, shops, and orders.
-- =============================================================

-- 1. Sequence for human-readable ticket numbers
CREATE SEQUENCE IF NOT EXISTS public.support_ticket_seq START 1001;

-- 2. Create support_tickets table
CREATE TABLE IF NOT EXISTS public.support_tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_number TEXT UNIQUE NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('contact_form', 'order_issue', 'customer_portal', 'vendor_portal', 'system')),
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    customer_name TEXT NOT NULL,
    customer_email TEXT,
    customer_phone TEXT,
    subject TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'waiting', 'resolved', 'closed')),
    priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    shop_id UUID REFERENCES public.shops(id) ON DELETE SET NULL,
    order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
    assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at TIMESTAMPTZ
);

-- 3. Create support_messages table
CREATE TABLE IF NOT EXISTS public.support_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id UUID NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
    sender_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    sender_role TEXT NOT NULL CHECK (sender_role IN ('customer', 'vendor', 'admin', 'system')),
    sender_name TEXT NOT NULL,
    message TEXT NOT NULL,
    is_internal_note BOOLEAN NOT NULL DEFAULT false,
    attachments JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. Automatic ticket number and timestamp triggers
CREATE OR REPLACE FUNCTION public.set_support_ticket_defaults()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.ticket_number IS NULL OR trim(NEW.ticket_number) = '' THEN
        NEW.ticket_number := 'TICK-' || nextval('public.support_ticket_seq')::text;
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_support_ticket_defaults ON public.support_tickets;
CREATE TRIGGER trg_support_ticket_defaults
    BEFORE INSERT OR UPDATE ON public.support_tickets
    FOR EACH ROW
    EXECUTE FUNCTION public.set_support_ticket_defaults();

-- 5. Indexes for fast filtering
CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON public.support_tickets(status);
CREATE INDEX IF NOT EXISTS idx_support_tickets_user_id ON public.support_tickets(user_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_shop_id ON public.support_tickets(shop_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_order_id ON public.support_tickets(order_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_created_at ON public.support_tickets(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_messages_ticket_id ON public.support_messages(ticket_id);
CREATE INDEX IF NOT EXISTS idx_support_messages_created_at ON public.support_messages(created_at ASC);

-- 6. Row Level Security (RLS)
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;

-- Admins: Full access through service role or admin profile
DROP POLICY IF EXISTS "Admins have full access to support tickets" ON public.support_tickets;
CREATE POLICY "Admins have full access to support tickets"
    ON public.support_tickets
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE profiles.user_id = auth.uid() AND profiles.role = 'admin'
        )
    );

DROP POLICY IF EXISTS "Admins have full access to support messages" ON public.support_messages;
CREATE POLICY "Admins have full access to support messages"
    ON public.support_messages
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE profiles.user_id = auth.uid() AND profiles.role = 'admin'
        )
    );

-- Customers: View own tickets
DROP POLICY IF EXISTS "Customers can view their own tickets" ON public.support_tickets;
CREATE POLICY "Customers can view their own tickets"
    ON public.support_tickets
    FOR SELECT
    TO authenticated
    USING (user_id = auth.uid());

-- Customers: View public messages on own tickets (Internal notes strictly excluded)
DROP POLICY IF EXISTS "Customers can view public messages on their tickets" ON public.support_messages;
CREATE POLICY "Customers can view public messages on their tickets"
    ON public.support_messages
    FOR SELECT
    TO authenticated
    USING (
        is_internal_note = false AND
        EXISTS (
            SELECT 1 FROM public.support_tickets
            WHERE support_tickets.id = support_messages.ticket_id
            AND support_tickets.user_id = auth.uid()
        )
    );

-- Customers: Insert public messages on own tickets
DROP POLICY IF EXISTS "Customers can reply to their tickets" ON public.support_messages;
CREATE POLICY "Customers can reply to their tickets"
    ON public.support_messages
    FOR INSERT
    TO authenticated
    WITH CHECK (
        is_internal_note = false AND
        EXISTS (
            SELECT 1 FROM public.support_tickets
            WHERE support_tickets.id = support_messages.ticket_id
            AND support_tickets.user_id = auth.uid()
        )
    );

-- Vendors: View tickets assigned to their shop
DROP POLICY IF EXISTS "Vendors can view tickets for their shops" ON public.support_tickets;
CREATE POLICY "Vendors can view tickets for their shops"
    ON public.support_tickets
    FOR SELECT
    TO authenticated
    USING (
        shop_id IS NOT NULL AND
        EXISTS (
            SELECT 1 FROM public.shops
            WHERE shops.id = support_tickets.shop_id
            AND shops.owner_id = auth.uid()
        )
    );

-- Vendors: View public messages for their shop tickets
DROP POLICY IF EXISTS "Vendors can view public messages on their shop tickets" ON public.support_messages;
CREATE POLICY "Vendors can view public messages on their shop tickets"
    ON public.support_messages
    FOR SELECT
    TO authenticated
    USING (
        is_internal_note = false AND
        EXISTS (
            SELECT 1 FROM public.support_tickets
            JOIN public.shops ON shops.id = support_tickets.shop_id
            WHERE support_tickets.id = support_messages.ticket_id
            AND shops.owner_id = auth.uid()
        )
    );

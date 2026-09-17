export type SupportTicketSource =
    | 'contact_form'
    | 'order_issue'
    | 'customer_portal'
    | 'vendor_portal'
    | 'system';

export type SupportTicketStatus = 'open' | 'waiting' | 'resolved' | 'closed';

export type SupportTicketPriority = 'low' | 'normal' | 'high' | 'urgent';

export type SupportSenderRole = 'customer' | 'vendor' | 'admin' | 'system';

export interface SupportAttachment {
    name: string;
    url: string;
    size?: number;
    type?: string;
}

export interface SupportTicketRow {
    id: string;
    ticket_number: string;
    source: SupportTicketSource;
    user_id: string | null;
    customer_name: string;
    customer_email: string | null;
    customer_phone: string | null;
    subject: string;
    status: SupportTicketStatus;
    priority: SupportTicketPriority;
    shop_id: string | null;
    order_id: string | null;
    assigned_to: string | null;
    created_at: string;
    updated_at: string;
    resolved_at: string | null;
}

export interface SupportMessageRow {
    id: string;
    ticket_id: string;
    sender_id: string | null;
    sender_role: SupportSenderRole;
    sender_name: string;
    message: string;
    is_internal_note: boolean;
    attachments: SupportAttachment[];
    created_at: string;
}

export interface CreateTicketInput {
    source: SupportTicketSource;
    userId?: string | null;
    customerName: string;
    customerEmail?: string | null;
    customerPhone?: string | null;
    subject: string;
    message: string;
    priority?: SupportTicketPriority;
    shopId?: string | null;
    orderId?: string | null;
    attachments?: SupportAttachment[];
}

export interface SupportTicketSummary {
    total: number;
    open: number;
    waiting: number;
    resolved: number;
    urgent: number;
}

export interface EnrichedSupportTicket extends SupportTicketRow {
    shop_name?: string | null;
    order_number?: string | null;
    order_total?: number | null;
    order_status?: string | null;
    requester_role?: string | null;
    assigned_to_name?: string | null;
    messages_count?: number;
    last_message?: {
        message: string;
        sender_name: string;
        sender_role: SupportSenderRole;
        is_internal_note: boolean;
        created_at: string;
    } | null;
}

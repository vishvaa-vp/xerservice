/**
 * XerService Backend — Stage A7: Support Service
 *
 * Provides authoritative persistence and business logic for support tickets,
 * contact messages, and order issues:
 * 1. Sequential human-readable ticket numbers (TICK-1001).
 * 2. Strict privacy: admin-only internal notes are NEVER exposed to customers/vendors.
 * 3. Enriched order and shop context linking.
 * 4. Fault-tolerant message handling (tickets persist even if notifications fail).
 */

import { getServiceRoleClient } from '../supabase/client';
import {
    CreateTicketInput,
    EnrichedSupportTicket,
    SupportMessageRow,
    SupportTicketPriority,
    SupportTicketRow,
    SupportTicketStatus,
    SupportTicketSummary,
} from './types';

export class SupportServiceError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number = 400) {
        super(message);
        this.name = 'SupportServiceError';
        this.statusCode = statusCode;
    }
}

/**
 * Creates a new support ticket and its initial message.
 */
export async function createTicket(input: CreateTicketInput): Promise<{
    ticket: SupportTicketRow;
    message: SupportMessageRow;
}> {
    const sb = getServiceRoleClient();

    if (!input.customerName || !input.customerName.trim()) {
        throw new SupportServiceError('Customer name is required.');
    }
    if (!input.subject || !input.subject.trim()) {
        throw new SupportServiceError('Subject is required.');
    }
    if (!input.message || !input.message.trim()) {
        throw new SupportServiceError('Message content is required.');
    }

    let resolvedShopId = input.shopId || null;
    let resolvedUserId = input.userId || null;

    // If orderId is provided, enrich shopId and userId if missing
    if (input.orderId) {
        const { data: order } = await sb
            .from('orders')
            .select('id, order_number, shop_id, user_id')
            .eq('id', input.orderId)
            .maybeSingle();

        if (order) {
            if (!resolvedShopId) resolvedShopId = order.shop_id;
            if (!resolvedUserId) resolvedUserId = order.user_id;
        }
    }

    // Insert ticket
    const { data: ticket, error: ticketError } = await sb
        .from('support_tickets')
        .insert({
            source: input.source,
            user_id: resolvedUserId,
            customer_name: input.customerName.trim(),
            customer_email: input.customerEmail ? input.customerEmail.trim() : null,
            customer_phone: input.customerPhone ? input.customerPhone.trim() : null,
            subject: input.subject.trim(),
            status: 'open',
            priority: input.priority || 'normal',
            shop_id: resolvedShopId,
            order_id: input.orderId || null,
        })
        .select('*')
        .single();

    if (ticketError || !ticket) {
        console.error('[SupportService] Failed to insert ticket:', ticketError);
        throw new SupportServiceError(`Failed to create ticket: ${ticketError?.message || 'Unknown database error'}`);
    }

    // Insert initial message
    const { data: initialMessage, error: msgError } = await sb
        .from('support_messages')
        .insert({
            ticket_id: ticket.id,
            sender_id: resolvedUserId,
            sender_role: 'customer',
            sender_name: input.customerName.trim(),
            message: input.message.trim(),
            is_internal_note: false,
            attachments: input.attachments || [],
        })
        .select('*')
        .single();

    if (msgError || !initialMessage) {
        console.error('[SupportService] Failed to insert initial message:', msgError);
        throw new SupportServiceError(`Failed to record ticket message: ${msgError?.message || 'Database error'}`);
    }

    // Safe non-blocking notification trigger
    try {
        await sb.from('notifications').insert({
            user_id: resolvedUserId || 'a7bab4d1-c501-47a3-98b1-80ae7ff240b9', // Authoritative admin
            title: `Support Ticket Created: ${ticket.ticket_number}`,
            message: `Your inquiry "${ticket.subject}" has been received.`,
            type: 'SUPPORT',
            read: false,
        });
    } catch (e) {
        console.warn('[SupportService] Non-blocking notification failure ignored:', e);
    }

    return { ticket, message: initialMessage };
}

/**
 * Retrieves paginated tickets with summary counts for admin operators.
 */
export async function getAdminTicketsList(options: {
    status?: string;
    priority?: string;
    source?: string;
    shopId?: string;
    search?: string;
    page?: number;
    limit?: number;
}): Promise<{
    summary: SupportTicketSummary;
    pagination: {
        page: number;
        limit: number;
        totalCount: number;
        totalPages: number;
    };
    tickets: EnrichedSupportTicket[];
}> {
    const sb = getServiceRoleClient();
    const page = Math.max(1, options.page || 1);
    const limit = Math.min(100, Math.max(1, options.limit || 25));
    const offset = (page - 1) * limit;

    // 1. Calculate overall summary counts
    const { data: allTickets } = await sb
        .from('support_tickets')
        .select('status, priority');

    const summary: SupportTicketSummary = {
        total: allTickets ? allTickets.length : 0,
        open: 0,
        waiting: 0,
        resolved: 0,
        urgent: 0,
    };

    if (allTickets) {
        for (const t of allTickets) {
            if (t.status === 'open') summary.open++;
            else if (t.status === 'waiting') summary.waiting++;
            else if (t.status === 'resolved' || t.status === 'closed') summary.resolved++;

            if (t.priority === 'urgent') summary.urgent++;
        }
    }

    // 2. Query filtered tickets
    let query = sb
        .from('support_tickets')
        .select('*', { count: 'exact' });

    if (options.status && options.status !== 'all') {
        if (options.status === 'resolved') {
            query = query.in('status', ['resolved', 'closed']);
        } else {
            query = query.eq('status', options.status);
        }
    }

    if (options.priority && options.priority !== 'all') {
        query = query.eq('priority', options.priority);
    }

    if (options.source && options.source !== 'all') {
        query = query.eq('source', options.source);
    }

    if (options.shopId && options.shopId !== 'all') {
        query = query.eq('shop_id', options.shopId);
    }

    if (options.search && options.search.trim()) {
        const s = `%${options.search.trim()}%`;
        query = query.or(`subject.ilike.${s},ticket_number.ilike.${s},customer_name.ilike.${s},customer_email.ilike.${s},customer_phone.ilike.${s}`);
    }

    query = query.order('created_at', { ascending: false }).range(offset, offset + limit - 1);

    const { data: tickets, count, error } = await query;
    if (error) {
        throw new SupportServiceError(`Failed to fetch tickets: ${error.message}`);
    }

    const totalCount = count || 0;
    const totalPages = Math.ceil(totalCount / limit) || 1;

    if (!tickets || tickets.length === 0) {
        return {
            summary,
            pagination: { page, limit, totalCount: 0, totalPages: 1 },
            tickets: [],
        };
    }

    // 3. Batch enrich shop names, order numbers, and latest messages
    const shopIds = [...new Set(tickets.map(t => t.shop_id).filter(Boolean))] as string[];
    const orderIds = [...new Set(tickets.map(t => t.order_id).filter(Boolean))] as string[];
    const ticketIds = tickets.map(t => t.id);

    const [shopsRes, ordersRes, messagesRes] = await Promise.all([
        shopIds.length > 0 ? sb.from('shops').select('id, name').in('id', shopIds) : { data: [] },
        orderIds.length > 0 ? sb.from('orders').select('id, order_number, total_amount, status').in('id', orderIds) : { data: [] },
        sb.from('support_messages').select('*').in('ticket_id', ticketIds).order('created_at', { ascending: false }),
    ]);

    const shopMap = new Map((shopsRes.data || []).map(s => [s.id, s.name]));
    const orderMap = new Map((ordersRes.data || []).map(o => [o.id, o]));

    // Group messages by ticket
    const ticketMessagesMap = new Map<string, SupportMessageRow[]>();
    for (const msg of (messagesRes.data || [])) {
        if (!ticketMessagesMap.has(msg.ticket_id)) {
            ticketMessagesMap.set(msg.ticket_id, []);
        }
        ticketMessagesMap.get(msg.ticket_id)!.push(msg as SupportMessageRow);
    }

    const enrichedTickets: EnrichedSupportTicket[] = tickets.map(t => {
        const msgs = ticketMessagesMap.get(t.id) || [];
        const lastMsg = msgs.length > 0 ? msgs[0] : null;
        const ord = t.order_id ? orderMap.get(t.order_id) : null;

        return {
            ...t,
            shop_name: t.shop_id ? shopMap.get(t.shop_id) || null : null,
            order_number: ord ? ord.order_number : null,
            order_total: ord ? ord.total_amount : null,
            order_status: ord ? ord.status : null,
            messages_count: msgs.length,
            last_message: lastMsg ? {
                message: lastMsg.message,
                sender_name: lastMsg.sender_name,
                sender_role: lastMsg.sender_role,
                is_internal_note: lastMsg.is_internal_note,
                created_at: lastMsg.created_at,
            } : null,
        };
    });

    return {
        summary,
        pagination: { page, limit, totalCount, totalPages },
        tickets: enrichedTickets,
    };
}

/**
 * Retrieves full details for a single ticket with order, shop, and message timeline.
 * STRICT PRIVACY INVARIANT: When requester is not 'admin', internal notes are excluded.
 */
export async function getTicketDetail(
    ticketId: string,
    requester: { role: string; userId?: string | null }
): Promise<{
    ticket: SupportTicketRow;
    messages: SupportMessageRow[];
    orderContext?: {
        orderId: string;
        orderNumber: string;
        status: string;
        paymentStatus: string;
        totalAmount: number;
        createdAt: string;
    } | null;
    shopContext?: {
        shopId: string;
        shopName: string;
    } | null;
    requesterContext?: {
        fullName: string;
        email: string | null;
        phone: string | null;
        role: string;
        createdAt: string;
    } | null;
    assignedContext?: {
        fullName: string;
        email: string | null;
    } | null;
}> {
    const sb = getServiceRoleClient();

    const { data: ticket, error: ticketErr } = await sb
        .from('support_tickets')
        .select('*')
        .eq('id', ticketId)
        .maybeSingle();

    if (ticketErr || !ticket) {
        throw new SupportServiceError('Support ticket not found.', 404);
    }

    // RBAC Permissions Check
    if (requester.role === 'customer') {
        if (!requester.userId || ticket.user_id !== requester.userId) {
            throw new SupportServiceError('Unauthorized to view this support ticket.', 403);
        }
    } else if (requester.role === 'vendor') {
        if (!ticket.shop_id) {
            throw new SupportServiceError('Unauthorized to view this support ticket.', 403);
        }
        const { data: shop } = await sb
            .from('shops')
            .select('owner_id')
            .eq('id', ticket.shop_id)
            .maybeSingle();
        if (!shop || shop.owner_id !== requester.userId) {
            throw new SupportServiceError('Unauthorized to view this support ticket.', 403);
        }
    } else if (requester.role !== 'admin') {
        throw new SupportServiceError('Forbidden.', 403);
    }

    // Fetch messages (STRICT PRIVACY: Non-admin users NEVER receive is_internal_note = true)
    let msgQuery = sb
        .from('support_messages')
        .select('*')
        .eq('ticket_id', ticketId)
        .order('created_at', { ascending: true });

    if (requester.role !== 'admin') {
        msgQuery = msgQuery.eq('is_internal_note', false);
    }

    const { data: messages, error: msgErr } = await msgQuery;
    if (msgErr) {
        throw new SupportServiceError(`Failed to fetch messages: ${msgErr.message}`);
    }

    // Context enrichments
    let orderContext = null;
    if (ticket.order_id) {
        const { data: ord } = await sb
            .from('orders')
            .select('id, order_number, status, payment_status, total_amount, created_at')
            .eq('id', ticket.order_id)
            .maybeSingle();
        if (ord) {
            orderContext = {
                orderId: ord.id,
                orderNumber: ord.order_number,
                status: ord.status,
                paymentStatus: ord.payment_status,
                totalAmount: ord.total_amount,
                createdAt: ord.created_at,
            };
        }
    }

    let shopContext = null;
    if (ticket.shop_id) {
        const { data: sh } = await sb
            .from('shops')
            .select('id, name')
            .eq('id', ticket.shop_id)
            .maybeSingle();
        if (sh) {
            shopContext = { shopId: sh.id, shopName: sh.name };
        }
    }

    let requesterContext = null;
    if (ticket.user_id) {
        const { data: prof } = await sb
            .from('profiles')
            .select('full_name, phone, role, created_at')
            .eq('user_id', ticket.user_id)
            .maybeSingle();

        if (prof) {
            requesterContext = {
                fullName: prof.full_name || ticket.customer_name,
                email: ticket.customer_email,
                phone: prof.phone || ticket.customer_phone,
                role: prof.role,
                createdAt: prof.created_at,
            };
        }
    }

    let assignedContext = null;
    if (ticket.assigned_to) {
        const { data: adminProf } = await sb
            .from('profiles')
            .select('full_name')
            .eq('user_id', ticket.assigned_to)
            .maybeSingle();
        if (adminProf) {
            assignedContext = {
                fullName: adminProf.full_name || 'Admin Operator',
                email: null,
            };
        }
    }

    return {
        ticket,
        messages: messages || [],
        orderContext,
        shopContext,
        requesterContext,
        assignedContext,
    };
}

/**
 * Adds a message to an existing ticket.
 */
export async function addTicketMessage(
    ticketId: string,
    input: {
        message: string;
        isInternalNote?: boolean;
        attachments?: any[];
    },
    requester: {
        role: string;
        userId?: string | null;
        name: string;
    }
): Promise<SupportMessageRow> {
    const sb = getServiceRoleClient();

    if (!input.message || !input.message.trim()) {
        throw new SupportServiceError('Message content cannot be blank.');
    }

    const { data: ticket, error: ticketErr } = await sb
        .from('support_tickets')
        .select('*')
        .eq('id', ticketId)
        .maybeSingle();

    if (ticketErr || !ticket) {
        throw new SupportServiceError('Support ticket not found.', 404);
    }

    let isInternal = false;

    if (requester.role === 'admin') {
        isInternal = Boolean(input.isInternalNote);
    } else if (requester.role === 'customer') {
        if (!requester.userId || ticket.user_id !== requester.userId) {
            throw new SupportServiceError('Unauthorized to reply to this ticket.', 403);
        }
        // Customers can NEVER post internal notes
        isInternal = false;
    } else if (requester.role === 'vendor') {
        if (!ticket.shop_id) {
            throw new SupportServiceError('Unauthorized to reply to this ticket.', 403);
        }
        const { data: shop } = await sb
            .from('shops')
            .select('owner_id')
            .eq('id', ticket.shop_id)
            .maybeSingle();
        if (!shop || shop.owner_id !== requester.userId) {
            throw new SupportServiceError('Unauthorized to reply to this ticket.', 403);
        }
        isInternal = false;
    } else {
        throw new SupportServiceError('Forbidden.', 403);
    }

    // Insert message
    const { data: message, error: msgErr } = await sb
        .from('support_messages')
        .insert({
            ticket_id: ticketId,
            sender_id: requester.userId || null,
            sender_role: requester.role,
            sender_name: requester.name,
            message: input.message.trim(),
            is_internal_note: isInternal,
            attachments: input.attachments || [],
        })
        .select('*')
        .single();

    if (msgErr || !message) {
        throw new SupportServiceError(`Failed to save message: ${msgErr?.message || 'Database error'}`);
    }

    // Status transitions
    const ticketUpdates: Record<string, any> = { updated_at: new Date().toISOString() };
    if (requester.role === 'admin' && !isInternal) {
        // Operator replied publicly -> ticket is waiting on customer response
        if (ticket.status === 'open') {
            ticketUpdates.status = 'waiting';
        }
    } else if (requester.role === 'customer') {
        // Customer replied -> operator attention needed
        if (ticket.status === 'waiting' || ticket.status === 'resolved') {
            ticketUpdates.status = 'open';
            ticketUpdates.resolved_at = null;
        }
    }

    await sb.from('support_tickets').update(ticketUpdates).eq('id', ticketId);

    return message;
}

/**
 * Updates status, priority, or operator assignment for a ticket. Admin only.
 */
export async function updateTicketStatus(
    ticketId: string,
    update: {
        status?: SupportTicketStatus;
        priority?: SupportTicketPriority;
        assignedTo?: string | null;
    }
): Promise<SupportTicketRow> {
    const sb = getServiceRoleClient();

    const updates: Record<string, any> = { updated_at: new Date().toISOString() };

    if (update.status) {
        updates.status = update.status;
        if (update.status === 'resolved' || update.status === 'closed') {
            updates.resolved_at = new Date().toISOString();
        } else {
            updates.resolved_at = null;
        }
    }

    if (update.priority) {
        updates.priority = update.priority;
    }

    if (update.assignedTo !== undefined) {
        updates.assigned_to = update.assignedTo;
    }

    const { data: updated, error } = await sb
        .from('support_tickets')
        .update(updates)
        .eq('id', ticketId)
        .select('*')
        .single();

    if (error || !updated) {
        throw new SupportServiceError(`Failed to update ticket: ${error?.message || 'Database error'}`);
    }

    return updated;
}

/**
 * Retrieves tickets submitted by a specific customer.
 */
export async function getCustomerTickets(userId: string): Promise<SupportTicketRow[]> {
    const sb = getServiceRoleClient();

    const { data: tickets, error } = await sb
        .from('support_tickets')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

    if (error) {
        throw new SupportServiceError(`Failed to fetch customer tickets: ${error.message}`);
    }

    return tickets || [];
}

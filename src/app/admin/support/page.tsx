'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
import AdminHeaderNav from '@/components/admin/AdminHeaderNav';
import {
    Search,
    RefreshCw,
    Clock,
    CheckCircle2,
    MessageSquare,
    AlertCircle,
    Inbox,
    Lock,
    Send,
    User,
    ShoppingBag,
    FileText,
    ChevronRight,
    X,
    Filter,
    ArrowUpRight,
    Tag,
    ShieldAlert,
} from 'lucide-react';

interface SupportTicketItem {
    id: string;
    ticket_number: string;
    source: string;
    customer_name: string;
    customer_email?: string | null;
    customer_phone?: string | null;
    subject: string;
    status: 'open' | 'waiting' | 'resolved' | 'closed';
    priority: 'low' | 'normal' | 'high' | 'urgent';
    shop_id?: string | null;
    shop_name?: string | null;
    order_id?: string | null;
    order_number?: string | null;
    order_total?: number | null;
    order_status?: string | null;
    messages_count?: number;
    created_at: string;
    updated_at: string;
    last_message?: {
        message: string;
        sender_name: string;
        sender_role: string;
        is_internal_note: boolean;
        created_at: string;
    } | null;
}

interface MessageItem {
    id: string;
    sender_name: string;
    sender_role: string;
    message: string;
    is_internal_note: boolean;
    created_at: string;
}

interface TicketDetailData {
    ticket: SupportTicketItem;
    messages: MessageItem[];
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
}

export default function AdminSupportPage() {
    const router = useRouter();
    const [loading, setLoading] = useState(true);
    const [authorized, setAuthorized] = useState(false);
    const [sessionToken, setSessionToken] = useState<string | null>(null);

    // Filter states
    const [tickets, setTickets] = useState<SupportTicketItem[]>([]);
    const [summary, setSummary] = useState({ total: 0, open: 0, waiting: 0, resolved: 0, urgent: 0 });
    const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'waiting' | 'resolved'>('all');
    const [priorityFilter, setPriorityFilter] = useState<string>('all');
    const [sourceFilter, setSourceFilter] = useState<string>('all');
    const [search, setSearch] = useState('');
    const [fetchingList, setFetchingList] = useState(false);

    // Selected ticket drawer state
    const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
    const [ticketDetail, setTicketDetail] = useState<TicketDetailData | null>(null);
    const [loadingDetail, setLoadingDetail] = useState(false);
    const [replyText, setReplyText] = useState('');
    const [isInternalNote, setIsInternalNote] = useState(false);
    const [sendingReply, setSendingReply] = useState(false);
    const [updatingStatus, setUpdatingStatus] = useState(false);

    // 1. Verify Admin Session
    useEffect(() => {
        let mounted = true;

        async function verifyAuth() {
            try {
                const { data: { session }, error } = await supabase.auth.getSession();
                if (error || !session?.user) {
                    if (mounted) router.replace('/xad/login?redirect=/admin/support');
                    return;
                }

                const { data: profile, error: profErr } = await supabase
                    .from('profiles')
                    .select('role')
                    .eq('user_id', session.user.id)
                    .maybeSingle();

                if (profErr || !profile || profile.role !== 'admin') {
                    if (mounted) router.replace('/xad/login?redirect=/admin/support');
                    return;
                }

                if (mounted) {
                    setSessionToken(session.access_token);
                    setAuthorized(true);
                    setLoading(false);
                }
            } catch (e) {
                console.error('Support auth error:', e);
                if (mounted) setLoading(false);
            }
        }

        verifyAuth();
        return () => { mounted = false; };
    }, [router]);

    // 2. Fetch Tickets List
    const fetchTickets = useCallback(async () => {
        if (!sessionToken) return;
        setFetchingList(true);
        try {
            const params = new URLSearchParams();
            if (statusFilter !== 'all') params.set('status', statusFilter);
            if (priorityFilter !== 'all') params.set('priority', priorityFilter);
            if (sourceFilter !== 'all') params.set('source', sourceFilter);
            if (search.trim()) params.set('search', search.trim());

            const res = await fetch(`/api/admin/support?${params.toString()}`, {
                headers: { Authorization: `Bearer ${sessionToken}` },
            });
            const data = await res.json();
            if (res.ok && data.success) {
                setTickets(data.tickets || []);
                if (data.summary) setSummary(data.summary);
            }
        } catch (e) {
            console.error('Failed to fetch tickets:', e);
        } finally {
            setFetchingList(false);
        }
    }, [sessionToken, statusFilter, priorityFilter, sourceFilter, search]);

    useEffect(() => {
        if (authorized && sessionToken) {
            fetchTickets();
        }
    }, [authorized, sessionToken, fetchTickets]);

    // 3. Fetch Single Ticket Details for Drawer
    const loadTicketDetail = async (id: string) => {
        if (!sessionToken) return;
        setLoadingDetail(true);
        setSelectedTicketId(id);
        try {
            const res = await fetch(`/api/admin/support/${id}`, {
                headers: { Authorization: `Bearer ${sessionToken}` },
            });
            const data = await res.json();
            if (res.ok && data.success) {
                setTicketDetail(data);
            }
        } catch (e) {
            console.error('Failed to fetch ticket detail:', e);
        } finally {
            setLoadingDetail(false);
        }
    };

    // 4. Send Message or Internal Note
    const handleSendMessage = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!replyText.trim() || !selectedTicketId || !sessionToken) return;

        setSendingReply(true);
        try {
            const res = await fetch(`/api/admin/support/${selectedTicketId}/messages`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${sessionToken}`,
                },
                body: JSON.stringify({
                    message: replyText,
                    isInternalNote,
                }),
            });

            if (res.ok) {
                setReplyText('');
                // Refresh detail
                await loadTicketDetail(selectedTicketId);
                // Refresh list summary
                fetchTickets();
            }
        } catch (e) {
            console.error('Failed to send reply:', e);
        } finally {
            setSendingReply(false);
        }
    };

    // 5. Update Ticket Status or Priority
    const handleUpdateStatus = async (newStatus: 'open' | 'waiting' | 'resolved' | 'closed') => {
        if (!selectedTicketId || !sessionToken) return;
        setUpdatingStatus(true);
        try {
            const res = await fetch(`/api/admin/support/${selectedTicketId}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${sessionToken}`,
                },
                body: JSON.stringify({ status: newStatus }),
            });

            if (res.ok) {
                await loadTicketDetail(selectedTicketId);
                fetchTickets();
            }
        } catch (e) {
            console.error('Failed to update status:', e);
        } finally {
            setUpdatingStatus(false);
        }
    };

    const handleUpdatePriority = async (newPriority: 'low' | 'normal' | 'high' | 'urgent') => {
        if (!selectedTicketId || !sessionToken) return;
        try {
            const res = await fetch(`/api/admin/support/${selectedTicketId}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${sessionToken}`,
                },
                body: JSON.stringify({ priority: newPriority }),
            });

            if (res.ok) {
                await loadTicketDetail(selectedTicketId);
                fetchTickets();
            }
        } catch (e) {
            console.error('Failed to update priority:', e);
        }
    };

    if (loading) {
        return (
            <div style={{ minHeight: '60vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px' }}>
                <span className="spinner spinner-lg" />
                <p style={{ color: 'var(--fg-muted)', fontSize: '14px' }}>Loading support center…</p>
            </div>
        );
    }

    if (!authorized) return null;

    const getStatusBadge = (s: string) => {
        switch (s) {
            case 'open':
                return { bg: 'rgba(59, 130, 246, 0.1)', color: '#3b82f6', label: 'Open' };
            case 'waiting':
                return { bg: 'rgba(234, 179, 8, 0.1)', color: '#eab308', label: 'Waiting' };
            case 'resolved':
                return { bg: 'rgba(34, 197, 94, 0.1)', color: '#22c55e', label: 'Resolved' };
            case 'closed':
                return { bg: 'rgba(107, 114, 128, 0.1)', color: '#6b7280', label: 'Closed' };
            default:
                return { bg: 'rgba(107, 114, 128, 0.1)', color: '#6b7280', label: s };
        }
    };

    const getPriorityBadge = (p: string) => {
        switch (p) {
            case 'urgent':
                return { bg: 'rgba(239, 68, 68, 0.12)', color: '#ef4444', label: 'Urgent' };
            case 'high':
                return { bg: 'rgba(249, 115, 22, 0.12)', color: '#f97316', label: 'High' };
            case 'normal':
                return { bg: 'rgba(59, 130, 246, 0.08)', color: '#3b82f6', label: 'Normal' };
            case 'low':
                return { bg: 'rgba(107, 114, 128, 0.08)', color: '#6b7280', label: 'Low' };
            default:
                return { bg: 'rgba(107, 114, 128, 0.08)', color: '#6b7280', label: p };
        }
    };

    return (
        <div className="container" style={{ maxWidth: '1400px', margin: '0 auto', padding: '24px 16px 64px' }}>
            <AdminHeaderNav
                activeSection="support"
                title="Support"
                badge={`${summary.total} Total`}
                actions={
                    <button
                        onClick={() => fetchTickets()}
                        className="btn btn-outline btn-sm"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}
                        disabled={fetchingList}
                    >
                        <RefreshCw size={12} className={fetchingList ? 'spin' : ''} /> Refresh
                    </button>
                }
            />

            {/* 1. Summary KPI Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '24px' }}>
                <div className="card" style={{ padding: '20px' }}>
                    <div style={{ fontSize: '12px', fontWeight: '700', color: '#3b82f6', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>
                        Open Tickets
                    </div>
                    <div style={{ fontSize: '28px', fontWeight: '900', color: 'var(--fg)' }}>{summary.open}</div>
                    <div style={{ fontSize: '12px', color: 'var(--fg-muted)', marginTop: '4px' }}>Requires operator review</div>
                </div>

                <div className="card" style={{ padding: '20px' }}>
                    <div style={{ fontSize: '12px', fontWeight: '700', color: '#eab308', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>
                        Waiting on Customer
                    </div>
                    <div style={{ fontSize: '28px', fontWeight: '900', color: 'var(--fg)' }}>{summary.waiting}</div>
                    <div style={{ fontSize: '12px', color: 'var(--fg-muted)', marginTop: '4px' }}>Replied, awaiting response</div>
                </div>

                <div className="card" style={{ padding: '20px' }}>
                    <div style={{ fontSize: '12px', fontWeight: '700', color: '#22c55e', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>
                        Resolved
                    </div>
                    <div style={{ fontSize: '28px', fontWeight: '900', color: 'var(--fg)' }}>{summary.resolved}</div>
                    <div style={{ fontSize: '12px', color: 'var(--fg-muted)', marginTop: '4px' }}>Successfully resolved</div>
                </div>

                <div className="card" style={{ padding: '20px' }}>
                    <div style={{ fontSize: '12px', fontWeight: '700', color: '#ef4444', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>
                        Urgent / Escalated
                    </div>
                    <div style={{ fontSize: '28px', fontWeight: '900', color: '#ef4444' }}>{summary.urgent}</div>
                    <div style={{ fontSize: '12px', color: 'var(--fg-muted)', marginTop: '4px' }}>Critical attention needed</div>
                </div>
            </div>

            {/* 2. Filter Tabs & Search Toolbar */}
            <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '16px',
                marginBottom: '20px',
                background: 'var(--bg-card)',
                padding: '16px',
                borderRadius: '12px',
                border: '1px solid var(--border)'
            }}>
                <div style={{ display: 'flex', gap: '8px', background: 'var(--bg-secondary)', padding: '4px', borderRadius: '10px' }}>
                    {(['all', 'open', 'waiting', 'resolved'] as const).map(tab => (
                        <button
                            key={tab}
                            onClick={() => setStatusFilter(tab)}
                            style={{
                                padding: '6px 14px',
                                borderRadius: '8px',
                                fontSize: '12.5px',
                                fontWeight: statusFilter === tab ? '800' : '600',
                                background: statusFilter === tab ? 'var(--bg-card)' : 'transparent',
                                color: statusFilter === tab ? 'var(--fg)' : 'var(--fg-muted)',
                                border: 'none',
                                cursor: 'pointer',
                                textTransform: 'capitalize',
                                transition: 'all 0.15s',
                            }}
                        >
                            {tab}
                        </button>
                    ))}
                </div>

                <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', flex: 1, justifyContent: 'flex-end' }}>
                    {/* Priority Filter */}
                    <select
                        value={priorityFilter}
                        onChange={e => setPriorityFilter(e.target.value)}
                        className="input"
                        style={{ width: 'auto', fontSize: '12.5px', padding: '6px 10px' }}
                    >
                        <option value="all">All Priorities</option>
                        <option value="urgent">Urgent</option>
                        <option value="high">High</option>
                        <option value="normal">Normal</option>
                        <option value="low">Low</option>
                    </select>

                    {/* Source Filter */}
                    <select
                        value={sourceFilter}
                        onChange={e => setSourceFilter(e.target.value)}
                        className="input"
                        style={{ width: 'auto', fontSize: '12.5px', padding: '6px 10px' }}
                    >
                        <option value="all">All Sources</option>
                        <option value="contact_form">Contact Form</option>
                        <option value="order_issue">Order Issue</option>
                        <option value="customer_portal">Customer Portal</option>
                        <option value="vendor_portal">Vendor Portal</option>
                    </select>

                    {/* Search Input */}
                    <div style={{ position: 'relative', minWidth: '240px' }}>
                        <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--fg-muted)' }} />
                        <input
                            type="text"
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            placeholder="Search ticket #, name, order..."
                            className="input"
                            style={{ paddingLeft: '32px', width: '100%', fontSize: '12.5px', height: '36px' }}
                        />
                    </div>
                </div>
            </div>

            {/* 3. Tickets List or Empty State */}
            {tickets.length === 0 ? (
                <div style={{
                    padding: '60px 24px',
                    textAlign: 'center',
                    background: 'var(--bg-card)',
                    borderRadius: '16px',
                    border: '1px solid var(--border)',
                }}>
                    <Inbox size={40} style={{ color: 'var(--accent)', margin: '0 auto 16px', opacity: 0.8 }} />
                    <h3 style={{ fontSize: '18px', fontWeight: '800', color: 'var(--fg)', marginBottom: '6px' }}>
                        No Support Tickets Found
                    </h3>
                    <p style={{ color: 'var(--fg-muted)', fontSize: '13.5px', maxWidth: '440px', margin: '0 auto 20px', lineHeight: '1.5' }}>
                        {search || statusFilter !== 'all' || priorityFilter !== 'all'
                            ? 'No tickets match the selected filters or search terms. Try clearing your filters.'
                            : 'There are currently no support inquiries or order issues recorded.'}
                    </p>
                    {(search || statusFilter !== 'all' || priorityFilter !== 'all' || sourceFilter !== 'all') && (
                        <button
                            onClick={() => { setStatusFilter('all'); setPriorityFilter('all'); setSourceFilter('all'); setSearch(''); }}
                            className="btn btn-outline btn-sm"
                        >
                            Clear All Filters
                        </button>
                    )}
                </div>
            ) : (
                <div className="card" style={{ padding: '0', overflow: 'hidden' }}>
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)', color: 'var(--fg-subtle)', fontWeight: '700', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                    <th style={{ padding: '14px 16px' }}>Ticket</th>
                                    <th style={{ padding: '14px 16px' }}>Requester</th>
                                    <th style={{ padding: '14px 16px' }}>Subject</th>
                                    <th style={{ padding: '14px 16px' }}>Status</th>
                                    <th style={{ padding: '14px 16px' }}>Priority</th>
                                    <th style={{ padding: '14px 16px' }}>Context</th>
                                    <th style={{ padding: '14px 16px' }}>Updated</th>
                                    <th style={{ padding: '14px 16px', textAlign: 'right' }}>Action</th>
                                </tr>
                            </thead>
                            <tbody>
                                {tickets.map(t => {
                                    const stBadge = getStatusBadge(t.status);
                                    const prBadge = getPriorityBadge(t.priority);
                                    return (
                                        <tr
                                            key={t.id}
                                            style={{
                                                borderBottom: '1px solid var(--border)',
                                                cursor: 'pointer',
                                                transition: 'background 0.1s',
                                            }}
                                            onClick={() => loadTicketDetail(t.id)}
                                        >
                                            <td style={{ padding: '14px 16px', fontWeight: '800', color: 'var(--accent)' }}>
                                                {t.ticket_number}
                                            </td>
                                            <td style={{ padding: '14px 16px' }}>
                                                <div style={{ fontWeight: '700', color: 'var(--fg)' }}>{t.customer_name}</div>
                                                <div style={{ fontSize: '11.5px', color: 'var(--fg-muted)' }}>{t.customer_email || t.customer_phone || '—'}</div>
                                            </td>
                                            <td style={{ padding: '14px 16px', maxWidth: '300px' }}>
                                                <div style={{ fontWeight: '600', color: 'var(--fg)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                    {t.subject}
                                                </div>
                                                {t.last_message && (
                                                    <div style={{ fontSize: '11.5px', color: 'var(--fg-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: '2px' }}>
                                                        {t.last_message.sender_name}: {t.last_message.message}
                                                    </div>
                                                )}
                                            </td>
                                            <td style={{ padding: '14px 16px' }}>
                                                <span style={{
                                                    padding: '3px 8px',
                                                    borderRadius: '6px',
                                                    fontSize: '11px',
                                                    fontWeight: '700',
                                                    background: stBadge.bg,
                                                    color: stBadge.color,
                                                    textTransform: 'uppercase'
                                                }}>
                                                    {stBadge.label}
                                                </span>
                                            </td>
                                            <td style={{ padding: '14px 16px' }}>
                                                <span style={{
                                                    padding: '3px 8px',
                                                    borderRadius: '6px',
                                                    fontSize: '11px',
                                                    fontWeight: '700',
                                                    background: prBadge.bg,
                                                    color: prBadge.color,
                                                }}>
                                                    {prBadge.label}
                                                </span>
                                            </td>
                                            <td style={{ padding: '14px 16px' }}>
                                                {t.order_number ? (
                                                    <span style={{
                                                        padding: '3px 8px',
                                                        borderRadius: '6px',
                                                        fontSize: '11px',
                                                        fontWeight: '700',
                                                        background: 'var(--bg-secondary)',
                                                        color: 'var(--fg)',
                                                    }}>
                                                        Order #{t.order_number}
                                                    </span>
                                                ) : (
                                                    <span style={{ fontSize: '12px', color: 'var(--fg-subtle)' }}>
                                                        {t.source === 'contact_form' ? 'Contact Form' : 'General'}
                                                    </span>
                                                )}
                                            </td>
                                            <td style={{ padding: '14px 16px', fontSize: '12px', color: 'var(--fg-muted)' }}>
                                                {new Date(t.updated_at).toLocaleDateString('en-IN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                            </td>
                                            <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); loadTicketDetail(t.id); }}
                                                    className="btn btn-outline btn-sm"
                                                    style={{ padding: '4px 10px', fontSize: '12px' }}
                                                >
                                                    Open →
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* 4. Ticket Detail Drawer / Slide-Over */}
            {selectedTicketId && (
                <div style={{
                    position: 'fixed',
                    top: 0,
                    right: 0,
                    bottom: 0,
                    width: '100%',
                    maxWidth: '680px',
                    background: 'var(--bg)',
                    boxShadow: '-8px 0 32px rgba(0, 0, 0, 0.3)',
                    zIndex: 1000,
                    display: 'flex',
                    flexDirection: 'column',
                    borderLeft: '1px solid var(--border)',
                }}>
                    {/* Drawer Header */}
                    <div style={{
                        padding: '16px 24px',
                        borderBottom: '1px solid var(--border)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        background: 'var(--bg-secondary)',
                    }}>
                        <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span style={{ fontSize: '16px', fontWeight: '900', color: 'var(--accent)' }}>
                                    {ticketDetail?.ticket.ticket_number || 'Loading…'}
                                </span>
                                {ticketDetail && (
                                    <span style={{
                                        padding: '2px 8px',
                                        borderRadius: '6px',
                                        fontSize: '11px',
                                        fontWeight: '700',
                                        background: getStatusBadge(ticketDetail.ticket.status).bg,
                                        color: getStatusBadge(ticketDetail.ticket.status).color,
                                        textTransform: 'uppercase'
                                    }}>
                                        {ticketDetail.ticket.status}
                                    </span>
                                )}
                            </div>
                            <h2 style={{ fontSize: '16px', fontWeight: '700', marginTop: '4px', margin: 0 }}>
                                {ticketDetail?.ticket.subject || 'Ticket Details'}
                            </h2>
                        </div>

                        <button
                            onClick={() => { setSelectedTicketId(null); setTicketDetail(null); }}
                            className="btn btn-ghost"
                            style={{ padding: '8px' }}
                        >
                            <X size={20} />
                        </button>
                    </div>

                    {loadingDetail || !ticketDetail ? (
                        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <span className="spinner spinner-lg" />
                        </div>
                    ) : (
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                            {/* Controls Bar */}
                            <div style={{
                                padding: '12px 24px',
                                background: 'var(--bg-card)',
                                borderBottom: '1px solid var(--border)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                flexWrap: 'wrap',
                                gap: '12px',
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <label style={{ fontSize: '12px', fontWeight: '700', color: 'var(--fg-subtle)' }}>Status:</label>
                                    <select
                                        value={ticketDetail.ticket.status}
                                        onChange={(e) => handleUpdateStatus(e.target.value as any)}
                                        disabled={updatingStatus}
                                        className="input"
                                        style={{ padding: '4px 8px', fontSize: '12px', width: 'auto' }}
                                    >
                                        <option value="open">Open</option>
                                        <option value="waiting">Waiting on Customer</option>
                                        <option value="resolved">Resolved</option>
                                        <option value="closed">Closed</option>
                                    </select>
                                </div>

                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <label style={{ fontSize: '12px', fontWeight: '700', color: 'var(--fg-subtle)' }}>Priority:</label>
                                    <select
                                        value={ticketDetail.ticket.priority}
                                        onChange={(e) => handleUpdatePriority(e.target.value as any)}
                                        className="input"
                                        style={{ padding: '4px 8px', fontSize: '12px', width: 'auto' }}
                                    >
                                        <option value="low">Low</option>
                                        <option value="normal">Normal</option>
                                        <option value="high">High</option>
                                        <option value="urgent">Urgent</option>
                                    </select>
                                </div>
                            </div>

                            {/* Context Row */}
                            <div style={{
                                padding: '16px 24px',
                                background: 'var(--bg-secondary)',
                                borderBottom: '1px solid var(--border)',
                                display: 'grid',
                                gridTemplateColumns: ticketDetail.orderContext ? '1fr 1fr' : '1fr',
                                gap: '16px',
                                fontSize: '12.5px',
                            }}>
                                <div>
                                    <div style={{ fontWeight: '700', color: 'var(--fg-subtle)', marginBottom: '4px', textTransform: 'uppercase', fontSize: '10.5px' }}>
                                        Requester Identity
                                    </div>
                                    <div style={{ fontWeight: '800', color: 'var(--fg)' }}>
                                        {ticketDetail.ticket.customer_name}
                                    </div>
                                    <div style={{ color: 'var(--fg-muted)' }}>
                                        {ticketDetail.ticket.customer_email || 'No email provided'}
                                    </div>
                                    {ticketDetail.ticket.customer_phone && (
                                        <div style={{ color: 'var(--fg-muted)' }}>
                                            {ticketDetail.ticket.customer_phone}
                                        </div>
                                    )}
                                </div>

                                {ticketDetail.orderContext && (
                                    <div>
                                        <div style={{ fontWeight: '700', color: 'var(--fg-subtle)', marginBottom: '4px', textTransform: 'uppercase', fontSize: '10.5px' }}>
                                            Linked Order
                                        </div>
                                        <div style={{ fontWeight: '800', color: 'var(--accent)' }}>
                                            #{ticketDetail.orderContext.orderNumber}
                                        </div>
                                        <div style={{ color: 'var(--fg-muted)' }}>
                                            Total: ₹{ticketDetail.orderContext.totalAmount.toFixed(2)} ({ticketDetail.orderContext.paymentStatus})
                                        </div>
                                        <div style={{ color: 'var(--fg-muted)' }}>
                                            Status: {ticketDetail.orderContext.status}
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Conversation Timeline */}
                            <div style={{ flex: 1, overflowY: 'auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                {ticketDetail.messages.map(m => {
                                    const isInternal = m.is_internal_note;
                                    const isAdmin = m.sender_role === 'admin';

                                    if (isInternal) {
                                        return (
                                            <div
                                                key={m.id}
                                                style={{
                                                    padding: '14px 16px',
                                                    borderRadius: '12px',
                                                    background: 'rgba(234, 179, 8, 0.08)',
                                                    border: '1px solid rgba(234, 179, 8, 0.3)',
                                                    fontSize: '13px',
                                                }}
                                            >
                                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: '800', color: '#ca8a04', fontSize: '11.5px' }}>
                                                        <Lock size={12} /> Internal Admin Note (Hidden from Customer)
                                                    </span>
                                                    <span style={{ fontSize: '11px', color: 'var(--fg-muted)' }}>
                                                        {new Date(m.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                                                    </span>
                                                </div>
                                                <div style={{ color: 'var(--fg)', lineHeight: '1.5', whiteSpace: 'pre-wrap' }}>
                                                    {m.message}
                                                </div>
                                                <div style={{ fontSize: '11px', color: 'var(--fg-muted)', marginTop: '6px' }}>
                                                    Added by {m.sender_name}
                                                </div>
                                            </div>
                                        );
                                    }

                                    return (
                                        <div
                                            key={m.id}
                                            style={{
                                                alignSelf: isAdmin ? 'flex-end' : 'flex-start',
                                                maxWidth: '85%',
                                                padding: '14px 16px',
                                                borderRadius: '14px',
                                                background: isAdmin ? 'var(--accent)' : 'var(--bg-card)',
                                                color: isAdmin ? '#fff' : 'var(--fg)',
                                                border: isAdmin ? 'none' : '1px solid var(--border)',
                                                fontSize: '13px',
                                            }}
                                        >
                                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', marginBottom: '4px' }}>
                                                <span style={{ fontWeight: '800', fontSize: '11.5px', opacity: isAdmin ? 0.9 : 0.7 }}>
                                                    {m.sender_name} {isAdmin ? '(Admin)' : ''}
                                                </span>
                                                <span style={{ fontSize: '10.5px', opacity: 0.8 }}>
                                                    {new Date(m.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                                                </span>
                                            </div>
                                            <div style={{ lineHeight: '1.5', whiteSpace: 'pre-wrap' }}>
                                                {m.message}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>

                            {/* Reply Composer */}
                            <div style={{
                                padding: '16px 24px',
                                borderTop: '1px solid var(--border)',
                                background: 'var(--bg-card)',
                            }}>
                                <form onSubmit={handleSendMessage}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '10px' }}>
                                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: '700', cursor: 'pointer' }}>
                                            <input
                                                type="radio"
                                                name="msgType"
                                                checked={!isInternalNote}
                                                onChange={() => setIsInternalNote(false)}
                                            />
                                            Public Reply to Requester
                                        </label>
                                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: '700', cursor: 'pointer', color: '#ca8a04' }}>
                                            <input
                                                type="radio"
                                                name="msgType"
                                                checked={isInternalNote}
                                                onChange={() => setIsInternalNote(true)}
                                            />
                                            <Lock size={12} /> Internal Note (Admin Only)
                                        </label>
                                    </div>

                                    <div style={{ display: 'flex', gap: '10px' }}>
                                        <textarea
                                            value={replyText}
                                            onChange={e => setReplyText(e.target.value)}
                                            placeholder={isInternalNote ? "Write a private operational note (customer will not see this)..." : "Write a response to the customer..."}
                                            rows={2}
                                            className="input"
                                            style={{
                                                flex: 1,
                                                resize: 'none',
                                                fontSize: '13px',
                                                borderColor: isInternalNote ? '#ca8a04' : undefined,
                                            }}
                                            required
                                        />
                                        <button
                                            type="submit"
                                            disabled={sendingReply || !replyText.trim()}
                                            className={isInternalNote ? "btn btn-outline" : "btn btn-accent"}
                                            style={{ alignSelf: 'flex-end', height: '42px', padding: '0 16px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                                        >
                                            {sendingReply ? (
                                                <span className="spinner" />
                                            ) : (
                                                <>
                                                    <Send size={14} />
                                                    {isInternalNote ? 'Save Note' : 'Send'}
                                                </>
                                            )}
                                        </button>
                                    </div>
                                </form>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

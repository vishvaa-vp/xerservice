'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
import {
    ArrowLeft,
    ExternalLink,
    ShoppingBag,
    CreditCard,
    RotateCcw,
    CheckCircle2,
    Clock,
    AlertCircle,
    UserCheck,
    Phone,
    Mail,
    Calendar,
    Copy,
    Check,
    Shield,
    Store,
} from 'lucide-react';

interface OrderItem {
    id: string;
    orderNumber: string;
    shopName: string;
    status: string;
    paymentStatus: string;
    totalAmount: number;
    createdAt: string;
}

interface RefundItem {
    id: string;
    order_id: string;
    amount: number;
    status: string;
    reason: string | null;
    created_at: string;
}

interface CustomerDetail {
    userId: string;
    fullName: string | null;
    email: string | null;
    phone: string | null;
    role: string;
    accountStatus: string;
    accountCategory: 'active' | 'inactive' | 'pending';
    isDisabled: boolean;
    isPending: boolean;
    lastSignInAt: string | null;
    createdAt: string;
    metrics: {
        completedOrders: number;
        paidOrders: number;
        totalOrders: number;
        grossSpend: number;
        refundAmount: number;
        netSpend: number;
    };
    orders: OrderItem[];
    refunds: RefundItem[];
}

export default function CustomerDetailPage() {
    const params = useParams();
    const router = useRouter();
    const customerId = params?.customerId as string;

    const [loading, setLoading] = useState(true);
    const [authorized, setAuthorized] = useState(false);
    const [authError, setAuthError] = useState<string | null>(null);
    const [customer, setCustomer] = useState<CustomerDetail | null>(null);
    const [copiedId, setCopiedId] = useState(false);

    const fetchCustomerDetail = useCallback(async () => {
        if (!customerId) return;
        setLoading(true);
        setAuthError(null);

        try {
            const { data: { session }, error: sessionErr } = await supabase.auth.getSession();
            if (sessionErr || !session?.user) {
                setAuthError('Please sign in with administrator credentials.');
                setAuthorized(false);
                setLoading(false);
                return;
            }

            const { data: profile, error: profErr } = await supabase
                .from('profiles')
                .select('role')
                .eq('user_id', session.user.id)
                .maybeSingle();

            if (profErr || !profile || profile.role !== 'admin') {
                setAuthError('Access restricted: your account does not have admin privileges.');
                setAuthorized(false);
                setLoading(false);
                return;
            }

            setAuthorized(true);

            const res = await fetch(`/api/admin/customers/${customerId}`, {
                headers: { Authorization: `Bearer ${session.access_token}` },
            });

            if (res.ok) {
                const data = await res.json();
                setCustomer(data.customer);
            } else {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.error || 'Failed to load customer profile');
            }
        } catch (err: any) {
            console.error('Error fetching customer detail:', err);
            setAuthError(err.message || 'Error loading customer profile');
        } finally {
            setLoading(false);
        }
    }, [customerId]);

    useEffect(() => {
        fetchCustomerDetail();
    }, [fetchCustomerDetail]);

    const copyUserId = () => {
        if (!customer) return;
        navigator.clipboard.writeText(customer.userId);
        setCopiedId(true);
        setTimeout(() => setCopiedId(false), 2000);
    };

    if (loading) {
        return (
            <div style={{ minHeight: '60vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px' }}>
                <span className="spinner spinner-lg" />
                <p style={{ color: 'var(--fg-muted)', fontSize: '14px' }}>Loading customer records…</p>
            </div>
        );
    }

    if (!authorized) {
        return (
            <div className="container" style={{ maxWidth: '540px', margin: '80px auto', textAlign: 'center', padding: '32px' }}>
                <div style={{ width: '56px', height: '56px', borderRadius: '16px', background: 'rgba(239, 68, 68, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', color: 'var(--error)' }}>
                    <Shield size={28} />
                </div>
                <h2 style={{ fontSize: '20px', fontWeight: '900', color: 'var(--fg)', marginBottom: '8px' }}>
                    Administrator Access Required
                </h2>
                <p style={{ color: 'var(--fg-muted)', fontSize: '13.5px', marginBottom: '24px', lineHeight: '1.5' }}>
                    {authError || 'You must be signed in with an administrator account to view customer accounts.'}
                </p>
                <Link
                    href={`/xad/login?redirect=/admin/customers/${customerId}`}
                    className="btn"
                    style={{ background: 'var(--accent)', color: '#092b31', fontWeight: '800', textDecoration: 'none', padding: '10px 24px' }}
                >
                    Sign In as Administrator →
                </Link>
            </div>
        );
    }

    if (!customer) {
        return (
            <div className="container" style={{ maxWidth: '600px', margin: '80px auto', textAlign: 'center', padding: '32px' }}>
                <div style={{ width: '56px', height: '56px', borderRadius: '16px', background: 'var(--bg-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', color: 'var(--fg-muted)' }}>
                    <AlertCircle size={28} />
                </div>
                <h2 style={{ fontSize: '20px', fontWeight: '900', color: 'var(--fg)', marginBottom: '8px' }}>
                    Customer Not Found
                </h2>
                <p style={{ color: 'var(--fg-muted)', fontSize: '13.5px', marginBottom: '24px', lineHeight: '1.5' }}>
                    The customer account with ID <code style={{ fontSize: '12px' }}>{customerId}</code> could not be found.
                </p>
                <Link
                    href="/admin/customers"
                    className="btn btn-outline"
                    style={{ fontWeight: '700', textDecoration: 'none', padding: '10px 20px' }}
                >
                    ← Back to Customers
                </Link>
            </div>
        );
    }

    const editInPeopleUrl = `/admin/people?search=${encodeURIComponent(customer.phone || customer.email || customer.fullName || customer.userId)}`;

    const statusBadge = {
        active: { label: 'Active', bg: 'rgba(34, 197, 94, 0.12)', color: '#22c55e' },
        pending: { label: 'Pending Activation', bg: 'rgba(245, 158, 11, 0.12)', color: '#f59e0b' },
        inactive: { label: 'Inactive / Suspended', bg: 'rgba(239, 68, 68, 0.12)', color: 'var(--error)' },
    }[customer.accountCategory] || { label: 'Active', bg: 'rgba(34, 197, 94, 0.12)', color: '#22c55e' };

    return (
        <div className="container" style={{ maxWidth: '1400px', margin: '0 auto', padding: '24px 16px 64px' }}>
            {/* Top Breadcrumbs & Action */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
                <Link
                    href="/admin/customers"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: '700', color: 'var(--fg-muted)', textDecoration: 'none' }}
                >
                    <ArrowLeft size={16} /> Back to Customers
                </Link>

                {/* Authoritative Edit In People Action */}
                <Link
                    href={editInPeopleUrl}
                    className="btn"
                    style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        background: 'var(--accent)',
                        color: '#092b31',
                        fontWeight: '800',
                        fontSize: '13px',
                        padding: '8px 18px',
                        textDecoration: 'none',
                        borderRadius: '10px',
                    }}
                >
                    Edit account in People →
                </Link>
            </div>

            {/* Profile Header */}
            <div style={{
                background: 'var(--bg-card)',
                borderRadius: '16px',
                border: '1px solid var(--border)',
                padding: '24px',
                marginBottom: '24px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '16px',
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <div style={{
                        width: '56px',
                        height: '56px',
                        borderRadius: '50%',
                        background: 'rgba(0, 240, 255, 0.1)',
                        border: '2px solid rgba(0, 240, 255, 0.25)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '22px',
                        fontWeight: '900',
                        color: 'var(--accent)',
                    }}>
                        {(customer.fullName || customer.phone || customer.email || 'C').charAt(0).toUpperCase()}
                    </div>
                    <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                            <h1 style={{ fontSize: '22px', fontWeight: '900', margin: 0, color: 'var(--fg)' }}>
                                {customer.fullName || 'Customer Profile'}
                            </h1>
                            <span style={{
                                fontSize: '11px',
                                fontWeight: '800',
                                padding: '3px 9px',
                                borderRadius: '8px',
                                background: statusBadge.bg,
                                color: statusBadge.color,
                            }}>
                                {statusBadge.label}
                            </span>
                            <span style={{
                                fontSize: '11px',
                                fontWeight: '700',
                                padding: '3px 8px',
                                borderRadius: '8px',
                                background: 'rgba(255, 255, 255, 0.06)',
                                color: 'var(--fg-muted)',
                                textTransform: 'uppercase',
                                letterSpacing: '0.04em',
                            }}>
                                {customer.role}
                            </span>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginTop: '6px', fontSize: '12px', color: 'var(--fg-muted)', flexWrap: 'wrap' }}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                ID: <span style={{ fontFamily: 'monospace' }}>{customer.userId.slice(0, 8)}…</span>
                                <button
                                    onClick={copyUserId}
                                    title="Copy full User ID"
                                    style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: '2px', display: 'inline-flex', alignItems: 'center' }}
                                >
                                    {copiedId ? <Check size={12} style={{ color: '#22c55e' }} /> : <Copy size={12} />}
                                </button>
                            </span>
                            <span>•</span>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                <Calendar size={13} /> Joined {new Date(customer.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                            </span>
                        </div>
                    </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <Link
                        href={editInPeopleUrl}
                        className="btn btn-outline btn-sm"
                        style={{ fontSize: '12px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                    >
                        <ExternalLink size={13} /> Manage Credentials
                    </Link>
                </div>
            </div>

            {/* KPI Metric Summary Banner */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                gap: '16px',
                marginBottom: '28px',
            }}>
                <div className="card" style={{ padding: '18px 20px', borderRadius: '14px', background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                    <div style={{ fontSize: '12px', fontWeight: '700', color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <CreditCard size={14} style={{ color: 'var(--accent)' }} /> Net Spend
                    </div>
                    <div style={{ fontSize: '26px', fontWeight: '900', color: 'var(--fg)', marginTop: '8px' }}>
                        ₹{customer.metrics.netSpend.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--fg-muted)', marginTop: '4px' }}>
                        Gross ₹{customer.metrics.grossSpend.toLocaleString('en-IN')} - Refunds ₹{customer.metrics.refundAmount.toLocaleString('en-IN')}
                    </div>
                </div>

                <div className="card" style={{ padding: '18px 20px', borderRadius: '14px', background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                    <div style={{ fontSize: '12px', fontWeight: '700', color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <CheckCircle2 size={14} style={{ color: '#22c55e' }} /> Completed Orders
                    </div>
                    <div style={{ fontSize: '26px', fontWeight: '900', color: 'var(--fg)', marginTop: '8px' }}>
                        {customer.metrics.completedOrders}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--fg-muted)', marginTop: '4px' }}>
                        Out of {customer.metrics.totalOrders} total orders placed
                    </div>
                </div>

                <div className="card" style={{ padding: '18px 20px', borderRadius: '14px', background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                    <div style={{ fontSize: '12px', fontWeight: '700', color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <ShoppingBag size={14} style={{ color: '#38bdf8' }} /> Paid Orders
                    </div>
                    <div style={{ fontSize: '26px', fontWeight: '900', color: 'var(--fg)', marginTop: '8px' }}>
                        {customer.metrics.paidOrders}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--fg-muted)', marginTop: '4px' }}>
                        Successful payment completions
                    </div>
                </div>

                <div className="card" style={{ padding: '18px 20px', borderRadius: '14px', background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                    <div style={{ fontSize: '12px', fontWeight: '700', color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <RotateCcw size={14} style={{ color: customer.metrics.refundAmount > 0 ? 'var(--error)' : 'var(--fg-muted)' }} /> Confirmed Refunds
                    </div>
                    <div style={{ fontSize: '26px', fontWeight: '900', color: customer.metrics.refundAmount > 0 ? 'var(--error)' : 'var(--fg)', marginTop: '8px' }}>
                        ₹{customer.metrics.refundAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--fg-muted)', marginTop: '4px' }}>
                        {customer.refunds.length} total refund request(s)
                    </div>
                </div>
            </div>

            {/* Main Content Layout: Profile Details & Order History */}
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 360px) 1fr', gap: '24px', alignItems: 'start' }}>
                {/* Left Card: Verified Profile & Notice */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <div className="card" style={{ padding: '20px', borderRadius: '16px', background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                        <h3 style={{ fontSize: '15px', fontWeight: '800', margin: '0 0 16px', color: 'var(--fg)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <UserCheck size={16} style={{ color: 'var(--accent)' }} /> Contact & Identity
                        </h3>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', fontSize: '13px' }}>
                            <div>
                                <span style={{ fontSize: '11px', fontWeight: '700', color: 'var(--fg-muted)', textTransform: 'uppercase' }}>Full Name</span>
                                <div style={{ fontWeight: '700', color: 'var(--fg)', marginTop: '2px' }}>
                                    {customer.fullName || 'Not specified'}
                                </div>
                            </div>

                            <div>
                                <span style={{ fontSize: '11px', fontWeight: '700', color: 'var(--fg-muted)', textTransform: 'uppercase' }}>Phone Number</span>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--fg)', marginTop: '2px', fontWeight: '600' }}>
                                    <Phone size={13} style={{ color: 'var(--fg-muted)' }} />
                                    {customer.phone || 'No phone linked'}
                                </div>
                            </div>

                            <div>
                                <span style={{ fontSize: '11px', fontWeight: '700', color: 'var(--fg-muted)', textTransform: 'uppercase' }}>Email Address</span>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--fg)', marginTop: '2px', fontWeight: '600', wordBreak: 'break-all' }}>
                                    <Mail size={13} style={{ color: 'var(--fg-muted)' }} />
                                    {customer.email || 'No email provided'}
                                </div>
                            </div>

                            <div>
                                <span style={{ fontSize: '11px', fontWeight: '700', color: 'var(--fg-muted)', textTransform: 'uppercase' }}>Account State</span>
                                <div style={{ marginTop: '2px' }}>
                                    <span style={{
                                        fontSize: '11px',
                                        fontWeight: '800',
                                        padding: '2px 8px',
                                        borderRadius: '6px',
                                        background: statusBadge.bg,
                                        color: statusBadge.color,
                                    }}>
                                        {statusBadge.label}
                                    </span>
                                </div>
                            </div>

                            <div>
                                <span style={{ fontSize: '11px', fontWeight: '700', color: 'var(--fg-muted)', textTransform: 'uppercase' }}>Last Sign In</span>
                                <div style={{ color: 'var(--fg-muted)', marginTop: '2px' }}>
                                    {customer.lastSignInAt
                                        ? new Date(customer.lastSignInAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
                                        : 'Never signed in'}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Single Point of Truth Banner */}
                    <div style={{
                        padding: '16px',
                        borderRadius: '14px',
                        background: 'rgba(0, 240, 255, 0.05)',
                        border: '1px solid rgba(0, 240, 255, 0.2)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '10px',
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: '800', color: 'var(--accent)' }}>
                            <Shield size={16} /> Authoritative Account Control
                        </div>
                        <p style={{ fontSize: '12px', color: 'var(--fg-muted)', margin: 0, lineHeight: '1.5' }}>
                            Customer accounts are managed centrally in People. To update phone number, assign roles, deactivate accounts, or issue activation links:
                        </p>
                        <Link
                            href={editInPeopleUrl}
                            className="btn btn-sm"
                            style={{
                                background: 'var(--accent)',
                                color: '#092b31',
                                fontWeight: '800',
                                fontSize: '12px',
                                textAlign: 'center',
                                textDecoration: 'none',
                                padding: '8px 12px',
                                borderRadius: '8px',
                                marginTop: '4px',
                            }}
                        >
                            Edit Customer in People →
                        </Link>
                    </div>
                </div>

                {/* Right Column: Orders & Refunds */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                    {/* Orders Table */}
                    <div className="card" style={{ padding: '20px', borderRadius: '16px', background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                            <h3 style={{ fontSize: '16px', fontWeight: '800', margin: 0, color: 'var(--fg)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <ShoppingBag size={16} style={{ color: 'var(--accent)' }} /> Order History
                                <span style={{ fontSize: '12px', fontWeight: '700', color: 'var(--fg-muted)' }}>({customer.orders.length})</span>
                            </h3>
                        </div>

                        {customer.orders.length === 0 ? (
                            <div style={{ padding: '36px 16px', textAlign: 'center', color: 'var(--fg-muted)', fontSize: '13px' }}>
                                No orders have been placed by this customer yet.
                            </div>
                        ) : (
                            <div style={{ overflowX: 'auto' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                                    <thead>
                                        <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left', color: 'var(--fg-muted)', fontSize: '11.5px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                            <th style={{ padding: '10px 12px' }}>Order #</th>
                                            <th style={{ padding: '10px 12px' }}>Shop</th>
                                            <th style={{ padding: '10px 12px' }}>Date</th>
                                            <th style={{ padding: '10px 12px' }}>Fulfillment</th>
                                            <th style={{ padding: '10px 12px' }}>Payment</th>
                                            <th style={{ padding: '10px 12px', textAlign: 'right' }}>Amount</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {customer.orders.map(o => {
                                            const isCompleted = o.status === 'COMPLETED';
                                            const isCancelled = o.status === 'CANCELLED';
                                            const isPaid = o.paymentStatus === 'COMPLETED';

                                            return (
                                                <tr key={o.id} style={{ borderBottom: '1px solid var(--border)', transition: 'background 0.15s' }}>
                                                    <td style={{ padding: '12px', fontWeight: '700', color: 'var(--fg)', fontFamily: 'monospace' }}>
                                                        {o.orderNumber}
                                                    </td>
                                                    <td style={{ padding: '12px', color: 'var(--fg)' }}>
                                                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                                                            <Store size={13} style={{ color: 'var(--fg-muted)' }} />
                                                            {o.shopName}
                                                        </span>
                                                    </td>
                                                    <td style={{ padding: '12px', color: 'var(--fg-muted)', fontSize: '12px' }}>
                                                        {new Date(o.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                                                    </td>
                                                    <td style={{ padding: '12px' }}>
                                                        <span style={{
                                                            fontSize: '11px',
                                                            fontWeight: '700',
                                                            padding: '3px 8px',
                                                            borderRadius: '6px',
                                                            background: isCompleted ? 'rgba(34, 197, 94, 0.12)' : isCancelled ? 'rgba(239, 68, 68, 0.12)' : 'rgba(245, 158, 11, 0.12)',
                                                            color: isCompleted ? '#22c55e' : isCancelled ? 'var(--error)' : '#f59e0b',
                                                        }}>
                                                            {o.status}
                                                        </span>
                                                    </td>
                                                    <td style={{ padding: '12px' }}>
                                                        <span style={{
                                                            fontSize: '11px',
                                                            fontWeight: '700',
                                                            padding: '3px 8px',
                                                            borderRadius: '6px',
                                                            background: isPaid ? 'rgba(34, 197, 94, 0.12)' : 'rgba(245, 158, 11, 0.12)',
                                                            color: isPaid ? '#22c55e' : '#f59e0b',
                                                        }}>
                                                            {o.paymentStatus}
                                                        </span>
                                                    </td>
                                                    <td style={{ padding: '12px', textAlign: 'right', fontWeight: '800', color: 'var(--fg)' }}>
                                                        ₹{o.totalAmount.toFixed(2)}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>

                    {/* Refund History (if any) */}
                    {customer.refunds.length > 0 && (
                        <div className="card" style={{ padding: '20px', borderRadius: '16px', background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                                <h3 style={{ fontSize: '16px', fontWeight: '800', margin: 0, color: 'var(--fg)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <RotateCcw size={16} style={{ color: 'var(--error)' }} /> Refund Records
                                    <span style={{ fontSize: '12px', fontWeight: '700', color: 'var(--fg-muted)' }}>({customer.refunds.length})</span>
                                </h3>
                            </div>

                            <div style={{ overflowX: 'auto' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                                    <thead>
                                        <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left', color: 'var(--fg-muted)', fontSize: '11.5px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                            <th style={{ padding: '10px 12px' }}>Refund ID</th>
                                            <th style={{ padding: '10px 12px' }}>Reason</th>
                                            <th style={{ padding: '10px 12px' }}>Date</th>
                                            <th style={{ padding: '10px 12px' }}>Status</th>
                                            <th style={{ padding: '10px 12px', textAlign: 'right' }}>Amount</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {customer.refunds.map(r => (
                                            <tr key={r.id} style={{ borderBottom: '1px solid var(--border)' }}>
                                                <td style={{ padding: '12px', fontFamily: 'monospace', fontSize: '12px', color: 'var(--fg)' }}>
                                                    {r.id.slice(0, 8)}…
                                                </td>
                                                <td style={{ padding: '12px', color: 'var(--fg-muted)', fontSize: '12px' }}>
                                                    {r.reason || 'No reason specified'}
                                                </td>
                                                <td style={{ padding: '12px', color: 'var(--fg-muted)', fontSize: '12px' }}>
                                                    {new Date(r.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                                                </td>
                                                <td style={{ padding: '12px' }}>
                                                    <span style={{
                                                        fontSize: '11px',
                                                        fontWeight: '700',
                                                        padding: '3px 8px',
                                                        borderRadius: '6px',
                                                        background: r.status === 'SUCCEEDED' ? 'rgba(34, 197, 94, 0.12)' : 'rgba(239, 68, 68, 0.12)',
                                                        color: r.status === 'SUCCEEDED' ? '#22c55e' : 'var(--error)',
                                                    }}>
                                                        {r.status}
                                                    </span>
                                                </td>
                                                <td style={{ padding: '12px', textAlign: 'right', fontWeight: '800', color: 'var(--error)' }}>
                                                    ₹{Number(r.amount).toFixed(2)}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
import {
    Users,
    UserCheck,
    Store,
    TrendingUp,
    Landmark,
    LifeBuoy,
    AlertTriangle,
    Clock,
    RefreshCw,
    Shield,
    ArrowUpRight,
} from 'lucide-react';

interface FinanceSummary {
    commissionConfigured: boolean;
    grossSales: number;
    platformCommission: number | null;
    vendorEarnings: number | null;
    payableAmount: number | null;
    settledAmount: number;
    pendingAmount: number | null;
    reversedAmount: number;
    unconfiguredOrdersCount: number;
    totalOrdersCount: number;
    totalShopsCount: number;
    settlementBatchesCount: number;
}

export default function AdminDashboardPage() {
    const router = useRouter();
    const [loading, setLoading] = useState(true);
    const [authorized, setAuthorized] = useState(false);
    const [financeSummary, setFinanceSummary] = useState<FinanceSummary | null>(null);
    const [userCount, setUserCount] = useState<number>(0);
    const [lastUpdated, setLastUpdated] = useState<string>('');


    useEffect(() => {
        let mounted = true;

        async function verifyAndLoad() {
            try {
                const { data: { session }, error: sessionErr } = await supabase.auth.getSession();
                if (sessionErr || !session?.user) {
                    if (mounted) router.replace('/xad/login?redirect=/admin/dashboard');
                    return;
                }

                const { data: profile, error: profileErr } = await supabase
                    .from('profiles')
                    .select('role')
                    .eq('user_id', session.user.id)
                    .maybeSingle();

                if (profileErr || !profile || profile.role !== 'admin') {
                    if (mounted) router.replace('/xad/login?redirect=/admin/dashboard');
                    return;
                }

                if (!mounted) return;
                setAuthorized(true);

                // Fetch real finance summary
                try {
                    const token = session.access_token;
                    const res = await fetch('/api/admin/finance/summary', {
                        headers: { Authorization: `Bearer ${token}` },
                    });
                    if (res.ok) {
                        const data = await res.json();
                        if (mounted) setFinanceSummary(data);
                    }
                } catch (e) {
                    console.error('Failed to load finance summary:', e);
                }

                // Fetch real user count
                try {
                    const token = session.access_token;
                    const res = await fetch('/api/admin/users', {
                        headers: { Authorization: `Bearer ${token}` },
                    });
                    if (res.ok) {
                        const data = await res.json();
                        if (mounted && data.summary) {
                            setUserCount(data.summary.totalUsers || data.users?.length || 0);
                        }
                    }
                } catch (e) {
                    console.error('Failed to load user count:', e);
                }

                if (mounted) {
                    setLastUpdated(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
                    setLoading(false);
                }
            } catch (err) {
                console.error('Dashboard init error:', err);
                if (mounted) setLoading(false);
            }
        }

        verifyAndLoad();
        return () => { mounted = false; };
    }, [router]);

    if (loading) {
        return (
            <div style={{ minHeight: '60vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px' }}>
                <span className="spinner spinner-lg" />
                <p style={{ color: 'var(--fg-muted)', fontSize: '14px' }}>Loading operational dashboard…</p>
            </div>
        );
    }

    if (!authorized) return null;

    return (
        <div className="container" style={{ maxWidth: '1400px', margin: '0 auto', padding: '24px 16px 64px' }}>
            {/* Header with Environment & Update Badge */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px', marginBottom: '28px' }}>
                <div>
                    <h1 style={{ fontSize: '26px', fontWeight: '900', letterSpacing: '-0.03em', margin: 0, color: 'var(--fg)' }}>
                        Admin Dashboard
                    </h1>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    {lastUpdated && (
                        <span style={{ fontSize: '12px', color: 'var(--fg-muted)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                            <Clock size={13} /> Updated at {lastUpdated}
                        </span>
                    )}
                    <button
                        onClick={() => window.location.reload()}
                        className="btn btn-outline btn-sm"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: '700' }}
                    >
                        <RefreshCw size={12} /> Refresh
                    </button>
                </div>
            </div>

            {/* Attention Alerts / Operational Checklist */}
            {financeSummary && financeSummary.unconfiguredOrdersCount > 0 && (
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '14px 18px',
                    borderRadius: '12px',
                    background: 'rgba(239, 68, 68, 0.08)',
                    border: '1px solid rgba(239, 68, 68, 0.25)',
                    marginBottom: '24px',
                    gap: '12px',
                    flexWrap: 'wrap',
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <AlertTriangle size={18} style={{ color: 'var(--error)' }} />
                        <span style={{ fontSize: '13.5px', fontWeight: '700', color: 'var(--fg)' }}>
                            {financeSummary.unconfiguredOrdersCount} order(s) require commission configuration before settlement.
                        </span>
                    </div>
                    <Link
                        href="/admin/settlements"
                        className="btn btn-sm"
                        style={{ fontSize: '12px', fontWeight: '800', background: 'var(--accent)', color: '#092b31', textDecoration: 'none' }}
                    >
                        Review Settlements →
                    </Link>
                </div>
            )}

            {/* 6 Core Canonical Entry Cards */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                gap: '16px',
                marginBottom: '32px'
            }}>
                {/* 1. People */}
                <Link href="/admin/people" style={{ textDecoration: 'none', color: 'inherit' }}>
                    <div className="card" style={{
                        padding: '20px',
                        borderRadius: '14px',
                        background: 'var(--bg-card)',
                        border: '1px solid var(--border)',
                        height: '100%',
                        transition: 'transform 0.15s, border-color 0.15s',
                        cursor: 'pointer',
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '14px' }}>
                            <div style={{ width: '38px', height: '38px', borderRadius: '10px', background: 'var(--accent-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)' }}>
                                <Users size={20} />
                            </div>
                            <ArrowUpRight size={16} style={{ color: 'var(--fg-muted)' }} />
                        </div>
                        <div style={{ fontSize: '28px', fontWeight: '900', letterSpacing: '-0.02em', color: 'var(--fg)' }}>
                            {userCount || '—'}
                        </div>
                        <div style={{ fontSize: '14px', fontWeight: '800', marginTop: '2px', color: 'var(--fg)' }}>
                            People
                        </div>
                        <div style={{ fontSize: '12.5px', color: 'var(--fg-muted)', marginTop: '4px' }}>
                            Account creation, roles, access suspension, and shop assignment.
                        </div>
                    </div>
                </Link>

                {/* 2. Customers */}
                <Link href="/admin/customers" style={{ textDecoration: 'none', color: 'inherit' }}>
                    <div className="card" style={{
                        padding: '20px',
                        borderRadius: '14px',
                        background: 'var(--bg-card)',
                        border: '1px solid var(--border)',
                        height: '100%',
                        transition: 'transform 0.15s, border-color 0.15s',
                        cursor: 'pointer',
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '14px' }}>
                            <div style={{ width: '38px', height: '38px', borderRadius: '10px', background: 'rgba(59, 130, 246, 0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#3b82f6' }}>
                                <UserCheck size={20} />
                            </div>
                            <ArrowUpRight size={16} style={{ color: 'var(--fg-muted)' }} />
                        </div>
                        <div style={{ fontSize: '28px', fontWeight: '900', letterSpacing: '-0.02em', color: 'var(--fg)' }}>
                            Summaries
                        </div>
                        <div style={{ fontSize: '14px', fontWeight: '800', marginTop: '2px', color: 'var(--fg)' }}>
                            Customers
                        </div>
                        <div style={{ fontSize: '12.5px', color: 'var(--fg-muted)', marginTop: '4px' }}>
                            Read-only customer summaries, completed orders, and net spend.
                        </div>
                    </div>
                </Link>

                {/* 3. Vendors */}
                <Link href="/admin/vendors" style={{ textDecoration: 'none', color: 'inherit' }}>
                    <div className="card" style={{
                        padding: '20px',
                        borderRadius: '14px',
                        background: 'var(--bg-card)',
                        border: '1px solid var(--border)',
                        height: '100%',
                        transition: 'transform 0.15s, border-color 0.15s',
                        cursor: 'pointer',
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '14px' }}>
                            <div style={{ width: '38px', height: '38px', borderRadius: '10px', background: 'rgba(168, 85, 247, 0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#a855f7' }}>
                                <Store size={20} />
                            </div>
                            <ArrowUpRight size={16} style={{ color: 'var(--fg-muted)' }} />
                        </div>
                        <div style={{ fontSize: '28px', fontWeight: '900', letterSpacing: '-0.02em', color: 'var(--fg)' }}>
                            {financeSummary?.totalShopsCount ?? '—'}
                        </div>
                        <div style={{ fontSize: '14px', fontWeight: '800', marginTop: '2px', color: 'var(--fg)' }}>
                            Vendors & Shops
                        </div>
                        <div style={{ fontSize: '12.5px', color: 'var(--fg-muted)', marginTop: '4px' }}>
                            Shop workspace, capability rates, add-on finishing, and profile hours.
                        </div>
                    </div>
                </Link>

                {/* 4. Earnings */}
                <Link href="/admin/earnings" style={{ textDecoration: 'none', color: 'inherit' }}>
                    <div className="card" style={{
                        padding: '20px',
                        borderRadius: '14px',
                        background: 'var(--bg-card)',
                        border: '1px solid var(--border)',
                        height: '100%',
                        transition: 'transform 0.15s, border-color 0.15s',
                        cursor: 'pointer',
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '14px' }}>
                            <div style={{ width: '38px', height: '38px', borderRadius: '10px', background: 'rgba(34, 197, 94, 0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#22c55e' }}>
                                <TrendingUp size={20} />
                            </div>
                            <ArrowUpRight size={16} style={{ color: 'var(--fg-muted)' }} />
                        </div>
                        <div style={{ fontSize: '28px', fontWeight: '900', letterSpacing: '-0.02em', color: 'var(--fg)' }}>
                            ₹{financeSummary ? (financeSummary.platformCommission ?? 0).toFixed(2) : '0.00'}
                        </div>
                        <div style={{ fontSize: '14px', fontWeight: '800', marginTop: '2px', color: 'var(--fg)' }}>
                            XerService Earnings
                        </div>
                        <div style={{ fontSize: '12.5px', color: 'var(--fg-muted)', marginTop: '4px' }}>
                            Platform commissions, gross revenue trends, and period comparisons.
                        </div>
                    </div>
                </Link>

                {/* 5. Settlements */}
                <Link href="/admin/settlements" style={{ textDecoration: 'none', color: 'inherit' }}>
                    <div className="card" style={{
                        padding: '20px',
                        borderRadius: '14px',
                        background: 'var(--bg-card)',
                        border: '1px solid var(--border)',
                        height: '100%',
                        transition: 'transform 0.15s, border-color 0.15s',
                        cursor: 'pointer',
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '14px' }}>
                            <div style={{ width: '38px', height: '38px', borderRadius: '10px', background: 'rgba(234, 179, 8, 0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#eab308' }}>
                                <Landmark size={20} />
                            </div>
                            <ArrowUpRight size={16} style={{ color: 'var(--fg-muted)' }} />
                        </div>
                        <div style={{ fontSize: '28px', fontWeight: '900', letterSpacing: '-0.02em', color: 'var(--fg)' }}>
                            ₹{financeSummary ? (financeSummary.payableAmount ?? 0).toFixed(2) : '0.00'}
                        </div>
                        <div style={{ fontSize: '14px', fontWeight: '800', marginTop: '2px', color: 'var(--fg)' }}>
                            Settlements
                        </div>
                        <div style={{ fontSize: '12.5px', color: 'var(--fg-muted)', marginTop: '4px' }}>
                            Shop payable balances, batch creation, and payout reconciliation.
                        </div>
                    </div>
                </Link>

                {/* 6. Support */}
                <Link href="/admin/support" style={{ textDecoration: 'none', color: 'inherit' }}>
                    <div className="card" style={{
                        padding: '20px',
                        borderRadius: '14px',
                        background: 'var(--bg-card)',
                        border: '1px solid var(--border)',
                        height: '100%',
                        transition: 'transform 0.15s, border-color 0.15s',
                        cursor: 'pointer',
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '14px' }}>
                            <div style={{ width: '38px', height: '38px', borderRadius: '10px', background: 'rgba(207, 67, 141, 0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#cf438d' }}>
                                <LifeBuoy size={20} />
                            </div>
                            <ArrowUpRight size={16} style={{ color: 'var(--fg-muted)' }} />
                        </div>
                        <div style={{ fontSize: '28px', fontWeight: '900', letterSpacing: '-0.02em', color: 'var(--fg)' }}>
                            Inbox
                        </div>
                        <div style={{ fontSize: '14px', fontWeight: '800', marginTop: '2px', color: 'var(--fg)' }}>
                            Support & Inquiries
                        </div>
                        <div style={{ fontSize: '12.5px', color: 'var(--fg-muted)', marginTop: '4px' }}>
                            Customer and vendor issues, contact messages, and order follow-ups.
                        </div>
                    </div>
                </Link>
            </div>

            {/* Quick Operations Strip */}
            <div style={{
                padding: '20px',
                borderRadius: '14px',
                background: 'var(--bg-card)',
                border: '1px solid var(--border)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '16px',
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <Shield size={20} style={{ color: 'var(--accent)' }} />
                    <div>
                        <div style={{ fontSize: '14px', fontWeight: '800', color: 'var(--fg)' }}>
                            Security & Role Boundaries
                        </div>
                        <div style={{ fontSize: '12.5px', color: 'var(--fg-muted)' }}>
                            Row Level Security, phone identity verification, and financial ledgers strictly enforced.
                        </div>
                    </div>
                </div>

                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                    <Link href="/admin/people" className="btn btn-outline btn-sm" style={{ fontSize: '12px', fontWeight: '700' }}>
                        + Add Person
                    </Link>
                    <Link href="/admin/vendors" className="btn btn-sm" style={{ fontSize: '12px', fontWeight: '800', background: 'var(--accent)', color: '#092b31' }}>
                        View Shops
                    </Link>
                </div>
            </div>
        </div>
    );
}

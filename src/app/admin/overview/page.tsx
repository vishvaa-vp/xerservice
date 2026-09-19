'use client';

import { useEffect, useState, useCallback } from 'react';
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
    DollarSign,
    ShoppingBag,
    CheckCircle2,
    BarChart3,
} from 'lucide-react';

interface AnalyticsData {
    kpis: {
        grossSales: number;
        platformCommission: number;
        vendorEarnings: number;
        payableAmount: number;
        settledAmount: number;
        pendingAmount: number;
        totalOrders: number;
        totalShops: number;
        totalUsers: number;
        customerCount: number;
        vendorCount: number;
        unconfiguredOrdersCount: number;
        unconfiguredOrdersAmount: number;
        completedRate: number;
        commissionCoverageRate: number;
        pendingDeletionsCount: number;
    };
    trends: Array<{
        date: string;
        gross: number;
        commission: number;
        ordersCount: number;
    }>;
    orderStatusBreakdown: Record<string, number>;
    shopPerformance: Array<{
        shopId: string;
        shopName: string;
        ordersCount: number;
        grossRevenue: number;
    }>;
}

export default function AdminOverviewPage() {
    const router = useRouter();
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
    const [authorized, setAuthorized] = useState(false);
    const [lastUpdated, setLastUpdated] = useState<string>('');

    const loadOverviewData = useCallback(async () => {
        setRefreshing(true);
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) {
                router.replace('/xad/login?redirect=/admin/overview');
                return;
            }

            const { data: profile, error: profileErr } = await supabase
                .from('profiles')
                .select('role')
                .eq('user_id', session.user.id)
                .maybeSingle();

            if (profileErr || !profile || profile?.role !== 'admin') {
                router.replace('/xad/login?redirect=/admin/overview');
                return;
            }

            setAuthorized(true);

            const res = await fetch('/api/admin/overview/analytics', {
                headers: {
                    Authorization: `Bearer ${session.access_token}`,
                    'Cache-Control': 'no-cache',
                },
            });

            if (res.ok) {
                const data = await res.json();
                setAnalytics(data);
                setLastUpdated(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
            }
        } catch (err) {
            console.error('[AdminOverview] Failed to load overview data:', err);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [router]);

    useEffect(() => {
        loadOverviewData();
    }, [loadOverviewData]);

    if (loading) {
        return (
            <div style={{ minHeight: '60vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px' }}>
                <span className="spinner spinner-lg" />
                <p style={{ color: 'var(--fg-muted)', fontSize: '14px' }}>Loading operational overview…</p>
            </div>
        );
    }

    if (!authorized || !analytics) return null;

    const { kpis } = analytics;

    return (
        <div className="container" style={{ maxWidth: '1400px', margin: '0 auto', padding: '24px 16px 64px' }}>
            {/* Header with Overview Title & Update / Refresh action */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px', marginBottom: '24px' }}>
                <div>
                    <h1 style={{ fontSize: '28px', fontWeight: '900', letterSpacing: '-0.03em', margin: 0, color: 'var(--fg)' }}>
                        Overview
                    </h1>
                    <p style={{ fontSize: '13px', color: 'var(--fg-muted)', margin: '4px 0 0 0' }}>
                        Operational intelligence, revenue streams, and print network fulfillment
                    </p>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <Link
                        href="/admin/dashboard"
                        className="btn btn-outline btn-sm"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: '700' }}
                    >
                        <BarChart3 size={14} style={{ color: 'var(--accent)' }} />
                        <span>Visual Dashboard →</span>
                    </Link>

                    {lastUpdated && (
                        <span style={{ fontSize: '12px', color: 'var(--fg-muted)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                            <Clock size={13} /> Updated at {lastUpdated}
                        </span>
                    )}

                    <button
                        onClick={loadOverviewData}
                        disabled={refreshing}
                        className="btn btn-outline btn-sm"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: '700' }}
                        title="Refresh overview metrics"
                    >
                        <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
                        <span>Refresh</span>
                    </button>
                </div>
            </div>

            {/* Operational Attention Banners */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '24px' }}>
                {kpis.unconfiguredOrdersCount > 0 && (
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '12px 18px',
                        borderRadius: '12px',
                        background: 'rgba(239, 68, 68, 0.08)',
                        border: '1px solid rgba(239, 68, 68, 0.25)',
                        flexWrap: 'wrap',
                        gap: '12px',
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <AlertTriangle size={18} color="#ef4444" />
                            <span style={{ fontSize: '13px', fontWeight: '700', color: '#b91c1c' }}>
                                {kpis.unconfiguredOrdersCount} order(s) (₹{kpis.unconfiguredOrdersAmount.toFixed(2)}) require commission configuration before settlement.
                            </span>
                        </div>
                        <Link
                            href="/admin/settlements"
                            className="btn btn-sm"
                            style={{ background: '#ef4444', color: '#fff', fontSize: '12px', fontWeight: '800', border: 'none', borderRadius: '8px' }}
                        >
                            Review Settlements →
                        </Link>
                    </div>
                )}

                {kpis.pendingDeletionsCount > 0 && (
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '12px 18px',
                        borderRadius: '12px',
                        background: 'rgba(245, 158, 11, 0.08)',
                        border: '1px solid rgba(245, 158, 11, 0.25)',
                        flexWrap: 'wrap',
                        gap: '12px',
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <AlertTriangle size={18} color="#f59e0b" />
                            <span style={{ fontSize: '13px', fontWeight: '700', color: '#b45309' }}>
                                {kpis.pendingDeletionsCount} customer account deletion request(s) awaiting administrative governance review.
                            </span>
                        </div>
                        <Link
                            href="/admin/users?status=pending_delete"
                            className="btn btn-sm"
                            style={{ background: '#f59e0b', color: '#fff', fontSize: '12px', fontWeight: '800', border: 'none', borderRadius: '8px' }}
                        >
                            Review Requests →
                        </Link>
                    </div>
                )}
            </div>

            {/* Top Operational KPI Metrics Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px', marginBottom: '24px' }}>
                {/* Gross Revenue */}
                <div className="card" style={{ padding: '20px', borderRadius: '16px', background: 'var(--bg)', border: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                        <span style={{ fontSize: '12px', fontWeight: '700', color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                            Gross Revenue
                        </span>
                        <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'rgba(22, 163, 74, 0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#16a34a' }}>
                            <TrendingUp size={16} />
                        </div>
                    </div>
                    <div style={{ fontSize: '28px', fontWeight: '900', letterSpacing: '-0.03em', color: 'var(--fg)' }}>
                        ₹{kpis.grossSales.toFixed(2)}
                    </div>
                    <span style={{ fontSize: '11px', color: 'var(--fg-subtle)', display: 'block', marginTop: '4px' }}>
                        Across {kpis.totalOrders} total orders processed
                    </span>
                </div>

                {/* XerService Earnings */}
                <div className="card" style={{ padding: '20px', borderRadius: '16px', background: 'var(--bg)', border: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                        <span style={{ fontSize: '12px', fontWeight: '700', color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                            XerService Earnings
                        </span>
                        <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'rgba(99, 102, 241, 0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6366f1' }}>
                            <DollarSign size={16} />
                        </div>
                    </div>
                    <div style={{ fontSize: '28px', fontWeight: '900', letterSpacing: '-0.03em', color: '#6366f1' }}>
                        ₹{kpis.platformCommission.toFixed(2)}
                    </div>
                    <span style={{ fontSize: '11px', color: 'var(--fg-subtle)', display: 'block', marginTop: '4px' }}>
                        Platform margin & fee earnings
                    </span>
                </div>

                {/* Total Orders */}
                <div className="card" style={{ padding: '20px', borderRadius: '16px', background: 'var(--bg)', border: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                        <span style={{ fontSize: '12px', fontWeight: '700', color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                            Total Orders
                        </span>
                        <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'rgba(2, 132, 199, 0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#0284c7' }}>
                            <ShoppingBag size={16} />
                        </div>
                    </div>
                    <div style={{ fontSize: '28px', fontWeight: '900', letterSpacing: '-0.03em', color: 'var(--fg)' }}>
                        {kpis.totalOrders}
                    </div>
                    <span style={{ fontSize: '11px', color: '#16a34a', fontWeight: '700', display: 'inline-flex', alignItems: 'center', gap: '3px', marginTop: '4px' }}>
                        <CheckCircle2 size={12} /> {kpis.completedRate}% fulfillment rate
                    </span>
                </div>

                {/* Settlements Payable */}
                <div className="card" style={{ padding: '20px', borderRadius: '16px', background: 'var(--bg)', border: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                        <span style={{ fontSize: '12px', fontWeight: '700', color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                            Settlements Payable
                        </span>
                        <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'rgba(245, 158, 11, 0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#f59e0b' }}>
                            <Landmark size={16} />
                        </div>
                    </div>
                    <div style={{ fontSize: '28px', fontWeight: '900', letterSpacing: '-0.03em', color: 'var(--fg)' }}>
                        ₹{kpis.payableAmount.toFixed(2)}
                    </div>
                    <span style={{ fontSize: '11px', color: 'var(--fg-subtle)', display: 'block', marginTop: '4px' }}>
                        Disbursed to date: ₹{kpis.settledAmount.toFixed(2)}
                    </span>
                </div>
            </div>

            {/* Quick Operational Navigation Hub */}
            <div style={{ marginBottom: '28px' }}>
                <div style={{ marginBottom: '14px' }}>
                    <h2 style={{ fontSize: '16px', fontWeight: '800', margin: 0 }}>Operational Topics</h2>
                    <p style={{ fontSize: '12px', color: 'var(--fg-muted)', margin: '2px 0 0' }}>Quick access to core administrative modules</p>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px' }}>
                    <Link href="/admin/users" className="card" style={{ padding: '16px', borderRadius: '14px', textDecoration: 'none', transition: 'all 0.15s ease', background: 'var(--bg)', border: '1px solid var(--border)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                            <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'rgba(2, 132, 199, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#0284c7' }}>
                                <Users size={16} />
                            </div>
                            <ArrowUpRight size={15} color="var(--fg-subtle)" />
                        </div>
                        <span style={{ fontSize: '16px', fontWeight: '800', color: 'var(--fg)', display: 'block' }}>{kpis.totalUsers} People</span>
                        <span style={{ fontSize: '12px', color: 'var(--fg-muted)' }}>Roles & access controls</span>
                    </Link>

                    <Link href="/admin/customers" className="card" style={{ padding: '16px', borderRadius: '14px', textDecoration: 'none', transition: 'all 0.15s ease', background: 'var(--bg)', border: '1px solid var(--border)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                            <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'rgba(99, 102, 241, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6366f1' }}>
                                <UserCheck size={16} />
                            </div>
                            <ArrowUpRight size={15} color="var(--fg-subtle)" />
                        </div>
                        <span style={{ fontSize: '16px', fontWeight: '800', color: 'var(--fg)', display: 'block' }}>{kpis.customerCount} Customers</span>
                        <span style={{ fontSize: '12px', color: 'var(--fg-muted)' }}>Profiles & order history</span>
                    </Link>

                    <Link href="/admin/vendors" className="card" style={{ padding: '16px', borderRadius: '14px', textDecoration: 'none', transition: 'all 0.15s ease', background: 'var(--bg)', border: '1px solid var(--border)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                            <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'rgba(168, 85, 247, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#a855f7' }}>
                                <Store size={16} />
                            </div>
                            <ArrowUpRight size={15} color="var(--fg-subtle)" />
                        </div>
                        <span style={{ fontSize: '16px', fontWeight: '800', color: 'var(--fg)', display: 'block' }}>{kpis.totalShops} Shops</span>
                        <span style={{ fontSize: '12px', color: 'var(--fg-muted)' }}>Workspaces & schedules</span>
                    </Link>

                    <Link href="/admin/earnings" className="card" style={{ padding: '16px', borderRadius: '14px', textDecoration: 'none', transition: 'all 0.15s ease', background: 'var(--bg)', border: '1px solid var(--border)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                            <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'rgba(22, 163, 74, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#16a34a' }}>
                                <TrendingUp size={16} />
                            </div>
                            <ArrowUpRight size={15} color="var(--fg-subtle)" />
                        </div>
                        <span style={{ fontSize: '16px', fontWeight: '800', color: 'var(--fg)', display: 'block' }}>Earnings & Fees</span>
                        <span style={{ fontSize: '12px', color: 'var(--fg-muted)' }}>Platform commission reports</span>
                    </Link>

                    <Link href="/admin/settlements" className="card" style={{ padding: '16px', borderRadius: '14px', textDecoration: 'none', transition: 'all 0.15s ease', background: 'var(--bg)', border: '1px solid var(--border)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                            <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'rgba(245, 158, 11, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#f59e0b' }}>
                                <Landmark size={16} />
                            </div>
                            <ArrowUpRight size={15} color="var(--fg-subtle)" />
                        </div>
                        <span style={{ fontSize: '16px', fontWeight: '800', color: 'var(--fg)', display: 'block' }}>₹{kpis.payableAmount.toFixed(2)}</span>
                        <span style={{ fontSize: '12px', color: 'var(--fg-muted)' }}>Settlement batch payouts</span>
                    </Link>

                    <Link href="/admin/support" className="card" style={{ padding: '16px', borderRadius: '14px', textDecoration: 'none', transition: 'all 0.15s ease', background: 'var(--bg)', border: '1px solid var(--border)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                            <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'rgba(236, 72, 153, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ec4899' }}>
                                <LifeBuoy size={16} />
                            </div>
                            <ArrowUpRight size={15} color="var(--fg-subtle)" />
                        </div>
                        <span style={{ fontSize: '16px', fontWeight: '800', color: 'var(--fg)', display: 'block' }}>Support Inbox</span>
                        <span style={{ fontSize: '12px', color: 'var(--fg-muted)' }}>Tickets & user inquiries</span>
                    </Link>
                </div>
            </div>

            {/* Bottom Security & Role Boundaries Banner */}
            <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '16px 20px',
                borderRadius: '14px',
                background: 'var(--bg)',
                border: '1px solid var(--border)',
                flexWrap: 'wrap',
                gap: '14px',
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <Shield size={20} color="var(--accent)" />
                    <div>
                        <span style={{ fontSize: '13px', fontWeight: '800', color: 'var(--fg)', display: 'block' }}>
                            Security & Role Boundaries Enforced
                        </span>
                        <span style={{ fontSize: '12px', color: 'var(--fg-muted)' }}>
                            Row Level Security, verified phone authentication, and authoritative double-entry financial ledger active.
                        </span>
                    </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <Link href="/admin/users" className="btn btn-outline btn-sm" style={{ fontWeight: '700' }}>
                        + Add Person
                    </Link>
                    <Link href="/admin/vendors" className="btn btn-accent btn-sm" style={{ fontWeight: '800' }}>
                        View Shops
                    </Link>
                </div>
            </div>
        </div>
    );
}

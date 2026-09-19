'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
import {
    Store,
    Clock,
    RefreshCw,
    LayoutDashboard,
} from 'lucide-react';
import {
    RevenueTrendChart,
    OrdersBreakdownDonutChart,
    ShopPerformanceBarChart,
    OperationalHealthGauges,
} from '@/components/admin/AdminOverviewCharts';

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
        pendingDeletionsCount: number;
        completedRate: number;
        commissionCoverageRate: number;
    };
    trends: Array<{
        date: string;
        gross: number;
        commission: number;
        orders: number;
    }>;
    orderStatusBreakdown: Array<{
        label: string;
        count: number;
        color: string;
    }>;
    shopPerformance: Array<{
        shopId: string;
        shopName: string;
        ordersCount: number;
        grossRevenue: number;
        vendorEarnings: number;
    }>;
}

export default function AdminOverviewPage() {
    const router = useRouter();
    const [loading, setLoading] = useState(true);
    const [authorized, setAuthorized] = useState(false);
    const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
    const [lastUpdated, setLastUpdated] = useState<string>('');
    const [refreshing, setRefreshing] = useState(false);

    const loadOverviewData = useCallback(async () => {
        try {
            setRefreshing(true);
            const { data: { session }, error: sessionErr } = await supabase.auth.getSession();
            if (sessionErr || !session?.user) {
                router.replace('/xad/login?redirect=/admin/dashboard');
                return;
            }

            const { data: profile, error: profileErr } = await supabase
                .from('profiles')
                .select('role')
                .eq('user_id', session.user.id)
                .maybeSingle();

            if (profileErr || !profile || profile.role !== 'admin') {
                router.replace('/xad/login?redirect=/admin/dashboard');
                return;
            }

            setAuthorized(true);

            // Fetch live aggregated analytics
            const token = session.access_token;
            const res = await fetch('/api/admin/overview/analytics', {
                headers: { Authorization: `Bearer ${token}` },
            });

            if (res.ok) {
                const data = await res.json();
                if (data.success) {
                    setAnalytics(data);
                }
            }
            setLastUpdated(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
        } catch (err) {
            console.error('[AdminOverview] Failed to load analytics data:', err);
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

    const { kpis, trends, orderStatusBreakdown, shopPerformance } = analytics;

    return (
        <div className="container" style={{ maxWidth: '1400px', margin: '0 auto', padding: '24px 16px 64px' }}>
            {/* Header with Dashboard Title & Update / Refresh button */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px', marginBottom: '24px' }}>
                <div>
                    <h1 style={{ fontSize: '28px', fontWeight: '900', letterSpacing: '-0.03em', margin: 0, color: 'var(--fg)' }}>
                        Dashboard
                    </h1>
                    <p style={{ fontSize: '13px', color: 'var(--fg-muted)', margin: '4px 0 0 0' }}>
                        Live operational analytics, order distribution, and shop performance
                    </p>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <Link
                        href="/admin/overview"
                        className="btn btn-outline btn-sm"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: '700' }}
                    >
                        <LayoutDashboard size={13} style={{ color: 'var(--accent)' }} />
                        <span>Overview Summary →</span>
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
                        title="Refresh dashboard metrics"
                    >
                        <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
                        <span>Refresh</span>
                    </button>
                </div>
            </div>

            {/* Primary Visual Analytics Charts Row */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '20px', marginBottom: '24px' }}>
                {/* Revenue & Commission Trends Area Chart */}
                <div className="card" style={{ padding: '22px', borderRadius: '18px', background: 'var(--bg)', border: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '18px', flexWrap: 'wrap', gap: '8px' }}>
                        <div>
                            <h2 style={{ fontSize: '16px', fontWeight: '800', margin: 0 }}>Revenue & Platform Earnings Trends</h2>
                            <p style={{ fontSize: '12px', color: 'var(--fg-muted)', margin: '2px 0 0' }}>Daily sales volume vs. platform commission</p>
                        </div>
                        <Link href="/admin/earnings" className="btn btn-ghost btn-sm" style={{ fontSize: '12px', fontWeight: '700', color: 'var(--accent)' }}>
                            View Details →
                        </Link>
                    </div>
                    <RevenueTrendChart trends={trends} />
                </div>

                {/* Orders Breakdown Donut Chart */}
                <div className="card" style={{ padding: '22px', borderRadius: '18px', background: 'var(--bg)', border: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '18px', flexWrap: 'wrap', gap: '8px' }}>
                        <div>
                            <h2 style={{ fontSize: '16px', fontWeight: '800', margin: 0 }}>Orders Status Breakdown</h2>
                            <p style={{ fontSize: '12px', color: 'var(--fg-muted)', margin: '2px 0 0' }}>Distribution of current print network orders</p>
                        </div>
                        <Link href="/admin/customers" className="btn btn-ghost btn-sm" style={{ fontSize: '12px', fontWeight: '700', color: 'var(--accent)' }}>
                            Customer Log →
                        </Link>
                    </div>
                    <div style={{ minHeight: '280px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <OrdersBreakdownDonutChart
                            breakdown={orderStatusBreakdown}
                            totalOrders={kpis.totalOrders}
                        />
                    </div>
                </div>
            </div>

            {/* Secondary Visual Analytics Row: Shop Performance & Operational Health */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '20px' }}>
                {/* Shop Performance Comparison Bar Chart */}
                <div className="card" style={{ padding: '22px', borderRadius: '18px', background: 'var(--bg)', border: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '18px', flexWrap: 'wrap', gap: '8px' }}>
                        <div>
                            <h2 style={{ fontSize: '16px', fontWeight: '800', margin: 0 }}>Shop Performance Comparison</h2>
                            <p style={{ fontSize: '12px', color: 'var(--fg-muted)', margin: '2px 0 0' }}>Top shops ranked by revenue volume and completed jobs</p>
                        </div>
                        <Link href="/admin/vendors" className="btn btn-ghost btn-sm" style={{ fontSize: '12px', fontWeight: '700', color: 'var(--accent)' }}>
                            Manage Shops →
                        </Link>
                    </div>
                    <ShopPerformanceBarChart shops={shopPerformance} />
                </div>

                {/* Operational Fulfillment & Health Gauges */}
                <div className="card" style={{ padding: '22px', borderRadius: '18px', background: 'var(--bg)', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                    <div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '18px', flexWrap: 'wrap', gap: '8px' }}>
                            <div>
                                <h2 style={{ fontSize: '16px', fontWeight: '800', margin: 0 }}>Operational Health & Gauges</h2>
                                <p style={{ fontSize: '12px', color: 'var(--fg-muted)', margin: '2px 0 0' }}>System metrics, commission compliance, and governance</p>
                            </div>
                        </div>
                        <OperationalHealthGauges
                            completedRate={kpis.completedRate}
                            commissionCoverageRate={kpis.commissionCoverageRate}
                            unconfiguredCount={kpis.unconfiguredOrdersCount}
                            pendingDeletionsCount={kpis.pendingDeletionsCount}
                        />
                    </div>

                    <div style={{ marginTop: '16px', padding: '14px', borderRadius: '12px', background: 'var(--bg-secondary)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <Store size={16} color="var(--accent)" />
                            <span style={{ fontSize: '13px', fontWeight: '700' }}>
                                {kpis.totalShops} Active Shop Locations registered
                            </span>
                        </div>
                        <Link href="/admin/vendors" className="btn btn-accent btn-sm" style={{ fontSize: '12px', fontWeight: '800' }}>
                            View Shop Workspaces
                        </Link>
                    </div>
                </div>
            </div>
        </div>
    );
}

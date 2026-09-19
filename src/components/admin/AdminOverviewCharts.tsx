'use client';

import React, { useState, useEffect } from 'react';
import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    BarElement,
    ArcElement,
    Title,
    Tooltip,
    Legend,
    Filler,
} from 'chart.js';
import { Line, Doughnut, Bar } from 'react-chartjs-2';
import { TrendingUp, ShoppingBag, Store, Activity, ShieldCheck, CheckCircle2 } from 'lucide-react';

ChartJS.register(
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    BarElement,
    ArcElement,
    Title,
    Tooltip,
    Legend,
    Filler
);

interface TrendPoint {
    date: string;
    gross: number;
    commission: number;
    orders: number;
}

interface OrderStatusItem {
    label: string;
    count: number;
    color: string;
}

interface ShopStat {
    shopId: string;
    shopName: string;
    ordersCount: number;
    grossRevenue: number;
    vendorEarnings: number;
}

// 1. Revenue & Commission Trends Area/Line Chart
export function RevenueTrendChart({ trends }: { trends: TrendPoint[] }) {
    const [mounted, setMounted] = useState(false);
    useEffect(() => { setMounted(true); }, []);

    if (!mounted) {
        return (
            <div style={{ height: '280px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span className="spinner spinner-sm" />
            </div>
        );
    }

    const labels = trends.map(t => t.date);
    const grossData = trends.map(t => t.gross);
    const commissionData = trends.map(t => t.commission);

    const data = {
        labels,
        datasets: [
            {
                label: 'Gross Sales (₹)',
                data: grossData,
                borderColor: '#16a34a',
                backgroundColor: 'rgba(22, 163, 74, 0.12)',
                fill: true,
                tension: 0.35,
                borderWidth: 2.5,
                pointRadius: 3.5,
                pointBackgroundColor: '#16a34a',
            },
            {
                label: 'Platform Commission (₹)',
                data: commissionData,
                borderColor: '#6366f1',
                backgroundColor: 'rgba(99, 102, 241, 0.10)',
                fill: true,
                tension: 0.35,
                borderWidth: 2,
                pointRadius: 3,
                pointBackgroundColor: '#6366f1',
            },
        ],
    };

    const options = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: {
                position: 'top' as const,
                labels: {
                    boxWidth: 12,
                    boxHeight: 12,
                    font: { size: 12, weight: 600 },
                    color: 'var(--fg-muted)',
                },
            },
            tooltip: {
                callbacks: {
                    label: (context: any) => ` ${context.dataset.label}: ₹${context.raw.toFixed(2)}`,
                },
            },
        },
        scales: {
            x: {
                grid: { display: false },
                ticks: { color: 'var(--fg-muted)', font: { size: 11 } },
            },
            y: {
                grid: { color: 'rgba(150, 150, 150, 0.1)' },
                ticks: {
                    color: 'var(--fg-muted)',
                    font: { size: 11 },
                    callback: (value: any) => `₹${value}`,
                },
                beginAtZero: true,
            },
        },
    };

    return (
        <div style={{ height: '280px', width: '100%', position: 'relative' }}>
            <Line data={data} options={options} />
        </div>
    );
}

// 2. Orders Status Breakdown Donut Chart
export function OrdersBreakdownDonutChart({
    breakdown,
    totalOrders,
}: {
    breakdown: OrderStatusItem[];
    totalOrders: number;
}) {
    const [mounted, setMounted] = useState(false);
    useEffect(() => { setMounted(true); }, []);

    if (!mounted) {
        return (
            <div style={{ height: '240px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span className="spinner spinner-sm" />
            </div>
        );
    }

    const labels = breakdown.map(b => b.label);
    const counts = breakdown.map(b => b.count);
    const backgroundColors = breakdown.map(b => b.color);

    // Fallback if all counts are 0
    const hasData = counts.some(c => c > 0);
    const chartData = hasData ? counts : [1];
    const chartLabels = hasData ? labels : ['No orders'];
    const chartColors = hasData ? backgroundColors : ['rgba(150, 150, 150, 0.2)'];

    const data = {
        labels: chartLabels,
        datasets: [
            {
                data: chartData,
                backgroundColor: chartColors,
                borderWidth: 2,
                borderColor: 'var(--bg)',
                hoverOffset: 4,
            },
        ],
    };

    const options = {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '72%',
        plugins: {
            legend: { display: false },
            tooltip: {
                enabled: hasData,
                callbacks: {
                    label: (context: any) => {
                        const total = counts.reduce((a, b) => a + b, 0);
                        const val = context.raw || 0;
                        const pct = total > 0 ? Math.round((val / total) * 100) : 0;
                        return ` ${context.label}: ${val} orders (${pct}%)`;
                    },
                },
            },
        },
    };

    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px', flexWrap: 'wrap', justifyContent: 'center' }}>
            <div style={{ width: '180px', height: '180px', position: 'relative', flexShrink: 0 }}>
                <Doughnut data={data} options={options} />
                <div
                    style={{
                        position: 'absolute',
                        inset: 0,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        pointerEvents: 'none',
                    }}
                >
                    <span style={{ fontSize: '24px', fontWeight: '900', letterSpacing: '-0.03em', lineHeight: 1 }}>
                        {totalOrders}
                    </span>
                    <span style={{ fontSize: '11px', fontWeight: '700', color: 'var(--fg-muted)', textTransform: 'uppercase', marginTop: '3px' }}>
                        Total Orders
                    </span>
                </div>
            </div>

            {/* Legend breakdown list */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: '150px' }}>
                {breakdown.map((item) => {
                    const pct = totalOrders > 0 ? Math.round((item.count / totalOrders) * 100) : 0;
                    return (
                        <div key={item.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '14px', fontSize: '13px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span style={{ width: '10px', height: '10px', borderRadius: '3px', background: item.color, display: 'inline-block' }} />
                                <span style={{ color: 'var(--fg-muted)', fontWeight: '600' }}>{item.label}</span>
                            </div>
                            <span style={{ fontWeight: '800' }}>{item.count} <small style={{ color: 'var(--fg-subtle)', fontWeight: '600' }}>({pct}%)</small></span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

// 3. Shop Performance Comparison Bar Chart
export function ShopPerformanceBarChart({ shops }: { shops: ShopStat[] }) {
    const [mounted, setMounted] = useState(false);
    useEffect(() => { setMounted(true); }, []);

    if (!mounted) {
        return (
            <div style={{ height: '250px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span className="spinner spinner-sm" />
            </div>
        );
    }

    const displayShops = shops.slice(0, 6);
    const labels = displayShops.map(s => s.shopName.length > 16 ? `${s.shopName.slice(0, 16)}…` : s.shopName);
    const revenues = displayShops.map(s => s.grossRevenue);
    const orders = displayShops.map(s => s.ordersCount);

    const data = {
        labels: labels.length ? labels : ['No Shops Listed'],
        datasets: [
            {
                label: 'Gross Revenue (₹)',
                data: revenues.length ? revenues : [0],
                backgroundColor: 'rgba(22, 163, 74, 0.8)',
                borderRadius: 6,
            },
            {
                label: 'Orders Count',
                data: orders.length ? orders : [0],
                backgroundColor: 'rgba(2, 132, 199, 0.75)',
                borderRadius: 6,
            },
        ],
    };

    const options = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: {
                position: 'top' as const,
                labels: {
                    boxWidth: 12,
                    boxHeight: 12,
                    font: { size: 12, weight: 600 },
                    color: 'var(--fg-muted)',
                },
            },
        },
        scales: {
            x: {
                grid: { display: false },
                ticks: { color: 'var(--fg-muted)', font: { size: 11 } },
            },
            y: {
                grid: { color: 'rgba(150, 150, 150, 0.1)' },
                ticks: { color: 'var(--fg-muted)', font: { size: 11 } },
                beginAtZero: true,
            },
        },
    };

    return (
        <div style={{ height: '250px', width: '100%', position: 'relative' }}>
            <Bar data={data} options={options} />
        </div>
    );
}

// 4. Operational Health Gauges & Rates
export function OperationalHealthGauges({
    completedRate,
    commissionCoverageRate,
    unconfiguredCount,
    pendingDeletionsCount,
}: {
    completedRate: number;
    commissionCoverageRate: number;
    unconfiguredCount: number;
    pendingDeletionsCount: number;
}) {
    return (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '14px' }}>
            {/* Fulfillment Completion Rate */}
            <div className="card" style={{ padding: '16px', background: 'var(--bg)', borderRadius: '14px', border: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <span style={{ fontSize: '12px', fontWeight: '700', color: 'var(--fg-muted)' }}>Fulfillment Rate</span>
                    <CheckCircle2 size={16} color="#16a34a" />
                </div>
                <div style={{ fontSize: '24px', fontWeight: '900', letterSpacing: '-0.02em', marginBottom: '8px' }}>
                    {completedRate}%
                </div>
                <div style={{ width: '100%', height: '6px', background: 'var(--bg-secondary)', borderRadius: '999px', overflow: 'hidden' }}>
                    <div
                        style={{
                            width: `${Math.min(100, Math.max(0, completedRate))}%`,
                            height: '100%',
                            background: completedRate >= 80 ? '#16a34a' : '#f59e0b',
                            borderRadius: '999px',
                            transition: 'width 0.4s ease',
                        }}
                    />
                </div>
                <span style={{ fontSize: '11px', color: 'var(--fg-subtle)', display: 'block', marginTop: '6px' }}>
                    Orders completed successfully
                </span>
            </div>

            {/* Commission Coverage Rate */}
            <div className="card" style={{ padding: '16px', background: 'var(--bg)', borderRadius: '14px', border: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <span style={{ fontSize: '12px', fontWeight: '700', color: 'var(--fg-muted)' }}>Commission Coverage</span>
                    <ShieldCheck size={16} color={commissionCoverageRate === 100 ? '#16a34a' : '#f59e0b'} />
                </div>
                <div style={{ fontSize: '24px', fontWeight: '900', letterSpacing: '-0.02em', marginBottom: '8px' }}>
                    {commissionCoverageRate}%
                </div>
                <div style={{ width: '100%', height: '6px', background: 'var(--bg-secondary)', borderRadius: '999px', overflow: 'hidden' }}>
                    <div
                        style={{
                            width: `${Math.min(100, Math.max(0, commissionCoverageRate))}%`,
                            height: '100%',
                            background: commissionCoverageRate === 100 ? '#16a34a' : '#f59e0b',
                            borderRadius: '999px',
                            transition: 'width 0.4s ease',
                        }}
                    />
                </div>
                <span style={{ fontSize: '11px', color: 'var(--fg-subtle)', display: 'block', marginTop: '6px' }}>
                    {unconfiguredCount > 0 ? `${unconfiguredCount} orders require rule config` : '100% ledger coverage'}
                </span>
            </div>

            {/* System Health */}
            <div className="card" style={{ padding: '16px', background: 'var(--bg)', borderRadius: '14px', border: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <span style={{ fontSize: '12px', fontWeight: '700', color: 'var(--fg-muted)' }}>System Governance</span>
                    <Activity size={16} color="var(--accent)" />
                </div>
                <div style={{ fontSize: '24px', fontWeight: '900', letterSpacing: '-0.02em', marginBottom: '8px', color: pendingDeletionsCount > 0 ? '#b45309' : 'var(--fg)' }}>
                    {pendingDeletionsCount > 0 ? `${pendingDeletionsCount} Pending` : 'Healthy'}
                </div>
                <div style={{ width: '100%', height: '6px', background: 'var(--bg-secondary)', borderRadius: '999px', overflow: 'hidden' }}>
                    <div
                        style={{
                            width: '100%',
                            height: '100%',
                            background: pendingDeletionsCount > 0 ? '#f59e0b' : '#16a34a',
                            borderRadius: '999px',
                        }}
                    />
                </div>
                <span style={{ fontSize: '11px', color: 'var(--fg-subtle)', display: 'block', marginTop: '6px' }}>
                    {pendingDeletionsCount > 0 ? 'Account deletion requests awaiting review' : 'No governance backlogs'}
                </span>
            </div>
        </div>
    );
}

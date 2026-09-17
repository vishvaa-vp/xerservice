'use client';

import { Suspense, useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase/client';
import AdminHeaderNav from '@/components/admin/AdminHeaderNav';
import {
    TrendingUp,
    TrendingDown,
    Calendar,
    Download,
    RefreshCw,
    Info,
    AlertCircle,
    CheckCircle2,
    Clock,
    XCircle,
    Search,
    IndianRupee,
    Store,
    ShoppingBag,
    ArrowUpRight,
    ArrowDownRight,
    Minus,
} from 'lucide-react';

type DatePreset = 'today' | 'yesterday' | 'this_week' | 'this_month' | 'this_year' | 'all_time' | 'custom';

interface MetricWithComparison {
    current: number;
    previous: number;
    delta: number;
    percentChange: number | null;
}

interface RefundBreakdownState {
    count: number;
    totalAmount: number;
}

interface ShopEarningsBreakdown {
    shopId: string;
    shopName: string;
    ordersCount: number;
    serviceRevenue: number;
    xerServiceEarnings: number;
    shopEarnings: number;
    confirmedRefunds: number;
    cancellationsCount: number;
    unallocatedCount: number;
    unallocatedAmount: number;
    settledAmount: number;
}

interface EarningsReport {
    period: {
        preset: DatePreset;
        startUtc: string;
        endUtc: string;
        prevStartUtc: string;
        prevEndUtc: string;
        label: string;
    };
    kpis: {
        xerServiceEarnings: MetricWithComparison;
        serviceRevenue: MetricWithComparison;
        shopEarnings: MetricWithComparison;
        confirmedRefunds: MetricWithComparison;
        ordersIncluded: MetricWithComparison;
        settledDisbursements: MetricWithComparison;
    };
    refunds: {
        unpaidCancellations: RefundBreakdownState;
        paidCancellationsAwaitingRefund: RefundBreakdownState;
        confirmedRefunds: RefundBreakdownState;
        failedPendingRefunds: RefundBreakdownState;
    };
    shops: ShopEarningsBreakdown[];
    metricSources: Record<string, {
        source: string;
        inclusion: string;
        timestampBasis: string;
        refundTreatment: string;
    }>;
}

export default function AdminEarningsPage() {
    return (
        <Suspense fallback={<div style={{ padding: '32px' }}>Loading earnings…</div>}>
            <AdminEarningsContent />
        </Suspense>
    );
}

function AdminEarningsContent() {
    const [token, setToken] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [report, setReport] = useState<EarningsReport | null>(null);

    // Filters
    const [preset, setPreset] = useState<DatePreset>('all_time');
    const [customStart, setCustomStart] = useState('');
    const [customEnd, setCustomEnd] = useState('');
    const [showCustomModal, setShowCustomModal] = useState(false);
    const [shopSearch, setShopSearch] = useState('');
    const [showTooltip, setShowTooltip] = useState<string | null>(null);

    // Load auth token
    useEffect(() => {
        supabase.auth.getSession().then(({ data: { session } }) => {
            if (session?.access_token) {
                setToken(session.access_token);
            } else {
                setError('Session missing or expired. Please log in.');
                setLoading(false);
            }
        });
    }, []);

    // Fetch report data
    const fetchEarnings = useCallback(async (activePreset: DatePreset = preset, start?: string, end?: string) => {
        if (!token) return;
        setLoading(true);
        setError(null);

        try {
            let url = `/api/admin/finance/earnings?preset=${activePreset}`;
            if (activePreset === 'custom' && start && end) {
                url += `&startDate=${encodeURIComponent(start)}&endDate=${encodeURIComponent(end)}`;
            }

            const res = await fetch(url, {
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            });

            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error || `Failed to load earnings (${res.status})`);
            }

            const data = await res.json();
            setReport(data.report);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            setError(msg);
        } finally {
            setLoading(false);
        }
    }, [token, preset]);

    useEffect(() => {
        if (token) {
            fetchEarnings(preset, customStart, customEnd);
        }
    }, [token, preset, customStart, customEnd, fetchEarnings]);

    const handlePresetChange = (newPreset: DatePreset) => {
        if (newPreset === 'custom') {
            setShowCustomModal(true);
        } else {
            setPreset(newPreset);
        }
    };

    const applyCustomRange = () => {
        if (!customStart || !customEnd) return;
        setPreset('custom');
        setShowCustomModal(false);
        fetchEarnings('custom', customStart, customEnd);
    };

    const handleDownloadCsv = () => {
        if (!token) return;
        let url = `/api/admin/finance/earnings?preset=${preset}&export=csv`;
        if (preset === 'custom' && customStart && customEnd) {
            url += `&startDate=${encodeURIComponent(customStart)}&endDate=${encodeURIComponent(customEnd)}`;
        }
        // Fetch with Bearer token & trigger download
        fetch(url, {
            headers: { Authorization: `Bearer ${token}` },
        })
            .then(res => res.blob())
            .then(blob => {
                const downloadUrl = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = downloadUrl;
                a.download = `earnings-report-${preset}-${new Date().toISOString().slice(0, 10)}.csv`;
                document.body.appendChild(a);
                a.click();
                a.remove();
            })
            .catch(err => {
                console.error('Download error:', err);
                alert('Failed to download CSV');
            });
    };

    // Filter shops by search
    const filteredShops = (report?.shops || []).filter(s =>
        s.shopName.toLowerCase().includes(shopSearch.toLowerCase())
    );

    const renderComparisonBadge = (m: MetricWithComparison, isCurrency = true) => {
        if (m.percentChange === null || m.percentChange === 0) {
            return (
                <span className="badge badge-neutral" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '11px', padding: '2px 6px' }}>
                    <Minus size={12} /> 0% vs prior
                </span>
            );
        }

        const isPositive = m.delta > 0;
        return (
            <span
                className={`badge ${isPositive ? 'badge-success' : 'badge-neutral'}`}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '11px', padding: '2px 6px' }}
                title={`Previous period: ${isCurrency ? '₹' : ''}${m.previous.toLocaleString('en-IN')}`}
            >
                {isPositive ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
                {isPositive ? '+' : ''}{m.percentChange}% vs prior
            </span>
        );
    };

    return (
        <div className="admin-page-container">
            <AdminHeaderNav activeSection="earnings" />

            <div style={{ padding: '24px 32px', maxWidth: '1440px', margin: '0 auto' }}>
                {/* Clean minimal header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
                    <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <h1 style={{ fontSize: '24px', fontWeight: '700', margin: 0 }}>Earnings</h1>
                            <span className="badge badge-info" style={{ textTransform: 'capitalize' }}>
                                {report?.period.label || preset}
                            </span>
                            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                                Asia/Kolkata (IST)
                            </span>
                        </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        {/* Date presets */}
                        <div className="btn-group" style={{ display: 'flex', background: 'var(--card-bg, #ffffff)', border: '1px solid var(--border-color, #e2e8f0)', borderRadius: '8px', overflow: 'hidden' }}>
                            {(['today', 'yesterday', 'this_week', 'this_month', 'this_year', 'all_time'] as DatePreset[]).map(p => (
                                <button
                                    key={p}
                                    type="button"
                                    onClick={() => handlePresetChange(p)}
                                    style={{
                                        padding: '6px 12px',
                                        fontSize: '13px',
                                        fontWeight: preset === p ? '6px' : '400',
                                        background: preset === p ? 'var(--primary-color, #0284c7)' : 'transparent',
                                        color: preset === p ? '#ffffff' : 'inherit',
                                        border: 'none',
                                        cursor: 'pointer',
                                        textTransform: 'capitalize',
                                    }}
                                >
                                    {p.replace('_', ' ')}
                                </button>
                            ))}
                            <button
                                type="button"
                                onClick={() => handlePresetChange('custom')}
                                style={{
                                    padding: '6px 12px',
                                    fontSize: '13px',
                                    background: preset === 'custom' ? 'var(--primary-color, #0284c7)' : 'transparent',
                                    color: preset === 'custom' ? '#ffffff' : 'inherit',
                                    border: 'none',
                                    cursor: 'pointer',
                                }}
                            >
                                Custom…
                            </button>
                        </div>

                        {/* Actions */}
                        <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={() => fetchEarnings()}
                            disabled={loading}
                            style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', padding: '6px 14px' }}
                        >
                            <RefreshCw size={14} className={loading ? 'spin' : ''} />
                            Refresh
                        </button>

                        <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={handleDownloadCsv}
                            disabled={loading || !report}
                            style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', padding: '6px 14px' }}
                        >
                            <Download size={14} />
                            Export CSV
                        </button>
                    </div>
                </div>

                {error && (
                    <div style={{ padding: '12px 16px', background: '#fee2e2', border: '1px solid #f87171', borderRadius: '8px', color: '#991b1b', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <AlertCircle size={16} />
                        <span>{error}</span>
                    </div>
                )}

                {/* Section 9.1: Primary KPI Cards */}
                {report && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px', marginBottom: '24px' }}>
                        {/* 1. XerService Earnings */}
                        <div className="card" style={{ padding: '18px 20px', borderRadius: '12px', background: 'var(--card-bg, #ffffff)', border: '1px solid var(--border-color, #e2e8f0)', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                                <span style={{ fontSize: '13px', color: 'var(--text-muted)', fontWeight: '500' }}>XerService Earnings</span>
                                <button
                                    type="button"
                                    onClick={() => setShowTooltip(showTooltip === 'xerServiceEarnings' ? null : 'xerServiceEarnings')}
                                    style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0 }}
                                    title="Platform commission details"
                                >
                                    <Info size={14} />
                                </button>
                            </div>
                            <div style={{ fontSize: '24px', fontWeight: '700', color: 'var(--primary-color, #0284c7)', marginBottom: '8px' }}>
                                ₹{report.kpis.xerServiceEarnings.current.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                {renderComparisonBadge(report.kpis.xerServiceEarnings)}
                                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Net platform fee</span>
                            </div>
                        </div>

                        {/* 2. Service Revenue */}
                        <div className="card" style={{ padding: '18px 20px', borderRadius: '12px', background: 'var(--card-bg, #ffffff)', border: '1px solid var(--border-color, #e2e8f0)', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                                <span style={{ fontSize: '13px', color: 'var(--text-muted)', fontWeight: '500' }}>Service Revenue</span>
                                <button
                                    type="button"
                                    onClick={() => setShowTooltip(showTooltip === 'serviceRevenue' ? null : 'serviceRevenue')}
                                    style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0 }}
                                >
                                    <Info size={14} />
                                </button>
                            </div>
                            <div style={{ fontSize: '24px', fontWeight: '700', color: '#0f172a', marginBottom: '8px' }}>
                                ₹{report.kpis.serviceRevenue.current.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                {renderComparisonBadge(report.kpis.serviceRevenue)}
                                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Customer collections</span>
                            </div>
                        </div>

                        {/* 3. Shop Earnings */}
                        <div className="card" style={{ padding: '18px 20px', borderRadius: '12px', background: 'var(--card-bg, #ffffff)', border: '1px solid var(--border-color, #e2e8f0)', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                                <span style={{ fontSize: '13px', color: 'var(--text-muted)', fontWeight: '500' }}>Shop Earnings</span>
                                <button
                                    type="button"
                                    onClick={() => setShowTooltip(showTooltip === 'shopEarnings' ? null : 'shopEarnings')}
                                    style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0 }}
                                >
                                    <Info size={14} />
                                </button>
                            </div>
                            <div style={{ fontSize: '24px', fontWeight: '700', color: '#16a34a', marginBottom: '8px' }}>
                                ₹{report.kpis.shopEarnings.current.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                {renderComparisonBadge(report.kpis.shopEarnings)}
                                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Vendor net share</span>
                            </div>
                        </div>

                        {/* 4. Confirmed Refunds */}
                        <div className="card" style={{ padding: '18px 20px', borderRadius: '12px', background: 'var(--card-bg, #ffffff)', border: '1px solid var(--border-color, #e2e8f0)', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                                <span style={{ fontSize: '13px', color: 'var(--text-muted)', fontWeight: '500' }}>Confirmed Refunds</span>
                                <button
                                    type="button"
                                    onClick={() => setShowTooltip(showTooltip === 'confirmedRefunds' ? null : 'confirmedRefunds')}
                                    style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0 }}
                                >
                                    <Info size={14} />
                                </button>
                            </div>
                            <div style={{ fontSize: '24px', fontWeight: '700', color: '#dc2626', marginBottom: '8px' }}>
                                ₹{report.kpis.confirmedRefunds.current.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                                    {report.refunds.confirmedRefunds.count} refund(s)
                                </span>
                                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Fully reversed</span>
                            </div>
                        </div>

                        {/* 5. Orders Included */}
                        <div className="card" style={{ padding: '18px 20px', borderRadius: '12px', background: 'var(--card-bg, #ffffff)', border: '1px solid var(--border-color, #e2e8f0)', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                                <span style={{ fontSize: '13px', color: 'var(--text-muted)', fontWeight: '500' }}>Orders Included</span>
                                <button
                                    type="button"
                                    onClick={() => setShowTooltip(showTooltip === 'ordersIncluded' ? null : 'ordersIncluded')}
                                    style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0 }}
                                >
                                    <Info size={14} />
                                </button>
                            </div>
                            <div style={{ fontSize: '24px', fontWeight: '700', color: '#0f172a', marginBottom: '8px' }}>
                                {report.kpis.ordersIncluded.current}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                {renderComparisonBadge(report.kpis.ordersIncluded, false)}
                                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>In reporting window</span>
                            </div>
                        </div>
                    </div>
                )}

                {/* Operational distinction banner */}
                <div style={{
                    padding: '12px 18px',
                    borderRadius: '8px',
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    fontSize: '12px',
                    color: '#475569',
                    marginBottom: '24px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: '12px',
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Info size={15} style={{ color: '#0284c7' }} />
                        <span>
                            <strong>Money Earned vs. Money Transferred:</strong> Customer collections represent gross platform turnover. Platform earnings represent retained commission. Transferred payouts reflect disbursed settlements (Total Disbursed: ₹{report?.kpis.settledDisbursements.current.toLocaleString('en-IN', { minimumFractionDigits: 2 }) || '0.00'}).
                        </span>
                    </div>
                    <a href="/admin/settlements" style={{ color: '#0284c7', textDecoration: 'none', fontWeight: '500' }}>
                        View Settlements Control Center →
                    </a>
                </div>

                {/* Section 9.2: Refunds & Cancellations Breakdown */}
                {report && (
                    <div className="card" style={{ padding: '20px', borderRadius: '12px', background: 'var(--card-bg, #ffffff)', border: '1px solid var(--border-color, #e2e8f0)', marginBottom: '24px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
                            <h3 style={{ fontSize: '16px', fontWeight: '600', margin: 0 }}>Refunds & Cancellations Breakdown</h3>
                            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Section 9.2 Authoritative States</span>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px' }}>
                            {/* 1. Unpaid cancellations */}
                            <div style={{ padding: '14px', borderRadius: '8px', background: '#f8fafc', border: '1px solid #e2e8f0' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                                    <XCircle size={15} style={{ color: '#64748b' }} />
                                    <span style={{ fontSize: '13px', fontWeight: '600', color: '#334155' }}>Unpaid Cancellations</span>
                                </div>
                                <div style={{ fontSize: '18px', fontWeight: '700', color: '#0f172a' }}>
                                    {report.refunds.unpaidCancellations.count} order(s)
                                </div>
                                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                                    Operational count; no customer money taken or refunded.
                                </div>
                            </div>

                            {/* 2. Paid cancellations awaiting refund */}
                            <div style={{ padding: '14px', borderRadius: '8px', background: '#fffbeb', border: '1px solid #fef3c7' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                                    <Clock size={15} style={{ color: '#d97706' }} />
                                    <span style={{ fontSize: '13px', fontWeight: '600', color: '#92400e' }}>Awaiting Refund</span>
                                </div>
                                <div style={{ fontSize: '18px', fontWeight: '700', color: '#b45309' }}>
                                    ₹{report.refunds.paidCancellationsAwaitingRefund.totalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                                </div>
                                <div style={{ fontSize: '11px', color: '#92400e', marginTop: '4px' }}>
                                    {report.refunds.paidCancellationsAwaitingRefund.count} order(s); shop earnings held pending payout.
                                </div>
                            </div>

                            {/* 3. Confirmed refunds */}
                            <div style={{ padding: '14px', borderRadius: '8px', background: '#fef2f2', border: '1px solid #fecaca' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                                    <CheckCircle2 size={15} style={{ color: '#dc2626' }} />
                                    <span style={{ fontSize: '13px', fontWeight: '600', color: '#991b1b' }}>Confirmed Refunds</span>
                                </div>
                                <div style={{ fontSize: '18px', fontWeight: '700', color: '#dc2626' }}>
                                    ₹{report.refunds.confirmedRefunds.totalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                                </div>
                                <div style={{ fontSize: '11px', color: '#991b1b', marginTop: '4px' }}>
                                    {report.refunds.confirmedRefunds.count} successful refund(s); full ledger reversal recorded.
                                </div>
                            </div>

                            {/* 4. Failed / Pending attention refunds */}
                            <div style={{ padding: '14px', borderRadius: '8px', background: '#faf5ff', border: '1px solid #f3e8ff' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                                    <AlertCircle size={15} style={{ color: '#9333ea' }} />
                                    <span style={{ fontSize: '13px', fontWeight: '600', color: '#6b21a8' }}>Pending / Attention</span>
                                </div>
                                <div style={{ fontSize: '18px', fontWeight: '700', color: '#7e22ce' }}>
                                    ₹{report.refunds.failedPendingRefunds.totalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                                </div>
                                <div style={{ fontSize: '11px', color: '#6b21a8', marginTop: '4px' }}>
                                    {report.refunds.failedPendingRefunds.count} refund(s) requiring gateway or admin reconciliation.
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Shop Breakdown Table */}
                <div className="card" style={{ padding: '20px', borderRadius: '12px', background: 'var(--card-bg, #ffffff)', border: '1px solid var(--border-color, #e2e8f0)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
                        <div>
                            <h3 style={{ fontSize: '16px', fontWeight: '600', margin: 0 }}>Shop-by-Shop Breakdown</h3>
                            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                                Reconciled arithmetic across all registered shops
                            </span>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div style={{ position: 'relative' }}>
                                <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                                <input
                                    type="text"
                                    placeholder="Search shops…"
                                    value={shopSearch}
                                    onChange={e => setShopSearch(e.target.value)}
                                    style={{
                                        padding: '6px 12px 6px 30px',
                                        fontSize: '13px',
                                        borderRadius: '6px',
                                        border: '1px solid var(--border-color, #cbd5e1)',
                                        outline: 'none',
                                    }}
                                />
                            </div>
                        </div>
                    </div>

                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                            <thead>
                                <tr style={{ borderBottom: '2px solid var(--border-color, #e2e8f0)', textAlign: 'left', color: 'var(--text-muted)' }}>
                                    <th style={{ padding: '10px 12px' }}>Shop</th>
                                    <th style={{ padding: '10px 12px', textAlign: 'right' }}>Orders</th>
                                    <th style={{ padding: '10px 12px', textAlign: 'right' }}>Service Revenue</th>
                                    <th style={{ padding: '10px 12px', textAlign: 'right' }}>XerService Fee</th>
                                    <th style={{ padding: '10px 12px', textAlign: 'right' }}>Shop Net</th>
                                    <th style={{ padding: '10px 12px', textAlign: 'right' }}>Refunds</th>
                                    <th style={{ padding: '10px 12px', textAlign: 'right' }}>Unallocated</th>
                                    <th style={{ padding: '10px 12px', textAlign: 'right' }}>Disbursed</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredShops.length === 0 ? (
                                    <tr>
                                        <td colSpan={8} style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)' }}>
                                            No shop data found for this period.
                                        </td>
                                    </tr>
                                ) : (
                                    filteredShops.map(s => (
                                        <tr key={s.shopId} style={{ borderBottom: '1px solid var(--border-color, #f1f5f9)' }}>
                                            <td style={{ padding: '12px' }}>
                                                <div style={{ fontWeight: '600', color: '#0f172a' }}>{s.shopName}</div>
                                                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{s.shopId.slice(0, 8)}…</div>
                                            </td>
                                            <td style={{ padding: '12px', textAlign: 'right' }}>
                                                {s.ordersCount}
                                            </td>
                                            <td style={{ padding: '12px', textAlign: 'right', fontWeight: '500' }}>
                                                ₹{s.serviceRevenue.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                                            </td>
                                            <td style={{ padding: '12px', textAlign: 'right', color: 'var(--primary-color, #0284c7)', fontWeight: '500' }}>
                                                ₹{s.xerServiceEarnings.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                                            </td>
                                            <td style={{ padding: '12px', textAlign: 'right', color: '#16a34a', fontWeight: '600' }}>
                                                ₹{s.shopEarnings.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                                            </td>
                                            <td style={{ padding: '12px', textAlign: 'right', color: s.confirmedRefunds > 0 ? '#dc2626' : 'var(--text-muted)' }}>
                                                ₹{s.confirmedRefunds.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                                            </td>
                                            <td style={{ padding: '12px', textAlign: 'right', color: s.unallocatedAmount > 0 ? '#d97706' : 'var(--text-muted)' }}>
                                                {s.unallocatedCount > 0 ? (
                                                    <span title={`${s.unallocatedCount} unconfigured order(s)`}>
                                                        ₹{s.unallocatedAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })} ({s.unallocatedCount})
                                                    </span>
                                                ) : '—'}
                                            </td>
                                            <td style={{ padding: '12px', textAlign: 'right', color: '#475569' }}>
                                                ₹{s.settledAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                            {filteredShops.length > 0 && report && (
                                <tfoot>
                                    <tr style={{ borderTop: '2px solid var(--border-color, #cbd5e1)', fontWeight: '700', background: '#f8fafc' }}>
                                        <td style={{ padding: '12px' }}>Total ({filteredShops.length} Shops)</td>
                                        <td style={{ padding: '12px', textAlign: 'right' }}>
                                            {filteredShops.reduce((acc, s) => acc + s.ordersCount, 0)}
                                        </td>
                                        <td style={{ padding: '12px', textAlign: 'right' }}>
                                            ₹{filteredShops.reduce((acc, s) => acc + s.serviceRevenue, 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                                        </td>
                                        <td style={{ padding: '12px', textAlign: 'right', color: 'var(--primary-color, #0284c7)' }}>
                                            ₹{filteredShops.reduce((acc, s) => acc + s.xerServiceEarnings, 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                                        </td>
                                        <td style={{ padding: '12px', textAlign: 'right', color: '#16a34a' }}>
                                            ₹{filteredShops.reduce((acc, s) => acc + s.shopEarnings, 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                                        </td>
                                        <td style={{ padding: '12px', textAlign: 'right' }}>
                                            ₹{filteredShops.reduce((acc, s) => acc + s.confirmedRefunds, 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                                        </td>
                                        <td style={{ padding: '12px', textAlign: 'right' }}>
                                            ₹{filteredShops.reduce((acc, s) => acc + s.unallocatedAmount, 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                                        </td>
                                        <td style={{ padding: '12px', textAlign: 'right' }}>
                                            ₹{filteredShops.reduce((acc, s) => acc + s.settledAmount, 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                                        </td>
                                    </tr>
                                </tfoot>
                            )}
                        </table>
                    </div>
                </div>
            </div>

            {/* Custom Range Modal */}
            {showCustomModal && (
                <div style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    background: 'rgba(0, 0, 0, 0.5)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 1000,
                }}>
                    <div style={{ background: '#ffffff', borderRadius: '12px', padding: '24px', width: '400px', maxWidth: '90%' }}>
                        <h3 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '16px' }}>Select Custom Reporting Range</h3>
                        <div style={{ marginBottom: '16px' }}>
                            <label style={{ display: 'block', fontSize: '13px', fontWeight: '500', marginBottom: '6px' }}>Start Date (IST)</label>
                            <input
                                type="date"
                                value={customStart}
                                onChange={e => setCustomStart(e.target.value)}
                                style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                            />
                        </div>
                        <div style={{ marginBottom: '20px' }}>
                            <label style={{ display: 'block', fontSize: '13px', fontWeight: '500', marginBottom: '6px' }}>End Date (IST)</label>
                            <input
                                type="date"
                                value={customEnd}
                                onChange={e => setCustomEnd(e.target.value)}
                                style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                            />
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                            <button
                                type="button"
                                className="btn btn-secondary"
                                onClick={() => setShowCustomModal(false)}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                className="btn btn-primary"
                                onClick={applyCustomRange}
                                disabled={!customStart || !customEnd}
                            >
                                Apply Period
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

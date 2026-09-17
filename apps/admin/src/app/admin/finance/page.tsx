'use client';

import { Suspense, useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
import AdminHeaderNav from '@/components/admin/AdminHeaderNav';
import {
    CheckCircle2,
    Clock,
    AlertTriangle,
    Plus,
    Check,
    X,
    ArrowRight,
    RefreshCw,
    Shield,
    ChevronRight,
    Info,
} from 'lucide-react';

type FinanceTab = 'overview' | 'shops' | 'settlements';
const financeTabs: Array<{ id: FinanceTab; label: string }> = [
    { id: 'overview', label: 'Summary' },
    { id: 'shops', label: 'Shops & fees' },
    { id: 'settlements', label: 'Payments to shops' },
];

function financialStatusLabel(status: string) {
    return ({ UNCONFIGURED: 'Fee needed', PENDING: 'In progress', PAYABLE: 'Ready to pay', SETTLED: 'Paid', REVERSED: 'Refunded or cancelled' } as Record<string, string>)[status] || status;
}

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

interface ShopItem {
    shopId: string;
    shopName: string;
    shopStatus: string;
    address?: string | null;
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
    activeCommissionRule: {
        id: string;
        commission_bps: number;
        commissionPercentage: number;
        effective_from: string;
        effective_to: string | null;
    } | null;
}

interface CommissionRule {
    id: string;
    shopId: string;
    shopName: string;
    commissionBps: number;
    commissionPercentage: number;
    effectiveFrom: string;
    effectiveTo: string | null;
    isActive: boolean;
    createdAt: string;
}

interface SettlementItem {
    id: string;
    shopId: string;
    shopName: string;
    settlementNumber: string;
    grossOrderAmount: number;
    platformCommissionAmount: number;
    vendorPayableAmount: number;
    orderCount: number;
    status: 'DRAFT' | 'CONFIRMED' | 'PAID' | 'CANCELLED';
    paymentReference: string | null;
    paymentMethod: string | null;
    settledAt: string | null;
    notes: string | null;
    createdAt: string;
}

export default function AdminFinancePage() {
    return <Suspense fallback={<p role="status" style={{ padding: '32px' }}>Loading payments…</p>}><AdminFinanceContent /></Suspense>;
}

function AdminFinanceContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [token, setToken] = useState<string | null>(null);
    const [authChecking, setAuthChecking] = useState(true);
    const [authError, setAuthError] = useState<string | null>(null);

    const [activeTab, setActiveTab] = useState<FinanceTab>('overview');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);

    // Data States
    const [summary, setSummary] = useState<FinanceSummary | null>(null);
    const [shops, setShops] = useState<ShopItem[]>([]);
    const [rules, setRules] = useState<CommissionRule[]>([]);
    const [settlements, setSettlements] = useState<SettlementItem[]>([]);

    // Drilldown State
    const [selectedShopDetails, setSelectedShopDetails] = useState<any | null>(null);
    const [shopDetailsLoading, setShopDetailsLoading] = useState(false);

    // Create Rule Modal State
    const [showRuleModal, setShowRuleModal] = useState(false);
    const [ruleShopId, setRuleShopId] = useState('');
    const [rulePercentage, setRulePercentage] = useState('');
    const [ruleEffectiveFrom, setRuleEffectiveFrom] = useState('');
    const [ruleEffectiveTo, setRuleEffectiveTo] = useState('');
    const [ruleClosePrevious, setRuleClosePrevious] = useState(true);
    const [ruleSubmitting, setRuleSubmitting] = useState(false);

    // Create Settlement Modal State
    const [showSettlementModal, setShowSettlementModal] = useState(false);
    const [settleShopId, setSettleShopId] = useState('');
    const [eligibleOrders, setEligibleOrders] = useState<any[]>([]);
    const [selectedLedgerIds, setSelectedLedgerIds] = useState<string[]>([]);
    const [settleNotes, setSettleNotes] = useState('');
    const [settleLoadingOrders, setSettleLoadingOrders] = useState(false);
    const [settleSubmitting, setSettleSubmitting] = useState(false);

    // Mark Paid Modal State
    const [payingBatch, setPayingBatch] = useState<SettlementItem | null>(null);
    const [paymentMethod, setPaymentMethod] = useState('UPI');
    const [paymentReference, setPaymentReference] = useState('');
    const [paidSubmitting, setPaidSubmitting] = useState(false);

    const selectTab = useCallback((tab: FinanceTab) => {
        setActiveTab(tab);
        const view = tab === 'overview' ? 'summary' : tab === 'settlements' ? 'payouts' : 'shops';
        router.replace(`/admin/finance?view=${view}`, { scroll: false });
    }, [router]);

    useEffect(() => {
        const view = searchParams.get('view');
        setActiveTab(view === 'shops' ? 'shops' : view === 'payouts' ? 'settlements' : 'overview');
    }, [searchParams]);

    // Authoritative Token Retriever ensures requests use active/refreshed session token
    const getValidToken = useCallback(async (): Promise<string | null> => {
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (session?.access_token) {
                if (session.access_token !== token) {
                    setToken(session.access_token);
                }
                return session.access_token;
            }
        } catch (err) {
            console.error('[AdminFinance] Error retrieving session token:', err);
        }
        return token;
    }, [token]);

    // Initial Auth Check & Session Subscription
    useEffect(() => {
        let mounted = true;

        async function checkAdmin() {
            setAuthChecking(true);
            setAuthError(null);
            try {
                const { data: { session }, error: sessionErr } = await supabase.auth.getSession();
                const sessionToken = session?.access_token;
                if (sessionErr || !session?.user || !sessionToken) {
                    if (mounted) {
                        setAuthChecking(false);
                        router.replace('/xad/login?redirect=/admin/finance');
                    }
                    return;
                }

                // Check profile role in database
                const { data: profile, error: profErr } = await supabase
                    .from('profiles')
                    .select('id, user_id, role, full_name')
                    .eq('user_id', session.user.id)
                    .maybeSingle();

                if (profErr || !profile || profile.role !== 'admin') {
                    if (mounted) {
                        setAuthError('Admin access required. Current account does not have admin privileges.');
                        setAuthChecking(false);
                    }
                    return;
                }

                if (mounted) {
                    setToken(sessionToken);
                }

                // Authoritative backend verification
                const res = await fetch('/api/admin/finance/summary', {
                    headers: { Authorization: `Bearer ${sessionToken}` },
                });

                if (res.status === 401) {
                    if (mounted) {
                        setAuthChecking(false);
                        router.replace('/xad/login?redirect=/admin/finance');
                    }
                    return;
                }

                if (res.status === 403) {
                    if (mounted) {
                        setAuthError('Access denied: Admin privileges required.');
                        setAuthChecking(false);
                    }
                    return;
                }

                if (!res.ok) {
                    throw new Error((await res.json()).error || 'Failed to load summary');
                }

                const sumData = await res.json();
                if (mounted) {
                    setSummary(sumData);
                    setAuthChecking(false);
                }
            } catch (err: any) {
                if (mounted) {
                    setAuthError(err.message || 'Failed to authenticate admin session.');
                    setAuthChecking(false);
                }
            }
        }

        checkAdmin();

        // Listen for token refresh and sign out events
        const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
            if (!mounted) return;
            if (event === 'TOKEN_REFRESHED' && session?.access_token) {
                setToken(session.access_token);
            } else if (event === 'SIGNED_OUT') {
                setToken(null);
                setSummary(null);
                setAuthChecking(false);
                router.replace('/xad/login?redirect=/admin/finance');
            }
        });

        return () => {
            mounted = false;
            subscription.unsubscribe();
        };
    }, [router]);

    // Load Data for Active Tab
    const loadTabData = useCallback(async (tab: FinanceTab, authToken: string) => {
        setLoading(true);
        setError(null);
        try {
            if (tab === 'overview') {
                const res = await fetch('/api/admin/finance/summary', {
                    headers: { Authorization: `Bearer ${authToken}` },
                });
                if (!res.ok) throw new Error((await res.json()).error || 'Failed to load summary');
                setSummary(await res.json());
            } else if (tab === 'shops') {
                const [rRes, sRes] = await Promise.all([
                    fetch('/api/admin/finance/commission-rules', { headers: { Authorization: `Bearer ${authToken}` } }),
                    fetch('/api/admin/finance/shops', { headers: { Authorization: `Bearer ${authToken}` } }),
                ]);
                if (!rRes.ok) throw new Error((await rRes.json()).error || 'Failed to load rules');
                const rData = await rRes.json();
                const sData = await sRes.json();
                setRules(rData.rules || []);
                setShops(sData.shops || []);
            } else if (tab === 'settlements') {
                const [setRes, sRes] = await Promise.all([
                    fetch('/api/admin/finance/settlements', { headers: { Authorization: `Bearer ${authToken}` } }),
                    fetch('/api/admin/finance/shops', { headers: { Authorization: `Bearer ${authToken}` } }),
                ]);
                if (!setRes.ok) throw new Error((await setRes.json()).error || 'Failed to load settlements');
                const setData = await setRes.json();
                const sData = await sRes.json();
                setSettlements(setData.settlements || []);
                setShops(sData.shops || []);
            }
        } catch (err: any) {
            setError(err.message || 'Error loading finance data');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (token && !authChecking && !authError) {
            loadTabData(activeTab, token);
        }
    }, [activeTab, token, authChecking, authError, loadTabData]);

    // Drilldown into shop ledger
    const handleViewShopDetails = async (shopId: string) => {
        const authToken = await getValidToken();
        if (!authToken) return;
        setShopDetailsLoading(true);
        try {
            const res = await fetch(`/api/admin/finance/shops/${shopId}`, {
                headers: { Authorization: `Bearer ${authToken}` },
            });
            if (!res.ok) throw new Error((await res.json()).error || 'Failed to fetch shop details');
            const data = await res.json();
            setSelectedShopDetails(data);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setShopDetailsLoading(false);
        }
    };

    // Create Commission Rule Handler
    const handleCreateRule = async (e: React.FormEvent) => {
        e.preventDefault();
        const authToken = await getValidToken();
        if (!authToken) return;

        const decParts = rulePercentage.trim().split('.');
        if (decParts.length === 2 && decParts[1].length > 2) {
            setError('The XerService fee can use up to 2 decimal places (for example, 7.5 or 7.50).');
            return;
        }

        setRuleSubmitting(true);
        setError(null);
        try {
            const res = await fetch('/api/admin/finance/commission-rules', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${authToken}`,
                },
                body: JSON.stringify({
                    shop_id: ruleShopId,
                    commission_percentage: parseFloat(rulePercentage),
                    effective_from: ruleEffectiveFrom ? new Date(ruleEffectiveFrom).toISOString() : undefined,
                    effective_to: ruleEffectiveTo ? new Date(ruleEffectiveTo).toISOString() : undefined,
                    close_previous: ruleClosePrevious,
                }),
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to create commission rule');

            setSuccessMessage(data.message || 'Shop fee saved.');
            setShowRuleModal(false);
            setRulePercentage('');
            setRuleShopId('');
            setRuleEffectiveFrom('');
            setRuleEffectiveTo('');
            loadTabData('shops', authToken);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setRuleSubmitting(false);
        }
    };

    // Bulk Apply Rule Handler
    const handleApplyRule = async (ruleId: string) => {
        const authToken = await getValidToken();
        if (!authToken) return;
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(`/api/admin/finance/commission-rules/${ruleId}/apply`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${authToken}` },
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to apply rule');

            setSuccessMessage(data.message || 'Shop fee applied to earlier orders.');
            loadTabData('shops', authToken);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    // Load Eligible Payable Orders for Settlement Modal
    const handleSelectShopForSettlement = async (shopId: string) => {
        setSettleShopId(shopId);
        setSelectedLedgerIds([]);
        const authToken = await getValidToken();
        if (!shopId || !authToken) {
            setEligibleOrders([]);
            return;
        }

        setSettleLoadingOrders(true);
        try {
            const res = await fetch(`/api/admin/finance/shops/${shopId}`, {
                headers: { Authorization: `Bearer ${authToken}` },
            });
            const data = await res.json();
            const payables = (data.ledgers || []).filter((l: any) => l.financialStatus === 'PAYABLE');
            setEligibleOrders(payables);
            // Default select all eligible payables
            setSelectedLedgerIds(payables.map((p: any) => p.id));
        } catch (err: any) {
            setError(err.message);
        } finally {
            setSettleLoadingOrders(false);
        }
    };

    // Create Settlement Batch Handler
    const handleCreateSettlement = async (e: React.FormEvent) => {
        e.preventDefault();
        const authToken = await getValidToken();
        if (!authToken || selectedLedgerIds.length === 0) return;
        setSettleSubmitting(true);
        setError(null);
        try {
            const res = await fetch('/api/admin/finance/settlements', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${authToken}`,
                },
                body: JSON.stringify({
                    shop_id: settleShopId,
                    order_ledger_ids: selectedLedgerIds,
                    notes: settleNotes || undefined,
                }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to create settlement batch');

            setSuccessMessage(data.message || 'Shop payment batch created.');
            setShowSettlementModal(false);
            setSettleShopId('');
            setSelectedLedgerIds([]);
            setSettleNotes('');
            loadTabData('settlements', authToken);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setSettleSubmitting(false);
        }
    };

    // Confirm Settlement Batch
    const handleConfirmBatch = async (batchId: string) => {
        const authToken = await getValidToken();
        if (!authToken) return;
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(`/api/admin/finance/settlements/${batchId}/confirm`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${authToken}` },
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to confirm settlement batch');
            setSuccessMessage(data.message);
            loadTabData('settlements', authToken);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    // Cancel Settlement Batch
    const handleCancelBatch = async (batchId: string) => {
        const authToken = await getValidToken();
        if (!authToken) return;
        if (!window.confirm('Cancel this shop payment batch? Its orders will return to the ready-to-pay list.')) {
            return;
        }
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(`/api/admin/finance/settlements/${batchId}/cancel`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${authToken}` },
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to cancel settlement batch');
            setSuccessMessage(data.message);
            loadTabData('settlements', authToken);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    // Mark Paid External Submission
    const handleMarkPaid = async (e: React.FormEvent) => {
        e.preventDefault();
        const authToken = await getValidToken();
        if (!authToken || !payingBatch) return;
        setPaidSubmitting(true);
        setError(null);
        try {
            const res = await fetch(`/api/admin/finance/settlements/${payingBatch.id}/mark-paid`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${authToken}`,
                },
                body: JSON.stringify({
                    payment_method: paymentMethod,
                    payment_reference: paymentReference.trim(),
                }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to mark settlement as PAID');

            setSuccessMessage(data.message);
            setPayingBatch(null);
            setPaymentReference('');
            loadTabData('settlements', authToken);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setPaidSubmitting(false);
        }
    };

    if (authChecking) {
        return (
            <div style={{ minHeight: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ textAlign: 'center' }}>
                    <RefreshCw className="animate-spin" size={32} style={{ margin: '0 auto 12px', color: 'var(--accent)' }} />
                    <p style={{ color: 'var(--fg-muted)' }}>Verifying administrative permissions...</p>
                </div>
            </div>
        );
    }

    if (authError) {
        return (
            <div style={{ minHeight: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
                <div className="card" style={{ maxWidth: '440px', textAlign: 'center', padding: '32px' }}>
                    <Shield size={48} style={{ color: '#ef4444', margin: '0 auto 16px' }} />
                    <h2 style={{ fontSize: '20px', fontWeight: '800', marginBottom: '8px' }}>Admin Access Denied</h2>
                    <p style={{ color: 'var(--fg-muted)', fontSize: '14px', marginBottom: '20px' }}>{authError}</p>
                    <Link href="/xad/login" className="btn btn-accent btn-full">
                        Sign In as Admin
                    </Link>
                </div>
            </div>
        );
    }

    return (
        <div style={{ maxWidth: '1280px', margin: '0 auto', padding: '32px 16px' }}>
            {/* Header Navigation */}
            <AdminHeaderNav
                activeSection="finance"
                title={activeTab === 'shops' ? 'Shops and fees' : activeTab === 'settlements' ? 'Payments to shops' : 'Payments and shop earnings'}
                description={activeTab === 'shops' ? 'Review each shop’s earnings and set the XerService fee.' : activeTab === 'settlements' ? 'Prepare completed orders and record payments made to shops.' : 'Review customer payments, XerService fees, shop earnings, refunds, and payments to shops.'}
                actions={
                    <button
                        onClick={async () => {
                            const curToken = await getValidToken();
                            if (curToken) loadTabData(activeTab, curToken);
                        }}
                        className="btn btn-secondary"
                        style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                        disabled={loading}
                    >
                        <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                        Refresh
                    </button>
                }
            />

            {/* Success Notification */}
            {successMessage && (
                <div style={{ marginBottom: '20px', padding: '12px 16px', borderRadius: '12px', background: 'rgba(34, 197, 94, 0.1)', border: '1px solid rgba(34, 197, 94, 0.25)', color: '#16a34a', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '14px', fontWeight: '600' }}>
                        <CheckCircle2 size={18} />
                        <span>{successMessage}</span>
                    </div>
                    <button onClick={() => setSuccessMessage(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#16a34a' }}>
                        <X size={16} />
                    </button>
                </div>
            )}

            {/* Error Notification */}
            {error && (
                <div style={{ marginBottom: '20px', padding: '12px 16px', borderRadius: '12px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.25)', color: '#dc2626', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '14px', fontWeight: '600' }}>
                        <AlertTriangle size={18} />
                        <span>{error}</span>
                    </div>
                    <button onClick={() => setError(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626' }}>
                        <X size={16} />
                    </button>
                </div>
            )}

            <div role="tablist" aria-label="Payment views" style={{ display: 'flex', overflowX: 'auto', borderBottom: '1px solid var(--border)', marginBottom: '28px', gap: '4px' }}>
                {financeTabs.map(tab => (
                    <button key={tab.id} type="button" role="tab" aria-selected={activeTab === tab.id} onClick={() => selectTab(tab.id)} style={{ padding: '12px 20px', borderTop: 'none', borderRight: 'none', borderLeft: 'none', borderBottom: activeTab === tab.id ? '2px solid var(--accent)' : '2px solid transparent', color: activeTab === tab.id ? 'var(--accent)' : 'var(--fg-muted)', fontWeight: activeTab === tab.id ? '800' : '600', background: 'none', cursor: 'pointer', fontSize: '15px', whiteSpace: 'nowrap' }}>
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* TAB 1: OVERVIEW */}
            {activeTab === 'overview' && summary && (
                <div>
                    {!summary.commissionConfigured && (
                        <div style={{ marginBottom: '24px', padding: '16px', borderRadius: '14px', background: 'rgba(234, 179, 8, 0.1)', border: '1px solid rgba(234, 179, 8, 0.3)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                <Info size={24} style={{ color: '#ca8a04' }} />
                                <div>
                                    <div style={{ fontWeight: '800', color: '#a16207', fontSize: '15px' }}>No commission configured yet</div>
                                    <div style={{ fontSize: '13px', color: 'var(--fg-muted)', marginTop: '2px' }}>
                                        {summary.unconfiguredOrdersCount} historical order(s) currently unconfigured. Create a shop commission rule to establish platform revenue.
                                    </div>
                                </div>
                            </div>
                            <button onClick={() => setShowRuleModal(true)} className="btn btn-accent btn-sm">
                                Set a shop fee <ArrowRight size={14} />
                            </button>
                        </div>
                    )}

                    {/* Primary Metrics Grid */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px', marginBottom: '24px' }}>
                        <div className="card" style={{ padding: '20px' }}>
                            <div style={{ fontSize: '13px', color: 'var(--fg-muted)', fontWeight: '600' }}>Customer payments</div>
                            <div style={{ fontSize: '28px', fontWeight: '900', marginTop: '6px', color: 'var(--fg)' }}>
                                ₹{summary.grossSales.toFixed(2)}
                            </div>
                            <div style={{ fontSize: '12px', color: 'var(--fg-subtle)', marginTop: '4px' }}>
                                Paid orders, excluding refunds
                            </div>
                        </div>

                        <div className="card" style={{ padding: '20px' }}>
                            <div style={{ fontSize: '13px', color: 'var(--fg-muted)', fontWeight: '600' }}>XerService fees</div>
                            <div style={{ fontSize: '28px', fontWeight: '900', marginTop: '6px', color: summary.platformCommission !== null ? 'var(--accent)' : 'var(--fg-subtle)' }}>
                                {summary.platformCommission !== null ? `₹${summary.platformCommission.toFixed(2)}` : '—'}
                            </div>
                            <div style={{ fontSize: '12px', color: 'var(--fg-subtle)', marginTop: '4px' }}>
                                {summary.commissionConfigured ? 'Fees calculated from shop rules' : 'Shop fee setup needed'}
                            </div>
                        </div>

                        <div className="card" style={{ padding: '20px' }}>
                            <div style={{ fontSize: '13px', color: 'var(--fg-muted)', fontWeight: '600' }}>Ready to pay shops</div>
                            <div style={{ fontSize: '28px', fontWeight: '900', marginTop: '6px', color: '#16a34a' }}>
                                {summary.payableAmount !== null ? `₹${summary.payableAmount.toFixed(2)}` : '—'}
                            </div>
                            <div style={{ fontSize: '12px', color: 'var(--fg-subtle)', marginTop: '4px' }}>
                                Completed orders eligible for payment
                            </div>
                        </div>

                        <div className="card" style={{ padding: '20px' }}>
                            <div style={{ fontSize: '13px', color: 'var(--fg-muted)', fontWeight: '600' }}>Paid to shops</div>
                            <div style={{ fontSize: '28px', fontWeight: '900', marginTop: '6px', color: 'var(--fg)' }}>
                                ₹{summary.settledAmount.toFixed(2)}
                            </div>
                            <div style={{ fontSize: '12px', color: 'var(--fg-subtle)', marginTop: '4px' }}>
                                External transfers recorded as paid
                            </div>
                        </div>
                    </div>

                    {/* Secondary Metrics Grid */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
                        <div className="card" style={{ padding: '16px' }}>
                            <div style={{ fontSize: '12px', color: 'var(--fg-muted)', fontWeight: '600' }}>Shop earnings in progress</div>
                            <div style={{ fontSize: '20px', fontWeight: '800', marginTop: '4px' }}>
                                {summary.pendingAmount !== null ? `₹${summary.pendingAmount.toFixed(2)}` : '—'}
                            </div>
                            <div style={{ fontSize: '11px', color: 'var(--fg-subtle)', marginTop: '2px' }}>Paid orders still being prepared</div>
                        </div>

                        <div className="card" style={{ padding: '16px' }}>
                            <div style={{ fontSize: '12px', color: 'var(--fg-muted)', fontWeight: '600' }}>Refunds and cancellations</div>
                            <div style={{ fontSize: '20px', fontWeight: '800', marginTop: '4px', color: '#dc2626' }}>
                                ₹{summary.reversedAmount.toFixed(2)}
                            </div>
                            <div style={{ fontSize: '11px', color: 'var(--fg-subtle)', marginTop: '2px' }}>Excluded from payable</div>
                        </div>

                        <div className="card" style={{ padding: '16px' }}>
                            <div style={{ fontSize: '12px', color: 'var(--fg-muted)', fontWeight: '600' }}>Orders included</div>
                            <div style={{ fontSize: '20px', fontWeight: '800', marginTop: '4px' }}>{summary.totalOrdersCount}</div>
                            <div style={{ fontSize: '11px', color: 'var(--fg-subtle)', marginTop: '2px' }}>Orders with payment records</div>
                        </div>

                        <div className="card" style={{ padding: '16px' }}>
                            <div style={{ fontSize: '12px', color: 'var(--fg-muted)', fontWeight: '600' }}>Shop payment batches</div>
                            <div style={{ fontSize: '20px', fontWeight: '800', marginTop: '4px' }}>{summary.settlementBatchesCount}</div>
                            <div style={{ fontSize: '11px', color: 'var(--fg-subtle)', marginTop: '2px' }}>Payment groups created</div>
                        </div>
                    </div>
                </div>
            )}

            {/* TAB 2: SHOP FINANCE */}
            {activeTab === 'shops' && (
                <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                        <h2 style={{ fontSize: '18px', fontWeight: '800' }}>Shops and earnings</h2>
                    </div>

                    <div className="card" style={{ overflowX: 'auto', padding: 0 }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px' }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)', color: 'var(--fg-muted)' }}>
                                    <th style={{ padding: '12px 16px', fontWeight: '700' }}>Shop Name</th>
                                    <th style={{ padding: '12px 16px', fontWeight: '700' }}>XerService fee</th>
                                    <th style={{ padding: '12px 16px', fontWeight: '700' }}>Customer payments</th>
                                    <th style={{ padding: '12px 16px', fontWeight: '700' }}>XerService fees</th>
                                    <th style={{ padding: '12px 16px', fontWeight: '700' }}>Shop earnings</th>
                                    <th style={{ padding: '12px 16px', fontWeight: '700' }}>Ready to pay</th>
                                    <th style={{ padding: '12px 16px', fontWeight: '700' }}>Paid to shop</th>
                                    <th style={{ padding: '12px 16px', fontWeight: '700' }}>Action</th>
                                </tr>
                            </thead>
                            <tbody>
                                {shops.length === 0 ? (
                                    <tr>
                                        <td colSpan={8} style={{ padding: '32px', textAlign: 'center', color: 'var(--fg-muted)' }}>
                                            No shops registered in system.
                                        </td>
                                    </tr>
                                ) : (
                                    shops.map((s) => (
                                        <tr key={s.shopId} style={{ borderBottom: '1px solid var(--border)' }}>
                                            <td style={{ padding: '14px 16px' }}>
                                                <div style={{ fontWeight: '700' }}>{s.shopName}</div>
                                                <div style={{ fontSize: '12px', color: 'var(--fg-subtle)' }}>{s.address || 'Campus Print Store'}</div>
                                            </td>
                                            <td style={{ padding: '14px 16px' }}>
                                                {s.activeCommissionRule ? (
                                                    <span style={{ fontWeight: '700', color: 'var(--accent)' }}>
                                                        {s.activeCommissionRule.commissionPercentage}%
                                                    </span>
                                                ) : (
                                                    <span style={{ fontSize: '12px', color: '#ca8a04', background: 'rgba(234, 179, 8, 0.1)', padding: '2px 8px', borderRadius: '10px' }}>
                                                        Unconfigured
                                                    </span>
                                                )}
                                            </td>
                                            <td style={{ padding: '14px 16px', fontWeight: '700' }}>₹{s.grossSales.toFixed(2)}</td>
                                            <td style={{ padding: '14px 16px' }}>
                                                {s.platformCommission !== null ? `₹${s.platformCommission.toFixed(2)}` : '—'}
                                            </td>
                                            <td style={{ padding: '14px 16px' }}>
                                                {s.vendorEarnings !== null ? `₹${s.vendorEarnings.toFixed(2)}` : '—'}
                                            </td>
                                            <td style={{ padding: '14px 16px', fontWeight: '700', color: '#16a34a' }}>
                                                {s.payableAmount !== null ? `₹${s.payableAmount.toFixed(2)}` : '—'}
                                            </td>
                                            <td style={{ padding: '14px 16px' }}>₹{s.settledAmount.toFixed(2)}</td>
                                            <td style={{ padding: '14px 16px' }}>
                                                <button
                                                    onClick={() => handleViewShopDetails(s.shopId)}
                                                    className="btn btn-secondary btn-sm"
                                                    style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
                                                >
                                                    View details <ChevronRight size={14} />
                                                </button>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {activeTab === 'shops' && (
                <div style={{ marginTop: '32px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                        <div>
                            <h2 style={{ fontSize: '18px', fontWeight: '800' }}>XerService fee settings</h2>
                            <p style={{ color: 'var(--fg-muted)', fontSize: '13px' }}>Set the percentage XerService keeps from eligible orders for each shop.</p>
                        </div>
                        <button
                            onClick={() => setShowRuleModal(true)}
                            className="btn btn-accent"
                            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                        >
                            <Plus size={16} /> Set shop fee
                        </button>
                    </div>

                    <div className="card" style={{ overflowX: 'auto', padding: 0 }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px' }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)', color: 'var(--fg-muted)' }}>
                                    <th style={{ padding: '12px 16px', fontWeight: '700' }}>Shop</th>
                                    <th style={{ padding: '12px 16px', fontWeight: '700' }}>XerService fee</th>
                                    <th style={{ padding: '12px 16px', fontWeight: '700' }}>Starts</th>
                                    <th style={{ padding: '12px 16px', fontWeight: '700' }}>Ends</th>
                                    <th style={{ padding: '12px 16px', fontWeight: '700' }}>Status</th>
                                    <th style={{ padding: '12px 16px', fontWeight: '700' }}>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rules.length === 0 ? (
                                    <tr>
                                        <td colSpan={6} style={{ padding: '40px', textAlign: 'center', color: 'var(--fg-muted)' }}>
                                            <div style={{ fontWeight: '700', fontSize: '16px', marginBottom: '4px' }}>No shop fee set yet</div>
                                            <div style={{ fontSize: '13px' }}>Set a fee to calculate XerService and shop earnings.</div>
                                        </td>
                                    </tr>
                                ) : (
                                    rules.map((r) => (
                                        <tr key={r.id} style={{ borderBottom: '1px solid var(--border)' }}>
                                            <td style={{ padding: '14px 16px', fontWeight: '700' }}>{r.shopName}</td>
                                            <td style={{ padding: '14px 16px', fontWeight: '800', color: 'var(--accent)' }}>
                                                {r.commissionPercentage}%
                                            </td>
                                            <td style={{ padding: '14px 16px' }}>{new Date(r.effectiveFrom).toLocaleDateString()}</td>
                                            <td style={{ padding: '14px 16px' }}>{r.effectiveTo ? new Date(r.effectiveTo).toLocaleDateString() : 'Open-ended'}</td>
                                            <td style={{ padding: '14px 16px' }}>
                                                {r.isActive ? (
                                                    <span style={{ fontSize: '12px', fontWeight: '700', color: '#16a34a', background: 'rgba(22, 163, 74, 0.1)', padding: '2px 8px', borderRadius: '10px' }}>
                                                        Active
                                                    </span>
                                                ) : (
                                                    <span style={{ fontSize: '12px', color: 'var(--fg-subtle)', background: 'var(--bg-secondary)', padding: '2px 8px', borderRadius: '10px' }}>
                                                        Inactive
                                                    </span>
                                                )}
                                            </td>
                                            <td style={{ padding: '14px 16px' }}>
                                                {r.isActive && (
                                                    <button
                                                        onClick={() => handleApplyRule(r.id)}
                                                        className="btn btn-secondary btn-sm"
                                                        title="Apply rule to unconfigured orders within this window"
                                                    >
                                                        Apply to earlier orders
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* TAB 4: SETTLEMENTS */}
            {activeTab === 'settlements' && (
                <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                        <div>
                            <h2 style={{ fontSize: '18px', fontWeight: '800' }}>Payments to shops</h2>
                            <p style={{ color: 'var(--fg-muted)', fontSize: '13px' }}>Group completed orders and record transfers made outside XerService.</p>
                        </div>
                        <button
                            onClick={() => {
                                setShowSettlementModal(true);
                                setEligibleOrders([]);
                                setSelectedLedgerIds([]);
                            }}
                            className="btn btn-accent"
                            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                        >
                            <Plus size={16} /> Create payment batch
                        </button>
                    </div>

                    <div className="card" style={{ overflowX: 'auto', padding: 0 }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px' }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)', color: 'var(--fg-muted)' }}>
                                    <th style={{ padding: '12px 16px', fontWeight: '700' }}>Payment batch</th>
                                    <th style={{ padding: '12px 16px', fontWeight: '700' }}>Shop</th>
                                    <th style={{ padding: '12px 16px', fontWeight: '700' }}>Orders</th>
                                    <th style={{ padding: '12px 16px', fontWeight: '700' }}>Customer payments</th>
                                    <th style={{ padding: '12px 16px', fontWeight: '700' }}>XerService fees</th>
                                    <th style={{ padding: '12px 16px', fontWeight: '700' }}>Amount to shop</th>
                                    <th style={{ padding: '12px 16px', fontWeight: '700' }}>Status</th>
                                    <th style={{ padding: '12px 16px', fontWeight: '700' }}>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {settlements.length === 0 ? (
                                    <tr>
                                        <td colSpan={8} style={{ padding: '40px', textAlign: 'center', color: 'var(--fg-muted)' }}>
                                            <div style={{ fontWeight: '700', fontSize: '16px', marginBottom: '4px' }}>No shop payments prepared yet</div>
                                            <div style={{ fontSize: '13px' }}>Create a payment batch when completed orders are ready to pay.</div>
                                        </td>
                                    </tr>
                                ) : (
                                    settlements.map((s) => (
                                        <tr key={s.id} style={{ borderBottom: '1px solid var(--border)' }}>
                                            <td style={{ padding: '14px 16px', fontWeight: '800' }}>{s.settlementNumber}</td>
                                            <td style={{ padding: '14px 16px' }}>{s.shopName}</td>
                                            <td style={{ padding: '14px 16px' }}>{s.orderCount} order(s)</td>
                                            <td style={{ padding: '14px 16px' }}>₹{s.grossOrderAmount.toFixed(2)}</td>
                                            <td style={{ padding: '14px 16px' }}>₹{s.platformCommissionAmount.toFixed(2)}</td>
                                            <td style={{ padding: '14px 16px', fontWeight: '800', color: '#16a34a' }}>
                                                ₹{s.vendorPayableAmount.toFixed(2)}
                                            </td>
                                            <td style={{ padding: '14px 16px' }}>
                                                {s.status === 'DRAFT' && (
                                                    <span style={{ fontSize: '12px', fontWeight: '700', color: '#ca8a04', background: 'rgba(234, 179, 8, 0.1)', padding: '3px 8px', borderRadius: '10px' }}>
                                Draft
                                                    </span>
                                                )}
                                                {s.status === 'CONFIRMED' && (
                                                    <span style={{ fontSize: '12px', fontWeight: '700', color: 'var(--accent)', background: 'var(--accent-muted)', padding: '3px 8px', borderRadius: '10px' }}>
                                                        Confirmed
                                                    </span>
                                                )}
                                                {s.status === 'PAID' && (
                                                    <span style={{ fontSize: '12px', fontWeight: '700', color: '#16a34a', background: 'rgba(22, 163, 74, 0.1)', padding: '3px 8px', borderRadius: '10px' }}>
                                                        Paid
                                                    </span>
                                                )}
                                                {s.status === 'CANCELLED' && (
                                                    <span style={{ fontSize: '12px', color: 'var(--fg-subtle)', background: 'var(--bg-secondary)', padding: '3px 8px', borderRadius: '10px' }}>
                                                        Cancelled
                                                    </span>
                                                )}
                                            </td>
                                            <td style={{ padding: '14px 16px' }}>
                                                <div style={{ display: 'flex', gap: '6px' }}>
                                                    {s.status === 'DRAFT' && (
                                                        <>
                                                            <button
                                                                onClick={() => handleConfirmBatch(s.id)}
                                                                className="btn btn-accent btn-sm"
                                                            >
                                                                Confirm
                                                            </button>
                                                            <button
                                                                onClick={() => handleCancelBatch(s.id)}
                                                                className="btn btn-secondary btn-sm"
                                                            >
                                                                Cancel
                                                            </button>
                                                        </>
                                                    )}
                                                    {s.status === 'CONFIRMED' && (
                                                        <>
                                                            <button
                                                                onClick={() => setPayingBatch(s)}
                                                                className="btn btn-accent btn-sm"
                                                            >
                                                                Mark as Paid
                                                            </button>
                                                            <button
                                                                onClick={() => handleCancelBatch(s.id)}
                                                                className="btn btn-secondary btn-sm"
                                                            >
                                                                Cancel
                                                            </button>
                                                        </>
                                                    )}
                                                    {s.status === 'PAID' && (
                                                        <div style={{ fontSize: '12px', color: 'var(--fg-muted)' }}>
                                                            {s.paymentMethod}: {s.paymentReference || 'Completed'}
                                                        </div>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* MODAL: CONFIGURE COMMISSION RULE */}
            {showRuleModal && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px', zIndex: 100 }}>
                    <div className="card" style={{ width: '100%', maxWidth: '500px', padding: '28px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                            <h3 style={{ fontSize: '20px', fontWeight: '800' }}>Set XerService fee</h3>
                            <button onClick={() => setShowRuleModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                                <X size={20} />
                            </button>
                        </div>

                        <form onSubmit={handleCreateRule} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            <div>
                                <label className="input-label">Select Shop</label>
                                <select
                                    className="input"
                                    value={ruleShopId}
                                    onChange={(e) => setRuleShopId(e.target.value)}
                                    required
                                >
                                    <option value="">-- Select a shop --</option>
                                    {shops.map((s) => (
                                        <option key={s.shopId} value={s.shopId}>
                                            {s.shopName}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="input-label">XerService fee (%)</label>
                                <input
                                    className="input"
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    max="100"
                                    placeholder="e.g. 5 or 7.5"
                                    value={rulePercentage}
                                    onChange={(e) => setRulePercentage(e.target.value)}
                                    required
                                />
                                {rulePercentage && !isNaN(parseFloat(rulePercentage)) && (
                                    <div style={{ fontSize: '12px', marginTop: '4px' }}>
                                        {rulePercentage.trim().split('.')[1]?.length > 2 ? (
                                            <span style={{ color: 'var(--danger, #ef4444)', fontWeight: '600' }}>
                                                Maximum 2 decimal places allowed (e.g. 7.5 or 7.50)
                                            </span>
                                        ) : (
                                            <span style={{ color: 'var(--accent)' }}>
                                                The shop receives {(100 - parseFloat(rulePercentage)).toFixed(2)}% before refunds or adjustments.
                                            </span>
                                        )}
                                    </div>
                                )}
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                                <div>
                                    <label className="input-label">Starts</label>
                                    <input
                                        className="input"
                                        type="datetime-local"
                                        value={ruleEffectiveFrom}
                                        onChange={(e) => setRuleEffectiveFrom(e.target.value)}
                                    />
                                    <div style={{ fontSize: '11px', color: 'var(--fg-subtle)', marginTop: '2px' }}>Leave empty to start now</div>
                                </div>
                                <div>
                                    <label className="input-label">Ends (optional)</label>
                                    <input
                                        className="input"
                                        type="datetime-local"
                                        value={ruleEffectiveTo}
                                        onChange={(e) => setRuleEffectiveTo(e.target.value)}
                                    />
                                    <div style={{ fontSize: '11px', color: 'var(--fg-subtle)', marginTop: '2px' }}>Leave empty for open-ended</div>
                                </div>
                            </div>

                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer' }}>
                                <input
                                    type="checkbox"
                                    checked={ruleClosePrevious}
                                    onChange={(e) => setRuleClosePrevious(e.target.checked)}
                                />
                                <span>Replace the current fee when the dates overlap</span>
                            </label>

                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '12px' }}>
                                <button type="button" onClick={() => setShowRuleModal(false)} className="btn btn-secondary">
                                    Cancel
                                </button>
                                <button type="submit" className="btn btn-accent" disabled={ruleSubmitting}>
                                    {ruleSubmitting ? 'Saving...' : 'Save fee'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* MODAL: CREATE SETTLEMENT BATCH */}
            {showSettlementModal && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px', zIndex: 100 }}>
                    <div className="card" style={{ width: '100%', maxWidth: '640px', maxHeight: '90vh', overflowY: 'auto', padding: '28px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                            <h3 style={{ fontSize: '20px', fontWeight: '800' }}>Create payment batch</h3>
                            <button onClick={() => setShowSettlementModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                                <X size={20} />
                            </button>
                        </div>

                        <form onSubmit={handleCreateSettlement} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            <div>
                                <label className="input-label">Select Shop</label>
                                <select
                                    className="input"
                                    value={settleShopId}
                                    onChange={(e) => handleSelectShopForSettlement(e.target.value)}
                                    required
                                >
                                    <option value="">Choose a shop</option>
                                    {shops.map((s) => (
                                        <option key={s.shopId} value={s.shopId}>
                                            {s.shopName} (ready to pay: ₹{(s.payableAmount || 0).toFixed(2)})
                                        </option>
                                    ))}
                                </select>
                            </div>

                            {settleLoadingOrders && (
                                <div style={{ textAlign: 'center', padding: '20px', color: 'var(--fg-muted)' }}>
                                    <RefreshCw className="animate-spin" size={20} style={{ margin: '0 auto 8px' }} />
                                    Loading completed orders...
                                </div>
                            )}

                            {!settleLoadingOrders && settleShopId && (
                                <div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                                        <label className="input-label" style={{ margin: 0 }}>
                                            Select completed orders ({selectedLedgerIds.length} of {eligibleOrders.length} selected)
                                        </label>
                                        {eligibleOrders.length > 0 && (
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    if (selectedLedgerIds.length === eligibleOrders.length) {
                                                        setSelectedLedgerIds([]);
                                                    } else {
                                                        setSelectedLedgerIds(eligibleOrders.map((o) => o.id));
                                                    }
                                                }}
                                                style={{ fontSize: '12px', color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer' }}
                                            >
                                                {selectedLedgerIds.length === eligibleOrders.length ? 'Deselect All' : 'Select All'}
                                            </button>
                                        )}
                                    </div>

                                    {eligibleOrders.length === 0 ? (
                                        <div style={{ padding: '16px', background: 'var(--bg-secondary)', borderRadius: '10px', fontSize: '13px', color: 'var(--fg-muted)', textAlign: 'center' }}>
                                            No completed orders are ready to pay for this shop.
                                        </div>
                                    ) : (
                                        <div style={{ maxHeight: '200px', overflowY: 'auto', border: '1px solid var(--border)', borderRadius: '10px' }}>
                                            {eligibleOrders.map((ord) => (
                                                <label
                                                    key={ord.id}
                                                    style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'space-between',
                                                        padding: '10px 14px',
                                                        borderBottom: '1px solid var(--border)',
                                                        cursor: 'pointer',
                                                    }}
                                                >
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                                        <input
                                                            type="checkbox"
                                                            checked={selectedLedgerIds.includes(ord.id)}
                                                            onChange={(e) => {
                                                                if (e.target.checked) {
                                                                    setSelectedLedgerIds([...selectedLedgerIds, ord.id]);
                                                                } else {
                                                                    setSelectedLedgerIds(selectedLedgerIds.filter((id) => id !== ord.id));
                                                                }
                                                            }}
                                                        />
                                                        <div>
                                                            <div style={{ fontWeight: '700', fontSize: '13px' }}>#{ord.orderNumber}</div>
                                                            <div style={{ fontSize: '11px', color: 'var(--fg-subtle)' }}>
                                                                Paid: {ord.paidAt ? new Date(ord.paidAt).toLocaleDateString() : '—'}
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div style={{ textAlign: 'right' }}>
                                                        <div style={{ fontWeight: '800', fontSize: '13px', color: '#16a34a' }}>
                                                            ₹{(ord.vendorNetAmount || 0).toFixed(2)}
                                                        </div>
                                                        <div style={{ fontSize: '11px', color: 'var(--fg-subtle)' }}>
                                                            Customer paid: ₹{ord.grossAmount.toFixed(2)}
                                                        </div>
                                                    </div>
                                                </label>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}

                            <div>
                                <label className="input-label">Note for admins (optional)</label>
                                <textarea
                                    className="input"
                                    rows={2}
                                    placeholder="e.g. Weekly settlement cycle"
                                    value={settleNotes}
                                    onChange={(e) => setSettleNotes(e.target.value)}
                                />
                            </div>

                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '12px' }}>
                                <button type="button" onClick={() => setShowSettlementModal(false)} className="btn btn-secondary">
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    className="btn btn-accent"
                                    disabled={settleSubmitting || selectedLedgerIds.length === 0}
                                >
                                    {settleSubmitting ? 'Creating...' : `Create draft payment (${selectedLedgerIds.length})`}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* MODAL: MARK AS PAID CONFIRMATION */}
            {payingBatch && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px', zIndex: 100 }}>
                    <div className="card" style={{ width: '100%', maxWidth: '520px', padding: '28px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                            <h3 style={{ fontSize: '20px', fontWeight: '800' }}>Confirm shop payment</h3>
                            <button onClick={() => setPayingBatch(null)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                                <X size={20} />
                            </button>
                        </div>

                        <div style={{ padding: '14px', borderRadius: '12px', background: 'rgba(34, 197, 94, 0.1)', border: '1px solid rgba(34, 197, 94, 0.25)', marginBottom: '20px' }}>
                            <div style={{ fontSize: '13px', color: '#16a34a', fontWeight: '700', marginBottom: '4px' }}>
                                Confirm the transfer:
                            </div>
                            <div style={{ fontSize: '14px', color: 'var(--fg)' }}>
                                <strong>₹{payingBatch.vendorPayableAmount.toFixed(2)}</strong> has already been transferred to <strong>{payingBatch.shopName}</strong> outside XerService.
                            </div>
                        </div>

                        <form onSubmit={handleMarkPaid} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            <div>
                                <label className="input-label">Payment Method Used</label>
                                <select
                                    className="input"
                                    value={paymentMethod}
                                    onChange={(e) => setPaymentMethod(e.target.value)}
                                    required
                                >
                                    <option value="UPI">UPI Transfer</option>
                                    <option value="NEFT">NEFT Bank Transfer</option>
                                    <option value="IMPS">IMPS Immediate Payment</option>
                                    <option value="BANK_TRANSFER">Direct Bank Transfer</option>
                                    <option value="OTHER">Other External Method</option>
                                </select>
                            </div>

                            <div>
                                <label className="input-label">Transaction reference or UTR number</label>
                                <input
                                    className="input"
                                    type="text"
                                    placeholder="e.g. UTR1234567890 / UPI Transaction ID"
                                    value={paymentReference}
                                    onChange={(e) => setPaymentReference(e.target.value)}
                                    required
                                />
                                <div style={{ fontSize: '12px', color: 'var(--fg-subtle)', marginTop: '4px' }}>
                                    This reference will be saved in the shop payment history.
                                </div>
                            </div>

                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '12px' }}>
                                <button type="button" onClick={() => setPayingBatch(null)} className="btn btn-secondary">
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    className="btn btn-accent"
                                    disabled={paidSubmitting || !paymentReference.trim()}
                                >
                                    {paidSubmitting ? 'Recording...' : 'Confirm & Mark as PAID'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* MODAL: SHOP LEDGER DRILLDOWN */}
            {selectedShopDetails && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px', zIndex: 100 }}>
                    <div className="card" style={{ width: '100%', maxWidth: '850px', maxHeight: '90vh', overflowY: 'auto', padding: '28px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                            <div>
                                <h3 style={{ fontSize: '20px', fontWeight: '800' }}>{selectedShopDetails.shop.name} — Payment details</h3>
                                <p style={{ fontSize: '12px', color: 'var(--fg-muted)' }}>{selectedShopDetails.shop.address || 'Campus Print Store'}</p>
                            </div>
                            <button onClick={() => setSelectedShopDetails(null)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                                <X size={20} />
                            </button>
                        </div>

                        <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
                                <thead>
                                    <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)', color: 'var(--fg-muted)' }}>
                                        <th style={{ padding: '10px 12px', fontWeight: '700' }}>Order</th>
                                        <th style={{ padding: '10px 12px', fontWeight: '700' }}>Customer paid</th>
                                        <th style={{ padding: '10px 12px', fontWeight: '700' }}>XerService fee</th>
                                        <th style={{ padding: '10px 12px', fontWeight: '700' }}>Shop earnings</th>
                                        <th style={{ padding: '10px 12px', fontWeight: '700' }}>Status</th>
                                        <th style={{ padding: '10px 12px', fontWeight: '700' }}>Paid on</th>
                                        <th style={{ padding: '10px 12px', fontWeight: '700' }}>Refunded on</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {(selectedShopDetails.ledgers || []).map((l: any) => (
                                        <tr key={l.id} style={{ borderBottom: '1px solid var(--border)' }}>
                                            <td style={{ padding: '10px 12px', fontWeight: '700' }}>#{l.orderNumber}</td>
                                            <td style={{ padding: '10px 12px' }}>₹{l.grossAmount.toFixed(2)}</td>
                                            <td style={{ padding: '10px 12px' }}>
                                                {l.platformCommissionAmount !== null ? `₹${l.platformCommissionAmount.toFixed(2)}` : '—'}
                                            </td>
                                            <td style={{ padding: '10px 12px', fontWeight: '700' }}>
                                                {l.vendorNetAmount !== null ? `₹${l.vendorNetAmount.toFixed(2)}` : '—'}
                                            </td>
                                            <td style={{ padding: '10px 12px' }}>
                                                <span style={{
                                                    fontSize: '11px',
                                                    fontWeight: '700',
                                                    padding: '2px 6px',
                                                    borderRadius: '8px',
                                                    color: l.financialStatus === 'PAYABLE' ? '#16a34a' :
                                                           l.financialStatus === 'SETTLED' ? '#2563eb' :
                                                           l.financialStatus === 'REVERSED' ? '#dc2626' :
                                                           l.financialStatus === 'PENDING' ? '#ca8a04' : '#6b7280',
                                                    background: 'var(--bg-secondary)'
                                                }}>
                                                {financialStatusLabel(l.financialStatus)}
                                                </span>
                                            </td>
                                            <td style={{ padding: '10px 12px', fontSize: '11px', color: 'var(--fg-subtle)' }}>
                                                {l.paidAt ? new Date(l.paidAt).toLocaleDateString() : '—'}
                                            </td>
                                            <td style={{ padding: '10px 12px', fontSize: '11px', color: '#dc2626' }}>
                                                {l.reversedAt ? new Date(l.reversedAt).toLocaleDateString() : '—'}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

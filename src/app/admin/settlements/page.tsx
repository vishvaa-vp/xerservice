'use client';

import { Suspense, useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase/client';
import AdminHeaderNav from '@/components/admin/AdminHeaderNav';
import {
    CheckCircle2,
    Clock,
    AlertTriangle,
    Plus,
    Check,
    X,
    RefreshCw,
    Download,
    FileText,
    ArrowRight,
    AlertCircle,
    Store,
    CreditCard,
    Building2,
    Search,
} from 'lucide-react';

type SettlementTab = 'ready' | 'in_progress' | 'paid_history';

interface ReadyToSettleShop {
    shopId: string;
    shopName: string;
    readyAmount: number;
    heldAmount: number;
    eligibleOrderCount: number;
    lastPaidDate: string | null;
    isTestShop: boolean;
}

interface InProgressBatch {
    id: string;
    shopId: string;
    shopName: string;
    settlementNumber: string;
    grossOrderAmount: number;
    platformCommissionAmount: number;
    vendorPayableAmount: number;
    orderCount: number;
    status: 'DRAFT' | 'CONFIRMED';
    notes: string | null;
    createdBy: string | null;
    confirmedBy: string | null;
    confirmedAt: string | null;
    createdAt: string;
}

interface PaidHistoryBatch {
    id: string;
    shopId: string;
    shopName: string;
    settlementNumber: string;
    grossOrderAmount: number;
    platformCommissionAmount: number;
    vendorPayableAmount: number;
    orderCount: number;
    status: 'PAID';
    paymentReference: string;
    paymentMethod: string;
    paidBy: string | null;
    confirmedBy: string | null;
    confirmedAt: string | null;
    settledAt: string;
    disbursedAt: string | null;
    createdAt: string;
}

interface SettlementsOverviewData {
    summary: {
        readyAmount: number;
        readyOrdersCount: number;
        inProgressAmount: number;
        inProgressBatchesCount: number;
        paidAmount: number;
        paidBatchesCount: number;
    };
    readyToSettle: ReadyToSettleShop[];
    inProgress: InProgressBatch[];
    paidHistory: PaidHistoryBatch[];
}

interface EligibleOrderRow {
    orderFinancialLedgerId: string;
    orderId: string;
    orderNumber?: string;
    grossAmount: number;
    platformCommissionAmount: number;
    vendorNetAmount: number;
    createdAt: string;
}

export default function AdminSettlementsPage() {
    return (
        <Suspense fallback={<div style={{ padding: '32px' }}>Loading settlements…</div>}>
            <AdminSettlementsContent />
        </Suspense>
    );
}

function AdminSettlementsContent() {
    const [token, setToken] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);
    const [data, setData] = useState<SettlementsOverviewData | null>(null);
    const [activeTab, setActiveTab] = useState<SettlementTab>('ready');

    // Modals
    const [createShop, setCreateShop] = useState<ReadyToSettleShop | null>(null);
    const [eligibleOrders, setEligibleOrders] = useState<EligibleOrderRow[]>([]);
    const [selectedLedgerIds, setSelectedLedgerIds] = useState<string[]>([]);
    const [createNotes, setCreateNotes] = useState('');
    const [loadingEligible, setLoadingEligible] = useState(false);
    const [submittingCreate, setSubmittingCreate] = useState(false);

    // Mark Paid Modal
    const [payingBatch, setPayingBatch] = useState<InProgressBatch | null>(null);
    const [paymentMethod, setPaymentMethod] = useState('UPI');
    const [paymentReference, setPaymentReference] = useState('');
    const [submittingPay, setSubmittingPay] = useState(false);

    // Auth init
    useEffect(() => {
        supabase.auth.getSession().then(({ data: { session } }) => {
            if (session?.access_token) {
                setToken(session.access_token);
            } else {
                setError('Session missing or expired. Please sign in.');
                setLoading(false);
            }
        });
    }, []);

    // Fetch settlements overview
    const fetchOverview = useCallback(async () => {
        if (!token) return;
        setLoading(true);
        setError(null);

        try {
            const res = await fetch('/api/admin/finance/settlements?overview=true', {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.error || `Failed to fetch settlements (${res.status})`);
            }
            const overviewData: SettlementsOverviewData = await res.json();
            setData(overviewData);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            setError(msg);
        } finally {
            setLoading(false);
        }
    }, [token]);

    useEffect(() => {
        if (token) {
            fetchOverview();
        }
    }, [token, fetchOverview]);

    // Open create batch drawer for a shop
    const handleOpenCreateBatch = async (shop: ReadyToSettleShop) => {
        if (!token) return;
        setCreateShop(shop);
        setLoadingEligible(true);
        setSelectedLedgerIds([]);
        setCreateNotes('');
        setError(null);

        try {
            const res = await fetch(`/api/admin/finance/settlements?eligible=true&shopId=${shop.shopId}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.error || 'Failed to load eligible orders.');
            }
            const resData = await res.json();
            const orders: EligibleOrderRow[] = resData.eligibleOrders || [];
            setEligibleOrders(orders);
            // Default select all
            setSelectedLedgerIds(orders.map(o => o.orderFinancialLedgerId));
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            setError(msg);
        } finally {
            setLoadingEligible(false);
        }
    };

    // Submit batch creation
    const handleSubmitCreateBatch = async () => {
        if (!token || !createShop || selectedLedgerIds.length === 0) return;
        setSubmittingCreate(true);
        setError(null);

        try {
            const res = await fetch('/api/admin/finance/settlements', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    shop_id: createShop.shopId,
                    order_ledger_ids: selectedLedgerIds,
                    notes: createNotes || undefined,
                }),
            });

            const resData = await res.json();
            if (!res.ok) {
                if (res.status === 409) {
                    throw new Error(`Concurrency Conflict: ${resData.error || 'One or more orders are already locked in another active batch.'}`);
                }
                throw new Error(resData.error || 'Failed to create settlement batch.');
            }

            setSuccessMessage(`Settlement batch ${resData.settlement?.settlementNumber} created successfully!`);
            setCreateShop(null);
            fetchOverview();
            setActiveTab('in_progress');
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            setError(msg);
        } finally {
            setSubmittingCreate(false);
        }
    };

    // Confirm batch
    const handleConfirmBatch = async (batchId: string) => {
        if (!token) return;
        if (!confirm('Confirm this settlement batch? Once confirmed, it can be marked paid after external disbursement.')) return;
        setLoading(true);
        setError(null);

        try {
            const res = await fetch(`/api/admin/finance/settlements/${batchId}/confirm`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
            });
            const resData = await res.json();
            if (!res.ok) {
                throw new Error(resData.error || 'Failed to confirm settlement batch.');
            }
            setSuccessMessage('Settlement batch confirmed.');
            fetchOverview();
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            setError(msg);
        } finally {
            setLoading(false);
        }
    };

    // Cancel batch
    const handleCancelBatch = async (batchId: string) => {
        if (!token) return;
        if (!confirm('Cancel this settlement batch? All attached orders will be released back to Ready to Settle.')) return;
        setLoading(true);
        setError(null);

        try {
            const res = await fetch(`/api/admin/finance/settlements/${batchId}/cancel`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
            });
            const resData = await res.json();
            if (!res.ok) {
                throw new Error(resData.error || 'Failed to cancel settlement batch.');
            }
            setSuccessMessage('Settlement batch cancelled. Orders released.');
            fetchOverview();
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            setError(msg);
        } finally {
            setLoading(false);
        }
    };

    // Submit mark paid
    const handleSubmitMarkPaid = async () => {
        if (!token || !payingBatch || !paymentReference.trim()) return;
        setSubmittingPay(true);
        setError(null);

        try {
            const res = await fetch(`/api/admin/finance/settlements/${payingBatch.id}/mark-paid`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    payment_method: paymentMethod,
                    payment_reference: paymentReference.trim(),
                }),
            });

            const resData = await res.json();
            if (!res.ok) {
                throw new Error(resData.error || 'Failed to record external disbursement.');
            }

            setSuccessMessage(`Settlement ${payingBatch.settlementNumber} marked as PAID. Attached order ledgers transitioned to SETTLED.`);
            setPayingBatch(null);
            setPaymentReference('');
            fetchOverview();
            setActiveTab('paid_history');
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            setError(msg);
        } finally {
            setSubmittingPay(false);
        }
    };

    // Download statement CSV
    const handleDownloadStatement = (batchId: string, settlementNumber: string) => {
        if (!token) return;
        fetch(`/api/admin/finance/settlements/${batchId}/export`, {
            headers: { Authorization: `Bearer ${token}` },
        })
            .then(res => res.blob())
            .then(blob => {
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `settlement-${settlementNumber}.csv`;
                document.body.appendChild(a);
                a.click();
                a.remove();
            })
            .catch(err => {
                console.error('Download error:', err);
                alert('Failed to download statement.');
            });
    };

    // Selected orders calculation
    const selectedOrdersList = eligibleOrders.filter(o => selectedLedgerIds.includes(o.orderFinancialLedgerId));
    const selectedGross = selectedOrdersList.reduce((acc, o) => acc + o.grossAmount, 0);
    const selectedFee = selectedOrdersList.reduce((acc, o) => acc + o.platformCommissionAmount, 0);
    const selectedNet = selectedOrdersList.reduce((acc, o) => acc + o.vendorNetAmount, 0);

    return (
        <div className="admin-page-container">
            <AdminHeaderNav activeSection="settlements" />

            <div style={{ padding: '24px 32px', maxWidth: '1440px', margin: '0 auto' }}>
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <h1 style={{ fontSize: '24px', fontWeight: '700', margin: 0 }}>Settlements</h1>
                        {data && (
                            <div style={{ display: 'flex', gap: '8px' }}>
                                <span className="badge badge-success">
                                    Ready: ₹{data.summary.readyAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                                </span>
                                <span className="badge badge-info">
                                    In Progress: {data.summary.inProgressBatchesCount}
                                </span>
                            </div>
                        )}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={fetchOverview}
                            disabled={loading}
                            style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', padding: '6px 14px' }}
                        >
                            <RefreshCw size={14} className={loading ? 'spin' : ''} />
                            Refresh
                        </button>
                    </div>
                </div>

                {error && (
                    <div style={{ padding: '12px 16px', background: '#fee2e2', border: '1px solid #f87171', borderRadius: '8px', color: '#991b1b', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <AlertCircle size={16} />
                        <span>{error}</span>
                    </div>
                )}

                {successMessage && (
                    <div style={{ padding: '12px 16px', background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: '8px', color: '#065f46', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <CheckCircle2 size={16} />
                        <span>{successMessage}</span>
                    </div>
                )}

                {/* Section Tabs */}
                <div style={{ display: 'flex', borderBottom: '1px solid var(--border-color, #e2e8f0)', marginBottom: '24px', gap: '24px' }}>
                    <button
                        type="button"
                        onClick={() => setActiveTab('ready')}
                        style={{
                            padding: '10px 4px',
                            fontSize: '14px',
                            fontWeight: activeTab === 'ready' ? '600' : '400',
                            color: activeTab === 'ready' ? 'var(--primary-color, #0284c7)' : 'var(--text-muted)',
                            border: 'none',
                            borderBottom: activeTab === 'ready' ? '2px solid var(--primary-color, #0284c7)' : '2px solid transparent',
                            background: 'transparent',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                        }}
                    >
                        <span>1. Ready to Settle</span>
                        {data && data.readyToSettle.length > 0 && (
                            <span className="badge badge-success" style={{ fontSize: '11px', padding: '2px 6px' }}>
                                {data.readyToSettle.length}
                            </span>
                        )}
                    </button>

                    <button
                        type="button"
                        onClick={() => setActiveTab('in_progress')}
                        style={{
                            padding: '10px 4px',
                            fontSize: '14px',
                            fontWeight: activeTab === 'in_progress' ? '600' : '400',
                            color: activeTab === 'in_progress' ? 'var(--primary-color, #0284c7)' : 'var(--text-muted)',
                            border: 'none',
                            borderBottom: activeTab === 'in_progress' ? '2px solid var(--primary-color, #0284c7)' : '2px solid transparent',
                            background: 'transparent',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                        }}
                    >
                        <span>2. In Progress</span>
                        {data && data.inProgress.length > 0 && (
                            <span className="badge badge-info" style={{ fontSize: '11px', padding: '2px 6px' }}>
                                {data.inProgress.length}
                            </span>
                        )}
                    </button>

                    <button
                        type="button"
                        onClick={() => setActiveTab('paid_history')}
                        style={{
                            padding: '10px 4px',
                            fontSize: '14px',
                            fontWeight: activeTab === 'paid_history' ? '600' : '400',
                            color: activeTab === 'paid_history' ? 'var(--primary-color, #0284c7)' : 'var(--text-muted)',
                            border: 'none',
                            borderBottom: activeTab === 'paid_history' ? '2px solid var(--primary-color, #0284c7)' : '2px solid transparent',
                            background: 'transparent',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                        }}
                    >
                        <span>3. Paid History</span>
                        {data && (
                            <span className="badge badge-neutral" style={{ fontSize: '11px', padding: '2px 6px' }}>
                                {data.paidHistory.length}
                            </span>
                        )}
                    </button>
                </div>

                {/* Tab 1: Ready to Settle */}
                {activeTab === 'ready' && (
                    <div>
                        <div style={{ marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)' }}>
                                Shops with completed orders that have verified payment and configured commission.
                            </p>
                        </div>

                        {(!data || data.readyToSettle.length === 0) ? (
                            <div className="card" style={{ padding: '48px', textAlign: 'center', color: 'var(--text-muted)', borderRadius: '12px' }}>
                                <CheckCircle2 size={36} style={{ color: '#16a34a', margin: '0 auto 12px' }} />
                                <div style={{ fontSize: '16px', fontWeight: '600', color: '#0f172a' }}>All settlements are up to date</div>
                                <div style={{ fontSize: '13px', marginTop: '4px' }}>No unpaid orders currently waiting for settlement disbursement.</div>
                            </div>
                        ) : (
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: '16px' }}>
                                {data.readyToSettle.map(shop => (
                                    <div key={shop.shopId} className="card" style={{ padding: '20px', borderRadius: '12px', background: 'var(--card-bg, #ffffff)', border: '1px solid var(--border-color, #e2e8f0)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                                        <div>
                                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                                                <h3 style={{ fontSize: '16px', fontWeight: '600', margin: 0 }}>{shop.shopName}</h3>
                                                {shop.isTestShop && <span className="badge badge-warning">Test Shop</span>}
                                            </div>
                                            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '16px' }}>
                                                ID: {shop.shopId.slice(0, 8)}…
                                            </div>

                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', padding: '12px', background: '#f8fafc', borderRadius: '8px', marginBottom: '16px' }}>
                                                <div>
                                                    <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Ready to Pay</span>
                                                    <div style={{ fontSize: '20px', fontWeight: '700', color: '#16a34a' }}>
                                                        ₹{shop.readyAmount.toFixed(2)}
                                                    </div>
                                                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{shop.eligibleOrderCount} order(s)</span>
                                                </div>
                                                <div>
                                                    <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Held Amount</span>
                                                    <div style={{ fontSize: '16px', fontWeight: '600', color: '#64748b' }}>
                                                        ₹{shop.heldAmount.toFixed(2)}
                                                    </div>
                                                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Pending fulfillment</span>
                                                </div>
                                            </div>

                                            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '16px' }}>
                                                Last settled: {shop.lastPaidDate ? new Date(shop.lastPaidDate).toLocaleDateString('en-IN') : 'Never'}
                                            </div>
                                        </div>

                                        <button
                                            type="button"
                                            className="btn btn-primary"
                                            onClick={() => handleOpenCreateBatch(shop)}
                                            disabled={shop.readyAmount <= 0}
                                            style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', fontSize: '13px' }}
                                        >
                                            <Plus size={14} />
                                            Create Settlement Batch ({shop.eligibleOrderCount})
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* Tab 2: In Progress */}
                {activeTab === 'in_progress' && (
                    <div>
                        {(!data || data.inProgress.length === 0) ? (
                            <div className="card" style={{ padding: '48px', textAlign: 'center', color: 'var(--text-muted)', borderRadius: '12px' }}>
                                <Clock size={36} style={{ color: '#0284c7', margin: '0 auto 12px' }} />
                                <div style={{ fontSize: '16px', fontWeight: '600', color: '#0f172a' }}>No batches currently in progress</div>
                                <div style={{ fontSize: '13px', marginTop: '4px' }}>Draft and confirmed batches will appear here for review and payout.</div>
                            </div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                                {data.inProgress.map(batch => (
                                    <div key={batch.id} className="card" style={{ padding: '20px', borderRadius: '12px', background: 'var(--card-bg, #ffffff)', border: '1px solid var(--border-color, #e2e8f0)' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                                <span style={{ fontSize: '16px', fontWeight: '700', fontFamily: 'monospace' }}>
                                                    {batch.settlementNumber}
                                                </span>
                                                <span className={`badge ${batch.status === 'CONFIRMED' ? 'badge-success' : 'badge-info'}`}>
                                                    {batch.status}
                                                </span>
                                                <span style={{ fontSize: '13px', fontWeight: '600', color: '#0f172a' }}>
                                                    {batch.shopName}
                                                </span>
                                            </div>

                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                {batch.status === 'DRAFT' && (
                                                    <button
                                                        type="button"
                                                        className="btn btn-primary"
                                                        onClick={() => handleConfirmBatch(batch.id)}
                                                        style={{ fontSize: '12px', padding: '6px 12px', display: 'flex', alignItems: 'center', gap: '4px' }}
                                                    >
                                                        <Check size={14} />
                                                        Confirm Batch
                                                    </button>
                                                )}

                                                {batch.status === 'CONFIRMED' && (
                                                    <button
                                                        type="button"
                                                        className="btn btn-success"
                                                        onClick={() => setPayingBatch(batch)}
                                                        style={{ fontSize: '12px', padding: '6px 12px', display: 'flex', alignItems: 'center', gap: '4px' }}
                                                    >
                                                        <CreditCard size={14} />
                                                        Record Payment
                                                    </button>
                                                )}

                                                <button
                                                    type="button"
                                                    className="btn btn-secondary"
                                                    onClick={() => handleCancelBatch(batch.id)}
                                                    style={{ fontSize: '12px', padding: '6px 12px', color: '#dc2626' }}
                                                >
                                                    Cancel
                                                </button>
                                            </div>
                                        </div>

                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px', padding: '12px', background: '#f8fafc', borderRadius: '8px' }}>
                                            <div>
                                                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Orders</span>
                                                <div style={{ fontSize: '15px', fontWeight: '600' }}>{batch.orderCount}</div>
                                            </div>
                                            <div>
                                                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Gross Orders</span>
                                                <div style={{ fontSize: '15px', fontWeight: '600' }}>₹{batch.grossOrderAmount.toFixed(2)}</div>
                                            </div>
                                            <div>
                                                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Platform Fee</span>
                                                <div style={{ fontSize: '15px', fontWeight: '600', color: 'var(--primary-color, #0284c7)' }}>₹{batch.platformCommissionAmount.toFixed(2)}</div>
                                            </div>
                                            <div>
                                                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Vendor Net Payable</span>
                                                <div style={{ fontSize: '16px', fontWeight: '700', color: '#16a34a' }}>₹{batch.vendorPayableAmount.toFixed(2)}</div>
                                            </div>
                                            <div>
                                                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Created</span>
                                                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{new Date(batch.createdAt).toLocaleString('en-IN')}</div>
                                            </div>
                                        </div>

                                        {batch.notes && (
                                            <div style={{ marginTop: '10px', fontSize: '12px', color: 'var(--text-muted)' }}>
                                                <strong>Note:</strong> {batch.notes}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* Tab 3: Paid History */}
                {activeTab === 'paid_history' && (
                    <div className="card" style={{ padding: '20px', borderRadius: '12px', background: 'var(--card-bg, #ffffff)', border: '1px solid var(--border-color, #e2e8f0)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
                            <h3 style={{ fontSize: '16px', fontWeight: '600', margin: 0 }}>Settled Batches</h3>
                            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                                {data?.paidHistory.length || 0} completed disbursement(s)
                            </span>
                        </div>

                        <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                                <thead>
                                    <tr style={{ borderBottom: '2px solid var(--border-color, #e2e8f0)', textAlign: 'left', color: 'var(--text-muted)' }}>
                                        <th style={{ padding: '10px 12px' }}>Settlement #</th>
                                        <th style={{ padding: '10px 12px' }}>Shop</th>
                                        <th style={{ padding: '10px 12px' }}>Date</th>
                                        <th style={{ padding: '10px 12px' }}>Method</th>
                                        <th style={{ padding: '10px 12px' }}>Reference</th>
                                        <th style={{ padding: '10px 12px', textAlign: 'right' }}>Orders</th>
                                        <th style={{ padding: '10px 12px', textAlign: 'right' }}>Disbursed</th>
                                        <th style={{ padding: '10px 12px', textAlign: 'center' }}>Statement</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {(!data || data.paidHistory.length === 0) ? (
                                        <tr>
                                            <td colSpan={8} style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)' }}>
                                                No completed settlements in history.
                                            </td>
                                        </tr>
                                    ) : (
                                        data.paidHistory.map(b => (
                                            <tr key={b.id} style={{ borderBottom: '1px solid var(--border-color, #f1f5f9)' }}>
                                                <td style={{ padding: '12px', fontFamily: 'monospace', fontWeight: '600' }}>
                                                    {b.settlementNumber}
                                                </td>
                                                <td style={{ padding: '12px', fontWeight: '500' }}>
                                                    {b.shopName}
                                                </td>
                                                <td style={{ padding: '12px', color: 'var(--text-muted)' }}>
                                                    {new Date(b.settledAt).toLocaleDateString('en-IN')}
                                                </td>
                                                <td style={{ padding: '12px' }}>
                                                    <span className="badge badge-neutral">{b.paymentMethod}</span>
                                                </td>
                                                <td style={{ padding: '12px', fontFamily: 'monospace', fontSize: '12px' }}>
                                                    {b.paymentReference}
                                                </td>
                                                <td style={{ padding: '12px', textAlign: 'right' }}>
                                                    {b.orderCount}
                                                </td>
                                                <td style={{ padding: '12px', textAlign: 'right', fontWeight: '700', color: '#16a34a' }}>
                                                    ₹{b.vendorPayableAmount.toFixed(2)}
                                                </td>
                                                <td style={{ padding: '12px', textAlign: 'center' }}>
                                                    <button
                                                        type="button"
                                                        className="btn btn-secondary"
                                                        onClick={() => handleDownloadStatement(b.id, b.settlementNumber)}
                                                        style={{ padding: '4px 8px', fontSize: '12px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                                                        title="Download CSV Statement"
                                                    >
                                                        <Download size={12} />
                                                        CSV
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
            </div>

            {/* Create Batch Modal */}
            {createShop && (
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
                    <div style={{ background: '#ffffff', borderRadius: '12px', padding: '24px', width: '680px', maxWidth: '95%', maxHeight: '90vh', overflowY: 'auto' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                            <div>
                                <h3 style={{ fontSize: '18px', fontWeight: '700', margin: 0 }}>Create Settlement Batch</h3>
                                <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: '4px 0 0' }}>
                                    Shop: <strong>{createShop.shopName}</strong>
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setCreateShop(null)}
                                style={{ background: 'none', border: 'none', cursor: 'pointer' }}
                            >
                                <X size={20} />
                            </button>
                        </div>

                        {loadingEligible ? (
                            <div style={{ padding: '32px', textAlign: 'center' }}>
                                <RefreshCw size={24} className="spin" style={{ margin: '0 auto' }} />
                                <div style={{ marginTop: '8px', fontSize: '13px' }}>Loading eligible orders…</div>
                            </div>
                        ) : eligibleOrders.length === 0 ? (
                            <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)' }}>
                                No eligible orders available for batching.
                            </div>
                        ) : (
                            <div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                                    <span style={{ fontSize: '13px', fontWeight: '600' }}>
                                        Eligible Orders ({selectedLedgerIds.length} of {eligibleOrders.length} selected)
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            if (selectedLedgerIds.length === eligibleOrders.length) {
                                                setSelectedLedgerIds([]);
                                            } else {
                                                setSelectedLedgerIds(eligibleOrders.map(o => o.orderFinancialLedgerId));
                                            }
                                        }}
                                        style={{ fontSize: '12px', color: 'var(--primary-color, #0284c7)', background: 'none', border: 'none', cursor: 'pointer' }}
                                    >
                                        {selectedLedgerIds.length === eligibleOrders.length ? 'Deselect All' : 'Select All'}
                                    </button>
                                </div>

                                <div style={{ maxHeight: '240px', overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px', marginBottom: '16px' }}>
                                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                                        <thead>
                                            <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', textAlign: 'left' }}>
                                                <th style={{ padding: '8px 10px', width: '36px' }}></th>
                                                <th style={{ padding: '8px 10px' }}>Order #</th>
                                                <th style={{ padding: '8px 10px' }}>Date</th>
                                                <th style={{ padding: '8px 10px', textAlign: 'right' }}>Gross</th>
                                                <th style={{ padding: '8px 10px', textAlign: 'right' }}>Fee</th>
                                                <th style={{ padding: '8px 10px', textAlign: 'right' }}>Net Payable</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {eligibleOrders.map(order => (
                                                <tr key={order.orderFinancialLedgerId} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                                    <td style={{ padding: '8px 10px' }}>
                                                        <input
                                                            type="checkbox"
                                                            checked={selectedLedgerIds.includes(order.orderFinancialLedgerId)}
                                                            onChange={e => {
                                                                if (e.target.checked) {
                                                                    setSelectedLedgerIds(prev => [...prev, order.orderFinancialLedgerId]);
                                                                } else {
                                                                    setSelectedLedgerIds(prev => prev.filter(id => id !== order.orderFinancialLedgerId));
                                                                }
                                                            }}
                                                        />
                                                    </td>
                                                    <td style={{ padding: '8px 10px', fontFamily: 'monospace', fontWeight: '500' }}>
                                                        {order.orderNumber || order.orderId.slice(0, 8)}
                                                    </td>
                                                    <td style={{ padding: '8px 10px', color: 'var(--text-muted)' }}>
                                                        {new Date(order.createdAt).toLocaleDateString('en-IN')}
                                                    </td>
                                                    <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                                                        ₹{order.grossAmount.toFixed(2)}
                                                    </td>
                                                    <td style={{ padding: '8px 10px', textAlign: 'right', color: '#0284c7' }}>
                                                        ₹{order.platformCommissionAmount.toFixed(2)}
                                                    </td>
                                                    <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: '600', color: '#16a34a' }}>
                                                        ₹{order.vendorNetAmount.toFixed(2)}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>

                                {/* Calculation breakdown */}
                                <div style={{ padding: '14px', background: '#f8fafc', borderRadius: '8px', marginBottom: '16px', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
                                    <div>
                                        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Gross Orders</span>
                                        <div style={{ fontSize: '16px', fontWeight: '600' }}>₹{selectedGross.toFixed(2)}</div>
                                    </div>
                                    <div>
                                        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Platform Fee</span>
                                        <div style={{ fontSize: '16px', fontWeight: '600', color: '#0284c7' }}>₹{selectedFee.toFixed(2)}</div>
                                    </div>
                                    <div>
                                        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Total Net to Disburse</span>
                                        <div style={{ fontSize: '18px', fontWeight: '700', color: '#16a34a' }}>₹{selectedNet.toFixed(2)}</div>
                                    </div>
                                </div>

                                <div style={{ marginBottom: '20px' }}>
                                    <label style={{ display: 'block', fontSize: '13px', fontWeight: '500', marginBottom: '6px' }}>Notes (Optional)</label>
                                    <input
                                        type="text"
                                        placeholder="e.g. Weekly settlement for Super Xerox"
                                        value={createNotes}
                                        onChange={e => setCreateNotes(e.target.value)}
                                        style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '13px' }}
                                    />
                                </div>

                                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                                    <button
                                        type="button"
                                        className="btn btn-secondary"
                                        onClick={() => setCreateShop(null)}
                                        disabled={submittingCreate}
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="button"
                                        className="btn btn-primary"
                                        onClick={handleSubmitCreateBatch}
                                        disabled={submittingCreate || selectedLedgerIds.length === 0}
                                    >
                                        {submittingCreate ? 'Creating Batch…' : `Create Batch (₹${selectedNet.toFixed(2)})`}
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Mark Paid Modal */}
            {payingBatch && (
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
                    <div style={{ background: '#ffffff', borderRadius: '12px', padding: '24px', width: '440px', maxWidth: '90%' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                            <h3 style={{ fontSize: '18px', fontWeight: '700', margin: 0 }}>Record External Disbursement</h3>
                            <button
                                type="button"
                                onClick={() => setPayingBatch(null)}
                                style={{ background: 'none', border: 'none', cursor: 'pointer' }}
                            >
                                <X size={20} />
                            </button>
                        </div>

                        <div style={{ padding: '12px', background: '#f8fafc', borderRadius: '8px', marginBottom: '16px' }}>
                            <div style={{ fontSize: '13px', fontWeight: '600' }}>{payingBatch.settlementNumber}</div>
                            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Shop: {payingBatch.shopName}</div>
                            <div style={{ fontSize: '18px', fontWeight: '700', color: '#16a34a', marginTop: '6px' }}>
                                Payable: ₹{payingBatch.vendorPayableAmount.toFixed(2)}
                            </div>
                        </div>

                        <div style={{ marginBottom: '14px' }}>
                            <label style={{ display: 'block', fontSize: '13px', fontWeight: '500', marginBottom: '6px' }}>Disbursement Method</label>
                            <select
                                value={paymentMethod}
                                onChange={e => setPaymentMethod(e.target.value)}
                                style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '13px' }}
                            >
                                <option value="UPI">UPI</option>
                                <option value="NEFT">NEFT</option>
                                <option value="IMPS">IMPS</option>
                                <option value="BANK_TRANSFER">Bank Transfer (RTGS / Account)</option>
                                <option value="OTHER">Other External Transfer</option>
                            </select>
                        </div>

                        <div style={{ marginBottom: '20px' }}>
                            <label style={{ display: 'block', fontSize: '13px', fontWeight: '500', marginBottom: '6px' }}>
                                Payment Transaction Reference (UTR / UPI Ref ID) *
                            </label>
                            <input
                                type="text"
                                placeholder="e.g. UTR123456789012"
                                value={paymentReference}
                                onChange={e => setPaymentReference(e.target.value)}
                                style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '13px' }}
                                required
                            />
                            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                                Required for immutable audit trail.
                            </span>
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                            <button
                                type="button"
                                className="btn btn-secondary"
                                onClick={() => setPayingBatch(null)}
                                disabled={submittingPay}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                className="btn btn-success"
                                onClick={handleSubmitMarkPaid}
                                disabled={submittingPay || !paymentReference.trim()}
                            >
                                {submittingPay ? 'Recording…' : 'Record as PAID'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

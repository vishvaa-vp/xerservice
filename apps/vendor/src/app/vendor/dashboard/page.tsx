'use client';

import { useEffect, useState, useCallback, useRef, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { AlertTriangle, ArrowRight, Calendar, CheckCircle2, CheckSquare, CreditCard, Download, FileText, Loader2, LogOut, Package, Printer, ReceiptText, RefreshCw, Search, Sparkles, Store, TrendingUp, X } from 'lucide-react';

type RevenueRange = 'today' | 'week' | 'month' | 'custom';

interface VendorShopData {
    id: string;
    name: string;
    status: string;
    closing_soon: boolean;
    closing_message: string | null;
}

interface OverviewData {
    shop: {
        id: string;
        name: string;
    };
    metrics: {
        commissionConfigured?: boolean;
        todayRevenue: number | null;
        totalRevenue: number | null;
        grossSales?: number;
        platformCommission?: number | null;
        todayCompletedOrders: number;
        totalOrders: number;
    };
    range: RevenueRange;
    chartData: { label: string; amount: number }[];
    orderTypes: {
        totalPaidOrders: number;
        items: { key: string; label: string; count: number; percentage: number; color: string }[];
    };
    paymentSummary: {
        upiPayments: number;
        successfulPayments: number;
        refundedPayments: number;
    };
}

function VendorDashboardContent() {
    const params = useSearchParams();
    const router = useRouter();
    const [activeTab, setActiveTab] = useState<'queue' | 'overview'>('overview');

    // Vendor Auth & Shop State
    const [loadingAuth, setLoadingAuth] = useState(true);
    const [authError, setAuthError] = useState<string | null>(null);
    const [vendorUserId, setVendorUserId] = useState<string | null>(null);
    const [vendorShop, setVendorShop] = useState<VendorShopData | null>(null);
    const [updatingStatus, setUpdatingStatus] = useState(false);

    // Shop Open / Closed & Closing Soon State
    const [shopOpen, setShopOpen] = useState(true);
    const [closingSoon, setClosingSoon] = useState(false);
    const [showClosingSoonDialog, setShowClosingSoonDialog] = useState(false);
    const [closingSoonReason, setClosingSoonReason] = useState('');
    const [showStoreConfirm, setShowStoreConfirm] = useState(false);
    const [pendingStoreAction, setPendingStoreAction] = useState<'open' | 'close'>('open');
    const [feedback, setFeedback] = useState<{ type: 'success' | 'warning'; title: string; description: string } | null>(null);

    // Document Queue State
    const [queueOrders, setQueueOrders] = useState<any[]>([]);
    const [loadingQueue, setLoadingQueue] = useState(true);
    const [queueError, setQueueError] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [actionOrderId, setActionOrderId] = useState<string | null>(null);
    const [activePrintJob, setActivePrintJob] = useState<{ order: any; file: any } | null>(null);
    const [vendorAuthToken, setVendorAuthToken] = useState<string | null>(null);

    // Vendor Order Cancellation State
    const [cancellingVendorOrder, setCancellingVendorOrder] = useState<any | null>(null);
    const [vendorCancelReason, setVendorCancelReason] = useState<string>('Out of paper / Stock shortage');
    const [customCancelReason, setCustomCancelReason] = useState<string>('');
    const [isCancellingOrder, setIsCancellingOrder] = useState<boolean>(false);
    const [vendorCancelError, setVendorCancelError] = useState<string | null>(null);

    // Overview Analytics State
    const [overviewData, setOverviewData] = useState<OverviewData | null>(null);
    const [loadingOverview, setLoadingOverview] = useState(true);
    const [overviewError, setOverviewError] = useState<string | null>(null);

    const [revenueRange, setRevenueRange] = useState<RevenueRange>('today');
    const [showCustomRange, setShowCustomRange] = useState(false);
    const [customRange, setCustomRange] = useState(() => {
        const end = new Date();
        const start = new Date();
        start.setDate(start.getDate() - 7);
        const fmt = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);
        return { start: fmt(start), end: fmt(end) };
    });
    const today = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });

    useEffect(() => {
        const tab = params.get('tab');
        const mobile = matchMedia('(max-width: 768px)');
        const selectTab = () => setActiveTab(tab === 'overview' ? 'overview' : 'queue');
        selectTab();
        mobile.addEventListener('change', selectTab);
        return () => mobile.removeEventListener('change', selectTab);
    }, [params]);

    // 1. Authorize Vendor and Load Owned Shop from Supabase
    useEffect(() => {
        let isMounted = true;

        async function initVendorHQ() {
            try {
                setLoadingAuth(true);
                setAuthError(null);

                const { data: { session }, error: sessionError } = await supabase.auth.getSession();
                if (sessionError || !session?.user) {
                    router.replace('/vendor/login');
                    return;
                }

                // Verify vendor role in public.profiles
                const { data: profile, error: profileError } = await supabase
                    .from('profiles')
                    .select('id, user_id, role, full_name')
                    .eq('user_id', session.user.id)
                    .maybeSingle();

                if (profileError) {
                    throw new Error(profileError.message);
                }

                if (!profile || profile.role !== 'vendor') {
                    if (isMounted) {
                        setAuthError('Access denied. This account does not have vendor privileges.');
                        setLoadingAuth(false);
                    }
                    return;
                }

                if (isMounted) {
                    setVendorUserId(session.user.id);
                    setVendorAuthToken(session.access_token);
                }

                // Fetch shop owned by this vendor from public.shops
                const { data: shop, error: shopError } = await supabase
                    .from('shops')
                    .select('id, name, status, closing_soon, closing_message')
                    .eq('owner_id', session.user.id)
                    .maybeSingle();

                if (shopError) {
                    throw new Error(shopError.message);
                }

                if (!shop) {
                    if (isMounted) {
                        setAuthError('No shop assigned to this vendor account.');
                        setLoadingAuth(false);
                    }
                    return;
                }

                if (isMounted) {
                    const mappedShop: VendorShopData = {
                        id: shop.id,
                        name: shop.name,
                        status: shop.status,
                        closing_soon: Boolean(shop.closing_soon),
                        closing_message: shop.closing_message,
                    };
                    setVendorShop(mappedShop);
                    const isOpen = mappedShop.status === 'OPEN';
                    const isClosing = mappedShop.closing_soon;
                    setShopOpen(isOpen);
                    setClosingSoon(isClosing);
                    setClosingSoonReason(mappedShop.closing_message || '');
                }
            } catch (err: unknown) {
                console.error('[VendorHQ] Initialization error:', err);
                if (isMounted) {
                    const msg = err instanceof Error ? err.message : 'Unable to connect to database.';
                    setAuthError(`Authentication error: ${msg}`);
                }
            } finally {
                if (isMounted) {
                    setLoadingAuth(false);
                }
            }
        }

        initVendorHQ();

        return () => {
            isMounted = false;
        };
    }, [router]);

    // Realtime listener for vendor shop updates
    useEffect(() => {
        if (!vendorShop?.id) return;

        const channel = supabase
            .channel(`vendor_shop_channel_${vendorShop.id}`)
            .on('postgres_changes', {
                event: 'UPDATE',
                schema: 'public',
                table: 'shops',
                filter: `id=eq.${vendorShop.id}`,
            }, (payload) => {
                const updated = payload.new as any;
                if (updated) {
                    const isOpen = updated.status === 'OPEN';
                    const isClosing = Boolean(updated.closing_soon);
                    setShopOpen(isOpen);
                    setClosingSoon(isClosing);
                    setClosingSoonReason(updated.closing_message || '');
                    setVendorShop(prev => prev ? {
                        ...prev,
                        name: updated.name,
                        status: updated.status,
                        closing_soon: isClosing,
                        closing_message: updated.closing_message,
                    } : null);
                }
            })
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [vendorShop?.id]);

    // 2. Real Document Queue Fetcher
    const fetchQueue = useCallback(async () => {
        try {
            setQueueError(null);
            const { data: { session } } = await supabase.auth.getSession();
            if (!session?.access_token) return;

            const res = await fetch('/api/vendor/orders', {
                headers: {
                    Authorization: `Bearer ${session.access_token}`,
                },
            });

            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.error || 'Failed to fetch queue');
            }

            const data = await res.json();
            setQueueOrders(data.orders || []);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Error fetching queue';
            console.error('[VendorHQ] Queue fetch error:', msg);
            setQueueError(msg);
        } finally {
            setLoadingQueue(false);
        }
    }, []);

    // 2b. Real Overview Analytics Fetcher
    const fetchOverview = useCallback(async (targetRange?: RevenueRange, targetCustomRange?: { start: string; end: string }) => {
        try {
            setOverviewError(null);
            const { data: { session } } = await supabase.auth.getSession();
            if (!session?.access_token) return;

            const activeRange = targetRange || revenueRange;
            const activeCustom = targetCustomRange || customRange;

            let url = `/api/vendor/overview?range=${activeRange}`;
            if (activeRange === 'custom') {
                url += `&from=${encodeURIComponent(activeCustom.start)}&to=${encodeURIComponent(activeCustom.end)}`;
            }

            const res = await fetch(url, {
                headers: {
                    Authorization: `Bearer ${session.access_token}`,
                },
            });

            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.error || 'Failed to fetch overview analytics');
            }

            const data: OverviewData = await res.json();
            setOverviewData(data);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Error fetching overview';
            console.error('[VendorHQ] Overview fetch error:', msg);
            setOverviewError(msg);
        } finally {
            setLoadingOverview(false);
        }
    }, [revenueRange, customRange]);

    // 3. Realtime Queue & Overview Subscription: Auto-refetch when orders change
    useEffect(() => {
        if (!vendorShop?.id) return;
        fetchQueue();
        fetchOverview();

        const channel = supabase
            .channel(`vendor_queue_channel_${vendorShop.id}`)
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'orders',
                filter: `shop_id=eq.${vendorShop.id}`,
            }, () => {
                fetchQueue();
                fetchOverview();
            })
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [vendorShop?.id, fetchQueue, fetchOverview]);

    // 4. Secure Status Transition Handler
    const handleStatusTransition = async (orderId: string, expectedStatus: string, newStatus: string) => {
        if (actionOrderId) return;
        setActionOrderId(orderId);

        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session?.access_token) throw new Error('Not authenticated');

            const res = await fetch(`/api/vendor/orders/${orderId}/status`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${session.access_token}`,
                },
                body: JSON.stringify({ expectedStatus, newStatus }),
            });

            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(data.error || 'Status update failed');
            }

            if (newStatus === 'COMPLETED') {
                setQueueOrders(prev => prev.filter(o => o.id !== orderId));
                triggerFeedback('success', 'Order Completed', 'Order has been marked as collected and removed from active queue.');
            } else {
                setQueueOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: newStatus } : o));
                const actionLabel = newStatus === 'PRINTING' ? 'Printing Started' : 'Order Ready';
                const actionDesc = newStatus === 'PRINTING' ? 'The customer tracker now displays "Running".' : 'The customer has been notified their print is ready.';
                triggerFeedback('success', actionLabel, actionDesc);
            }
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Status update failed';
            triggerFeedback('warning', 'Update Failed', msg);
        } finally {
            setActionOrderId(null);
        }
    };

    // 4b. Vendor Order Cancellation & Refund Handler
    const handleConfirmVendorCancel = async () => {
        if (!cancellingVendorOrder) return;
        setIsCancellingOrder(true);
        setVendorCancelError(null);

        const effectiveReason = vendorCancelReason === 'Custom'
            ? customCancelReason.trim()
            : vendorCancelReason;

        if (!effectiveReason) {
            setVendorCancelError('Please specify a cancellation reason.');
            setIsCancellingOrder(false);
            return;
        }

        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session?.access_token) throw new Error('Not authenticated');

            const res = await fetch(`/api/vendor/orders/${cancellingVendorOrder.id}/cancel`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${session.access_token}`,
                },
                body: JSON.stringify({ reason: effectiveReason }),
            });

            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(data.error || 'Failed to cancel order.');
            }

            setQueueOrders(prev => prev.filter(o => o.id !== cancellingVendorOrder.id));
            triggerFeedback('warning', 'Order Cancelled', data.message || `Order #${cancellingVendorOrder.order_number} cancelled and refunded.`);
            setCancellingVendorOrder(null);
            setCustomCancelReason('');
            fetchOverview();
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Cancellation failed';
            setVendorCancelError(msg);
        } finally {
            setIsCancellingOrder(false);
        }
    };

    // 5. In-Memory Print Job Handler (No local disk download)
    const handleOpenPrintJob = async (order: any, file: any) => {
        let token = vendorAuthToken;
        if (!token) {
            const { data: { session } } = await supabase.auth.getSession();
            token = session?.access_token || null;
            if (token) setVendorAuthToken(token);
        }
        setActivePrintJob({ order, file });
    };

    const filteredOrders = queueOrders.filter(order => {
        if (!searchQuery.trim()) return true;
        const q = searchQuery.toLowerCase().trim();
        const orderNum = (order.order_number || '').toLowerCase();
        const customer = (order.customerName || '').toLowerCase();
        const file = order.order_files?.[0]?.original_filename?.toLowerCase() || '';
        return orderNum.includes(q) || customer.includes(q) || file.includes(q);
    });

    const triggerFeedback = (type: 'success' | 'warning', title: string, description: string) => {
        setFeedback({ type, title, description });
        setTimeout(() => {
            setFeedback(prev => (prev?.title === title ? null : prev));
        }, 4000);
    };

    const handleVendorSignOut = async () => {
        await supabase.auth.signOut();
        router.replace('/vendor/login');
    };

    const requestStoreToggle = () => {
        if (updatingStatus || !vendorShop) return;
        const nextAction = shopOpen ? 'close' : 'open';
        setPendingStoreAction(nextAction);
        setShowStoreConfirm(true);
    };

    const handleConfirmStoreAction = async () => {
        setShowStoreConfirm(false);
        if (!vendorShop || !vendorUserId) return;

        setUpdatingStatus(true);
        const willBeOpen = pendingStoreAction === 'open';
        const newStatus = willBeOpen ? 'OPEN' : 'CLOSED';

        try {
            // Update Supabase public.shops
            const { error: updateError } = await supabase
                .from('shops')
                .update({
                    status: newStatus,
                    closing_soon: false,
                    closing_message: null,
                    updated_at: new Date().toISOString(),
                })
                .eq('id', vendorShop.id)
                .eq('owner_id', vendorUserId);

            if (updateError) {
                throw new Error(updateError.message);
            }

            setShopOpen(willBeOpen);
            setClosingSoon(false);
            setClosingSoonReason('');
            setVendorShop(prev => prev ? {
                ...prev,
                status: newStatus,
                closing_soon: false,
                closing_message: null,
            } : null);

            if (willBeOpen) {
                triggerFeedback('success', 'Store is now Open', 'Your shop is online and ready to accept customer orders.');
            } else {
                triggerFeedback('warning', 'Store is now Closed', 'Your shop is offline. Customers cannot place new orders.');
            }
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Failed to update store status';
            console.error('[VendorHQ] Store toggle error:', err);
            triggerFeedback('warning', 'Update Failed', msg);
        } finally {
            setUpdatingStatus(false);
        }
    };

    const requestClosingSoonToggle = async () => {
        if (!shopOpen || updatingStatus || !vendorShop || !vendorUserId) return;

        if (closingSoon) {
            // Turn OFF Closing Soon
            setUpdatingStatus(true);
            try {
                const { error: updateError } = await supabase
                    .from('shops')
                    .update({
                        closing_soon: false,
                        closing_message: null,
                        updated_at: new Date().toISOString(),
                    })
                    .eq('id', vendorShop.id)
                    .eq('owner_id', vendorUserId);

                if (updateError) {
                    throw new Error(updateError.message);
                }

                setClosingSoon(false);
                setClosingSoonReason('');
                setVendorShop(prev => prev ? {
                    ...prev,
                    closing_soon: false,
                    closing_message: null,
                } : null);

                triggerFeedback('success', 'Closing Soon Removed', 'Your store is back to regular open status.');
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : 'Failed to remove closing soon notice';
                console.error('[VendorHQ] Clear closing soon error:', err);
                triggerFeedback('warning', 'Update Failed', msg);
            } finally {
                setUpdatingStatus(false);
            }
            return;
        }

        // Turning ON Closing Soon: Prompt modal for message
        setShowClosingSoonDialog(true);
    };

    const confirmClosingSoon = async () => {
        if (!vendorShop || !vendorUserId) return;
        const finalReason = closingSoonReason.trim() || 'Closing in 5-10 minutes';
        setShowClosingSoonDialog(false);
        setUpdatingStatus(true);

        try {
            const { error: updateError } = await supabase
                .from('shops')
                .update({
                    status: 'OPEN',
                    closing_soon: true,
                    closing_message: finalReason,
                    updated_at: new Date().toISOString(),
                })
                .eq('id', vendorShop.id)
                .eq('owner_id', vendorUserId);

            if (updateError) {
                throw new Error(updateError.message);
            }

            setClosingSoon(true);
            setClosingSoonReason(finalReason);
            setVendorShop(prev => prev ? {
                ...prev,
                status: 'OPEN',
                closing_soon: true,
                closing_message: finalReason,
            } : null);

            triggerFeedback('warning', 'Closing Soon Notice Active', 'New customer orders have been paused.');
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Failed to set closing soon notice';
            console.error('[VendorHQ] Set closing soon error:', err);
            triggerFeedback('warning', 'Update Failed', msg);
        } finally {
            setUpdatingStatus(false);
        }
    };

    const currentRevenueData = overviewData?.chartData || [];
    const selectedTotalRevenue = currentRevenueData.reduce((sum, item) => sum + item.amount, 0);
    const maxRevenue = Math.max(...currentRevenueData.map(item => item.amount), 1);

    const orderTypeItems = overviewData?.orderTypes?.items || [
        { key: 'bw', label: 'B&W', count: 0, percentage: 0, color: '#54bdce' },
        { key: 'colour', label: 'Colour', count: 0, percentage: 0, color: '#8edce8' },
        { key: 'mixed', label: 'Mixed', count: 0, percentage: 0, color: '#a78bfa' },
        { key: 'others', label: 'Others', count: 0, percentage: 0, color: '#d4d7de' },
    ];
    const totalPaidOrders = overviewData?.orderTypes?.totalPaidOrders ?? 0;

    let donutGradientStyle = 'var(--border)';
    if (totalPaidOrders > 0) {
        let currentDeg = 0;
        const stops: string[] = [];
        for (const item of orderTypeItems) {
            if (item.percentage > 0) {
                const nextDeg = currentDeg + (item.percentage / 100) * 360;
                stops.push(`${item.color} ${currentDeg}deg ${nextDeg}deg`);
                currentDeg = nextDeg;
            }
        }
        if (stops.length > 0) {
            if (currentDeg < 360) {
                stops.push(`#d4d7de ${currentDeg}deg 360deg`);
            }
            donutGradientStyle = `conic-gradient(${stops.join(', ')})`;
        }
    }

    const setRange = (range: RevenueRange) => {
        setRevenueRange(range);
        setShowCustomRange(range === 'custom');
        if (range !== 'custom') {
            fetchOverview(range);
        }
    };

    const handleApplyCustomRange = () => {
        setShowCustomRange(false);
        fetchOverview('custom', customRange);
    };

    if (loadingAuth) {
        return (
            <div className="page-wrapper" style={{ background: 'var(--bg-secondary)', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div className="card" style={{ padding: '36px', textAlign: 'center', maxWidth: '400px' }}>
                    <span className="spinner" style={{ width: '28px', height: '28px', margin: '0 auto 16px' }} />
                    <h2 style={{ fontSize: '18px', fontWeight: '900', marginBottom: '6px' }}>Loading Vendor HQ</h2>
                    <p style={{ fontSize: '13px', color: 'var(--fg-muted)' }}>Verifying credentials and loading shop controls...</p>
                </div>
            </div>
        );
    }

    if (authError) {
        return (
            <div className="page-wrapper" style={{ background: 'var(--bg-secondary)', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div className="card" style={{ padding: '36px', textAlign: 'center', maxWidth: '440px', borderColor: 'rgba(239, 68, 68, 0.3)' }}>
                    <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: 'rgba(239, 68, 68, 0.12)', color: '#ef4444', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
                        <AlertTriangle size={24} />
                    </div>
                    <h2 style={{ fontSize: '20px', fontWeight: '900', marginBottom: '8px' }}>Access Denied</h2>
                    <p style={{ fontSize: '14px', color: 'var(--fg-muted)', marginBottom: '24px', lineHeight: 1.5 }}>
                        {authError}
                    </p>
                    <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
                        <button
                            onClick={handleVendorSignOut}
                            className="btn btn-primary"
                        >
                            Sign In as Vendor
                        </button>
                        <Link href="/" className="btn btn-outline">
                            Return to Homepage
                        </Link>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <>
        <div className="page-wrapper" style={{ background: 'var(--bg-secondary)', minHeight: '100vh' }}>
            <div style={{ background: 'var(--bg)', borderBottom: '1px solid var(--border)', padding: '32px 0 0' }}>
                <div className="container">
                    <div className="vendor-header">
                        <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', color: 'var(--fg-subtle)', fontSize: '12px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0, flexWrap: 'wrap' }}>
                                <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><Calendar size={14} /> Today: {today}</span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                                <h1 style={{ fontSize: '32px', fontWeight: '900', letterSpacing: 0 }}>{vendorShop?.name || 'D-Block Reprography ITECH'}</h1>
                            </div>
                            <p style={{ fontSize: '14px', color: 'var(--fg-muted)', marginTop: '4px' }}>
                                Vendor Dashboard
                            </p>
                        </div>
                        <div className="vendor-toggles" id="store-controls">
                            <label className="toggle-wrap vendor-toggle" style={{ cursor: updatingStatus ? 'wait' : 'pointer' }} onClick={requestStoreToggle}>
                                <button
                                    type="button"
                                    className={`toggle ${shopOpen ? 'on' : ''}`}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        requestStoreToggle();
                                    }}
                                    disabled={updatingStatus}
                                    aria-pressed={shopOpen}
                                    aria-label={`Store Open: ${shopOpen ? 'ON' : 'OFF'}`}
                                >
                                    <span className="toggle-knob" />
                                </button>
                                <span>Store Open: {shopOpen ? 'ON' : 'OFF'}</span>
                            </label>
                            <label className="toggle-wrap vendor-toggle" style={{ opacity: shopOpen ? 1 : 0.55, cursor: (!shopOpen || updatingStatus) ? 'not-allowed' : 'pointer' }}>
                                <button
                                    type="button"
                                    className={`toggle ${closingSoon ? 'on' : ''}`}
                                    onClick={requestClosingSoonToggle}
                                    disabled={!shopOpen || updatingStatus}
                                    aria-pressed={closingSoon}
                                    aria-label={`Closing Soon: ${closingSoon ? 'ON' : 'OFF'}`}
                                >
                                    <span className="toggle-knob" />
                                </button>
                                <span>Closing Soon: {closingSoon ? 'ON' : 'OFF'}</span>
                            </label>
                        </div>
                    </div>

                    {closingSoon && (
                        <div className="vendor-closing-alert">
                            <AlertTriangle size={17} />
                            <span>{closingSoonReason || 'Closing in 5-10 minutes. New customer orders are paused.'}</span>
                        </div>
                    )}

                    <div className="vendor-tabs">
                        {(['queue', 'overview'] as const).map(tab => (
                            <button key={tab} className={`tab-btn ${activeTab === tab ? 'active' : ''}`} onClick={() => { setActiveTab(tab); router.replace(`/vendor/dashboard?tab=${tab}`, { scroll: false }); }}>
                                {tab.charAt(0).toUpperCase() + tab.slice(1)}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            <main className="section-sm">
                <div className="container">
                    {activeTab === 'overview' && (
                        <div className="fade-in">
                            <div className="vendor-summary-grid">
                                <StatCard
                                    icon={TrendingUp}
                                    value={overviewData?.metrics?.commissionConfigured === false || overviewData?.metrics?.todayRevenue === null || overviewData?.metrics?.todayRevenue === undefined
                                        ? '—'
                                        : `Rs ${(overviewData?.metrics?.todayRevenue ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                                    label="Today Revenue"
                                    color="#54bdce"
                                    trend={overviewData?.metrics?.commissionConfigured === false ? 'Pending' : 'Today'}
                                    subtext={overviewData?.metrics?.commissionConfigured === false ? 'Commission setup pending' : undefined}
                                />
                                <StatCard
                                    icon={ReceiptText}
                                    value={overviewData?.metrics?.commissionConfigured === false || overviewData?.metrics?.totalRevenue === null || overviewData?.metrics?.totalRevenue === undefined
                                        ? '—'
                                        : `Rs ${(overviewData?.metrics?.totalRevenue ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                                    label="Total Revenue"
                                    color="#3b82f6"
                                    trend={overviewData?.metrics?.commissionConfigured === false ? 'Pending' : 'All Time'}
                                    subtext={overviewData?.metrics?.commissionConfigured === false ? 'Commission setup pending' : undefined}
                                />
                                <StatCard
                                    icon={Package}
                                    value={String(overviewData?.metrics?.totalOrders ?? 0)}
                                    label="Total Orders"
                                    color="#22c55e"
                                    trend="Paid"
                                />
                                <StatCard
                                    icon={CheckSquare}
                                    value={String(overviewData?.metrics?.todayCompletedOrders ?? 0)}
                                    label="Today Completed Orders"
                                    color="#54bdce"
                                    trend="Completed"
                                />
                            </div>

                            <div className="vendor-overview-grid">
                                <div className="card vendor-revenue-card">
                                    <div className="vendor-section-head">
                                        <div>
                                            <h2>Revenue Overview</h2>
                                            <p>Track your revenue and business growth.</p>
                                        </div>
                                        <div className="vendor-range-tabs">
                                            {[
                                                ['today', 'Today'],
                                                ['week', 'This Week'],
                                                ['month', 'This Month'],
                                                ['custom', 'Custom'],
                                            ].map(([range, label]) => (
                                                <button key={range} className={revenueRange === range ? 'active' : ''} onClick={() => setRange(range as RevenueRange)}>
                                                    {label}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    {showCustomRange && (
                                        <div className="vendor-custom-range">
                                            <label>
                                                <span>Start Date</span>
                                                <input type="date" className="input" value={customRange.start} onChange={(event) => setCustomRange(prev => ({ ...prev, start: event.target.value }))} />
                                            </label>
                                            <label>
                                                <span>End Date</span>
                                                <input type="date" className="input" value={customRange.end} onChange={(event) => setCustomRange(prev => ({ ...prev, end: event.target.value }))} />
                                            </label>
                                            <button className="btn btn-accent" onClick={handleApplyCustomRange}>Apply</button>
                                        </div>
                                    )}

                                    <div className="vendor-bars" aria-label="Revenue bar chart">
                                        {currentRevenueData.length === 0 ? (
                                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', color: 'var(--fg-muted)', fontSize: '13px' }}>
                                                {loadingOverview ? 'Loading chart data...' : 'No revenue recorded'}
                                            </div>
                                        ) : (
                                            currentRevenueData.map(item => {
                                                const heightPercent = item.amount > 0
                                                    ? Math.max(12, (item.amount / maxRevenue) * 100)
                                                    : 0;
                                                return (
                                                    <div className="vendor-bar-col" key={item.label}>
                                                        <span className="vendor-bar-value">Rs {item.amount.toLocaleString('en-IN')}</span>
                                                        <div className="vendor-bar-track">
                                                            <div className="vendor-bar-fill" style={{ height: `${heightPercent}%` }} />
                                                        </div>
                                                        <span className="vendor-bar-label">{item.label}</span>
                                                    </div>
                                                );
                                            })
                                        )}
                                    </div>
                                    <div className="vendor-revenue-total">
                                        <span>Selected revenue</span>
                                        <strong>
                                            {overviewData?.metrics?.commissionConfigured === false
                                                ? '— (Commission setup pending)'
                                                : `Rs ${selectedTotalRevenue.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                                        </strong>
                                    </div>
                                </div>

                                <div className="card vendor-order-types-card">
                                    <div className="vendor-section-head compact">
                                        <div>
                                            <h2>Order Types</h2>
                                            <p>Distribution of orders by print type.</p>
                                        </div>
                                    </div>
                                    <div className="donut-wrap">
                                        <div className="donut-chart" style={{ background: donutGradientStyle }} />
                                        <div className="donut-center">
                                            <strong>{totalPaidOrders}</strong>
                                            <span>orders</span>
                                        </div>
                                    </div>
                                    <div className="donut-legend">
                                        {orderTypeItems.map(item => (
                                            <LegendItem key={item.label} color={item.color} label={item.label} value={`${item.percentage}%`} />
                                        ))}
                                    </div>
                                </div>

                                <div className="card vendor-payment-card">
                                    <div className="vendor-section-head compact">
                                        <div>
                                            <h2>Payment Summary</h2>
                                            <p>Revenue by payment status.</p>
                                        </div>
                                    </div>
                                    <PaymentRow
                                        icon={CreditCard}
                                        label="UPI Payments"
                                        value={`Rs ${(overviewData?.paymentSummary?.upiPayments ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                                    />
                                    <PaymentRow
                                        icon={CheckSquare}
                                        label="Successful Payments"
                                        value={`Rs ${(overviewData?.paymentSummary?.successfulPayments ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                                    />
                                    <PaymentRow
                                        icon={ReceiptText}
                                        label="Refunded"
                                        value={`Rs ${(overviewData?.paymentSummary?.refundedPayments ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                                        muted
                                    />
                                </div>
                            </div>

                            <button className="vendor-report-row">
                                <div className="vendor-report-icon"><FileText size={24} /></div>
                                <div>
                                    <h2>View Reports</h2>
                                    <p>View detailed revenue and order reports.</p>
                                </div>
                                <ArrowRight size={20} />
                            </button>
                        </div>
                    )}

                    {activeTab === 'queue' && (
                        <div className="fade-in">
                            <div className="card vendor-queue-card">
                                <div className="vendor-queue-head">
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                        <h2>Document Queue</h2>
                                        <span className="badge badge-accent" style={{ fontSize: '11px' }}>
                                            {queueOrders.length} {queueOrders.length === 1 ? 'order' : 'orders'}
                                        </span>
                                    </div>
                                    <div className="vendor-search">
                                        <input
                                            className="input"
                                            placeholder="Search order or customer..."
                                            value={searchQuery}
                                            onChange={(e) => setSearchQuery(e.target.value)}
                                        />
                                        <button className="btn btn-primary" aria-label="Search"><Search size={16} /></button>
                                    </div>
                                </div>

                                {loadingQueue ? (
                                    <div style={{ padding: '40px', textAlign: 'center', color: 'var(--fg-muted)' }}>
                                        <span className="spinner" style={{ width: '24px', height: '24px', margin: '0 auto 12px' }} />
                                        <p style={{ fontSize: '13px' }}>Loading real document queue...</p>
                                    </div>
                                ) : queueError ? (
                                    <div style={{ padding: '30px', textAlign: 'center', color: '#ef4444' }}>
                                        <p style={{ fontSize: '14px', fontWeight: '800' }}>Error loading queue</p>
                                        <p style={{ fontSize: '12.5px', marginTop: '4px' }}>{queueError}</p>
                                        <button onClick={fetchQueue} className="btn btn-outline btn-sm" style={{ marginTop: '12px' }}>
                                            Retry
                                        </button>
                                    </div>
                                ) : filteredOrders.length === 0 ? (
                                    <div style={{ padding: '48px 20px', textAlign: 'center', color: 'var(--fg-muted)', border: '1px dashed var(--border)', borderRadius: '8px' }}>
                                        <p style={{ fontSize: '15px', fontWeight: '800', color: 'var(--fg)' }}>
                                            {searchQuery ? 'No matching orders found' : 'No active orders in queue'}
                                        </p>
                                        <p style={{ fontSize: '13px', marginTop: '4px' }}>
                                            {searchQuery ? 'Try searching with a different order number or customer name.' : 'Newly confirmed customer orders will appear here automatically in real time.'}
                                        </p>
                                    </div>
                                ) : (
                                    <div className="vendor-order-list">
                                        {filteredOrders.map(order => (
                                            <OrderCard
                                                key={order.id}
                                                order={order}
                                                actionOrderId={actionOrderId}
                                                onTransition={handleStatusTransition}
                                                onOpenPrintJob={handleOpenPrintJob}
                                                onCancel={(order) => {
                                                    setCancellingVendorOrder(order);
                                                    setVendorCancelReason('Out of paper / Stock shortage');
                                                    setCustomCancelReason('');
                                                    setVendorCancelError(null);
                                                }}
                                            />
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </main>

            <style>{`
                .vendor-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: flex-end;
                    gap: 20px;
                    flex-wrap: wrap;
                    margin-bottom: 24px;
                }
                .vendor-toggles {
                    display: flex;
                    gap: 12px;
                    flex-wrap: wrap;
                }
                .vendor-toggle {
                    background: var(--bg-secondary);
                    padding: 8px 12px;
                    border-radius: 8px;
                    border: 1px solid var(--border);
                }
                .vendor-toggle span {
                    font-size: 12px;
                    font-weight: 800;
                }
                .vendor-tabs {
                    display: flex;
                    gap: 26px;
                    overflow-x: auto;
                }
                .vendor-closing-alert {
                    display: inline-flex;
                    align-items: center;
                    gap: 8px;
                    padding: 10px 12px;
                    border-radius: 8px;
                    background: var(--accent-muted);
                    color: var(--accent);
                    border: 1px solid var(--accent-border);
                    font-size: 13px;
                    font-weight: 900;
                    margin-bottom: 18px;
                }
                .vendor-tabs .tab-btn {
                    padding-bottom: 15px;
                    font-size: 15px;
                    text-transform: capitalize;
                    flex: 0 0 auto;
                }
                .vendor-summary-grid {
                    display: grid;
                    grid-template-columns: repeat(4, minmax(0, 1fr));
                    gap: 16px;
                    margin-bottom: 16px;
                }
                .vendor-overview-grid {
                    display: grid;
                    grid-template-columns: minmax(0, 2fr) minmax(280px, 0.95fr);
                    gap: 16px;
                    align-items: stretch;
                    margin-bottom: 16px;
                }
                .vendor-revenue-card {
                    grid-row: span 2;
                    padding: 22px;
                    border-radius: 8px;
                }
                .vendor-order-types-card,
                .vendor-payment-card {
                    padding: 22px;
                    border-radius: 8px;
                }
                .vendor-section-head {
                    display: flex;
                    align-items: flex-start;
                    justify-content: space-between;
                    gap: 14px;
                    margin-bottom: 22px;
                }
                .vendor-section-head.compact {
                    margin-bottom: 18px;
                }
                .vendor-queue-card {
                    padding: 22px;
                    border-radius: 8px;
                }
                .vendor-section-head h2,
                .vendor-queue-head h2 {
                    font-size: 18px;
                    font-weight: 900;
                    letter-spacing: 0;
                }
                .vendor-section-head p {
                    font-size: 13px;
                    color: var(--fg-muted);
                    margin-top: 3px;
                }
                .vendor-range-tabs {
                    display: inline-flex;
                    border: 1px solid var(--border);
                    border-radius: 8px;
                    overflow: hidden;
                    background: var(--bg-secondary);
                    flex-shrink: 0;
                }
                .vendor-range-tabs button {
                    min-height: 38px;
                    padding: 0 14px;
                    color: var(--fg-muted);
                    font-size: 12px;
                    font-weight: 800;
                    border-right: 1px solid var(--border);
                }
                .vendor-range-tabs button:last-child {
                    border-right: 0;
                }
                .vendor-range-tabs button.active {
                    color: var(--accent);
                    background: var(--accent-muted);
                }
                .vendor-custom-range {
                    display: grid;
                    grid-template-columns: 1fr 1fr auto;
                    gap: 10px;
                    align-items: end;
                    margin-bottom: 18px;
                    padding: 12px;
                    border: 1px solid var(--border);
                    border-radius: 8px;
                    background: var(--bg-secondary);
                }
                .vendor-custom-range label span {
                    display: block;
                    font-size: 11px;
                    font-weight: 900;
                    color: var(--fg-subtle);
                    text-transform: uppercase;
                    margin-bottom: 5px;
                }
                .vendor-custom-range .input {
                    height: 42px;
                    border-radius: 8px;
                }
                .vendor-bars {
                    height: 250px;
                    display: grid;
                    grid-template-columns: repeat(var(--bar-count, 9), minmax(34px, 1fr));
                    gap: 12px;
                    align-items: end;
                    padding: 10px 0 0;
                    overflow-x: auto;
                }
                .vendor-bar-col {
                    min-width: 46px;
                    display: grid;
                    grid-template-rows: 20px 1fr 22px;
                    gap: 7px;
                    align-items: end;
                }
                .vendor-bar-value {
                    color: var(--fg-subtle);
                    font-size: 10px;
                    font-weight: 800;
                    text-align: center;
                    white-space: nowrap;
                }
                .vendor-bar-track {
                    height: 180px;
                    display: flex;
                    align-items: flex-end;
                    justify-content: center;
                    border-bottom: 1px solid var(--border);
                    background: repeating-linear-gradient(to top, transparent, transparent 43px, var(--border) 44px);
                }
                .vendor-bar-fill {
                    width: min(48px, 72%);
                    border-radius: 8px 8px 0 0;
                    background: linear-gradient(180deg, #8edce8, var(--accent));
                    box-shadow: 0 10px 24px rgba(84, 189, 206, 0.22);
                }
                .vendor-bar-label {
                    color: var(--fg-muted);
                    font-size: 12px;
                    font-weight: 800;
                    text-align: center;
                    white-space: nowrap;
                }
                .vendor-revenue-total {
                    display: flex;
                    justify-content: space-between;
                    gap: 12px;
                    padding-top: 16px;
                    margin-top: 10px;
                    border-top: 1px solid var(--border);
                    color: var(--fg-muted);
                    font-size: 13px;
                    font-weight: 800;
                }
                .vendor-revenue-total strong {
                    color: var(--accent);
                    font-size: 18px;
                    font-weight: 900;
                }
                .donut-wrap {
                    position: relative;
                    width: 168px;
                    height: 168px;
                    margin: 0 auto 18px;
                }
                .donut-chart {
                    width: 168px;
                    height: 168px;
                    border-radius: 50%;
                    background: conic-gradient(#54bdce 0 56%, #8edce8 56% 84%, #a78bfa 84% 95%, #d4d7de 95% 100%);
                }
                .donut-chart:after {
                    content: '';
                    position: absolute;
                    inset: 42px;
                    background: var(--bg);
                    border-radius: 50%;
                }
                .donut-center {
                    position: absolute;
                    inset: 0;
                    display: grid;
                    place-content: center;
                    text-align: center;
                }
                .donut-center strong {
                    font-size: 24px;
                    font-weight: 900;
                }
                .donut-center span {
                    color: var(--fg-muted);
                    font-size: 12px;
                    font-weight: 800;
                }
                .donut-legend,
                .payment-list {
                    display: grid;
                    gap: 10px;
                }
                .legend-item,
                .payment-row {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 12px;
                    color: var(--fg-muted);
                    font-size: 13px;
                    font-weight: 800;
                }
                .legend-left,
                .payment-left {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    min-width: 0;
                }
                .legend-dot {
                    width: 11px;
                    height: 11px;
                    border-radius: 50%;
                    flex-shrink: 0;
                }
                .legend-item strong,
                .payment-row strong {
                    color: var(--fg);
                    font-weight: 900;
                    white-space: nowrap;
                }
                .payment-row {
                    padding: 13px 0;
                    border-bottom: 1px solid var(--border);
                }
                .payment-row:last-child {
                    border-bottom: 0;
                }
                .payment-icon {
                    width: 34px;
                    height: 34px;
                    border-radius: 8px;
                    display: grid;
                    place-items: center;
                    background: var(--accent-muted);
                    color: var(--accent);
                    flex-shrink: 0;
                }
                .payment-row.muted .payment-icon {
                    background: var(--bg-secondary);
                    color: var(--fg-muted);
                }
                .vendor-report-row {
                    width: 100%;
                    display: grid;
                    grid-template-columns: auto minmax(0, 1fr) auto;
                    gap: 16px;
                    align-items: center;
                    padding: 20px;
                    border-radius: 8px;
                    border: 1px solid var(--border);
                    background: var(--bg);
                    color: var(--fg);
                    text-align: left;
                    box-shadow: var(--shadow-sm);
                }
                .vendor-report-row h2 {
                    font-size: 16px;
                    font-weight: 900;
                    letter-spacing: 0;
                    margin-bottom: 4px;
                }
                .vendor-report-row p {
                    color: var(--fg-muted);
                    font-size: 13px;
                    font-weight: 700;
                }
                .vendor-report-icon {
                    width: 48px;
                    height: 48px;
                    border-radius: 12px;
                    display: grid;
                    place-items: center;
                    border: 1px solid var(--border);
                    background: var(--bg-secondary);
                }
                .vendor-queue-head {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    gap: 12px;
                    flex-wrap: wrap;
                    margin-bottom: 16px;
                }
                .vendor-search {
                    display: flex;
                    gap: 8px;
                }
                .vendor-search .input {
                    height: 42px;
                    width: 220px;
                    border-radius: 8px;
                }
                .vendor-search .btn {
                    height: 42px;
                    width: 44px;
                    padding: 0;
                    border-radius: 8px;
                }
                .vendor-order-list {
                    display: grid;
                    gap: 10px;
                }
                .vendor-order-row {
                    display: grid;
                    grid-template-columns: 1fr auto;
                    gap: 12px;
                    align-items: center;
                    padding: 14px;
                    border: 1px solid var(--border);
                    border-radius: 8px;
                    background: var(--bg);
                }
                .vendor-order-meta {
                    display: flex;
                    gap: 8px;
                    flex-wrap: wrap;
                    margin-top: 8px;
                }
                @media (max-width: 640px) {
                    .vendor-summary-grid,
                    .vendor-overview-grid {
                        grid-template-columns: 1fr;
                    }
                    .vendor-section-head {
                        flex-direction: column;
                    }
                    .vendor-range-tabs {
                        width: 100%;
                        overflow-x: auto;
                    }
                    .vendor-range-tabs button {
                        flex: 1 0 auto;
                    }
                    .vendor-custom-range {
                        grid-template-columns: 1fr;
                    }
                    .vendor-header,
                    .vendor-toggles,
                    .vendor-toggle,
                    .vendor-search {
                        width: 100%;
                    }
                    .vendor-search .input {
                        width: 100%;
                    }
                    .vendor-order-row {
                        grid-template-columns: 1fr;
                    }
                    .vendor-order-row .badge {
                        width: fit-content;
                    }
                }
                @media (min-width: 641px) and (max-width: 1100px) {
                    .vendor-summary-grid {
                        grid-template-columns: repeat(2, minmax(0, 1fr));
                    }
                    .vendor-overview-grid {
                        grid-template-columns: 1fr;
                    }
                }
            `}</style>
        </div>
        <ConfirmDialog
            open={showClosingSoonDialog}
            title="Closing soon?"
            message="The shop will stop accepting new orders because it is closing in 5-10 minutes. Add a short reason for customers."
            confirmLabel="Pause New Orders"
            onConfirm={confirmClosingSoon}
            onCancel={() => setShowClosingSoonDialog(false)}
        >
            <textarea
                className="input"
                value={closingSoonReason}
                onChange={(event) => setClosingSoonReason(event.target.value)}
                placeholder="Example: Closing in 10 minutes"
                rows={3}
                style={{ resize: 'vertical', minHeight: '86px', marginTop: '12px' }}
            />
        </ConfirmDialog>
        <ConfirmDialog
            open={showStoreConfirm}
            title={pendingStoreAction === 'close' ? 'Close Store?' : 'Open Store?'}
            message={
                pendingStoreAction === 'close'
                    ? 'Are you sure you want to close your store? Your shop will be shown as closed and customers will not be able to place new print orders.'
                    : 'Are you sure you want to open your store? Your shop will be listed as open and live to receive incoming print orders.'
            }
            confirmLabel={pendingStoreAction === 'close' ? 'Confirm & Close Store' : 'Confirm & Open Store'}
            destructive={pendingStoreAction === 'close'}
            onConfirm={handleConfirmStoreAction}
            onCancel={() => setShowStoreConfirm(false)}
        />

        <ConfirmDialog
            open={!!cancellingVendorOrder}
            title={`Cancel Order #${cancellingVendorOrder?.order_number}?`}
            message={`Cancelling this queued order will immediately refund ₹${Number(cancellingVendorOrder?.total_amount || 0).toFixed(2)} to the customer. Please select a reason:`}
            confirmLabel={isCancellingOrder ? 'Cancelling...' : 'Confirm & Refund'}
            destructive={true}
            onConfirm={handleConfirmVendorCancel}
            onCancel={() => { if (!isCancellingOrder) { setCancellingVendorOrder(null); setVendorCancelError(null); } }}
        >
            <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <select
                    className="input"
                    value={vendorCancelReason}
                    onChange={(e) => setVendorCancelReason(e.target.value)}
                    style={{ width: '100%', padding: '8px 12px' }}
                >
                    <option value="Out of paper / Stock shortage">Out of paper / Stock shortage</option>
                    <option value="Printer / Hardware maintenance">Printer / Hardware maintenance</option>
                    <option value="Shop closing early">Shop closing early</option>
                    <option value="Customer requested cancellation">Customer requested cancellation</option>
                    <option value="Custom">Other (Specify below)</option>
                </select>

                {vendorCancelReason === 'Custom' && (
                    <input
                        type="text"
                        className="input"
                        placeholder="Enter cancellation reason..."
                        value={customCancelReason}
                        onChange={(e) => setCustomCancelReason(e.target.value)}
                        style={{ width: '100%', marginTop: '4px' }}
                    />
                )}

                {vendorCancelError && (
                    <p style={{ fontSize: '13px', color: '#dc2626', margin: '4px 0 0' }}>
                        {vendorCancelError}
                    </p>
                )}
            </div>
        </ConfirmDialog>

        {feedback && (
            <div
                className="scale-in"
                style={{
                    position: 'fixed',
                    top: '24px',
                    right: '24px',
                    zIndex: 1300,
                    maxWidth: '380px',
                    background: 'var(--bg)',
                    border: `1.5px solid ${feedback.type === 'success' ? '#22c55e' : 'var(--accent)'}`,
                    borderRadius: '16px',
                    padding: '16px 20px',
                    boxShadow: '0 12px 36px rgba(0,0,0,0.24)',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '12px',
                    animation: 'fadeIn 0.25s ease',
                }}
            >
                <div
                    style={{
                        width: '32px',
                        height: '32px',
                        borderRadius: '10px',
                        background: feedback.type === 'success' ? 'rgba(34, 197, 94, 0.12)' : 'var(--accent-muted)',
                        color: feedback.type === 'success' ? '#22c55e' : 'var(--accent)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                        marginTop: '1px',
                    }}
                >
                    {feedback.type === 'success' ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
                </div>
                <div style={{ flex: 1 }}>
                    <p style={{ fontSize: '14px', fontWeight: '800', margin: 0, color: 'var(--fg)' }}>
                        {feedback.title}
                    </p>
                    <p style={{ fontSize: '12.5px', color: 'var(--fg-muted)', margin: '3px 0 0', lineHeight: 1.4 }}>
                        {feedback.description}
                    </p>
                </div>
                <button
                    type="button"
                    onClick={() => setFeedback(null)}
                    style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--fg-subtle)',
                        cursor: 'pointer',
                        padding: '2px',
                        display: 'flex',
                    }}
                    aria-label="Close notification"
                >
                    <X size={15} />
                </button>
            </div>
        )}
        {activePrintJob && (
            <VendorPrintJobModal
                job={activePrintJob}
                authToken={vendorAuthToken}
                onClose={() => setActivePrintJob(null)}
                onTransition={handleStatusTransition}
                isBusy={Boolean(actionOrderId)}
            />
        )}
        </>
    );
}

function VendorPrintJobModal({
    job,
    authToken,
    onClose,
    onTransition,
    isBusy,
}: {
    job: { order: any; file: any } | null;
    authToken: string | null;
    onClose: () => void;
    onTransition: (orderId: string, expectedStatus: string, newStatus: string) => Promise<void>;
    isBusy: boolean;
}) {
    const iframeRef = useRef<HTMLIFrameElement | null>(null);

    if (!job || !authToken) return null;

    const { order, file } = job;
    const settings = file?.print_settings;
    const isColour = settings?.colour_mode === 'COLOUR';
    const copies = settings?.copies || 1;
    const sides = settings?.sides === 'DOUBLE_LONG_EDGE' ? 'Double Sided (Long Edge)' : settings?.sides === 'DOUBLE_SHORT_EDGE' ? 'Double Sided (Short Edge)' : 'Single Sided';
    const paper = settings?.paper_size || 'A4';
    const orientation = settings?.orientation ? (settings.orientation.charAt(0).toUpperCase() + settings.orientation.slice(1)) : 'Portrait';
    const pages = order.total_printable_pages || file?.printable_pages || 1;
    const sheets = order.total_sheets || file?.physical_sheets || 1;
    const pageRange = settings?.page_selection === 'RANGE' && settings?.page_range ? settings.page_range : 'All Pages';

    const pdfUrl = `/api/vendor/orders/${order.id}/files/${file.id}/download?inline=true&token=${encodeURIComponent(authToken)}`;

    const handlePrint = () => {
        if (iframeRef.current?.contentWindow) {
            iframeRef.current.contentWindow.focus();
            iframeRef.current.contentWindow.print();
        }
    };

    return (
        <div className="modal-overlay" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
            <div className="card fade-in" style={{ width: '100%', maxWidth: '860px', maxHeight: '94vh', display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden', borderRadius: '16px', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.35)', background: 'var(--bg)' }}>
                {/* Modal Header */}
                <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--bg-secondary)' }}>
                    <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <h2 style={{ fontSize: '18px', fontWeight: '900', margin: 0 }}>Order #{order.order_number}</h2>
                            <span className={`badge ${order.status === 'COMPLETED' ? 'badge-success' : order.status === 'PRINTING' ? 'badge-accent' : 'badge-warning'}`} style={{ fontSize: '11px' }}>
                                {order.status}
                            </span>
                        </div>
                        <p style={{ fontSize: '12.5px', color: 'var(--fg-muted)', margin: '2px 0 0' }}>
                            Customer: <strong>{order.customerName}</strong> • File: <strong style={{ color: 'var(--fg)' }}>{file.original_filename}</strong>
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="btn-ghost"
                        style={{ width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '8px', cursor: 'pointer', border: 'none' }}
                        aria-label="Close modal"
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* Authoritative Customer Print Settings Banner */}
                <div style={{ padding: '12px 20px', background: 'var(--accent-muted)', borderBottom: '1px solid var(--accent-border)', display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                    <span style={{ fontSize: '11px', fontWeight: '800', textTransform: 'uppercase', color: 'var(--accent)', marginRight: '4px' }}>
                        Customer Settings:
                    </span>
                    <span className="badge badge-accent" style={{ fontSize: '12px', fontWeight: '700' }}>
                        {isColour ? '🎨 Colour' : '⚫ Black & White'}
                    </span>
                    <span className="badge badge-outline" style={{ fontSize: '12px', fontWeight: '700' }}>
                        📄 {paper}
                    </span>
                    <span className="badge badge-outline" style={{ fontSize: '12px', fontWeight: '700' }}>
                        🔄 {sides}
                    </span>
                    <span className="badge badge-outline" style={{ fontSize: '12px', fontWeight: '700' }}>
                        🧭 {orientation}
                    </span>
                    <span className="badge badge-outline" style={{ fontSize: '12px', fontWeight: '700' }}>
                        📑 {copies} {copies === 1 ? 'Copy' : 'Copies'}
                    </span>
                    <span className="badge badge-outline" style={{ fontSize: '12px', fontWeight: '700' }}>
                        🔢 {pageRange}
                    </span>
                    <span className="badge badge-outline" style={{ fontSize: '12px', fontWeight: '700' }}>
                        📊 {pages} {pages === 1 ? 'Page' : 'Pages'} ({sheets} {sheets === 1 ? 'Sheet' : 'Sheets'})
                    </span>
                </div>

                {/* Finishing Add-on Requirement Banner */}
                <div style={{ padding: '10px 20px', background: file?.addons?.length ? 'rgba(234, 88, 12, 0.12)' : 'var(--bg-secondary)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '11px', fontWeight: '800', textTransform: 'uppercase', color: file?.addons?.length ? '#ea580c' : 'var(--fg-muted)' }}>
                        👉 FINISHING REQUIREMENT:
                    </span>
                    {file?.addons && file.addons.length > 0 ? (
                        file.addons.map((a: any, idx: number) => (
                            <span key={idx} className="badge" style={{ background: '#ea580c', color: '#fff', fontSize: '12px', fontWeight: '800' }}>
                                ✨ {a.addonNameSnapshot} (+Rs {Number(a.unitPriceSnapshot).toFixed(2)})
                            </span>
                        ))
                    ) : (
                        <span style={{ fontSize: '12px', color: 'var(--fg-muted)', fontWeight: '600' }}>None</span>
                    )}
                </div>

                {/* Secure In-Memory Document Frame (No file download to disk) */}
                <div style={{ flex: 1, minHeight: '380px', background: '#525659', position: 'relative' }}>
                    <iframe
                        ref={iframeRef}
                        src={pdfUrl}
                        title={`PDF Preview for Order #${order.order_number}`}
                        style={{ width: '100%', height: '100%', minHeight: '440px', border: 'none', display: 'block' }}
                    />
                </div>

                {/* Print Controls & Sequential Order Progression */}
                <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--bg-secondary)', flexWrap: 'wrap', gap: '10px' }}>
                    <div style={{ fontSize: '12px', color: 'var(--fg-muted)' }}>
                        Document rendered in-memory. Native print dialog targets this document only.
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <button
                            type="button"
                            onClick={handlePrint}
                            className="btn btn-primary"
                            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: '700' }}
                        >
                            <Printer size={15} /> Print Document
                        </button>

                        {order.status === 'QUEUED' && (
                            <button
                                type="button"
                                className="btn btn-accent"
                                onClick={async () => {
                                    await onTransition(order.id, 'QUEUED', 'PRINTING');
                                }}
                                disabled={isBusy || order.has_active_refund}
                                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: '700' }}
                            >
                                {isBusy ? <Loader2 size={15} className="spin" /> : <Printer size={15} />} Start Printing
                            </button>
                        )}

                        {order.status === 'PRINTING' && (
                            <button
                                type="button"
                                className="btn btn-accent"
                                onClick={async () => {
                                    await onTransition(order.id, 'PRINTING', 'READY');
                                }}
                                disabled={isBusy}
                                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: '700' }}
                            >
                                {isBusy ? <Loader2 size={15} className="spin" /> : <CheckCircle2 size={15} />} Mark as Ready
                            </button>
                        )}

                        {order.status === 'READY' && (
                            <button
                                type="button"
                                className="btn btn-primary"
                                onClick={async () => {
                                    await onTransition(order.id, 'READY', 'COMPLETED');
                                    onClose();
                                }}
                                disabled={isBusy}
                                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: '700', background: '#16a34a', borderColor: '#16a34a' }}
                            >
                                {isBusy ? <Loader2 size={15} className="spin" /> : <Package size={15} />} Complete Order
                            </button>
                        )}

                        <button
                            type="button"
                            onClick={onClose}
                            className="btn btn-outline"
                            style={{ fontSize: '13px' }}
                        >
                            Close
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

interface RealOrderProps {
    order: {
        id: string;
        order_number: string;
        user_id: string;
        shop_id: string;
        status: string;
        payment_status: string;
        total_original_pages: number;
        total_printable_pages: number;
        total_sheets: number;
        total_amount: number;
        created_at: string;
        paid_at: string | null;
        customerName: string;
        has_active_refund?: boolean;
        order_files?: Array<{
            id: string;
            original_filename: string;
            printable_pages: number;
            physical_sheets: number;
            print_settings?: {
                colour_mode: string;
                sides: string;
                orientation: string;
                copies: number;
                pages_per_sheet: number;
                paper_size: string;
                page_selection: string;
                page_range: string | null;
            };
            addons?: Array<{
                addonNameSnapshot: string;
                unitPriceSnapshot: number;
                quantity: number;
                totalPrice: number;
            }>;
        }>;
    };
    actionOrderId: string | null;
    onTransition: (orderId: string, expectedStatus: string, newStatus: string) => Promise<void>;
    onOpenPrintJob: (order: any, file: any) => void;
    onCancel?: (order: any) => void;
}

function OrderCard({ order, actionOrderId, onTransition, onOpenPrintJob, onCancel }: RealOrderProps) {
    const isBusy = actionOrderId === order.id;
    const file = order.order_files?.[0];
    const settings = file?.print_settings;
    const isColour = settings?.colour_mode === 'COLOUR';
    const copies = settings?.copies || 1;
    const sides = settings?.sides === 'DOUBLE_LONG_EDGE' ? 'Double (Long)' : settings?.sides === 'DOUBLE_SHORT_EDGE' ? 'Double (Short)' : 'Single';
    const pages = order.total_printable_pages || file?.printable_pages || 1;
    const sheets = order.total_sheets || file?.physical_sheets || 1;
    const paper = settings?.paper_size || 'A4';
    const timeStr = new Date(order.paid_at || order.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

    return (
        <div className="vendor-order-row">
            <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <p style={{ fontSize: '16px', fontWeight: '900', margin: 0 }}>#{order.order_number}</p>
                    <span className="badge badge-accent" style={{ fontSize: '11px', padding: '2px 8px' }}>
                        Rs {Number(order.total_amount).toFixed(2)}
                    </span>
                    {order.has_active_refund && (
                        <span className="badge badge-warning" style={{ background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a', fontWeight: 600, fontSize: '11px', padding: '2px 8px' }}>
                            Refund Pending
                        </span>
                    )}
                </div>
                <p style={{ fontSize: '13px', color: 'var(--fg-muted)', marginTop: '3px' }}>
                    Customer: <strong>{order.customerName}</strong> | {timeStr}
                </p>

                {/* Per-File Breakdown with Clear Finishing Requirements */}
                <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {(order.order_files || []).map((f, idx) => {
                        const fSettings = f.print_settings;
                        const fColour = fSettings?.colour_mode === 'COLOUR';
                        const fSides = fSettings?.sides === 'DOUBLE_LONG_EDGE' ? 'Double (Long)' : fSettings?.sides === 'DOUBLE_SHORT_EDGE' ? 'Double (Short)' : 'Single';
                        const fPages = f.printable_pages || 1;
                        const fAddons = f.addons || [];
                        return (
                            <div key={f.id || idx} style={{ padding: '8px 12px', borderRadius: '10px', background: 'var(--bg-secondary)', border: '1px solid var(--border)', fontSize: '12.5px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                    <span style={{ fontWeight: '700', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                        <FileText size={14} color="var(--accent)" />
                                        {idx + 1}. {f.original_filename} ({fPages} {fPages === 1 ? 'page' : 'pages'}, {fSides}, {fColour ? 'Colour' : 'B&W'})
                                    </span>
                                    {f.id && (
                                        <button
                                            type="button"
                                            className="btn btn-outline btn-sm"
                                            onClick={() => onOpenPrintJob(order, f)}
                                            disabled={isBusy}
                                            style={{ fontSize: '11px', padding: '3px 8px', height: 'auto', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                                            title="View document and print settings"
                                        >
                                            <Printer size={12} /> View/Print
                                        </button>
                                    )}
                                </div>
                                <div style={{ marginTop: '4px', fontSize: '12px', fontWeight: '800', color: fAddons.length > 0 ? '#ea580c' : 'var(--fg-muted)' }}>
                                    👉 FINISHING: {fAddons.length > 0 ? fAddons.map(a => a.addonNameSnapshot).join(', ') : 'None'}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    {order.has_active_refund && (
                        <span className="badge badge-warning" style={{ background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a', fontWeight: 600, fontSize: '11px' }}>
                            Refund Pending
                        </span>
                    )}
                    <span className={`badge ${order.status === 'COMPLETED' ? 'badge-success' : order.status === 'PRINTING' ? 'badge-accent' : 'badge-warning'}`}>
                        <Printer size={12} /> {order.status}
                    </span>
                </div>

                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    {file?.id && (
                        <button
                            type="button"
                            className="btn btn-outline btn-sm"
                            onClick={() => onOpenPrintJob(order, file)}
                            disabled={isBusy}
                            style={{ fontSize: '12px', padding: '6px 10px', height: 'auto', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                            title="View document and print settings"
                        >
                            <Printer size={13} /> Print Job
                        </button>
                    )}

                    {order.status === 'QUEUED' && (
                        <>
                            <button
                                type="button"
                                className="btn btn-primary btn-sm"
                                onClick={() => onTransition(order.id, 'QUEUED', 'PRINTING')}
                                disabled={isBusy || order.has_active_refund}
                                style={{
                                    fontSize: '12px',
                                    padding: '6px 12px',
                                    height: 'auto',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                    opacity: order.has_active_refund ? 0.6 : 1,
                                    cursor: order.has_active_refund ? 'not-allowed' : 'pointer'
                                }}
                                title={order.has_active_refund ? "Cancellation/Refund in progress - printing blocked" : "Start printing"}
                            >
                                {isBusy ? <Loader2 size={13} className="spin" /> : <Printer size={13} />} Start Printing
                            </button>
                            <button
                                type="button"
                                className="btn btn-outline btn-sm"
                                onClick={() => onCancel?.(order)}
                                disabled={isBusy || order.has_active_refund}
                                style={{ fontSize: '12px', padding: '6px 10px', height: 'auto', color: '#dc2626', borderColor: '#fca5a5' }}
                                title={order.has_active_refund ? "Cancellation already in progress" : "Cancel order and refund customer"}
                            >
                                Cancel
                            </button>
                        </>
                    )}

                    {order.status === 'PRINTING' && (
                        <button
                            type="button"
                            className="btn btn-accent btn-sm"
                            onClick={() => onTransition(order.id, 'PRINTING', 'READY')}
                            disabled={isBusy}
                            style={{ fontSize: '12px', padding: '6px 12px', height: 'auto', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                        >
                            {isBusy ? <Loader2 size={13} className="spin" /> : <CheckCircle2 size={13} />} Mark Ready
                        </button>
                    )}

                    {order.status === 'READY' && (
                        <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            onClick={() => onTransition(order.id, 'READY', 'COMPLETED')}
                            disabled={isBusy}
                            style={{ fontSize: '12px', padding: '6px 12px', height: 'auto', background: '#16a34a', borderColor: '#16a34a', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                        >
                            {isBusy ? <Loader2 size={13} className="spin" /> : <Package size={13} />} Complete Order
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}

function StatCard({
    icon: Icon,
    value,
    label,
    color,
    trend,
    subtext,
}: {
    icon: any;
    value: string;
    label: string;
    color: string;
    trend: string;
    subtext?: string;
}) {
    return (
        <div className="card" style={{ padding: '20px', borderRadius: '8px', minHeight: '128px' }}>
            <div style={{ width: '44px', height: '44px', borderRadius: '12px', background: `${color}15`, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '12px' }}>
                <Icon size={22} color={color} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: '12px' }}>
                <div>
                    <div style={{ fontSize: '30px', fontWeight: '900', lineHeight: 1.1 }}>{value}</div>
                    <div style={{ fontSize: '12px', fontWeight: '800', color: 'var(--fg-subtle)', marginTop: '6px', textTransform: 'uppercase', letterSpacing: 0 }}>{label}</div>
                    {subtext && (
                        <div style={{ fontSize: '11px', fontWeight: '600', color: '#eab308', marginTop: '4px' }}>{subtext}</div>
                    )}
                </div>
                <span style={{
                    fontSize: '12px',
                    fontWeight: '900',
                    color: trend === 'Pending' ? '#eab308' : '#16a34a',
                    background: trend === 'Pending' ? 'rgba(234, 179, 8, 0.12)' : 'rgba(34, 197, 94, 0.12)',
                    borderRadius: '999px',
                    padding: '5px 8px',
                    flexShrink: 0,
                }}>
                    {trend}
                </span>
            </div>
        </div>
    );
}

function LegendItem({ color, label, value }: { color: string; label: string; value: string }) {
    return (
        <div className="legend-item">
            <span className="legend-left"><i className="legend-dot" style={{ background: color }} />{label}</span>
            <strong>{value}</strong>
        </div>
    );
}

function PaymentRow({ icon: Icon, label, value, muted = false }: { icon: any; label: string; value: string; muted?: boolean }) {
    return (
        <div className={`payment-row ${muted ? 'muted' : ''}`}>
            <span className="payment-left"><span className="payment-icon"><Icon size={17} /></span>{label}</span>
            <strong>{value}</strong>
        </div>
    );
}

export default function VendorDashboardPage() {
    return (
        <Suspense fallback={
            <div style={{ minHeight: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Loader2 className="spinner animate-spin" size={36} />
            </div>
        }>
            <VendorDashboardContent />
        </Suspense>
    );
}

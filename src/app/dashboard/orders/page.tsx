'use client';
import { useReconnectRefresh } from '@/hooks/useReconnectRefresh';
import { notify } from '@/components/ui/Feedback';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/context/AppContext';
import Link from 'next/link';
import { OrderStatusChat } from '@/components/order/OrderStatusChat';
import { supabase } from '@/lib/supabase/client';
import type { CustomerOrder } from '@/types/orders';
import { formatOrderStatus, formatCurrency } from '@packages/shared';
import {
    Clock,
    Printer,
    PackageCheck,
    CheckCircle2,
    Inbox,
    ExternalLink,
    ChevronRight,
    Calendar,
    Receipt,
    FileText,
    Lock,
    X,
    Download,
    AlertCircle,
    Loader2,
    AlertTriangle,
    LifeBuoy,
} from 'lucide-react';

export default function OrdersPage() {
    const router = useRouter();
    const { isLoggedIn, isLoading, authInitialized, user } = useApp();
    const [realOrders, setRealOrders] = useState<CustomerOrder[]>([]);
    const [ordersLoading, setOrdersLoading] = useState(true);
    const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
    const [downloadingFileId, setDownloadingFileId] = useState<string | null>(null);
    const [downloadingReceiptId, setDownloadingReceiptId] = useState<string | null>(null);
    const [cancellingOrderId, setCancellingOrderId] = useState<string | null>(null);
    const [orderToCancel, setOrderToCancel] = useState<CustomerOrder | null>(null);
    const [cancelError, setCancelError] = useState<string | null>(null);
    const [cancelSuccessMsg, setCancelSuccessMsg] = useState<string | null>(null);

    const fetchRealOrders = useCallback(async () => {
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session?.access_token) {
                setOrdersLoading(false);
                return;
            }

            const res = await fetch('/api/customer/orders', {
                headers: { Authorization: `Bearer ${session.access_token}` },
            });

            if (!res.ok) throw new Error('Unable to load your orders. Reconnect and try again.');
            if (res.ok) {
                const data = await res.json();
                if (Array.isArray(data.orders)) {
                    // Filter out expired drafts defensively (expires_at <= now())
                    const now = Date.now();
                    const unexpired = data.orders.filter((o: CustomerOrder) => {
                        if (o.status === 'DRAFT') {
                            const exp = new Date(o.expires_at).getTime();
                            return Number.isFinite(exp) && exp > now;
                        }
                        return true;
                    });
                    setRealOrders(unexpired);
                }
            }
        } catch (err) {
            notify('Your orders could not be refreshed. Check your connection and try again.');
        } finally {
            setOrdersLoading(false);
        }
    }, []);

    useEffect(() => {
        if (!authInitialized || isLoading) return;
        if (!isLoggedIn) {
            router.push('/login?redirect=/dashboard/orders');
        } else {
            fetchRealOrders();
        }
    }, [isLoggedIn, isLoading, authInitialized, router, fetchRealOrders]);

    useReconnectRefresh(fetchRealOrders, user?.type === 'customer');

    // Realtime updates: subscribe to live changes on customer orders
    useEffect(() => {
        if (!user?.id) return;

        const channel = supabase
            .channel(`customer_orders_realtime_${user.id}`)
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'orders',
                filter: `user_id=eq.${user.id}`,
            }, () => {
                fetchRealOrders();
            })
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [user?.id, fetchRealOrders]);

    const handleDownloadFile = async (orderId: string, fileId: string) => {
        try {
            setDownloadingFileId(fileId);
            const { data: { session } } = await supabase.auth.getSession();
            if (!session?.access_token) {
                notify('Session expired. Please sign in again.');
                return;
            }

            const res = await fetch(`/api/customer/orders/${orderId}/files/${fileId}/download`, {
                headers: { Authorization: `Bearer ${session.access_token}` },
            });

            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                notify(errData.error || 'Failed to download file.');
                return;
            }

            const data = await res.json();
            if (data.downloadUrl) {
                window.open(data.downloadUrl, '_blank', 'noopener,noreferrer');
            }
        } catch (err) {
            console.error('Download error:', err);
            notify('Failed to download file.');
        } finally {
            setDownloadingFileId(null);
        }
    };

    const handleDownloadReceipt = async (orderId: string, orderNumber: string) => {
        try {
            setDownloadingReceiptId(orderId);
            const { data: { session } } = await supabase.auth.getSession();
            if (!session?.access_token) {
                notify('Session expired. Please sign in again.');
                return;
            }

            const res = await fetch(`/api/customer/orders/${orderId}/receipt`, {
                headers: { Authorization: `Bearer ${session.access_token}` },
            });

            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                notify(errData.error || 'Failed to generate payment receipt.');
                return;
            }

            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `XerService-Receipt-${orderNumber}.pdf`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
        } catch (err) {
            console.error('Receipt download error:', err);
            notify('Failed to download receipt.');
        } finally {
            setDownloadingReceiptId(null);
        }
    };

    const handleCancelOrder = async (order: CustomerOrder) => {
        try {
            setCancellingOrderId(order.id);
            setCancelError(null);
            const { data: { session } } = await supabase.auth.getSession();
            if (!session?.access_token) {
                notify('Session expired. Please sign in again.');
                return;
            }

            const res = await fetch(`/api/orders/${order.id}/cancel`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${session.access_token}`,
                },
                body: JSON.stringify({ reason: 'Cancelled by customer' }),
            });

            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(data.error || 'Failed to cancel order.');
            }

            setCancelSuccessMsg(data.message || 'Order cancelled successfully.');
            setOrderToCancel(null);
            await fetchRealOrders();
            setTimeout(() => setCancelSuccessMsg(null), 5000);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Failed to cancel order.';
            setCancelError(msg);
        } finally {
            setCancellingOrderId(null);
        }
    };

    if (!authInitialized || (isLoading && !isLoggedIn)) {
        return (
            <div style={{ minHeight: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span className="spinner spinner-lg" />
            </div>
        );
    }

    if (!isLoggedIn) {
        return (
            <div style={{ minHeight: '80vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '20px', padding: '40px' }}>
                <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: 'var(--accent-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Lock size={28} color="var(--accent)" />
                </div>
                <div style={{ textAlign: 'center' }}>
                    <p style={{ fontSize: '18px', fontWeight: '700', marginBottom: '8px' }}>Sign in required</p>
                    <p style={{ fontSize: '14px', color: 'var(--fg-muted)', marginBottom: '20px' }}>Please sign in to view your order history.</p>
                    <Link href="/login?redirect=/dashboard/orders" className="btn btn-accent">Sign In</Link>
                </div>
            </div>
        );
    }

    const statusConfig = (s: string) => {
        const def = formatOrderStatus(s);
        let icon = <Clock size={12} />;
        if (def.key === 'COMPLETED') icon = <CheckCircle2 size={12} />;
        else if (def.key === 'READY') icon = <PackageCheck size={12} />;
        else if (def.key === 'PRINTING') icon = <Printer size={12} />;
        else if (def.key === 'DRAFT') icon = <FileText size={12} />;
        else if (def.key === 'CANCELLED') icon = <X size={12} />;

        let cssClass = 'badge-outline';
        if (def.key === 'COMPLETED' || def.key === 'PAID') cssClass = 'badge-success';
        else if (def.key === 'READY') cssClass = 'badge-dark';
        else if (def.key === 'PRINTING' || def.key === 'AWAITING_PAYMENT') cssClass = 'badge-warning';
        else if (def.key === 'CANCELLED') cssClass = 'badge-danger';

        return {
            class: cssClass,
            icon,
            label: def.label,
        };
    };

    const placedCount = realOrders.filter(o => o.status !== 'DRAFT').length;
    const activeDrafts = realOrders.filter(o => o.status === 'DRAFT');
    const selectedOrder = realOrders.find((order) => order.id === selectedOrderId || order.order_number === selectedOrderId) || null;

    return (
        <div className="page-wrapper">
            <section className="section-sm">
                <div className="container">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '40px', borderBottom: '1px solid var(--border)', paddingBottom: '24px', gap: '12px', flexWrap: 'wrap' }}>
                        <div>
                            <h1 style={{ fontSize: '32px', fontWeight: '900', letterSpacing: '-0.04em', marginBottom: '8px' }}>My Orders</h1>
                            <p style={{ fontSize: '15px', color: 'var(--fg-muted)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <Receipt size={16} /> {placedCount} total orders placed{activeDrafts.length > 0 ? ` • ${activeDrafts.length} active draft` : ''}
                            </p>
                        </div>
                        <Link href="/" className="btn btn-accent">
                            Create New Order <ExternalLink size={16} />
                        </Link>
                    </div>

                    {/* Active Draft Banner if customer has an incomplete draft */}
                    {activeDrafts.length > 0 && (
                        <div style={{ marginBottom: '24px', padding: '16px 20px', borderRadius: '12px', background: 'var(--bg-secondary)', border: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                <AlertCircle size={20} color="var(--accent)" />
                                <div>
                                    <p style={{ fontSize: '14px', fontWeight: '800', margin: 0 }}>You have {activeDrafts.length} active draft order</p>
                                    <p style={{ fontSize: '12px', color: 'var(--fg-muted)', margin: 0 }}>Resume your upload session at {activeDrafts[0].shop?.name || 'the shop'}</p>
                                </div>
                            </div>
                            <Link href={`/order/upload?shop=${activeDrafts[0].shop_id}`} className="btn btn-primary btn-sm">
                                Resume Draft <ChevronRight size={14} />
                            </Link>
                        </div>
                    )}

                    {ordersLoading ? (
                        <div style={{ textAlign: 'center', padding: '80px 0' }}>
                            <Loader2 size={32} className="spin" style={{ margin: '0 auto 16px', color: 'var(--accent)' }} />
                            <p style={{ color: 'var(--fg-muted)', fontSize: '14px' }}>Loading your orders...</p>
                        </div>
                    ) : realOrders.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '100px 0', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', border: '2px dashed var(--border)' }}>
                            <div style={{ width: '80px', height: '80px', borderRadius: '50%', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px', color: 'var(--fg-subtle)', boxShadow: 'var(--shadow-sm)' }}>
                                <Inbox size={40} />
                            </div>
                            <h2 style={{ fontSize: '20px', fontWeight: '800', marginBottom: '12px', letterSpacing: '-0.02em' }}>No orders found</h2>
                            <p style={{ fontSize: '15px', color: 'var(--fg-muted)', marginBottom: '32px', maxWidth: '320px', margin: '0 auto 32px' }}>
                                You haven't placed any print orders yet. Start by finding a shop near you.
                            </p>
                            <Link href="/" className="btn btn-primary">Browse Print Shops</Link>
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            {realOrders.map(order => {
                                const isDraft = order.status === 'DRAFT';
                                const config = statusConfig(order.status);
                                const firstFile = order.order_files?.[0];
                                const fileCount = order.order_files?.length || 0;
                                const isColor = order.order_files?.some(f => f.print_settings?.colour_mode === 'COLOUR');
                                const isDouble = order.order_files?.some(f => f.print_settings?.sides?.startsWith('DOUBLE'));
                                const displayFileName = firstFile
                                    ? (fileCount > 1 ? `${firstFile.original_filename} (+${fileCount - 1} more)` : firstFile.original_filename)
                                    : 'Print Document';

                                return (
                                    <div key={order.id} className="card card-hover" style={{ padding: '0', overflow: 'hidden' }}>
                                        <div className="orders-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'stretch' }}>
                                            <div style={{ padding: '28px', flex: 1 }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
                                                    <span style={{ fontSize: '14px', fontWeight: '900', letterSpacing: '0.05em', color: 'var(--accent)', background: 'var(--accent-muted)', padding: '4px 12px', borderRadius: '6px' }}>
                                                        #{order.order_number || order.id.slice(0, 8)}
                                                    </span>
                                                    <span className={`badge ${config.class}`} style={{ gap: '6px', padding: '6px 12px' }}>
                                                        {config.icon} {config.label}
                                                    </span>
                                                    {order.payment_status === 'PAID' ? (
                                                        <span className="badge badge-success" style={{ fontSize: '11px', padding: '4px 8px' }}>
                                                            PAID
                                                        </span>
                                                    ) : (
                                                        <span className="badge badge-warning" style={{ fontSize: '11px', padding: '4px 8px' }}>
                                                            {order.payment_status}
                                                        </span>
                                                    )}
                                                </div>

                                                <Link href={`/order/upload?shop=${order.shop_id}`} style={{ fontSize: '20px', fontWeight: '800', marginBottom: '6px', letterSpacing: '-0.02em', display: 'inline-block', textDecoration: 'none' }}>
                                                    {order.shop?.name || 'Print Shop'}
                                                </Link>
                                                <p style={{ fontSize: '14px', color: 'var(--fg-muted)', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '20px' }}>
                                                    <FileText size={14} /> {displayFileName}
                                                </p>

                                                <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                                                    {[
                                                        { label: 'Printable Pages', val: `${order.total_printable_pages}` },
                                                        { label: 'Physical Sheets', val: `${order.total_sheets}` },
                                                        { label: 'Colour Mode', val: isColor ? 'Colour' : 'Black & White' },
                                                        { label: 'Print Mode', val: isDouble ? 'Double-sided' : 'Single-sided' },
                                                        { label: 'Payment', val: order.payment_status === 'PAID' ? 'Payment Confirmed' : order.payment_status }
                                                    ].map(item => (
                                                        <div key={item.label}>
                                                            <p style={{ fontSize: '11px', fontWeight: '700', color: 'var(--fg-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '2px' }}>{item.label}</p>
                                                            <p style={{ fontSize: '14px', fontWeight: '700' }}>{item.val}</p>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>

                                            <div className="orders-side" style={{ background: 'var(--bg-secondary)', padding: '28px', width: '220px', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', borderLeft: '1px solid var(--border)', textAlign: 'center' }}>
                                                <div style={{ fontSize: '28px', fontWeight: '900', letterSpacing: '-0.05em', color: 'var(--fg)', marginBottom: '4px' }}>{formatCurrency(Number(order.total_amount))}</div>
                                                <div style={{ fontSize: '12px', color: 'var(--fg-subtle)', display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '20px' }}>
                                                    <Calendar size={12} />
                                                    {new Date(order.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true })}
                                                </div>
                                                {isDraft ? (
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
                                                        <Link
                                                            href={`/order/upload?shop=${order.shop_id}`}
                                                            className="btn btn-accent btn-sm btn-full"
                                                            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                                                        >
                                                            Resume Upload <ChevronRight size={14} />
                                                        </Link>
                                                        <button
                                                            type="button"
                                                            className="btn btn-ghost btn-sm btn-full"
                                                            style={{ fontSize: '12px', color: 'var(--fg-muted)', padding: '4px' }}
                                                            onClick={() => setOrderToCancel(order)}
                                                        >
                                                            Cancel Draft
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
                                                        <button
                                                            className="btn btn-outline btn-sm btn-full"
                                                            style={{ background: 'var(--bg)' }}
                                                            onClick={() => setSelectedOrderId(order.id)}
                                                        >
                                                            Details <ChevronRight size={14} />
                                                        </button>
                                                        {(order.payment_status === 'PAID' || order.payment_status === 'REFUNDED') && (
                                                            <button
                                                                type="button"
                                                                className="btn btn-outline btn-sm btn-full"
                                                                style={{ background: 'var(--bg)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px', fontSize: '12px' }}
                                                                disabled={downloadingReceiptId === order.id}
                                                                onClick={() => handleDownloadReceipt(order.id, order.order_number)}
                                                            >
                                                                {downloadingReceiptId === order.id ? <Loader2 size={12} className="spin" /> : <Receipt size={12} />}
                                                                Download Receipt
                                                            </button>
                                                        )}
                                                        {(order.status === 'AWAITING_PAYMENT' || order.status === 'QUEUED') && (
                                                            <button
                                                                type="button"
                                                                className="btn btn-ghost btn-sm btn-full"
                                                                style={{ fontSize: '12px', color: '#dc2626', padding: '4px' }}
                                                                onClick={() => setOrderToCancel(order)}
                                                            >
                                                                Cancel Order
                                                            </button>
                                                        )}
                                                        <Link
                                                            href={`/contact?orderId=${order.id}&orderNumber=${encodeURIComponent(order.order_number || '')}`}
                                                            className="btn btn-ghost btn-sm btn-full"
                                                            style={{ fontSize: '12px', color: 'var(--fg-muted)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '4px', padding: '4px' }}
                                                        >
                                                            <LifeBuoy size={12} /> Need Help?
                                                        </Link>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </section>

            {/* Real Order Details Modal */}
            {selectedOrder && (
                <div className="overlay" onClick={() => setSelectedOrderId(null)}>
                    <div className="card fade-in" onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: '560px', maxHeight: '90vh', overflowY: 'auto', padding: '0', borderRadius: '18px' }}>
                        <div style={{ padding: '18px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'sticky', top: 0, background: 'var(--bg)', zIndex: 10 }}>
                            <div>
                                <h2 style={{ fontSize: '18px', fontWeight: '800', margin: 0 }}>Order Details</h2>
                                <p style={{ fontSize: '13px', color: 'var(--fg-muted)', margin: '2px 0 0' }}>#{selectedOrder.order_number} • {selectedOrder.shop?.name}</p>
                            </div>
                            <button className="btn btn-ghost btn-sm" onClick={() => setSelectedOrderId(null)} style={{ width: '34px', height: '34px', padding: 0 }}>
                                <X size={16} />
                            </button>
                        </div>
                        <div style={{ padding: '20px' }}>
                            {/* Cancellation Alert if Cancelled */}
                            {selectedOrder.status === 'CANCELLED' && (
                                <div style={{ padding: '12px 16px', borderRadius: '10px', background: '#fee2e2', border: '1px solid #fca5a5', color: '#991b1b', marginBottom: '16px', fontSize: '13px' }}>
                                    <div style={{ fontWeight: '800', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                                        <AlertTriangle size={16} /> Order Cancelled
                                    </div>
                                    <div>
                                        {selectedOrder.payment_status === 'REFUNDED'
                                            ? 'This order has been cancelled and refunded.'
                                            : 'This order was cancelled before fulfillment.'}
                                        {selectedOrder.cancellation_reason ? ` (${selectedOrder.cancellation_reason})` : ''}
                                        {selectedOrder.cancelled_at && (
                                            <span style={{ display: 'block', fontSize: '12px', marginTop: '4px', opacity: 0.85 }}>
                                                Cancelled on {new Date(selectedOrder.cancelled_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true })}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* Summary Grid */}
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '16px' }}>
                                <DetailItem label="Total Printable Pages" value={`${selectedOrder.total_printable_pages}`} />
                                <DetailItem label="Total Physical Sheets" value={`${selectedOrder.total_sheets}`} />
                                <DetailItem label="Payment Status" value={selectedOrder.payment_status} />
                                <DetailItem label="Order Status" value={selectedOrder.status} />
                            </div>

                            {/* Files Section */}
                            <p style={{ fontSize: '13px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--fg-subtle)', marginBottom: '8px' }}>
                                Attached Documents ({selectedOrder.order_files?.length || 0})
                            </p>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '16px' }}>
                                {selectedOrder.order_files?.map((file) => {
                                    const ps = file.print_settings;
                                    return (
                                        <div key={file.id} style={{ padding: '12px 14px', borderRadius: '10px', border: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px', marginBottom: '8px' }}>
                                                <div>
                                                    <p style={{ fontSize: '14px', fontWeight: '800', margin: 0, wordBreak: 'break-word' }}>
                                                        {file.original_filename}
                                                    </p>
                                                    <p style={{ fontSize: '12px', color: 'var(--fg-muted)', margin: '2px 0 0' }}>
                                                        {file.printable_pages} pages • {file.physical_sheets} sheets • ₹{Number(file.line_total).toFixed(2)}
                                                    </p>
                                                </div>
                                                <button
                                                    className="btn btn-outline btn-sm"
                                                    disabled={downloadingFileId === file.id}
                                                    onClick={() => handleDownloadFile(selectedOrder.id, file.id)}
                                                    style={{ padding: '4px 10px', fontSize: '12px', height: '30px', flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                                                >
                                                    {downloadingFileId === file.id ? <Loader2 size={13} className="spin" /> : <Download size={13} />}
                                                    View / Download
                                                </button>
                                            </div>
                                            {ps && (
                                                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', fontSize: '11px', color: 'var(--fg-subtle)', fontWeight: '600' }}>
                                                    <span style={{ background: 'var(--bg)', padding: '2px 8px', borderRadius: '4px', border: '1px solid var(--border)' }}>{ps.colour_mode}</span>
                                                    <span style={{ background: 'var(--bg)', padding: '2px 8px', borderRadius: '4px', border: '1px solid var(--border)' }}>{ps.sides}</span>
                                                    <span style={{ background: 'var(--bg)', padding: '2px 8px', borderRadius: '4px', border: '1px solid var(--border)' }}>{ps.copies} copy</span>
                                                    <span style={{ background: 'var(--bg)', padding: '2px 8px', borderRadius: '4px', border: '1px solid var(--border)' }}>{ps.orientation}</span>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>

                            {/* Live Order Status Chat Tracker */}
                            <div style={{ marginTop: '16px' }}>
                                <OrderStatusChat
                                    status={selectedOrder.status}
                                    orderId={selectedOrder.order_number}
                                    shopName={selectedOrder.shop?.name || 'Shop'}
                                />
                            </div>

                            {/* Status Timeline History */}
                            {selectedOrder.order_status_history?.length > 0 && (
                                <div style={{ marginTop: '16px', padding: '14px', borderRadius: '10px', border: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
                                    <p style={{ fontSize: '12px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--fg-subtle)', marginBottom: '8px' }}>
                                        Timeline History
                                    </p>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                        {selectedOrder.order_status_history.map((h, i) => (
                                            <div key={h.id || i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px' }}>
                                                <span style={{ fontWeight: '700' }}>
                                                    {h.from_status ? `${h.from_status} → ${h.to_status}` : h.to_status}
                                                </span>
                                                <span style={{ color: 'var(--fg-muted)' }}>
                                                    {new Date(h.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <div style={{ marginTop: '16px', paddingTop: '14px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                    <Link href={`/order/upload?shop=${selectedOrder.shop_id}`} style={{ fontSize: '14px', fontWeight: '800', color: 'var(--accent)', textDecoration: 'none' }}>
                                        Print again at {selectedOrder.shop?.name}
                                    </Link>
                                    {(selectedOrder.payment_status === 'PAID' || selectedOrder.payment_status === 'REFUNDED') && (
                                        <button
                                            type="button"
                                            className="btn btn-outline btn-sm"
                                            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}
                                            disabled={downloadingReceiptId === selectedOrder.id}
                                            onClick={() => handleDownloadReceipt(selectedOrder.id, selectedOrder.order_number)}
                                        >
                                            {downloadingReceiptId === selectedOrder.id ? <Loader2 size={13} className="spin" /> : <Receipt size={13} />}
                                            Download Receipt
                                        </button>
                                    )}
                                </div>
                                {['DRAFT', 'AWAITING_PAYMENT', 'QUEUED'].includes(selectedOrder.status) && (
                                    <button
                                        type="button"
                                        className="btn btn-ghost btn-sm"
                                        style={{ color: '#dc2626', fontSize: '13px' }}
                                        onClick={() => {
                                            const toCancel = selectedOrder;
                                            setSelectedOrderId(null);
                                            setOrderToCancel(toCancel);
                                        }}
                                    >
                                        Cancel Order
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Cancel Confirmation Dialog */}
            {orderToCancel && (
                <div className="overlay" onClick={() => !cancellingOrderId && setOrderToCancel(null)}>
                    <div className="card fade-in" onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: '440px', padding: '24px', borderRadius: '16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                            <div style={{ width: '42px', height: '42px', borderRadius: '50%', background: '#fee2e2', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#dc2626' }}>
                                <AlertTriangle size={22} />
                            </div>
                            <div>
                                <h3 style={{ fontSize: '18px', fontWeight: '800', margin: 0 }}>Cancel Order?</h3>
                                <p style={{ fontSize: '13px', color: 'var(--fg-muted)', margin: '2px 0 0' }}>
                                    #{orderToCancel.order_number || orderToCancel.id.slice(0, 8)} • {orderToCancel.shop?.name || 'Print Shop'}
                                </p>
                            </div>
                        </div>

                        <p style={{ fontSize: '14px', color: 'var(--fg)', lineHeight: '1.5', marginBottom: '16px' }}>
                            {orderToCancel.status === 'QUEUED'
                                ? `Are you sure you want to cancel this order? Since this order has been paid, a full refund of ₹${Number(orderToCancel.total_amount).toFixed(2)} will be issued immediately.`
                                : 'Are you sure you want to cancel this order? This draft will be removed from your active orders.'}
                        </p>

                        {cancelError && (
                            <div style={{ padding: '10px 14px', borderRadius: '8px', background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontSize: '13px', marginBottom: '16px' }}>
                                {cancelError}
                            </div>
                        )}

                        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                            <button
                                type="button"
                                className="btn btn-outline btn-sm"
                                disabled={!!cancellingOrderId}
                                onClick={() => { setOrderToCancel(null); setCancelError(null); }}
                            >
                                Keep Order
                            </button>
                            <button
                                type="button"
                                className="btn btn-sm"
                                style={{ background: '#dc2626', color: '#fff', border: 'none', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                                disabled={!!cancellingOrderId}
                                onClick={() => handleCancelOrder(orderToCancel)}
                            >
                                {cancellingOrderId ? <Loader2 size={13} className="spin" /> : null}
                                Yes, Cancel Order
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Success Toast */}
            {cancelSuccessMsg && (
                <div style={{ position: 'fixed', bottom: '24px', right: '24px', zIndex: 100, background: '#16a34a', color: '#fff', padding: '12px 20px', borderRadius: '10px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', fontWeight: '600' }}>
                    <CheckCircle2 size={18} /> {cancelSuccessMsg}
                </div>
            )}
            <style>{`
                @media (max-width: 880px) {
                    .orders-row {
                        flex-direction: column !important;
                    }
                    .orders-side {
                        width: 100% !important;
                        border-left: none !important;
                        border-top: 1px solid var(--border);
                    }
                }
                .spin {
                    animation: spin 1s linear infinite;
                }
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
            `}</style>
        </div>
    );
}

function DetailItem({ label, value }: { label: string; value: string }) {
    return (
        <div style={{ padding: '10px 12px', borderRadius: '10px', border: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
            <p style={{ fontSize: '11px', fontWeight: '700', color: 'var(--fg-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '2px' }}>{label}</p>
            <p style={{ fontSize: '14px', fontWeight: '800', margin: 0 }}>{value}</p>
        </div>
    );
}

'use client';

import { useApp } from '@/context/AppContext';
import Link from 'next/link';
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
    Lock
} from 'lucide-react';

export default function OrdersPage() {
    const { orders, isLoggedIn } = useApp();

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
        if (s === 'completed') return {
            class: 'badge-success',
            icon: <CheckCircle2 size={12} />,
            label: 'Completed'
        };
        if (s === 'ready') return {
            class: 'badge-dark',
            icon: <PackageCheck size={12} />,
            label: 'Ready for Pickup'
        };
        if (s === 'printing') return {
            class: 'badge-warning',
            icon: <Printer size={12} />,
            label: 'Printing'
        };
        return {
            class: 'badge-outline',
            icon: <Clock size={12} />,
            label: 'Pending'
        };
    };

    return (
        <div className="page-wrapper">
            <section className="section-sm">
                <div className="container">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '40px', borderBottom: '1px solid var(--border)', paddingBottom: '24px' }}>
                        <div>
                            <h1 style={{ fontSize: '32px', fontWeight: '900', letterSpacing: '-0.04em', marginBottom: '8px' }}>My Orders</h1>
                            <p style={{ fontSize: '15px', color: 'var(--fg-muted)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <Receipt size={16} /> {orders.length} total orders placed
                            </p>
                        </div>
                        <Link href="/shops" className="btn btn-accent">
                            Create New Order <ExternalLink size={16} />
                        </Link>
                    </div>

                    {orders.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '100px 0', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', border: '2px dashed var(--border)' }}>
                            <div style={{ width: '80px', height: '80px', borderRadius: '50%', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px', color: 'var(--fg-subtle)', boxShadow: 'var(--shadow-sm)' }}>
                                <Inbox size={40} />
                            </div>
                            <h2 style={{ fontSize: '20px', fontWeight: '800', marginBottom: '12px', letterSpacing: '-0.02em' }}>No orders found</h2>
                            <p style={{ fontSize: '15px', color: 'var(--fg-muted)', marginBottom: '32px', maxWidth: '320px', margin: '0 auto 32px' }}>
                                You haven't placed any print orders yet. Start by finding a shop near you.
                            </p>
                            <Link href="/shops" className="btn btn-primary">Find a Print Shop</Link>
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            {orders.map(order => {
                                const config = statusConfig(order.status);
                                return (
                                    <div key={order.id} className="card card-hover" style={{ padding: '0', overflow: 'hidden' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'stretch' }}>
                                            <div style={{ padding: '28px', flex: 1 }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                                                    <span style={{ fontSize: '14px', fontWeight: '900', letterSpacing: '0.05em', color: 'var(--accent)', background: 'var(--accent-muted)', padding: '4px 12px', borderRadius: '6px' }}>
                                                        #{order.id}
                                                    </span>
                                                    <span className={`badge ${config.class}`} style={{ gap: '6px', padding: '6px 12px' }}>
                                                        {config.icon} {config.label}
                                                    </span>
                                                </div>

                                                <h3 style={{ fontSize: '20px', fontWeight: '800', marginBottom: '6px', letterSpacing: '-0.02em' }}>{order.shopName}</h3>
                                                <p style={{ fontSize: '14px', color: 'var(--fg-muted)', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '20px' }}>
                                                    <FileText size={14} /> {order.fileName}
                                                </p>

                                                <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                                                    {[
                                                        { label: 'Pages', val: order.pages },
                                                        { label: 'Color', val: order.color ? 'Color' : 'B&W' },
                                                        { label: 'Sides', val: (order.sides === 'double' || order.sides === 'double_long' || order.sides === 'double_short') ? 'Double' : 'Single' },
                                                        { label: 'Method', val: order.paymentMethod.toUpperCase() }
                                                    ].map(item => (
                                                        <div key={item.label}>
                                                            <p style={{ fontSize: '11px', fontWeight: '700', color: 'var(--fg-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '2px' }}>{item.label}</p>
                                                            <p style={{ fontSize: '14px', fontWeight: '700' }}>{item.val}</p>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>

                                            <div style={{ background: 'var(--bg-secondary)', padding: '28px', width: '220px', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', borderLeft: '1px solid var(--border)', textAlign: 'center' }}>
                                                <div style={{ fontSize: '28px', fontWeight: '900', letterSpacing: '-0.05em', color: 'var(--fg)', marginBottom: '4px' }}>{'\u20B9'}{order.totalAmount.toFixed(2)}</div>
                                                <div style={{ fontSize: '12px', color: 'var(--fg-subtle)', display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '20px' }}>
                                                    <Calendar size={12} />
                                                    {new Date(order.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true })}
                                                </div>
                                                <button className="btn btn-outline btn-sm btn-full" style={{ background: 'var(--bg)' }}>
                                                    Details <ChevronRight size={14} />
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </section>
        </div>
    );
}

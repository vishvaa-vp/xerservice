'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import LoginActivityHeatmap from '@/components/ui/LoginActivityHeatmap';
import { useApp } from '@/context/AppContext';
import {
    ArrowUpRight,
    Bell,
    CheckCircle,
    ClipboardList,
    Coins,
    Lock,
    Package,
    Plus,
    Shield,
    Upload,
} from 'lucide-react';

export default function DashboardPage() {
    const { user, orders, updateProfile, activity, streak, totalActiveDays } = useApp();
    const [activeTab, setActiveTab] = useState<'overview' | 'profile'>('overview');
    const [name, setName] = useState(user?.name || '');
    const [email, setEmail] = useState(user?.email || '');
    const [saving, setSaving] = useState(false);
    const avatarInputRef = useRef<HTMLInputElement | null>(null);

    const activeOrders = orders.filter((o) => o.status !== 'completed').slice(0, 3);
    const completedOrders = orders.filter((o) => o.status === 'completed');

    if (!user) {
        return (
            <div style={{ minHeight: '80vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '20px', padding: '40px' }}>
                <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: 'var(--accent-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Lock size={28} color="var(--accent)" />
                </div>
                <div style={{ textAlign: 'center' }}>
                    <p style={{ fontSize: '18px', fontWeight: '700', marginBottom: '8px' }}>Sign in required</p>
                    <p style={{ fontSize: '14px', color: 'var(--fg-muted)', marginBottom: '20px' }}>Please sign in to access your dashboard.</p>
                    <Link href="/login?redirect=/dashboard" className="btn btn-accent">Sign In</Link>
                </div>
            </div>
        );
    }

    const statusColor = (s: string) => {
        if (s === 'completed') return 'badge-success';
        if (s === 'ready') return 'badge-dark';
        if (s === 'printing') return 'badge-warning';
        return 'badge-outline';
    };

    const handleUpdateProfile = (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        setTimeout(() => {
            updateProfile({ name: name.trim(), email: email.trim() });
            setSaving(false);
        }, 500);
    };

    const onAvatarUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            const avatarUrl = typeof reader.result === 'string' ? reader.result : '';
            if (avatarUrl) updateProfile({ avatarUrl });
        };
        reader.readAsDataURL(file);
        event.target.value = '';
    };

    return (
        <div className="page-wrapper" style={{ background: 'var(--bg-secondary)', minHeight: '100vh' }}>
            <div style={{ background: 'var(--bg)', borderBottom: '1px solid var(--border)', padding: '40px 0 0' }}>
                <div className="container">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '32px', gap: '16px', flexWrap: 'wrap' }}>
                        <div style={{ display: 'flex', gap: '24px', alignItems: 'center' }}>
                            <div style={{ width: '80px', height: '80px', borderRadius: '24px', background: 'var(--accent-muted)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: 'var(--shadow-sm)', overflow: 'hidden' }}>
                                {user.avatarUrl ? (
                                    <img src={user.avatarUrl} alt={user.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                ) : (
                                    <span style={{ fontSize: '32px', fontWeight: '900', color: 'var(--accent)' }}>{user.name?.[0] || 'U'}</span>
                                )}
                            </div>
                            <div>
                                <h1 style={{ fontSize: '28px', fontWeight: '900', letterSpacing: '-0.03em', marginBottom: '4px' }}>Welcome, {user.name}</h1>
                                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                                    <Link href="/dashboard/orders" className="btn btn-outline btn-sm" style={{ borderRadius: '999px', height: '30px', padding: '0 12px', fontSize: '12px', fontWeight: '700', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                        <Package size={13} />
                                        Orders
                                    </Link>
                                    <Link href="/dashboard/wallet" className="btn btn-outline btn-sm" style={{ borderRadius: '999px', height: '30px', padding: '0 12px', fontSize: '12px', fontWeight: '700', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                        <Coins size={13} />
                                        Wallet
                                    </Link>
                                    <button type="button" onClick={() => setActiveTab('profile')} className="btn btn-outline btn-sm" style={{ borderRadius: '999px', height: '30px', padding: '0 12px', fontSize: '12px', fontWeight: '700', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                        <ClipboardList size={13} />
                                        Activity
                                    </button>
                                </div>
                            </div>
                        </div>
                        <Link href="/shops" className="btn btn-primary" style={{ height: '48px', padding: '0 24px', borderRadius: '14px', display: 'flex', alignItems: 'center', gap: '10px', fontWeight: '800' }}>
                            <Plus size={18} /> New Print Order
                        </Link>
                    </div>

                    <div style={{ display: 'flex', gap: '32px' }}>
                        {(['overview', 'profile'] as const).map((tab) => (
                            <button key={tab} className={`tab-btn ${activeTab === tab ? 'active' : ''}`} onClick={() => setActiveTab(tab)} style={{ paddingBottom: '16px', fontSize: '15px', textTransform: 'capitalize' }}>
                                {tab}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            <main className="section-sm">
                <div className="container">
                    {activeTab === 'overview' && (
                        <div className="fade-in">
                            <div className="grid-4" style={{ gap: '20px', marginBottom: '28px' }}>
                                {[
                                    { label: 'Total Orders', value: orders.length, icon: Package, color: '#3b82f6' },
                                    { label: 'Completed', value: completedOrders.length, icon: CheckCircle, color: '#10b981' },
                                    { label: 'XerCoins', value: `Rs ${user.xerCoins || 0}`, icon: Coins, color: '#f59e0b' },
                                    { label: 'Active Days', value: totalActiveDays, icon: ClipboardList, color: '#16a34a' },
                                ].map((stat) => (
                                    <div key={stat.label} className="card" style={{ padding: '24px', borderRadius: '20px', border: 'none', boxShadow: 'var(--shadow-sm)' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
                                            <div style={{ width: '44px', height: '44px', borderRadius: '12px', background: `${stat.color}15`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                <stat.icon size={22} color={stat.color} />
                                            </div>
                                            <div style={{ color: 'var(--fg-subtle)' }}><ArrowUpRight size={18} /></div>
                                        </div>
                                        <div style={{ fontSize: '28px', fontWeight: '900', letterSpacing: '-0.02em', color: 'var(--fg)' }}>{stat.value}</div>
                                        <div style={{ fontSize: '13px', fontWeight: '700', color: 'var(--fg-subtle)', marginTop: '4px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{stat.label}</div>
                                    </div>
                                ))}
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: '24px' }}>
                                <div className="card" style={{ padding: '28px', borderRadius: '24px', border: 'none', boxShadow: 'var(--shadow-sm)' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                                        <h2 style={{ fontSize: '18px', fontWeight: '800' }}>Recent Orders</h2>
                                        <Link href="/dashboard/orders" style={{ fontSize: '13px', color: 'var(--accent)', fontWeight: '700', textDecoration: 'none' }}>View History</Link>
                                    </div>
                                    {activeOrders.length === 0 ? (
                                        <p style={{ color: 'var(--fg-muted)' }}>No recent activity to show.</p>
                                    ) : (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                            {activeOrders.map((order) => (
                                                <div key={order.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px', background: 'var(--bg-secondary)', borderRadius: '14px', border: '1px solid var(--border)' }}>
                                                    <div>
                                                        <p style={{ fontSize: '15px', fontWeight: '700' }}>#{order.id} - {order.shopName}</p>
                                                        <p style={{ fontSize: '12px', color: 'var(--fg-muted)', marginTop: '2px' }}>{order.fileName}</p>
                                                    </div>
                                                    <span className={`badge ${statusColor(order.status)}`} style={{ fontSize: '10px', textTransform: 'uppercase', fontWeight: '800' }}>{order.status}</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                                    <div className="card" style={{ padding: '28px', borderRadius: '20px', background: 'var(--fg)', color: 'var(--bg)', overflow: 'hidden', position: 'relative' }}>
                                        <div style={{ position: 'absolute', top: '-20px', right: '-20px', width: '120px', height: '120px', background: 'var(--accent)', opacity: 0.3, borderRadius: '50%', filter: 'blur(40px)' }} />
                                        <h3 style={{ fontSize: '16px', fontWeight: '800', marginBottom: '12px' }}>Wallet Balance</h3>
                                        <div style={{ fontSize: '32px', fontWeight: '900', marginBottom: '18px' }}>Rs {user.xerCoins || 0}</div>
                                        <Link href="/dashboard/wallet" className="btn btn-accent btn-full" style={{ borderRadius: '12px', fontWeight: '800' }}>Topup Balance</Link>
                                    </div>

                                    <div className="card" style={{ padding: '20px', borderRadius: '20px' }}>
                                        <p style={{ fontSize: '13px', color: 'var(--fg-muted)', fontWeight: '700', marginBottom: '6px' }}>Current streak</p>
                                        <div style={{ fontSize: '30px', fontWeight: '900', color: '#16a34a' }}>{streak} day{streak === 1 ? '' : 's'}</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab === 'profile' && (
                        <div className="fade-in" style={{ maxWidth: '740px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                            <div className="card" style={{ padding: '34px', borderRadius: '26px', border: 'none', boxShadow: 'var(--shadow-sm)' }}>
                                <div style={{ textAlign: 'center', marginBottom: '32px' }}>
                                    <div style={{ width: '110px', height: '110px', borderRadius: '30px', background: 'var(--accent-muted)', margin: '0 auto 16px', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                        {user.avatarUrl ? (
                                            <img src={user.avatarUrl} alt={user.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                        ) : (
                                            <span style={{ fontSize: '42px', fontWeight: '900', color: 'var(--accent)' }}>{name[0] || 'U'}</span>
                                        )}
                                    </div>
                                    <button type="button" className="btn btn-outline btn-sm" onClick={() => avatarInputRef.current?.click()} style={{ borderRadius: '10px' }}>
                                        <Upload size={14} /> Change Profile Picture
                                    </button>
                                    <input ref={avatarInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onAvatarUpload} />
                                    <h2 style={{ fontSize: '24px', fontWeight: '900', marginTop: '16px' }}>Profile Settings</h2>
                                </div>

                                <form onSubmit={handleUpdateProfile} style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
                                    <div>
                                        <label className="input-label">Full Name</label>
                                        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your Name" />
                                    </div>
                                    <div>
                                        <label className="input-label">Email Address</label>
                                        <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="your@email.com" />
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                                        <button type="button" className="btn btn-outline" style={{ borderRadius: '12px' }}>Change Password</button>
                                        <button type="submit" disabled={saving} className="btn btn-primary" style={{ borderRadius: '12px', fontWeight: '800' }}>
                                            {saving ? 'Saving...' : 'Save Changes'}
                                        </button>
                                    </div>
                                </form>

                                <div style={{ marginTop: '26px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '14px', background: 'var(--bg-secondary)', borderRadius: '14px' }}>
                                        <Shield size={18} color="var(--accent)" />
                                        <span style={{ fontSize: '14px', fontWeight: '700' }}>Two-Factor Authentication</span>
                                        <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto', color: 'var(--accent)' }}>Enable</button>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '14px', background: 'var(--bg-secondary)', borderRadius: '14px' }}>
                                        <Bell size={18} color="var(--accent)" />
                                        <span style={{ fontSize: '14px', fontWeight: '700' }}>Order Notifications</span>
                                        <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto', color: 'var(--accent)' }}>Manage</button>
                                    </div>
                                </div>
                            </div>

                            <LoginActivityHeatmap activity={activity} streak={streak} totalActiveDays={totalActiveDays} title="Login Activity" />
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
}

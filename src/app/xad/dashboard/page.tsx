'use client';

import { useState } from 'react';
import { mockAdminShops, mockComplaints, AdminShopRequest } from '@/lib/mock-data';
import Link from 'next/link';
import { useApp } from '@/context/AppContext';
import {
    Store,
    Clock,
    Package,
    CreditCard,
    CheckCircle2,
    XCircle,
    AlertCircle,
    BarChart3,
    Settings,
    ShieldCheck,
    ExternalLink,
    Search,
    Filter,
    ArrowUpRight,
    Users,
    MessageSquare,
    Zap
} from 'lucide-react';

export default function XADDashboardPage() {
    const { theme } = useApp();
    const [shops, setShops] = useState(mockAdminShops);
    const [activeTab, setActiveTab] = useState<'overview' | 'shops' | 'complaints'>('overview');

    const pending = shops.filter(s => s.status === 'pending');
    const approved = shops.filter(s => s.status === 'approved');

    const handleApprove = (id: string) => setShops(prev => prev.map(s => s.id === id ? { ...s, status: 'approved' as const } : s));
    const handleReject = (id: string) => setShops(prev => prev.map(s => s.id === id ? { ...s, status: 'rejected' as const } : s));

    const [commission, setCommission] = useState<Record<string, number>>(
        Object.fromEntries(mockAdminShops.map(s => [s.id, s.commission]))
    );

    return (
        <div className="page-wrapper" style={{ background: 'var(--bg-secondary)', minHeight: '100vh' }}>
            <section className="section-sm">
                <div className="container">
                    {/* Header */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '40px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                            <img src={theme === 'light' ? '/logo-black.png' : '/logo-white.png'} alt="XerService Logo" style={{ width: '48px', height: '48px', objectFit: 'contain' }} />
                            <div>
                                <h1 style={{ fontSize: '28px', fontWeight: '900', letterSpacing: '-0.04em', lineHeight: '1.1' }}>
                                    XAD <span style={{ fontWeight: '400', color: 'var(--fg-muted)', fontSize: '20px' }}>Administration</span>
                                </h1>
                                <p style={{ fontSize: '13px', color: 'var(--fg-subtle)', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: '2px' }}>Platform Control Center</p>
                            </div>
                        </div>
                        <div style={{ display: 'flex', gap: '12px' }}>
                            <button className="btn btn-outline btn-sm" style={{ background: 'var(--bg)', gap: '8px' }}><Settings size={14} /> System Settings</button>
                            <button className="btn btn-primary btn-sm" style={{ gap: '8px' }}><ShieldCheck size={14} /> Security Audit</button>
                        </div>
                    </div>

                    {/* Platform stat cards */}
                    <div className="grid-4" style={{ gap: '20px', marginBottom: '40px' }}>
                        {[
                            { label: 'Total Shops', value: shops.length, icon: Store, color: '#e87b35' },
                            { label: 'Pending Apps', value: pending.length, icon: Clock, color: '#f59e0b' },
                            { label: 'Total Orders', value: '1,024', icon: Package, color: '#3b82f6' },
                            { label: 'Total Revenue', value: '₹5.2L', icon: CreditCard, color: '#10b981' },
                        ].map(stat => (
                            <div key={stat.label} className="card card-hover" style={{ padding: '24px', background: 'var(--bg)', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.03)' }}>
                                <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: `${stat.color}15`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: stat.color, marginBottom: '16px' }}>
                                    <stat.icon size={20} />
                                </div>
                                <div className="stat-value" style={{ fontSize: '28px', fontWeight: '900', letterSpacing: '-0.04em' }}>{stat.value}</div>
                                <div className="stat-label" style={{ fontSize: '13px', color: 'var(--fg-muted)', fontWeight: '600' }}>{stat.label}</div>
                            </div>
                        ))}
                    </div>

                    {/* Tabs / Sub-nav */}
                    <div style={{ display: 'flex', gap: '8px', marginBottom: '32px', background: 'var(--bg)', padding: '6px', borderRadius: '12px', border: '1px solid var(--border)', width: 'fit-content' }}>
                        {(['overview', 'shops', 'complaints'] as const).map(tab => (
                            <button key={tab}
                                onClick={() => setActiveTab(tab)}
                                style={{
                                    padding: '8px 20px',
                                    borderRadius: '8px',
                                    fontSize: '14px',
                                    fontWeight: '700',
                                    transition: 'all 0.2s',
                                    background: activeTab === tab ? 'var(--fg)' : 'transparent',
                                    color: activeTab === tab ? 'var(--bg)' : 'var(--fg-muted)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px'
                                }}>
                                {tab === 'overview' && <BarChart3 size={16} />}
                                {tab === 'shops' && <Store size={16} />}
                                {tab === 'complaints' && <MessageSquare size={16} />}
                                {tab.charAt(0).toUpperCase() + tab.slice(1)}
                                {tab === 'shops' && pending.length > 0 && (
                                    <span style={{ background: activeTab === tab ? 'var(--bg)' : 'var(--accent)', color: activeTab === tab ? 'var(--fg)' : 'white', borderRadius: '100px', padding: '0 6px', fontSize: '10px', fontWeight: '900' }}>{pending.length}</span>
                                )}
                            </button>
                        ))}
                    </div>

                    {/* Overview Tab */}
                    {activeTab === 'overview' && (
                        <div className="fade-in">
                            <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: '24px' }}>
                                <div className="card" style={{ padding: '32px', background: 'var(--bg)', border: 'none' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                                        <h2 style={{ fontSize: '18px', fontWeight: '800', letterSpacing: '-0.02em' }}>Subscription Breakdown</h2>
                                        <button className="btn btn-ghost btn-sm">Details <ArrowUpRight size={14} /></button>
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                                        {[
                                            { name: 'Starter Plan (Free)', count: 23, pct: 23, color: 'var(--fg-subtle)' },
                                            { name: 'Growth Plan (Pro)', count: 58, pct: 58, color: 'var(--accent)' },
                                            { name: 'Business Plan (Elite)', count: 19, pct: 19, color: 'var(--fg)' },
                                        ].map(plan => (
                                            <div key={plan.name}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', marginBottom: '8px', fontWeight: '600' }}>
                                                    <span style={{ color: 'var(--fg-muted)' }}>{plan.name}</span>
                                                    <span>{plan.count} shops · {plan.pct}%</span>
                                                </div>
                                                <div style={{ height: '8px', background: 'var(--bg-secondary)', borderRadius: '4px', overflow: 'hidden' }}>
                                                    <div style={{ height: '100%', width: `${plan.pct}%`, background: plan.color, borderRadius: '4px', transition: 'width 1s ease' }} />
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                    <div style={{ marginTop: '32px', padding: '20px', background: 'var(--bg-secondary)', borderRadius: '12px', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                            <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: '#3b82f615', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                <Zap size={16} color="#3b82f6" />
                                            </div>
                                            <p style={{ fontSize: '14px', fontWeight: '700' }}>Platform Health: Optimal</p>
                                        </div>
                                        <div style={{ fontSize: '12px', color: '#10b981', fontWeight: '900', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                            <CheckCircle2 size={12} /> ALL SYSTEMS GO
                                        </div>
                                    </div>
                                </div>

                                <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                                    <div className="card" style={{ padding: '32px', background: 'var(--bg)', border: 'none' }}>
                                        <h2 style={{ fontSize: '18px', fontWeight: '800', letterSpacing: '-0.02em', marginBottom: '20px' }}>Quick Actions</h2>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                            <button onClick={() => setActiveTab('shops')} className="btn btn-outline btn-full" style={{ justifyContent: 'flex-start', background: 'var(--bg)', padding: '16px' }}>
                                                <Store size={18} style={{ marginRight: '12px', opacity: 0.6 }} />
                                                <span style={{ flex: 1 }}>Manage Shops</span>
                                                <span style={{ background: 'var(--accent)', color: 'white', borderRadius: '100px', padding: '1px 8px', fontSize: '11px' }}>{pending.length}</span>
                                            </button>
                                            <button onClick={() => setActiveTab('complaints')} className="btn btn-outline btn-full" style={{ justifyContent: 'flex-start', background: 'var(--bg)', padding: '16px' }}>
                                                <MessageSquare size={18} style={{ marginRight: '12px', opacity: 0.6 }} />
                                                <span style={{ flex: 1 }}>View Complaints</span>
                                                <span style={{ background: '#ef4444', color: 'white', borderRadius: '100px', padding: '1px 8px', fontSize: '11px' }}>{mockComplaints.length}</span>
                                            </button>
                                            <Link href="/vendor/subscription" className="btn btn-outline btn-full" style={{ justifyContent: 'flex-start', background: 'var(--bg)', padding: '16px' }}>
                                                <CreditCard size={18} style={{ marginRight: '12px', opacity: 0.6 }} /> Manage Subscriptions
                                            </Link>
                                        </div>
                                    </div>

                                    <div className="card" style={{ padding: '24px', background: 'var(--fg)', color: 'var(--bg)', border: 'none', position: 'relative', overflow: 'hidden' }}>
                                        <div style={{ position: 'absolute', top: -20, right: -20, opacity: 0.1 }}>
                                            <ShieldCheck size={120} />
                                        </div>
                                        <h3 style={{ fontSize: '16px', fontWeight: '800', marginBottom: '8px' }}>Security Report</h3>
                                        <p style={{ fontSize: '13px', opacity: 0.7, marginBottom: '20px', lineHeight: '1.5' }}>Last audit was 2 hours ago. No threats detected.</p>
                                        <button className="btn btn-accent btn-sm btn-full" style={{ background: '#fff', color: '#000' }}>Run Audit</button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Shops Tab */}
                    {activeTab === 'shops' && (
                        <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            <div style={{ display: 'flex', gap: '12px', marginBottom: '8px' }}>
                                <div style={{ position: 'relative', flex: 1 }}>
                                    <Search size={16} style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)', opacity: 0.5 }} />
                                    <input className="input" placeholder="Search by shop name, owner or mobile..." style={{ paddingLeft: '44px', background: 'var(--bg)', border: 'none', boxShadow: '0 2px 8px rgba(0,0,0,0.02)' }} />
                                </div>
                                <button className="btn btn-outline" style={{ background: 'var(--bg)', border: 'none', boxShadow: '0 2px 8px rgba(0,0,0,0.02)' }}><Filter size={18} /></button>
                            </div>

                            {shops.map(shop => (
                                <div key={shop.id} className="card card-hover" style={{ padding: '28px', background: 'var(--bg)', border: 'none' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '20px' }}>
                                        <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
                                            <div style={{ width: '56px', height: '56px', borderRadius: '14px', background: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--fg-subtle)' }}>
                                                <Store size={24} />
                                            </div>
                                            <div>
                                                <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '4px' }}>
                                                    <h3 style={{ fontSize: '18px', fontWeight: '800', letterSpacing: '-0.02em' }}>{shop.name}</h3>
                                                    <span className={`badge ${shop.status === 'approved' ? 'badge-success' : shop.status === 'rejected' ? 'badge-error' : 'badge-warning'}`} style={{ fontSize: '10px', textTransform: 'uppercase', fontWeight: '900', padding: '4px 10px' }}>
                                                        {shop.status}
                                                    </span>
                                                </div>
                                                <div style={{ display: 'flex', gap: '16px', fontSize: '13px', color: 'var(--fg-muted)', fontWeight: '600' }}>
                                                    <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Users size={14} /> {shop.ownerName}</span>
                                                    <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Clock size={14} /> Requested {shop.requestedAt}</span>
                                                </div>
                                            </div>
                                        </div>

                                        <div style={{ display: 'flex', gap: '24px', alignItems: 'center' }}>
                                            {shop.status === 'approved' && (
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'var(--bg-secondary)', padding: '8px 16px', borderRadius: '12px' }}>
                                                    <span style={{ fontSize: '12px', fontWeight: '800', color: 'var(--fg-subtle)', textTransform: 'uppercase' }}>Comm:</span>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                        <input type="number" min={0} max={30} value={commission[shop.id] ?? 8}
                                                            onChange={e => setCommission(prev => ({ ...prev, [shop.id]: Number(e.target.value) }))}
                                                            style={{ width: '48px', padding: '4px 0', background: 'transparent', border: 'none', fontSize: '16px', fontWeight: '900', color: 'var(--fg)', outline: 'none', textAlign: 'center' }} />
                                                        <span style={{ fontSize: '14px', fontWeight: '800', color: 'var(--fg-muted)' }}>%</span>
                                                    </div>
                                                </div>
                                            )}

                                            <div style={{ display: 'flex', gap: '8px' }}>
                                                {shop.status === 'pending' && (
                                                    <>
                                                        <button onClick={() => handleApprove(shop.id)} className="btn btn-sm btn-primary" style={{ padding: '10px 20px' }}><CheckCircle2 size={16} /> Approve</button>
                                                        <button onClick={() => handleReject(shop.id)} className="btn btn-sm btn-outline" style={{ color: '#ef4444', borderColor: '#ef4444' }}><XCircle size={16} /> Reject</button>
                                                    </>
                                                )}
                                                <button className="btn btn-ghost btn-sm" style={{ padding: '10px' }}><ExternalLink size={18} /></button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Complaints Tab */}
                    {activeTab === 'complaints' && (
                        <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            {mockComplaints.map(c => (
                                <div key={c.id} className="card card-hover" style={{ padding: '28px', background: 'var(--bg)', border: 'none' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '24px' }}>
                                        <div style={{ display: 'flex', gap: '20px' }}>
                                            <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: 'rgba(239, 68, 68, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ef4444', flexShrink: 0 }}>
                                                <AlertCircle size={24} />
                                            </div>
                                            <div>
                                                <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '8px' }}>
                                                    <span style={{ fontSize: '15px', fontWeight: '800', color: 'var(--fg)' }}>+91 {c.mobile}</span>
                                                    <span style={{ fontSize: '12px', color: 'var(--fg-subtle)', fontWeight: '600' }}>{c.date}</span>
                                                </div>
                                                <p style={{ fontSize: '15px', lineHeight: '1.6', color: 'var(--fg-muted)', maxWidth: '600px' }}>{c.description}</p>
                                            </div>
                                        </div>
                                        <div style={{ display: 'flex', gap: '12px' }}>
                                            <button className="btn btn-ghost btn-sm">Resolve</button>
                                            <button className="btn btn-outline btn-sm" style={{ background: 'var(--bg)' }}>View Order</button>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </section>
        </div>
    );
}

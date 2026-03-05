'use client';

import { useState } from 'react';
import { subscriptionPlans, billingHistory } from '@/lib/mock-data';
import {
    CheckCircle2,
    Zap,
    ShieldCheck,
    Crown,
    Package,
    History,
    Receipt,
    ArrowRight,
    AlertCircle,
    Info
} from 'lucide-react';

export default function VendorSubscriptionPage() {
    const [current, setCurrent] = useState('growth');
    const [confirmPlan, setConfirmPlan] = useState('');

    const getPlanIcon = (id: string, color: string) => {
        if (id === 'starter') return <Zap size={24} color={color} />;
        if (id === 'growth') return <ShieldCheck size={24} color={color} />;
        if (id === 'pro') return <Crown size={24} color={color} />;
        return <Package size={24} color={color} />;
    };

    return (
        <div className="page-wrapper">
            <section className="section-sm">
                <div className="container">
                    <div style={{ marginBottom: '48px', textAlign: 'center' }}>
                        <h1 style={{ fontSize: '32px', fontWeight: '900', letterSpacing: '-0.04em', marginBottom: '8px' }}>Store Subscription</h1>
                        <p style={{ fontSize: '15px', color: 'var(--fg-muted)' }}>Power your print shop with the right platform tools.</p>
                    </div>

                    {/* Plans */}
                    <div className="grid-3" style={{ gap: '24px', marginBottom: '64px' }}>
                        {subscriptionPlans.map(plan => (
                            <div key={plan.id} className="card card-hover"
                                style={{
                                    padding: '40px 32px',
                                    border: `2px solid ${plan.id === current ? 'var(--accent)' : 'var(--border)'}`,
                                    position: 'relative',
                                    background: plan.id === current ? 'var(--accent-muted)' : 'var(--bg)',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    borderRadius: '24px'
                                }}>
                                {plan.popular && plan.id !== current && (
                                    <div style={{ position: 'absolute', top: '16px', right: '16px' }}>
                                        <div style={{ background: 'var(--accent)', color: 'white', fontSize: '10px', fontWeight: '900', padding: '4px 12px', borderRadius: '100px', letterSpacing: '0.08em', textTransform: 'uppercase' }}>MOST POPULAR</div>
                                    </div>
                                )}
                                {plan.id === current && (
                                    <div style={{ position: 'absolute', top: '16px', right: '16px' }}>
                                        <div style={{ background: 'var(--fg)', color: 'var(--bg)', fontSize: '10px', fontWeight: '900', padding: '4px 12px', borderRadius: '100px', letterSpacing: '0.08em', textTransform: 'uppercase' }}>ACTIVE PLAN</div>
                                    </div>
                                )}

                                <div style={{ width: '48px', height: '48px', borderRadius: '14px', background: plan.id === current ? 'var(--accent)' : 'var(--bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '24px', color: plan.id === current ? 'white' : 'var(--accent)' }}>
                                    {getPlanIcon(plan.id, plan.id === current ? 'white' : 'var(--accent)')}
                                </div>

                                <h2 style={{ fontSize: '24px', fontWeight: '900', marginBottom: '8px', letterSpacing: '-0.02em' }}>{plan.name}</h2>
                                <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px', marginBottom: '20px' }}>
                                    <span style={{ fontSize: '42px', fontWeight: '900', letterSpacing: '-0.05em' }}>₹{plan.price}</span>
                                    <span style={{ fontSize: '14px', opacity: 0.6, fontWeight: '600' }}>/month</span>
                                </div>
                                <p style={{ fontSize: '14px', color: 'var(--fg-muted)', lineHeight: '1.6', marginBottom: '32px', flex: 1 }}>{plan.description}</p>

                                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '32px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '14px', background: 'var(--bg-secondary)', borderRadius: '12px', border: '1px solid var(--border)' }}>
                                        <Package size={18} color="var(--fg-subtle)" />
                                        <span style={{ fontSize: '14px', fontWeight: '700' }}>
                                            {plan.orders === -1 ? 'Unlimited Daily Orders' : `${plan.orders} Orders / Month`}
                                        </span>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '14px', background: 'var(--bg-secondary)', borderRadius: '12px', border: '1px solid var(--border)' }}>
                                        <CheckCircle2 size={18} color="#10b981" />
                                        <span style={{ fontSize: '14px', fontWeight: '700' }}>Priority Support</span>
                                    </div>
                                </div>

                                {plan.id === current ? (
                                    <button disabled className="btn btn-full" style={{ background: 'var(--fg)', color: 'var(--bg)', borderRadius: '12px', padding: '16px', fontWeight: '800' }}>You're on this plan</button>
                                ) : (
                                    <button onClick={() => setConfirmPlan(plan.id)} className="btn btn-accent btn-full btn-lg" style={{ borderRadius: '12px', padding: '16px', fontWeight: '800' }}>
                                        Switch to {plan.name} <ArrowRight size={18} />
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>

                    {/* Confirm modal */}
                    {confirmPlan && (
                        <div className="overlay">
                            <div className="modal" style={{ maxWidth: '440px', padding: '48px' }}>
                                <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: 'var(--accent-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px', color: 'var(--accent)' }}>
                                    <AlertCircle size={32} />
                                </div>
                                <h2 style={{ fontSize: '24px', fontWeight: '900', marginBottom: '12px', textAlign: 'center', letterSpacing: '-0.03em' }}>Confirm Plan Switch?</h2>
                                <p style={{ fontSize: '15px', color: 'var(--fg-muted)', marginBottom: '32px', textAlign: 'center', lineHeight: '1.6' }}>
                                    You're upgrading to the <strong>{subscriptionPlans.find(p => p.id === confirmPlan)?.name}</strong>. Pro-rated charges will be applied to your next billing cycle.
                                </p>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                    <button onClick={() => { setCurrent(confirmPlan); setConfirmPlan(''); }} className="btn btn-accent btn-lg btn-full" style={{ fontWeight: '800' }}>Confirm Upgrade</button>
                                    <button onClick={() => setConfirmPlan('')} className="btn btn-ghost btn-full" style={{ fontWeight: '700' }}>Go Back</button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Billing history */}
                    <div className="card" style={{ padding: '40px', background: 'var(--bg)', borderRadius: '24px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '32px' }}>
                            <h2 style={{ fontSize: '20px', fontWeight: '800', letterSpacing: '-0.02em', display: 'flex', alignItems: 'center', gap: '10px' }}>
                                <History size={20} color="var(--accent)" /> Billing History
                            </h2>
                            <button className="btn btn-outline btn-sm" style={{ padding: '8px 16px', background: 'var(--bg)' }}><Receipt size={14} /> Download All</button>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                            {billingHistory.map((b, i) => (
                                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 0', borderBottom: i < billingHistory.length - 1 ? '1.5px solid var(--border)' : 'none' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                                        <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--fg-subtle)' }}>
                                            <Receipt size={20} />
                                        </div>
                                        <div>
                                            <p style={{ fontSize: '15px', fontWeight: '800' }}>{b.plan} Subscription</p>
                                            <p style={{ fontSize: '13px', color: 'var(--fg-muted)', fontWeight: '600' }}>{b.month}</p>
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', gap: '32px', alignItems: 'center' }}>
                                        <span style={{ fontSize: '16px', fontWeight: '900', letterSpacing: '-0.02em' }}>₹{b.amount}</span>
                                        <span className="badge" style={{ background: '#10b98115', color: '#10b981', border: '1px solid #10b98130', fontSize: '11px', fontWeight: '800', padding: '4px 12px' }}>
                                            <CheckCircle2 size={10} /> PAID
                                        </span>
                                    </div>
                                </div>
                            ))}
                        </div>
                        <div style={{ marginTop: '32px', padding: '20px', background: 'var(--bg-secondary)', borderRadius: '16px', display: 'flex', gap: '12px' }}>
                            <Info size={20} color="var(--accent)" style={{ flexShrink: 0 }} />
                            <p style={{ fontSize: '13px', color: 'var(--fg-muted)', lineHeight: '1.5' }}>
                                Your next billing date is <strong>March 15, 2026</strong>. You can cancel your subscription at any time to prevent auto-renewal.
                            </p>
                        </div>
                    </div>
                </div>
            </section>
        </div>
    );
}

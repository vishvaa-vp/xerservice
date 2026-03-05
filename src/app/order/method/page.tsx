'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/context/AppContext';
import Link from 'next/link';
import { Zap, Clock, Info } from 'lucide-react';

export default function MethodPage() {
    const { currentOrder, setCurrentOrder, isLoggedIn } = useApp();
    const [method, setMethod] = useState<'instant' | 'scheduled'>(currentOrder.method);
    const [scheduledTime, setScheduledTime] = useState(currentOrder.scheduledTime);
    const router = useRouter();

    const now = new Date();
    const maxTime = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    const minTimeStr = now.toTimeString().slice(0, 5);
    const maxTimeStr = maxTime.toTimeString().slice(0, 5);
    const scheduleWindowCrossesMidnight = maxTimeStr < minTimeStr;

    const handleContinue = () => {
        setCurrentOrder(prev => ({ ...prev, method, scheduledTime: method === 'scheduled' ? scheduledTime : '' }));
        if (!isLoggedIn) {
            router.push('/login?redirect=/order/payment');
        } else {
            router.push('/order/payment');
        }
    };

    const canContinue = method === 'instant' || (method === 'scheduled' && !scheduleWindowCrossesMidnight && !!scheduledTime);

    return (
        <div className="page-wrapper">
            <section className="section">
                <div className="container-sm">
                    <div style={{ display: 'flex', gap: '8px', marginBottom: '40px', fontSize: '13px', color: 'var(--fg-muted)' }}>
                        <span style={{ color: 'var(--fg-subtle)' }}>Upload</span><span>{'>'}</span>
                        <span style={{ color: 'var(--fg-subtle)' }}>Settings</span><span>{'>'}</span>
                        <span style={{ color: 'var(--fg-subtle)' }}>Pricing</span><span>{'>'}</span>
                        <span>Method</span><span>{'>'}</span>
                        <span style={{ color: 'var(--fg-subtle)' }}>Payment</span>
                    </div>

                    <h1 style={{ fontSize: '28px', fontWeight: '800', letterSpacing: '-0.03em', marginBottom: '8px' }}>Printing method</h1>
                    <p style={{ fontSize: '15px', color: 'var(--fg-muted)', marginBottom: '40px' }}>How should your order be sent to the shop?</p>

                    <div className="grid-2" style={{ gap: '24px', marginBottom: '40px' }}>
                        <div onClick={() => setMethod('instant')}
                            style={{ cursor: 'pointer', padding: '32px', borderRadius: 'var(--radius-lg)', border: `2px solid ${method === 'instant' ? 'var(--accent)' : 'var(--border)'}`, background: method === 'instant' ? 'var(--accent-muted)' : 'var(--bg)', transition: 'all 0.3s' }}>
                            <div style={{ width: '48px', height: '48px', borderRadius: '14px', background: method === 'instant' ? 'var(--accent)' : 'var(--bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '16px' }}>
                                <Zap size={24} color={method === 'instant' ? '#fff' : 'var(--fg-muted)'} />
                            </div>
                            <h2 style={{ fontSize: '20px', fontWeight: '800', marginBottom: '8px' }}>Instant Print</h2>
                            <p style={{ fontSize: '14px', color: 'var(--fg-muted)', marginBottom: '20px' }}>Your document will be printed immediately upon payment.</p>
                            <div className="badge badge-accent">No extra charges</div>
                        </div>

                        <div onClick={() => setMethod('scheduled')}
                            style={{ cursor: 'pointer', padding: '32px', borderRadius: 'var(--radius-lg)', border: `2px solid ${method === 'scheduled' ? 'var(--accent)' : 'var(--border)'}`, background: method === 'scheduled' ? 'var(--accent-muted)' : 'var(--bg)', transition: 'all 0.3s' }}>
                            <div style={{ width: '48px', height: '48px', borderRadius: '14px', background: method === 'scheduled' ? 'var(--accent)' : 'var(--bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '16px' }}>
                                <Clock size={24} color={method === 'scheduled' ? '#fff' : 'var(--fg-muted)'} />
                            </div>
                            <h2 style={{ fontSize: '20px', fontWeight: '800', marginBottom: '8px' }}>Scheduled Pickup</h2>
                            <p style={{ fontSize: '14px', color: 'var(--fg-muted)', marginBottom: '20px' }}>Choose a specific time to pick up your order.</p>
                            <div className="badge badge-outline">Best for large sets</div>
                        </div>
                    </div>

                    {method === 'scheduled' && (
                        <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '40px' }}>
                            {scheduleWindowCrossesMidnight ? (
                                <div style={{ padding: '12px 16px', background: 'rgba(245, 158, 11, 0.12)', border: '1px solid rgba(245, 158, 11, 0.35)', borderRadius: 'var(--radius-sm)', fontSize: '13px', color: 'var(--fg-muted)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <Info size={16} /> Scheduling is unavailable right now. Please use Instant Print and retry after midnight.
                                </div>
                            ) : (
                                <div>
                                    <label className="input-label">Schedule time (today)</label>
                                    <input type="time" className="input" value={scheduledTime} min={minTimeStr} max={maxTimeStr}
                                        onChange={e => setScheduledTime(e.target.value)}
                                        style={{ maxWidth: '220px' }} />
                                    <p style={{ fontSize: '12px', color: 'var(--fg-subtle)', marginTop: '6px' }}>Allowed window: {minTimeStr} to {maxTimeStr}</p>
                                </div>
                            )}
                            <div style={{ padding: '12px 16px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-sm)', fontSize: '13px', color: 'var(--fg-muted)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <Info size={16} /> You can modify or replace the file until 10 minutes before the scheduled time.
                            </div>
                        </div>
                    )}

                    {!isLoggedIn && (
                        <div style={{ padding: '16px 20px', background: 'var(--accent-muted)', border: '1px solid var(--accent-border)', borderRadius: 'var(--radius)', marginBottom: '24px', fontSize: '14px', color: 'var(--accent)', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <Info size={16} /> You need to sign in before payment.
                        </div>
                    )}

                    <div style={{ display: 'flex', gap: '12px' }}>
                        <Link href="/order/pricing" className="btn btn-outline">Back</Link>
                        <button onClick={handleContinue} className="btn btn-primary" style={{ flex: 1 }} disabled={!canContinue}>
                            {isLoggedIn ? 'Continue to Payment' : 'Sign in and Continue'}
                        </button>
                    </div>
                </div>
            </section>
        </div>
    );
}

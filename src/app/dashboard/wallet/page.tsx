'use client';

import { useState } from 'react';
import { useApp } from '@/context/AppContext';
import Link from 'next/link';
import {
    Wallet,
    Plus,
    ArrowDownCircle,
    Clock,
    CheckCircle,
    Info,
    TrendingUp,
    ShieldCheck,
    MapPin,
    Lock,
} from 'lucide-react';

export default function WalletPage() {
    const { user, orders, addXerCoins } = useApp();
    const [topupAmount, setTopupAmount] = useState('');
    const [processing, setProcessing] = useState(false);
    const [success, setSuccess] = useState(false);
    const [error, setError] = useState<string | null>(null);

    if (!user) {
        return (
            <div style={{ minHeight: '80vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '20px', padding: '40px' }}>
                <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: 'var(--accent-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Lock size={28} color="var(--accent)" />
                </div>
                <div style={{ textAlign: 'center' }}>
                    <p style={{ fontSize: '18px', fontWeight: '700', marginBottom: '8px' }}>Sign in required</p>
                    <p style={{ fontSize: '14px', color: 'var(--fg-muted)', marginBottom: '20px' }}>Please sign in to manage your wallet.</p>
                    <Link href="/login?redirect=/dashboard/wallet" className="btn btn-accent">Sign In</Link>
                </div>
            </div>
        );
    }

    const walletOrders = orders.filter(o => o.paymentMethod === 'wallet');
    const balance = user.xerCoins ?? 0;

    const handleTopup = async (e: React.FormEvent) => {
        e.preventDefault();
        const amount = Number(topupAmount);

        if (!Number.isFinite(amount) || amount <= 0) {
            setError('Enter a valid top-up amount.');
            return;
        }

        setProcessing(true);
        setError(null);
        setSuccess(false);

        try {
            await new Promise((resolve) => setTimeout(resolve, 500));
            addXerCoins(amount);

            setSuccess(true);
            setTopupAmount('');
            setTimeout(() => setSuccess(false), 3000);
        } finally {
            setProcessing(false);
        }
    };

    return (
        <div className="page-wrapper">
            <section className="section-sm">
                <div className="container-sm">
                    <div style={{ marginBottom: '48px', textAlign: 'center' }}>
                        <h1 style={{ fontSize: '32px', fontWeight: '900', letterSpacing: '-0.04em', marginBottom: '8px' }}>XerCoins Wallet</h1>
                        <p style={{ fontSize: '15px', color: 'var(--fg-muted)' }}>Manage your credits and transaction history</p>
                    </div>

                    <div className="card" style={{
                        padding: '48px 40px',
                        textAlign: 'center',
                        background: 'var(--fg)',
                        color: 'var(--bg)',
                        marginBottom: '32px',
                        borderRadius: '24px',
                        boxShadow: '0 20px 40px rgba(0,0,0,0.15)',
                        position: 'relative',
                        overflow: 'hidden'
                    }}>
                        <div style={{ position: 'absolute', top: '0', right: '0', padding: '24px', opacity: 0.1 }}>
                            <Wallet size={120} />
                        </div>

                        <div style={{ position: 'relative', zIndex: 1 }}>
                            <p style={{ fontSize: '13px', fontWeight: '800', opacity: 0.6, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '16px' }}>Available Balance</p>
                            <div style={{ fontSize: '72px', fontWeight: '900', letterSpacing: '-0.06em', lineHeight: '1', marginBottom: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                                <span style={{ fontSize: '32px', fontWeight: '700', opacity: 0.5 }}>Rs</span>{balance.toFixed(2)}
                            </div>
                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', background: 'rgba(255,255,255,0.1)', padding: '6px 16px', borderRadius: '100px', fontSize: '13px' }}>
                                <TrendingUp size={14} color="var(--accent)" />
                                <span>Earn rewards on wallet orders</span>
                            </div>
                        </div>
                    </div>

                    <div className="card" style={{ padding: '32px', marginBottom: '32px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '24px' }}>
                            <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: 'var(--accent-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)' }}>
                                <Plus size={20} />
                            </div>
                            <h2 style={{ fontSize: '18px', fontWeight: '800', letterSpacing: '-0.02em' }}>Add XerCoins</h2>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', marginBottom: '20px' }}>
                            {[100, 250, 500, 1000].map(amt => (
                                <button key={amt} onClick={() => setTopupAmount(String(amt))}
                                    style={{
                                        padding: '14px 0',
                                        borderRadius: 'var(--radius)',
                                        border: `2px solid ${topupAmount === String(amt) ? 'var(--accent)' : 'var(--border)'}`,
                                        background: topupAmount === String(amt) ? 'var(--accent-muted)' : 'transparent',
                                        color: topupAmount === String(amt) ? 'var(--accent)' : 'var(--fg)',
                                        fontWeight: '700',
                                        fontSize: '14px',
                                        cursor: 'pointer',
                                        transition: 'all 0.2s'
                                    }}>
                                    +Rs {amt}
                                </button>
                            ))}
                        </div>

                        <form onSubmit={handleTopup} style={{ display: 'flex', gap: '12px' }}>
                            <div style={{ flex: 1, position: 'relative' }}>
                                <span style={{ position: 'absolute', left: '16px', top: '15px', fontWeight: '700', color: 'var(--fg-muted)' }}>Rs</span>
                                <input className="input" type="number" placeholder="Custom amount" min={1} value={topupAmount}
                                    onChange={e => setTopupAmount(e.target.value)} style={{ paddingLeft: '38px' }} />
                            </div>
                            <button type="submit" className="btn btn-primary" style={{ padding: '0 32px' }} disabled={!topupAmount || processing}>
                                {processing ? <><span className="spinner" />Adding...</> : success ? <><CheckCircle size={18} /> Added!</> : 'Add Coins'}
                            </button>
                        </form>

                        {error && (
                            <div style={{ marginTop: '12px', padding: '10px 12px', borderRadius: '10px', border: '1px solid rgba(239, 68, 68, 0.2)', background: 'rgba(239, 68, 68, 0.08)', color: '#ef4444', fontSize: '13px', fontWeight: '600' }}>
                                {error}
                            </div>
                        )}
                    </div>

                    <div className="card" style={{ padding: '32px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '24px' }}>
                            <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--fg-muted)' }}>
                                <Clock size={20} />
                            </div>
                            <h2 style={{ fontSize: '18px', fontWeight: '800', letterSpacing: '-0.02em' }}>Recent Transactions</h2>
                        </div>

                        {walletOrders.length === 0 ? (
                            <div style={{ textAlign: 'center', padding: '40px 0', background: 'var(--bg-secondary)', borderRadius: 'var(--radius)', color: 'var(--fg-subtle)' }}>
                                <Info size={32} style={{ marginBottom: '12px', opacity: 0.5 }} />
                                <p style={{ fontSize: '14px' }}>No wallet transactions yet</p>
                            </div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                                {walletOrders.map(o => (
                                    <div key={o.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 0', borderBottom: '1px solid var(--border)' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                                            <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: 'rgba(239, 68, 68, 0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                <ArrowDownCircle size={20} color="#ef4444" />
                                            </div>
                                            <div>
                                                <p style={{ fontSize: '15px', fontWeight: '700', marginBottom: '4px' }}>Order #{o.id}</p>
                                                <p style={{ fontSize: '12px', color: 'var(--fg-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                    <MapPin size={10} /> {o.shopName}
                                                </p>
                                            </div>
                                        </div>
                                        <div style={{ textAlign: 'right' }}>
                                            <span style={{ fontSize: '16px', fontWeight: '900', color: '#ef4444', letterSpacing: '-0.02em' }}>-Rs {o.totalAmount.toFixed(2)}</span>
                                            <p style={{ fontSize: '11px', color: 'var(--fg-subtle)', marginTop: '4px' }}>
                                                {new Date(o.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                                            </p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        <div style={{ marginTop: '32px', padding: '20px', background: 'var(--accent-muted)', border: '1px solid var(--accent-border)', borderRadius: 'var(--radius)', display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                            <ShieldCheck size={20} color="var(--accent)" style={{ flexShrink: 0 }} />
                            <div>
                                <h4 style={{ fontSize: '14px', fontWeight: '800', color: 'var(--accent)', marginBottom: '4px' }}>Safe and Secure</h4>
                                <p style={{ fontSize: '13px', color: 'var(--fg-muted)', lineHeight: '1.5' }}>All transactions are encrypted. Credits can be used at any print shop on XerService.</p>
                            </div>
                        </div>
                    </div>
                </div>
            </section>
        </div>
    );
}

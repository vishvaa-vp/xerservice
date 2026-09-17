'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/context/AppContext';
import { supabase } from '@/lib/supabase/client';
import Link from 'next/link';
import {
    Wallet,
    Plus,
    ArrowDownCircle,
    ArrowUpCircle,
    Clock,
    CheckCircle,
    Info,
    TrendingUp,
    ShieldCheck,
    Lock,
    RefreshCw,
} from 'lucide-react';

interface WalletTransaction {
    id: string;
    order_id: string | null;
    type: 'CREDIT' | 'DEBIT' | 'REFUND' | 'ADJUSTMENT';
    source: string;
    amount: number;
    balance_before: number;
    balance_after: number;
    reference: string | null;
    created_at: string;
}

export default function WalletPage() {
    const router = useRouter();
    const { user, setXerCoinsBalance, isLoading, authInitialized } = useApp();
    const [topupAmount, setTopupAmount] = useState('');
    const [walletBalance, setWalletBalance] = useState<number | null>(null);
    const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
    const [loadingTx, setLoadingTx] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const loadWalletData = useCallback(async () => {
        setLoadingTx(true);
        setError(null);
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session?.access_token) {
                throw new Error('Not authenticated');
            }

            const res = await fetch('/api/customer/wallet', {
                headers: {
                    Authorization: `Bearer ${session.access_token}`,
                },
                cache: 'no-store',
            });

            if (!res.ok) {
                throw new Error(await res.text());
            }

            const data = await res.json();
            const realBalance = Number(data.balance ?? 0);
            setWalletBalance(realBalance);
            setXerCoinsBalance(realBalance);
            setTransactions(Array.isArray(data.transactions) ? data.transactions : []);
            setError(null);
        } catch (err) {
            console.error('[WalletPage] Error loading wallet:', err);
            setError('Unable to load wallet transactions.');
        } finally {
            setLoadingTx(false);
        }
    }, [setXerCoinsBalance]);

    useEffect(() => {
        void loadWalletData();
    }, [loadWalletData]);

    useEffect(() => {
        if (!authInitialized || isLoading) return;
        if (!user) {
            router.push('/login?redirect=/dashboard/wallet');
        }
    }, [user, isLoading, authInitialized, router]);

    if (!authInitialized || (isLoading && !user)) {
        return (
            <div style={{ minHeight: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span className="spinner spinner-lg" />
            </div>
        );
    }

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

    const balance = walletBalance !== null ? walletBalance : (user.xerCoins ?? 0);

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
                                <span>Authoritative internal print credits</span>
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
                                <button key={amt} disabled
                                    type="button"
                                    style={{
                                        padding: '14px 0',
                                        borderRadius: 'var(--radius)',
                                        border: '2px solid var(--border)',
                                        background: 'transparent',
                                        color: 'var(--fg-muted)',
                                        fontWeight: '700',
                                        fontSize: '14px',
                                        cursor: 'not-allowed',
                                        opacity: 0.6,
                                        transition: 'all 0.2s'
                                    }}>
                                    +Rs {amt}
                                </button>
                            ))}
                        </div>

                        <form onSubmit={e => e.preventDefault()} style={{ display: 'flex', gap: '12px' }}>
                            <div style={{ flex: 1, position: 'relative' }}>
                                <span style={{ position: 'absolute', left: '16px', top: '15px', fontWeight: '700', color: 'var(--fg-muted)' }}>Rs</span>
                                <input className="input" type="number" placeholder="Custom amount" disabled
                                    value={topupAmount}
                                    style={{ paddingLeft: '38px', cursor: 'not-allowed', opacity: 0.7 }} />
                            </div>
                            <button type="button" disabled className="btn btn-primary" style={{ padding: '0 32px', cursor: 'not-allowed', opacity: 0.6 }}>
                                Add Coins
                            </button>
                        </form>

                        <div style={{ marginTop: '16px', padding: '12px 16px', borderRadius: '10px', border: '1px solid var(--border)', background: 'var(--bg-secondary)', color: 'var(--fg-muted)', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px', lineHeight: '1.4' }}>
                            <Info size={16} style={{ flexShrink: 0 }} />
                            <span>Online wallet top-up via Razorpay is coming soon. XerCoins are internal non-withdrawable credits for XerService print orders.</span>
                        </div>
                    </div>

                    <div className="card" style={{ padding: '32px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '24px' }}>
                            <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--fg-muted)' }}>
                                <Clock size={20} />
                            </div>
                            <h2 style={{ fontSize: '18px', fontWeight: '800', letterSpacing: '-0.02em' }}>Recent Transactions</h2>
                        </div>

                        {loadingTx ? (
                            <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--fg-subtle)' }}>
                                <div className="spinner" style={{ margin: '0 auto 12px' }} />
                                <p style={{ fontSize: '14px' }}>Loading ledger history...</p>
                            </div>
                        ) : error ? (
                            <div style={{ textAlign: 'center', padding: '40px 20px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius)', color: '#ef4444' }}>
                                <Info size={32} style={{ margin: '0 auto 12px', opacity: 0.8 }} />
                                <p style={{ fontSize: '14px', fontWeight: '600', marginBottom: '16px' }}>{error}</p>
                                <button type="button" onClick={loadWalletData} className="btn btn-outline" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px', padding: '8px 18px', borderColor: 'var(--border)' }}>
                                    <RefreshCw size={14} /> Retry
                                </button>
                            </div>
                        ) : transactions.length === 0 ? (
                            <div style={{ textAlign: 'center', padding: '40px 0', background: 'var(--bg-secondary)', borderRadius: 'var(--radius)', color: 'var(--fg-subtle)' }}>
                                <Info size={32} style={{ marginBottom: '12px', opacity: 0.5 }} />
                                <p style={{ fontSize: '14px' }}>No wallet transactions yet</p>
                            </div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                                {transactions.map(t => {
                                    const isCredit = t.type === 'CREDIT' || t.type === 'REFUND';
                                    const formattedDate = new Date(t.created_at).toLocaleDateString('en-IN', {
                                        day: 'numeric',
                                        month: 'short',
                                        year: 'numeric',
                                        hour: '2-digit',
                                        minute: '2-digit',
                                    });

                                    return (
                                        <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 0', borderBottom: '1px solid var(--border)' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                                                <div style={{
                                                    width: '40px',
                                                    height: '40px',
                                                    borderRadius: '50%',
                                                    background: isCredit ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.08)',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    flexShrink: 0
                                                }}>
                                                    {isCredit ? (
                                                        <ArrowUpCircle size={20} color="#10b981" />
                                                    ) : (
                                                        <ArrowDownCircle size={20} color="#ef4444" />
                                                    )}
                                                </div>
                                                <div>
                                                    <p style={{ fontSize: '14px', fontWeight: '700', marginBottom: '3px' }}>
                                                        {t.reference || (isCredit ? 'Credit Added' : 'Order Payment')}
                                                    </p>
                                                    <p style={{ fontSize: '11px', color: 'var(--fg-muted)' }}>
                                                        {formattedDate} • Source: {t.source.toLowerCase().replace(/_/g, ' ')}
                                                    </p>
                                                </div>
                                            </div>
                                            <div style={{ textAlign: 'right' }}>
                                                <span style={{
                                                    fontSize: '15px',
                                                    fontWeight: '900',
                                                    color: isCredit ? '#10b981' : '#ef4444',
                                                    letterSpacing: '-0.02em'
                                                }}>
                                                    {isCredit ? '+' : '-'}Rs {Number(t.amount).toFixed(2)}
                                                </span>
                                                <p style={{ fontSize: '11px', color: 'var(--fg-subtle)', marginTop: '2px' }}>
                                                    Bal: Rs {Number(t.balance_after).toFixed(2)}
                                                </p>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}


                        <div style={{ marginTop: '32px', padding: '20px', background: 'var(--accent-muted)', border: '1px solid var(--accent-border)', borderRadius: 'var(--radius)', display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                            <ShieldCheck size={20} color="var(--accent)" style={{ flexShrink: 0 }} />
                            <div>
                                <h4 style={{ fontSize: '14px', fontWeight: '800', color: 'var(--accent)', marginBottom: '4px' }}>Safe and Secure</h4>
                                <p style={{ fontSize: '13px', color: 'var(--fg-muted)', lineHeight: '1.5' }}>All wallet transactions are securely recorded and tracked. XerCoins are internal credits usable for XerService print orders.</p>
                            </div>
                        </div>
                    </div>
                </div>
            </section>
        </div>
    );
}

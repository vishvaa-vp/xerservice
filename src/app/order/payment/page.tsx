'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/context/AppContext';
import { Order } from '@/lib/mock-data';
import { Smartphone, CreditCard, Coins, CheckCircle, Lock } from 'lucide-react';
import Link from 'next/link';

type PayMethod = 'upi' | 'card' | 'wallet';

function generateOrderId() {
    return `${Date.now()}${Math.floor(Math.random() * 100)}`.slice(-8);
}

function sanitizeCardNumber(raw: string) {
    return raw.replace(/\D/g, '').slice(0, 16);
}

function formatCardNumber(raw: string) {
    return sanitizeCardNumber(raw).replace(/(.{4})/g, '$1 ').trim();
}

function formatExpiry(raw: string) {
    const digits = raw.replace(/\D/g, '').slice(0, 4);
    if (digits.length <= 2) return digits;
    return `${digits.slice(0, 2)}/${digits.slice(2)}`;
}

export default function PaymentPage() {
    const { currentOrder, setCurrentOrder, addOrder, setLastOrderId, user, isLoggedIn } = useApp();
    const [method, setMethod] = useState<PayMethod>('upi');
    const [upiId, setUpiId] = useState('');
    const [card, setCard] = useState({ number: '', expiry: '', cvv: '', name: '' });
    const [step, setStep] = useState<'select' | 'processing' | 'success'>('select');
    const [successOrderId, setSuccessOrderId] = useState('');
    const [paymentError, setPaymentError] = useState<string | null>(null);
    const router = useRouter();

    useEffect(() => {
        if (!isLoggedIn) {
            router.push('/login?redirect=/order/payment');
        }
    }, [isLoggedIn, router]);

    const price = Math.round((currentOrder.totalAmount || 0) * 100) / 100;
    const xerCoinsBalance = user?.xerCoins ?? 0;
    const canPayWallet = xerCoinsBalance >= price;
    const isOrderReady = Boolean(currentOrder.shopId && currentOrder.fileName && price > 0);

    const validatePayment = () => {
        if (!isOrderReady) {
            return 'Order details are incomplete. Please review your order first.';
        }

        if (method === 'upi' && upiId.trim()) {
            const upiRegex = /^[a-zA-Z0-9._-]{2,}@[a-zA-Z]{2,}$/;
            if (!upiRegex.test(upiId.trim())) {
                return 'Enter a valid UPI ID (example: name@upi) or leave it empty if you pay by QR.';
            }
        }

        if (method === 'card') {
            const cardNumber = sanitizeCardNumber(card.number);
            const expiryRegex = /^(0[1-9]|1[0-2])\/\d{2}$/;
            const cvvRegex = /^\d{3}$/;

            if (cardNumber.length !== 16) {
                return 'Card number must be 16 digits.';
            }
            if (!expiryRegex.test(card.expiry)) {
                return 'Expiry must be in MM/YY format.';
            }
            if (!cvvRegex.test(card.cvv)) {
                return 'CVV must be 3 digits.';
            }
            if (!card.name.trim()) {
                return 'Name on card is required.';
            }
        }

        if (method === 'wallet' && !canPayWallet) {
            return 'Insufficient XerCoins balance. Choose another method or top up wallet.';
        }

        return null;
    };

    const persistOrder = async (order: Order): Promise<Order> => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return order;
    };

    const handlePay = async () => {
        const validationError = validatePayment();
        if (validationError) {
            setPaymentError(validationError);
            return;
        }

        setPaymentError(null);
        setStep('processing');

        await new Promise((resolve) => setTimeout(resolve, 1200));

        const orderId = generateOrderId();
        const draftOrder: Order = {
            id: orderId,
            shopId: currentOrder.shopId,
            shopName: currentOrder.shopName,
            fileName: currentOrder.fileName,
            pages: currentOrder.pages,
            color: currentOrder.color,
            sides: currentOrder.sides,
            orientation: currentOrder.orientation,
            copies: currentOrder.copies,
            method: currentOrder.method,
            scheduledTime: currentOrder.scheduledTime,
            paymentMethod: method,
            totalAmount: price,
            status: 'pending',
            createdAt: new Date().toISOString(),
            customerMobile: user?.mobile || '9000000000',
        };

        const savedOrder = await persistOrder(draftOrder);
        addOrder(savedOrder);
        setLastOrderId(savedOrder.id);
        setSuccessOrderId(savedOrder.id);
        setCurrentOrder(prev => ({ ...prev, paymentMethod: method }));
        setStep('success');
    };

    if (!isLoggedIn) {
        return (
            <div style={{ minHeight: '80vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '24px', padding: '40px' }}>
                <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: 'var(--accent-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Lock size={28} color="var(--accent)" />
                </div>
                <div style={{ textAlign: 'center' }}>
                    <p style={{ fontSize: '18px', fontWeight: '700', marginBottom: '8px' }}>Sign in required</p>
                    <p style={{ fontSize: '14px', color: 'var(--fg-muted)', marginBottom: '24px' }}>You need to sign in to complete your payment.</p>
                    <Link href="/login?redirect=/order/payment" className="btn btn-accent">Sign In to Continue</Link>
                </div>
            </div>
        );
    }

    if (step === 'processing') {
        return (
            <div style={{ minHeight: '80vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '24px' }}>
                <div className="spinner spinner-lg" />
                <div style={{ textAlign: 'center' }}>
                    <p style={{ fontSize: '18px', fontWeight: '700', marginBottom: '8px' }}>Processing payment...</p>
                    <p style={{ fontSize: '14px', color: 'var(--fg-muted)' }}>Please do not close this window</p>
                </div>
            </div>
        );
    }

    if (step === 'success') {
        return (
            <div className="page-wrapper">
                <section style={{ minHeight: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 24px' }}>
                    <div className="card fade-in" style={{ maxWidth: '440px', width: '100%', padding: '48px 40px', textAlign: 'center' }}>
                        <div style={{ width: '72px', height: '72px', borderRadius: '50%', background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px', boxShadow: 'var(--shadow-accent)' }}>
                            <CheckCircle size={32} color="#fff" />
                        </div>
                        <h1 style={{ fontSize: '26px', fontWeight: '800', letterSpacing: '-0.03em', marginBottom: '8px' }}>Payment successful</h1>
                        <p style={{ fontSize: '15px', color: 'var(--fg-muted)', marginBottom: '32px', lineHeight: '1.6' }}>
                            Your order has been {currentOrder.method === 'instant' ? 'sent to the shop immediately' : 'scheduled for later'}. You can track it in your dashboard.
                        </p>

                        <div style={{ background: 'var(--bg-secondary)', borderRadius: 'var(--radius)', padding: '24px', marginBottom: '32px', border: '1px solid var(--border)' }}>
                            <p style={{ fontSize: '12px', fontWeight: '700', color: 'var(--fg-subtle)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' }}>Order ID</p>
                            <p style={{ fontSize: '40px', fontWeight: '900', letterSpacing: '-0.04em', color: 'var(--accent)' }}>#{successOrderId}</p>
                            <p style={{ fontSize: '13px', color: 'var(--fg-muted)', marginTop: '8px' }}>{currentOrder.shopName}</p>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            <button onClick={() => router.push('/dashboard/orders')} className="btn btn-primary btn-full">View My Orders</button>
                            <button onClick={() => router.push('/shops')} className="btn btn-outline btn-full">Print Another</button>
                        </div>
                    </div>
                </section>
            </div>
        );
    }

    const payMethods = [
        { id: 'upi' as const, label: 'UPI', desc: 'Pay via UPI ID', icon: Smartphone },
        { id: 'card' as const, label: 'Card', desc: 'Debit / Credit', icon: CreditCard },
        { id: 'wallet' as const, label: 'XerCoins', desc: `Balance: Rs ${xerCoinsBalance.toFixed(2)}`, icon: Coins },
    ];

    return (
        <div className="page-wrapper">
            <section className="section">
                <div className="container-sm">
                    <div style={{ display: 'flex', gap: '8px', marginBottom: '40px', fontSize: '13px', color: 'var(--fg-muted)' }}>
                        <span style={{ color: 'var(--fg-subtle)' }}>Upload</span><span>{'>'}</span>
                        <span style={{ color: 'var(--fg-subtle)' }}>Settings</span><span>{'>'}</span>
                        <span style={{ color: 'var(--fg-subtle)' }}>Pricing</span><span>{'>'}</span>
                        <span style={{ color: 'var(--fg-subtle)' }}>Method</span><span>{'>'}</span>
                        <span>Payment</span>
                    </div>

                    <h1 style={{ fontSize: '28px', fontWeight: '800', letterSpacing: '-0.03em', marginBottom: '8px' }}>Payment</h1>
                    <p style={{ fontSize: '15px', color: 'var(--fg-muted)', marginBottom: '40px' }}>Amount due: <strong>Rs {price.toFixed(2)}</strong></p>

                    {!isOrderReady && (
                        <div style={{ marginBottom: '20px', padding: '12px 14px', borderRadius: '12px', border: '1px solid rgba(245, 158, 11, 0.35)', background: 'rgba(245, 158, 11, 0.12)', color: 'var(--fg-muted)', fontSize: '13px', fontWeight: '600' }}>
                            Missing order details. Go back to Upload/Pricing and complete your order before payment.
                        </div>
                    )}

                    <div style={{ display: 'flex', gap: '10px', marginBottom: '28px', flexWrap: 'wrap' }}>
                        {payMethods.map(opt => {
                            const Icon = opt.icon;
                            return (
                                <button key={opt.id} onClick={() => { setMethod(opt.id); setPaymentError(null); }}
                                    style={{ flex: 1, minWidth: '120px', padding: '16px', borderRadius: 'var(--radius)', border: `2px solid ${method === opt.id ? 'var(--fg)' : 'var(--border)'}`, background: method === opt.id ? 'var(--fg)' : 'transparent', color: method === opt.id ? 'var(--bg)' : 'var(--fg)', cursor: 'pointer', transition: 'all 0.2s', textAlign: 'center' }}>
                                    <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '4px' }}>
                                        <Icon size={22} />
                                    </div>
                                    <div style={{ fontSize: '13px', fontWeight: '600' }}>{opt.label}</div>
                                    <div style={{ fontSize: '11px', opacity: 0.7, marginTop: '2px' }}>{opt.desc}</div>
                                </button>
                            );
                        })}
                    </div>

                    <div className="card" style={{ padding: '28px', marginBottom: '24px' }}>
                        {method === 'upi' && (
                            <div className="fade-in" style={{ textAlign: 'center' }}>
                                <div style={{ background: '#fff', padding: '16px', borderRadius: 'var(--radius)', display: 'inline-block', marginBottom: '16px', border: '1px solid var(--border)' }}>
                                    <img src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=upi://pay?pa=xerservice@upi%26pn=XerService%26am=${price.toFixed(2)}%26cu=INR%26tn=PrintOrder`}
                                        alt="UPI QR" style={{ width: '200px', height: '200px' }} />
                                </div>
                                <p style={{ fontSize: '14px', fontWeight: '700', marginBottom: '16px' }}>Scan with any UPI app</p>
                                <div style={{ textAlign: 'left' }}>
                                    <label className="input-label">UPI ID (optional if paid by QR)</label>
                                    <input className="input" placeholder="yourname@upi" value={upiId} onChange={e => setUpiId(e.target.value)} />
                                    <p style={{ fontSize: '12px', color: 'var(--fg-subtle)', marginTop: '8px' }}>Example: 9876543210@paytm or name@gpay</p>
                                </div>
                            </div>
                        )}

                        {method === 'card' && (
                            <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                <div>
                                    <label className="input-label">Card Number</label>
                                    <input className="input" placeholder="4242 4242 4242 4242" maxLength={19}
                                        value={card.number} onChange={e => setCard({ ...card, number: formatCardNumber(e.target.value) })} />
                                </div>
                                <div>
                                    <label className="input-label">Name on Card</label>
                                    <input className="input" placeholder="Arjun Sharma" value={card.name} onChange={e => setCard({ ...card, name: e.target.value })} />
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                                    <div>
                                        <label className="input-label">Expiry</label>
                                        <input className="input" placeholder="MM/YY" maxLength={5} value={card.expiry} onChange={e => setCard({ ...card, expiry: formatExpiry(e.target.value) })} />
                                    </div>
                                    <div>
                                        <label className="input-label">CVV</label>
                                        <input className="input" placeholder="123" type="password" maxLength={3} value={card.cvv} onChange={e => setCard({ ...card, cvv: e.target.value.replace(/\D/g, '').slice(0, 3) })} />
                                    </div>
                                </div>
                            </div>
                        )}

                        {method === 'wallet' && (
                            <div className="fade-in">
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
                                    <span style={{ fontSize: '15px', fontWeight: '600' }}>XerCoins Balance</span>
                                    <span style={{ fontSize: '15px', fontWeight: '700' }}>Rs {xerCoinsBalance.toFixed(2)}</span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
                                    <span style={{ fontSize: '15px', color: 'var(--fg-muted)' }}>Amount to deduct</span>
                                    <span style={{ fontSize: '15px', fontWeight: '700' }}>Rs {price.toFixed(2)}</span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0', borderTop: '1px solid var(--border)' }}>
                                    <span style={{ fontSize: '15px', fontWeight: '700' }}>Remaining balance</span>
                                    <span style={{ fontSize: '15px', fontWeight: '800', color: canPayWallet ? 'inherit' : '#c0392b' }}>
                                        Rs {Math.max(0, xerCoinsBalance - price).toFixed(2)}
                                    </span>
                                </div>
                                {!canPayWallet && (
                                    <p style={{ fontSize: '13px', color: '#c0392b', marginTop: '12px' }}>Insufficient XerCoins balance. Please choose another payment method.</p>
                                )}
                            </div>
                        )}
                    </div>

                    {paymentError && (
                        <div style={{ marginBottom: '16px', padding: '12px 14px', borderRadius: '12px', border: '1px solid rgba(239, 68, 68, 0.25)', background: 'rgba(239, 68, 68, 0.08)', color: '#ef4444', fontSize: '13px', fontWeight: '600' }}>
                            {paymentError}
                        </div>
                    )}

                    <button onClick={handlePay} className="btn btn-primary btn-full btn-lg"
                        disabled={!isOrderReady || (method === 'wallet' && !canPayWallet)}>
                        Pay Rs {price.toFixed(2)}
                    </button>
                </div>
            </section>
        </div>
    );
}

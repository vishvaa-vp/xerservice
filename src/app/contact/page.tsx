'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
import { Mail, MapPin, Clock, CheckCircle2, Ticket, ArrowLeft } from 'lucide-react';
import Link from 'next/link';

function ContactFormInner() {
    const searchParams = useSearchParams();
    const orderIdParam = searchParams.get('orderId');
    const orderNumberParam = searchParams.get('orderNumber');

    const [form, setForm] = useState({
        name: '',
        email: '',
        phone: '',
        subject: '',
        message: '',
    });
    const [orderId, setOrderId] = useState<string | null>(null);
    const [orderNumber, setOrderNumber] = useState<string | null>(null);
    const [status, setStatus] = useState<'idle' | 'sending' | 'sent'>('idle');
    const [createdTicket, setCreatedTicket] = useState<{
        ticketNumber: string;
        id: string;
    } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [sessionToken, setSessionToken] = useState<string | null>(null);

    useEffect(() => {
        if (orderIdParam) setOrderId(orderIdParam);
        if (orderNumberParam) {
            setOrderNumber(orderNumberParam);
            setForm(prev => ({
                ...prev,
                subject: `Order Issue: #${orderNumberParam}`,
            }));
        }

        async function loadUser() {
            const { data: { session } } = await supabase.auth.getSession();
            if (session?.user) {
                setSessionToken(session.access_token);
                const meta = session.user.user_metadata || {};
                const name = meta.full_name || meta.name || '';
                const email = session.user.email || '';
                const phone = session.user.phone || '';

                setForm(prev => ({
                    ...prev,
                    name: prev.name || name,
                    email: prev.email || email,
                    phone: prev.phone || phone,
                }));
            }
        }
        loadUser();
    }, [orderIdParam, orderNumberParam]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setStatus('sending');
        setError(null);

        try {
            const headers: Record<string, string> = {
                'Content-Type': 'application/json',
            };
            if (sessionToken) {
                headers['Authorization'] = `Bearer ${sessionToken}`;
            }

            const res = await fetch('/api/support/tickets', {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    source: orderId ? 'order_issue' : 'contact_form',
                    customerName: form.name,
                    customerEmail: form.email,
                    customerPhone: form.phone,
                    subject: form.subject,
                    message: form.message,
                    orderId: orderId,
                }),
            });

            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(data.error || 'Failed to submit support request.');
            }

            setCreatedTicket({
                ticketNumber: data.ticket?.ticketNumber || 'TICK-REGISTERED',
                id: data.ticket?.id || '',
            });
            setStatus('sent');
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Failed to submit request.';
            setError(msg);
            setStatus('idle');
        }
    };

    const contactInfo = [
        { label: 'Email', value: 'support@xerservice.in', icon: Mail },
        { label: 'Location', value: 'Coimbatore, Tamil Nadu, India', icon: MapPin },
        { label: 'Hours', value: 'Mon-Sat, 9 AM - 7 PM IST', icon: Clock },
    ];

    return (
        <div className="page-wrapper">
            <section className="section">
                <div className="container-sm" style={{ textAlign: 'center', marginBottom: '56px' }}>
                    <h1 className="section-title">Support & Contact</h1>
                    <p className="section-subtitle">
                        {orderNumber
                            ? `Reporting an inquiry regarding Order #${orderNumber}`
                            : 'Have questions, feedback, or need operational support? We are here to help.'}
                    </p>
                </div>

                <div className="container-sm">
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '48px' }}>
                        <div>
                            <h2 style={{ fontSize: '20px', fontWeight: '700', marginBottom: '24px', letterSpacing: '-0.02em' }}>
                                Get in touch
                            </h2>
                            {contactInfo.map(item => {
                                const Icon = item.icon;
                                return (
                                    <div key={item.label} style={{ display: 'flex', gap: '16px', marginBottom: '28px' }}>
                                        <div style={{ width: '40px', height: '40px', borderRadius: '12px', background: 'var(--accent-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                            <Icon size={20} color="var(--accent)" />
                                        </div>
                                        <div>
                                            <p style={{ fontSize: '12px', fontWeight: '700', color: 'var(--fg-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px' }}>{item.label}</p>
                                            <p style={{ fontSize: '15px', color: 'var(--fg-muted)' }}>{item.value}</p>
                                        </div>
                                    </div>
                                );
                            })}

                            <div style={{ marginTop: '32px', padding: '16px', borderRadius: '12px', background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
                                <p style={{ fontSize: '13px', color: 'var(--fg-muted)', lineHeight: '1.5' }}>
                                    <strong>Immediate Response:</strong> Tickets submitted through this portal are directly dispatched to our customer support desk and tracked with a sequential ticket reference.
                                </p>
                            </div>
                        </div>

                        <div>
                            {status === 'sent' && createdTicket ? (
                                <div className="card" style={{ padding: '40px', textAlign: 'center' }}>
                                    <div style={{ width: '56px', height: '56px', borderRadius: '50%', background: '#22c55e', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
                                        <CheckCircle2 size={28} color="#fff" />
                                    </div>
                                    <h3 style={{ fontSize: '18px', fontWeight: '700', marginBottom: '8px' }}>
                                        Support Request Registered
                                    </h3>
                                    <div style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '8px',
                                        background: 'var(--bg-secondary)',
                                        padding: '8px 16px',
                                        borderRadius: '20px',
                                        margin: '12px 0 16px',
                                        fontSize: '14px',
                                        fontWeight: '800',
                                        color: 'var(--accent)'
                                    }}>
                                        <Ticket size={16} />
                                        Ticket Ref: {createdTicket.ticketNumber}
                                    </div>
                                    <p style={{ fontSize: '14px', color: 'var(--fg-muted)', marginBottom: '24px', lineHeight: '1.5' }}>
                                        We have received your message and linked it to your account. Our support team will review your inquiry shortly.
                                    </p>
                                    <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setStatus('idle');
                                                setCreatedTicket(null);
                                                setForm({ name: '', email: '', phone: '', subject: '', message: '' });
                                            }}
                                            className="btn btn-outline btn-sm"
                                        >
                                            Submit Another Request
                                        </button>
                                        <Link href="/dashboard/orders" className="btn btn-accent btn-sm">
                                            Return to Orders
                                        </Link>
                                    </div>
                                </div>
                            ) : (
                                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                    {orderNumber && (
                                        <div style={{
                                            padding: '10px 14px',
                                            borderRadius: '8px',
                                            background: 'var(--accent-muted)',
                                            color: 'var(--accent)',
                                            fontSize: '13px',
                                            fontWeight: '700',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'space-between'
                                        }}>
                                            <span>Linked to Order #{orderNumber}</span>
                                            <button
                                                type="button"
                                                onClick={() => { setOrderId(null); setOrderNumber(null); }}
                                                style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: '12px', textDecoration: 'underline' }}
                                            >
                                                Unlink
                                            </button>
                                        </div>
                                    )}

                                    <div>
                                        <label className="input-label">Your Name</label>
                                        <input
                                            className="input"
                                            placeholder="Arjun Sharma"
                                            value={form.name}
                                            onChange={e => setForm({ ...form, name: e.target.value })}
                                            required
                                        />
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                                        <div>
                                            <label className="input-label">Email</label>
                                            <input
                                                className="input"
                                                type="email"
                                                placeholder="name@example.com"
                                                value={form.email}
                                                onChange={e => setForm({ ...form, email: e.target.value })}
                                                required
                                            />
                                        </div>
                                        <div>
                                            <label className="input-label">Phone (Optional)</label>
                                            <input
                                                className="input"
                                                type="tel"
                                                placeholder="+919876543210"
                                                value={form.phone}
                                                onChange={e => setForm({ ...form, phone: e.target.value })}
                                            />
                                        </div>
                                    </div>
                                    <div>
                                        <label className="input-label">Subject</label>
                                        <input
                                            className="input"
                                            placeholder="Order issue / Feature request / General"
                                            value={form.subject}
                                            onChange={e => setForm({ ...form, subject: e.target.value })}
                                            required
                                        />
                                    </div>
                                    <div>
                                        <label className="input-label">Message</label>
                                        <textarea
                                            className="input"
                                            placeholder="Describe your question or issue in detail..."
                                            rows={5}
                                            value={form.message}
                                            onChange={e => setForm({ ...form, message: e.target.value })}
                                            required
                                            style={{ resize: 'vertical', minHeight: '120px' }}
                                        />
                                    </div>

                                    {error && (
                                        <div style={{ padding: '10px 12px', borderRadius: '12px', border: '1px solid rgba(239, 68, 68, 0.25)', background: 'rgba(239, 68, 68, 0.08)', color: '#ef4444', fontSize: '13px', fontWeight: '600' }}>
                                            {error}
                                        </div>
                                    )}

                                    <button type="submit" className="btn btn-accent btn-full" disabled={status === 'sending'}>
                                        {status === 'sending' ? (
                                            <><span className="spinner" /> Submitting ticket…</>
                                        ) : (
                                            'Submit Support Request'
                                        )}
                                    </button>

                                    <p style={{ fontSize: '12px', color: 'var(--fg-muted)', textAlign: 'center', marginTop: '4px' }}>
                                        Prefer email? You can also reach us directly at{' '}
                                        <a href="mailto:support@xerservice.in" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>
                                            support@xerservice.in
                                        </a>
                                    </p>
                                </form>
                            )}
                        </div>
                    </div>
                </div>
            </section>
        </div>
    );
}

export default function ContactPage() {
    return (
        <Suspense fallback={
            <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span className="spinner spinner-lg" />
            </div>
        }>
            <ContactFormInner />
        </Suspense>
    );
}

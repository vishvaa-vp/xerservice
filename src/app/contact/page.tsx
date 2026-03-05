'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Mail, MapPin, Clock, CheckCircle, Store } from 'lucide-react';

export default function ContactPage() {
    const [form, setForm] = useState({ name: '', email: '', subject: '', message: '' });
    const [status, setStatus] = useState<'idle' | 'sending' | 'sent'>('idle');
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setStatus('sending');
        setError(null);

        try {
            await new Promise((resolve) => setTimeout(resolve, 600));
            setStatus('sent');
            setForm({ name: '', email: '', subject: '', message: '' });
        } catch {
            setError('Network error while sending your message.');
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
                    <h1 className="section-title">Contact Us</h1>
                    <p className="section-subtitle">Have questions, feedback, or need support? We would love to hear from you.</p>
                </div>

                <div className="container-sm">
                    <div className="card" style={{ marginBottom: '22px', padding: '20px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', background: 'var(--bg-secondary)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: 'var(--accent-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <Store size={18} color="var(--accent)" />
                            </div>
                            <div>
                                <p style={{ fontSize: '15px', fontWeight: '800' }}>Want to partner with XerService?</p>
                                <p style={{ fontSize: '13px', color: 'var(--fg-muted)' }}>Use the dedicated vendor onboarding form.</p>
                            </div>
                        </div>
                        <Link href="/vendor/join" className="btn btn-accent btn-sm">Join as Vendor</Link>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '48px' }}>
                        <div>
                            <h2 style={{ fontSize: '20px', fontWeight: '700', marginBottom: '24px', letterSpacing: '-0.02em' }}>Get in touch</h2>
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
                        </div>

                        <div>
                            {status === 'sent' ? (
                                <div className="card" style={{ padding: '40px', textAlign: 'center' }}>
                                    <div style={{ width: '56px', height: '56px', borderRadius: '50%', background: '#22c55e', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
                                        <CheckCircle size={28} color="#fff" />
                                    </div>
                                    <h3 style={{ fontSize: '18px', fontWeight: '700', marginBottom: '8px' }}>Message sent</h3>
                                    <p style={{ fontSize: '14px', color: 'var(--fg-muted)' }}>We will get back to you within 24 hours.</p>
                                </div>
                            ) : (
                                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                    <div>
                                        <label className="input-label">Your Name</label>
                                        <input className="input" placeholder="Arjun Sharma" value={form.name}
                                            onChange={e => setForm({ ...form, name: e.target.value })} required />
                                    </div>
                                    <div>
                                        <label className="input-label">Email</label>
                                        <input className="input" type="email" placeholder="arjun@gmail.com" value={form.email}
                                            onChange={e => setForm({ ...form, email: e.target.value })} required />
                                    </div>
                                    <div>
                                        <label className="input-label">Subject</label>
                                        <input className="input" placeholder="Order issue / Feature request / General" value={form.subject}
                                            onChange={e => setForm({ ...form, subject: e.target.value })} required />
                                    </div>
                                    <div>
                                        <label className="input-label">Message</label>
                                        <textarea className="input" placeholder="Tell us more..." rows={5} value={form.message}
                                            onChange={e => setForm({ ...form, message: e.target.value })} required
                                            style={{ resize: 'vertical', minHeight: '120px' }} />
                                    </div>

                                    {error && (
                                        <div style={{ padding: '10px 12px', borderRadius: '12px', border: '1px solid rgba(239, 68, 68, 0.25)', background: 'rgba(239, 68, 68, 0.08)', color: '#ef4444', fontSize: '13px', fontWeight: '600' }}>
                                            {error}
                                        </div>
                                    )}

                                    <button type="submit" className="btn btn-accent btn-full" disabled={status === 'sending'}>
                                        {status === 'sending' ? <><span className="spinner" />Sending...</> : 'Send Message'}
                                    </button>
                                </form>
                            )}
                        </div>
                    </div>
                </div>
            </section>
        </div>
    );
}

'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, CheckCircle2, Send, Store } from 'lucide-react';
import { VendorJoinRequest } from '../../../types/vendor';

export default function VendorJoinPage() {
    const [submitted, setSubmitted] = useState(false);
    const [form, setForm] = useState({
        fullName: '',
        mobile: '',
        email: '',
        shopName: '',
        shopAddress: '',
        areaPincode: '',
        shopType: 'Xerox and printing',
        dailyOrders: 'Below 50',
    });

    const update = (key: keyof typeof form, value: string) => {
        setForm(prev => ({ ...prev, [key]: value }));
    };

    const submit = (event: React.FormEvent) => {
        event.preventDefault();
        const request: VendorJoinRequest = {
            id: `vj-${Date.now()}`,
            fullName: form.fullName.trim(),
            mobile: form.mobile.trim(),
            email: form.email.trim(),
            role: 'Shop owner',
            experience: 'Local print service',
            shopName: form.shopName.trim(),
            shopAddress: form.shopAddress.trim(),
            areaPincode: form.areaPincode.trim(),
            shopType: form.shopType,
            dailyOrders: form.dailyOrders,
            requestedAt: new Date().toISOString().slice(0, 10),
            status: 'pending',
        };
        const raw = localStorage.getItem('xer_vendor_requests');
        const previous = raw ? JSON.parse(raw) : [];
        localStorage.setItem('xer_vendor_requests', JSON.stringify([request, ...(Array.isArray(previous) ? previous : [])]));
        setSubmitted(true);
    };

    return (
        <div className="page-wrapper" style={{ background: 'var(--bg-secondary)' }}>
            <section className="section-sm">
                <div className="container-sm">
                    <Link href="/vendor/login" className="btn btn-ghost" style={{ marginBottom: '18px', paddingLeft: 0 }}>
                        <ArrowLeft size={16} /> Vendor Login
                    </Link>

                    <div className="card vendor-join-card">
                        {submitted ? (
                            <div style={{ textAlign: 'center', padding: '28px 0' }}>
                                <CheckCircle2 size={54} color="#22c55e" style={{ margin: '0 auto 16px' }} />
                                <h1 style={{ fontSize: '28px', fontWeight: '900', letterSpacing: 0 }}>Request Sent</h1>
                                <p style={{ color: 'var(--fg-muted)', margin: '10px auto 24px', maxWidth: '420px' }}>
                                    Your vendor request is waiting for admin approval.
                                </p>
                                <Link href="/vendor/login" className="btn btn-accent">Back to Vendor Login</Link>
                            </div>
                        ) : (
                            <>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '22px' }}>
                                    <div style={{ width: '48px', height: '48px', borderRadius: '14px', background: 'var(--accent-muted)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                        <Store size={24} />
                                    </div>
                                    <div>
                                        <h1 style={{ fontSize: '28px', fontWeight: '900', letterSpacing: 0 }}>Join as Vendor</h1>
                                        <p style={{ fontSize: '14px', color: 'var(--fg-muted)' }}>Register your shop for XerService admin approval.</p>
                                    </div>
                                </div>

                                <form onSubmit={submit} className="vendor-join-form">
                                    <label>
                                        <span className="input-label">Owner Name</span>
                                        <input className="input" value={form.fullName} onChange={e => update('fullName', e.target.value)} required />
                                    </label>
                                    <label>
                                        <span className="input-label">Mobile</span>
                                        <input className="input" value={form.mobile} onChange={e => update('mobile', e.target.value.replace(/\D/g, '').slice(0, 10))} required />
                                    </label>
                                    <label>
                                        <span className="input-label">Email</span>
                                        <input className="input" type="email" value={form.email} onChange={e => update('email', e.target.value)} required />
                                    </label>
                                    <label>
                                        <span className="input-label">Shop Name</span>
                                        <input className="input" value={form.shopName} onChange={e => update('shopName', e.target.value)} required />
                                    </label>
                                    <label className="vendor-wide">
                                        <span className="input-label">Shop Address</span>
                                        <textarea className="input" value={form.shopAddress} onChange={e => update('shopAddress', e.target.value)} rows={3} required />
                                    </label>
                                    <label>
                                        <span className="input-label">Pincode</span>
                                        <input className="input" value={form.areaPincode} onChange={e => update('areaPincode', e.target.value.replace(/\D/g, '').slice(0, 6))} required />
                                    </label>
                                    <label>
                                        <span className="input-label">Daily Orders</span>
                                        <select className="input" value={form.dailyOrders} onChange={e => update('dailyOrders', e.target.value)}>
                                            <option>Below 50</option>
                                            <option>50 to 100</option>
                                            <option>Above 100</option>
                                        </select>
                                    </label>
                                    <button className="btn btn-accent vendor-wide" type="submit">
                                        Send Request <Send size={16} />
                                    </button>
                                </form>
                            </>
                        )}
                    </div>
                </div>
            </section>

            <style>{`
                .vendor-join-card {
                    padding: 28px;
                    border-radius: 8px;
                }
                .vendor-join-form {
                    display: grid;
                    grid-template-columns: repeat(2, minmax(0, 1fr));
                    gap: 14px;
                }
                .vendor-wide {
                    grid-column: 1 / -1;
                }
                @media (max-width: 640px) {
                    .vendor-join-card {
                        padding: 20px;
                    }
                    .vendor-join-form {
                        grid-template-columns: 1fr;
                    }
                }
            `}</style>
        </div>
    );
}

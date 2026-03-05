'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, CheckCircle2, Store } from 'lucide-react';

type VendorJoinForm = {
    fullName: string;
    mobile: string;
    email: string;
    role: string;
    experience: string;
    shopName: string;
    shopAddress: string;
    areaPincode: string;
    shopType: string;
    dailyOrders: string;
};

const initialForm: VendorJoinForm = {
    fullName: '',
    mobile: '',
    email: '',
    role: '',
    experience: '',
    shopName: '',
    shopAddress: '',
    areaPincode: '',
    shopType: '',
    dailyOrders: '',
};

export default function VendorJoinPage() {
    const [form, setForm] = useState<VendorJoinForm>(initialForm);
    const [submitting, setSubmitting] = useState(false);
    const [submitted, setSubmitted] = useState(false);

    const update = (key: keyof VendorJoinForm, value: string) => {
        setForm((prev) => ({ ...prev, [key]: value }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitting(true);
        await new Promise((resolve) => setTimeout(resolve, 700));
        setSubmitting(false);
        setSubmitted(true);
    };

    return (
        <div className="page-wrapper" style={{ background: 'var(--bg-secondary)' }}>
            <section className="section-sm">
                <div className="container-sm" style={{ maxWidth: '920px' }}>
                    <Link href="/vendor/login" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '14px', fontWeight: '700', color: 'var(--fg-muted)', marginBottom: '20px' }}>
                        <ArrowLeft size={16} />
                        Back to Vendor Login
                    </Link>

                    <div className="card" style={{ padding: '36px', borderRadius: '24px' }}>
                        {submitted ? (
                            <div style={{ textAlign: 'center', padding: '30px 10px' }}>
                                <div style={{ width: '70px', height: '70px', borderRadius: '50%', background: 'rgba(22, 163, 74, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
                                    <CheckCircle2 size={36} color="#16a34a" />
                                </div>
                                <h1 style={{ fontSize: '28px', fontWeight: '900', marginBottom: '10px' }}>Vendor request submitted</h1>
                                <p style={{ color: 'var(--fg-muted)', fontSize: '15px', marginBottom: '24px' }}>
                                    Team XerService will review your details and contact you soon.
                                </p>
                                <Link href="/vendor/login" className="btn btn-primary">Go to Vendor Login</Link>
                            </div>
                        ) : (
                            <>
                                <div style={{ marginBottom: '30px' }}>
                                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', background: 'var(--accent-muted)', color: 'var(--accent)', borderRadius: '999px', padding: '6px 14px', fontSize: '12px', fontWeight: '900', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: '12px' }}>
                                        <Store size={14} />
                                        Join as Vendor
                                    </div>
                                    <h1 style={{ fontSize: '32px', fontWeight: '900', letterSpacing: '-0.03em', marginBottom: '8px' }}>Vendor Onboarding Form</h1>
                                    <p style={{ color: 'var(--fg-muted)', fontSize: '15px' }}>5 personal questions + 5 shop questions.</p>
                                </div>

                                <form onSubmit={handleSubmit} style={{ display: 'grid', gap: '24px' }}>
                                    <div className="card" style={{ padding: '20px', background: 'var(--bg-secondary)' }}>
                                        <h2 style={{ fontSize: '16px', fontWeight: '800', marginBottom: '16px' }}>Personal Details (5)</h2>
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                                            <Field label="1. Full Name" required><input className="input" value={form.fullName} onChange={(e) => update('fullName', e.target.value)} required /></Field>
                                            <Field label="2. Mobile Number" required><input className="input" type="tel" maxLength={10} value={form.mobile} onChange={(e) => update('mobile', e.target.value.replace(/\D/g, ''))} required /></Field>
                                            <Field label="3. Email Address" required><input className="input" type="email" value={form.email} onChange={(e) => update('email', e.target.value)} required /></Field>
                                            <Field label="4. Your Role" required><input className="input" placeholder="Owner / Manager" value={form.role} onChange={(e) => update('role', e.target.value)} required /></Field>
                                            <Field label="5. Print Experience" required>
                                                <select className="input" value={form.experience} onChange={(e) => update('experience', e.target.value)} required>
                                                    <option value="">Select experience</option>
                                                    <option value="0-1">0-1 years</option>
                                                    <option value="2-5">2-5 years</option>
                                                    <option value="6-10">6-10 years</option>
                                                    <option value="10+">10+ years</option>
                                                </select>
                                            </Field>
                                        </div>
                                    </div>

                                    <div className="card" style={{ padding: '20px', background: 'var(--bg-secondary)' }}>
                                        <h2 style={{ fontSize: '16px', fontWeight: '800', marginBottom: '16px' }}>Shop Details (5)</h2>
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                                            <Field label="1. Shop Name" required><input className="input" value={form.shopName} onChange={(e) => update('shopName', e.target.value)} required /></Field>
                                            <Field label="2. Shop Address" required><input className="input" value={form.shopAddress} onChange={(e) => update('shopAddress', e.target.value)} required /></Field>
                                            <Field label="3. Area + Pincode" required><input className="input" value={form.areaPincode} onChange={(e) => update('areaPincode', e.target.value)} required /></Field>
                                            <Field label="4. Shop Type" required>
                                                <select className="input" value={form.shopType} onChange={(e) => update('shopType', e.target.value)} required>
                                                    <option value="">Select type</option>
                                                    <option value="street">Street / Local Shop</option>
                                                    <option value="studio">Print Studio</option>
                                                    <option value="campus">Campus Print Center</option>
                                                    <option value="enterprise">Enterprise Print Hub</option>
                                                </select>
                                            </Field>
                                            <Field label="5. Daily Order Capacity" required>
                                                <select className="input" value={form.dailyOrders} onChange={(e) => update('dailyOrders', e.target.value)} required>
                                                    <option value="">Select range</option>
                                                    <option value="1-20">1-20 orders</option>
                                                    <option value="21-60">21-60 orders</option>
                                                    <option value="61-120">61-120 orders</option>
                                                    <option value="120+">120+ orders</option>
                                                </select>
                                            </Field>
                                        </div>
                                    </div>

                                    <button type="submit" className="btn btn-accent" style={{ height: '50px', fontWeight: '800' }} disabled={submitting}>
                                        {submitting ? <><span className="spinner" />Submitting...</> : 'Submit Vendor Request'}
                                    </button>
                                </form>
                            </>
                        )}
                    </div>
                </div>
            </section>
        </div>
    );
}

function Field({
    label,
    children,
    required,
}: {
    label: string;
    children: React.ReactNode;
    required?: boolean;
}) {
    return (
        <div>
            <label className="input-label" style={{ marginBottom: '6px' }}>
                {label} {required ? '*' : ''}
            </label>
            {children}
        </div>
    );
}

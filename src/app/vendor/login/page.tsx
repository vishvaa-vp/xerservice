'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useApp } from '@/context/AppContext';
import {
    Store,
    ArrowRight,
    ArrowLeft,
    Smartphone,
    ShieldCheck
} from 'lucide-react';

export default function VendorLoginPage() {
    const [step, setStep] = useState<'mobile' | 'otp'>('mobile');
    const [mobile, setMobile] = useState('');
    const [otp, setOtp] = useState(['', '', '', '', '', '']);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const { login, theme } = useApp();
    const router = useRouter();

    const sendOtp = async () => {
        await new Promise((resolve) => setTimeout(resolve, 500));
        if (mobile.length !== 10) {
            throw new Error('Please enter a valid mobile number.');
        }
    };

    const handleMobile = async (e: React.FormEvent) => {
        e.preventDefault();
        if (mobile.length < 10) return;
        setLoading(true);
        setError(null);
        try {
            await sendOtp();
            setStep('otp');
        } catch (err: any) {
            setError(err?.message || 'Unable to send OTP right now.');
        } finally {
            setLoading(false);
        }
    };

    const handleOtp = async (e: React.FormEvent) => {
        e.preventDefault();
        const code = otp.join('');
        if (code.length < 6) return;
        setLoading(true);
        setError(null);

        try {
            await new Promise((resolve) => setTimeout(resolve, 500));
            if (code !== '161616') {
                setError('The OTP you entered is incorrect.');
                setOtp(['', '', '', '', '', '']);
                return;
            }

            login(mobile, 'Print Shop Owner', 'vendor');
            router.push('/vendor/dashboard');
        } catch {
            setError('Unable to verify OTP. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    const handleResendOtp = async () => {
        if (loading) return;
        setLoading(true);
        setError(null);
        try {
            await sendOtp();
        } catch (err: any) {
            setError(err?.message || 'Unable to resend OTP right now.');
        } finally {
            setLoading(false);
        }
    };

    const handleOtpInput = (idx: number, val: string) => {
        if (!/^\d?$/.test(val)) return;
        setError(null);
        const next = [...otp];
        next[idx] = val;
        setOtp(next);
        if (val && idx < 5) {
            document.getElementById(`votp-${idx + 1}`)?.focus();
        }
    };

    const handleOtpKeyDown = (idx: number, e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Backspace' && !otp[idx] && idx > 0) {
            const prev = document.getElementById(`votp-${idx - 1}`) as HTMLInputElement;
            prev?.focus();
        }
    };

    return (
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 24px', background: 'var(--bg-secondary)' }}>
            <div className="card" style={{ width: '100%', maxWidth: '440px', padding: '56px 48px', border: 'none', boxShadow: '0 20px 40px rgba(0,0,0,0.1)' }}>
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '40px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <img src={theme === 'light' ? '/logo-black.png' : '/logo-white.png'} alt="XerService Logo" style={{ width: '48px', height: '48px', objectFit: 'contain' }} />
                        <span style={{ fontSize: '24px', fontWeight: '900', letterSpacing: '-0.04em' }}>XerService</span>
                    </div>
                </div>

                <div style={{ textAlign: 'center', marginBottom: '40px' }}>
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', background: 'var(--accent-muted)', color: 'var(--accent)', fontSize: '12px', fontWeight: '900', padding: '6px 16px', borderRadius: '100px', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                        <Store size={14} /> Partner Portal
                    </div>
                </div>

                {step === 'mobile' && (
                    <div className="fade-in">
                        <h1 style={{ fontSize: '28px', fontWeight: '900', letterSpacing: '-0.04em', marginBottom: '8px', textAlign: 'center' }}>Vendor Login</h1>
                        <p style={{ fontSize: '15px', color: 'var(--fg-muted)', marginBottom: '40px', textAlign: 'center' }}>Enter your registered mobile number to manage your print shop.</p>

                        <form onSubmit={handleMobile} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                            <div>
                                <label className="input-label" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <Smartphone size={14} /> Mobile Number
                                </label>
                                <div style={{ display: 'flex', gap: '8px' }}>
                                    <div style={{ padding: '14px 18px', background: 'var(--bg-secondary)', border: '2px solid var(--border)', borderRadius: '12px', fontSize: '15px', fontWeight: '800', flexShrink: 0, color: 'var(--fg-muted)' }}>+91</div>
                                    <input className="input" type="tel" maxLength={10} placeholder="Type number..."
                                        value={mobile} onChange={e => setMobile(e.target.value.replace(/\D/g, ''))} required
                                        style={{ border: '2px solid var(--border)', borderRadius: '12px', padding: '14px 20px', fontSize: '16px', fontWeight: '700' }} />
                                </div>
                            </div>
                            <button type="submit" className="btn btn-primary btn-full btn-lg" disabled={loading || mobile.length < 10} style={{ borderRadius: '12px', padding: '16px', fontWeight: '800' }}>
                                {loading ? <><span className="spinner" />Sending OTP...</> : <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>Get OTP <ArrowRight size={18} /></span>}
                            </button>
                            {error && (
                                <div style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', color: '#ef4444', padding: '12px 14px', borderRadius: '12px', fontSize: '13px', fontWeight: '600' }}>
                                    {error}
                                </div>
                            )}
                        </form>
                    </div>
                )}

                {step === 'otp' && (
                    <div className="fade-in">
                        <button onClick={() => { setStep('mobile'); setError(null); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg-muted)', fontSize: '14px', marginBottom: '32px', display: 'flex', alignItems: 'center', gap: '8px', fontWeight: '700' }}>
                            <ArrowLeft size={16} /> Edit number
                        </button>

                        <h1 style={{ fontSize: '28px', fontWeight: '900', letterSpacing: '-0.04em', marginBottom: '8px', textAlign: 'center' }}>Enter OTP</h1>
                        <p style={{ fontSize: '15px', color: 'var(--fg-muted)', marginBottom: '40px', textAlign: 'center' }}>Sent securely to <strong>+91 {mobile}</strong> (6-digit OTP)</p>

                        <form onSubmit={handleOtp} style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
                            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
                                {otp.map((digit, idx) => (
                                    <input key={idx} id={`votp-${idx}`} type="text" inputMode="numeric" maxLength={1} value={digit}
                                        onChange={e => handleOtpInput(idx, e.target.value)}
                                        onKeyDown={e => handleOtpKeyDown(idx, e)}
                                        style={{
                                            width: '52px',
                                            height: '64px',
                                            textAlign: 'center',
                                            fontSize: '24px',
                                            fontWeight: '900',
                                            background: error ? 'rgba(239, 68, 68, 0.05)' : 'var(--bg-secondary)',
                                            border: `2px solid ${error ? '#ef4444' : digit ? 'var(--accent)' : 'var(--border)'}`,
                                            borderRadius: '12px',
                                            color: error ? '#ef4444' : 'var(--fg)',
                                            outline: 'none',
                                            boxShadow: (digit && !error) ? 'var(--shadow-accent-sm)' : 'none',
                                            transition: 'all 0.2s'
                                        }} />
                                ))}
                            </div>
                            {error && (
                                <div style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', color: '#ef4444', padding: '12px 16px', borderRadius: '12px', fontSize: '13px', fontWeight: '600', textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', animation: 'fadeIn 0.3s ease' }}>
                                    {error}
                                </div>
                            )}
                            <button type="submit" className="btn btn-primary btn-full btn-lg" disabled={loading || otp.join('').length < 6} style={{ borderRadius: '12px', padding: '16px', fontWeight: '800' }}>
                                {loading ? <><span className="spinner" />Verifying...</> : <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>Access Dashboard <ShieldCheck size={18} /></span>}
                            </button>
                            <p style={{ fontSize: '13px', color: 'var(--fg-subtle)', textAlign: 'center' }}>
                                Didn't get it? <button type="button" onClick={handleResendOtp} disabled={loading} style={{ background: 'none', border: 'none', color: 'var(--fg)', fontWeight: '600', cursor: loading ? 'not-allowed' : 'pointer', fontSize: '13px', opacity: loading ? 0.5 : 1 }}>Resend OTP</button>
                            </p>
                        </form>
                    </div>
                )}

                <div style={{ marginTop: '40px', textAlign: 'center', fontSize: '13px', color: 'var(--fg-muted)', borderTop: '1px solid var(--border)', paddingTop: '24px' }}>
                    Don't have a partner account? <Link href="/vendor/join" style={{ color: 'var(--accent)', fontWeight: '800' }}>Join as a Vendor</Link>
                </div>
            </div>
        </div>
    );
}

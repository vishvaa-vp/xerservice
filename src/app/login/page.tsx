'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useApp, UserType } from '@/context/AppContext';
import { ArrowLeft, ArrowRight } from 'lucide-react';

export default function LoginPage() {
    const [step, setStep] = useState<'mobile' | 'otp' | 'name'>('mobile');
    const [mobile, setMobile] = useState('');
    const [otp, setOtp] = useState(['', '', '', '', '', '']);
    const [name, setName] = useState('');
    const [loading, setLoading] = useState(false);
    const [userType] = useState<UserType>('customer');
    const [error, setError] = useState<string | null>(null);
    const { login, theme } = useApp();
    const router = useRouter();
    const searchParams = useSearchParams();
    const redirectTo = searchParams.get('redirect') || '/dashboard';

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
            setError(err?.message || 'Failed to connect to OTP service');
        } finally {
            setLoading(false);
        }
    };

    const handleOtp = async (e: React.FormEvent) => {
        e.preventDefault();
        const code = otp.join('');
        if (code.length < 6) return;
        setLoading(true);
        try {
            await new Promise((resolve) => setTimeout(resolve, 500));
            if (code === '161616') {
                setError(null);
                const knownName = localStorage.getItem(`xer_known_name_${mobile}`)?.trim();
                if (knownName) {
                    login(mobile, knownName, userType);
                    router.push(redirectTo);
                } else {
                    setStep('name');
                }
            } else {
                setError('The OTP you entered is incorrect. Please try again.');
                setOtp(['', '', '', '', '', '']);
            }
        } catch {
            setError('Verification failed. Please check your connection.');
        } finally {
            setLoading(false);
        }
    };

    const handleName = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim()) return;
        setLoading(true);
        try {
            await new Promise((resolve) => setTimeout(resolve, 500));
            const trimmedName = name.trim();
            localStorage.setItem(`xer_known_name_${mobile}`, trimmedName);
            login(mobile, trimmedName, userType);
            router.push(redirectTo);
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
            const nextInput = document.getElementById(`otp-${idx + 1}`);
            nextInput?.focus();
        }
    };

    const handleOtpKeyDown = (idx: number, e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Backspace' && !otp[idx] && idx > 0) {
            const prev = document.getElementById(`otp-${idx - 1}`) as HTMLInputElement;
            prev?.focus();
        }
    };

    return (
        <div style={{ minHeight: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 24px', background: 'radial-gradient(ellipse 80% 60% at 50% 0%, var(--accent-muted), transparent 70%)' }}>
            <div className="card scale-in" style={{ width: '100%', maxWidth: '420px', padding: '48px 40px', borderColor: 'var(--border-strong)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '40px', justifyContent: 'center' }}>
                    <img src={theme === 'light' ? '/logo-black.png' : '/logo-white.png'} alt="XerService Logo" style={{ width: '36px', height: '36px', objectFit: 'contain' }} />
                    <span style={{ fontSize: '20px', fontWeight: '800', letterSpacing: '-0.04em' }}>XerService</span>
                </div>

                {step === 'mobile' && (
                    <div className="fade-in">
                        <h1 style={{ fontSize: '22px', fontWeight: '800', letterSpacing: '-0.03em', marginBottom: '8px' }}>Sign in</h1>
                        <p style={{ fontSize: '14px', color: 'var(--fg-muted)', marginBottom: '32px' }}>Enter your mobile number to receive an OTP</p>
                        <form onSubmit={handleMobile} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            <div>
                                <label className="input-label">Mobile Number</label>
                                <div style={{ display: 'flex', gap: '8px' }}>
                                    <div style={{ padding: '13px 14px', background: 'var(--bg-tertiary)', border: '1.5px solid var(--border)', borderRadius: 'var(--radius)', fontSize: '15px', fontWeight: '600', flexShrink: 0 }}>+91</div>
                                    <input className="input" type="tel" maxLength={10} placeholder="98765 43210"
                                        value={mobile} onChange={e => setMobile(e.target.value.replace(/\D/g, ''))} required />
                                </div>
                            </div>
                            <button type="submit" className="btn btn-accent btn-full" disabled={loading || mobile.length < 10}>
                                {loading ? <><span className="spinner" />Sending OTP...</> : <div style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'center' }}>Send OTP <ArrowRight size={18} /></div>}
                            </button>
                            {error && (
                                <div style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', color: '#ef4444', padding: '10px 12px', borderRadius: '12px', fontSize: '13px', fontWeight: '600' }}>
                                    {error}
                                </div>
                            )}
                        </form>
                        <p style={{ fontSize: '13px', color: 'var(--fg-subtle)', textAlign: 'center', marginTop: '24px' }}>
                            By continuing, you agree to our Terms and Privacy Policy.
                        </p>
                    </div>
                )}

                {step === 'otp' && (
                    <div className="fade-in">
                        <button onClick={() => { setStep('mobile'); setError(null); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg-muted)', fontSize: '14px', marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '6px' }}><ArrowLeft size={16} /> Back</button>
                        <h1 style={{ fontSize: '22px', fontWeight: '800', letterSpacing: '-0.03em', marginBottom: '8px' }}>Enter OTP</h1>
                        <p style={{ fontSize: '14px', color: 'var(--fg-muted)', marginBottom: '32px' }}>We sent a 6-digit code to +91 {mobile}</p>
                        <form onSubmit={handleOtp} style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
                                {otp.map((digit, idx) => (
                                    <input key={idx} id={`otp-${idx}`} type="text" inputMode="numeric" maxLength={1}
                                        value={digit}
                                        onChange={e => handleOtpInput(idx, e.target.value)}
                                        onKeyDown={e => handleOtpKeyDown(idx, e)}
                                        style={{ width: '56px', height: '60px', textAlign: 'center', fontSize: '22px', fontWeight: '800', background: error ? 'rgba(239, 68, 68, 0.05)' : 'var(--bg-secondary)', border: `2px solid ${error ? '#ef4444' : digit ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 'var(--radius)', color: error ? '#ef4444' : 'var(--fg)', outline: 'none', transition: 'all 0.2s', boxShadow: digit && !error ? '0 0 0 3px var(--accent-muted)' : 'none' }} />
                                ))}
                            </div>
                            {error && (
                                <div style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', color: '#ef4444', padding: '12px 16px', borderRadius: '12px', fontSize: '13px', fontWeight: '600', textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', animation: 'fadeIn 0.3s ease' }}>
                                    {error}
                                </div>
                            )}
                            <button type="submit" className="btn btn-accent btn-full" disabled={loading || otp.join('').length < 6}>
                                {loading ? <><span className="spinner" />Verifying...</> : <div style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'center' }}>Verify OTP <ArrowRight size={18} /></div>}
                            </button>
                            <p style={{ fontSize: '13px', color: 'var(--fg-subtle)', textAlign: 'center' }}>
                                Didn't get it? <button type="button" onClick={handleResendOtp} disabled={loading} style={{ background: 'none', border: 'none', color: 'var(--fg)', fontWeight: '600', cursor: loading ? 'not-allowed' : 'pointer', fontSize: '13px', opacity: loading ? 0.5 : 1 }}>Resend OTP</button>
                            </p>
                        </form>
                    </div>
                )}

                {step === 'name' && (
                    <div className="fade-in">
                        <h1 style={{ fontSize: '22px', fontWeight: '800', letterSpacing: '-0.03em', marginBottom: '8px' }}>Welcome!</h1>
                        <p style={{ fontSize: '14px', color: 'var(--fg-muted)', marginBottom: '32px' }}>This looks like your first time. What should we call you?</p>
                        <form onSubmit={handleName} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            <div>
                                <label className="input-label">Your Name</label>
                                <input className="input" placeholder="Arjun Sharma" value={name} onChange={e => setName(e.target.value)} required />
                            </div>
                            <button type="submit" className="btn btn-primary btn-full" disabled={loading || !name.trim()}>
                                {loading ? <><span className="spinner" />Setting up...</> : <div style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'center' }}>Get Started <ArrowRight size={18} /></div>}
                            </button>
                        </form>
                    </div>
                )}
            </div>
        </div>
    );
}

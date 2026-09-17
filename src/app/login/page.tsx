'use client';

import TermsContent from '@/components/legal/TermsContent';
import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useApp, UserType } from '@/context/AppContext';
import { customerDestination } from '@/lib/customer-navigation';
import { supabase } from '@/lib/supabase/client';
import { normalizePhoneNumber, isValidIndianMobile } from '@/lib/phone';
import { ArrowLeft, ArrowRight, Eye, EyeOff, Lock, Mail, Phone, User as UserIcon, X } from 'lucide-react';

function LoginPageContent() {
    const isPhoneAuthEnabled = process.env.NEXT_PUBLIC_PHONE_AUTH_ENABLED === 'true';

    const searchParams = useSearchParams();
    const [step, setStep] = useState<'choice' | 'mobile' | 'otp'>('choice');
    const [authMode, setAuthMode] = useState<'login' | 'signup'>(searchParams.get('mode') === 'signup' ? 'signup' : 'login');
    const [fullName, setFullName] = useState('');
    const [mobile, setMobile] = useState('');
    const [normalizedPhone, setNormalizedPhone] = useState('');
    const [countdown, setCountdown] = useState(0);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [otp, setOtp] = useState(['', '', '', '', '', '']);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);
    const [showTerms, setShowTerms] = useState(false);
    const { theme, isLoggedIn, isLoading, authInitialized, refreshProfile, user } = useApp();
    const router = useRouter();
    const rawRedirect = customerDestination(searchParams.get('redirect'));
    const shopParam = searchParams.get('shop');
    const redirectTo = (shopParam && rawRedirect.startsWith('/order/upload') && !rawRedirect.includes('shop='))
        ? `${rawRedirect}${rawRedirect.includes('?') ? '&' : '?'}shop=${encodeURIComponent(shopParam)}`
        : rawRedirect;

    // If already authenticated, redirect to destination
    useEffect(() => {
        if (authInitialized && !isLoading && isLoggedIn && user?.type === 'customer') {
            router.replace(redirectTo);
        }
    }, [authInitialized, isLoading, isLoggedIn, router, redirectTo, user?.type]);

    // Show deletion confirmation message or OAuth error messages
    useEffect(() => {
        if (searchParams.get('deleted') === '1') {
            setSuccessMessage('Your account has been deleted successfully.');
        }
        const errorParam = searchParams.get('error');
        if (errorParam) {
            setError(errorParam);
        }
    }, [searchParams]);

    // Resend OTP cooldown timer
    useEffect(() => {
        if (countdown <= 0) return;
        const timer = setTimeout(() => setCountdown(prev => prev - 1), 1000);
        return () => clearTimeout(timer);
    }, [countdown]);

    const handleGoogle = async () => {
        setLoading(true);
        setError(null);
        try {
            const origin = typeof window !== 'undefined' ? window.location.origin : '';
            const callbackUrl = `${origin}/auth/callback?redirect=${encodeURIComponent(redirectTo)}`;
            const { error: oauthError } = await supabase.auth.signInWithOAuth({
                provider: 'google',
                options: {
                    redirectTo: callbackUrl,
                },
            });
            if (oauthError) {
                if (oauthError.message.toLowerCase().includes('unsupported provider') || oauthError.message.toLowerCase().includes('not enabled')) {
                    setError('Google Login is not enabled in your Supabase project yet. Please configure Google OAuth in the Supabase Dashboard.');
                } else {
                    setError(oauthError.message);
                }
            }
        } catch (err: any) {
            setError(err?.message || 'Failed to initiate Google login.');
        } finally {
            setLoading(false);
        }
    };

    const handleEmail = async (e: React.FormEvent) => {
        e.preventDefault();

        const trimmedEmail = email.trim().toLowerCase();
        if (!trimmedEmail) {
            setError('Please enter your email address.');
            return;
        }

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
            setError('Please enter a valid email address.');
            return;
        }

        if (!password) {
            setError('Please enter your password.');
            return;
        }

        setLoading(true);
        setError(null);
        try {
            const { data, error: authError } = await supabase.auth.signInWithPassword({
                email: trimmedEmail,
                password,
            });

            if (authError) {
                if (authError.message.toLowerCase().includes('invalid login credentials')) {
                    setError('Invalid email or password. Please check your credentials.');
                } else if (authError.message.toLowerCase().includes('email not confirmed')) {
                    setError('Please confirm your email address before logging in.');
                } else {
                    setError(authError.message || 'Failed to log in. Please try again.');
                }
                return;
            }

            if (data.user) {
                await refreshProfile();
            }
        } catch (err: any) {
            setError(err?.message || 'A network error occurred. Please check your connection.');
        } finally {
            setLoading(false);
        }
    };

    const handleSignup = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setSuccessMessage(null);

        const trimmedName = fullName.trim();
        if (!trimmedName) {
            setError('Please enter your full name.');
            return;
        }

        const trimmedEmail = email.trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
            setError('Please enter a valid email address.');
            return;
        }

        if (!password || password.length < 6) {
            setError('Password must be at least 6 characters.');
            return;
        }

        setLoading(true);
        try {
            const { data, error: signUpError } = await supabase.auth.signUp({
                email: trimmedEmail,
                password,
                options: {
                    data: {
                        full_name: trimmedName,
                        name: trimmedName,
                    },
                },
            });

            if (signUpError) {
                if (signUpError.message.toLowerCase().includes('already registered')) {
                    setError('This email is already registered. Please log in instead.');
                } else {
                    setError(signUpError.message || 'Failed to create account.');
                }
                return;
            }

            if (data.session) {
                if (refreshProfile) {
                    await refreshProfile();
                }
                await refreshProfile();
            } else if (data.user) {
                setSuccessMessage('Account created! Please check your email inbox to confirm your account, then log in.');
                setAuthMode('login');
            }
        } catch (err: any) {
            setError(err?.message || 'A network error occurred. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    const handleMobile = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!isPhoneAuthEnabled) {
            setError('Mobile OTP login is currently disabled in this environment.');
            return;
        }

        if (!isValidIndianMobile(mobile)) {
            setError('Please enter a valid 10-digit Indian mobile number (starting with 6-9).');
            return;
        }

        const normalized = normalizePhoneNumber(mobile);
        if (!normalized) {
            setError('Invalid mobile number format.');
            return;
        }

        setEmail('');
        setLoading(true);
        setError(null);
        try {
            const { error: otpError } = await supabase.auth.signInWithOtp({
                phone: normalized,
                options: {
                    shouldCreateUser: true,
                },
            });

            if (otpError) {
                setError(otpError.message || 'Failed to send OTP. Please try again.');
                return;
            }

            setNormalizedPhone(normalized);
            setStep('otp');
            setCountdown(60);
        } catch (err: any) {
            setError(err?.message || 'Failed to connect to OTP service.');
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
            const { data, error: verifyError } = await supabase.auth.verifyOtp({
                phone: normalizedPhone,
                token: code,
                type: 'sms',
            });

            if (verifyError) {
                setError(verifyError.message || 'The OTP you entered is incorrect. Please try again.');
                setOtp(['', '', '', '', '', '']);
                return;
            }

            if (data.session || data.user) {
                // Ensure customer profile is authoritatively created/linked with verified phone
                const token = data.session?.access_token;
                if (token) {
                    try {
                        await fetch('/api/customer/phone/sync', {
                            method: 'POST',
                            headers: {
                                Authorization: `Bearer ${token}`,
                            },
                        });
                    } catch (syncErr) {
                        console.error('[Login] Profile sync error:', syncErr);
                    }
                } else {
                    // Fallback to database RPC
                    try {
                        await supabase.rpc('sync_verified_phone_to_profile');
                    } catch (rpcErr) {
                        console.warn('[Login] RPC sync fallback:', rpcErr);
                    }
                }

                if (refreshProfile) {
                    await refreshProfile();
                }
                router.replace(redirectTo);
            }
        } catch (err: any) {
            setError(err?.message || 'Verification failed. Please check your connection.');
        } finally {
            setLoading(false);
        }
    };

    const handleResendOtp = async () => {
        if (loading || countdown > 0) return;
        if (!isPhoneAuthEnabled) {
            setError('Mobile OTP login is currently disabled in this environment.');
            return;
        }
        if (!normalizedPhone) return;

        setLoading(true);
        setError(null);
        try {
            const { error: otpError } = await supabase.auth.signInWithOtp({
                phone: normalizedPhone,
                options: {
                    shouldCreateUser: true,
                },
            });
            if (otpError) {
                setError(otpError.message || 'Unable to resend OTP right now.');
            } else {
                setCountdown(60);
            }
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
        <div className="login-shell">
            <div className="card scale-in login-card">
                <button type="button" aria-label="Close login" onClick={() => router.push('/')} className="login-close">
                    <X size={22} />
                </button>
                <div className="login-brand-row">
                    <img src={theme === 'light' ? '/logo-black.png' : '/logo-white.png'} alt="XerService Logo" style={{ width: '36px', height: '36px', objectFit: 'contain' }} />
                    <span style={{ fontSize: '20px', fontWeight: '800', letterSpacing: '-0.04em' }}>XerService</span>
                </div>

                {step === 'choice' && authMode === 'login' && (
                    <div className="fade-in">
                        <h1 className="login-title">Login</h1>

                        <div className="login-methods">
                            <button type="button" className="login-method-btn" onClick={handleGoogle} disabled={loading}>
                                <span className="google-mark" aria-hidden="true">G</span>
                                <span>Continue with Google</span>
                            </button>
                        </div>

                        <div className="login-divider"><span>OR</span></div>

                        <form onSubmit={handleEmail} className="login-email-form">
                            <div className="login-email-wrap">
                                <Mail size={20} />
                                <input
                                    type="email"
                                    placeholder="Email address"
                                    value={email}
                                    onChange={(e) => {
                                        setEmail(e.target.value);
                                        setError(null);
                                    }}
                                    aria-label="Email address"
                                />
                            </div>

                            <div className="login-email-wrap">
                                <Lock size={20} />
                                <input
                                    type={showPassword ? 'text' : 'password'}
                                    placeholder="Password"
                                    value={password}
                                    onChange={(e) => {
                                        setPassword(e.target.value);
                                        setError(null);
                                    }}
                                    aria-label="Password"
                                    style={{ flex: 1 }}
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(p => !p)}
                                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg-muted)', padding: '0 2px', display: 'flex', alignItems: 'center' }}
                                >
                                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                </button>
                            </div>

                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '-4px', marginBottom: '8px' }}>
                                <button
                                    type="button"
                                    onClick={() => { setAuthMode('signup'); setError(null); setSuccessMessage(null); }}
                                    style={{ background: 'none', border: 'none', padding: 0, fontSize: '13px', color: 'var(--accent)', fontWeight: '700', cursor: 'pointer', textDecoration: 'none' }}
                                >
                                    Create Account
                                </button>
                                <a href="/forgot-password" style={{ fontSize: '13px', color: 'var(--accent)', fontWeight: '700', textDecoration: 'none' }}>Forgot password?</a>
                            </div>

                            <TermsConsent onOpenTerms={() => setShowTerms(true)} />

                            {successMessage && (
                                <div style={{ padding: '10px 14px', borderRadius: '8px', background: 'rgba(34, 197, 94, 0.1)', color: '#16a34a', fontSize: '13px', fontWeight: '600', marginBottom: '14px', border: '1px solid rgba(34, 197, 94, 0.2)' }}>
                                    {successMessage}
                                </div>
                            )}

                            {error && (
                                <div className="login-error">
                                    {error}
                                </div>
                            )}

                            <button type="submit" className="btn btn-primary btn-full btn-lg" disabled={loading || !email.trim() || !password.trim()}>
                                {loading ? <><span className="spinner" />Logging in...</> : 'Login'}
                            </button>
                        </form>

                        {/* Mobile Number + OTP Login Option (Coming Soon when disabled) */}
                        <div className="login-phone-card" style={{ marginTop: '24px', paddingTop: '20px', borderTop: '1px solid var(--border)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <Phone size={18} style={{ color: 'var(--fg-muted)' }} />
                                    <span style={{ fontSize: '15px', fontWeight: '700', color: 'var(--fg)' }}>
                                        Mobile Number + OTP
                                    </span>
                                </div>
                                {!isPhoneAuthEnabled && (
                                    <span style={{
                                        fontSize: '11px',
                                        fontWeight: '700',
                                        textTransform: 'uppercase',
                                        letterSpacing: '0.04em',
                                        padding: '3px 8px',
                                        borderRadius: '999px',
                                        background: 'var(--bg-tertiary)',
                                        color: 'var(--fg-muted)',
                                        border: '1px solid var(--border)'
                                    }}>
                                        Coming Soon
                                    </span>
                                )}
                            </div>
                            <p style={{ fontSize: '13px', color: 'var(--fg-muted)', marginBottom: '12px', lineHeight: 1.4 }}>
                                {!isPhoneAuthEnabled
                                    ? 'Login quickly using your mobile number and OTP. This feature will be available soon.'
                                    : 'Login quickly using your mobile number and OTP.'}
                            </p>
                            {!isPhoneAuthEnabled ? (
                                <button
                                    type="button"
                                    disabled
                                    className="btn btn-outline btn-full"
                                    style={{
                                        opacity: 0.6,
                                        cursor: 'not-allowed',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        gap: '8px',
                                        fontSize: '14px',
                                        fontWeight: '600'
                                    }}
                                >
                                    <Phone size={16} />
                                    <span>Mobile OTP Login — Coming Soon</span>
                                </button>
                            ) : (
                                <button
                                    type="button"
                                    className="btn btn-outline btn-full"
                                    onClick={() => { setStep('mobile'); setEmail(''); setError(null); }}
                                    disabled={loading}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        gap: '8px',
                                        fontSize: '14px',
                                        fontWeight: '600'
                                    }}
                                >
                                    <Phone size={16} />
                                    <span>Mobile OTP Login</span>
                                </button>
                            )}
                        </div>
                    </div>
                )}

                {step === 'choice' && authMode === 'signup' && (
                    <div className="fade-in">
                        <h1 className="login-title">Create Account</h1>

                        <div className="login-methods">
                            <button type="button" className="login-method-btn" onClick={handleGoogle} disabled={loading}>
                                <span className="google-mark" aria-hidden="true">G</span>
                                <span>Continue with Google</span>
                            </button>
                        </div>

                        <div className="login-divider"><span>OR</span></div>

                        <form onSubmit={handleSignup} className="login-email-form">
                            <div className="login-email-wrap">
                                <UserIcon size={20} />
                                <input
                                    type="text"
                                    placeholder="Full name"
                                    value={fullName}
                                    onChange={(e) => {
                                        setFullName(e.target.value);
                                        setError(null);
                                    }}
                                    aria-label="Full name"
                                />
                            </div>

                            <div className="login-email-wrap">
                                <Mail size={20} />
                                <input
                                    type="email"
                                    placeholder="Email address"
                                    value={email}
                                    onChange={(e) => {
                                        setEmail(e.target.value);
                                        setError(null);
                                    }}
                                    aria-label="Email address"
                                />
                            </div>

                            <div className="login-email-wrap">
                                <Lock size={20} />
                                <input
                                    type={showPassword ? 'text' : 'password'}
                                    placeholder="Password (min 6 characters)"
                                    value={password}
                                    onChange={(e) => {
                                        setPassword(e.target.value);
                                        setError(null);
                                    }}
                                    aria-label="Password"
                                    style={{ flex: 1 }}
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(p => !p)}
                                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg-muted)', padding: '0 2px', display: 'flex', alignItems: 'center' }}
                                >
                                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                </button>
                            </div>

                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '-4px', marginBottom: '8px' }}>
                                <span style={{ fontSize: '13px', color: 'var(--fg-muted)' }}>
                                    Already have an account?{' '}
                                    <button
                                        type="button"
                                        onClick={() => { setAuthMode('login'); setError(null); setSuccessMessage(null); }}
                                        style={{ background: 'none', border: 'none', padding: 0, fontSize: '13px', color: 'var(--accent)', fontWeight: '700', cursor: 'pointer', textDecoration: 'none' }}
                                    >
                                        Log in
                                    </button>
                                </span>
                                <a href="/forgot-password" style={{ fontSize: '13px', color: 'var(--accent)', fontWeight: '700', textDecoration: 'none' }}>Forgot password?</a>
                            </div>

                            <TermsConsent onOpenTerms={() => setShowTerms(true)} />

                            {error && (
                                <div className="login-error">
                                    {error}
                                </div>
                            )}

                            <button type="submit" className="btn btn-primary btn-full btn-lg" disabled={loading || !fullName.trim() || !email.trim() || !password.trim()}>
                                {loading ? <><span className="spinner" />Creating account...</> : 'Create Account'}
                            </button>
                        </form>
                    </div>
                )}

                {step === 'mobile' && (
                    <div className="fade-in">
                        <button onClick={() => { setStep('choice'); setError(null); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg-muted)', fontSize: '14px', marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '6px' }}><ArrowLeft size={16} /> Back</button>
                        {!isPhoneAuthEnabled ? (
                            <div style={{ textAlign: 'center', padding: '24px 8px' }}>
                                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                                    <h1 style={{ fontSize: '20px', fontWeight: '800', margin: 0 }}>Mobile Number + OTP</h1>
                                    <span style={{
                                        fontSize: '11px',
                                        fontWeight: '700',
                                        textTransform: 'uppercase',
                                        letterSpacing: '0.04em',
                                        padding: '2px 8px',
                                        borderRadius: '999px',
                                        background: 'var(--bg-tertiary)',
                                        color: 'var(--fg-muted)',
                                        border: '1px solid var(--border)'
                                    }}>
                                        Coming Soon
                                    </span>
                                </div>
                                <p style={{ fontSize: '14px', color: 'var(--fg-muted)', marginBottom: '20px', lineHeight: 1.5 }}>
                                    Login quickly using your mobile number and OTP. This feature will be available soon.
                                </p>
                                <button type="button" className="btn btn-outline btn-full" onClick={() => setStep('choice')}>
                                    Return to Login Options
                                </button>
                            </div>
                        ) : (
                            <>
                                <h1 style={{ fontSize: '22px', fontWeight: '800', letterSpacing: '-0.03em', marginBottom: '8px' }}>Continue with phone</h1>
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
                                    <TermsConsent onOpenTerms={() => setShowTerms(true)} />
                                    <button type="submit" className="btn btn-accent btn-full" disabled={loading || mobile.length < 10}>
                                        {loading ? <><span className="spinner" />Sending OTP...</> : <div style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'center' }}>Send OTP <ArrowRight size={18} /></div>}
                                    </button>
                                    {error && (
                                        <div style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', color: '#ef4444', padding: '10px 12px', borderRadius: '12px', fontSize: '13px', fontWeight: '600' }}>
                                            {error}
                                        </div>
                                    )}
                                </form>
                            </>
                        )}
                    </div>
                )}

                {step === 'otp' && (
                    <div className="fade-in">
                        <button onClick={() => { setStep('mobile'); setError(null); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg-muted)', fontSize: '14px', marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '6px' }}><ArrowLeft size={16} /> Back</button>
                        <h1 style={{ fontSize: '22px', fontWeight: '800', letterSpacing: '-0.03em', marginBottom: '8px' }}>Enter OTP</h1>
                        <p style={{ fontSize: '14px', color: 'var(--fg-muted)', marginBottom: '32px' }}>We sent a 6-digit code to {normalizedPhone || `+91 ${mobile}`}</p>
                        <form onSubmit={handleOtp} style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                            <div className="otp-grid" style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
                                {otp.map((digit, idx) => (
                                    <input key={idx} id={`otp-${idx}`} type="text" inputMode="numeric" maxLength={1}
                                        value={digit}
                                        onChange={e => handleOtpInput(idx, e.target.value)}
                                        onKeyDown={e => handleOtpKeyDown(idx, e)}
                                        className="otp-input"
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
                            <div style={{ fontSize: '13px', color: 'var(--fg-subtle)', textAlign: 'center' }}>
                                Didn&apos;t get it?{' '}
                                {countdown > 0 ? (
                                    <span style={{ color: 'var(--fg-muted)', fontWeight: '700' }}>
                                        Resend OTP in {countdown}s
                                    </span>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={handleResendOtp}
                                        disabled={loading}
                                        style={{ background: 'none', border: 'none', color: 'var(--accent)', fontWeight: '700', cursor: loading ? 'not-allowed' : 'pointer', fontSize: '13px', opacity: loading ? 0.5 : 1 }}
                                    >
                                        Resend OTP
                                    </button>
                                )}
                            </div>
                        </form>
                    </div>
                )}
            </div>
            {showTerms && (
                <div className="confirm-overlay" role="dialog" aria-modal="true" aria-labelledby="terms-title">
                    <div className="terms-card scale-in">
                        <button className="confirm-close" onClick={() => setShowTerms(false)} aria-label="Close terms">
                            <X size={18} />
                        </button>
                        <h2 id="terms-title">Terms & Conditions</h2>
                        <p className="terms-updated">Last Updated: September 2026</p>
                        <div className="terms-body"><TermsContent />
                        </div>
                        <button className="btn btn-accent btn-full" onClick={() => setShowTerms(false)}>Close</button>
                    </div>
                </div>
            )}
            <style>{`
                .login-shell {
                    min-height: 80vh;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: 36px 20px;
                    background:
                        linear-gradient(180deg, var(--bg-secondary), var(--bg)),
                        var(--bg-secondary);
                }
                .login-card {
                    position: relative;
                    width: 100%;
                    max-width: 460px;
                    padding: 34px;
                    border-color: var(--border);
                    border-radius: var(--radius);
                    box-shadow: var(--shadow);
                    overflow: hidden;
                }
                .login-card:before {
                    content: '';
                    position: absolute;
                    inset: 0 0 auto;
                    height: 4px;
                    background: var(--accent);
                }
                .login-brand-row {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    margin-bottom: 24px;
                    justify-content: flex-start;
                }
                .login-close {
                    position: absolute;
                    top: 16px;
                    right: 16px;
                    width: 36px;
                    height: 36px;
                    border: 0;
                    border-radius: var(--radius-sm);
                    background: var(--bg-secondary);
                    color: var(--fg);
                    display: grid;
                    place-items: center;
                    cursor: pointer;
                }
                .login-close:hover {
                    background: var(--bg-secondary);
                }
                .login-badge {
                    display: inline-flex;
                    align-items: center;
                    min-height: 28px;
                    border-radius: 999px;
                    padding: 5px 10px;
                    margin-bottom: 12px;
                    background: var(--accent-muted);
                    color: var(--accent);
                    border: 1px solid var(--accent-border);
                    font-size: 12px;
                    font-weight: 900;
                }
                .login-title {
                    font-size: 30px;
                    line-height: 1.15;
                    font-weight: 900;
                    letter-spacing: 0;
                    text-align: left;
                    margin-bottom: 24px;
                    display: flex;
                    align-items: center;
                    gap: 10px;
                }
                .login-subtitle {
                    font-size: 15px;
                    line-height: 1.45;
                    color: var(--fg-muted);
                    text-align: left;
                    margin: 0 0 24px;
                }
                .login-methods {
                    display: grid;
                    gap: 10px;
                    margin-bottom: 22px;
                }
                .login-method-btn {
                    min-height: 52px;
                    border-radius: var(--radius);
                    border: 1.5px solid var(--border);
                    background: var(--bg-secondary);
                    color: var(--fg);
                    display: flex;
                    align-items: center;
                    justify-content: flex-start;
                    gap: 12px;
                    padding: 0 16px;
                    font-size: 15px;
                    font-weight: 800;
                    cursor: pointer;
                    transition: transform 0.2s ease, border-color 0.2s ease, background 0.2s ease;
                }
                .login-method-btn:hover {
                    transform: translateY(-1px);
                    border-color: var(--border-strong);
                    background: var(--bg);
                    box-shadow: var(--shadow-sm);
                }
                .login-method-btn:disabled {
                    opacity: 0.65;
                    cursor: wait;
                    transform: none;
                }
                .google-mark {
                    width: 26px;
                    height: 26px;
                    display: inline-grid;
                    place-items: center;
                    border-radius: 50%;
                    background: var(--bg);
                    border: 1px solid var(--border);
                    font-size: 17px;
                    font-weight: 900;
                    color: #4285f4;
                    line-height: 1;
                }
                .login-divider {
                    display: grid;
                    grid-template-columns: 1fr auto 1fr;
                    align-items: center;
                    gap: 14px;
                    color: var(--fg-muted);
                    font-size: 12px;
                    font-weight: 800;
                    margin-bottom: 18px;
                }
                .login-divider:before,
                .login-divider:after {
                    content: '';
                    height: 1px;
                    background: var(--border-strong);
                }
                .login-email-form {
                    display: grid;
                    gap: 12px;
                }
                .login-email-wrap {
                    min-height: 52px;
                    border: 1.5px solid var(--border);
                    border-radius: var(--radius);
                    background: var(--bg-secondary);
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    padding: 0 16px;
                    color: var(--fg-muted);
                }
                .login-email-wrap:focus-within {
                    border-color: var(--accent);
                    box-shadow: 0 0 0 3px var(--accent-muted);
                    background: var(--bg);
                }
                .login-email-wrap input {
                    width: 100%;
                    border: 0;
                    outline: 0;
                    background: transparent;
                    color: var(--fg);
                    font-size: 15px;
                    font-weight: 600;
                    min-width: 0;
                }
                .login-email-wrap input::placeholder {
                    color: var(--fg-muted);
                }
                .login-terms {
                    color: var(--fg-muted);
                    font-size: 12px;
                    line-height: 1.5;
                    text-align: center;
                    padding: 0 8px;
                }
                .login-terms button {
                    border: 0;
                    background: transparent;
                    padding: 0;
                    color: var(--accent);
                    font-weight: 900;
                    text-decoration: underline;
                    cursor: pointer;
                }
                .login-error {
                    background: rgba(239, 68, 68, 0.1);
                    border: 1px solid rgba(239, 68, 68, 0.2);
                    color: #ef4444;
                    padding: 11px 13px;
                    border-radius: 8px;
                    font-size: 13px;
                    font-weight: 700;
                }
                .terms-card {
                    position: relative;
                    width: min(100%, 720px);
                    max-height: min(82vh, 760px);
                    display: flex;
                    flex-direction: column;
                    background: var(--bg);
                    border: 1px solid var(--border);
                    border-radius: 8px;
                    padding: 26px;
                    box-shadow: var(--shadow-lg);
                }
                .terms-card h2 {
                    font-size: 24px;
                    font-weight: 900;
                    letter-spacing: 0;
                    margin-bottom: 4px;
                }
                .terms-updated {
                    color: var(--fg-muted);
                    font-size: 13px;
                    margin-bottom: 14px;
                }
                .terms-body {
                    overflow-y: auto;
                    padding-right: 8px;
                    margin-bottom: 18px;
                }
                .terms-body h3 {
                    font-size: 15px;
                    font-weight: 900;
                    letter-spacing: 0;
                    margin: 18px 0 6px;
                }
                .terms-body p {
                    font-size: 14px;
                    color: var(--fg-muted);
                    line-height: 1.65;
                    margin-bottom: 8px;
                }
                @media (max-width: 560px) {
                    .login-shell {
                        align-items: flex-start;
                        padding: 22px 14px;
                    }
                    .login-card {
                        padding: 30px 18px 22px;
                    }
                    .login-title {
                        font-size: 26px;
                    }
                    .login-subtitle {
                        font-size: 14px;
                    }
                    .login-method-btn,
                    .login-email-wrap {
                        min-height: 50px;
                        font-size: 14px;
                    }
                    .login-email-wrap input {
                        font-size: 16px;
                    }
                    .terms-card {
                        padding: 20px;
                        max-height: 88vh;
                    }
                    .otp-grid {
                        gap: 6px !important;
                    }
                    .otp-input {
                        width: 42px !important;
                        height: 52px !important;
                    }
                }
            `}</style>
        </div>
    );
}

function TermsConsent({ onOpenTerms }: { onOpenTerms: () => void }) {
    return (
        <p className="login-terms">
            By continuing, you accept XerService's{' '}
            <button type="button" onClick={onOpenTerms}>Terms & Conditions and Privacy Policy</button>.
        </p>
    );
}

export default function LoginPage() {
    return (
        <Suspense fallback={<div className="login-shell"><span className="spinner spinner-lg" /></div>}>
            <LoginPageContent />
        </Suspense>
    );
}

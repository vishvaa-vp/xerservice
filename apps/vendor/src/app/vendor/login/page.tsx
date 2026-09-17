'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useApp } from '@/context/AppContext';
import { supabase } from '@/lib/supabase/client';
import {
    Store,
    ArrowRight,
    Lock,
    Mail,
    Eye,
    EyeOff,
    ShieldCheck
} from 'lucide-react';

export default function VendorLoginPage() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const { refreshProfile, theme, user, isLoggedIn, isLoading, authInitialized } = useApp();
    const router = useRouter();

    // If already authenticated as vendor, redirect directly to Vendor HQ
    useEffect(() => {
        if (authInitialized && !isLoading && isLoggedIn && user?.type === 'vendor') {
            router.replace('/vendor/dashboard');
        }
    }, [authInitialized, isLoading, isLoggedIn, user?.type, router]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const trimmedEmail = email.trim().toLowerCase();
        if (!trimmedEmail) {
            setError('Please enter your vendor email address.');
            return;
        }
        if (!password) {
            setError('Please enter your password.');
            return;
        }

        setLoading(true);
        setError(null);

        try {
            // 1. Authenticate with Supabase Auth
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
                    setError(authError.message || 'Authentication failed. Please try again.');
                }
                return;
            }

            if (!data.user) {
                setError('No user returned from authentication.');
                return;
            }

            // 2. Fetch public.profiles where user_id = auth user id
            const { data: profile, error: profileError } = await supabase
                .from('profiles')
                .select('role, full_name')
                .eq('user_id', data.user.id)
                .maybeSingle();

            if (profileError) {
                console.error('[VendorLogin] Profile query error:', profileError);
            }

            // 3. Confirm profile.role = 'vendor'
            if (!profile || profile.role !== 'vendor') {
                await supabase.auth.signOut();
                setError('Access denied. This account does not have vendor privileges.');
                return;
            }

            // Refresh AppContext and navigate to Vendor HQ
            if (refreshProfile) {
                await refreshProfile();
            }
            router.push('/vendor/dashboard');
        } catch (err: any) {
            setError(err?.message || 'A network error occurred. Please try again.');
        } finally {
            setLoading(false);
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

                <div style={{ textAlign: 'center', marginBottom: '32px' }}>
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', background: 'var(--accent-muted)', color: 'var(--accent)', fontSize: '12px', fontWeight: '900', padding: '6px 16px', borderRadius: '100px', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                        <Store size={14} /> Partner Portal
                    </div>
                </div>

                <div className="fade-in">
                    <h1 style={{ fontSize: '28px', fontWeight: '900', letterSpacing: '-0.04em', marginBottom: '8px', textAlign: 'center' }}>Vendor Login</h1>
                    <p style={{ fontSize: '15px', color: 'var(--fg-muted)', marginBottom: '32px', textAlign: 'center' }}>Enter your registered vendor email and password to manage your print shop.</p>

                    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
                        <div>
                            <label className="input-label" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <Mail size={14} /> Vendor Email
                            </label>
                            <input
                                className="input"
                                type="email"
                                placeholder="vendor@example.com"
                                value={email}
                                onChange={(e) => {
                                    setEmail(e.target.value);
                                    setError(null);
                                }}
                                required
                                autoFocus
                                style={{ border: '2px solid var(--border)', borderRadius: '12px', padding: '14px 18px', fontSize: '15px', fontWeight: '700' }}
                            />
                        </div>

                        <div>
                            <label className="input-label" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <Lock size={14} /> Password
                            </label>
                            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                                <input
                                    className="input"
                                    type={showPassword ? 'text' : 'password'}
                                    placeholder="Enter your password"
                                    value={password}
                                    onChange={(e) => {
                                        setPassword(e.target.value);
                                        setError(null);
                                    }}
                                    required
                                    style={{ border: '2px solid var(--border)', borderRadius: '12px', padding: '14px 44px 14px 18px', fontSize: '15px', fontWeight: '700', width: '100%' }}
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(p => !p)}
                                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                                    style={{ position: 'absolute', right: '14px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg-muted)', display: 'flex', alignItems: 'center' }}
                                >
                                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                </button>
                            </div>
                        </div>

                        {error && (
                            <div style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', color: '#ef4444', padding: '12px 14px', borderRadius: '12px', fontSize: '13px', fontWeight: '600' }}>
                                {error}
                            </div>
                        )}

                        <button
                            type="submit"
                            className="btn btn-primary btn-full btn-lg"
                            disabled={loading || !email.trim() || !password}
                            style={{ borderRadius: '12px', padding: '16px', fontWeight: '800', marginTop: '4px' }}
                        >
                            {loading ? <><span className="spinner" />Authenticating...</> : <span style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'center' }}>Access Dashboard <ShieldCheck size={18} /></span>}
                        </button>

                        <p style={{ fontSize: '13px', color: 'var(--fg-muted)', textAlign: 'center', marginTop: '10px' }}>
                            New print shop? <Link href="/vendor/join" style={{ color: 'var(--fg)', fontWeight: '800' }}>Join as Vendor</Link>
                        </p>
                    </form>
                </div>
            </div>
        </div>
    );
}

'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
import { useApp } from '@/context/AppContext';
import { ShieldCheck, Lock, Mail, ArrowRight, Eye, EyeOff, AlertTriangle } from 'lucide-react';

function XADLoginForm() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const redirectParam = searchParams?.get('redirect');
    const destination = (redirectParam && redirectParam.startsWith('/')) ? redirectParam : '/admin/finance';

    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [checkingSession, setCheckingSession] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const { refreshProfile } = useApp();

    // Check if an admin session is already active
    useEffect(() => {
        let mounted = true;

        async function checkActiveSession() {
            try {
                const { data: { session } } = await supabase.auth.getSession();
                if (session?.user && mounted) {
                    const { data: profile } = await supabase
                        .from('profiles')
                        .select('role')
                        .eq('user_id', session.user.id)
                        .maybeSingle();

                    if (profile?.role === 'admin' && mounted) {
                        router.replace(destination);
                        return;
                    }
                }
            } catch (err) {
                console.error('[XADLogin] Session check error:', err);
            } finally {
                if (mounted) setCheckingSession(false);
            }
        }

        checkActiveSession();
        return () => { mounted = false; };
    }, [router, destination]);

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        const trimmedEmail = email.trim().toLowerCase();
        if (!trimmedEmail) {
            setError('Please enter your admin email address.');
            return;
        }
        if (!password) {
            setError('Please enter your admin password.');
            return;
        }

        setLoading(true);
        setError(null);

        try {
            // 1. Authoritative Supabase Auth Email + Password
            const { data, error: authError } = await supabase.auth.signInWithPassword({
                email: trimmedEmail,
                password,
            });

            if (authError) {
                if (authError.message.toLowerCase().includes('invalid login credentials')) {
                    setError('Invalid email or password. Please check your admin credentials.');
                } else if (authError.message.toLowerCase().includes('email not confirmed')) {
                    setError('Please confirm your email address before signing in.');
                } else {
                    setError(authError.message || 'Authentication failed. Please try again.');
                }
                setLoading(false);
                return;
            }

            if (!data.user) {
                setError('No user returned from authentication.');
                setLoading(false);
                return;
            }

            // 2. Query public.profiles where user_id = session.user.id
            const { data: profile, error: profileError } = await supabase
                .from('profiles')
                .select('id, user_id, role, full_name')
                .eq('user_id', data.user.id)
                .maybeSingle();

            if (profileError) {
                console.error('[XADLogin] Profile query error:', profileError);
            }

            // 3. Require profiles.role = 'admin'
            if (!profile || profile.role !== 'admin') {
                // Immediately sign out customer or vendor from admin login flow
                await supabase.auth.signOut();
                setError('Admin access required. Current account does not have admin privileges.');
                setLoading(false);
                return;
            }

            // Verified profile.role === 'admin': proceed to destination
            // Refresh AppContext profile if available
            if (refreshProfile) {
                await refreshProfile();
            }

            router.push(destination);
        } catch (err: any) {
            setError(err?.message || 'A network error occurred. Please try again.');
            setLoading(false);
        }
    };

    if (checkingSession) {
        return (
            <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-secondary)' }}>
                <span className="spinner spinner-lg" />
            </div>
        );
    }

    return (
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '32px 16px', background: 'var(--bg-secondary)' }}>
            <div className="card" style={{ width: '100%', maxWidth: '440px', padding: '36px 30px', borderRadius: '22px' }}>
                <div style={{ textAlign: 'center', marginBottom: '26px' }}>
                    <div style={{ width: '60px', height: '60px', borderRadius: '18px', background: 'var(--accent-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px', color: 'var(--accent)' }}>
                        <ShieldCheck size={30} />
                    </div>
                    <h1 style={{ fontSize: '28px', fontWeight: '900', letterSpacing: '-0.03em' }}>XAD Admin Login</h1>
                    <p style={{ fontSize: '14px', color: 'var(--fg-muted)', marginTop: '8px' }}>
                        Supabase authenticated access to XerService Finance & Administration
                    </p>
                </div>

                <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <div>
                        <label className="input-label">Admin Email</label>
                        <div style={{ position: 'relative' }}>
                            <Mail size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--fg-subtle)' }} />
                            <input
                                className="input"
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="admin@example.com"
                                style={{ paddingLeft: '36px' }}
                                required
                                autoFocus
                            />
                        </div>
                    </div>

                    <div>
                        <label className="input-label">Password</label>
                        <div style={{ position: 'relative' }}>
                            <Lock size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--fg-subtle)' }} />
                            <input
                                className="input"
                                type={showPassword ? 'text' : 'password'}
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="••••••••••••"
                                style={{ paddingLeft: '36px', paddingRight: '36px' }}
                                required
                            />
                            <button
                                type="button"
                                onClick={() => setShowPassword(!showPassword)}
                                style={{
                                    position: 'absolute',
                                    right: '12px',
                                    top: '50%',
                                    transform: 'translateY(-50%)',
                                    background: 'none',
                                    border: 'none',
                                    color: 'var(--fg-subtle)',
                                    cursor: 'pointer',
                                    padding: 0,
                                }}
                            >
                                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                            </button>
                        </div>
                    </div>

                    {error && (
                        <div style={{
                            fontSize: '13px',
                            color: '#ef4444',
                            padding: '12px 14px',
                            borderRadius: '10px',
                            border: '1px solid rgba(239, 68, 68, 0.3)',
                            background: 'rgba(239, 68, 68, 0.08)',
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: '8px',
                        }}>
                            <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
                            <span>{error}</span>
                        </div>
                    )}

                    <button
                        type="submit"
                        className="btn btn-accent btn-full"
                        style={{ marginTop: '6px', height: '46px', fontWeight: '800' }}
                        disabled={loading}
                    >
                        {loading ? (
                            <>
                                <span className="spinner" />
                                Authenticating...
                            </>
                        ) : (
                            <>
                                Access Admin Console <ArrowRight size={16} />
                            </>
                        )}
                    </button>
                </form>
            </div>
        </div>
    );
}

export default function XADLoginPage() {
    return (
        <Suspense fallback={
            <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-secondary)' }}>
                <span className="spinner spinner-lg" />
            </div>
        }>
            <XADLoginForm />
        </Suspense>
    );
}

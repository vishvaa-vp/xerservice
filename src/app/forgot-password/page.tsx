'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase, exchangeAuthCode, hasRecoverySession } from '@/lib/supabase/client';

export default function ForgotPasswordPage() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [step, setStep] = useState<'request' | 'checking' | 'sent' | 'password' | 'done'>('request');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    useEffect(() => {
        let active = true;
        const params = new URLSearchParams(window.location.search);
        const hash = new URLSearchParams(window.location.hash.slice(1));
        const { data: { subscription } } = supabase.auth.onAuthStateChange(event => {
            if (event === 'PASSWORD_RECOVERY' && active) setStep('password');
        });
        void supabase.auth.getSession().then(() => { if (active && hasRecoverySession()) setStep('password'); });
        const code = params.get('code');
        if (params.has('error') || hash.has('error')) setError('This recovery link is invalid or has expired. Request a new link.');
        if (code) {
            setStep('checking');
            void exchangeAuthCode(code).then(({ error }) => {
                if (!active) return;
                window.history.replaceState({}, '', '/forgot-password');
                if (error) { setError('This recovery link is invalid or has expired. Request a new link.'); setStep('request'); }
                else setStep('password');
            });
        } else if (hash.get('type') === 'recovery') {
            setStep('checking');
            void supabase.auth.getSession().then(({ data, error }) => {
                if (!active) return;
                if (error || !data.session) { setStep('request'); setError('This recovery link is invalid or has expired. Request a new link.'); }
                else setStep('password');
                window.history.replaceState({}, '', '/forgot-password');
            });
        }
        return () => { active = false; subscription.unsubscribe(); };
    }, []);
    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (busy) return;
        setError('');
        if (step === 'password' && (password.length < 8 || password !== confirm)) {
            setError(password.length < 8 ? 'Use at least 8 characters.' : 'The passwords do not match.'); return;
        }
        setBusy(true);
        try {
            if (step === 'password') {
                const { error } = await supabase.auth.updateUser({ password });
                if (error) throw error;
                await supabase.auth.signOut();
                setPassword(''); setConfirm(''); setStep('done');
            } else {
                const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/forgot-password` });
                if (error) throw error;
                setStep('sent');
            }
        } catch (error) { setError(error instanceof Error ? error.message : 'We couldn’t connect. Please try again.'); }
        finally { setBusy(false); }
    };
    return <section className="auth-page"><div className="card auth-card">
        <Link href="/login" className="auth-back">← Back to login</Link>
        <span className="account-state-mark">XS</span>
        <h1>{step === 'password' ? 'Choose a new password' : step === 'done' ? 'Password updated' : step === 'sent' ? 'Check your inbox' : 'Reset your password'}</h1>
        <p>{step === 'sent' ? 'If an account exists for this email, you’ll receive a secure recovery link. Check spam too.' : step === 'done' ? 'Your new password is saved. Sign in to continue.' : step === 'password' ? 'Use a password you haven’t used elsewhere.' : 'We’ll email you a secure link to get back into your account.'}</p>
        {error && <p className="form-feedback" role="alert">{error}</p>}
        {step === 'checking' ? <p role="status">Checking your recovery link…</p> : step === 'done' ? <Link href="/login" className="btn btn-accent btn-full">Sign in</Link> : step === 'sent' ? <button className="btn btn-outline btn-full" onClick={() => setStep('request')}>Try another email or request a new link</button> : <form onSubmit={submit} className="auth-form">
            {step === 'password' ? <><label>New password<input type="password" autoComplete="new-password" minLength={8} required value={password} onChange={e => setPassword(e.target.value)} /></label><label>Confirm password<input type="password" autoComplete="new-password" required value={confirm} onChange={e => setConfirm(e.target.value)} /></label></> : <label>Email address<input type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} /></label>}
            <button disabled={busy} className="btn btn-accent btn-full">{busy ? 'Please wait…' : step === 'password' ? 'Save new password' : 'Send recovery link'}</button>
        </form>}
    </div></section>;
}

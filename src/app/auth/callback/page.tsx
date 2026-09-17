'use client';

import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { customerDestination } from '@/lib/customer-navigation';
import { supabase, exchangeAuthCode, hasRecoverySession } from '@/lib/supabase/client';
import { useApp } from '@/context/AppContext';

function AuthCallbackContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { refreshProfile } = useApp();
    const [authDone, setAuthDone] = useState(false);

    useEffect(() => {
        let cancelled = false;
        const run = async () => {
            try {
                if (searchParams.has('error')) throw new Error('Sign-in was cancelled or the link expired. Please try again.');
                const code = searchParams.get('code');
                if (code) {
                    const { error } = await exchangeAuthCode(code);
                    if (error) throw error;
                }
                const { data: { session }, error } = await supabase.auth.getSession();
                if (error || !session) throw new Error('Your sign-in link has expired. Please sign in again.');
                await refreshProfile();
                if (!cancelled) router.replace(customerDestination(searchParams.get('redirect') || searchParams.get('next')));
            } catch (error) {
                if (!cancelled) router.replace(`/login?error=${encodeURIComponent(error instanceof Error ? error.message : 'Sign-in failed. Please try again.')}`);
            }
        };
        void run();
        return () => { cancelled = true; };
    }, [router, searchParams, refreshProfile]);

    return (
        <div style={{ minHeight: '80vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ textAlign: 'center', marginTop: '24px' }}>
                <span className="spinner spinner-lg" />
                <p style={{ marginTop: '16px', fontSize: '14px', color: 'var(--fg-muted)', fontWeight: '600' }}>
                    Signing you in securely...
                </p>
            </div>
        </div>
    );
}

export default function AuthCallbackPage() {
    return (
        <Suspense fallback={
            <div style={{ minHeight: '80vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                <span className="spinner spinner-lg" />
                <p style={{ marginTop: '16px', fontSize: '14px', color: 'var(--fg-muted)', fontWeight: '600' }}>
                    Signing you in securely...
                </p>
            </div>
        }>
            <AuthCallbackContent />
        </Suspense>
    );
}

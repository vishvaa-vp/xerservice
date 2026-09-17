'use client';

import { useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

function SignupRedirect() {
    const router = useRouter();
    const searchParams = useSearchParams();

    useEffect(() => {
        const params = new URLSearchParams(searchParams.toString());
        params.set('mode', 'signup');
        router.replace(`/login?${params.toString()}`);
    }, [router, searchParams]);

    return (
        <div style={{ minHeight: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span className="spinner spinner-lg" />
        </div>
    );
}

export default function SignupPage() {
    return (
        <Suspense fallback={<div style={{ minHeight: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><span className="spinner spinner-lg" /></div>}>
            <SignupRedirect />
        </Suspense>
    );
}

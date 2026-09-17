'use client';

import { useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useApp } from '@/context/AppContext';

function MethodRedirectContent() {
    const { setCurrentOrder, isLoggedIn, isLoading, authInitialized } = useApp();
    const router = useRouter();
    const searchParams = useSearchParams();
    const orderParam = searchParams.get('order');

    useEffect(() => {
        if (!authInitialized || isLoading) return;
        setCurrentOrder(prev => ({ ...prev, method: 'instant', scheduledTime: '' }));
        const paymentUrl = orderParam ? `/order/pricing?order=${orderParam}` : '/order/pricing';
        router.replace(isLoggedIn ? paymentUrl : `/login?redirect=${encodeURIComponent(paymentUrl)}`);
    }, [isLoggedIn, isLoading, authInitialized, router, setCurrentOrder, orderParam]);

    return (
        <div style={{ minHeight: '70vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span className="spinner spinner-lg" />
        </div>
    );
}

export default function MethodRedirectPage() {
    return (
        <Suspense fallback={
            <div style={{ minHeight: '70vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span className="spinner spinner-lg" />
            </div>
        }>
            <MethodRedirectContent />
        </Suspense>
    );
}

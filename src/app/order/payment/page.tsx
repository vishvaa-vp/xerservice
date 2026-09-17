'use client';

import { useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

/**
 * Backward-Compatibility Redirect
 * Customer checkout review and payment are now combined into ONE unified "Review & Pay" page
 * on /order/pricing. This route redirects any legacy external links or bookmarks cleanly.
 */
function PaymentRedirectContent() {
    const router = useRouter();
    const searchParams = useSearchParams();

    useEffect(() => {
        const orderId = searchParams.get('order');
        const targetUrl = orderId ? `/order/pricing?order=${encodeURIComponent(orderId)}` : '/order/pricing';
        router.replace(targetUrl);
    }, [router, searchParams]);

    return (
        <div style={{ minHeight: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span className="spinner spinner-lg" />
        </div>
    );
}

export default function PaymentPage() {
    return (
        <Suspense fallback={
            <div style={{ minHeight: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span className="spinner spinner-lg" />
            </div>
        }>
            <PaymentRedirectContent />
        </Suspense>
    );
}

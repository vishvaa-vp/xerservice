'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function AdminAddonsRedirect() {
    const router = useRouter();

    useEffect(() => {
        router.replace('/admin/vendors');
    }, [router]);

    return (
        <div style={{ minHeight: '60vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px' }}>
            <span className="spinner spinner-lg" />
            <p style={{ color: 'var(--fg-muted)', fontSize: '14px' }}>Redirecting to Vendors & Shops…</p>
        </div>
    );
}

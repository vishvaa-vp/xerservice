'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function AdminVendorsRedirectPage() {
    const router = useRouter();

    useEffect(() => {
        router.replace('/admin/users?role=vendor');
    }, [router]);

    return (
        <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span className="spinner spinner-lg" />
        </div>
    );
}

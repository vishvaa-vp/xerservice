'use client';

import { useEffect, Suspense } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Store, ListOrdered, BarChart3 } from 'lucide-react';

function MobileNavigationInner() {
    const pathname = usePathname();
    const params = useSearchParams();

    if (pathname.includes('/login')) return null;

    const tabs = [
        {
            label: 'Queue',
            href: '/vendor/dashboard?tab=queue',
            Icon: ListOrdered,
            active: pathname === '/vendor/dashboard' && params.get('tab') !== 'overview' && params.get('tab') !== 'store',
        },
        {
            label: 'Overview',
            href: '/vendor/dashboard?tab=overview',
            Icon: BarChart3,
            active: params.get('tab') === 'overview',
        },
        {
            label: 'Store',
            href: '/vendor/dashboard?tab=store#store-controls',
            Icon: Store,
            active: params.get('tab') === 'store',
        },
    ];

    return (
        <nav className="mobile-bottom-nav vendor" aria-label="Vendor Mobile navigation">
            {tabs.map(({ label, href, Icon, active }) => (
                <Link key={label} href={href} aria-current={active ? 'page' : undefined}>
                    <Icon size={21} />
                    <span>{label}</span>
                </Link>
            ))}
        </nav>
    );
}

export default function MobileNavigation() {
    return (
        <Suspense fallback={null}>
            <MobileNavigationInner />
        </Suspense>
    );
}

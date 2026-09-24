'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { FileText, Wallet, User, MessageCircle, Store } from 'lucide-react';
import { useApp } from '@/context/AppContext';

function MobileNavigationInner() {
    const { user } = useApp();
    const pathname = usePathname();

    const authHref = (target: string) => user ? target : `/login?redirect=${encodeURIComponent(target)}`;

    const tabs = [
        { label: 'WA Files', href: authHref('/dashboard/whatsapp'), Icon: MessageCircle, active: pathname === '/dashboard/whatsapp', isProfile: false, isPrintAction: false },
        { label: 'Orders', href: authHref('/dashboard/orders'), Icon: FileText, active: pathname === '/dashboard/orders', isProfile: false, isPrintAction: false },
        { label: 'Shops', href: '/', Icon: Store, active: pathname === '/', isProfile: false, isPrintAction: true },
        { label: 'Wallet', href: authHref('/dashboard/wallet'), Icon: Wallet, active: pathname === '/dashboard/wallet', isProfile: false, isPrintAction: false },
        { label: 'Profile', href: authHref('/dashboard/profile'), Icon: User, active: pathname === '/dashboard/profile', isProfile: true, isPrintAction: false },
    ];

    if (pathname.startsWith('/vendor') || pathname.startsWith('/auth') || pathname === '/signup' || (user && user.type !== 'customer') || pathname.startsWith('/admin') || pathname.startsWith('/xad') || pathname.includes('/login') || pathname === '/forgot-password') return null;

    return (
        <nav className="mobile-bottom-nav" aria-label="Mobile navigation">
            {tabs.map(({ label, href, Icon, active, isProfile, isPrintAction }) => {
                if (isPrintAction) {
                    return (
                        <Link
                            key={label}
                            href={href}
                            className="mobile-print-action"
                            aria-label={label}
                            aria-current={active ? 'page' : undefined}
                        >
                            <span className="mobile-print-icon"><Icon size={20} /></span>
                            <span className="mobile-print-label">{label}</span>
                        </Link>
                    );
                }

                return (
                    <Link key={label} href={href} aria-current={active ? 'page' : undefined}>
                        <span className="mobile-tab-icon" aria-hidden="true">
                        {isProfile && user ? (
                            user.avatarUrl ? (
                                <img
                                    src={user.avatarUrl}
                                    alt=""
                                    style={{ width: '22px', height: '22px', borderRadius: '50%', objectFit: 'cover' }}
                                />
                            ) : (
                                <span style={{
                                    width: '22px',
                                    height: '22px',
                                    borderRadius: '50%',
                                    background: 'var(--accent)',
                                    color: 'var(--accent-fg)',
                                    fontSize: '11px',
                                    fontWeight: '800',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                }}>
                                    {user.name ? user.name[0].toUpperCase() : 'U'}
                                </span>
                            )
                        ) : (
                            <Icon size={21} />
                        )}
                        </span>
                        <span>{label}</span>
                    </Link>
                );
            })}
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

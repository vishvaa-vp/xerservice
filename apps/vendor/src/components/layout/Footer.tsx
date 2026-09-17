'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useApp } from '@/context/AppContext';

export default function Footer() {
    const { theme } = useApp();
    const pathname = usePathname();

    if (pathname && pathname.includes('/login')) {
        return null;
    }

    const links = [
        {
            group: 'Vendor Operations',
            items: [
                { href: '/vendor/dashboard?tab=queue', label: 'Print Queue' },
                { href: '/vendor/dashboard?tab=overview', label: 'Analytics' },
                { href: '/vendor/dashboard?tab=store#store-controls', label: 'Store Settings' },
            ],
        },
        {
            group: 'Partner Portal',
            items: [
                { href: '/vendor/join', label: 'Join Network' },
                { href: '/vendor/login', label: 'Vendor Login' },
            ],
        },
    ];

    return (
        <footer style={{ borderTop: '1px solid var(--border)', background: 'var(--bg-secondary)', padding: '28px 0 16px' }}>
            <div className="container">
                <div style={{ display: 'grid', gridTemplateColumns: '2fr repeat(2, 1fr)', gap: '24px', marginBottom: '20px' }}>
                    {/* Brand */}
                    <div>
                        <Link href="/vendor/dashboard" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                            <img src={theme === 'light' ? '/logo-black.png' : '/logo-white.png'} alt="XerService Logo" style={{ width: '22px', height: '22px', objectFit: 'contain' }} />
                            <span style={{ fontSize: '14px', fontWeight: '800', letterSpacing: '-0.04em' }}>xerservice</span>
                            <span style={{ fontSize: '10px', fontWeight: '800', textTransform: 'uppercase', padding: '1px 6px', borderRadius: '4px', background: 'var(--bg)', color: 'var(--accent)', border: '1px solid var(--border)' }}>Vendor</span>
                        </Link>
                        <p style={{ fontSize: '12px', color: 'var(--fg-muted)', lineHeight: '1.6', maxWidth: '240px' }}>
                            Empowering local print shops with instant digital order fulfillment.
                        </p>
                    </div>

                    {/* Link groups */}
                    {links.map(group => (
                        <div key={group.group}>
                            <p style={{ fontSize: '11px', fontWeight: '700', color: 'var(--fg-subtle)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '10px' }}>{group.group}</p>
                            {group.items.map(item => (
                                <Link key={item.href} href={item.href} style={{ display: 'block', fontSize: '13px', color: 'var(--fg-muted)', marginBottom: '7px', transition: 'color 0.2s' }}
                                    onMouseEnter={e => (e.currentTarget.style.color = 'var(--fg)')}
                                    onMouseLeave={e => (e.currentTarget.style.color = 'var(--fg-muted)')}>
                                    {item.label}
                                </Link>
                            ))}
                        </div>
                    ))}
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border)', paddingTop: '14px', flexWrap: 'wrap', gap: '6px' }}>
                    <p style={{ fontSize: '12px', color: 'var(--fg-subtle)' }}>&copy; 2026 XerService. All rights reserved.</p>
                </div>
            </div>

            <style>{`
                @media (max-width: 600px) {
                    footer > div > div:first-child {
                        grid-template-columns: 1fr 1fr !important;
                    }
                }
                @media (max-width: 400px) {
                    footer > div > div:first-child {
                        grid-template-columns: 1fr !important;
                    }
                }
            `}</style>
        </footer>
    );
}

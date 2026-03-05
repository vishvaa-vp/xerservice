'use client';

import Link from 'next/link';
import { useApp } from '@/context/AppContext';

export default function Footer() {
    const { theme } = useApp();
    const links = [
        { group: 'Platform', items: [{ href: '/shops', label: 'Find Shops' }, { href: '/how-it-works', label: 'How It Works' }, { href: '/community', label: 'Community' }] },
        { group: 'Company', items: [{ href: '/about', label: 'About Us' }, { href: '/contact', label: 'Contact' }] },
        { group: 'Vendor', items: [{ href: '/vendor/login', label: 'Partner Login' }, { href: '/vendor/join', label: 'Join as Vendor' }, { href: '/vendor/subscription', label: 'Pricing Plans' }] },
    ];

    return (
        <footer style={{ borderTop: '1px solid var(--border)', background: 'var(--bg-secondary)', padding: '56px 0 32px' }}>
            <div className="container">
                <div style={{ display: 'grid', gridTemplateColumns: '2fr repeat(3, 1fr)', gap: '48px', marginBottom: '48px' }}>
                    {/* Brand */}
                    <div>
                        <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                            <img src={theme === 'light' ? '/logo-black.png' : '/logo-white.png'} alt="XerService Logo" style={{ width: '26px', height: '26px', objectFit: 'contain' }} />
                            <span style={{ fontSize: '16px', fontWeight: '800', letterSpacing: '-0.04em' }}>xerservice</span>
                        </Link>
                        <p style={{ fontSize: '14px', color: 'var(--fg-muted)', lineHeight: '1.7', maxWidth: '240px' }}>
                            The Future of Local Printing.
                        </p>
                    </div>

                    {/* Link groups */}
                    {links.map(group => (
                        <div key={group.group}>
                            <p style={{ fontSize: '12px', fontWeight: '700', color: 'var(--fg-subtle)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '16px' }}>{group.group}</p>
                            {group.items.map(item => (
                                <Link key={item.href} href={item.href} style={{ display: 'block', fontSize: '14px', color: 'var(--fg-muted)', marginBottom: '10px', transition: 'color 0.2s' }}
                                    onMouseEnter={e => (e.currentTarget.style.color = 'var(--fg)')}
                                    onMouseLeave={e => (e.currentTarget.style.color = 'var(--fg-muted)')}>
                                    {item.label}
                                </Link>
                            ))}
                        </div>
                    ))}
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border)', paddingTop: '24px' }}>
                    <p style={{ fontSize: '13px', color: 'var(--fg-subtle)' }}>&copy; 2025 xerservice. All rights reserved.</p>
                    <p style={{ fontSize: '13px', color: 'var(--fg-subtle)' }}>Tamil Nadu Product</p>
                </div>
            </div>

            <style>{`
        @media (max-width: 768px) {
          footer > div > div:first-child { grid-template-columns: 1fr 1fr !important; }
        }
      `}</style>
        </footer>
    );
}

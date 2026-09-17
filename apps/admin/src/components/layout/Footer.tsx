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

    return (
        <footer style={{ borderTop: '1px solid var(--border)', background: 'var(--bg-secondary)', padding: '24px 0 16px', marginTop: 'auto' }}>
            <div className="container">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <img src={theme === 'light' ? '/logo-black.png' : '/logo-white.png'} alt="XerService Logo" style={{ width: '20px', height: '20px', objectFit: 'contain' }} />
                        <span style={{ fontSize: '13px', fontWeight: '800', letterSpacing: '-0.04em' }}>xerservice</span>
                        <span style={{ fontSize: '10px', fontWeight: '800', textTransform: 'uppercase', padding: '1px 6px', borderRadius: '4px', background: 'var(--bg)', color: 'var(--accent)', border: '1px solid var(--border)' }}>Admin Console</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                        <Link href="/admin/users" style={{ fontSize: '12px', color: 'var(--fg-muted)', textDecoration: 'none' }}>Users & Vendors</Link>
                        <Link href="/admin/finance" style={{ fontSize: '12px', color: 'var(--fg-muted)', textDecoration: 'none' }}>Finance</Link>
                        <Link href="/admin/addons" style={{ fontSize: '12px', color: 'var(--fg-muted)', textDecoration: 'none' }}>Add-ons</Link>
                        <Link href="/xad/dashboard" style={{ fontSize: '12px', color: 'var(--fg-muted)', textDecoration: 'none' }}>Overview</Link>
                    </div>
                    <p style={{ fontSize: '12px', color: 'var(--fg-subtle)', margin: 0 }}>&copy; 2026 XerService Operations & Platform Security.</p>
                </div>
            </div>
        </footer>
    );
}

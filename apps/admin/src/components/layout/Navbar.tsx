'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useApp } from '@/context/AppContext';
import { Moon, Sun, LogOut, LayoutDashboard, Store, Users, Landmark, Layers } from 'lucide-react';
import ConfirmDialog from '@/components/ui/ConfirmDialog';

export default function Navbar() {
    const { logout, theme, toggleTheme } = useApp();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const [showLogout, setShowLogout] = useState(false);

    if (pathname && pathname.includes('/login')) {
        return null;
    }

    const confirmLogout = () => {
        logout();
        setShowLogout(false);
    };

    const financeView = searchParams.get('view');
    const adminItems = [
        { label: 'Dashboard', href: '/xad/dashboard', icon: LayoutDashboard, active: pathname.startsWith('/xad/dashboard') },
        { label: 'Shops', href: '/admin/finance?view=shops', icon: Store, active: pathname.startsWith('/admin/finance') && financeView === 'shops' },
        { label: 'People', href: '/admin/users', icon: Users, active: pathname.startsWith('/admin/users') || pathname.startsWith('/admin/vendors') },
        { label: 'Payments', href: '/admin/finance?view=summary', icon: Landmark, active: pathname.startsWith('/admin/finance') && financeView !== 'shops' },
        { label: 'Shop services', href: '/admin/addons', icon: Layers, active: pathname.startsWith('/admin/addons') },
    ];

    return (
        <>
            <nav style={{ position: 'sticky', top: 0, zIndex: 100, background: 'var(--bg-glass)', borderBottom: '1px solid var(--border)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)' }}>
                <div className="container nav-shell admin-nav-shell" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: '64px', gap: '12px', flexWrap: 'wrap', paddingBlock: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                        <Link href="/admin/finance" style={{ display: 'flex', alignItems: 'center', gap: '8px', textDecoration: 'none', flexShrink: 0 }}>
                            <img src={theme === 'light' ? '/logo-black.png' : '/logo-white.png'} alt="XerService Logo" style={{ width: '32px', height: '32px', objectFit: 'contain' }} />
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span className="nav-logo-text" style={{ fontSize: '20px', fontWeight: '800', letterSpacing: '-0.04em', color: 'var(--fg)' }}>xerservice</span>
                                <span style={{ fontSize: '11px', fontWeight: '800', textTransform: 'uppercase', padding: '2px 8px', borderRadius: '4px', background: 'var(--bg-secondary)', color: 'var(--fg-muted)', border: '1px solid var(--border)' }}>Admin</span>
                            </div>
                        </Link>
                    </div>
                    <div className="admin-primary-nav" role="navigation" aria-label="Admin navigation" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', flex: '1 1 480px', overflowX: 'auto' }}>
                        {adminItems.map(item => {
                            const Icon = item.icon;
                            return <Link key={item.href} href={item.href} aria-current={item.active ? 'page' : undefined} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', minHeight: '40px', padding: '8px 11px', borderRadius: '9px', fontSize: '12.5px', fontWeight: item.active ? '800' : '650', color: item.active ? 'var(--accent)' : 'var(--fg-muted)', background: item.active ? 'var(--accent-muted)' : 'transparent', textDecoration: 'none', whiteSpace: 'nowrap' }}><Icon size={15} />{item.label}</Link>;
                        })}
                    </div>
                    <div className="nav-controls" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <button onClick={toggleTheme} className="btn btn-ghost" style={{ padding: '8px', minWidth: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center' }} aria-label="Toggle theme">
                            {theme === 'light' ? <Moon size={20} /> : <Sun size={20} />}
                        </button>
                        <button
                            onClick={() => setShowLogout(true)}
                            className="btn btn-outline btn-sm"
                            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: '700', padding: '6px 12px' }}
                        >
                            <LogOut size={13} /> <span>Sign Out</span>
                        </button>
                    </div>
                </div>
            </nav>
            <ConfirmDialog
                open={showLogout}
                title="Log out of Admin Console?"
                message="Your admin session will be closed on this device."
                confirmLabel="Log Out"
                destructive
                onConfirm={confirmLogout}
                onCancel={() => setShowLogout(false)}
            />
        </>
    );
}

'use client';

import Link from 'next/link';
import { useApp } from '@/context/AppContext';
import { Moon, Sun, User as UserIcon, LogOut, Coins, FileText } from 'lucide-react';

export default function Navbar() {
    const { isLoggedIn, user, logout, theme, toggleTheme } = useApp();

    const navLinks = [
        { href: '/shops', label: 'Find Shops' },
        { href: '/how-it-works', label: 'How It Works' },
        { href: '/about', label: 'About' },
    ];

    return (
        <nav style={{ position: 'sticky', top: 0, zIndex: 100, background: 'var(--bg-glass)', borderBottom: '1px solid var(--border)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)' }}>
            <div className="container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: '64px' }}>
                {/* Logo */}
                <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: '8px', textDecoration: 'none', flexShrink: 0 }}>
                    <img src={theme === 'light' ? '/logo-black.png' : '/logo-white.png'} alt="XerService Logo" style={{ width: '32px', height: '32px', objectFit: 'contain' }} />
                    <span className="nav-logo-text" style={{ fontSize: '20px', fontWeight: '800', letterSpacing: '-0.04em', color: 'var(--fg)' }}>xerservice</span>
                </Link>

                {/* Nav Links */}
                <div className="nav-links-wrap" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    {navLinks.map(l => (
                        <Link key={l.href} href={l.href} className="btn btn-ghost" style={{ fontSize: '14px' }}>{l.label}</Link>
                    ))}
                </div>

                {/* Auth Controls */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                    <button onClick={toggleTheme} className="btn btn-ghost" style={{ padding: '8px', minWidth: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center' }} aria-label="Toggle theme">
                        {theme === 'light' ? <Moon size={20} /> : <Sun size={20} />}
                    </button>
                    <div style={{ width: '1px', height: '24px', background: 'var(--border)', margin: '0 4px' }} />

                    {isLoggedIn ? (
                        <>
                            {user?.type !== 'vendor' && (
                                <>
                                    <Link href="/dashboard/wallet" style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--accent)', fontWeight: '700', fontSize: '12px', textDecoration: 'none', background: 'var(--accent-muted)', padding: '6px 12px', borderRadius: '100px', border: '1px solid var(--accent-border)' }}>
                                        <Coins size={14} /> <span className="nav-auth-text">Wallet</span>
                                    </Link>
                                    <Link href="/dashboard/orders" style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--fg)', fontWeight: '700', fontSize: '12px', textDecoration: 'none', background: 'var(--bg-secondary)', padding: '6px 12px', borderRadius: '100px', border: '1px solid var(--border)' }}>
                                        <FileText size={14} /> <span className="nav-auth-text">Orders</span>
                                    </Link>
                                </>
                            )}
                            <Link href={user?.type === 'vendor' ? '/vendor/dashboard' : '/dashboard'}
                                style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '6px 14px', background: 'var(--bg)', borderRadius: 'var(--radius)', border: '1.5px solid var(--border)', textDecoration: 'none', transition: 'all 0.2s' }}
                            >
                                <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: 'linear-gradient(135deg, var(--accent), #f59e0b)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: 'var(--shadow-sm)', overflow: 'hidden' }}>
                                    {user?.avatarUrl ? (
                                        <img src={user.avatarUrl} alt={user.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                    ) : (
                                        <span style={{ color: 'white', fontSize: '13px', fontWeight: '900' }}>{user?.name?.[0] || 'U'}</span>
                                    )}
                                </div>
                                <span className="nav-auth-text" style={{ fontSize: '13px', fontWeight: '800', color: 'var(--fg)' }}>
                                    {user?.type === 'vendor' ? 'Vendor HQ' : user?.name || 'User'}
                                </span>
                            </Link>
                            <button onClick={logout} className="btn btn-ghost btn-sm" style={{ color: 'var(--fg-muted)', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <LogOut size={16} />
                            </button>
                        </>
                    ) : (
                        <>
                            <Link href="/vendor/login" className="btn btn-ghost nav-auth-text" style={{ fontSize: '13px', fontWeight: '600' }}>Partner Login</Link>
                            <Link href="/login" className="btn" style={{ padding: '8px 24px', background: 'var(--fg)', color: 'var(--bg)', borderRadius: 'var(--radius-sm)', fontWeight: '700', fontSize: '13px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>Log in</Link>
                        </>
                    )}
                </div>
            </div>

            <style>{`
                @media (max-width: 768px) {
                    .nav-links-wrap { gap: 0 !important; }
                    .nav-links-wrap .btn { font-size: 12px !important; padding: 6px 8px !important; }
                    .nav-logo-text { font-size: 16px !important; }
                    .nav-auth-text { display: none !important; }
                }
                @media (max-width: 480px) {
                    .nav-links-wrap { display: none !important; }
                }
            `}</style>
        </nav>
    );
}

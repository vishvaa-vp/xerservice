'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useApp } from '@/context/AppContext';
import { Moon, Sun, LogOut, Coins, ShoppingCart, ChevronDown, User, FileText } from 'lucide-react';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import NotificationBell from '@/components/notifications/NotificationBell';

export default function Navbar() {
    const { isLoggedIn, user, logout, theme, toggleTheme, cart } = useApp();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const [showLogout, setShowLogout] = useState(false);
    const [showProfileMenu, setShowProfileMenu] = useState(false);
    const profileMenuRef = useRef<HTMLDivElement>(null);

    const isAdminRoute = pathname.startsWith('/admin') || pathname.startsWith('/xad');

    const confirmLogout = () => {
        logout();
        setShowLogout(false);
        setShowProfileMenu(false);
    };

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (profileMenuRef.current && !profileMenuRef.current.contains(event.target as Node)) {
                setShowProfileMenu(false);
            }
        }
        if (showProfileMenu) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [showProfileMenu]);

    // Dedicated Admin Console Navigation
    if (isAdminRoute) {
        return (
            <>
            <nav
                className="admin-nav-root"
                role="navigation"
                aria-label="Admin navigation"
                style={{ position: 'sticky', top: 0, zIndex: 100, background: 'var(--bg-glass)', borderBottom: '1px solid var(--border)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)' }}
            >
                <div className="container nav-shell admin-nav-shell" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: '64px', gap: '12px', paddingBlock: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                        <Link href="/admin/dashboard" style={{ display: 'flex', alignItems: 'center', gap: '8px', textDecoration: 'none', flexShrink: 0 }}>
                            <img src={theme === 'light' ? '/logo-black.png' : '/logo-white.png'} alt="XerService Logo" style={{ width: '32px', height: '32px', objectFit: 'contain' }} />
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span className="nav-logo-text" style={{ fontSize: '20px', fontWeight: '800', letterSpacing: '-0.04em', color: 'var(--fg)' }}>xerservice</span>
                                <span style={{ fontSize: '11px', fontWeight: '800', textTransform: 'uppercase', padding: '2px 8px', borderRadius: '4px', background: 'var(--bg-secondary)', color: 'var(--fg-muted)', border: '1px solid var(--border)' }}>Admin</span>
                            </div>
                        </Link>
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

    return (
        <>
        <nav style={{ position: 'sticky', top: 0, zIndex: 100, background: 'var(--bg-glass)', borderBottom: '1px solid var(--border)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)' }}>
            <div className="container nav-shell" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: '64px', gap: '12px' }}>
                {/* Logo */}
                <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: '8px', textDecoration: 'none', flexShrink: 0 }}>
                    <img src={theme === 'light' ? '/logo-black.png' : '/logo-white.png'} alt="XerService Logo" style={{ width: '32px', height: '32px', objectFit: 'contain' }} />
                    <span className="nav-logo-text" style={{ fontSize: '20px', fontWeight: '800', letterSpacing: '-0.04em', color: 'var(--fg)' }}>xerservice</span>
                </Link>

                {/* Auth Controls */}
                <div className="nav-controls" style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <button onClick={toggleTheme} className="btn btn-ghost" style={{ padding: '8px', minWidth: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center' }} aria-label="Toggle theme">
                        <span style={{ display: 'inline-flex', transform: theme === 'light' ? 'rotate(0deg)' : 'rotate(360deg)', transition: 'transform 0.45s cubic-bezier(0.34, 1.56, 0.64, 1)' }}>
                            {theme === 'light' ? <Moon size={20} /> : <Sun size={20} />}
                        </span>
                    </button>
                    <div style={{ width: '1px', height: '24px', background: 'var(--border)', margin: '0 4px' }} />

                    {isLoggedIn ? (
                        <>
                            <NotificationBell />

                            {/* Mobile Cart Icon next to Notification */}
                            <Link
                                href="/cart"
                                className="mobile-cart-btn btn btn-ghost"
                                style={{ padding: '8px', minWidth: '40px', position: 'relative', display: 'none', alignItems: 'center', justifyContent: 'center' }}
                                aria-label={`Cart (${cart.length})`}
                            >
                                <ShoppingCart size={20} />
                                {cart.length > 0 && (
                                    <span style={{
                                        position: 'absolute',
                                        top: '4px',
                                        right: '4px',
                                        minWidth: '16px',
                                        height: '16px',
                                        padding: '0 4px',
                                        borderRadius: '999px',
                                        background: 'var(--accent)',
                                        color: '#fff',
                                        fontSize: '10px',
                                        fontWeight: '800',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                    }}>
                                        {cart.length}
                                    </span>
                                )}
                            </Link>

                            {/* Desktop Profile Dropdown (Hidden on mobile as bottom nav has Profile) */}
                            <div ref={profileMenuRef} className="desktop-profile-dropdown" style={{ position: 'relative' }}>
                                <button
                                    onClick={() => setShowProfileMenu((prev) => !prev)}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '8px',
                                        padding: '5px 12px 5px 6px',
                                        background: showProfileMenu ? 'var(--bg-secondary)' : 'var(--bg)',
                                        borderRadius: 'var(--radius)',
                                        border: '1.5px solid var(--border)',
                                        cursor: 'pointer',
                                        color: 'var(--fg)',
                                        transition: 'all 0.2s',
                                    }}
                                    aria-expanded={showProfileMenu}
                                    aria-haspopup="true"
                                >
                                    <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: 'linear-gradient(135deg, var(--accent), #3b82f6)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: 'var(--shadow-sm)', overflow: 'hidden' }}>
                                        {user?.avatarUrl ? (
                                            <img src={user.avatarUrl} alt={user.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                        ) : (
                                            <span style={{ color: 'white', fontSize: '13px', fontWeight: '900' }}>{user?.name?.[0] || 'U'}</span>
                                        )}
                                    </div>
                                    <span className="nav-auth-text" style={{ fontSize: '13px', fontWeight: '800', color: 'var(--fg)' }}>
                                        {user?.name || 'Profile'}
                                    </span>
                                    <ChevronDown
                                        size={14}
                                        style={{
                                            transition: 'transform 0.2s',
                                            transform: showProfileMenu ? 'rotate(180deg)' : 'rotate(0deg)',
                                            color: 'var(--fg-muted)',
                                        }}
                                    />
                                </button>

                                {showProfileMenu && (
                                    <div
                                        style={{
                                            position: 'absolute',
                                            top: 'calc(100% + 8px)',
                                            right: 0,
                                            width: '210px',
                                            background: 'var(--bg)',
                                            border: '1px solid var(--border)',
                                            borderRadius: '16px',
                                            boxShadow: '0 12px 36px rgba(0,0,0,0.18)',
                                            padding: '8px',
                                            zIndex: 1000,
                                            display: 'flex',
                                            flexDirection: 'column',
                                            gap: '2px',
                                        }}
                                    >
                                        <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', marginBottom: '4px' }}>
                                            <div style={{ fontSize: '13px', fontWeight: '800', color: 'var(--fg)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                {user?.name || 'User'}
                                            </div>
                                            <div style={{ fontSize: '11px', color: 'var(--fg-muted)' }}>
                                                +91 {user?.mobile}
                                            </div>
                                        </div>

                                        {user?.type !== 'vendor' && (
                                            <Link
                                                href="/dashboard/orders"
                                                onClick={() => setShowProfileMenu(false)}
                                                style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '10px',
                                                    padding: '10px 12px',
                                                    borderRadius: '10px',
                                                    textDecoration: 'none',
                                                    color: 'var(--fg)',
                                                    fontSize: '13px',
                                                    fontWeight: '700',
                                                    transition: 'background 0.15s',
                                                }}
                                                className="dropdown-item"
                                            >
                                                <FileText size={16} color="var(--accent)" />
                                                <span>Order History</span>
                                            </Link>
                                        )}

                                        {user?.type !== 'vendor' && (
                                            <Link
                                                href="/dashboard/profile"
                                                onClick={() => setShowProfileMenu(false)}
                                                style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '10px',
                                                    padding: '10px 12px',
                                                    borderRadius: '10px',
                                                    textDecoration: 'none',
                                                    color: 'var(--fg)',
                                                    fontSize: '13px',
                                                    fontWeight: '600',
                                                    transition: 'background 0.15s',
                                                }}
                                                className="dropdown-item"
                                            >
                                                <User size={16} color="var(--fg-muted)" />
                                                <span>Profile Settings</span>
                                            </Link>
                                        )}

                                        {user?.type !== 'vendor' && (
                                            <>
                                                <Link
                                                    href="/dashboard/wallet"
                                                    onClick={() => setShowProfileMenu(false)}
                                                    style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '10px',
                                                        padding: '10px 12px',
                                                        borderRadius: '10px',
                                                        textDecoration: 'none',
                                                        color: 'var(--fg)',
                                                        fontSize: '13px',
                                                        fontWeight: '600',
                                                        transition: 'background 0.15s',
                                                    }}
                                                    className="dropdown-item"
                                                >
                                                    <Coins size={16} color="var(--fg-muted)" />
                                                    <span>Wallet (Rs {user?.xerCoins || 0})</span>
                                                </Link>

                                                <Link
                                                    href="/cart"
                                                    onClick={() => setShowProfileMenu(false)}
                                                    style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '10px',
                                                        padding: '10px 12px',
                                                        borderRadius: '10px',
                                                        textDecoration: 'none',
                                                        color: 'var(--fg)',
                                                        fontSize: '13px',
                                                        fontWeight: '600',
                                                        transition: 'background 0.15s',
                                                    }}
                                                    className="dropdown-item"
                                                >
                                                    <ShoppingCart size={16} color="var(--fg-muted)" />
                                                    <span>Cart ({cart.length})</span>
                                                </Link>
                                            </>
                                        )}

                                        <div style={{ height: '1px', background: 'var(--border)', margin: '4px 0' }} />

                                        <button
                                            onClick={() => {
                                                setShowProfileMenu(false);
                                                setShowLogout(true);
                                            }}
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '10px',
                                                padding: '10px 12px',
                                                borderRadius: '10px',
                                                border: 'none',
                                                background: 'transparent',
                                                color: '#ef4444',
                                                fontSize: '13px',
                                                fontWeight: '700',
                                                cursor: 'pointer',
                                                textAlign: 'left',
                                                width: '100%',
                                                transition: 'background 0.15s',
                                            }}
                                            className="dropdown-item dropdown-item-danger"
                                        >
                                            <LogOut size={16} color="#ef4444" />
                                            <span>Log Out</span>
                                        </button>
                                    </div>
                                )}
                            </div>
                        </>
                    ) : (
                        <>

                            <Link href="/login" className="btn nav-customer-login" style={{ padding: '8px 24px', background: 'var(--fg)', color: 'var(--bg)', borderRadius: 'var(--radius-sm)', fontWeight: '700', fontSize: '13px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>Log in</Link>
                        </>
                    )}
                </div>
            </div>

            <style>{`
                .dropdown-item:hover { background: var(--bg-secondary); }
                .dropdown-item-danger:hover { background: rgba(239, 68, 68, 0.08) !important; }
                @media (max-width: 768px) {
                    .nav-shell { padding-top: 8px !important; padding-bottom: 8px !important; }
                    .nav-logo-text { font-size: 16px !important; }
                    .nav-auth-text { display: none !important; }
                    .nav-vendor-login { padding: 8px 10px !important; font-size: 12px !important; }
                    .desktop-profile-dropdown { display: none !important; }
                    .mobile-cart-btn { display: flex !important; }
                }
                @media (max-width: 480px) {
                    .nav-shell { flex-wrap: wrap; gap: 8px !important; }
                    .nav-controls { width: 100%; justify-content: flex-end; }
                }
            `}</style>
        </nav>
        <ConfirmDialog
            open={showLogout}
            title="Log out?"
            message="Your current session will be closed on this device."
            confirmLabel="Log Out"
            destructive
            onConfirm={confirmLogout}
            onCancel={() => setShowLogout(false)}
        />
        </>
    );
}

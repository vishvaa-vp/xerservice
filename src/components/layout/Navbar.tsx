import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useApp } from '@/context/AppContext';
import { Moon, Sun, LogOut, Coins, ShoppingCart, FileText, MessageCircle } from 'lucide-react';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import NotificationBell from '@/components/notifications/NotificationBell';

export default function Navbar() {
    const { isLoggedIn, user, logout, theme, toggleTheme, cart } = useApp();
    const pathname = usePathname();
    const [showLogout, setShowLogout] = useState(false);

    const isAdminRoute = pathname.startsWith('/admin') || pathname.startsWith('/xad');

    const confirmLogout = () => {
        logout();
        setShowLogout(false);
    };

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
                        {isLoggedIn && pathname !== '/xad/login' && (
                            <button
                                onClick={() => setShowLogout(true)}
                                className="btn btn-outline btn-sm"
                                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: '700', padding: '6px 12px' }}
                            >
                                <LogOut size={13} /> <span>Sign Out</span>
                            </button>
                        )}
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

                {/* Direct Navigation Elements (When logged in) */}
                {isLoggedIn && user?.type !== 'vendor' && (
                    <div className="nav-direct-links">
                        <Link
                            href="/dashboard/orders"
                            className={`nav-direct-item ${pathname === '/dashboard/orders' ? 'active' : ''}`}
                        >
                            <FileText size={16} className="nav-direct-icon" color="var(--accent)" />
                            <span>Order History</span>
                        </Link>

                        <Link
                            href="/dashboard/whatsapp"
                            className={`nav-direct-item ${pathname === '/dashboard/whatsapp' || pathname === '/whatsapp' ? 'active' : ''}`}
                        >
                            <MessageCircle size={16} className="nav-direct-icon" color="#16a34a" />
                            <span>WA Documents</span>
                        </Link>

                        <Link
                            href="/dashboard/wallet"
                            className={`nav-direct-item ${pathname === '/dashboard/wallet' ? 'active' : ''}`}
                        >
                            <Coins size={16} className="nav-direct-icon" />
                            <span>Wallet (Rs {user?.xerCoins || 0})</span>
                        </Link>

                        <Link
                            href="/cart"
                            className={`nav-direct-item nav-cart-item ${pathname === '/cart' ? 'active' : ''}`}
                        >
                            <ShoppingCart size={16} className="nav-direct-icon" />
                            <span>Cart ({cart.length})</span>
                        </Link>
                    </div>
                )}

                {isLoggedIn && user?.type === 'vendor' && (
                    <div className="nav-direct-links">
                        <Link href="/vendor/dashboard" className="nav-direct-item">
                            <span>Vendor Dashboard</span>
                        </Link>
                    </div>
                )}

                {/* Utility Controls */}
                <div className="nav-controls" style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                    <button onClick={toggleTheme} className="btn btn-ghost" style={{ padding: '8px', minWidth: '40px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center' }} aria-label="Toggle theme">
                        <span style={{ display: 'inline-flex', transform: theme === 'light' ? 'rotate(0deg)' : 'rotate(360deg)', transition: 'transform 0.45s cubic-bezier(0.34, 1.56, 0.64, 1)' }}>
                            {theme === 'light' ? <Moon size={20} /> : <Sun size={20} />}
                        </span>
                    </button>

                    {isLoggedIn ? (
                        <>
                            <NotificationBell />

                            {/* Mobile Cart Icon for compact header */}
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

                            {/* Profile Direct Button (links straight to Profile Settings) */}
                            <Link
                                href="/dashboard/profile"
                                className="nav-top-profile-btn"
                                style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '7px',
                                    padding: '5px 14px 5px 6px',
                                    borderRadius: '999px',
                                    border: '1.5px solid var(--border)',
                                    background: pathname === '/dashboard/profile' ? 'var(--accent-muted)' : 'var(--bg)',
                                    color: 'var(--fg)',
                                    textDecoration: 'none',
                                    fontWeight: '700',
                                    fontSize: '13px',
                                    transition: 'all 0.15s ease',
                                }}
                                aria-label="Profile Settings"
                            >
                                <div style={{
                                    width: '24px',
                                    height: '24px',
                                    borderRadius: '50%',
                                    background: 'var(--accent)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    overflow: 'hidden',
                                    flexShrink: 0,
                                    color: '#fff',
                                    fontSize: '11px',
                                    fontWeight: '800',
                                }}>
                                    {user?.avatarUrl ? (
                                        <img src={user.avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                    ) : (
                                        user?.name?.[0]?.toUpperCase() || 'U'
                                    )}
                                </div>
                                <span className="nav-profile-name" style={{ maxWidth: '100px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {user?.name?.split(' ')[0] || 'Profile'}
                                </span>
                            </Link>
                        </>
                    ) : (
                        <Link href="/login" className="btn nav-customer-login" style={{ padding: '8px 24px', background: 'var(--fg)', color: 'var(--bg)', borderRadius: 'var(--radius-sm)', fontWeight: '700', fontSize: '13px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>Log in</Link>
                    )}
                </div>
            </div>

            <style>{`
                .nav-direct-links {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                }
                .nav-direct-item {
                    display: inline-flex;
                    align-items: center;
                    gap: 7px;
                    padding: 8px 12px;
                    border-radius: 999px;
                    text-decoration: none;
                    color: var(--fg);
                    font-size: 13px;
                    font-weight: 700;
                    background: transparent;
                    border: 1px solid transparent;
                    transition: all 0.15s ease;
                    white-space: nowrap;
                }
                .nav-direct-item:hover {
                    background: var(--bg-secondary);
                    border-color: var(--border);
                    color: var(--accent);
                }
                .nav-direct-item.active {
                    background: var(--bg-secondary);
                    border-color: var(--accent);
                    color: var(--accent);
                }
                .nav-direct-icon {
                    flex-shrink: 0;
                }
                .nav-signout-btn:hover {
                    background: rgba(239, 68, 68, 0.08) !important;
                }
                .desktop-profile-dropdown { display: none !important; }
                @media (max-width: 920px) and (min-width: 769px) {
                    .nav-shell {
                        flex-wrap: wrap;
                        padding-top: 8px !important;
                        padding-bottom: 8px !important;
                        gap: 8px !important;
                    }
                    .nav-direct-links {
                        order: 3;
                        width: 100%;
                        overflow-x: auto;
                        -webkit-overflow-scrolling: touch;
                        scrollbar-width: none;
                        padding-bottom: 4px;
                        gap: 8px;
                    }
                    .nav-direct-links::-webkit-scrollbar {
                        display: none;
                    }
                    .nav-direct-item {
                        padding: 6px 12px;
                        font-size: 12px;
                        background: var(--bg-secondary);
                        border-color: var(--border);
                        flex-shrink: 0;
                    }
                    .nav-logo-text { font-size: 16px !important; }
                    .nav-signout-text { display: none !important; }
                    .desktop-profile-dropdown { display: none !important; }
                    .mobile-cart-btn { display: none !important; }
                }
                @media (max-width: 768px) {
                    .nav-shell {
                        flex-wrap: nowrap !important;
                        min-height: 56px !important;
                        height: 56px !important;
                        padding-top: 0 !important;
                        padding-bottom: 0 !important;
                        gap: 8px !important;
                    }
                    .nav-direct-links {
                        display: none !important;
                    }
                    .mobile-cart-btn {
                        display: flex !important;
                    }
                    .nav-logo-text {
                        font-size: 17px !important;
                    }
                    .nav-signout-text {
                        display: none !important;
                    }
                }
                @media (max-width: 480px) {
                    .nav-shell { gap: 6px !important; }
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

'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
    LayoutDashboard,
    BarChart3,
    Users,
    UserCheck,
    Store,
    Layers,
    Landmark,
    TrendingUp,
    Coins,
    LifeBuoy,
    ExternalLink,
    ChevronLeft,
    ChevronRight,
    Shield,
    Menu,
    X,
} from 'lucide-react';

interface NavItem {
    label: string;
    href: string;
    icon: React.ElementType;
    badge?: string;
    exact?: boolean;
}

const navItems: NavItem[] = [
    { label: 'Overview', href: '/admin/overview', icon: LayoutDashboard, exact: true },
    { label: 'Dashboard', href: '/admin/dashboard', icon: BarChart3, exact: true },
    { label: 'People & Roles', href: '/admin/users', icon: Users },
    { label: 'Customers', href: '/admin/customers', icon: UserCheck },
    { label: 'Vendors & Shops', href: '/admin/vendors', icon: Store },
    { label: 'Settlements', href: '/admin/settlements', icon: Landmark },
    { label: 'Earnings & Commission', href: '/admin/earnings', icon: TrendingUp },
    { label: 'Financial Ledger', href: '/admin/finance', icon: Coins },
];

export default function AdminSidebar() {
    const pathname = usePathname();
    const [collapsed, setCollapsed] = useState(false);
    const [mobileOpen, setMobileOpen] = useState(false);

    // Close mobile drawer on route change
    useEffect(() => {
        setMobileOpen(false);
    }, [pathname]);

    // Close on escape key
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setMobileOpen(false);
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    const isItemActive = (item: NavItem) => {
        if (item.exact) {
            return pathname === item.href;
        }
        if (item.href === '/admin/users' && pathname === '/admin/people') {
            return true;
        }
        return pathname === item.href || pathname.startsWith(`${item.href}/`);
    };

    return (
        <>
            {/* Mobile Toggle Button (visible only on screens < 1024px) */}
            <div className="admin-mobile-toggle-bar">
                <button
                    type="button"
                    onClick={() => setMobileOpen(true)}
                    className="btn btn-outline btn-sm"
                    style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '8px',
                        padding: '8px 14px',
                        fontSize: '13px',
                        fontWeight: '700',
                        borderRadius: '8px',
                    }}
                    aria-label="Open Admin Menu"
                >
                    <Menu size={16} />
                    <span>Admin Topics Menu</span>
                </button>
            </div>

            {/* Mobile Backdrop Overlay */}
            {mobileOpen && (
                <div
                    onClick={() => setMobileOpen(false)}
                    className="admin-mobile-backdrop"
                    aria-hidden="true"
                />
            )}

            {/* Main Sidebar Element */}
            <aside
                className={`admin-sidebar-root ${collapsed ? 'collapsed' : ''} ${mobileOpen ? 'mobile-open' : ''}`}
                aria-label="Admin navigation sidebar"
            >
                {/* Header inside sidebar */}
                <div className="admin-sidebar-header">
                    {!collapsed && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
                            <div
                                style={{
                                    width: '28px',
                                    height: '28px',
                                    borderRadius: '8px',
                                    background: 'var(--accent)',
                                    color: '#fff',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    flexShrink: 0,
                                }}
                            >
                                <Shield size={16} />
                            </div>
                            <span style={{ fontSize: '14px', fontWeight: '800', letterSpacing: '-0.02em', whiteSpace: 'nowrap' }}>
                                Admin Navigation
                            </span>
                        </div>
                    )}

                    <button
                        type="button"
                        onClick={() => setCollapsed(prev => !prev)}
                        className="admin-collapse-btn"
                        title={collapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
                        aria-label={collapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
                    >
                        {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
                    </button>

                    {/* Mobile close button */}
                    <button
                        type="button"
                        onClick={() => setMobileOpen(false)}
                        className="admin-mobile-close-btn"
                        aria-label="Close sidebar"
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* Navigation Items (Clean, No Sub-Headings) */}
                <nav className="admin-sidebar-nav">
                    <div className="admin-sidebar-group-items">
                        {navItems.map((item) => {
                            const active = isItemActive(item);
                            const IconComponent = item.icon;
                            return (
                                <Link
                                    key={item.href}
                                    href={item.href}
                                    className={`admin-sidebar-item ${active ? 'active' : ''}`}
                                    title={collapsed ? item.label : undefined}
                                >
                                    <span className="admin-sidebar-item-icon">
                                        <IconComponent size={18} />
                                    </span>
                                    {!collapsed && (
                                        <span className="admin-sidebar-item-label">
                                            {item.label}
                                        </span>
                                    )}
                                    {!collapsed && item.badge && (
                                        <span className="admin-sidebar-item-badge">
                                            {item.badge}
                                        </span>
                                    )}
                                </Link>
                            );
                        })}
                    </div>
                </nav>

                {/* Bottom Footer Actions */}
                <div className="admin-sidebar-footer">
                    <Link
                        href="/"
                        className="admin-sidebar-item"
                        title={collapsed ? 'Customer View' : undefined}
                    >
                        <span className="admin-sidebar-item-icon">
                            <ExternalLink size={17} />
                        </span>
                        {!collapsed && (
                            <span className="admin-sidebar-item-label" style={{ fontSize: '13px' }}>
                                View Customer Store
                            </span>
                        )}
                    </Link>

                    {!collapsed && (
                        <div style={{ padding: '10px 14px 4px', fontSize: '11px', color: 'var(--fg-subtle)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#16a34a', display: 'inline-block' }} />
                            <span>XerService Admin Console</span>
                        </div>
                    )}
                </div>
            </aside>

            <style>{`
                .admin-mobile-toggle-bar {
                    display: none;
                    padding: 12px 16px 0;
                    background: var(--bg);
                }

                .admin-sidebar-root {
                    width: 250px;
                    min-width: 250px;
                    background: var(--bg);
                    border-right: 1px solid var(--border);
                    display: flex;
                    flex-direction: column;
                    height: calc(100vh - 65px);
                    position: sticky;
                    top: 65px;
                    z-index: 50;
                    transition: width 0.2s ease, min-width 0.2s ease, transform 0.25s ease;
                    flex-shrink: 0;
                    user-select: none;
                }

                .admin-sidebar-root.collapsed {
                    width: 68px;
                    min-width: 68px;
                }

                .admin-sidebar-header {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 16px 14px 12px;
                    border-bottom: 1px solid var(--border);
                    min-height: 56px;
                }

                .admin-collapse-btn {
                    width: 28px;
                    height: 28px;
                    border-radius: 6px;
                    border: 1px solid var(--border);
                    background: var(--bg-secondary);
                    color: var(--fg-muted);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    cursor: pointer;
                    transition: all 0.15s ease;
                }

                .admin-collapse-btn:hover {
                    color: var(--fg);
                    border-color: var(--fg-muted);
                }

                .admin-mobile-close-btn {
                    display: none;
                    background: transparent;
                    border: none;
                    color: var(--fg-muted);
                    cursor: pointer;
                    padding: 6px;
                }

                .admin-sidebar-nav {
                    flex: 1;
                    overflow-y: auto;
                    overflow-x: hidden;
                    padding: 14px 10px;
                    display: flex;
                    flex-direction: column;
                    gap: 16px;
                }

                .admin-sidebar-group-title {
                    font-size: 11px;
                    font-weight: 800;
                    text-transform: uppercase;
                    letter-spacing: 0.05em;
                    color: var(--fg-muted);
                    padding: 4px 12px 6px;
                }

                .admin-sidebar-group-items {
                    display: flex;
                    flex-direction: column;
                    gap: 3px;
                }

                .admin-sidebar-item {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    padding: 9px 12px;
                    border-radius: 9px;
                    text-decoration: none;
                    color: var(--fg-muted);
                    font-size: 13.5px;
                    font-weight: 600;
                    transition: all 0.15s ease;
                }

                .admin-sidebar-item:hover {
                    background: var(--bg-secondary);
                    color: var(--fg);
                }

                .admin-sidebar-item.active {
                    background: var(--accent-muted);
                    color: var(--accent);
                    font-weight: 800;
                }

                .admin-sidebar-item-icon {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    flex-shrink: 0;
                }

                .admin-sidebar-item-label {
                    flex: 1;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }

                .admin-sidebar-item-badge {
                    font-size: 11px;
                    font-weight: 800;
                    padding: 2px 7px;
                    border-radius: 999px;
                    background: var(--accent);
                    color: #fff;
                }

                .admin-sidebar-footer {
                    border-top: 1px solid var(--border);
                    padding: 10px;
                    display: flex;
                    flex-direction: column;
                    gap: 4px;
                    background: var(--bg);
                }

                .admin-mobile-backdrop {
                    display: none;
                }

                @media (max-width: 1024px) {
                    .admin-mobile-toggle-bar {
                        display: block;
                    }

                    .admin-mobile-backdrop {
                        display: block;
                        position: fixed;
                        inset: 0;
                        background: rgba(0, 0, 0, 0.5);
                        z-index: 1000;
                    }

                    .admin-sidebar-root {
                        position: fixed;
                        top: 0;
                        bottom: 0;
                        left: 0;
                        height: 100vh;
                        z-index: 1001;
                        transform: translateX(-100%);
                        box-shadow: 0 0 24px rgba(0, 0, 0, 0.25);
                    }

                    .admin-sidebar-root.mobile-open {
                        transform: translateX(0);
                    }

                    .admin-collapse-btn {
                        display: none;
                    }

                    .admin-mobile-close-btn {
                        display: flex;
                    }
                }
            `}</style>
        </>
    );
}

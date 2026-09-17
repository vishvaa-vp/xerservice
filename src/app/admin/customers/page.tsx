'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
import AdminHeaderNav from '@/components/admin/AdminHeaderNav';
import {
    UserCheck,
    Search,
    RefreshCw,
    ExternalLink,
    ShoppingBag,
    Calendar,
    ArrowRight,
    Shield,
    AlertCircle,
    LayoutGrid,
    Table as TableIcon,
    CreditCard,
    CheckCircle2,
    Clock,
    Phone,
    Mail,
    SlidersHorizontal,
    ChevronLeft,
    ChevronRight,
    Store,
} from 'lucide-react';

interface CustomerRecord {
    userId: string;
    fullName: string | null;
    email: string | null;
    phone: string | null;
    role: string;
    accountStatus: string;
    accountCategory: 'active' | 'inactive' | 'pending';
    isDisabled: boolean;
    isPending: boolean;
    orderCount: number;
    completedOrders: number;
    paidOrders: number;
    grossSpend: number;
    refundAmount: number;
    netSpend: number;
    latestOrderAt: string | null;
    assignedShopId: string | null;
    assignedShopName: string | null;
    lastSignInAt: string | null;
    createdAt: string;
}

interface ShopOption {
    shopId: string;
    shopName: string;
}

export default function AdminCustomersPage() {
    const router = useRouter();
    const [loading, setLoading] = useState(true);
    const [authorized, setAuthorized] = useState(false);
    const [authError, setAuthError] = useState<string | null>(null);
    const [customers, setCustomers] = useState<CustomerRecord[]>([]);
    const [availableShops, setAvailableShops] = useState<ShopOption[]>([]);

    // View mode: 'cards' (default vertical summary cards) vs 'table' (dense table)
    const [viewMode, setViewMode] = useState<'cards' | 'table'>('cards');

    // Filters & Sorting
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState<string>('all');
    const [shopFilter, setShopFilter] = useState<string>('all');
    const [sortBy, setSortBy] = useState<'spend' | 'orders' | 'newest' | 'name'>('spend');
    const [currentPage, setCurrentPage] = useState<number>(1);
    const pageSize = 12;

    const fetchCustomers = useCallback(async () => {
        setLoading(true);
        setAuthError(null);
        try {
            const sessionPromise = supabase.auth.getSession();
            const timeoutPromise = new Promise<any>((_, reject) =>
                setTimeout(() => reject(new Error('Authentication check timed out')), 5000)
            );
            const { data: { session }, error: sessionErr } = await Promise.race([sessionPromise, timeoutPromise]);

            if (sessionErr || !session?.user) {
                setAuthError('Please sign in with administrator credentials.');
                setAuthorized(false);
                setLoading(false);
                return;
            }

            const { data: profile, error: profErr } = await supabase
                .from('profiles')
                .select('role')
                .eq('user_id', session.user.id)
                .maybeSingle();

            if (profErr || !profile || profile.role !== 'admin') {
                setAuthError('Access restricted: your account does not have admin privileges.');
                setAuthorized(false);
                setLoading(false);
                return;
            }

            setAuthorized(true);

            // Fetch customer records
            const res = await fetch('/api/admin/users?role=customer', {
                headers: { Authorization: `Bearer ${session.access_token}` },
            });
            if (res.ok) {
                const data = await res.json();
                const list = (data.users || []).filter((u: any) => u.role === 'customer');
                setCustomers(list);
            } else {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.error || 'Failed to load customer list');
            }

            // Fetch shops for filter
            try {
                const shopRes = await fetch('/api/admin/finance/shops', {
                    headers: { Authorization: `Bearer ${session.access_token}` },
                });
                if (shopRes.ok) {
                    const shopData = await shopRes.json();
                    setAvailableShops(shopData.shops || []);
                }
            } catch (e) {
                console.error('Failed to load shop filter options:', e);
            }
        } catch (err: any) {
            console.error('Failed to load customers:', err);
            setAuthError(err.message || 'Error loading customers.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchCustomers();
    }, [fetchCustomers]);

    // Filter & Sort
    const filteredCustomers = useMemo(() => {
        let result = customers.filter(c => {
            // Status filter
            if (statusFilter !== 'all') {
                const cat = c.accountCategory || (c.accountStatus === 'disabled' ? 'inactive' : 'active');
                if (cat !== statusFilter) return false;
            }

            // Shop filter (if user is linked to shop)
            if (shopFilter !== 'all') {
                if (c.assignedShopId !== shopFilter) return false;
            }

            // Search filter
            if (search) {
                const q = search.toLowerCase();
                const matchName = c.fullName && c.fullName.toLowerCase().includes(q);
                const matchEmail = c.email && c.email.toLowerCase().includes(q);
                const matchPhone = c.phone && c.phone.toLowerCase().includes(q);
                const matchId = c.userId.toLowerCase().includes(q);
                if (!matchName && !matchEmail && !matchPhone && !matchId) return false;
            }

            return true;
        });

        // Sorting
        result.sort((a, b) => {
            if (sortBy === 'spend') {
                return (b.netSpend || 0) - (a.netSpend || 0);
            } else if (sortBy === 'orders') {
                return (b.completedOrders || 0) - (a.completedOrders || 0);
            } else if (sortBy === 'newest') {
                return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
            } else if (sortBy === 'name') {
                const nameA = (a.fullName || a.phone || a.email || '').toLowerCase();
                const nameB = (b.fullName || b.phone || b.email || '').toLowerCase();
                return nameA.localeCompare(nameB);
            }
            return 0;
        });

        return result;
    }, [customers, search, statusFilter, shopFilter, sortBy]);

    // Pagination
    const totalPages = Math.ceil(filteredCustomers.length / pageSize) || 1;
    const paginatedCustomers = useMemo(() => {
        const start = (currentPage - 1) * pageSize;
        return filteredCustomers.slice(start, start + pageSize);
    }, [filteredCustomers, currentPage, pageSize]);

    // Aggregate summary metrics across all customers
    const metrics = useMemo(() => {
        let totalNetSpend = 0;
        let totalCompletedOrders = 0;
        let activeCount = 0;
        let pendingCount = 0;

        for (const c of customers) {
            totalNetSpend += Number(c.netSpend) || 0;
            totalCompletedOrders += Number(c.completedOrders) || 0;
            const cat = c.accountCategory || (c.accountStatus === 'disabled' ? 'inactive' : 'active');
            if (cat === 'active') activeCount++;
            if (cat === 'pending') pendingCount++;
        }

        return {
            total: customers.length,
            activeCount,
            pendingCount,
            totalNetSpend: Math.round(totalNetSpend * 100) / 100,
            totalCompletedOrders,
        };
    }, [customers]);

    const getStatusBadge = (category: 'active' | 'inactive' | 'pending') => {
        switch (category) {
            case 'active':
                return { label: 'Active', bg: 'rgba(34, 197, 94, 0.12)', color: '#22c55e' };
            case 'pending':
                return { label: 'Pending', bg: 'rgba(245, 158, 11, 0.12)', color: '#f59e0b' };
            case 'inactive':
                return { label: 'Inactive', bg: 'rgba(239, 68, 68, 0.12)', color: 'var(--error)' };
            default:
                return { label: 'Active', bg: 'rgba(34, 197, 94, 0.12)', color: '#22c55e' };
        }
    };

    if (loading) {
        return (
            <div style={{ minHeight: '60vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px' }}>
                <span className="spinner spinner-lg" />
                <p style={{ color: 'var(--fg-muted)', fontSize: '14px' }}>Loading customer directory…</p>
            </div>
        );
    }

    if (!authorized) {
        return (
            <div className="container" style={{ maxWidth: '540px', margin: '80px auto', textAlign: 'center', padding: '32px' }}>
                <div style={{ width: '56px', height: '56px', borderRadius: '16px', background: 'rgba(239, 68, 68, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', color: 'var(--error)' }}>
                    <Shield size={28} />
                </div>
                <h2 style={{ fontSize: '20px', fontWeight: '900', color: 'var(--fg)', marginBottom: '8px' }}>
                    Administrator Access Required
                </h2>
                <p style={{ color: 'var(--fg-muted)', fontSize: '13.5px', marginBottom: '24px', lineHeight: '1.5' }}>
                    {authError || 'You must be signed in with an administrator account to view customer accounts.'}
                </p>
                <Link
                    href="/xad/login?redirect=/admin/customers"
                    className="btn"
                    style={{ background: 'var(--accent)', color: '#092b31', fontWeight: '800', textDecoration: 'none', padding: '10px 24px' }}
                >
                    Sign In as Administrator →
                </Link>
            </div>
        );
    }

    return (
        <div className="container" style={{ maxWidth: '1400px', margin: '0 auto', padding: '24px 16px 64px' }}>
            <AdminHeaderNav
                activeSection="users"
                title="Customers"
                badge={`${customers.length} Accounts`}
                actions={
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                        {/* Cards / Table View Toggle */}
                        <div style={{
                            display: 'inline-flex',
                            borderRadius: '8px',
                            background: 'var(--bg-muted)',
                            padding: '3px',
                            border: '1px solid var(--border)',
                        }}>
                            <button
                                onClick={() => setViewMode('cards')}
                                title="Vertical Summary Cards"
                                style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    padding: '6px 12px',
                                    borderRadius: '6px',
                                    fontSize: '12px',
                                    fontWeight: '700',
                                    border: 'none',
                                    cursor: 'pointer',
                                    background: viewMode === 'cards' ? 'var(--bg-card)' : 'transparent',
                                    color: viewMode === 'cards' ? 'var(--accent)' : 'var(--fg-muted)',
                                    boxShadow: viewMode === 'cards' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                                }}
                            >
                                <LayoutGrid size={14} /> Cards
                            </button>
                            <button
                                onClick={() => setViewMode('table')}
                                title="Dense Data Table"
                                style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    padding: '6px 12px',
                                    borderRadius: '6px',
                                    fontSize: '12px',
                                    fontWeight: '700',
                                    border: 'none',
                                    cursor: 'pointer',
                                    background: viewMode === 'table' ? 'var(--bg-card)' : 'transparent',
                                    color: viewMode === 'table' ? 'var(--accent)' : 'var(--fg-muted)',
                                    boxShadow: viewMode === 'table' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                                }}
                            >
                                <TableIcon size={14} /> Table
                            </button>
                        </div>

                        <button
                            onClick={fetchCustomers}
                            className="btn btn-outline btn-sm"
                            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}
                        >
                            <RefreshCw size={12} /> Refresh
                        </button>

                        <Link
                            href="/admin/people"
                            className="btn btn-sm"
                            style={{
                                fontSize: '12px',
                                fontWeight: '800',
                                background: 'var(--accent)',
                                color: '#092b31',
                                textDecoration: 'none',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '6px',
                            }}
                        >
                            Edit in People →
                        </Link>
                    </div>
                }
            />

            {/* Top Aggregate Summary Metrics Cards */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: '14px',
                marginBottom: '24px',
            }}>
                <div className="card" style={{ padding: '16px', borderRadius: '14px', background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                    <div style={{ fontSize: '11px', fontWeight: '700', color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        Total Customers
                    </div>
                    <div style={{ fontSize: '24px', fontWeight: '900', color: 'var(--fg)', marginTop: '6px' }}>
                        {metrics.total}
                    </div>
                </div>

                <div className="card" style={{ padding: '16px', borderRadius: '14px', background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                    <div style={{ fontSize: '11px', fontWeight: '700', color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        Active Accounts
                    </div>
                    <div style={{ fontSize: '24px', fontWeight: '900', color: '#22c55e', marginTop: '6px' }}>
                        {metrics.activeCount}
                    </div>
                </div>

                <div className="card" style={{ padding: '16px', borderRadius: '14px', background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                    <div style={{ fontSize: '11px', fontWeight: '700', color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        Pending Activation
                    </div>
                    <div style={{ fontSize: '24px', fontWeight: '900', color: '#f59e0b', marginTop: '6px' }}>
                        {metrics.pendingCount}
                    </div>
                </div>

                <div className="card" style={{ padding: '16px', borderRadius: '14px', background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                    <div style={{ fontSize: '11px', fontWeight: '700', color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        Completed Orders
                    </div>
                    <div style={{ fontSize: '24px', fontWeight: '900', color: 'var(--accent)', marginTop: '6px' }}>
                        {metrics.totalCompletedOrders}
                    </div>
                </div>

                <div className="card" style={{ padding: '16px', borderRadius: '14px', background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                    <div style={{ fontSize: '11px', fontWeight: '700', color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        Total Net Spend
                    </div>
                    <div style={{ fontSize: '24px', fontWeight: '900', color: 'var(--fg)', marginTop: '6px' }}>
                        ₹{metrics.totalNetSpend.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                </div>
            </div>

            {/* Filter Controls Bar */}
            <div style={{
                background: 'var(--bg-card)',
                padding: '16px',
                borderRadius: '14px',
                border: '1px solid var(--border)',
                marginBottom: '20px',
                display: 'flex',
                flexWrap: 'wrap',
                gap: '12px',
                alignItems: 'center',
                justifyContent: 'space-between',
            }}>
                <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', flex: 1, minWidth: '280px' }}>
                    {/* Search Input */}
                    <div style={{ position: 'relative', flex: 1, minWidth: '240px', maxWidth: '380px' }}>
                        <Search size={15} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--fg-muted)' }} />
                        <input
                            type="text"
                            value={search}
                            onChange={e => { setSearch(e.target.value); setCurrentPage(1); }}
                            placeholder="Search by name, phone, email, or ID…"
                            className="input"
                            style={{ paddingLeft: '36px', width: '100%', fontSize: '13px' }}
                        />
                    </div>

                    {/* Status Filter */}
                    <select
                        value={statusFilter}
                        onChange={e => { setStatusFilter(e.target.value); setCurrentPage(1); }}
                        className="input"
                        style={{ fontSize: '13px', width: 'auto' }}
                    >
                        <option value="all">All Statuses</option>
                        <option value="active">Active</option>
                        <option value="pending">Pending</option>
                        <option value="inactive">Inactive</option>
                    </select>

                    {/* Shop Filter */}
                    {availableShops.length > 0 && (
                        <select
                            value={shopFilter}
                            onChange={e => { setShopFilter(e.target.value); setCurrentPage(1); }}
                            className="input"
                            style={{ fontSize: '13px', width: 'auto' }}
                        >
                            <option value="all">All Shops</option>
                            {availableShops.map(s => (
                                <option key={s.shopId} value={s.shopId}>{s.shopName}</option>
                            ))}
                        </select>
                    )}
                </div>

                {/* Sort dropdown */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '12px', color: 'var(--fg-muted)', fontWeight: '600' }}>Sort:</span>
                    <select
                        value={sortBy}
                        onChange={e => setSortBy(e.target.value as any)}
                        className="input"
                        style={{ fontSize: '13px', width: 'auto' }}
                    >
                        <option value="spend">Highest Net Spend</option>
                        <option value="orders">Most Completed Orders</option>
                        <option value="newest">Recently Joined</option>
                        <option value="name">Name (A-Z)</option>
                    </select>
                </div>
            </div>

            {/* Content: Cards or Table */}
            {filteredCustomers.length === 0 ? (
                <div style={{
                    padding: '56px 24px',
                    textAlign: 'center',
                    background: 'var(--bg-card)',
                    borderRadius: '16px',
                    border: '1px solid var(--border)',
                }}>
                    <UserCheck size={36} style={{ color: 'var(--fg-muted)', margin: '0 auto 12px' }} />
                    <h3 style={{ fontSize: '17px', fontWeight: '800', color: 'var(--fg)', marginBottom: '6px' }}>
                        {search || statusFilter !== 'all' || shopFilter !== 'all' ? 'No matching customers' : 'No customers found'}
                    </h3>
                    <p style={{ color: 'var(--fg-muted)', fontSize: '13px', margin: '0 0 16px' }}>
                        {search || statusFilter !== 'all' || shopFilter !== 'all'
                            ? 'Try clearing or changing your filters.'
                            : 'Customer accounts will appear here automatically after user registration.'}
                    </p>
                    {(search || statusFilter !== 'all' || shopFilter !== 'all') && (
                        <button
                            onClick={() => { setSearch(''); setStatusFilter('all'); setShopFilter('all'); }}
                            className="btn btn-outline btn-sm"
                            style={{ fontSize: '12px' }}
                        >
                            Reset Filters
                        </button>
                    )}
                </div>
            ) : viewMode === 'cards' ? (
                /* Default View: Vertical Summary Cards */
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
                    gap: '20px',
                }}>
                    {paginatedCustomers.map(c => {
                        const badge = getStatusBadge(c.accountCategory);
                        const editUrl = `/admin/people?search=${encodeURIComponent(c.phone || c.email || c.fullName || c.userId)}`;
                        const detailUrl = `/admin/customers/${c.userId}`;

                        return (
                            <div
                                key={c.userId}
                                className="card"
                                style={{
                                    padding: '20px',
                                    borderRadius: '16px',
                                    background: 'var(--bg-card)',
                                    border: '1px solid var(--border)',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    justifyContent: 'space-between',
                                    gap: '16px',
                                    transition: 'transform 0.15s, box-shadow 0.15s',
                                }}
                            >
                                <div>
                                    {/* Card Header: Avatar, Name & Status Badge */}
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px', marginBottom: '12px' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                            <div style={{
                                                width: '42px',
                                                height: '42px',
                                                borderRadius: '50%',
                                                background: 'rgba(0, 240, 255, 0.08)',
                                                border: '1px solid rgba(0, 240, 255, 0.2)',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                fontSize: '16px',
                                                fontWeight: '900',
                                                color: 'var(--accent)',
                                                flexShrink: 0,
                                            }}>
                                                {(c.fullName || c.phone || c.email || 'C').charAt(0).toUpperCase()}
                                            </div>
                                            <div>
                                                <Link
                                                    href={detailUrl}
                                                    style={{
                                                        fontSize: '15px',
                                                        fontWeight: '800',
                                                        color: 'var(--fg)',
                                                        textDecoration: 'none',
                                                        display: 'block',
                                                    }}
                                                >
                                                    {c.fullName || 'Customer'}
                                                </Link>
                                                <div style={{ fontSize: '11px', color: 'var(--fg-muted)', marginTop: '2px' }}>
                                                    Joined {new Date(c.createdAt).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}
                                                </div>
                                            </div>
                                        </div>

                                        <span style={{
                                            fontSize: '11px',
                                            fontWeight: '700',
                                            padding: '2px 8px',
                                            borderRadius: '6px',
                                            background: badge.bg,
                                            color: badge.color,
                                            textTransform: 'capitalize',
                                            flexShrink: 0,
                                        }}>
                                            {badge.label}
                                        </span>
                                    </div>

                                    {/* Contact info */}
                                    <div style={{ fontSize: '12.5px', color: 'var(--fg-muted)', display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '14px' }}>
                                        {c.phone ? (
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                <Phone size={12} style={{ color: 'var(--fg-muted)' }} />
                                                <span>{c.phone}</span>
                                            </div>
                                        ) : (
                                            <div style={{ fontStyle: 'italic', fontSize: '11.5px' }}>No phone linked</div>
                                        )}

                                        {c.email && (
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', wordBreak: 'break-all' }}>
                                                <Mail size={12} style={{ color: 'var(--fg-muted)' }} />
                                                <span>{c.email}</span>
                                            </div>
                                        )}
                                    </div>

                                    {/* Truthful Metric Chips Grid */}
                                    <div style={{
                                        display: 'grid',
                                        gridTemplateColumns: '1fr 1fr',
                                        gap: '8px',
                                        padding: '12px',
                                        background: 'rgba(255, 255, 255, 0.02)',
                                        borderRadius: '12px',
                                        border: '1px solid var(--border)',
                                    }}>
                                        <div>
                                            <div style={{ fontSize: '10.5px', fontWeight: '700', color: 'var(--fg-muted)', textTransform: 'uppercase' }}>
                                                Net Spent
                                            </div>
                                            <div style={{ fontSize: '15px', fontWeight: '900', color: 'var(--fg)', marginTop: '2px' }}>
                                                ₹{c.netSpend?.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || '0.00'}
                                            </div>
                                        </div>

                                        <div>
                                            <div style={{ fontSize: '10.5px', fontWeight: '700', color: 'var(--fg-muted)', textTransform: 'uppercase' }}>
                                                Completed
                                            </div>
                                            <div style={{ fontSize: '15px', fontWeight: '900', color: '#22c55e', marginTop: '2px' }}>
                                                {c.completedOrders || 0}
                                            </div>
                                        </div>

                                        <div>
                                            <div style={{ fontSize: '10.5px', fontWeight: '700', color: 'var(--fg-muted)', textTransform: 'uppercase' }}>
                                                Paid Orders
                                            </div>
                                            <div style={{ fontSize: '15px', fontWeight: '900', color: '#38bdf8', marginTop: '2px' }}>
                                                {c.paidOrders || 0}
                                            </div>
                                        </div>

                                        <div>
                                            <div style={{ fontSize: '10.5px', fontWeight: '700', color: 'var(--fg-muted)', textTransform: 'uppercase' }}>
                                                Latest Order
                                            </div>
                                            <div style={{ fontSize: '12px', fontWeight: '700', color: 'var(--fg)', marginTop: '4px' }}>
                                                {c.latestOrderAt
                                                    ? new Date(c.latestOrderAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
                                                    : 'None'}
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Card Footer: View Details & Single Authoritative Edit in People */}
                                <div style={{
                                    borderTop: '1px solid var(--border)',
                                    paddingTop: '14px',
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    gap: '8px',
                                }}>
                                    <Link
                                        href={detailUrl}
                                        className="btn btn-outline btn-sm"
                                        style={{
                                            fontSize: '12px',
                                            fontWeight: '700',
                                            padding: '6px 12px',
                                            textDecoration: 'none',
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: '4px',
                                        }}
                                    >
                                        View Details <ArrowRight size={12} />
                                    </Link>

                                    <Link
                                        href={editUrl}
                                        style={{
                                            fontSize: '12px',
                                            fontWeight: '800',
                                            color: 'var(--accent)',
                                            textDecoration: 'none',
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: '4px',
                                        }}
                                    >
                                        Edit in People →
                                    </Link>
                                </div>
                            </div>
                        );
                    })}
                </div>
            ) : (
                /* Dense Data Table View */
                <div className="card" style={{
                    borderRadius: '16px',
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border)',
                    overflow: 'hidden',
                }}>
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-muted)', textAlign: 'left', color: 'var(--fg-muted)', fontSize: '11.5px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                    <th style={{ padding: '12px 16px' }}>Customer</th>
                                    <th style={{ padding: '12px 16px' }}>Contact</th>
                                    <th style={{ padding: '12px 16px' }}>Status</th>
                                    <th style={{ padding: '12px 16px', textAlign: 'center' }}>Completed</th>
                                    <th style={{ padding: '12px 16px', textAlign: 'center' }}>Paid</th>
                                    <th style={{ padding: '12px 16px', textAlign: 'right' }}>Net Spend</th>
                                    <th style={{ padding: '12px 16px' }}>Latest Order</th>
                                    <th style={{ padding: '12px 16px', textAlign: 'right' }}>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {paginatedCustomers.map(c => {
                                    const badge = getStatusBadge(c.accountCategory);
                                    const editUrl = `/admin/people?search=${encodeURIComponent(c.phone || c.email || c.fullName || c.userId)}`;
                                    const detailUrl = `/admin/customers/${c.userId}`;

                                    return (
                                        <tr key={c.userId} style={{ borderBottom: '1px solid var(--border)', transition: 'background 0.15s' }}>
                                            <td style={{ padding: '14px 16px' }}>
                                                <Link href={detailUrl} style={{ fontWeight: '800', color: 'var(--fg)', textDecoration: 'none' }}>
                                                    {c.fullName || 'Customer'}
                                                </Link>
                                                <div style={{ fontSize: '11px', color: 'var(--fg-muted)', marginTop: '2px' }}>
                                                    Joined {new Date(c.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                                                </div>
                                            </td>
                                            <td style={{ padding: '14px 16px', color: 'var(--fg-muted)', fontSize: '12px' }}>
                                                {c.phone && <div>📞 {c.phone}</div>}
                                                {c.email && <div>✉️ {c.email}</div>}
                                                {!c.phone && !c.email && <span style={{ fontStyle: 'italic' }}>None</span>}
                                            </td>
                                            <td style={{ padding: '14px 16px' }}>
                                                <span style={{
                                                    fontSize: '11px',
                                                    fontWeight: '700',
                                                    padding: '3px 8px',
                                                    borderRadius: '6px',
                                                    background: badge.bg,
                                                    color: badge.color,
                                                    textTransform: 'capitalize',
                                                }}>
                                                    {badge.label}
                                                </span>
                                            </td>
                                            <td style={{ padding: '14px 16px', textAlign: 'center', fontWeight: '800', color: '#22c55e' }}>
                                                {c.completedOrders || 0}
                                            </td>
                                            <td style={{ padding: '14px 16px', textAlign: 'center', fontWeight: '800', color: '#38bdf8' }}>
                                                {c.paidOrders || 0}
                                            </td>
                                            <td style={{ padding: '14px 16px', textAlign: 'right', fontWeight: '900', color: 'var(--fg)' }}>
                                                ₹{c.netSpend?.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || '0.00'}
                                            </td>
                                            <td style={{ padding: '14px 16px', color: 'var(--fg-muted)', fontSize: '12px' }}>
                                                {c.latestOrderAt
                                                    ? new Date(c.latestOrderAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
                                                    : 'None'}
                                            </td>
                                            <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                                                <div style={{ display: 'inline-flex', gap: '8px', alignItems: 'center' }}>
                                                    <Link
                                                        href={detailUrl}
                                                        className="btn btn-outline btn-sm"
                                                        style={{ fontSize: '11.5px', padding: '4px 10px', textDecoration: 'none' }}
                                                    >
                                                        Details
                                                    </Link>
                                                    <Link
                                                        href={editUrl}
                                                        style={{ fontSize: '11.5px', fontWeight: '800', color: 'var(--accent)', textDecoration: 'none' }}
                                                    >
                                                        Edit in People →
                                                    </Link>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Pagination Controls */}
            {totalPages > 1 && (
                <div style={{
                    marginTop: '24px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: '12px',
                    padding: '12px 16px',
                    background: 'var(--bg-card)',
                    borderRadius: '12px',
                    border: '1px solid var(--border)',
                }}>
                    <span style={{ fontSize: '12.5px', color: 'var(--fg-muted)' }}>
                        Showing {Math.min((currentPage - 1) * pageSize + 1, filteredCustomers.length)}–
                        {Math.min(currentPage * pageSize, filteredCustomers.length)} of {filteredCustomers.length} customers
                    </span>

                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <button
                            onClick={() => setCurrentPage(p => Math.max(p - 1, 1))}
                            disabled={currentPage === 1}
                            className="btn btn-outline btn-sm"
                            style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '12px', opacity: currentPage === 1 ? 0.5 : 1 }}
                        >
                            <ChevronLeft size={14} /> Previous
                        </button>
                        <span style={{ fontSize: '12.5px', fontWeight: '700', padding: '0 8px' }}>
                            {currentPage} / {totalPages}
                        </span>
                        <button
                            onClick={() => setCurrentPage(p => Math.min(p + 1, totalPages))}
                            disabled={currentPage === totalPages}
                            className="btn btn-outline btn-sm"
                            style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '12px', opacity: currentPage === totalPages ? 0.5 : 1 }}
                        >
                            Next <ChevronRight size={14} />
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
import AdminHeaderNav from '@/components/admin/AdminHeaderNav';
import {
    Store,
    RefreshCw,
    Plus,
    Search,
    Clock,
    DollarSign,
    CheckCircle2,
    AlertCircle,
    ArrowRight,
    Sliders,
    UserCheck,
    Phone,
    Mail,
    SlidersHorizontal,
    Shield,
    FileText,
} from 'lucide-react';

interface ShopMetadata {
    shopId: string;
    shopName: string;
    ownerId: string | null;
    shopStatus: 'OPEN' | 'PAUSED' | 'CLOSED';
    publishStatus: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
    address: string | null;
    photos: string[];
    contactPhone: string | null;
    openTime: string | null;
    closeTime: string | null;
    closingSoon: boolean;
    closingMessage: string | null;
    commissionConfigured: boolean;
    grossSales: number;
    platformCommission: number | null;
    vendorEarnings: number | null;
    payableAmount: number | null;
    totalOrdersCount: number;
    activeCommissionRule: {
        id: string;
        commissionPercentage: number;
    } | null;
    createdAt: string;
}

interface VendorRecord {
    userId: string;
    email: string | null;
    fullName: string | null;
    phone: string | null;
    role: string;
    isDisabled: boolean;
    shop: ShopMetadata | null;
    lastSignInAt: string | null;
    createdAt: string;
}

export default function AdminVendorsPage() {
    const router = useRouter();
    const [loading, setLoading] = useState(true);
    const [authorized, setAuthorized] = useState(false);
    const [authError, setAuthError] = useState<string | null>(null);

    const [vendors, setVendors] = useState<VendorRecord[]>([]);
    const [allShops, setAllShops] = useState<ShopMetadata[]>([]);

    // Search and Filters
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState<string>('all');
    const [publishFilter, setPublishFilter] = useState<string>('all');

    const fetchVendorsAndShops = useCallback(async () => {
        setLoading(true);
        setAuthError(null);
        try {
            const { data: { session }, error: sessionErr } = await supabase.auth.getSession();
            if (sessionErr || !session?.user) {
                router.replace('/xad/login?redirect=/admin/vendors');
                return;
            }

            const { data: profile, error: profErr } = await supabase
                .from('profiles')
                .select('role')
                .eq('user_id', session.user.id)
                .maybeSingle();

            if (profErr || !profile || profile.role !== 'admin') {
                router.replace('/xad/login?redirect=/admin/vendors');
                return;
            }

            setAuthorized(true);

            const res = await fetch('/api/admin/vendors', {
                headers: { Authorization: `Bearer ${session.access_token}` },
            });

            if (res.ok) {
                const data = await res.json();
                setVendors(data.vendors || []);
                setAllShops(data.shops || []);
            } else {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.error || 'Failed to load vendors');
            }
        } catch (err: any) {
            console.error('Failed to load vendors:', err);
            setAuthError(err.message || 'Error loading vendors');
        } finally {
            setLoading(false);
        }
    }, [router]);

    useEffect(() => {
        fetchVendorsAndShops();
    }, [fetchVendorsAndShops]);

    // Filtered items (Vendors with shops, plus unassigned shops if any)
    const filteredVendors = useMemo(() => {
        return vendors.filter(v => {
            const shop = v.shop;

            // Filter by Trading Status
            if (statusFilter !== 'all') {
                if (!shop || shop.shopStatus.toLowerCase() !== statusFilter.toLowerCase()) {
                    return false;
                }
            }

            // Filter by Publish Status
            if (publishFilter !== 'all') {
                if (!shop || shop.publishStatus.toLowerCase() !== publishFilter.toLowerCase()) {
                    return false;
                }
            }

            // Search filter
            if (search) {
                const q = search.toLowerCase();
                const matchName = v.fullName && v.fullName.toLowerCase().includes(q);
                const matchEmail = v.email && v.email.toLowerCase().includes(q);
                const matchPhone = v.phone && v.phone.toLowerCase().includes(q);
                const matchShop = shop && shop.shopName.toLowerCase().includes(q);
                const matchAddr = shop?.address && shop.address.toLowerCase().includes(q);
                if (!matchName && !matchEmail && !matchPhone && !matchShop && !matchAddr) {
                    return false;
                }
            }

            return true;
        });
    }, [vendors, search, statusFilter, publishFilter]);

    // Aggregate summary metrics
    const metrics = useMemo(() => {
        let openCount = 0;
        let publishedCount = 0;
        let totalEarnings = 0;
        let totalPayable = 0;

        for (const s of allShops) {
            if (s.shopStatus === 'OPEN') openCount++;
            if (s.publishStatus === 'PUBLISHED') publishedCount++;
            totalEarnings += (s.vendorEarnings || 0);
            totalPayable += (s.payableAmount || 0);
        }

        return {
            totalShops: allShops.length,
            openCount,
            publishedCount,
            totalEarnings: Math.round(totalEarnings * 100) / 100,
            totalPayable: Math.round(totalPayable * 100) / 100,
        };
    }, [allShops]);

    const getTradingBadge = (status: string) => {
        switch (status) {
            case 'OPEN':
                return { label: 'Open', bg: 'rgba(34, 197, 94, 0.12)', color: '#22c55e' };
            case 'PAUSED':
                return { label: 'Paused', bg: 'rgba(245, 158, 11, 0.12)', color: '#f59e0b' };
            case 'CLOSED':
            default:
                return { label: 'Closed', bg: 'rgba(239, 68, 68, 0.12)', color: 'var(--error)' };
        }
    };

    const getPublishBadge = (status: string) => {
        switch (status) {
            case 'PUBLISHED':
                return { label: 'Published', bg: 'rgba(0, 240, 255, 0.12)', color: 'var(--accent)' };
            case 'DRAFT':
                return { label: 'Draft', bg: 'rgba(168, 85, 247, 0.12)', color: '#c084fc' };
            case 'ARCHIVED':
            default:
                return { label: 'Archived', bg: 'rgba(255, 255, 255, 0.08)', color: 'var(--fg-muted)' };
        }
    };

    if (loading) {
        return (
            <div style={{ minHeight: '60vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px' }}>
                <span className="spinner spinner-lg" />
                <p style={{ color: 'var(--fg-muted)', fontSize: '14px' }}>Loading vendors & shops…</p>
            </div>
        );
    }

    if (!authorized) return null;

    return (
        <div className="container" style={{ maxWidth: '1400px', margin: '0 auto', padding: '24px 16px 64px' }}>
            <AdminHeaderNav
                activeSection="finance"
                title="Vendors & Shops"
                badge={`${allShops.length} Registered`}
                actions={
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                        <button onClick={fetchVendorsAndShops} className="btn btn-outline btn-sm" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}>
                            <RefreshCw size={12} /> Refresh
                        </button>
                        <Link href="/admin/people" className="btn btn-sm" style={{ fontSize: '12px', fontWeight: '800', background: 'var(--accent)', color: '#092b31', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                            <Plus size={13} /> Assign in People →
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
                        Total Shops
                    </div>
                    <div style={{ fontSize: '24px', fontWeight: '900', color: 'var(--fg)', marginTop: '6px' }}>
                        {metrics.totalShops}
                    </div>
                </div>

                <div className="card" style={{ padding: '16px', borderRadius: '14px', background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                    <div style={{ fontSize: '11px', fontWeight: '700', color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        Open for Trading
                    </div>
                    <div style={{ fontSize: '24px', fontWeight: '900', color: '#22c55e', marginTop: '6px' }}>
                        {metrics.openCount}
                    </div>
                </div>

                <div className="card" style={{ padding: '16px', borderRadius: '14px', background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                    <div style={{ fontSize: '11px', fontWeight: '700', color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        Published to Customers
                    </div>
                    <div style={{ fontSize: '24px', fontWeight: '900', color: 'var(--accent)', marginTop: '6px' }}>
                        {metrics.publishedCount}
                    </div>
                </div>

                <div className="card" style={{ padding: '16px', borderRadius: '14px', background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                    <div style={{ fontSize: '11px', fontWeight: '700', color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        Ready to Pay
                    </div>
                    <div style={{ fontSize: '24px', fontWeight: '900', color: '#eab308', marginTop: '6px' }}>
                        ₹{metrics.totalPayable.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                </div>

                <div className="card" style={{ padding: '16px', borderRadius: '14px', background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                    <div style={{ fontSize: '11px', fontWeight: '700', color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        Total Shop Earnings
                    </div>
                    <div style={{ fontSize: '24px', fontWeight: '900', color: 'var(--fg)', marginTop: '6px' }}>
                        ₹{metrics.totalEarnings.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                </div>
            </div>

            {/* Filter Controls Bar */}
            <div style={{
                background: 'var(--bg-card)',
                padding: '16px',
                borderRadius: '14px',
                border: '1px solid var(--border)',
                marginBottom: '24px',
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
                            onChange={e => setSearch(e.target.value)}
                            placeholder="Search by shop, owner, or location…"
                            className="input"
                            style={{ paddingLeft: '36px', width: '100%', fontSize: '13px' }}
                        />
                    </div>

                    {/* Trading Status Filter */}
                    <select
                        value={statusFilter}
                        onChange={e => setStatusFilter(e.target.value)}
                        className="input"
                        style={{ fontSize: '13px', width: 'auto' }}
                    >
                        <option value="all">All Trading States</option>
                        <option value="open">Open</option>
                        <option value="paused">Paused</option>
                        <option value="closed">Closed</option>
                    </select>

                    {/* Publish Status Filter */}
                    <select
                        value={publishFilter}
                        onChange={e => setPublishFilter(e.target.value)}
                        className="input"
                        style={{ fontSize: '13px', width: 'auto' }}
                    >
                        <option value="all">All Visibility</option>
                        <option value="published">Published</option>
                        <option value="draft">Draft</option>
                        <option value="archived">Archived</option>
                    </select>
                </div>
            </div>

            {/* Shop Cards Grid */}
            {filteredVendors.length === 0 ? (
                <div style={{
                    padding: '56px 24px',
                    textAlign: 'center',
                    background: 'var(--bg-card)',
                    borderRadius: '16px',
                    border: '1px solid var(--border)'
                }}>
                    <Store size={36} style={{ color: 'var(--fg-muted)', margin: '0 auto 12px' }} />
                    <h3 style={{ fontSize: '17px', fontWeight: '800', color: 'var(--fg)', marginBottom: '4px' }}>
                        {search || statusFilter !== 'all' || publishFilter !== 'all' ? 'No matching shops found' : 'No shops registered yet'}
                    </h3>
                    <p style={{ color: 'var(--fg-muted)', fontSize: '13px', margin: '0 0 16px' }}>
                        {search || statusFilter !== 'all' || publishFilter !== 'all'
                            ? 'Try adjusting your search criteria or clearing filters.'
                            : 'Create a vendor in People to set up and manage their print shop.'}
                    </p>
                    {(search || statusFilter !== 'all' || publishFilter !== 'all') && (
                        <button
                            onClick={() => { setSearch(''); setStatusFilter('all'); setPublishFilter('all'); }}
                            className="btn btn-outline btn-sm"
                            style={{ fontSize: '12px' }}
                        >
                            Reset Filters
                        </button>
                    )}
                </div>
            ) : (
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
                    gap: '20px'
                }}>
                    {filteredVendors.map(vendor => {
                        const shop = vendor.shop;
                        const tradingBadge = getTradingBadge(shop?.shopStatus || 'CLOSED');
                        const publishBadge = getPublishBadge(shop?.publishStatus || 'PUBLISHED');
                        const workspaceUrl = shop
                            ? `/admin/vendors/${vendor.userId}/shops/${shop.shopId}`
                            : `/admin/people?search=${encodeURIComponent(vendor.phone || vendor.email || vendor.fullName || '')}`;
                        const editInPeopleUrl = `/admin/people?search=${encodeURIComponent(vendor.phone || vendor.email || vendor.fullName || '')}`;

                        return (
                            <div
                                key={vendor.userId}
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
                                    {/* Header: Shop Image / Initials + Name + Badges */}
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px', marginBottom: '12px' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                            <div style={{
                                                width: '46px',
                                                height: '46px',
                                                borderRadius: '12px',
                                                background: 'rgba(0, 240, 255, 0.08)',
                                                border: '1px solid rgba(0, 240, 255, 0.2)',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                fontSize: '18px',
                                                fontWeight: '900',
                                                color: 'var(--accent)',
                                                flexShrink: 0,
                                            }}>
                                                <Store size={22} />
                                            </div>
                                            <div>
                                                <h2 style={{ fontSize: '16px', fontWeight: '800', color: 'var(--fg)', margin: 0 }}>
                                                    {shop ? shop.shopName : 'Unassigned Shop'}
                                                </h2>
                                                {shop?.address && (
                                                    <p style={{ fontSize: '12px', color: 'var(--fg-muted)', margin: '3px 0 0', lineHeight: '1.4' }}>
                                                        {shop.address}
                                                    </p>
                                                )}
                                            </div>
                                        </div>

                                        {/* Dual Status Badges: Trading Status + Publish Visibility */}
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-end', flexShrink: 0 }}>
                                            <span style={{
                                                fontSize: '10.5px',
                                                fontWeight: '800',
                                                padding: '2px 7px',
                                                borderRadius: '6px',
                                                background: tradingBadge.bg,
                                                color: tradingBadge.color,
                                                textTransform: 'uppercase',
                                                letterSpacing: '0.02em',
                                            }}>
                                                {tradingBadge.label}
                                            </span>

                                            <span style={{
                                                fontSize: '10.5px',
                                                fontWeight: '800',
                                                padding: '2px 7px',
                                                borderRadius: '6px',
                                                background: publishBadge.bg,
                                                color: publishBadge.color,
                                                textTransform: 'uppercase',
                                                letterSpacing: '0.02em',
                                            }}>
                                                {publishBadge.label}
                                            </span>
                                        </div>
                                    </div>

                                    {/* Owner Information */}
                                    <div style={{
                                        fontSize: '12px',
                                        color: 'var(--fg-muted)',
                                        background: 'var(--bg-secondary)',
                                        padding: '10px 12px',
                                        borderRadius: '10px',
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        marginBottom: '14px',
                                    }}>
                                        <div>
                                            <div style={{ fontWeight: '700', color: 'var(--fg)' }}>
                                                👤 {vendor.fullName || 'Vendor Owner'}
                                            </div>
                                            <div style={{ fontSize: '11px', color: 'var(--fg-muted)', marginTop: '2px' }}>
                                                {vendor.email || vendor.phone || 'No direct contact'}
                                            </div>
                                        </div>
                                        <Link
                                            href={editInPeopleUrl}
                                            style={{ fontSize: '11.5px', fontWeight: '700', color: 'var(--accent)', textDecoration: 'none' }}
                                        >
                                            People →
                                        </Link>
                                    </div>

                                    {/* Financial & Operational Metric Chips */}
                                    <div style={{
                                        display: 'grid',
                                        gridTemplateColumns: '1fr 1fr',
                                        gap: '10px',
                                        padding: '12px',
                                        background: 'rgba(255, 255, 255, 0.02)',
                                        borderRadius: '12px',
                                        border: '1px solid var(--border)',
                                    }}>
                                        <div>
                                            <div style={{ fontSize: '10.5px', color: 'var(--fg-muted)', fontWeight: '700', textTransform: 'uppercase' }}>Orders</div>
                                            <div style={{ fontSize: '16px', fontWeight: '900', color: 'var(--fg)', marginTop: '2px' }}>
                                                {shop ? shop.totalOrdersCount : 0}
                                            </div>
                                        </div>
                                        <div>
                                            <div style={{ fontSize: '10.5px', color: 'var(--fg-muted)', fontWeight: '700', textTransform: 'uppercase' }}>Ready to Pay</div>
                                            <div style={{ fontSize: '16px', fontWeight: '900', color: '#eab308', marginTop: '2px' }}>
                                                ₹{(shop?.payableAmount ?? 0).toFixed(2)}
                                            </div>
                                        </div>
                                        <div>
                                            <div style={{ fontSize: '10.5px', color: 'var(--fg-muted)', fontWeight: '700', textTransform: 'uppercase' }}>Shop Earnings</div>
                                            <div style={{ fontSize: '16px', fontWeight: '900', color: 'var(--fg)', marginTop: '2px' }}>
                                                ₹{(shop?.vendorEarnings ?? 0).toFixed(2)}
                                            </div>
                                        </div>
                                        <div>
                                            <div style={{ fontSize: '10.5px', color: 'var(--fg-muted)', fontWeight: '700', textTransform: 'uppercase' }}>Commission</div>
                                            <div style={{ fontSize: '15px', fontWeight: '900', color: 'var(--accent)', marginTop: '2px' }}>
                                                {shop?.activeCommissionRule ? `${shop.activeCommissionRule.commissionPercentage}%` : 'Not set'}
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Card Footer Actions */}
                                <div style={{
                                    borderTop: '1px solid var(--border)',
                                    paddingTop: '14px',
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                }}>
                                    <Link
                                        href={`/admin/finance?view=shops&shopId=${shop?.shopId || ''}`}
                                        style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '12px', color: 'var(--fg-muted)', textDecoration: 'none' }}
                                    >
                                        <Sliders size={13} /> Fee Policy
                                    </Link>

                                    {shop ? (
                                        <Link
                                            href={workspaceUrl}
                                            className="btn btn-sm"
                                            style={{
                                                display: 'inline-flex',
                                                alignItems: 'center',
                                                gap: '5px',
                                                fontSize: '12px',
                                                fontWeight: '800',
                                                background: 'var(--accent)',
                                                color: '#092b31',
                                                textDecoration: 'none',
                                                padding: '6px 14px',
                                                borderRadius: '8px',
                                            }}
                                        >
                                            Shop Workspace <ArrowRight size={13} />
                                        </Link>
                                    ) : (
                                        <Link
                                            href={editInPeopleUrl}
                                            style={{ fontSize: '12px', fontWeight: '800', color: 'var(--accent)', textDecoration: 'none' }}
                                        >
                                            Assign Shop in People →
                                        </Link>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

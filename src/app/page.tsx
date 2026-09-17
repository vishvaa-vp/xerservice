'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useApp } from '@/context/AppContext';
import { supabase } from '@/lib/supabase/client';
import { parseShopProfileMetadata } from '@/lib/shop-profile';
import { AlertTriangle, Clock, MessageCircle, ShieldCheck, UploadCloud, MapPin, Search, Sparkles } from 'lucide-react';

export interface HomepageShop {
    id: string;
    name: string;
    description: string | null;
    status: 'OPEN' | 'PAUSED' | 'CLOSED';
    openTime: string;
    closeTime: string;
    closingSoon: boolean;
    closingMessage: string | null;
    priceBwPerPage: number | null;
    priceColorPerPage: number | null;
    priceBwDoublePerPage: number | null;
    priceColorDoublePerPage: number | null;
    supportedServices: string[];
    startingPrice: number | null;
    startingPriceBasis: string;
    imageInitials: string;
    imageUrl?: string;
}

function formatTime(timeStr?: string | null): string {
    if (!timeStr) return '';
    const [hoursStr, minutesStr] = timeStr.split(':');
    const hours = parseInt(hoursStr, 10);
    const minutes = parseInt(minutesStr, 10);
    if (isNaN(hours)) return timeStr;

    const period = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 === 0 ? 12 : hours % 12;
    const displayMinutes = isNaN(minutes) ? '00' : minutes.toString().padStart(2, '0');

    return `${displayHours}:${displayMinutes} ${period}`;
}

function getInitials(name: string): string {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return 'XS';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
}

export default function HomePage() {
    const { setCurrentOrder, user } = useApp();
    const [shops, setShops] = useState<HomepageShop[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Search and filter states
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState<'ALL' | 'OPEN'>('ALL');
    const [serviceFilter, setServiceFilter] = useState<'ALL' | 'COLOUR' | 'BW' | 'DUPLEX'>('ALL');

    const fetchShops = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            // 1. Fetch shops from Supabase public.shops
            const { data: shopsData, error: shopsError } = await supabase
                .from('shops')
                .select('id, name, description, status, open_time, close_time, closing_soon, closing_message')
                .order('name');

            if (shopsError) {
                throw new Error(shopsError.message || 'Failed to load shops from database');
            }

            if (!shopsData || shopsData.length === 0) {
                setShops([]);
                setLoading(false);
                return;
            }

            // Filter only PUBLISHED shops for customer visibility (Section 5.4 / 5.5)
            const publishedShopsData = shopsData.filter(s => {
                const meta = parseShopProfileMetadata(s.description);
                return meta.publishStatus === 'PUBLISHED';
            });

            if (publishedShopsData.length === 0) {
                setShops([]);
                setLoading(false);
                return;
            }

            // 2. Fetch Active Pricing from public.shop_pricing for service detection and pricing basis
            const { data: pricingData, error: pricingError } = await supabase
                .from('shop_pricing')
                .select('shop_id, print_mode, paper_size, sides, price_per_sheet')
                .eq('active', true);

            if (pricingError) {
                throw new Error(pricingError.message || 'Failed to load pricing from database');
            }

            // Group pricing by shop
            const pricingByShop: Record<string, {
                bwSingle: number | null;
                colorSingle: number | null;
                bwDouble: number | null;
                colorDouble: number | null;
                hasA4: boolean;
                hasA3: boolean;
                hasBw: boolean;
                hasColor: boolean;
                hasDuplex: boolean;
            }> = {};

            (pricingData || []).forEach(p => {
                const shopId = p.shop_id;
                if (!pricingByShop[shopId]) {
                    pricingByShop[shopId] = {
                        bwSingle: null,
                        colorSingle: null,
                        bwDouble: null,
                        colorDouble: null,
                        hasA4: false,
                        hasA3: false,
                        hasBw: false,
                        hasColor: false,
                        hasDuplex: false,
                    };
                }
                const info = pricingByShop[shopId];
                const price = Number(p.price_per_sheet);
                if (p.paper_size === 'A4') info.hasA4 = true;
                if (p.paper_size === 'A3') info.hasA3 = true;
                if (p.print_mode === 'BW') info.hasBw = true;
                if (p.print_mode === 'COLOUR') info.hasColor = true;
                if (p.sides && p.sides.startsWith('DOUBLE')) info.hasDuplex = true;

                if (p.paper_size === 'A4' && p.sides === 'SINGLE') {
                    if (p.print_mode === 'BW') {
                        info.bwSingle = price;
                    } else if (p.print_mode === 'COLOUR') {
                        info.colorSingle = price;
                    }
                } else if (p.paper_size === 'A4' && (p.sides === 'DOUBLE_LONG_EDGE' || p.sides === 'DOUBLE_SHORT_EDGE')) {
                    if (p.print_mode === 'BW') {
                        if (info.bwDouble === null || price < info.bwDouble) info.bwDouble = price;
                    } else if (p.print_mode === 'COLOUR') {
                        if (info.colorDouble === null || price < info.colorDouble) info.colorDouble = price;
                    }
                }
            });

            const mappedShops: HomepageShop[] = publishedShopsData.map(s => {
                const pricing = pricingByShop[s.id] || {
                    bwSingle: null,
                    colorSingle: null,
                    bwDouble: null,
                    colorDouble: null,
                    hasA4: true,
                    hasA3: false,
                    hasBw: true,
                    hasColor: false,
                    hasDuplex: false,
                };
                const meta = parseShopProfileMetadata(s.description);

                const services: string[] = [];
                if (pricing.hasA4 || (!pricing.hasA4 && !pricing.hasA3)) services.push('A4');
                if (pricing.hasA3) services.push('A3');
                if (pricing.hasBw || pricing.bwSingle != null) services.push('B&W');
                if (pricing.hasColor || pricing.colorSingle != null) services.push('Colour');
                if (pricing.hasDuplex || pricing.bwDouble != null) services.push('Duplex');

                const startingPrice = pricing.bwSingle ?? pricing.colorSingle ?? null;
                const startingPriceBasis = pricing.bwSingle != null
                    ? 'A4 B&W, single-sided'
                    : pricing.colorSingle != null
                    ? 'A4 Colour, single-sided'
                    : 'A4 single-sided';

                return {
                    id: s.id,
                    name: s.name,
                    description: meta.address || s.description,
                    status: (s.status as 'OPEN' | 'PAUSED' | 'CLOSED') || 'CLOSED',
                    openTime: formatTime(s.open_time),
                    closeTime: formatTime(s.close_time),
                    closingSoon: Boolean(s.closing_soon),
                    closingMessage: s.closing_message,
                    priceBwPerPage: pricing.bwSingle,
                    priceColorPerPage: pricing.colorSingle,
                    priceBwDoublePerPage: pricing.bwDouble,
                    priceColorDoublePerPage: pricing.colorDouble,
                    supportedServices: services,
                    startingPrice,
                    startingPriceBasis,
                    imageInitials: getInitials(s.name),
                    imageUrl: meta.photos[0] || undefined,
                };
            });

            setShops(mappedShops);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Unable to connect to database';
            console.error('[Homepage] Supabase query error:', err);
            setError(msg);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchShops();
        window.addEventListener('focus', fetchShops);

        const channel = supabase
            .channel('homepage_shops_changes')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'shops' }, () => {
                fetchShops();
            })
            .subscribe();

        return () => {
            window.removeEventListener('focus', fetchShops);
            supabase.removeChannel(channel);
        };
    }, [fetchShops]);

    const selectShop = (shop: HomepageShop) => {
        setCurrentOrder(prev => ({
            ...prev,
            shopId: shop.id,
            shopName: shop.name,
            method: 'instant',
            scheduledTime: '',
        }));
    };

    // Filtered shops based on search and filter selections
    const filteredShops = useMemo(() => {
        return shops.filter(shop => {
            if (searchQuery.trim()) {
                const q = searchQuery.toLowerCase().trim();
                const matchesName = shop.name.toLowerCase().includes(q);
                const matchesDesc = (shop.description || '').toLowerCase().includes(q);
                if (!matchesName && !matchesDesc) return false;
            }
            if (statusFilter === 'OPEN' && shop.status !== 'OPEN') {
                return false;
            }
            if (serviceFilter === 'COLOUR' && !shop.supportedServices.includes('Colour')) {
                return false;
            }
            if (serviceFilter === 'BW' && !shop.supportedServices.includes('B&W')) {
                return false;
            }
            if (serviceFilter === 'DUPLEX' && !shop.supportedServices.includes('Duplex')) {
                return false;
            }
            return true;
        });
    }, [shops, searchQuery, statusFilter, serviceFilter]);

    const isSingleShop = filteredShops.length === 1;

    return (
        <div className="page-wrapper customer-homepage">
            <section className="section-sm">
                <div className="container">
                    {/* Mobile Greeting Bar */}
                    <div className="mobile-only mobile-home-intro">
                        {user?.name ? (
                            <p>Hello, {user.name.split(' ')[0]}</p>
                        ) : (
                            <p style={{ fontSize: '13px', color: 'var(--fg-muted)' }}>
                                <Link href="/login" style={{ color: 'var(--accent)', fontWeight: '800', textDecoration: 'none' }}>Log in</Link> to place or track print orders
                            </p>
                        )}
                        <h2>What would you like to print?</h2>
                        <div className="mobile-home-actions">
                            <Link className="btn btn-accent" href="#shops">
                                <UploadCloud size={20} />Print Document
                            </Link>
                            <Link className="btn btn-outline" href={user ? '/dashboard/orders' : '/login?redirect=/dashboard/orders'}>
                                My orders
                            </Link>
                        </div>
                    </div>

                    {/* Concise Hero Section (Replacing 2 large introductory boxes per Section 12.1) */}
                    <div className="home-hero-section">
                        <div className="hero-content">
                            <div className="hero-badge">
                                <ShieldCheck size={14} className="hero-badge-icon" />
                                <span>Verified Print Network</span>
                            </div>
                            <h1 className="hero-heading">Instant Printing at Local Print Shops</h1>
                            <p className="hero-subheading">
                                Upload your documents, configure print settings, and collect your finished prints nearby without waiting in line.
                            </p>
                            <div className="hero-actions">
                                <a href="#shops" className="btn btn-accent btn-lg hero-cta">
                                    <UploadCloud size={18} />
                                    <span>Explore Print Shops</span>
                                </a>
                                <Link
                                    href={user ? '/dashboard/orders' : '/login?redirect=/dashboard/orders'}
                                    className="btn btn-outline btn-lg"
                                >
                                    <span>My Orders</span>
                                </Link>
                            </div>
                        </div>
                    </div>

                    {/* Shop Search & Filter Controls */}
                    <div id="shops" className="shops-section-header">
                        <div className="shops-title-area">
                            <h2 className="shops-title">Print Shops</h2>
                            <p className="shops-subtitle">
                                {loading ? 'Loading print shops...' : `${filteredShops.length} ${filteredShops.length === 1 ? 'shop' : 'shops'} ready for instant print orders`}
                            </p>
                        </div>

                        <div className="shops-controls">
                            <div className="shops-search-wrapper">
                                <Search size={15} className="search-icon" />
                                <input
                                    type="text"
                                    className="shops-search-input"
                                    placeholder="Search by shop name or location..."
                                    value={searchQuery}
                                    onChange={e => setSearchQuery(e.target.value)}
                                    aria-label="Search print shops"
                                />
                                {searchQuery && (
                                    <button
                                        type="button"
                                        className="clear-search-btn"
                                        onClick={() => setSearchQuery('')}
                                        aria-label="Clear search"
                                    >
                                        ×
                                    </button>
                                )}
                            </div>

                            <div className="shops-filter-pills" role="toolbar" aria-label="Shop filters">
                                <button
                                    type="button"
                                    className={`filter-pill ${statusFilter === 'ALL' && serviceFilter === 'ALL' ? 'active' : ''}`}
                                    onClick={() => { setStatusFilter('ALL'); setServiceFilter('ALL'); }}
                                >
                                    All
                                </button>
                                <button
                                    type="button"
                                    className={`filter-pill ${statusFilter === 'OPEN' ? 'active' : ''}`}
                                    onClick={() => setStatusFilter(prev => prev === 'OPEN' ? 'ALL' : 'OPEN')}
                                >
                                    Open Now
                                </button>
                                <button
                                    type="button"
                                    className={`filter-pill ${serviceFilter === 'COLOUR' ? 'active' : ''}`}
                                    onClick={() => setServiceFilter(prev => prev === 'COLOUR' ? 'ALL' : 'COLOUR')}
                                >
                                    Colour
                                </button>
                                <button
                                    type="button"
                                    className={`filter-pill ${serviceFilter === 'BW' ? 'active' : ''}`}
                                    onClick={() => setServiceFilter(prev => prev === 'BW' ? 'ALL' : 'BW')}
                                >
                                    B&W
                                </button>
                                <button
                                    type="button"
                                    className={`filter-pill ${serviceFilter === 'DUPLEX' ? 'active' : ''}`}
                                    onClick={() => setServiceFilter(prev => prev === 'DUPLEX' ? 'ALL' : 'DUPLEX')}
                                >
                                    Duplex
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Shop Cards Display Area */}
                    {loading ? (
                        <div className="shops-loading-placeholder">
                            <div className="card shop-skeleton-card">
                                <div className="skeleton-media" />
                                <div className="skeleton-body">
                                    <div className="skeleton-line" style={{ width: '60%', height: '20px' }} />
                                    <div className="skeleton-line" style={{ width: '40%', height: '14px' }} />
                                    <div className="skeleton-line" style={{ width: '75%', height: '14px' }} />
                                </div>
                            </div>
                        </div>
                    ) : error ? (
                        <div className="card" style={{ padding: '32px', textAlign: 'center' }}>
                            <p style={{ fontSize: '14px', color: 'var(--fg-muted)', marginBottom: '14px' }}>
                                {error}
                            </p>
                            <button onClick={fetchShops} className="btn btn-outline btn-sm">
                                Retry Loading
                            </button>
                        </div>
                    ) : shops.length === 0 ? (
                        <div className="card" style={{ padding: '36px', textAlign: 'center' }}>
                            <p style={{ fontSize: '14px', color: 'var(--fg-muted)' }}>
                                No print shops available at the moment. Please check back shortly.
                            </p>
                        </div>
                    ) : filteredShops.length === 0 ? (
                        <div className="card empty-shops-card" style={{ padding: '36px', textAlign: 'center' }}>
                            <p style={{ fontSize: '14px', color: 'var(--fg-muted)', marginBottom: '14px' }}>
                                No print shops found matching your search or filters.
                            </p>
                            <button
                                type="button"
                                className="btn btn-outline btn-sm"
                                onClick={() => { setSearchQuery(''); setStatusFilter('ALL'); setServiceFilter('ALL'); }}
                            >
                                Reset Filters
                            </button>
                        </div>
                    ) : isSingleShop ? (
                        /* Single Shop Scenario (Section 12.1): Well-sized card paired with 3-step guidance */
                        <div className="single-shop-layout">
                            <div className="single-shop-card-wrapper">
                                <ShopCard shop={filteredShops[0]} onSelect={selectShop} />
                            </div>
                            <div className="how-it-works-panel card">
                                <div className="how-header">
                                    <Sparkles size={18} color="var(--accent)" />
                                    <h3 style={{ fontSize: '16px', fontWeight: '800', margin: 0 }}>How XerService Works</h3>
                                </div>
                                <div className="how-steps">
                                    <div className="how-step">
                                        <div className="step-num">1</div>
                                        <div className="step-desc">
                                            <h4>Upload Document</h4>
                                            <p>Upload PDF or image files securely from your phone or laptop.</p>
                                        </div>
                                    </div>
                                    <div className="how-step">
                                        <div className="step-num">2</div>
                                        <div className="step-desc">
                                            <h4>Configure Settings</h4>
                                            <p>Choose B&W or colour, single or double-sided, copies, and orientation.</p>
                                        </div>
                                    </div>
                                    <div className="how-step">
                                        <div className="step-num">3</div>
                                        <div className="step-desc">
                                            <h4>Collect In Minutes</h4>
                                            <p>Pay online and pick up your ready-to-go prints at the shop counter.</p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ) : (
                        /* Standard Responsive Grid (3 col desktop, 2 col tablet, 1 col mobile) */
                        <div className="shops-grid">
                            {filteredShops.map(shop => (
                                <ShopCard key={shop.id} shop={shop} onSelect={selectShop} />
                            ))}
                        </div>
                    )}

                    {/* Compact Secondary WhatsApp Indicator (Section 12.1) */}
                    <div className="compact-whatsapp-indicator">
                        <div className="whatsapp-indicator-header">
                            <MessageCircle size={18} color="#16a34a" />
                            <span style={{ fontWeight: '700', fontSize: '13px' }}>WhatsApp Print Assistant</span>
                            <span className="badge" style={{ fontSize: '10px', marginLeft: 'auto', background: 'rgba(22, 163, 74, 0.1)', color: '#16a34a', border: '1px solid rgba(22, 163, 74, 0.25)' }}>
                                Coming soon
                            </span>
                        </div>
                        <p style={{ margin: 0, fontSize: '12px', color: 'var(--fg-muted)', lineHeight: '1.5' }}>
                            WhatsApp document import is currently being prepared. Upload your files directly through the website for immediate printing.
                        </p>
                    </div>
                </div>
            </section>

            <style>{`
                /* Hero Section */
                .home-hero-section {
                    background: var(--bg);
                    border: 1px solid var(--border);
                    border-radius: 14px;
                    padding: 36px 28px;
                    margin-bottom: 24px;
                    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.02);
                }
                .hero-content {
                    max-width: 680px;
                }
                .hero-badge {
                    display: inline-flex;
                    align-items: center;
                    gap: 6px;
                    font-size: 11px;
                    font-weight: 700;
                    color: var(--accent);
                    background: var(--accent-subtle, rgba(234, 88, 12, 0.08));
                    border: 1px solid var(--accent-border, rgba(234, 88, 12, 0.2));
                    padding: 4px 10px;
                    border-radius: 999px;
                    margin-bottom: 12px;
                }
                .hero-heading {
                    font-size: 28px;
                    font-weight: 900;
                    letter-spacing: -0.02em;
                    line-height: 1.25;
                    margin-bottom: 10px;
                    color: var(--fg);
                }
                .hero-subheading {
                    font-size: 15px;
                    color: var(--fg-muted);
                    line-height: 1.6;
                    margin-bottom: 22px;
                }
                .hero-actions {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    flex-wrap: wrap;
                }
                .hero-cta {
                    text-decoration: none;
                }

                /* Shops Header & Filters */
                .shops-section-header {
                    display: flex;
                    flex-direction: column;
                    gap: 14px;
                    margin-bottom: 20px;
                    scroll-margin-top: 80px;
                }
                .shops-title-area {
                    display: flex;
                    flex-direction: column;
                    gap: 2px;
                }
                .shops-title {
                    font-size: 22px;
                    font-weight: 900;
                    letter-spacing: -0.01em;
                    margin: 0;
                    color: var(--fg);
                }
                .shops-subtitle {
                    font-size: 13px;
                    color: var(--fg-muted);
                    margin: 0;
                }
                .shops-controls {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    flex-wrap: wrap;
                }
                .shops-search-wrapper {
                    position: relative;
                    flex: 1;
                    min-width: 240px;
                }
                .search-icon {
                    position: absolute;
                    left: 12px;
                    top: 50%;
                    transform: translateY(-50%);
                    color: var(--fg-muted);
                    pointer-events: none;
                }
                .shops-search-input {
                    width: 100%;
                    height: 38px;
                    padding: 0 32px 0 34px;
                    border-radius: 999px;
                    border: 1px solid var(--border);
                    background: var(--bg);
                    color: var(--fg);
                    font-size: 13px;
                    outline: none;
                    transition: border-color 0.15s ease;
                }
                .shops-search-input:focus {
                    border-color: var(--accent);
                }
                .clear-search-btn {
                    position: absolute;
                    right: 10px;
                    top: 50%;
                    transform: translateY(-50%);
                    background: none;
                    border: none;
                    font-size: 16px;
                    color: var(--fg-muted);
                    cursor: pointer;
                    padding: 0 4px;
                }
                .shops-filter-pills {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    flex-wrap: wrap;
                }
                .filter-pill {
                    height: 34px;
                    padding: 0 14px;
                    border-radius: 999px;
                    border: 1px solid var(--border);
                    background: var(--bg);
                    color: var(--fg-muted);
                    font-size: 12px;
                    font-weight: 700;
                    cursor: pointer;
                    transition: all 0.15s ease;
                }
                .filter-pill:hover {
                    border-color: var(--fg-muted);
                    color: var(--fg);
                }
                .filter-pill.active {
                    background: var(--fg);
                    color: var(--bg);
                    border-color: var(--fg);
                }

                /* Responsive Grid (Section 12.1: 3 col desktop, 2 col tablet, 1 col mobile) */
                .shops-grid {
                    display: grid;
                    grid-template-columns: repeat(3, minmax(0, 1fr));
                    gap: 18px;
                    margin-bottom: 24px;
                }
                @media (max-width: 980px) {
                    .shops-grid {
                        grid-template-columns: repeat(2, minmax(0, 1fr));
                        gap: 16px;
                    }
                }
                @media (max-width: 640px) {
                    .shops-grid {
                        grid-template-columns: 1fr;
                        gap: 14px;
                    }
                }

                /* Single Shop Presentation Layout */
                .single-shop-layout {
                    display: grid;
                    grid-template-columns: minmax(0, 420px) minmax(0, 1fr);
                    gap: 20px;
                    align-items: start;
                    margin-bottom: 24px;
                }
                .single-shop-card-wrapper {
                    width: 100%;
                }
                .how-it-works-panel {
                    padding: 24px;
                    border-radius: 12px;
                    background: var(--bg);
                    border: 1px solid var(--border);
                    display: flex;
                    flex-direction: column;
                    gap: 18px;
                }
                .how-header {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }
                .how-steps {
                    display: flex;
                    flex-direction: column;
                    gap: 16px;
                }
                .how-step {
                    display: flex;
                    align-items: flex-start;
                    gap: 12px;
                }
                .step-num {
                    width: 28px;
                    height: 28px;
                    border-radius: 50%;
                    background: var(--accent-subtle, rgba(234, 88, 12, 0.1));
                    color: var(--accent);
                    font-size: 13px;
                    font-weight: 900;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    flex-shrink: 0;
                }
                .step-desc h4 {
                    font-size: 14px;
                    font-weight: 800;
                    margin: 0 0 3px 0;
                    color: var(--fg);
                }
                .step-desc p {
                    font-size: 12px;
                    color: var(--fg-muted);
                    margin: 0;
                    line-height: 1.5;
                }
                @media (max-width: 768px) {
                    .single-shop-layout {
                        grid-template-columns: 1fr;
                    }
                }

                /* Vertical Shop Card */
                .shop-card-vertical {
                    display: flex;
                    flex-direction: column;
                    height: 100%;
                    border-radius: 12px;
                    overflow: hidden;
                    background: var(--bg);
                    border: 1px solid var(--border);
                    transition: transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease;
                }
                .shop-card-vertical:hover {
                    transform: translateY(-2px);
                    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.06);
                    border-color: var(--accent);
                }
                .shop-card-media {
                    position: relative;
                    width: 100%;
                    height: 140px;
                    overflow: hidden;
                    background: linear-gradient(135deg, var(--bg-secondary) 0%, rgba(234, 88, 12, 0.06) 100%);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    border-bottom: 1px solid var(--border);
                }
                .shop-media-img {
                    width: 100%;
                    height: 100%;
                    object-fit: cover;
                }
                .shop-initials-fallback {
                    font-size: 28px;
                    font-weight: 900;
                    color: var(--accent);
                    letter-spacing: 0.05em;
                }
                .shop-status-overlay {
                    position: absolute;
                    top: 10px;
                    right: 10px;
                }
                .shop-card-body {
                    display: flex;
                    flex-direction: column;
                    flex: 1;
                    padding: 16px;
                    gap: 10px;
                }
                .shop-title-area {
                    display: flex;
                    flex-direction: column;
                    gap: 4px;
                }
                .shop-name {
                    font-size: 16px;
                    font-weight: 800;
                    letter-spacing: -0.01em;
                    margin: 0;
                    color: var(--fg);
                    line-height: 1.3;
                }
                .shop-location, .shop-hours {
                    display: flex;
                    align-items: center;
                    gap: 5px;
                    font-size: 12px;
                    color: var(--fg-muted);
                    font-weight: 600;
                }
                .shop-location {
                    line-height: 1.4;
                }
                .closing-notice {
                    font-size: 11px;
                    color: var(--accent);
                    font-weight: 700;
                    margin: 0;
                }
                .shop-services-chips {
                    display: flex;
                    gap: 6px;
                    flex-wrap: wrap;
                    margin-top: 2px;
                }
                .service-chip {
                    font-size: 11px;
                    font-weight: 700;
                    padding: 2px 8px;
                    border-radius: 6px;
                    background: var(--bg-secondary);
                    color: var(--fg);
                    border: 1px solid var(--border);
                }
                .shop-pricing-box {
                    margin-top: auto;
                    padding-top: 10px;
                    border-top: 1px dashed var(--border);
                    display: flex;
                    flex-direction: column;
                    gap: 4px;
                }
                .price-basis-row {
                    display: flex;
                    align-items: baseline;
                    gap: 6px;
                    flex-wrap: wrap;
                }
                .price-from {
                    font-size: 13px;
                    color: var(--fg);
                }
                .price-from strong {
                    font-size: 15px;
                    color: var(--accent);
                    font-weight: 800;
                }
                .price-basis-label {
                    font-size: 11px;
                    color: var(--fg-muted);
                    font-weight: 600;
                }
                .color-addon-label {
                    font-size: 11px;
                    color: var(--fg-muted);
                    font-weight: 600;
                }
                .color-addon-label strong {
                    color: var(--fg);
                }
                .shop-card-cta {
                    margin-top: 6px;
                }
                .shop-print-btn {
                    width: 100%;
                    justify-content: center;
                    border-radius: 8px;
                    font-weight: 800;
                    padding: 8px 14px;
                }

                /* Compact Secondary WhatsApp Indicator */
                .compact-whatsapp-indicator {
                    border: 1px solid rgba(22, 163, 74, 0.25);
                    background: var(--bg);
                    border-radius: 10px;
                    padding: 14px 18px;
                    display: flex;
                    flex-direction: column;
                    gap: 6px;
                    margin-top: 14px;
                }
                .whatsapp-indicator-header {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }

                /* Skeletons */
                .shop-skeleton-card {
                    height: 280px;
                    border-radius: 12px;
                    overflow: hidden;
                    display: flex;
                    flex-direction: column;
                }
                .skeleton-media {
                    height: 140px;
                    background: var(--bg-secondary);
                }
                .skeleton-body {
                    padding: 16px;
                    display: flex;
                    flex-direction: column;
                    gap: 10px;
                }
                .skeleton-line {
                    background: var(--bg-secondary);
                    border-radius: 4px;
                }

                @media (max-width: 600px) {
                    .home-hero-section {
                        padding: 24px 18px;
                    }
                    .hero-heading {
                        font-size: 22px;
                    }
                    .hero-subheading {
                        font-size: 13px;
                    }
                }
            `}</style>
        </div>
    );
}

function ShopCard({ shop, onSelect }: { shop: HomepageShop; onSelect: (shop: HomepageShop) => void }) {
    const { user } = useApp();
    const isClosed = shop.status === 'CLOSED';
    const isPaused = shop.status === 'PAUSED';
    const isClosingSoon = shop.status === 'OPEN' && shop.closingSoon;
    const isUnavailable = isClosed || isPaused || isClosingSoon;

    const cardContent = (
        <div
            className="shop-card-vertical"
            style={{
                opacity: isUnavailable ? 0.68 : 1,
                filter: isUnavailable ? 'grayscale(0.28)' : 'none',
                border: `1px solid ${isClosingSoon || isPaused ? 'var(--accent-border)' : 'var(--border)'}`,
            }}
        >
            {/* Media on top (Aspect 16:9 banner) */}
            <div className="shop-card-media">
                {shop.imageUrl ? (
                    <img src={shop.imageUrl} alt={shop.name} className="shop-media-img" />
                ) : (
                    <span className="shop-initials-fallback">{shop.imageInitials}</span>
                )}
                <div className="shop-status-overlay">
                    {isClosed ? (
                        <span className="badge badge-outline" style={{ fontSize: '10px', fontWeight: '800', textTransform: 'uppercase' }}>Closed</span>
                    ) : isPaused ? (
                        <span className="badge badge-accent" style={{ fontSize: '10px', fontWeight: '800', textTransform: 'uppercase' }}><AlertTriangle size={10} /> Paused</span>
                    ) : isClosingSoon ? (
                        <span className="badge badge-accent" style={{ fontSize: '10px', fontWeight: '800', textTransform: 'uppercase' }}><AlertTriangle size={10} /> Closing soon</span>
                    ) : (
                        <span className="badge badge-success" style={{ fontSize: '10px', fontWeight: '800', textTransform: 'uppercase' }}>Open</span>
                    )}
                </div>
            </div>

            {/* Content below */}
            <div className="shop-card-body">
                <div className="shop-title-area">
                    <h3 className="shop-name">{shop.name}</h3>
                    {shop.description && (
                        <div className="shop-location">
                            <MapPin size={12} style={{ flexShrink: 0 }} />
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{shop.description}</span>
                        </div>
                    )}
                    <div className="shop-hours">
                        <Clock size={12} style={{ flexShrink: 0 }} />
                        <span>{shop.openTime} – {shop.closeTime}</span>
                    </div>
                </div>

                {(isClosingSoon || isPaused) && (
                    <p className="closing-notice">
                        {shop.closingMessage || (isPaused ? 'Orders temporarily paused.' : 'Orders paused — closing soon.')}
                    </p>
                )}

                {/* Supported Service Chips */}
                <div className="shop-services-chips">
                    {shop.supportedServices.map(service => (
                        <span key={service} className="service-chip">{service}</span>
                    ))}
                </div>

                {/* Explicit starting price basis */}
                <div className="shop-pricing-box">
                    {shop.startingPrice != null ? (
                        <div className="price-basis-row">
                            <span className="price-from">From <strong>₹{shop.startingPrice.toFixed(2)}</strong></span>
                            <span className="price-basis-label">({shop.startingPriceBasis})</span>
                        </div>
                    ) : (
                        <span className="price-from">Standard rates apply</span>
                    )}
                    {shop.priceColorPerPage != null && (
                        <div className="color-addon-label">
                            Colour from <strong>₹{shop.priceColorPerPage.toFixed(2)}</strong>
                        </div>
                    )}
                </div>

                {/* Action CTA */}
                <div className="shop-card-cta">
                    {!isUnavailable ? (
                        <span className="btn btn-accent btn-sm shop-print-btn">
                            <UploadCloud size={14} />
                            <span>Print here</span>
                        </span>
                    ) : (
                        <span className="btn btn-outline btn-sm shop-print-btn" style={{ opacity: 0.8, pointerEvents: 'none' }}>
                            {isClosed ? 'Closed' : 'Paused'}
                        </span>
                    )}
                </div>
            </div>
        </div>
    );

    if (isUnavailable) {
        return <div aria-disabled="true" style={{ height: '100%' }}>{cardContent}</div>;
    }

    const shopUploadHref = user ? `/order/upload?shop=${shop.id}` : `/login?redirect=${encodeURIComponent(`/order/upload?shop=${shop.id}`)}`;

    return (
        <Link
            href={shopUploadHref}
            onClick={() => onSelect(shop)}
            style={{ textDecoration: 'none', display: 'block', height: '100%' }}
        >
            {cardContent}
        </Link>
    );
}

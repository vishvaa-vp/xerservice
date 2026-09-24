'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useApp } from '@/context/AppContext';
import { supabase } from '@/lib/supabase/client';
import { parseShopProfileMetadata } from '@/lib/shop-profile';
import { AlertTriangle, Clock, UploadCloud, MapPin, Search, Sparkles, SlidersHorizontal, ArrowUpDown, Store, X, ChevronRight } from 'lucide-react';

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

    // Search, filter, and sort states
    const [searchQuery, setSearchQuery] = useState('');
    const [filterOption, setFilterOption] = useState<'ALL' | 'OPEN' | 'COLOUR' | 'BW' | 'DUPLEX'>('ALL');
    const [sortBy, setSortBy] = useState<'RECOMMENDED' | 'PRICE_ASC' | 'PRICE_DESC' | 'NAME_ASC'>('RECOMMENDED');
    const [selectedShopForModal, setSelectedShopForModal] = useState<HomepageShop | null>(null);

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

    // Filtered and sorted shops based on search, filter, and sort selections
    const filteredShops = useMemo(() => {
        const result = shops.filter(shop => {
            if (searchQuery.trim()) {
                const q = searchQuery.toLowerCase().trim();
                const matchesName = shop.name.toLowerCase().includes(q);
                const matchesDesc = (shop.description || '').toLowerCase().includes(q);
                if (!matchesName && !matchesDesc) return false;
            }
            if (filterOption === 'OPEN' && shop.status !== 'OPEN') {
                return false;
            }
            if (filterOption === 'COLOUR' && !shop.supportedServices.includes('Colour')) {
                return false;
            }
            if (filterOption === 'BW' && !shop.supportedServices.includes('B&W')) {
                return false;
            }
            if (filterOption === 'DUPLEX' && !shop.supportedServices.includes('Duplex')) {
                return false;
            }
            return true;
        });

        return result.sort((a, b) => {
            if (sortBy === 'PRICE_ASC') {
                const priceA = a.startingPrice ?? 999999;
                const priceB = b.startingPrice ?? 999999;
                return priceA - priceB;
            }
            if (sortBy === 'PRICE_DESC') {
                const priceA = a.startingPrice ?? -1;
                const priceB = b.startingPrice ?? -1;
                return priceB - priceA;
            }
            if (sortBy === 'NAME_ASC') {
                return a.name.localeCompare(b.name);
            }
            // RECOMMENDED: Open shops first, then alphabetical
            if (a.status === 'OPEN' && b.status !== 'OPEN') return -1;
            if (a.status !== 'OPEN' && b.status === 'OPEN') return 1;
            return a.name.localeCompare(b.name);
        });
    }, [shops, searchQuery, filterOption, sortBy]);

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
                    </div>

                    {/* Shop Search, Filter & Sort Controls */}
                    <div id="shops" className="shops-section-header">
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

                            <div className="shops-filter-sort-controls">
                                <div className="control-select-box">
                                    <SlidersHorizontal size={14} className="control-select-icon" />
                                    <label htmlFor="shop-filter-select" className="control-select-label">Filter:</label>
                                    <select
                                        id="shop-filter-select"
                                        className="shops-select-input"
                                        value={filterOption}
                                        onChange={e => setFilterOption(e.target.value as any)}
                                        aria-label="Filter shops"
                                    >
                                        <option value="ALL">All</option>
                                        <option value="OPEN">Open Now</option>
                                        <option value="COLOUR">Colour</option>
                                        <option value="BW">B&W</option>
                                        <option value="DUPLEX">Duplex</option>
                                    </select>
                                </div>

                                <div className="control-select-box">
                                    <ArrowUpDown size={14} className="control-select-icon" />
                                    <label htmlFor="shop-sort-select" className="control-select-label">Sort by:</label>
                                    <select
                                        id="shop-sort-select"
                                        className="shops-select-input"
                                        value={sortBy}
                                        onChange={e => setSortBy(e.target.value as any)}
                                        aria-label="Sort shops"
                                    >
                                        <option value="RECOMMENDED">Recommended</option>
                                        <option value="PRICE_ASC">Price: Low to High</option>
                                        <option value="PRICE_DESC">Price: High to Low</option>
                                        <option value="NAME_ASC">Name (A-Z)</option>
                                    </select>
                                </div>
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
                                onClick={() => { setSearchQuery(''); setFilterOption('ALL'); setSortBy('RECOMMENDED'); }}
                            >
                                Reset Filters
                            </button>
                        </div>
                    ) : (
                        /* Standard Responsive Grid (3 col desktop, 2 col tablet, 1 col mobile) */
                        <div className="shops-grid">
                            {filteredShops.map(shop => (
                                <ShopCard
                                    key={shop.id}
                                    shop={shop}
                                    onSelect={selectShop}
                                    onOpenModal={setSelectedShopForModal}
                                />
                            ))}
                        </div>
                    )}
                </div>
            </section>

            {/* Shop Details Modal on Mobile */}
            {selectedShopForModal && (
                <ShopDetailsModal
                    shop={selectedShopForModal}
                    onClose={() => setSelectedShopForModal(null)}
                    onSelect={selectShop}
                    user={user}
                />
            )}

            <style>{`
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
                    flex: 1 1 240px;
                    min-width: 200px;
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
                .shops-filter-sort-controls {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    flex-wrap: wrap;
                }
                .control-select-box {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    background: var(--bg);
                    border: 1px solid var(--border);
                    border-radius: 999px;
                    padding: 0 12px;
                    height: 38px;
                    transition: border-color 0.15s ease;
                }
                .control-select-box:focus-within {
                    border-color: var(--accent);
                }
                .control-select-icon {
                    color: var(--fg-muted);
                    flex-shrink: 0;
                }
                .control-select-label {
                    font-size: 12px;
                    font-weight: 700;
                    color: var(--fg-muted);
                    white-space: nowrap;
                    margin: 0;
                }
                .shops-select-input {
                    border: none;
                    background: transparent;
                    color: var(--fg);
                    font-size: 13px;
                    font-weight: 700;
                    outline: none;
                    cursor: pointer;
                    padding: 0 2px;
                }
                @media (max-width: 640px) {
                    .shops-controls {
                        gap: 10px;
                    }
                    .shops-search-wrapper {
                        flex: 1 1 100%;
                        width: 100%;
                    }
                    .shops-filter-sort-controls {
                        width: 100%;
                        display: grid;
                        grid-template-columns: 1fr 1fr;
                        gap: 8px;
                    }
                    .control-select-box {
                        width: 100%;
                        justify-content: flex-start;
                        padding: 0 10px;
                    }
                    .shops-select-input {
                        width: 100%;
                        font-size: 12px;
                    }
                }

                /* Responsive Grid (Section 12.1: 3 col desktop, 2 col tablet, 1 col mobile) */
                .shops-grid {
                    display: grid;
                    grid-template-columns: repeat(3, minmax(0, 1fr));
                    gap: 18px;
                    margin-bottom: 24px;
                    width: 100%;
                }
                @media (max-width: 980px) {
                    .shops-grid {
                        grid-template-columns: repeat(2, minmax(0, 1fr));
                        gap: 16px;
                    }
                }
                @media (max-width: 640px) {
                    .shops-grid {
                        grid-template-columns: minmax(0, 1fr);
                        gap: 14px;
                    }
                }
                .shops-grid > a {
                    min-width: 0;
                    width: 100%;
                    text-decoration: none;
                    display: block;
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
                    min-width: 0;
                    width: 100%;
                    border-radius: 14px;
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
                    min-width: 0;
                    width: 100%;
                    box-sizing: border-box;
                }
                .shop-title-area {
                    display: flex;
                    flex-direction: column;
                    gap: 4px;
                    min-width: 0;
                    width: 100%;
                }
                .shop-name {
                    font-size: 16px;
                    font-weight: 800;
                    letter-spacing: -0.01em;
                    margin: 0;
                    color: var(--fg);
                    line-height: 1.3;
                    min-width: 0;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }
                .shop-location, .shop-hours {
                    display: flex;
                    align-items: center;
                    gap: 5px;
                    font-size: 12px;
                    color: var(--fg-muted);
                    font-weight: 600;
                    min-width: 0;
                    width: 100%;
                }
                .shop-location {
                    line-height: 1.4;
                    overflow: hidden;
                }
                .shop-location > span {
                    min-width: 0;
                    flex: 1;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
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
                    background: linear-gradient(90deg, var(--bg-secondary) 25%, var(--bg-tertiary) 50%, var(--bg-secondary) 75%);
                    background-size: 200% 100%;
                    animation: skeletonShimmer 1.6s ease-in-out infinite;
                }
                .skeleton-body {
                    padding: 16px;
                    display: flex;
                    flex-direction: column;
                    gap: 10px;
                }
                .skeleton-line {
                    background: linear-gradient(90deg, var(--bg-secondary) 25%, var(--bg-tertiary) 50%, var(--bg-secondary) 75%);
                    background-size: 200% 100%;
                    animation: skeletonShimmer 1.6s ease-in-out infinite;
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

                /* Mobile right indicator on shop cards: hidden on desktop */
                .shop-card-mobile-right {
                    display: none;
                }

                /* Shop Details Modal / Bottom Sheet */
                .shop-modal-overlay {
                    position: fixed;
                    inset: 0;
                    z-index: 1200;
                    background: rgba(0, 0, 0, 0.65);
                    backdrop-filter: blur(5px);
                    -webkit-backdrop-filter: blur(5px);
                    display: flex;
                    align-items: flex-end;
                    justify-content: center;
                    animation: fadeInModal 0.2s ease-out;
                }

                @keyframes fadeInModal {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }

                .shop-modal-content {
                    position: relative;
                    width: 100%;
                    max-width: 500px;
                    max-height: 88vh;
                    background: var(--bg-card);
                    border: 1px solid var(--border);
                    border-radius: 24px 24px 0 0;
                    box-shadow: 0 -12px 40px rgba(0, 0, 0, 0.28);
                    display: flex;
                    flex-direction: column;
                    overflow: hidden;
                    animation: slideUpModal 0.28s cubic-bezier(0.16, 1, 0.3, 1) forwards;
                }

                @keyframes slideUpModal {
                    from { transform: translateY(100%); }
                    to { transform: translateY(0); }
                }

                @media (min-width: 769px) {
                    .shop-modal-overlay {
                        align-items: center;
                        padding: 24px;
                    }
                    .shop-modal-content {
                        border-radius: 24px;
                        box-shadow: 0 24px 60px rgba(0, 0, 0, 0.35);
                        animation: scaleInModal 0.2s cubic-bezier(0.16, 1, 0.3, 1) forwards;
                    }
                    @keyframes scaleInModal {
                        from { transform: scale(0.95); opacity: 0; }
                        to { transform: scale(1); opacity: 1; }
                    }
                }

                /* Close button on TOP-LEFT corner */
                .shop-modal-close-left {
                    position: absolute;
                    top: 14px;
                    left: 14px;
                    z-index: 25;
                    width: 38px;
                    height: 38px;
                    border-radius: 50%;
                    background: var(--bg-card);
                    border: 1px solid var(--border);
                    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    color: var(--fg);
                    cursor: pointer;
                    transition: transform 0.15s ease, background 0.15s ease;
                }
                .shop-modal-close-left:hover {
                    background: var(--bg-hover, var(--bg));
                    transform: scale(1.05);
                }
                .shop-modal-close-left:active {
                    transform: scale(0.95);
                }

                /* Status badge on TOP-RIGHT corner */
                .shop-modal-status-badge {
                    position: absolute;
                    top: 14px;
                    right: 14px;
                    z-index: 25;
                }
                .shop-modal-status-badge .badge {
                    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
                    padding: 6px 12px;
                    font-size: 11px;
                    font-weight: 800;
                    text-transform: uppercase;
                }

                /* Banner media */
                .shop-modal-media {
                    position: relative;
                    width: 100%;
                    height: 140px;
                    overflow: hidden;
                    background: linear-gradient(135deg, rgba(84, 189, 206, 0.15) 0%, rgba(13, 148, 136, 0.22) 100%);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    border-bottom: 1px solid var(--border);
                    flex-shrink: 0;
                }
                .shop-modal-img {
                    width: 100%;
                    height: 100%;
                    object-fit: cover;
                }
                .shop-modal-media-fallback {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    gap: 8px;
                }
                .shop-modal-avatar-circle {
                    width: 48px;
                    height: 48px;
                    border-radius: 50%;
                    background: rgba(84, 189, 206, 0.25);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    border: 1.5px solid rgba(84, 189, 206, 0.4);
                    color: var(--accent);
                }
                .shop-modal-initials {
                    font-size: 14px;
                    font-weight: 800;
                    letter-spacing: 0.06em;
                    color: var(--accent);
                    text-transform: uppercase;
                }

                /* Body */
                .shop-modal-body {
                    padding: 18px 20px;
                    overflow-y: auto;
                    display: flex;
                    flex-direction: column;
                    gap: 14px;
                    -webkit-overflow-scrolling: touch;
                }
                .shop-modal-header-info {
                    display: flex;
                    flex-direction: column;
                    gap: 4px;
                }
                .shop-modal-title {
                    font-size: 20px;
                    font-weight: 900;
                    letter-spacing: -0.01em;
                    margin: 0;
                    color: var(--fg);
                }
                .shop-modal-detail-card {
                    display: flex;
                    align-items: flex-start;
                    gap: 12px;
                    padding: 12px 14px;
                    background: var(--bg);
                    border: 1px solid var(--border);
                    border-radius: 14px;
                }
                .shop-modal-detail-icon {
                    color: var(--accent);
                    flex-shrink: 0;
                    margin-top: 2px;
                }
                .shop-modal-detail-text {
                    flex: 1;
                    min-width: 0;
                }
                .shop-modal-detail-label {
                    font-size: 11px;
                    font-weight: 700;
                    text-transform: uppercase;
                    letter-spacing: 0.04em;
                    color: var(--fg-muted);
                    display: block;
                    margin-bottom: 2px;
                }
                .shop-modal-detail-val {
                    font-size: 13.5px;
                    color: var(--fg);
                    margin: 0;
                    line-height: 1.4;
                    word-break: break-word;
                }
                .shop-modal-notice-banner {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    padding: 10px 14px;
                    border-radius: 12px;
                    background: rgba(234, 88, 12, 0.1);
                    border: 1px solid rgba(234, 88, 12, 0.25);
                    color: #ea580c;
                    font-size: 13px;
                    font-weight: 600;
                }
                .shop-modal-section {
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                }
                .shop-modal-section-title {
                    font-size: 12px;
                    font-weight: 800;
                    text-transform: uppercase;
                    letter-spacing: 0.04em;
                    color: var(--fg-muted);
                }
                .shop-modal-chips-row {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 6px;
                }
                .shop-modal-chip {
                    font-size: 12px;
                    padding: 4px 10px;
                }
                .shop-modal-pricing-box {
                    padding: 14px 16px;
                    background: linear-gradient(135deg, var(--accent-muted, rgba(84, 189, 206, 0.08)), var(--bg) 80%);
                    border: 1px solid var(--accent-border, var(--border));
                    border-radius: 14px;
                    display: flex;
                    flex-direction: column;
                    gap: 6px;
                }
                .shop-modal-price-row {
                    display: flex;
                    align-items: baseline;
                    justify-content: space-between;
                    flex-wrap: wrap;
                    gap: 8px;
                }
                .shop-modal-price-val {
                    font-size: 16px;
                    color: var(--fg);
                }
                .shop-modal-price-val strong {
                    color: var(--accent);
                    font-size: 19px;
                }
                .shop-modal-price-sub {
                    font-size: 12px;
                    color: var(--fg-muted);
                }
                .shop-modal-color-rate {
                    font-size: 13px;
                    color: var(--fg-muted);
                }
                .shop-modal-color-rate strong {
                    color: var(--fg);
                }
                .shop-modal-pricing-note {
                    font-size: 11.5px;
                    color: var(--fg-muted);
                    margin: 4px 0 0 0;
                    line-height: 1.35;
                }

                /* Footer CTA */
                .shop-modal-footer {
                    padding: 14px 20px;
                    padding-bottom: max(16px, env(safe-area-inset-bottom));
                    border-top: 1px solid var(--border);
                    background: var(--bg-card);
                    display: flex;
                    flex-direction: column;
                    flex-shrink: 0;
                }
                .shop-modal-cta-btn {
                    width: 100% !important;
                    min-height: 48px !important;
                    font-size: 15px !important;
                    font-weight: 700 !important;
                    border-radius: 12px !important;
                    display: flex !important;
                    align-items: center !important;
                    justify-content: center !important;
                    gap: 8px !important;
                    text-decoration: none !important;
                }
            `}</style>
        </div>
    );
}

function ShopCard({
    shop,
    onSelect,
    onOpenModal,
}: {
    shop: HomepageShop;
    onSelect: (shop: HomepageShop) => void;
    onOpenModal: (shop: HomepageShop) => void;
}) {
    const { user } = useApp();
    const router = useRouter();
    const [imgFailed, setImgFailed] = useState(false);
    const isClosed = shop.status === 'CLOSED';
    const isPaused = shop.status === 'PAUSED';
    const isClosingSoon = shop.status === 'OPEN' && shop.closingSoon;
    const isUnavailable = isClosed || isPaused || isClosingSoon;

    const shopUploadHref = user ? `/order/upload?shop=${shop.id}` : `/login?redirect=${encodeURIComponent(`/order/upload?shop=${shop.id}`)}`;

    const handleCardClick = (e: React.MouseEvent) => {
        if (typeof window !== 'undefined' && window.innerWidth <= 768) {
            e.preventDefault();
            e.stopPropagation();
            onOpenModal(shop);
        } else if (!isUnavailable) {
            onSelect(shop);
        }
    };

    const handlePrintClick = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (!isUnavailable) {
            onSelect(shop);
            router.push(shopUploadHref);
        }
    };

    const cardContent = (
        <div
            className="shop-card-vertical"
            style={{
                opacity: isUnavailable ? 0.68 : 1,
                filter: isUnavailable ? 'grayscale(0.28)' : 'none',
                border: `1px solid ${isClosingSoon || isPaused ? 'var(--accent-border)' : 'var(--border)'}`,
            }}
        >
            {/* Media on top (Aspect 16:9 banner on desktop, compact avatar on mobile) */}
            <div className="shop-card-media">
                {shop.imageUrl && !imgFailed ? (
                    <img
                        src={shop.imageUrl}
                        alt={shop.name}
                        className="shop-media-img"
                        onError={() => setImgFailed(true)}
                    />
                ) : (
                    <div className="shop-media-fallback-inner" style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '8px',
                        width: '100%',
                        height: '100%',
                        background: 'linear-gradient(135deg, rgba(84, 189, 206, 0.12) 0%, rgba(13, 148, 136, 0.18) 100%)',
                    }}>
                        <div className="shop-media-avatar-circle" style={{
                            width: '46px',
                            height: '46px',
                            borderRadius: '50%',
                            background: 'rgba(84, 189, 206, 0.2)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            border: '1.5px solid rgba(84, 189, 206, 0.35)',
                            color: 'var(--accent)',
                        }}>
                            <Store size={24} />
                        </div>
                        <span className="shop-media-initials" style={{
                            fontSize: '13px',
                            fontWeight: '800',
                            letterSpacing: '0.06em',
                            color: 'var(--accent)',
                            textTransform: 'uppercase',
                        }}>
                            {shop.imageInitials || shop.name.slice(0, 2).toUpperCase()}
                        </span>
                    </div>
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
                        <span
                            role="button"
                            tabIndex={0}
                            className="btn btn-accent btn-sm shop-print-btn"
                            onClick={handlePrintClick}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                    handlePrintClick(e as any);
                                }
                            }}
                        >
                            <UploadCloud size={14} />
                            <span>Print here</span>
                        </span>
                    ) : (
                        <span className="btn btn-outline btn-sm shop-print-btn" style={{ opacity: 0.8, pointerEvents: 'none' }}>
                            {isClosed ? 'Closed' : 'Paused'}
                        </span>
                    )}
                    {/* Mobile right status & chevron */}
                    <div className="shop-card-mobile-right">
                        <span className={`badge ${isClosed ? 'badge-outline' : isPaused || isClosingSoon ? 'badge-accent' : 'badge-success'}`} style={{ fontSize: '10px', fontWeight: '800', textTransform: 'uppercase' }}>
                            {isClosed ? 'Closed' : isPaused ? 'Paused' : isClosingSoon ? 'Closing' : 'Open'}
                        </span>
                        <ChevronRight size={16} className="shop-card-mobile-chevron" />
                    </div>
                </div>
            </div>
        </div>
    );

    if (isUnavailable) {
        return (
            <div
                onClick={handleCardClick}
                aria-disabled="true"
                style={{ height: '100%', cursor: 'pointer' }}
            >
                {cardContent}
            </div>
        );
    }

    return (
        <Link
            href={shopUploadHref}
            onClick={handleCardClick}
            style={{ textDecoration: 'none', display: 'block', height: '100%' }}
        >
            {cardContent}
        </Link>
    );
}

function ShopDetailsModal({
    shop,
    onClose,
    onSelect,
    user,
}: {
    shop: HomepageShop;
    onClose: () => void;
    onSelect: (shop: HomepageShop) => void;
    user: any;
}) {
    const isClosed = shop.status === 'CLOSED';
    const isPaused = shop.status === 'PAUSED';
    const isClosingSoon = shop.status === 'OPEN' && shop.closingSoon;
    const isUnavailable = isClosed || isPaused || isClosingSoon;
    const [imgFailed, setImgFailed] = useState(false);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleKeyDown);
        const originalOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            document.body.style.overflow = originalOverflow;
        };
    }, [onClose]);

    const shopUploadHref = user
        ? `/order/upload?shop=${shop.id}`
        : `/login?redirect=${encodeURIComponent(`/order/upload?shop=${shop.id}`)}`;

    return (
        <div
            className="shop-modal-overlay"
            onClick={onClose}
            role="dialog"
            aria-modal="true"
            aria-labelledby="shop-modal-title"
        >
            <div className="shop-modal-content" onClick={e => e.stopPropagation()}>
                {/* Close Button at Top-Left Corner */}
                <button
                    type="button"
                    className="shop-modal-close-left"
                    onClick={onClose}
                    aria-label="Close details"
                >
                    <X size={20} />
                </button>

                {/* Status Badge at Top-Right Corner */}
                <div className="shop-modal-status-badge">
                    {isClosed ? (
                        <span className="badge badge-outline">Closed</span>
                    ) : isPaused ? (
                        <span className="badge badge-accent"><AlertTriangle size={11} /> Paused</span>
                    ) : isClosingSoon ? (
                        <span className="badge badge-accent"><AlertTriangle size={11} /> Closing soon</span>
                    ) : (
                        <span className="badge badge-success">Open</span>
                    )}
                </div>

                {/* Banner Media */}
                <div className="shop-modal-media">
                    {shop.imageUrl && !imgFailed ? (
                        <img
                            src={shop.imageUrl}
                            alt={shop.name}
                            className="shop-modal-img"
                            onError={() => setImgFailed(true)}
                        />
                    ) : (
                        <div className="shop-modal-media-fallback">
                            <div className="shop-modal-avatar-circle">
                                <Store size={28} />
                            </div>
                            <span className="shop-modal-initials">
                                {shop.imageInitials || shop.name.slice(0, 2).toUpperCase()}
                            </span>
                        </div>
                    )}
                </div>

                {/* Modal Body: Scrollable */}
                <div className="shop-modal-body">
                    <div className="shop-modal-header-info">
                        <h2 id="shop-modal-title" className="shop-modal-title">{shop.name}</h2>
                    </div>

                    {/* Place / Location */}
                    <div className="shop-modal-detail-card">
                        <div className="shop-modal-detail-icon">
                            <MapPin size={18} />
                        </div>
                        <div className="shop-modal-detail-text">
                            <span className="shop-modal-detail-label">Location / Address</span>
                            <p className="shop-modal-detail-val">{shop.description || 'Address provided upon checkout'}</p>
                        </div>
                    </div>

                    {/* Operating Hours */}
                    <div className="shop-modal-detail-card">
                        <div className="shop-modal-detail-icon">
                            <Clock size={18} />
                        </div>
                        <div className="shop-modal-detail-text">
                            <span className="shop-modal-detail-label">Operating Hours</span>
                            <p className="shop-modal-detail-val">{shop.openTime} – {shop.closeTime}</p>
                        </div>
                    </div>

                    {/* Closing / Pause Alert Notice */}
                    {(isClosingSoon || isPaused) && (
                        <div className="shop-modal-notice-banner">
                            <AlertTriangle size={16} />
                            <span>{shop.closingMessage || (isPaused ? 'Orders temporarily paused.' : 'Orders paused — closing soon.')}</span>
                        </div>
                    )}

                    {/* Available Services */}
                    {shop.supportedServices && shop.supportedServices.length > 0 && (
                        <div className="shop-modal-section">
                            <span className="shop-modal-section-title">Supported Services</span>
                            <div className="shop-modal-chips-row">
                                {shop.supportedServices.map(service => (
                                    <span key={service} className="service-chip shop-modal-chip">{service}</span>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Pricing Breakdown */}
                    <div className="shop-modal-section">
                        <span className="shop-modal-section-title">Pricing & Rates</span>
                        <div className="shop-modal-pricing-box">
                            {shop.startingPrice != null ? (
                                <div className="shop-modal-price-row">
                                    <div>
                                        <div className="shop-modal-price-val">
                                            From <strong>₹{shop.startingPrice.toFixed(2)}</strong>
                                        </div>
                                        <div className="shop-modal-price-sub">({shop.startingPriceBasis})</div>
                                    </div>
                                    {shop.priceColorPerPage != null && (
                                        <div className="shop-modal-color-rate">
                                            Colour from <strong>₹{shop.priceColorPerPage.toFixed(2)}</strong>
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div className="shop-modal-price-val">Standard print rates apply</div>
                            )}
                            <p className="shop-modal-pricing-note">
                                Live preview and exact pricing will be calculated when you upload your document.
                            </p>
                        </div>
                    </div>
                </div>

                {/* Sticky Action Footer: Print Here button */}
                <div className="shop-modal-footer">
                    {!isUnavailable ? (
                        <Link
                            href={shopUploadHref}
                            className="btn btn-accent btn-lg shop-modal-cta-btn"
                            onClick={() => {
                                onSelect(shop);
                                onClose();
                            }}
                        >
                            <UploadCloud size={20} />
                            <span>Print here</span>
                        </Link>
                    ) : (
                        <button
                            type="button"
                            disabled
                            className="btn btn-outline btn-lg shop-modal-cta-btn"
                            style={{ opacity: 0.65, cursor: 'not-allowed', width: '100%' }}
                        >
                            {isClosed ? 'Shop is Currently Closed' : 'Orders Temporarily Paused'}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}

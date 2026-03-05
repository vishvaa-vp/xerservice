'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { mockShops, Shop } from '@/lib/mock-data';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useApp } from '@/context/AppContext';
import { MapPin, Search, Signal, Star, Clock, ChevronRight, AlertTriangle, Navigation } from 'lucide-react';
// Dynamically import the Map component to prevent SSR issues with Leaflet
const ShopMap = dynamic(() => import('@/components/ui/ShopMap').then(mod => mod.default), {
    ssr: false,
    loading: () => <div style={{ height: '400px', width: '100%', background: 'var(--bg-secondary)', borderRadius: 'var(--radius)', border: '1.5px solid var(--border)', marginBottom: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><span className="spinner" /></div>
});

type SortOption = 'distance_asc' | 'distance_desc' | 'rating_desc' | 'rating_asc' | 'price_asc' | 'price_desc';

export default function ShopsPage() {
    const { isLoggedIn } = useApp();
    const router = useRouter();
    const [locationGranted, setLocationGranted] = useState(false);
    const [manualLocation, setManualLocation] = useState('');
    const [search, setSearch] = useState('');
    const [sort, setSort] = useState<SortOption>('distance_asc');
    const [fetching, setFetching] = useState(false);

    useEffect(() => {
        if (!isLoggedIn) {
            router.replace('/login?redirect=/shops');
        }
    }, [isLoggedIn, router]);

    if (!isLoggedIn) {
        return (
            <div style={{ minHeight: '70vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span className="spinner spinner-lg" />
            </div>
        );
    }

    const handleFetchLocation = () => {
        setFetching(true);
        setTimeout(() => {
            setLocationGranted(true);
            setFetching(false);
            setManualLocation('Current Location');
        }, 1200);
    };

    let shops = [...mockShops];
    if (search) shops = shops.filter(s => s.name.toLowerCase().includes(search.toLowerCase()) || s.address.toLowerCase().includes(search.toLowerCase()));

    shops.sort((a, b) => {
        switch (sort) {
            case 'distance_asc': return a.distance - b.distance;
            case 'distance_desc': return b.distance - a.distance;
            case 'rating_desc': return b.rating - a.rating;
            case 'rating_asc': return a.rating - b.rating;
            case 'price_asc': return a.pricePerPage - b.pricePerPage;
            case 'price_desc': return b.pricePerPage - a.pricePerPage;
            default: return 0;
        }
    });

    return (
        <div className="page-wrapper">
            {/* Header */}
            <section style={{ padding: '60px 0 32px' }}>
                <div className="container">
                    <div>
                        <h1 style={{ fontSize: '36px', fontWeight: '900', letterSpacing: '-0.04em', marginBottom: '8px' }}>Explore Print Centers</h1>
                        <p style={{ fontSize: '16px', color: 'var(--fg-muted)' }}>
                            {locationGranted ? `Browse high-quality print centers in ${manualLocation === 'Current Location' ? 'Tamil Nadu' : manualLocation}` : 'Discover the best printing spots across Tamil Nadu'}
                        </p>
                    </div>
                </div>
            </section>

            {/* Controls */}
            <section style={{ borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)', padding: '24px 0', background: 'var(--bg-glass)', position: 'sticky', top: '64px', zIndex: 90, backdropFilter: 'blur(20px)' }}>
                <div className="container" style={{ display: 'flex', gap: '20px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <div style={{ flex: '1', minWidth: '300px', display: 'flex', gap: '12px' }}>
                        <div style={{ position: 'relative', flex: 1 }}>
                            <Search size={20} style={{ position: 'absolute', left: '18px', top: '50%', transform: 'translateY(-50%)', color: 'var(--fg-subtle)' }} />
                            <input className="input" placeholder="Search by name, area or pincode..." value={search}
                                onChange={e => setSearch(e.target.value)} style={{ paddingLeft: '52px', height: '56px', width: '100%', borderRadius: '18px', border: 'none', background: 'var(--bg-secondary)', fontWeight: '600', fontSize: '15px' }} />
                        </div>
                        <button onClick={handleFetchLocation} disabled={fetching} className="btn btn-primary" style={{ height: '56px', width: '56px', padding: '0', borderRadius: '18px', flexShrink: 0 }}>
                            {fetching ? <span className="spinner" /> : <Navigation size={20} />}
                        </button>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'var(--bg-secondary)', padding: '4px 8px 4px 16px', borderRadius: '18px' }}>
                        <span style={{ fontSize: '13px', fontWeight: '800', color: 'var(--fg-subtle)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Sort:</span>
                        <select value={sort} onChange={e => setSort(e.target.value as SortOption)}
                            style={{ height: '48px', padding: '0 12px', background: 'transparent', border: 'none', fontSize: '15px', fontWeight: '700', color: 'var(--fg)', cursor: 'pointer', outline: 'none' }}>
                            <option value="distance_asc">Nearest First</option>
                            <option value="distance_desc">Farthest First</option>
                            <option value="rating_desc">Highest Rated</option>
                            <option value="rating_asc">Lowest Rated</option>
                            <option value="price_asc">Price (Low to High)</option>
                            <option value="price_desc">Price (High to Low)</option>
                        </select>
                    </div>
                </div>
            </section>

            {/* Shop list & Map Layout */}
            <section className="section-sm">
                <div className="container">
                    <div className="shops-layout">
                        {/* Left Side: Shop List */}
                        <div className="shops-list">
                            {shops.length === 0 ? (
                                <div style={{ textAlign: 'center', padding: '120px 0', background: 'var(--bg-secondary)', borderRadius: '32px', border: '2px dashed var(--border)' }}>
                                    <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '24px', color: 'var(--fg-subtle)' }}>
                                        <Search size={72} style={{ opacity: 0.1 }} />
                                    </div>
                                    <h3 style={{ fontSize: '22px', fontWeight: '800', marginBottom: '12px' }}>No shops matched your search</h3>
                                    <p style={{ fontSize: '16px', color: 'var(--fg-muted)' }}>Try searching for a broader term or different area in Tamil Nadu.</p>
                                </div>
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                                    {shops.map(shop => <ShopCard key={shop.id} shop={shop} />)}
                                </div>
                            )}
                        </div>
                        {/* Right Side: Map */}
                        <div className="shops-map" style={{ position: 'sticky', top: '164px', height: 'calc(100vh - 200px)' }}>
                            <ShopMap shops={shops} />
                        </div>
                    </div>
                </div>
            </section>
            <style>{`
                .shops-layout {
                    display: grid;
                    grid-template-columns: 1fr 450px;
                    gap: 32px;
                    align-items: start;
                }
                @media (max-width: 992px) {
                    .shops-layout {
                        grid-template-columns: 1fr;
                    }
                    .shops-map {
                        position: relative !important;
                        top: 0 !important;
                        height: 400px !important;
                        order: -1;
                        margin-bottom: 32px;
                    }
                }
            `}</style>
        </div>
    );
}

function ShopCard({ shop }: { shop: Shop }) {
    const isClosed = !shop.isOpen;

    return (
        <div style={{ textDecoration: 'none' }}>
            {isClosed ? (
                <div className="card" style={{ display: 'flex', gap: '24px', padding: '32px', alignItems: 'center', opacity: 0.5, cursor: 'not-allowed', filter: 'grayscale(0.6)', pointerEvents: 'none' }}>
                    <ShopCardInner shop={shop} isClosed={true} />
                </div>
            ) : (
                <Link href={`/shops/${shop.id}`} style={{ textDecoration: 'none' }}>
                    <div className="card card-hover" style={{ display: 'flex', gap: '24px', padding: '32px', alignItems: 'center', cursor: 'pointer', border: '1.5px solid var(--border)' }}>
                        <ShopCardInner shop={shop} isClosed={false} />
                    </div>
                </Link>
            )}
        </div>
    );
}

function ShopCardInner({ shop, isClosed }: { shop: Shop; isClosed: boolean }) {
    return (
        <>
            {/* Avatar */}
            <div style={{ width: '64px', height: '64px', borderRadius: '18px', background: isClosed ? 'var(--fg-subtle)' : 'var(--fg)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: !isClosed ? 'var(--shadow-sm)' : 'none' }}>
                <span style={{ color: 'var(--bg)', fontSize: '18px', fontWeight: '900' }}>{shop.imageInitials}</span>
            </div>

            {/* Info */}
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: '6px' }}>
                    <h2 style={{ fontSize: '20px', fontWeight: '800', letterSpacing: '-0.02em' }}>{shop.name}</h2>
                    {isClosed && (
                        <span className="badge badge-outline" style={{ fontSize: '10px', fontWeight: '800', textTransform: 'uppercase', color: 'var(--fg-subtle)' }}>
                            Currently Closed
                        </span>
                    )}
                    {!isClosed && shop.closingSoon && (
                        <span className="badge badge-accent" style={{ fontSize: '10px', fontWeight: '800', textTransform: 'uppercase' }}>
                            <AlertTriangle size={12} /> Closing Soon
                        </span>
                    )}
                </div>
                <p style={{ fontSize: '14px', color: 'var(--fg-muted)', marginBottom: '16px' }}>{shop.address}</p>
                <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '14px', color: 'var(--fg)', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '6px' }}><Star size={16} fill="#f59e0b" color="#f59e0b" /> {shop.rating}</span>
                    <span style={{ fontSize: '14px', color: 'var(--fg-muted)', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '6px' }}><MapPin size={16} /> {shop.distance} km away</span>
                    <span style={{ fontSize: '14px', color: 'var(--fg-muted)', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '6px' }}><Clock size={16} /> {shop.openTime} – {shop.closeTime}</span>
                    <div style={{ marginLeft: 'auto', fontSize: '15px', fontWeight: '800', color: 'var(--accent)' }}>
                        From ₹{shop.pricePerPage}/page
                    </div>
                </div>
            </div>

            {/* Arrow */}
            {!isClosed && (
                <div style={{ flexShrink: 0, alignSelf: 'center', color: 'var(--fg-subtle)', background: 'var(--bg-secondary)', width: '40px', height: '40px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <ChevronRight size={20} />
                </div>
            )}
        </>
    );
}


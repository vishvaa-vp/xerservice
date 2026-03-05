'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { mockShops } from '@/lib/mock-data';
import { useApp } from '@/context/AppContext';
import Link from 'next/link';
import { Star, MapPin, Clock, AlertTriangle, ShieldCheck, Zap, Info, Award } from 'lucide-react';

export default function ShopDetailPage({ params }: { params: { id: string } }) {
    const { id } = params;
    const shop = mockShops.find(s => s.id === id);
    const [activeTab, setActiveTab] = useState<'overview' | 'services' | 'reviews'>('overview');
    const { setCurrentOrder, isLoggedIn } = useApp();
    const router = useRouter();

    useEffect(() => {
        if (!isLoggedIn) {
            router.replace(`/login?redirect=${encodeURIComponent(`/shops/${id}`)}`);
        }
    }, [isLoggedIn, router, id]);

    if (!isLoggedIn) {
        return (
            <div style={{ minHeight: '70vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span className="spinner spinner-lg" />
            </div>
        );
    }

    if (!shop) return (
        <div style={{ textAlign: 'center', padding: '120px 24px' }}>
            <p style={{ fontSize: '18px', color: 'var(--fg-muted)' }}>Shop not found.</p>
            <Link href="/shops" className="btn btn-outline" style={{ marginTop: '24px' }}>Back to Shops</Link>
        </div>
    );

    const handleStartOrder = () => {
        setCurrentOrder(prev => ({ ...prev, shopId: shop.id, shopName: shop.name }));
        router.push('/order/upload');
    };

    const isClosed = !shop.isOpen;

    return (
        <div className="page-wrapper">
            <section style={{ borderBottom: '1px solid var(--border)', padding: '60px 0 40px', background: 'var(--bg-glass)' }}>
                <div className="container">
                    <Link href="/shops" style={{ fontSize: '14px', color: 'var(--fg-muted)', marginBottom: '32px', display: 'inline-flex', alignItems: 'center', gap: '8px', fontWeight: '600' }}>
                        ← Back to Shops
                    </Link>
                    <div style={{ display: 'flex', gap: '40px', alignItems: 'center', flexWrap: 'wrap' }}>
                        <div style={{ width: '120px', height: '120px', borderRadius: '32px', background: isClosed ? 'var(--fg-subtle)' : 'var(--fg)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: 'var(--shadow-lg)' }}>
                            <span style={{ color: 'var(--bg)', fontSize: '40px', fontWeight: '900' }}>{shop.imageInitials}</span>
                        </div>
                        <div style={{ flex: 1, minWidth: '300px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap', marginBottom: '12px' }}>
                                <h1 style={{ fontSize: '36px', fontWeight: '900', letterSpacing: '-0.04em' }}>{shop.name}</h1>
                                {isClosed ? (
                                    <span className="badge badge-outline" style={{ color: 'var(--fg-subtle)', background: 'var(--bg-secondary)', padding: '6px 12px' }}>Currently Closed</span>
                                ) : (
                                    <span className="badge badge-success" style={{ padding: '6px 12px' }}>Open Now</span>
                                )}
                                {!isClosed && shop.closingSoon && (
                                    <span className="badge badge-accent" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                        <AlertTriangle size={14} /> Closing Soon
                                    </span>
                                )}
                            </div>
                            <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap', color: 'var(--fg-muted)', fontSize: '15px', marginBottom: '20px', fontWeight: '600' }}>
                                <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Star size={18} fill="#f59e0b" color="#f59e0b" /> {shop.rating} ({shop.reviewCount} reviews)</span>
                                <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><MapPin size={18} /> {shop.distance} km from you</span>
                                <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Clock size={18} /> {shop.openTime} – {shop.closeTime}</span>
                            </div>
                            <p style={{ color: 'var(--fg-muted)', fontSize: '15px', maxWidth: '600px', lineHeight: '1.6' }}>{shop.address}</p>
                        </div>
                        <div style={{ flexShrink: 0 }}>
                            {isClosed ? (
                                <button className="btn btn-lg" disabled style={{ opacity: 0.4, cursor: 'not-allowed', background: 'var(--fg-subtle)', color: 'var(--bg)', border: 'none', padding: '18px 36px', borderRadius: '18px', fontWeight: '800' }}>
                                    Shop is Closed
                                </button>
                            ) : (
                                <button onClick={handleStartOrder} className="btn btn-accent btn-lg" style={{ padding: '18px 48px', borderRadius: '18px', fontSize: '17px', fontWeight: '800', boxShadow: 'var(--shadow-accent)' }}>
                                    Upload & Print Here <Zap size={20} style={{ marginLeft: '8px' }} />
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            </section>

            <section className="section-sm">
                <div className="container">
                    <div className="tabs" style={{ marginBottom: '40px' }}>
                        {(['overview', 'services', 'reviews'] as const).map(tab => (
                            <button key={tab} className={`tab-btn ${activeTab === tab ? 'active' : ''}`}
                                onClick={() => setActiveTab(tab)}
                                style={{ fontSize: '15px', paddingBottom: '16px' }}>
                                {tab.charAt(0).toUpperCase() + tab.slice(1)}
                            </button>
                        ))}
                    </div>

                    {activeTab === 'overview' && (
                        <div className="fade-in">
                            <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: '32px' }}>
                                <div className="card" style={{ padding: '40px', borderRadius: '24px' }}>
                                    <h2 style={{ fontSize: '22px', fontWeight: '800', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                                        <Info size={22} color="var(--accent)" /> About this shop
                                    </h2>
                                    <p style={{ fontSize: '16px', color: 'var(--fg-muted)', lineHeight: '1.8' }}>{shop.description}</p>

                                    <div style={{ marginTop: '40px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                                        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                                            <div style={{ width: '40px', height: '40px', borderRadius: '12px', background: 'var(--accent-muted)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                <ShieldCheck size={20} />
                                            </div>
                                            <span style={{ fontSize: '14px', fontWeight: '600' }}>Verified Partner</span>
                                        </div>
                                        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                                            <div style={{ width: '40px', height: '40px', borderRadius: '12px', background: 'var(--accent-muted)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                <Zap size={20} />
                                            </div>
                                            <span style={{ fontSize: '14px', fontWeight: '600' }}>Instant Processing</span>
                                        </div>
                                    </div>
                                </div>

                                <div className="card" style={{ padding: '40px', borderRadius: '24px', border: '2px solid var(--accent-border)', background: 'var(--accent-muted)' }}>
                                    <h2 style={{ fontSize: '22px', fontWeight: '800', marginBottom: '8px' }}>Pricing</h2>
                                    <p style={{ fontSize: '14px', color: 'var(--fg-muted)', marginBottom: '32px' }}>Starting price for high-quality prints</p>

                                    <div style={{ textAlign: 'center', padding: '32px', background: 'var(--bg)', borderRadius: '20px', border: '1px solid var(--border)', marginBottom: '24px' }}>
                                        <div style={{ fontSize: '48px', fontWeight: '900', color: 'var(--fg)', letterSpacing: '-0.04em' }}>₹{shop.pricePerPage.toFixed(2)}</div>
                                        <div style={{ fontSize: '14px', fontWeight: '700', color: 'var(--fg-subtle)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Per Page (B&W)</div>
                                    </div>

                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--accent)', background: 'white', padding: '12px 16px', borderRadius: '12px', border: '1px solid var(--accent-border)' }}>
                                        <Award size={20} />
                                        <span style={{ fontSize: '14px', fontWeight: '800' }}>Bulk discounts available for large orders!</span>
                                    </div>

                                    <p style={{ fontSize: '13px', color: 'var(--fg-subtle)', marginTop: '20px', textAlign: 'center', fontWeight: '500' }}>
                                        Color printing: 3.5x the B&W rate
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab === 'services' && (
                        <div className="fade-in">
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '20px' }}>
                                {shop.services.map(s => (
                                    <div key={s} className="card" style={{ padding: '24px', display: 'flex', alignItems: 'center', gap: '16px', borderRadius: '20px' }}>
                                        <div style={{ width: '12px', height: '12px', borderRadius: '4px', background: 'var(--accent)', flexShrink: 0 }} />
                                        <span style={{ fontSize: '15px', fontWeight: '700' }}>{s}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {activeTab === 'reviews' && (
                        <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '24px', maxWidth: '800px' }}>
                            {shop.reviews.map(review => (
                                <div key={review.id} className="card" style={{ padding: '32px', borderRadius: '24px' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
                                        <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                                            <div style={{ width: '48px', height: '48px', borderRadius: '16px', background: 'var(--fg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                <span style={{ color: 'var(--bg)', fontSize: '18px', fontWeight: '800' }}>{review.author[0]}</span>
                                            </div>
                                            <div>
                                                <p style={{ fontSize: '16px', fontWeight: '800' }}>{review.author}</p>
                                                <p style={{ fontSize: '13px', color: 'var(--fg-subtle)', fontWeight: '500' }}>{review.date}</p>
                                            </div>
                                        </div>
                                        <div style={{ display: 'flex', gap: '4px' }}>
                                            {Array.from({ length: 5 }).map((_, i) => (
                                                <Star key={i} size={16} fill={i < review.rating ? '#f59e0b' : 'none'} color={i < review.rating ? '#f59e0b' : 'var(--border)'} />
                                            ))}
                                        </div>
                                    </div>
                                    <p style={{ fontSize: '15px', color: 'var(--fg-muted)', lineHeight: '1.7' }}>{review.comment}</p>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </section>
        </div>
    );
}


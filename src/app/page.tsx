import Link from 'next/link';
import {
    Zap,
    MapPin,
    ShieldCheck,
    FileText,
    ArrowRight,
    Search,
    UploadCloud,
    CheckCircle2,
    Printer,
    Users,
    ChevronDown,
    Award,
    QrCode,
    Smartphone
} from 'lucide-react';

export default function HomePage() {
    const steps = [
        {
            n: '01',
            title: 'Find a Shop',
            desc: 'Browse 5000+ local print shops in Tamil Nadu. Filter by price, rating, or distance.',
            icon: <Search size={28} />
        },
        {
            n: '02',
            title: 'Upload Specs',
            desc: 'Upload PDFs, Word docs, or images. Choose color, sides, and paper quality.',
            icon: <UploadCloud size={28} />
        },
        {
            n: '03',
            title: 'Print & Go',
            desc: 'Order is sent instantly. Pay securely and pick up your documents when ready.',
            icon: <CheckCircle2 size={28} />
        },
    ];

    const highlights = [
        {
            icon: <Zap size={32} />,
            title: 'Zero Waiting Time',
            desc: 'No more standing in lines at local Xerox shops. Order ahead and pick up.',
            color: '#fb923c',
            href: '/shops'
        },
        {
            icon: <MapPin size={32} />,
            title: 'Hyper Local',
            desc: 'We pinpoint print shops within walking distance of your current location.',
            color: '#3b82f6',
            href: '/shops'
        },
        {
            icon: <ShieldCheck size={32} />,
            title: 'Secure Gateway',
            desc: '100% encrypted document handling and secure UPI payment processing.',
            color: '#10b981',
            href: '/about#security'
        },
        {
            icon: <Users size={32} />,
            title: 'Vibrant Community',
            desc: 'Join 50k+ users sharing tips, shop reviews, and feature requests.',
            color: '#8b5cf6',
            href: '/community'
        },
    ];

    return (
        <div className="pb-20">
            {/* Hero Section */}
            <section className="hero-gradient" style={{ padding: '120px 0 100px', textAlign: 'center', position: 'relative' }}>
                <div className="container-sm">
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', background: 'var(--bg)', padding: '6px 16px', borderRadius: '100px', border: '1.5px solid var(--border)', marginBottom: '32px', fontSize: '12px', fontWeight: '800', letterSpacing: '0.04em' }}>
                        <span style={{ color: 'var(--accent)' }}>●</span> TN'S FINEST PRINTING NETWORK
                    </div>
                    <h1 style={{ fontSize: 'clamp(40px, 8vw, 84px)', fontWeight: '900', letterSpacing: '-0.06em', lineHeight: '0.95', marginBottom: '24px' }}>
                        The Future of <br />
                        <span className="gradient-text">Local Printing</span>
                    </h1>
                    <p style={{ fontSize: '19px', color: 'var(--fg-muted)', lineHeight: '1.7', marginBottom: '48px', maxWidth: '540px', margin: '0 auto 48px' }}>
                        Stop waiting in line. Upload your documents to any shop in Tamilnadu and get them printed instantly.
                    </p>
                    <div style={{ display: 'flex', gap: '16px', justifyContent: 'center', flexWrap: 'wrap' }}>
                        <Link href="/shops" className="btn btn-accent btn-lg" style={{ padding: '16px 36px', borderRadius: '14px', fontSize: '16px', fontWeight: '800' }}>
                            Find nearby shops <ArrowRight size={20} />
                        </Link>
                        <Link href="/how-it-works" className="btn btn-ghost btn-lg" style={{ fontWeight: '700' }}>See how it works</Link>
                    </div>
                </div>

                <div style={{ position: 'absolute', bottom: '20px', left: '50%', transform: 'translateX(-50%)', opacity: 0.3, animation: 'bounce 2s infinite' }}>
                    <ChevronDown size={24} />
                </div>
            </section>

            {/* Stats */}
            <section style={{ padding: '48px 0', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)', background: 'var(--bg)' }}>
                <div className="container" style={{ display: 'flex', justifyContent: 'space-around', gap: '32px', flexWrap: 'wrap' }}>
                    {[
                        ['5000+', 'Print Shops'],
                        ['100%', 'User Satisfies'],
                        ['4.9/5', 'User Rating'],
                        ['100%', 'Secure Data']
                    ].map(([val, label]) => (
                        <div key={label} style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: '32px', fontWeight: '900', letterSpacing: '-0.03em' }}>{val}</div>
                            <div style={{ fontSize: '13px', fontWeight: '700', color: 'var(--fg-subtle)', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: '4px' }}>{label}</div>
                        </div>
                    ))}
                </div>
            </section>

            {/* Visual Flow: Waterfall landscape model */}
            <section id="how-it-works" className="section" style={{ background: 'var(--bg-secondary)', overflow: 'hidden' }}>
                <div className="container">
                    <div style={{ textAlign: 'center', marginBottom: '80px' }}>
                        <h2 style={{ fontSize: '36px', fontWeight: '900', letterSpacing: '-0.04em' }}>How <span className="gradient-text">xerservice</span> works</h2>
                        <p style={{ fontSize: '16px', color: 'var(--fg-muted)', marginTop: '12px' }}>A seamless waterfall experience from screen to paper.</p>
                    </div>

                    <div style={{ position: 'relative', maxWidth: '1100px', margin: '0 auto' }}>
                        {/* Connecting Paths (Landscape waterfall style) */}
                        <svg viewBox="0 0 1100 400" style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 0 }} className="hidden-mobile">
                            <defs>
                                <linearGradient id="lineGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                                    <stop offset="0%" stopColor="var(--accent)" stopOpacity="0" />
                                    <stop offset="30%" stopColor="var(--accent)" stopOpacity="0.3" />
                                    <stop offset="70%" stopColor="var(--accent)" stopOpacity="0.3" />
                                    <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
                                </linearGradient>
                            </defs>
                            <path d="M 50 200 Q 275 50, 550 200 T 1050 200" fill="none" stroke="url(#lineGrad)" strokeWidth="4" strokeDasharray="12 8" />
                        </svg>

                        <div className="waterfall-grid" style={{ display: 'flex', gap: '32px', position: 'relative', zIndex: 1 }}>
                            {/* Step 1 */}
                            <div style={{ flex: 1, paddingTop: '120px' }}>
                                <div className="card" style={{ padding: '32px', textAlign: 'center', background: 'var(--bg)', border: '2px solid var(--border)', borderRadius: '24px' }}>
                                    <div style={{ width: '60px', height: '60px', borderRadius: '18px', background: 'var(--accent-muted)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
                                        <Search size={24} />
                                    </div>
                                    <h3 style={{ fontSize: '18px', fontWeight: '800', marginBottom: '8px' }}>01. Find a Shop</h3>
                                    <p style={{ fontSize: '14px', color: 'var(--fg-muted)' }}>Choose from 5000+ top-rated shops across Tamil Nadu.</p>
                                </div>
                            </div>

                            {/* Step 2 */}
                            <div style={{ flex: 1, paddingTop: '0px' }}>
                                <div className="card" style={{ padding: '32px', textAlign: 'center', background: 'var(--bg)', border: '2px solid var(--accent-border)', borderRadius: '24px', boxShadow: 'var(--shadow-accent-sm)' }}>
                                    <div style={{ width: '60px', height: '60px', borderRadius: '18px', background: 'var(--accent)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px', boxShadow: 'var(--shadow-accent)' }}>
                                        <UploadCloud size={24} />
                                    </div>
                                    <h3 style={{ fontSize: '18px', fontWeight: '800', marginBottom: '8px' }}>02. Upload & Set</h3>
                                    <p style={{ fontSize: '14px', color: 'var(--fg-muted)' }}>Upload multiple files and configure detailed print settings.</p>
                                </div>
                            </div>

                            {/* Step 3 */}
                            <div style={{ flex: 1, paddingTop: '120px' }}>
                                <div className="card" style={{ padding: '32px', textAlign: 'center', background: 'var(--bg)', border: '2px solid var(--border)', borderRadius: '24px' }}>
                                    <div style={{ width: '60px', height: '60px', borderRadius: '18px', background: 'var(--accent-muted)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
                                        <Printer size={24} />
                                    </div>
                                    <h3 style={{ fontSize: '18px', fontWeight: '800', marginBottom: '8px' }}>03. Instant Print</h3>
                                    <p style={{ fontSize: '14px', color: 'var(--fg-muted)' }}>Pay securely and collect from the shop. No more queues.</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* Download App Section */}
            <section className="section" style={{ background: 'var(--bg)' }}>
                <div className="container">
                    <div style={{ background: 'var(--bg-secondary)', borderRadius: '32px', padding: '64px', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '48px' }}>
                        <div style={{ flex: '1 1 400px' }}>
                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', background: 'var(--accent-muted)', color: 'var(--accent)', padding: '6px 16px', borderRadius: '100px', fontWeight: '800', fontSize: '12px', marginBottom: '24px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                <Smartphone size={16} /> Mobile Experience
                            </div>
                            <h2 style={{ fontSize: '40px', fontWeight: '900', letterSpacing: '-0.04em', lineHeight: '1.1', marginBottom: '16px' }}>
                                Unlock Full <br /> Features <span className="gradient-text">On The Go.</span>
                            </h2>
                            <p style={{ fontSize: '18px', color: 'var(--fg-muted)', lineHeight: '1.6', marginBottom: '32px' }}>
                                Download the xerservice app for iOS and Android. Manage orders, track wallet balance, and gain access to exclusive app-only discounts and priority printing.
                            </p>
                            <div style={{ display: 'flex', gap: '16px' }}>
                                <button className="btn btn-primary" style={{ height: '52px', padding: '0 24px', borderRadius: '14px', fontSize: '15px' }}>App Store</button>
                                <button className="btn btn-outline" style={{ height: '52px', padding: '0 24px', borderRadius: '14px', fontSize: '15px' }}>Play Store</button>
                            </div>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'center', flex: '1 1 300px' }}>
                            <div style={{ background: 'var(--bg)', padding: '32px', borderRadius: '32px', border: '1px solid var(--border)', boxShadow: 'var(--shadow-lg)' }}>
                                <div style={{ width: '200px', height: '200px', background: 'var(--bg-secondary)', borderRadius: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '16px' }}>
                                    <QrCode size={120} color="var(--fg)" />
                                </div>
                                <div style={{ textAlign: 'center', fontWeight: '800', fontSize: '14px', color: 'var(--fg-muted)' }}>Scan to download</div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* Why xerservice? */}
            <section className="section" style={{ background: 'var(--bg-secondary)' }}>
                <div className="container">
                    <div className="grid-4" style={{ gap: '24px' }}>
                        {highlights.map(h => (
                            <Link href={h.href} key={h.title} className="card card-hover" style={{ padding: '32px', height: '100%', display: 'flex', flexDirection: 'column', textDecoration: 'none', transition: 'all 0.3s' }}>
                                <div style={{ width: '56px', height: '56px', borderRadius: '14px', background: h.color + '10', color: h.color, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '24px' }}>
                                    {h.icon}
                                </div>
                                <h3 style={{ fontSize: '18px', fontWeight: '800', marginBottom: '12px', color: 'var(--fg)' }}>{h.title}</h3>
                                <p style={{ fontSize: '14px', color: 'var(--fg-muted)', lineHeight: '1.6', flex: 1, marginBottom: '20px' }}>{h.desc}</p>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: h.color, fontWeight: '700', fontSize: '14px' }}>
                                    Explore now <ArrowRight size={16} />
                                </div>
                            </Link>
                        ))}
                    </div>
                </div>
            </section>

            {/* Shops CTA */}
            <section style={{ padding: '72px 0 84px' }}>
                <div className="container">
                    <div style={{ background: 'linear-gradient(140deg, #020617 0%, #03031a 100%)', color: '#f8fafc', padding: '80px 48px', borderRadius: '40px', textAlign: 'center' }}>
                        <h2 style={{ fontSize: '42px', fontWeight: '900', letterSpacing: '-0.04em', marginBottom: '16px' }}>Ready to skip the queue?</h2>
                        <p style={{ fontSize: '18px', color: 'rgba(248,250,252,0.72)', marginBottom: '40px', maxWidth: '500px', margin: '0 auto 40px' }}>Join the thousand other printers in Tamil Nadu making the smarter choice.</p>
                        <div style={{ display: 'flex', gap: '16px', justifyContent: 'center', flexWrap: 'wrap' }}>
                            <Link href="/shops" className="btn btn-accent btn-lg" style={{ borderRadius: '14px', padding: '16px 40px' }}>
                                Find a shop now <ArrowRight size={20} />
                            </Link>
                            <Link
                                href="/vendor/join"
                                className="btn btn-lg"
                                style={{
                                    borderRadius: '14px',
                                    padding: '16px 40px',
                                    border: '1.5px solid rgba(248,250,252,0.35)',
                                    color: '#f8fafc',
                                    background: 'rgba(248,250,252,0.06)',
                                }}
                            >
                                Join as Vendor
                            </Link>
                        </div>
                    </div>
                </div>
            </section>

            <style>{`
                @media (max-width: 768px) {
                    .hidden-mobile { display: none !important; }
                    .waterfall-grid { flex-direction: column !important; gap: 48px !important; }
                    .waterfall-grid > div { padding-top: 0 !important; }
                    section[style*="padding: 72px 0 84px"] > .container > div {
                        padding: 56px 24px !important;
                        border-radius: 28px !important;
                    }
                }
            `}</style>
        </div>
    );
}

'use client';

import { Heart, Users, Globe, ShieldCheck, Zap, MapPin, ArrowRight, Target, Sparkles, Award } from 'lucide-react';
import Link from 'next/link';

export default function AboutPage() {
    const team = [
        {
            name: 'Varun M',
            photo: '/team-varun.png',
            initials: 'VM',
            color: '#fb923c',
            bg: '#fff7ed'
        },
        {
            name: 'Sibiya E',
            photo: null,
            initials: 'SE',
            color: '#8b5cf6',
            bg: '#f5f3ff'
        },
        {
            name: 'Vishvaa P',
            photo: '/team-vishvaa.png',
            initials: 'VP',
            color: '#3b82f6',
            bg: '#eff6ff'
        },
        {
            name: 'Kaviyaa R',
            photo: null,
            initials: 'KR',
            color: '#ec4899',
            bg: '#fdf2f8'
        },
    ];

    const values = [
        {
            title: 'Zero Waiting Time',
            desc: 'No more standing in lines at local Xerox shops. Order ahead and pick up at your convenience.',
            icon: <Zap size={24} />,
            color: '#fb923c',
            href: '/shops'
        },
        {
            title: 'Hyper Local',
            desc: 'We pinpoint print shops within walking distance of your current location in Tamil Nadu.',
            icon: <MapPin size={24} />,
            color: '#3b82f6',
            href: '/shops'
        },
        {
            title: 'Secure Gateway',
            desc: '100% encrypted document handling and secure UPI payment processing for your peace of mind.',
            icon: <ShieldCheck size={24} />,
            color: '#10b981',
            href: '/about#security'
        },
        {
            title: 'Vibrant Community',
            desc: 'Join 50k+ users sharing tips, shop reviews, and feature requests to build the future of printing.',
            icon: <Users size={24} />,
            color: '#8b5cf6',
            href: '/community'
        }
    ];

    return (
        <div className="page-wrapper" style={{ overflow: 'hidden' }}>
            {/* Stunning Hero Section */}
            <section style={{ padding: '120px 0 80px', position: 'relative', textAlign: 'center' }}>
                <div style={{ position: 'absolute', top: '10%', left: '50%', transform: 'translateX(-50%)', width: '600px', height: '600px', background: 'radial-gradient(circle, var(--accent-muted) 0%, transparent 70%)', zIndex: -1, opacity: 0.5 }} />

                <div className="container-sm">
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '8px 16px', background: 'var(--bg-glass)', borderRadius: '100px', border: '1.5px solid var(--accent-border)', marginBottom: '32px', fontSize: '13px', fontWeight: '800', color: 'var(--accent)', letterSpacing: '0.04em' }}>
                        <Sparkles size={16} /> BORN IN TAMIL NADU
                    </div>
                    <h1 style={{ fontSize: 'clamp(44px, 8vw, 80px)', fontWeight: '900', letterSpacing: '-0.05em', lineHeight: '0.95', marginBottom: '32px' }}>
                        The Story of <br />
                        <span className="gradient-text">xerservice</span>
                    </h1>
                    <p style={{ fontSize: '20px', color: 'var(--fg-muted)', lineHeight: '1.7', maxWidth: '640px', margin: '0 auto' }}>
                        We started with a simple idea: Eliminate the queue. Today, we're building Tamil Nadu's largest network of 5000+ top-tier print shops.
                    </p>
                </div>
            </section>

            {/* Vision / Story Block with Stunning Layout */}
            <section className="section">
                <div className="container">
                    <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '80px', alignItems: 'center' }}>
                        <div style={{ position: 'relative' }}>
                            <div style={{ position: 'absolute', top: '-40px', left: '-40px', width: '120px', height: '120px', background: 'var(--accent-muted)', borderRadius: '32px', zIndex: -1 }} />
                            <div style={{ padding: '60px', background: 'var(--bg)', border: '2px solid var(--border)', borderRadius: '40px', boxShadow: 'var(--shadow-lg)' }}>
                                <h2 style={{ fontSize: '40px', fontWeight: '900', letterSpacing: '-0.04em', marginBottom: '24px' }}>Our Mission</h2>
                                <p style={{ fontSize: '18px', color: 'var(--fg-muted)', lineHeight: '1.8', marginBottom: '32px' }}>
                                    We aim to bridge the gap between customers and vendors. By enabling real-time status tracking, automated cloud uploads, and scheduled pickups, we save thousands of hours every month for the people of Tamil Nadu.
                                </p>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                                    <div>
                                        <div style={{ fontSize: '36px', fontWeight: '900', color: 'var(--accent)' }}>5000+</div>
                                        <div style={{ fontSize: '14px', fontWeight: '700', opacity: 0.6 }}>Active Shops</div>
                                    </div>
                                    <div>
                                        <div style={{ fontSize: '36px', fontWeight: '900', color: 'var(--accent)' }}>100%</div>
                                        <div style={{ fontSize: '14px', fontWeight: '700', opacity: 0.6 }}>User Satisfies</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '40px' }}>
                            <div style={{ display: 'flex', gap: '24px' }}>
                                <div style={{ width: '64px', height: '64px', borderRadius: '20px', background: 'var(--fg)', color: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                    <Target size={32} />
                                </div>
                                <div>
                                    <h3 style={{ fontSize: '22px', fontWeight: '800', marginBottom: '8px' }}>The Vision</h3>
                                    <p style={{ color: 'var(--fg-muted)', lineHeight: '1.6' }}>Eliminating the physical wait for digital needs. Every printer in Tamil Nadu connected via one pixel-perfect gateway.</p>
                                </div>
                            </div>
                            <div style={{ display: 'flex', gap: '24px' }}>
                                <div style={{ width: '64px', height: '64px', borderRadius: '20px', background: 'var(--accent-muted)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                    <Award size={32} />
                                </div>
                                <div>
                                    <h3 style={{ fontSize: '22px', fontWeight: '800', marginBottom: '8px' }}>Quality Guaranteed</h3>
                                    <p style={{ color: 'var(--fg-muted)', lineHeight: '1.6' }}>We partner only with the best shops to ensure your hard work looks exactly as it should on paper.</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* Stunning Values Section with Buttons */}
            <section className="section" style={{ background: 'var(--bg-secondary)', borderRadius: '60px 60px 0 0' }}>
                <div className="container">
                    <div style={{ textAlign: 'center', marginBottom: '80px' }}>
                        <h2 style={{ fontSize: '42px', fontWeight: '900', letterSpacing: '-0.04em' }}>Rooted in Values</h2>
                        <p style={{ fontSize: '18px', color: 'var(--fg-muted)', marginTop: '16px' }}>Every feature we build is guided by our core principles.</p>
                    </div>
                    <div className="grid-2" style={{ gap: '32px' }}>
                        {values.map(v => (
                            <Link href={v.href} key={v.title} className="card card-hover" style={{ padding: '48px', background: 'var(--bg)', borderRadius: '32px', border: '1.5px solid var(--border)', textDecoration: 'none', transition: 'all 0.3s', display: 'flex', flexDirection: 'column', gap: '24px' }}>
                                <div style={{ width: '60px', height: '60px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: v.color + '15', color: v.color, borderRadius: '18px' }}>
                                    {v.icon}
                                </div>
                                <div>
                                    <h3 style={{ fontSize: '24px', fontWeight: '800', marginBottom: '12px', color: 'var(--fg)' }}>{v.title}</h3>
                                    <p style={{ fontSize: '16px', color: 'var(--fg-muted)', lineHeight: '1.7' }}>{v.desc}</p>
                                </div>
                                <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', gap: '10px', color: v.color, fontWeight: '800', fontSize: '15px' }}>
                                    Learn more <ArrowRight size={18} />
                                </div>
                            </Link>
                        ))}
                    </div>
                </div>
            </section>

            {/* Team Section with Improved Spacing & Stunning UI */}
            <section id="team" className="section">
                <div className="container">
                    <div style={{ textAlign: 'center', marginBottom: '80px' }}>
                        <h2 style={{ fontSize: '42px', fontWeight: '900', letterSpacing: '-0.04em' }}>Meet the Builders</h2>
                        <p style={{ fontSize: '18px', color: 'var(--fg-muted)', marginTop: '8px' }}>The humans behind the pixels and the paper.</p>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '40px', maxWidth: '1100px', margin: '0 auto' }}>
                        {team.map(member => (
                            <div key={member.name} style={{ textAlign: 'center' }}>
                                <div style={{
                                    width: '100%',
                                    aspectRatio: '0.75',
                                    background: member.bg,
                                    borderRadius: '32px',
                                    overflow: 'hidden',
                                    marginBottom: '24px',
                                    border: `3px solid ${member.color + '15'}`,
                                    position: 'relative',
                                    boxShadow: 'var(--shadow-sm)',
                                    transition: 'all 0.3s'
                                }}>
                                    {member.photo ? (
                                        <div style={{ position: 'relative', width: '100%', height: '100%' }}>
                                            <img
                                                src={member.photo}
                                                alt={member.name}
                                                style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center top' }}
                                            />
                                            <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '80px', background: `linear-gradient(to top, ${member.color}60, transparent)` }} />
                                        </div>
                                    ) : (
                                        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                            <div style={{ width: '80px', height: '80px', borderRadius: '50%', background: member.color, color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '32px', fontWeight: '900', boxShadow: `${member.color}40 0 12px 24px` }}>
                                                {member.initials}
                                            </div>
                                        </div>
                                    )}
                                </div>
                                <h3 style={{ fontSize: '22px', fontWeight: '900', letterSpacing: '-0.02em', color: 'var(--fg)' }}>{member.name}</h3>
                                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: 'var(--bg-tertiary)', padding: '4px 12px', borderRadius: '100px', fontSize: '11px', fontWeight: '800', marginTop: '10px', color: 'var(--fg-muted)' }}>
                                    <MapPin size={12} /> TAMIL NADU
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            <style>{`
                @media (max-width: 1024px) {
                    div[style*="grid-template-columns: 1.2fr 1fr"] { grid-template-columns: 1fr !important; gap: 48px !important; }
                    div[style*="grid-template-columns: repeat(4, 1fr)"] { grid-template-columns: repeat(2, 1fr) !important; }
                }
                @media (max-width: 640px) {
                    div[style*="grid-template-columns: repeat(2, 1fr)"] { grid-template-columns: 1fr !important; }
                }
            `}</style>
        </div>
    );
}


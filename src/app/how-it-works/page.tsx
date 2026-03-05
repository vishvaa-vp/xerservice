import { MapPin, Store, Upload, Settings, CreditCard, CheckCircle, ArrowDown } from 'lucide-react';

export default function HowItWorksPage() {
    const steps = [
        {
            number: '01',
            title: 'Allow Location Access',
            description: 'When you open XerService, we ask for your location. This helps us show you the nearest and most convenient print shops. You can also enter your location manually.',
            icon: MapPin,
            color: '#6366f1',
        },
        {
            number: '02',
            title: 'Browse & Choose a Shop',
            description: 'See a list of nearby print shops with ratings, distance, open/closed status, and pricing. Filter by distance, rating, or price.',
            icon: Store,
            color: '#8b5cf6',
        },
        {
            number: '03',
            title: 'Upload Your Document',
            description: 'Drag and drop or browse to upload your file. We support PDF, Word, PowerPoint, and common image formats. Your file is only shared with the selected shop.',
            icon: Upload,
            color: '#06b6d4',
        },
        {
            number: '04',
            title: 'Configure Print Settings',
            description: 'Choose color or black & white, set the number of pages, pick portrait or landscape orientation, and select single or double-sided printing.',
            icon: Settings,
            color: '#f59e0b',
        },
        {
            number: '05',
            title: 'Review Price & Method',
            description: 'See the total cost based on your settings. Choose instant printing (sent immediately) or scheduled printing (up to 2 hours later, with the option to modify your file).',
            icon: CreditCard,
            color: '#10b981',
        },
        {
            number: '06',
            title: 'Pay & Confirm',
            description: 'Pay via UPI, card, or your XerCoins wallet. Once payment is complete, you get an Order ID. Head to the shop to pick up your print!',
            icon: CheckCircle,
            color: '#22c55e',
        },
    ];

    return (
        <div className="page-wrapper">
            <section className="section">
                <div className="container-sm" style={{ textAlign: 'center', marginBottom: '64px' }}>
                    <h1 className="section-title">How XerService works</h1>
                    <p className="section-subtitle">From upload to pickup in minutes — here's everything you need to know.</p>
                </div>

                {/* Visual Flow */}
                <div className="container-sm">
                    <div style={{ position: 'relative' }}>
                        {/* Vertical connector line */}
                        <div style={{
                            position: 'absolute',
                            left: '28px',
                            top: '56px',
                            bottom: '56px',
                            width: '2px',
                            background: 'linear-gradient(to bottom, #6366f1, #8b5cf6, #06b6d4, #f59e0b, #10b981, #22c55e)',
                            borderRadius: '2px',
                            zIndex: 0,
                        }} />

                        {steps.map((step, idx) => {
                            const IconComp = step.icon;
                            return (
                                <div key={step.number} style={{ display: 'flex', gap: '32px', marginBottom: idx < steps.length - 1 ? '12px' : '0', alignItems: 'flex-start', position: 'relative', zIndex: 1 }}>
                                    {/* Left: Icon circle */}
                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                                        <div style={{
                                            width: '56px',
                                            height: '56px',
                                            background: step.color,
                                            color: '#fff',
                                            borderRadius: '50%',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            boxShadow: `0 4px 16px ${step.color}40`,
                                            transition: 'transform 0.3s',
                                        }}>
                                            <IconComp size={24} />
                                        </div>
                                    </div>
                                    {/* Right: Content card */}
                                    <div className="card card-hover" style={{ padding: '24px 28px', flex: 1, marginBottom: '8px' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                                            <span style={{ fontSize: '12px', fontWeight: '800', color: step.color, background: `${step.color}15`, padding: '3px 10px', borderRadius: '40px', letterSpacing: '0.04em' }}>STEP {step.number}</span>
                                            <h2 style={{ fontSize: '20px', fontWeight: '700', letterSpacing: '-0.02em' }}>{step.title}</h2>
                                        </div>
                                        <p style={{ fontSize: '15px', color: 'var(--fg-muted)', lineHeight: '1.7' }}>{step.description}</p>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Visual Summary Flow */}
                <div className="container" style={{ marginTop: '80px', marginBottom: '40px' }}>
                    <h2 style={{ fontSize: '24px', fontWeight: '800', letterSpacing: '-0.03em', textAlign: 'center', marginBottom: '48px' }}>The Traditional vs. XerService Flow</h2>
                    <div className="grid-2" style={{ gap: '32px' }}>
                        {/* Traditional */}
                        <div className="card" style={{ padding: '32px' }}>
                            <h3 style={{ fontSize: '18px', fontWeight: '700', marginBottom: '24px', color: 'var(--fg-subtle)' }}>Traditional Way</h3>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                {[
                                    'Walk to a print shop',
                                    'Wait in queue',
                                    'Hand over USB or email file',
                                    'Explain settings verbally',
                                    'Wait for printing',
                                    'Pay at counter',
                                ].map((step, i) => (
                                    <div key={i} style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                                        <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: 'var(--bg-tertiary)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: '12px', fontWeight: '700', color: 'var(--fg-subtle)' }}>{i + 1}</div>
                                        <span style={{ fontSize: '14px', color: 'var(--fg-muted)', textDecoration: 'line-through', opacity: 0.7 }}>{step}</span>
                                    </div>
                                ))}
                                <div style={{ padding: '12px 16px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius)', fontSize: '13px', color: 'var(--fg-subtle)', textAlign: 'center', fontWeight: '600' }}>
                                    Average time: 30–45 minutes
                                </div>
                            </div>
                        </div>

                        {/* XerService */}
                        <div className="card" style={{ padding: '32px', border: '2px solid var(--accent)', background: 'var(--accent-muted)' }}>
                            <h3 style={{ fontSize: '18px', fontWeight: '700', marginBottom: '24px', color: 'var(--accent)' }}>XerService Way</h3>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                {[
                                    { label: 'Open XerService', icon: MapPin },
                                    { label: 'Pick a nearby shop', icon: Store },
                                    { label: 'Upload & configure online', icon: Upload },
                                    { label: 'Pay securely', icon: CreditCard },
                                    { label: 'Walk in & pick up', icon: CheckCircle },
                                ].map((step, i) => {
                                    const Icon = step.icon;
                                    return (
                                        <div key={i} style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                                            <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                                <Icon size={14} color="#fff" />
                                            </div>
                                            <span style={{ fontSize: '14px', fontWeight: '600', color: 'var(--fg)' }}>{step.label}</span>
                                        </div>
                                    );
                                })}
                                <div style={{ padding: '12px 16px', background: 'var(--accent)', borderRadius: 'var(--radius)', fontSize: '13px', color: '#fff', textAlign: 'center', fontWeight: '700' }}>
                                    Average time: Under 2 minutes
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* FAQ */}
                <div className="container-sm" style={{ marginTop: '64px' }}>
                    <h2 style={{ fontSize: '24px', fontWeight: '800', letterSpacing: '-0.03em', marginBottom: '32px' }}>Frequently asked questions</h2>
                    {[
                        { q: 'Is my document safe?', a: 'Yes. Your document is only accessible to you and the selected print shop. We do not store documents permanently.' },
                        { q: 'Can I cancel an order?', a: 'Instant orders cannot be cancelled once confirmed. Scheduled orders can be cancelled or modified up to 10 minutes before the scheduled time.' },
                        { q: 'What payment methods are accepted?', a: 'UPI, debit/credit card, and XerCoins (our in-app wallet). XerCoins can be topped up anytime.' },
                        { q: 'How do I earn XerCoins?', a: 'XerCoins are earned by completing orders and engaging in the community. You can also receive them as bonuses or referral rewards.' },
                    ].map(({ q, a }) => (
                        <div key={q} className="card" style={{ marginBottom: '16px', padding: '24px' }}>
                            <h3 style={{ fontSize: '16px', fontWeight: '700', marginBottom: '8px' }}>{q}</h3>
                            <p style={{ fontSize: '14px', color: 'var(--fg-muted)', lineHeight: '1.7' }}>{a}</p>
                        </div>
                    ))}
                </div>
            </section>
        </div>
    );
}

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/context/AppContext';
import { calculatePrice } from '@/lib/mock-data';
import { Palette, FileText, Copy, Layers } from 'lucide-react';

export default function PrintSettingsPage() {
    const { currentOrder, setCurrentOrder } = useApp();
    const router = useRouter();

    const [color, setColor] = useState(currentOrder.color);
    const [pages, setPages] = useState(currentOrder.pages || 1);
    const [orientation, setOrientation] = useState<'portrait' | 'landscape'>(currentOrder.orientation);
    const [sides, setSides] = useState<'single' | 'double' | 'double_long' | 'double_short'>(currentOrder.sides === 'double' ? 'double_long' : currentOrder.sides);
    const [copies, setCopies] = useState(currentOrder.copies || 1);

    // New Settings State
    const [pageRange, setPageRange] = useState('all');
    const [customRange, setCustomRange] = useState('');
    const [paperSize, setPaperSize] = useState('A4');
    const [pagesPerSheet, setPagesPerSheet] = useState('1');
    const [scale, setScale] = useState('fit-margin');
    const [applyToAll, setApplyToAll] = useState(true);

    const hasMultipleFiles = currentOrder.totalFiles > 1;

    const totalPrice: number = calculatePrice(pages, color, sides, copies);

    const handleContinue = () => {
        setCurrentOrder(prev => ({ ...prev, color, pages, orientation, sides, copies, totalAmount: totalPrice }));
        router.push('/order/pricing');
    };

    return (
        <div className="page-wrapper">
            <section className="section">
                <div className="container-sm">
                    {/* Breadcrumb */}
                    <div style={{ display: 'flex', gap: '8px', marginBottom: '40px', fontSize: '13px', color: 'var(--fg-muted)' }}>
                        <span style={{ color: 'var(--fg-subtle)' }}>Upload</span><span>→</span>
                        <span>Settings</span><span>→</span>
                        <span style={{ color: 'var(--fg-subtle)' }}>Pricing</span><span>→</span>
                        <span style={{ color: 'var(--fg-subtle)' }}>Method</span><span>→</span>
                        <span style={{ color: 'var(--fg-subtle)' }}>Payment</span>
                    </div>

                    <h1 style={{ fontSize: '28px', fontWeight: '800', letterSpacing: '-0.03em', marginBottom: '8px' }}>Print settings</h1>
                    <p style={{ fontSize: '14px', color: 'var(--fg-muted)', marginBottom: '40px' }}>{currentOrder.fileName}</p>

                    <div className="grid-2" style={{ gap: '32px' }}>
                        {/* Left: Controls */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

                            {/* Color */}
                            <div className="card" style={{ padding: '24px' }}>
                                <p style={{ fontSize: '13px', fontWeight: '700', color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '16px' }}>Print Type</p>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
                                    {[{ label: 'Black & White', val: false, icon: <FileText size={16} /> }, { label: 'Color', val: true, icon: <Palette size={16} /> }].map(opt => (
                                        <button key={opt.label} onClick={() => setColor(opt.val)} className="mac-btn"
                                            style={{ padding: '14px', borderRadius: 'var(--radius)', border: `2px solid ${color === opt.val ? 'var(--accent)' : 'var(--border)'}`, background: color === opt.val ? 'var(--accent)' : 'transparent', color: color === opt.val ? 'var(--accent-fg)' : 'var(--fg)', fontWeight: '600', fontSize: '14px', cursor: 'pointer', transition: 'all 0.2s cubic-bezier(0.2, 0.8, 0.2, 1)', display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'center' }}>
                                            {opt.icon} {opt.label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Pages & Copies */}
                            <div className="card" style={{ padding: '24px' }}>
                                <p style={{ fontSize: '13px', fontWeight: '700', color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '16px' }}>Pages & Copies</p>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                    <div>
                                        <label className="input-label">Number of Pages</label>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                            <button onClick={() => setPages(p => Math.max(1, p - 1))} className="btn btn-outline btn-sm" style={{ width: '36px', height: '36px', padding: 0, borderRadius: '50%' }}>−</button>
                                            <input type="number" min={1} max={9999} value={pages} onChange={e => setPages(Math.max(1, parseInt(e.target.value) || 1))}
                                                style={{ width: '80px', textAlign: 'center', padding: '8px', background: 'var(--bg-secondary)', border: '1.5px solid var(--border)', borderRadius: 'var(--radius-sm)', fontSize: '16px', fontWeight: '600', color: 'var(--fg)', outline: 'none' }} />
                                            <button onClick={() => setPages(p => p + 1)} className="btn btn-outline btn-sm" style={{ width: '36px', height: '36px', padding: 0, borderRadius: '50%' }}>+</button>
                                        </div>
                                    </div>
                                    <div>
                                        <label className="input-label">Copies</label>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                            <button onClick={() => setCopies(c => Math.max(1, c - 1))} className="btn btn-outline btn-sm" style={{ width: '36px', height: '36px', padding: 0, borderRadius: '50%' }}>−</button>
                                            <input type="number" min={1} max={100} value={copies} onChange={e => setCopies(Math.max(1, parseInt(e.target.value) || 1))}
                                                style={{ width: '80px', textAlign: 'center', padding: '8px', background: 'var(--bg-secondary)', border: '1.5px solid var(--border)', borderRadius: 'var(--radius-sm)', fontSize: '16px', fontWeight: '600', color: 'var(--fg)', outline: 'none' }} />
                                            <button onClick={() => setCopies(c => c + 1)} className="btn btn-outline btn-sm" style={{ width: '36px', height: '36px', padding: 0, borderRadius: '50%' }}>+</button>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Sides */}
                            <div className="card" style={{ padding: '24px' }}>
                                <p style={{ fontSize: '13px', fontWeight: '700', color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '16px' }}>Printing sides</p>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                                    {([
                                        { label: 'Single-sided', val: 'single', icon: <FileText size={16} /> },
                                        { label: 'Double (Long Edge)', val: 'double_long', icon: <Layers size={16} /> },
                                        { label: 'Double (Short Edge)', val: 'double_short', icon: <Layers size={16} /> }
                                    ] as const).map(opt => (
                                        <button key={opt.val} onClick={() => setSides(opt.val)} className="mac-btn"
                                            style={{ padding: '14px', borderRadius: 'var(--radius)', border: `2px solid ${sides === opt.val ? 'var(--accent)' : 'var(--border)'}`, background: sides === opt.val ? 'var(--accent)' : 'transparent', color: sides === opt.val ? 'var(--accent-fg)' : 'var(--fg)', fontWeight: '600', fontSize: '14px', cursor: 'pointer', transition: 'all 0.2s cubic-bezier(0.2, 0.8, 0.2, 1)', display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'center' }}>
                                            {opt.icon} {opt.label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Pages Range */}
                            <div className="card" style={{ padding: '24px' }}>
                                <p style={{ fontSize: '13px', fontWeight: '700', color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '16px' }}>Pages to Print</p>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', marginBottom: pageRange === 'custom' ? '12px' : '0' }}>
                                    {['All', 'Odd', 'Even', 'Custom'].map(opt => (
                                        <button key={opt} onClick={() => setPageRange(opt.toLowerCase())} className="mac-btn"
                                            style={{ padding: '10px 4px', borderRadius: 'var(--radius-sm)', border: `2px solid ${pageRange === opt.toLowerCase() ? 'var(--accent)' : 'var(--border)'}`, background: pageRange === opt.toLowerCase() ? 'var(--accent)' : 'transparent', color: pageRange === opt.toLowerCase() ? 'var(--accent-fg)' : 'var(--fg)', fontWeight: '600', fontSize: '13px', cursor: 'pointer', transition: 'all 0.2s cubic-bezier(0.2, 0.8, 0.2, 1)', textAlign: 'center' }}>
                                            {opt}
                                        </button>
                                    ))}
                                </div>
                                {pageRange === 'custom' && (
                                    <input className="input" placeholder="e.g. 1-5, 8, 11-13" value={customRange} onChange={e => setCustomRange(e.target.value)} style={{ width: '100%', height: '44px', borderRadius: 'var(--radius-sm)' }} />
                                )}
                            </div>

                            {/* Paper Size */}
                            <div className="card" style={{ padding: '24px' }}>
                                <p style={{ fontSize: '13px', fontWeight: '700', color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '16px' }}>Paper Size</p>
                                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                                    {['A4', 'A3', 'A6', 'A2', 'Legal'].map(size => (
                                        <button key={size}
                                            disabled={size !== 'A4'}
                                            style={{ padding: '10px 16px', borderRadius: 'var(--radius-sm)', border: `2px solid ${paperSize === size ? 'var(--accent)' : 'var(--border)'}`, background: paperSize === size ? 'var(--accent)' : 'var(--bg-secondary)', color: paperSize === size ? 'white' : 'var(--fg)', opacity: size !== 'A4' ? 0.5 : 1, cursor: size !== 'A4' ? 'not-allowed' : 'pointer', fontWeight: '600', fontSize: '14px', position: 'relative' }}>
                                            {size}
                                            {size !== 'A4' && <span style={{ position: 'absolute', top: -8, right: -8, background: 'var(--fg)', color: 'var(--bg)', fontSize: '9px', padding: '2px 6px', borderRadius: '10px', fontWeight: '800' }}>Soon</span>}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Layout & Scale */}
                            <div className="card" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                                <div>
                                    <p style={{ fontSize: '13px', fontWeight: '700', color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '12px' }}>Pages per sheet</p>
                                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                        {['1', '2', '4', '6', '9', '16'].map(n => (
                                            <button key={n} onClick={() => setPagesPerSheet(n)} className="mac-btn"
                                                style={{ width: '40px', height: '40px', borderRadius: 'var(--radius-sm)', border: `2px solid ${pagesPerSheet === n ? 'var(--accent)' : 'var(--border)'}`, background: pagesPerSheet === n ? 'var(--accent)' : 'transparent', color: pagesPerSheet === n ? 'white' : 'var(--fg)', cursor: 'pointer', fontWeight: '600', fontSize: '14px', transition: 'all 0.2s cubic-bezier(0.2, 0.8, 0.2, 1)' }}>
                                                {n}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <div>
                                    <p style={{ fontSize: '13px', fontWeight: '700', color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '12px' }}>Scale</p>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
                                        {[
                                            { val: 'fit-margin', label: 'Fit to Margin' },
                                            { val: 'fit-paper', label: 'Fit to Paper' },
                                            { val: 'custom', label: 'Custom' }
                                        ].map(opt => (
                                            <button key={opt.val} onClick={() => setScale(opt.val)} className="mac-btn"
                                                style={{ padding: '10px 4px', borderRadius: 'var(--radius-sm)', border: `2px solid ${scale === opt.val ? 'var(--accent)' : 'var(--border)'}`, background: scale === opt.val ? 'var(--accent)' : 'transparent', color: scale === opt.val ? 'white' : 'var(--fg)', cursor: 'pointer', fontWeight: '600', fontSize: '12px', textAlign: 'center', transition: 'all 0.2s cubic-bezier(0.2, 0.8, 0.2, 1)' }}>
                                                {opt.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Right: Animated Paper Preview */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                            <div className="card" style={{ padding: '32px', display: 'flex', flexDirection: 'column', alignItems: 'center', minHeight: '300px' }}>
                                <p style={{ fontSize: '13px', fontWeight: '700', color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '24px', alignSelf: 'flex-start' }}>Orientation</p>

                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', width: '100%', marginBottom: '24px' }}>
                                    {([{ label: 'Portrait', val: 'portrait' }, { label: 'Landscape', val: 'landscape' }] as const).map(opt => (
                                        <button key={opt.val} onClick={() => setOrientation(opt.val)} className="mac-btn"
                                            style={{ padding: '12px', borderRadius: 'var(--radius)', border: `2px solid ${orientation === opt.val ? 'var(--accent)' : 'var(--border)'}`, background: orientation === opt.val ? 'var(--accent)' : 'transparent', color: orientation === opt.val ? 'var(--accent-fg)' : 'var(--fg)', fontWeight: '600', fontSize: '13px', cursor: 'pointer', transition: 'all 0.2s cubic-bezier(0.2, 0.8, 0.2, 1)' }}>
                                            {opt.label}
                                        </button>
                                    ))}
                                </div>

                                {/* Animated paper live-preview */}
                                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', perspective: '1000px', width: '100%' }}>
                                    <div style={{
                                        width: orientation === 'portrait' ? '120px' : '160px',
                                        height: orientation === 'portrait' ? '160px' : '120px',
                                        background: 'white',
                                        border: '1px solid rgba(0,0,0,0.1)',
                                        borderRadius: '4px',
                                        transition: 'all 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)',
                                        display: 'grid',
                                        gridTemplateColumns: `repeat(${Math.ceil(Math.sqrt(Number(pagesPerSheet)))}, 1fr)`,
                                        gridTemplateRows: `repeat(${Math.ceil(Number(pagesPerSheet) / Math.ceil(Math.sqrt(Number(pagesPerSheet))))}, 1fr)`,
                                        padding: '4px',
                                        gap: '4px',
                                        boxShadow: sides !== 'single' ? '-10px 10px 20px rgba(0,0,0,0.15), inset -2px 0 10px rgba(0,0,0,0.05)' : '0 10px 30px rgba(0,0,0,0.1)',
                                        transform: sides === 'double_long'
                                            ? 'rotateY(-18deg) rotateX(6deg)'
                                            : sides === 'double_short'
                                                ? 'rotateX(-18deg) rotateY(6deg)'
                                                : 'scale(1)',
                                        transformStyle: 'preserve-3d',
                                        animation: sides === 'double_long'
                                            ? 'flipLongEdge 2.4s ease-in-out infinite'
                                            : sides === 'double_short'
                                                ? 'flipShortEdge 2.4s ease-in-out infinite'
                                                : 'none'
                                    }}>
                                        {Array.from({ length: Number(pagesPerSheet) }).map((_, i) => (
                                            <div key={i} style={{
                                                border: '1px solid rgba(0,0,0,0.05)',
                                                background: color ? 'linear-gradient(135deg, rgba(59,130,246,0.08), rgba(239,68,68,0.08))' : 'rgba(0,0,0,0.03)',
                                                borderRadius: '2px',
                                                display: 'flex',
                                                flexDirection: 'column',
                                                padding: '4px',
                                                gap: '3px',
                                                overflow: 'hidden'
                                            }}>
                                                <div style={{ height: '3px', width: '90%', background: color ? '#3b82f6' : '#cbd5e1', borderRadius: '2px', transition: 'all 0.4s ease' }} />
                                                <div style={{ height: '2px', width: '70%', background: color ? '#f59e0b' : '#e2e8f0', borderRadius: '1px', transition: 'all 0.4s ease' }} />
                                                <div style={{ height: '2px', width: '80%', background: color ? '#ef4444' : '#e2e8f0', borderRadius: '1px', transition: 'all 0.4s ease' }} />
                                                <div style={{ height: '2px', width: '50%', background: color ? '#10b981' : '#e2e8f0', borderRadius: '1px', transition: 'all 0.4s ease' }} />
                                            </div>
                                        ))}
                                        {/* Back page representation for double sided */}
                                        {sides !== 'single' && (
                                            <div style={{
                                                position: 'absolute',
                                                top: 0, left: 0, right: 0, bottom: 0,
                                                background: 'white',
                                                borderRadius: '4px',
                                                border: '1px solid rgba(0,0,0,0.1)',
                                                transform: 'translateZ(-1px)',
                                                boxShadow: '0 0 5px rgba(0,0,0,0.05)'
                                            }} />
                                        )}
                                    </div>
                                </div>

                                {/* Print summary */}
                                <div style={{ marginTop: '24px', padding: '16px', background: 'var(--accent-muted)', borderRadius: 'var(--radius)', width: '100%', border: '1px solid var(--accent-border)' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '6px' }}>
                                        <span style={{ color: 'var(--fg-muted)' }}>Pages x Copies</span>
                                        <span style={{ fontWeight: '600' }}>{pages} x {copies}</span>
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '6px' }}>
                                        <span style={{ color: 'var(--fg-muted)' }}>Sides</span>
                                        <span style={{ fontWeight: '600' }}>
                                            {sides === 'single' ? 'Single' : `${sides === 'double_long' ? 'Double (Long Edge)' : 'Double (Short Edge)'} (${Math.ceil(pages / 2)} sheets)`}
                                        </span>
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '16px', paddingTop: '10px', borderTop: '1px solid var(--accent-border)', marginTop: '8px' }}>
                                        <span style={{ fontWeight: '700' }}>Est. Total</span>
                                        <span style={{ fontWeight: '900', color: 'var(--accent)', letterSpacing: '-0.02em' }}>₹{totalPrice.toFixed(2)}</span>
                                    </div>
                                </div>
                            </div>

                            {hasMultipleFiles && (
                                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '16px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', cursor: 'pointer', transition: 'all 0.2s' }}>
                                    <input type="checkbox" checked={applyToAll} onChange={e => setApplyToAll(e.target.checked)} style={{ width: '18px', height: '18px', accentColor: 'var(--accent)' }} />
                                    <span style={{ fontSize: '14px', fontWeight: '700', color: 'var(--fg)' }}>Apply to all {currentOrder.totalFiles} uploaded files</span>
                                </label>
                            )}

                            <button onClick={handleContinue} className="btn btn-accent btn-full btn-lg mac-btn">Continue to Pricing</button>
                        </div>
                    </div>
                </div>

                <style>{`
           @media (max-width: 768px) {
             .grid-2 { grid-template-columns: 1fr !important; }
           }
           .mac-btn:active {
             transform: scale(0.96) !important;
           }
           @keyframes flipLongEdge {
             0%, 100% { transform: rotateY(-18deg) rotateX(6deg); }
             50% { transform: rotateY(-8deg) rotateX(6deg); }
           }
           @keyframes flipShortEdge {
             0%, 100% { transform: rotateX(-18deg) rotateY(6deg); }
             50% { transform: rotateX(-8deg) rotateY(6deg); }
           }
         `}</style>
            </section>
        </div>
    );
}

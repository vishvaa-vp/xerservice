'use client';

import { useRouter } from 'next/navigation';
import { useApp } from '@/context/AppContext';
import Link from 'next/link';
import { ArrowRight, ArrowLeft } from 'lucide-react';

export default function PricingPage() {
    const { currentOrder } = useApp();
    const router = useRouter();

    const price = currentOrder.totalAmount || 0;
    const effectivePages = Math.max(1, (currentOrder.pages || 1) * (currentOrder.copies || 1));
    const estimatedPages = currentOrder.totalEstimatedPages > 0 ? currentOrder.totalEstimatedPages : effectivePages;
    const perPage = estimatedPages > 0 ? (price / estimatedPages).toFixed(2) : '0.00';

    const hasMultipleFiles = currentOrder.totalFiles > 1;
    const printTypeLabel = hasMultipleFiles ? 'Mixed (per-file settings)' : (currentOrder.color ? 'Color' : 'Black and White');
    const orientationLabel = hasMultipleFiles ? 'Mixed' : (currentOrder.orientation === 'portrait' ? 'Portrait' : 'Landscape');
    const sidesLabel = hasMultipleFiles
        ? 'Mixed'
        : ((currentOrder.sides === 'double' || currentOrder.sides === 'double_long' || currentOrder.sides === 'double_short') ? 'Double-sided' : 'Single-sided');

    return (
        <div className="page-wrapper">
            <section className="section">
                <div className="container-sm">
                    <div style={{ display: 'flex', gap: '8px', marginBottom: '40px', fontSize: '13px', color: 'var(--fg-muted)' }}>
                        <span style={{ color: 'var(--fg-subtle)' }}>Upload</span><span>{'>'}</span>
                        <span style={{ color: 'var(--fg-subtle)' }}>Settings</span><span>{'>'}</span>
                        <span>Pricing</span><span>{'>'}</span>
                        <span style={{ color: 'var(--fg-subtle)' }}>Method</span><span>{'>'}</span>
                        <span style={{ color: 'var(--fg-subtle)' }}>Payment</span>
                    </div>

                    <h1 style={{ fontSize: '28px', fontWeight: '800', letterSpacing: '-0.03em', marginBottom: '40px' }}>Your order summary</h1>

                    <div className="card" style={{ padding: '40px', textAlign: 'center', marginBottom: '24px' }}>
                        <p style={{ fontSize: '13px', fontWeight: '700', color: 'var(--fg-subtle)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '12px' }}>Total Amount</p>
                        <div style={{ fontSize: '64px', fontWeight: '900', letterSpacing: '-0.05em', lineHeight: '1', marginBottom: '8px', color: 'var(--accent)' }}>
                            Rs {price.toFixed(2)}
                        </div>
                        <p style={{ fontSize: '14px', color: 'var(--fg-muted)' }}>Rs {perPage}/page - {printTypeLabel}</p>
                    </div>

                    <div className="card" style={{ padding: '24px', marginBottom: '32px' }}>
                        <h2 style={{ fontSize: '16px', fontWeight: '700', marginBottom: '16px' }}>Order details</h2>
                        {[
                            ['Shop', currentOrder.shopName || '-'],
                            ['Files', `${currentOrder.totalFiles || 1}`],
                            ['File Name', currentOrder.fileName || '-'],
                            ['Original Pages', `${currentOrder.pages || 0} pages`],
                            ['Estimated Printed Pages', `${estimatedPages} pages`],
                            ['Copies', hasMultipleFiles ? 'Per file settings' : `${currentOrder.copies} cop${currentOrder.copies > 1 ? 'ies' : 'y'}`],
                            ['Print Type', printTypeLabel],
                            ['Orientation', orientationLabel],
                            ['Sides', sidesLabel],
                        ].map(([label, val]) => (
                            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                                <span style={{ fontSize: '14px', color: 'var(--fg-muted)' }}>{label}</span>
                                <span style={{ fontSize: '14px', fontWeight: '500' }}>{val}</span>
                            </div>
                        ))}
                    </div>

                    <div style={{ display: 'flex', gap: '12px' }}>
                        <Link href="/order/settings" className="btn btn-outline" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <ArrowLeft size={16} /> Edit Settings
                        </Link>
                        <button onClick={() => router.push('/order/method')} className="btn btn-accent" style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'center' }}>
                            Choose Printing Method <ArrowRight size={16} />
                        </button>
                    </div>
                </div>
            </section>
        </div>
    );
}

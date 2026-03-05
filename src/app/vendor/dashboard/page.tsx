'use client';

import { useEffect, useRef, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { mockCompletedOrders, mockVendorOrders, vendorRevenueData } from '@/lib/mock-data';
import {
    Calendar,
    Clock,
    DollarSign,
    FileText,
    Package,
    Printer,
    Save,
    Search,
    Store,
    TrendingUp,
} from 'lucide-react';

export default function VendorDashboardPage() {
    const { theme, user } = useApp();
    const [activeTab, setActiveTab] = useState<'overview' | 'queue' | 'analytics' | 'settings'>('overview');
    const [shopOpen, setShopOpen] = useState(true);
    const [closingSoon, setClosingSoon] = useState(false);

    const [shopName, setShopName] = useState("TN's Finest Prints");
    const [shopAddress, setShopAddress] = useState('123 Main St, Coimbatore, Tamil Nadu');
    const [priceBw, setPriceBw] = useState('2.00');
    const [priceColor, setPriceColor] = useState('7.00');
    const [shopImage, setShopImage] = useState('');
    const [saving, setSaving] = useState(false);

    const chartRef = useRef<HTMLCanvasElement>(null);
    const chartInstanceRef = useRef<any>(null);

    useEffect(() => {
        if (activeTab !== 'overview' && activeTab !== 'analytics') return;
        let chart: any = null;

        const load = async () => {
            const { Chart, registerables } = await import('chart.js');
            Chart.register(...registerables);
            if (!chartRef.current) return;
            if (chartInstanceRef.current) chartInstanceRef.current.destroy();

            const isDark = theme === 'dark';
            const fg = isDark ? '#f0f0ff' : '#0a0a12';
            const border = isDark ? '#1e1e38' : '#e2e2ec';

            chart = new Chart(chartRef.current, {
                type: 'bar',
                data: {
                    labels: vendorRevenueData.labels,
                    datasets: [
                        {
                            label: 'Revenue (Rs)',
                            data: vendorRevenueData.datasets[0].data,
                            backgroundColor: '#e87b35',
                            borderRadius: 8,
                            borderSkipped: false,
                        },
                    ],
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                    },
                    scales: {
                        x: { grid: { display: false }, ticks: { color: fg } },
                        y: { grid: { color: border }, ticks: { color: fg } },
                    },
                },
            });
            chartInstanceRef.current = chart;
        };

        load();
        return () => {
            if (chart) chart.destroy();
        };
    }, [theme, activeTab]);

    useEffect(() => {
        const key = `xer_vendor_shop_image_${user?.mobile || 'default'}`;
        const stored = localStorage.getItem(key);
        if (stored) setShopImage(stored);
    }, [user?.mobile]);

    const handleShopImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            const image = typeof reader.result === 'string' ? reader.result : '';
            if (!image) return;
            setShopImage(image);
            const key = `xer_vendor_shop_image_${user?.mobile || 'default'}`;
            localStorage.setItem(key, image);
        };
        reader.readAsDataURL(file);
        event.target.value = '';
    };

    const handleSaveSettings = (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        setTimeout(() => setSaving(false), 700);
    };

    const today = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });

    return (
        <div className="page-wrapper" style={{ background: 'var(--bg-secondary)', minHeight: '100vh' }}>
            <div style={{ background: 'var(--bg)', borderBottom: '1px solid var(--border)', padding: '40px 0 0' }}>
                <div className="container">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '28px', gap: '20px', flexWrap: 'wrap' }}>
                        <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', color: 'var(--fg-subtle)', fontSize: '12px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                                <Calendar size={14} /> Today: {today}
                            </div>
                            <h1 style={{ fontSize: '32px', fontWeight: '900', letterSpacing: '-0.04em' }}>Vendor HQ</h1>
                        </div>
                        <div style={{ display: 'flex', gap: '10px' }}>
                            <button onClick={() => setShopOpen((prev) => !prev)} className={`btn ${shopOpen ? 'btn-success' : 'btn-outline'}`} style={{ borderRadius: '12px', height: '44px', fontWeight: '800', fontSize: '13px' }}>
                                {shopOpen ? 'STORE OPEN' : 'STORE CLOSED'}
                            </button>
                            {shopOpen && (
                                <button onClick={() => setClosingSoon((prev) => !prev)} className={`btn ${closingSoon ? 'btn-accent' : 'btn-outline'}`} style={{ borderRadius: '12px', height: '44px', fontWeight: '800', fontSize: '13px' }}>
                                    {closingSoon ? 'CLOSING SOON ON' : 'SET CLOSING SOON'}
                                </button>
                            )}
                        </div>
                    </div>

                    <div style={{ display: 'flex', gap: '32px' }}>
                        {(['overview', 'queue', 'analytics', 'settings'] as const).map((tab) => (
                            <button key={tab} className={`tab-btn ${activeTab === tab ? 'active' : ''}`} onClick={() => setActiveTab(tab)} style={{ paddingBottom: '16px', fontSize: '15px', textTransform: 'capitalize' }}>
                                {tab}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            <main className="section-sm">
                <div className="container">
                    {activeTab === 'overview' && (
                        <div className="fade-in">
                            <div className="grid-3" style={{ gap: '24px', marginBottom: '24px' }}>
                                <StatCard icon={TrendingUp} value="Rs 1,240" label="Today's Revenue" color="#e87b35" />
                                <StatCard icon={Package} value="18" label="Orders Received" color="#3b82f6" />
                                <StatCard icon={Clock} value="12m" label="Avg. Wait Time" color="#16a34a" />
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: '24px' }}>
                                <div className="card" style={{ padding: '28px', borderRadius: '20px', border: 'none', boxShadow: 'var(--shadow-sm)' }}>
                                    <h2 style={{ fontSize: '18px', fontWeight: '800', marginBottom: '20px' }}>Weekly Performance</h2>
                                    <div style={{ height: '250px' }}>
                                        <canvas ref={chartRef} />
                                    </div>
                                </div>

                                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                    <div className="card" style={{ padding: '18px', borderRadius: '16px', border: 'none', boxShadow: 'var(--shadow-sm)' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
                                            <h3 style={{ fontSize: '16px', fontWeight: '800' }}>Shop Image</h3>
                                            <span style={{ fontSize: '12px', color: 'var(--fg-subtle)', fontWeight: '700' }}>Overview</span>
                                        </div>
                                        <div style={{ borderRadius: '12px', overflow: 'hidden', border: '1px solid var(--border)', minHeight: '130px', background: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                            {shopImage ? (
                                                <img src={shopImage} alt={shopName} style={{ width: '100%', height: '140px', objectFit: 'cover' }} />
                                            ) : (
                                                <span style={{ color: 'var(--fg-subtle)', fontSize: '12px' }}>Upload from Settings</span>
                                            )}
                                        </div>
                                    </div>

                                    <div className="card" style={{ padding: '20px', borderRadius: '16px', border: 'none', boxShadow: 'var(--shadow-sm)' }}>
                                        <h3 style={{ fontSize: '16px', fontWeight: '800', marginBottom: '14px' }}>Live Queue</h3>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                            {mockVendorOrders.slice(0, 3).map((order) => (
                                                <div key={order.orderId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px', background: 'var(--bg-secondary)', borderRadius: '10px' }}>
                                                    <div>
                                                        <p style={{ fontSize: '13px', fontWeight: '700' }}>#{order.orderId}</p>
                                                        <p style={{ fontSize: '11px', color: 'var(--fg-muted)' }}>{order.pages}p - {order.color ? 'Color' : 'B&W'}</p>
                                                    </div>
                                                    <span className={`badge ${order.status === 'printing' ? 'badge-accent' : 'badge-outline'}`} style={{ fontSize: '10px' }}>{order.status}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab === 'queue' && (
                        <div className="fade-in">
                            <div className="card" style={{ padding: '0', borderRadius: '20px', overflow: 'hidden', border: 'none', boxShadow: 'var(--shadow-sm)' }}>
                                <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg)' }}>
                                    <h2 style={{ fontSize: '18px', fontWeight: '800' }}>Full Document Queue</h2>
                                    <div style={{ display: 'flex', gap: '8px' }}>
                                        <input className="input" placeholder="Search order ID..." style={{ height: '40px', borderRadius: '10px', width: '220px' }} />
                                        <button className="btn btn-primary" style={{ height: '40px', borderRadius: '10px' }}><Search size={16} /></button>
                                    </div>
                                </div>

                                <div style={{ overflowX: 'auto' }}>
                                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                        <thead style={{ background: 'var(--bg-secondary)' }}>
                                            <tr style={{ textAlign: 'left' }}>
                                                {['Order', 'Customer', 'Settings', 'Time', 'Status'].map((h) => (
                                                    <th key={h} style={{ padding: '14px 20px', fontSize: '11px', fontWeight: '900', color: 'var(--fg-subtle)', textTransform: 'uppercase' }}>{h}</th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {mockVendorOrders.map((o) => (
                                                <tr key={o.orderId} style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg)' }}>
                                                    <td style={{ padding: '16px 20px', fontSize: '14px', fontWeight: '800' }}>#{o.orderId}</td>
                                                    <td style={{ padding: '16px 20px', fontSize: '13px', fontWeight: '600' }}>XXXX-{o.mobileLastFour}</td>
                                                    <td style={{ padding: '16px 20px' }}>
                                                        <div style={{ display: 'flex', gap: '6px' }}>
                                                            <span className="badge badge-outline">{o.pages} Pages</span>
                                                            <span className="badge badge-outline">{o.color ? 'Color' : 'B&W'}</span>
                                                        </div>
                                                    </td>
                                                    <td style={{ padding: '16px 20px', fontSize: '13px', color: 'var(--fg-muted)' }}>{o.time}</td>
                                                    <td style={{ padding: '16px 20px' }}>
                                                        <span className={`badge ${o.status === 'printing' ? 'badge-accent' : 'badge-outline'}`} style={{ textTransform: 'uppercase' }}>{o.status}</span>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab === 'analytics' && (
                        <div className="fade-in">
                            <div className="grid-3" style={{ gap: '24px', marginBottom: '24px' }}>
                                <StatCard icon={Package} value={`${mockCompletedOrders.length}`} label="Completed Today" color="#16a34a" />
                                <StatCard icon={Store} value={`${mockVendorOrders.length}`} label="Queue Backlog" color="#f59e0b" />
                                <StatCard icon={DollarSign} value={`Rs ${(mockCompletedOrders.reduce((acc, order) => acc + order.amount, 0) / Math.max(1, mockCompletedOrders.length)).toFixed(0)}`} label="Average Ticket" color="#3b82f6" />
                            </div>
                            <div className="card" style={{ padding: '28px', borderRadius: '20px', border: 'none', boxShadow: 'var(--shadow-sm)' }}>
                                <h2 style={{ fontSize: '18px', fontWeight: '800', marginBottom: '20px' }}>Revenue Trend</h2>
                                <div style={{ height: '280px' }}>
                                    <canvas ref={chartRef} />
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab === 'settings' && (
                        <div className="fade-in" style={{ maxWidth: '860px', margin: '0 auto' }}>
                            <div className="card" style={{ padding: '36px', borderRadius: '24px', border: 'none', boxShadow: 'var(--shadow-sm)' }}>
                                <div style={{ textAlign: 'center', marginBottom: '30px' }}>
                                    <h2 style={{ fontSize: '24px', fontWeight: '900' }}>Shop Profile</h2>
                                    <p style={{ color: 'var(--fg-muted)', fontSize: '14px', marginTop: '4px' }}>Manage shop details and storefront image.</p>
                                </div>

                                <form onSubmit={handleSaveSettings} style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                                        <div>
                                            <label className="input-label">Shop Display Name</label>
                                            <input className="input" value={shopName} onChange={(e) => setShopName(e.target.value)} />
                                        </div>
                                        <div>
                                            <label className="input-label">Location / Area</label>
                                            <input className="input" value={shopAddress} onChange={(e) => setShopAddress(e.target.value)} />
                                        </div>
                                    </div>

                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                                        <div>
                                            <label className="input-label">B&W Price / page</label>
                                            <input className="input" value={priceBw} onChange={(e) => setPriceBw(e.target.value)} />
                                        </div>
                                        <div>
                                            <label className="input-label">Color Price / page</label>
                                            <input className="input" value={priceColor} onChange={(e) => setPriceColor(e.target.value)} />
                                        </div>
                                    </div>

                                    <div>
                                        <label className="input-label">Shop Image</label>
                                        <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: '14px', alignItems: 'center' }}>
                                            <div style={{ borderRadius: '12px', overflow: 'hidden', border: '1px solid var(--border)', width: '180px', height: '120px', background: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                {shopImage ? (
                                                    <img src={shopImage} alt="Shop Preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                                ) : (
                                                    <span style={{ fontSize: '12px', color: 'var(--fg-subtle)' }}>No image</span>
                                                )}
                                            </div>
                                            <input type="file" accept="image/*" onChange={handleShopImageUpload} className="input" />
                                        </div>
                                    </div>

                                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                        <button type="submit" disabled={saving} className="btn btn-primary" style={{ borderRadius: '12px', fontWeight: '800' }}>
                                            {saving ? 'Saving...' : <><Save size={16} /> Update Shop</>}
                                        </button>
                                    </div>
                                </form>
                            </div>
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
}

function StatCard({
    icon: Icon,
    value,
    label,
    color,
}: {
    icon: any;
    value: string;
    label: string;
    color: string;
}) {
    return (
        <div className="card" style={{ padding: '24px', borderRadius: '16px', border: 'none', boxShadow: 'var(--shadow-sm)' }}>
            <div style={{ width: '44px', height: '44px', borderRadius: '12px', background: `${color}15`, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '12px' }}>
                <Icon size={22} color={color} />
            </div>
            <div style={{ fontSize: '30px', fontWeight: '900', lineHeight: 1.1 }}>{value}</div>
            <div style={{ fontSize: '12px', fontWeight: '700', color: 'var(--fg-subtle)', marginTop: '6px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
        </div>
    );
}

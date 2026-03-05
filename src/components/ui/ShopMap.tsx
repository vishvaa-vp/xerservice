'use client';

import { useEffect, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';
import { Shop } from '@/lib/mock-data';

export default function ShopMap({ shops }: { shops: Shop[] }) {
    const mapContainerRef = useRef<HTMLDivElement>(null);
    const mapInstanceRef = useRef<any>(null);
    const markersRef = useRef<any[]>([]);
    const [isMounted, setIsMounted] = useState(false);

    // Initialize map once
    useEffect(() => {
        setIsMounted(true);
        if (typeof window === 'undefined' || !mapContainerRef.current || mapInstanceRef.current) return;

        import('leaflet').then((L) => {
            if (!mapContainerRef.current || mapInstanceRef.current) return;

            // Fix default icon
            // @ts-ignore
            delete (L.Icon.Default.prototype as any)._getIconUrl;
            L.Icon.Default.mergeOptions({
                iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
                iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
                shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
            });

            const map = L.map(mapContainerRef.current, {
                center: [11.0168, 76.9558], // Coimbatore coordinates
                zoom: 13,
                zoomControl: true,
                scrollWheelZoom: false,
            });
            mapInstanceRef.current = map;

            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '&copy; OpenStreetMap contributors',
                maxZoom: 18,
            }).addTo(map);
        });

        return () => {
            if (mapInstanceRef.current) {
                mapInstanceRef.current.remove();
                mapInstanceRef.current = null;
            }
        };
    }, []);

    // Update markers whenever shops change
    useEffect(() => {
        if (!mapInstanceRef.current) return;

        import('leaflet').then((L) => {
            // Remove old markers
            markersRef.current.forEach(m => m.remove());
            markersRef.current = [];

            shops.forEach((shop, idx) => {
                const lat = 11.0168 + (Math.sin(idx * 2) * 0.012);
                const lng = 76.9558 + (Math.cos(idx * 2) * 0.012);

                const statusDot = shop.isOpen
                    ? `<span style="color:#1a7f37;font-size:10px;">Open</span>`
                    : `<span style="color:#888;font-size:10px;">Closed</span>`;

                const popupHtml = `
                    <div style="padding:8px 4px;min-width:160px;font-family:Inter,sans-serif;">
                        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px;">
                            <h3 style="font-size:14px;font-weight:800;margin:0;color:#0a0a12;line-height:1.2;">${shop.name}</h3>
                            ${statusDot}
                        </div>
                        <p style="font-size:12px;margin:0 0 4px 0;color:#52525e;line-height:1.4;">${shop.address}</p>
                        <p style="font-size:12px;margin:0 0 8px 0;color:#6366f1;font-weight:700;">${shop.rating} stars · ${shop.distance} km</p>
                        <div style="display:flex;justify-content:space-between;align-items:center;border-top:1px solid #e2e2ec;padding-top:8px;">
                            <span style="font-size:12px;font-weight:700;color:#0a0a12;">₹${shop.pricePerPage}/page</span>
                            <a href="/shops/${shop.id}" style="font-size:12px;font-weight:700;color:#6366f1;text-decoration:none;background:rgba(99,102,241,0.1);padding:3px 10px;border-radius:6px;">View</a>
                        </div>
                    </div>
                `;

                const marker = L.marker([lat, lng])
                    .addTo(mapInstanceRef.current)
                    .bindPopup(popupHtml, { maxWidth: 220 });
                markersRef.current.push(marker);
            });
        });
    }, [shops]);

    return (
        <div style={{
            height: '420px',
            width: '100%',
            borderRadius: 'var(--radius-lg)',
            overflow: 'hidden',
            border: '1.5px solid var(--border)',
            marginBottom: '28px',
            background: 'var(--bg-secondary)',
            position: 'relative',
            boxShadow: 'var(--shadow-sm)',
        }}>
            <div ref={mapContainerRef} style={{ height: '100%', width: '100%' }} />
            {!isMounted && (
                <div style={{
                    position: 'absolute', inset: 0, display: 'flex',
                    flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px'
                }}>
                    <span className="spinner spinner-lg" />
                    <span style={{ fontSize: '13px', color: 'var(--fg-muted)' }}>Loading map…</span>
                </div>
            )}
        </div>
    );
}

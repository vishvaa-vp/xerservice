'use client';

import { ReactNode } from 'react';
import { useApp } from '@/context/AppContext';
import Navbar from '@/components/layout/Navbar';
import Footer from '@/components/layout/Footer';

export default function RootClient({ children }: { children: ReactNode }) {
    const { isLoading, theme } = useApp();

    if (isLoading) {
        return (
            <div className="loading-screen">
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
                    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <div style={{ position: 'absolute', width: '64px', height: '64px', borderRadius: '50%', border: '2px solid var(--accent-muted)', animation: 'spin 2s linear infinite' }} />
                        <img src={theme === 'light' ? '/logo-black.png' : '/logo-white.png'} alt="XerService Logo" style={{ width: '40px', height: '40px', objectFit: 'contain' }} />
                    </div>
                    <span className="loading-logo">xerservice</span>
                </div>
                <div>
                    <div className="loading-bar-track">
                        <div className="loading-bar-fill" />
                    </div>
                </div>
                <span className="loading-text">Preparing your workspace…</span>
            </div>
        );
    }

    return (
        <div className="page-wrapper">
            <Navbar />
            <main>{children}</main>
            <Footer />
        </div>
    );
}

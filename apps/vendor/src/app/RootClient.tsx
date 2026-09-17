'use client';

import { ReactNode, Suspense } from 'react';
import { useApp } from '@/context/AppContext';
import Navbar from '@/components/layout/Navbar';
import Footer from '@/components/layout/Footer';
import BrandLoader from '@/components/ui/BrandLoader';
import MobileNavigation from '@/components/layout/MobileNavigation';
import { usePathname } from 'next/navigation';
import '@/lib/supabase/client';
import './mobile.css';

export default function RootClient({ children }: { children: ReactNode }) {
    const { isLoading, authInitialized } = useApp();
    const pathname = usePathname();
    const isLogin = pathname.includes('/login');
    const isReady = authInitialized && !isLoading;

    return (
        <>
            <BrandLoader ready={isReady} />
            {isReady && (
                <div className={`page-wrapper app-frame ${!isLogin ? 'has-mobile-navigation' : ''}`} data-page={pathname}>
                    {!isLogin && <Navbar />}
                    <main>{children}</main>
                    {!isLogin && <Footer />}
                    <Suspense fallback={null}>
                        {!isLogin && <MobileNavigation />}
                    </Suspense>
                </div>
            )}
        </>
    );
}

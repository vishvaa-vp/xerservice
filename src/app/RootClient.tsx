'use client';

import { ReactNode, Suspense } from 'react';
import { useApp } from '@/context/AppContext';
import CustomerBoundary from '@/components/layout/CustomerBoundary';
import Feedback from '@/components/ui/Feedback';
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
    const navigation = !pathname.startsWith('/auth/') && pathname !== '/signup' && !pathname.startsWith('/vendor') && !pathname.includes('/login') && !pathname.startsWith('/admin') && !pathname.startsWith('/xad') && pathname !== '/forgot-password';
    const isReady = authInitialized && !isLoading;

    return (
        <>
            <BrandLoader ready={isReady} />
            {(
                <div className={`page-wrapper app-frame ${navigation ? 'has-mobile-navigation' : ''}`} data-page={pathname}>
                    <Suspense fallback={null}><Navbar /></Suspense>
                    <main><CustomerBoundary>{children}</CustomerBoundary></main><Feedback />
                    <Footer />
                    <Suspense fallback={null}>
                        <MobileNavigation />
                    </Suspense>
                </div>
            )}
        </>
    );
}

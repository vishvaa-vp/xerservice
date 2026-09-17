'use client';

import { ReactNode, Suspense } from 'react';
import { useApp } from '@/context/AppContext';
import Navbar from '@/components/layout/Navbar';
import Footer from '@/components/layout/Footer';
import BrandLoader from '@/components/ui/BrandLoader';
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
                <div className="page-wrapper app-frame" data-page={pathname}>
                    {!isLogin && <Suspense fallback={null}><Navbar /></Suspense>}
                    <main>{children}</main>
                    {!isLogin && <Footer />}
                </div>
            )}
        </>
    );
}

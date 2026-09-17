'use client';

import { useApp } from '@/context/AppContext';
import { usePathname } from 'next/navigation';
import { isCustomerPrivatePath } from '@/lib/customer-navigation';
import { useState, type ReactNode } from 'react';

export default function CustomerBoundary({ children }: { children: ReactNode }) {
    const { user, authInitialized, refreshProfile, logout } = useApp();
    const pathname = usePathname();
    const [retrying, setRetrying] = useState(false);
    const internal = /^\/(admin|xad)(\/|$)/.test(pathname);
    const wrongAccount = user && user.type !== 'customer' && !internal && pathname !== '/forgot-password' && pathname !== '/auth/callback';
    if (!authInitialized && isCustomerPrivatePath(pathname)) {
        return <section className="account-state" role="status"><span className="spinner" /><h1>Checking your account</h1><p>Your documents will appear when your session is ready.</p></section>;
    }
    if (wrongAccount) return <section className="account-state">
        <span className="account-state-mark">XS</span>
        <h1>{user.type === 'unverified' ? 'We couldn’t verify your account' : 'This is the customer website'}</h1>
        <p>{user.type === 'unverified' ? 'Your profile could not be loaded. Check your connection and try again.' : user.type === 'vendor' ? 'Manage your shop and print orders in the XerService desktop app. To place a print order here, switch to a customer account.' : 'Use your admin workspace to manage XerService, or switch to a customer account to place an order.'}</p>
        <div className="account-state-actions">
            {user.type === 'unverified' && <button className="btn btn-accent" disabled={retrying} onClick={async () => { setRetrying(true); try { await refreshProfile(); } finally { setRetrying(false); } }}>{retrying ? 'Checking…' : 'Try again'}</button>}
            <button className="btn btn-outline" onClick={async () => { await logout(); window.location.assign('/login'); }}>Switch account</button>
        </div>
    </section>;
    return <>{children}</>;
}

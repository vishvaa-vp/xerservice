'use client';

import { useEffect, useRef, useState, Suspense } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Store, FileText, Plus, Wallet, User, UploadCloud, MessageCircle, History, ShoppingCart, X, ListOrdered, BarChart3 } from 'lucide-react';
import { useApp } from '@/context/AppContext';

function MobileNavigationInner() {
    const { user, currentOrder, cart } = useApp();
    const pathname = usePathname();
    const params = useSearchParams();
    const router = useRouter();
    const dialog = useRef<HTMLDialogElement>(null);
    const [open, setOpen] = useState(false);

    const uploadUrl = '/#shops';
    const hasDocuments = typeof File !== 'undefined' && currentOrder.documents?.some(document => document.file instanceof File);
    const authHref = (target: string) => user ? target : `/login?redirect=${encodeURIComponent(target)}`;
    const whatsapp = authHref('/dashboard/profile#whatsapp');

    useEffect(() => { setOpen(false); }, [pathname]);
    useEffect(() => {
        const sheet = dialog.current;
        if (open) sheet?.showModal(); else sheet?.close();
        const media = matchMedia('(min-width: 769px)');
        const close = () => { if (media.matches) setOpen(false); };
        media.addEventListener('change', close);
        return () => media.removeEventListener('change', close);
    }, [open]);
    const go = (href: string) => {
        setOpen(false);
        if (href.includes('#shops') && pathname === '/') {
            const el = document.getElementById('shops');
            if (el) {
                el.scrollIntoView({ behavior: 'smooth' });
                return;
            }
        }
        router.push(href);
    };

    const tabs = [
        { label: 'Shops', href: '/#shops', Icon: Store, active: pathname === '/' || pathname === '/shops', isProfile: false },
        { label: 'Orders', href: authHref('/dashboard/orders'), Icon: FileText, active: pathname === '/dashboard/orders', isProfile: false },
        { label: 'Print', href: '', Icon: Plus, active: pathname.startsWith('/order/'), isProfile: false },
        { label: 'Wallet', href: authHref('/dashboard/wallet'), Icon: Wallet, active: pathname === '/dashboard/wallet', isProfile: false },
        { label: 'Profile', href: authHref('/dashboard/profile'), Icon: User, active: pathname === '/dashboard/profile', isProfile: true },
    ];

    if (pathname.startsWith('/vendor') || pathname.startsWith('/auth') || pathname === '/signup' || (user && user.type !== 'customer') || pathname.startsWith('/admin') || pathname.startsWith('/xad') || pathname.includes('/login') || pathname === '/forgot-password') return null;

    return <>
        <nav className="mobile-bottom-nav" aria-label="Mobile navigation">
            {tabs.map(({ label, href, Icon, active, isProfile }) => {
                if (!href) {
                    return (
                        <button
                            key={label}
                            type="button"
                            className="mobile-print-action"
                            aria-label="Print"
                            aria-expanded={open}
                            onClick={() => setOpen(true)}
                        >
                            <span className="mobile-print-icon"><Icon size={20} /></span>
                            <span className="mobile-print-label">Print</span>
                        </button>
                    );
                }

                return (
                    <Link key={label} href={href} aria-current={active ? 'page' : undefined}>
                        {isProfile && user ? (
                            user.avatarUrl ? (
                                <img
                                    src={user.avatarUrl}
                                    alt=""
                                    style={{ width: '22px', height: '22px', borderRadius: '50%', objectFit: 'cover' }}
                                />
                            ) : (
                                <span style={{
                                    width: '22px',
                                    height: '22px',
                                    borderRadius: '50%',
                                    background: 'var(--accent)',
                                    color: '#fff',
                                    fontSize: '11px',
                                    fontWeight: '800',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                }}>
                                    {user.name ? user.name[0].toUpperCase() : 'U'}
                                </span>
                            )
                        ) : (
                            <Icon size={21} />
                        )}
                        <span>{label}</span>
                    </Link>
                );
            })}
        </nav>
        <dialog ref={dialog} className="mobile-print-sheet" aria-labelledby="print-action-title" onCancel={() => setOpen(false)} onClick={event => { if (event.target === event.currentTarget) setOpen(false); }}>
            <header><h2 id="print-action-title">How would you like to print?</h2><button type="button" aria-label="Close print menu" onClick={() => setOpen(false)}><X size={20} /></button></header>
            <button type="button" onClick={() => go(uploadUrl)}><UploadCloud size={22} /><span>Select Print Shop & Upload<small>Choose a verified print shop first</small></span></button>
            <button type="button" disabled><MessageCircle size={22} /><span>Print from WhatsApp<small>WhatsApp printing is not available yet</small></span></button>
            <button type="button" disabled={!hasDocuments} onClick={() => go(authHref('/order/pricing'))}><History size={22} /><span>Recent documents<small>{hasDocuments ? 'Review your current documents' : 'No documents in this session'}</small></span></button>
            <button type="button" disabled={!cart.length && !hasDocuments} onClick={() => go(authHref(cart.length ? '/cart' : '/order/pricing'))}><ShoppingCart size={22} /><span>Continue saved order<small>{cart.length ? `${cart.length} saved ${cart.length === 1 ? 'order' : 'orders'}` : hasDocuments ? 'Continue your current order' : 'No saved orders yet'}</small></span></button>
        </dialog>
    </>;
}

export default function MobileNavigation() {
    return (
        <Suspense fallback={null}>
            <MobileNavigationInner />
        </Suspense>
    );
}

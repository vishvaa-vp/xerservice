'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, Clock3, FileText, PlusCircle, Settings2, ShoppingCart, Trash2, Zap, MessageSquare } from 'lucide-react';
import { useApp } from '@/context/AppContext';
import { supabase } from '@/lib/supabase/client';

const CART_EXPIRY_MS = 12 * 60 * 60 * 1000;

export default function CartPage() {
    const { cart, addToCart, removeFromCart, setCurrentOrder, isLoggedIn, isLoading, authInitialized } = useApp();
    const router = useRouter();

    const [incomingWhatsAppFiles, setIncomingWhatsAppFiles] = useState<any[]>([]);
    const [loadingWhatsAppFiles, setLoadingWhatsAppFiles] = useState(false);
    const [configuringId, setConfiguringId] = useState<string | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);

    useEffect(() => {
        if (!authInitialized || isLoading) return;
        if (!isLoggedIn) {
            router.push('/login?redirect=/cart');
            return;
        }

        let isMounted = true;
        (async () => {
            try {
                setLoadingWhatsAppFiles(true);
                const { data: sessionData } = await supabase.auth.getSession();
                const token = sessionData.session?.access_token;
                if (!token) return;
                const res = await fetch('/api/customer/whatsapp/files', {
                    headers: { Authorization: `Bearer ${token}` },
                });
                if (res.ok && isMounted) {
                    const data = await res.json();
                    if (data.files) setIncomingWhatsAppFiles(data.files);
                }
            } catch (err) {
                console.error('Failed to load WhatsApp files:', err);
            } finally {
                if (isMounted) setLoadingWhatsAppFiles(false);
            }
        })();
        return () => { isMounted = false; };
    }, [authInitialized, isLoading, isLoggedIn, router]);

    const handleConfigureWhatsAppFile = async (fileId: string) => {
        setConfiguringId(fileId);
        try {
            const { data: sessionData } = await supabase.auth.getSession();
            const token = sessionData.session?.access_token;
            if (!token) {
                router.push('/login?redirect=/cart');
                return;
            }

            const res = await fetch('/api/customer/whatsapp/files', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ fileId }),
            });

            const data = await res.json();
            if (!res.ok || !data.success || !data.cartItem) {
                alert(data.error || 'Failed to prepare WhatsApp document.');
                return;
            }

            addToCart({
                shopId: data.cartItem.shopId || '',
                shopName: 'Select Shop',
                fileName: data.cartItem.fileName,
                pages: data.cartItem.pages,
                color: false,
                sides: 'single',
                orientation: 'portrait',
                copies: 1,
                totalAmount: 0,
                source: 'whatsapp',
            });

            setIncomingWhatsAppFiles(prev => prev.filter(f => f.id !== fileId));
        } catch (err) {
            console.error('Error configuring WhatsApp file:', err);
        } finally {
            setConfiguringId(null);
        }
    };

    const handleDeleteWhatsAppFile = async (fileId: string) => {
        if (!confirm('Remove this imported WhatsApp document?')) return;
        setDeletingId(fileId);
        try {
            const { data: sessionData } = await supabase.auth.getSession();
            const token = sessionData.session?.access_token;
            if (!token) return;

            const res = await fetch(`/api/customer/whatsapp/files/${fileId}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` },
            });

            if (res.ok) {
                setIncomingWhatsAppFiles(prev => prev.filter(f => f.id !== fileId));
            }
        } catch (err) {
            console.error('Error deleting WhatsApp file:', err);
        } finally {
            setDeletingId(null);
        }
    };
    const total = cart.reduce((sum, item) => sum + item.totalAmount, 0);
    const whatsappItems = cart
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => item.source === 'whatsapp');
    const uploadItems = cart
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => item.source !== 'whatsapp');

    const checkoutItem = (item: (typeof cart)[number]) => {
        setCurrentOrder(prev => ({
            ...prev,
            orderId: item.orderId,
            orderNumber: item.orderNumber,
            editingCartCreatedAt: undefined,
            documents: item.documents || [],
            files: (item.documents || []).flatMap(document => document.file instanceof File ? [document.file] : []),
            totalFiles: item.fileNames?.length || 1,
            totalEstimatedPages: 0,
            shopId: item.shopId,
            shopName: item.shopName,
            fileName: item.fileName,
            pages: item.pages,
            color: item.color,
            sides: item.sides,
            orientation: item.orientation,
            copies: item.copies,
            method: 'instant',
            scheduledTime: '',
            uploadedAt: item.createdAt,
            totalAmount: item.totalAmount,
        }));
        const checkoutUrl = item.orderId ? `/order/pricing?order=${item.orderId}` : '/order/pricing';
        router.push(isLoggedIn ? checkoutUrl : `/login?redirect=${encodeURIComponent(checkoutUrl)}`);
    };

    const editSettings = (item: (typeof cart)[number]) => {
        setCurrentOrder(prev => ({
            ...prev,
            orderId: item.orderId,
            orderNumber: item.orderNumber,
            editingCartCreatedAt: item.createdAt,
            documents: item.documents || [],
            files: (item.documents || []).flatMap(document => document.file instanceof File ? [document.file] : []),
            totalFiles: item.fileNames?.length || 1,
            totalEstimatedPages: 0,
            shopId: item.shopId,
            shopName: item.shopName,
            fileName: item.fileName,
            pages: item.pages,
            color: item.color,
            sides: item.sides,
            orientation: item.orientation,
            copies: item.copies,
            method: 'instant',
            scheduledTime: '',
            uploadedAt: item.createdAt,
            totalAmount: item.totalAmount,
        }));
        router.push('/order/pricing?edit=1');
    };

    const addFiles = (item: (typeof cart)[number], index?: number) => {
        try {
            sessionStorage.setItem('xer_add_files_cart_item', JSON.stringify({
                orderId: item.orderId,
                orderNumber: item.orderNumber,
                shopId: item.shopId,
                shopName: item.shopName,
                fileName: item.fileName,
                fileNames: item.fileNames || [item.fileName],
                pages: item.pages,
                color: item.color,
                sides: item.sides,
                orientation: item.orientation,
                copies: item.copies,
                cartIndex: typeof index === 'number' ? index : undefined,
            }));
        } catch {}

        setCurrentOrder(prev => ({
            ...prev,
            orderId: item.orderId,
            orderNumber: item.orderNumber,
            editingCartCreatedAt: item.createdAt,
            documents: item.documents || [],
            files: (item.documents || []).flatMap(document => document.file instanceof File ? [document.file] : []),
            shopId: item.shopId,
            shopName: item.shopName,
            fileName: item.fileName,
            pages: item.pages,
            color: item.color,
            sides: item.sides,
            orientation: item.orientation,
            copies: item.copies,
            method: 'instant',
            scheduledTime: '',
            totalAmount: item.totalAmount,
        }));
        router.push(`/order/upload?shop=${item.shopId}${item.orderId ? `&order=${item.orderId}` : ''}&fromCart=1`);
    };

    const getTimeLeft = (createdAt: string) => {
        const created = new Date(createdAt).getTime();
        const left = CART_EXPIRY_MS - (Date.now() - created);
        if (!Number.isFinite(created) || left <= 0) return 'Expiring now';
        const hours = Math.floor(left / (60 * 60 * 1000));
        const minutes = Math.max(1, Math.floor((left % (60 * 60 * 1000)) / (60 * 1000)));
        if (hours <= 0) return `${minutes}m left`;
        return `${hours}h ${minutes}m left`;
    };

    if (!authInitialized || (isLoading && !isLoggedIn)) {
        return (
            <div style={{ minHeight: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span className="spinner spinner-lg" />
            </div>
        );
    }

    if (!isLoggedIn) {
        return (
            <div style={{ minHeight: '80vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '20px', padding: '40px' }}>
                <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: 'var(--accent-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <ShoppingCart size={28} color="var(--accent)" />
                </div>
                <div style={{ textAlign: 'center' }}>
                    <p style={{ fontSize: '18px', fontWeight: '700', marginBottom: '8px' }}>Sign in required</p>
                    <p style={{ fontSize: '14px', color: 'var(--fg-muted)', marginBottom: '20px' }}>Please sign in to view your cart.</p>
                    <Link href="/login?redirect=/cart" className="btn btn-accent">Sign In to Continue</Link>
                </div>
            </div>
        );
    }

    return (
        <div className="page-wrapper">
            <section className="section-sm">
                <div className="container-sm" style={{ maxWidth: '900px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: '16px', flexWrap: 'wrap', marginBottom: '32px', borderBottom: '1px solid var(--border)', paddingBottom: '22px' }}>
                        <div>
                            <h1 style={{ fontSize: '32px', fontWeight: '900', letterSpacing: 0, marginBottom: '6px' }}>Cart</h1>
                            <p style={{ fontSize: '15px', color: 'var(--fg-muted)' }}>{cart.length} saved print order{cart.length === 1 ? '' : 's'}</p>
                        </div>
                        <Link href="/" className="btn btn-accent">
                            Add Print Order <ArrowRight size={16} />
                        </Link>
                    </div>

                    {incomingWhatsAppFiles.length > 0 && (
                        <div
                            data-testid="whatsapp-incoming-panel"
                            className="card"
                            style={{
                                marginBottom: '24px',
                                border: '1.5px solid rgba(37, 211, 102, 0.4)',
                                background: 'var(--bg-secondary)',
                                borderRadius: '18px',
                                padding: '22px',
                            }}
                        >
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                    <div style={{ width: '38px', height: '38px', borderRadius: '12px', background: '#25D366', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
                                        <MessageSquare size={20} />
                                    </div>
                                    <div>
                                        <h3 style={{ fontSize: '16px', fontWeight: '800', margin: 0 }}>Incoming WhatsApp Documents</h3>
                                        <p style={{ fontSize: '13px', color: 'var(--fg-muted)', margin: '2px 0 0' }}>Received from your linked WhatsApp number. Ready to configure for print.</p>
                                    </div>
                                </div>
                                <span className="badge" style={{ background: 'rgba(37, 211, 102, 0.15)', color: '#25D366', fontWeight: '700', padding: '6px 12px', borderRadius: '20px', fontSize: '12px' }}>
                                    {incomingWhatsAppFiles.length} Ready to Print
                                </span>
                            </div>

                            <div style={{ display: 'grid', gap: '12px' }}>
                                {incomingWhatsAppFiles.map((file) => (
                                    <div
                                        key={file.id}
                                        data-testid={`whatsapp-imported-file-${file.id}`}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'space-between',
                                            padding: '14px 18px',
                                            background: 'var(--bg)',
                                            borderRadius: '14px',
                                            border: '1px solid var(--border)',
                                            flexWrap: 'wrap',
                                            gap: '12px',
                                        }}
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                                            <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--border)' }}>
                                                <FileText size={20} style={{ color: 'var(--accent)' }} />
                                            </div>
                                            <div>
                                                <p style={{ fontSize: '15px', fontWeight: '700', margin: 0 }}>{file.originalFilename}</p>
                                                <p style={{ fontSize: '12px', color: 'var(--fg-muted)', margin: '2px 0 0' }}>
                                                    {file.pageCount ? `${file.pageCount} page${file.pageCount === 1 ? '' : 's'}` : '1 image'} • {(file.fileSize / 1024).toFixed(0)} KB • Received {new Date(file.createdAt).toLocaleDateString()}
                                                </p>
                                            </div>
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                            <button
                                                onClick={() => handleConfigureWhatsAppFile(file.id)}
                                                disabled={configuringId === file.id}
                                                className="btn btn-sm btn-accent"
                                                style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                                                data-testid={`btn-configure-whatsapp-${file.id}`}
                                            >
                                                {configuringId === file.id ? <span className="spinner spinner-xs" /> : <Zap size={14} />}
                                                Configure for Print
                                            </button>
                                            <button
                                                onClick={() => handleDeleteWhatsAppFile(file.id)}
                                                disabled={deletingId === file.id}
                                                className="btn btn-sm btn-secondary"
                                                style={{ color: 'var(--color-danger, #ef4444)' }}
                                                title="Delete document"
                                                data-testid={`btn-delete-whatsapp-${file.id}`}
                                            >
                                                {deletingId === file.id ? <span className="spinner spinner-xs" /> : <Trash2 size={14} />}
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {cart.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '90px 24px', background: 'var(--bg-secondary)', border: '2px dashed var(--border)', borderRadius: '22px' }}>
                            <div style={{ width: '74px', height: '74px', borderRadius: '24px', background: 'var(--bg)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px', color: 'var(--accent)' }}>
                                <ShoppingCart size={34} />
                            </div>
                            <h2 style={{ fontSize: '22px', fontWeight: '900', letterSpacing: 0, marginBottom: '8px' }}>Your cart is empty</h2>
                            <p style={{ fontSize: '15px', color: 'var(--fg-muted)', marginBottom: '28px' }}>Choose a shop and add your print settings here.</p>
                            <Link href="/" className="btn btn-primary">Browse Shops</Link>
                        </div>
                    ) : (
                        <div style={{ display: 'grid', gap: '22px' }}>
                            <CartSection
                                title="Uploaded files"
                                items={uploadItems}
                                onCheckout={checkoutItem}
                                onEdit={editSettings}
                                onAddFiles={addFiles}
                                onRemove={removeFromCart}
                                getTimeLeft={getTimeLeft}
                            />

                            {whatsappItems.length > 0 && (
                                <CartSection
                                    title="Files from WhatsApp"
                                    items={whatsappItems}
                                    onCheckout={checkoutItem}
                                    onEdit={editSettings}
                                    onAddFiles={addFiles}
                                    onRemove={removeFromCart}
                                    getTimeLeft={getTimeLeft}
                                />
                            )}

                            <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', flexWrap: 'wrap', padding: '22px', borderRadius: '18px', background: 'var(--fg)', color: 'var(--bg)' }}>
                                <div>
                                    <p style={{ fontSize: '12px', opacity: 0.7, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0 }}>Cart Total</p>
                                    <p style={{ fontSize: '32px', fontWeight: '900', letterSpacing: 0 }}>Rs {total.toFixed(2)}</p>
                                </div>
                                <p style={{ fontSize: '13px', opacity: 0.72, maxWidth: '320px' }}>Pay one saved print order at a time. Each order is sent as Instant Print.</p>
                            </div>
                        </div>
                    )}
                </div>
            </section>

            <style>{`
                @media (max-width: 760px) {
                    .cart-row {
                        grid-template-columns: 1fr !important;
                    }
                    .cart-row > div:last-child {
                        border-left: none !important;
                        border-top: 1px solid var(--border);
                    }
                }
            `}</style>
        </div>
    );
}

function CartSection({
    title,
    items,
    onCheckout,
    onEdit,
    onAddFiles,
    onRemove,
    getTimeLeft,
}: {
    title: string;
    items: { item: ReturnType<typeof useApp>['cart'][number]; index: number }[];
    onCheckout: (item: ReturnType<typeof useApp>['cart'][number]) => void;
    onEdit: (item: ReturnType<typeof useApp>['cart'][number]) => void;
    onAddFiles: (item: ReturnType<typeof useApp>['cart'][number], index: number) => void;
    onRemove: (idx: number) => void;
    getTimeLeft: (createdAt: string) => string;
}) {
    if (items.length === 0) return null;

    return (
        <div style={{ display: 'grid', gap: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                <h2 style={{ fontSize: '18px', fontWeight: '900', letterSpacing: 0 }}>{title}</h2>
                <span className="badge badge-outline"><Clock3 size={12} /> Available for 12 hours</span>
            </div>

            {items.map(({ item, index }) => (
                <div key={`${item.shopId}-${item.fileName}-${item.createdAt}-${index}`} className="card" style={{ padding: '0', overflow: 'hidden', borderRadius: '18px' }}>
                    <div className="cart-row" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 230px', gap: '0' }}>
                        <div style={{ padding: '22px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '14px' }}>
                                <div style={{ width: '44px', height: '44px', borderRadius: '12px', background: 'var(--accent-muted)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                    <FileText size={20} />
                                </div>
                                <div style={{ minWidth: 0 }}>
                                    <h3 style={{ fontSize: '18px', fontWeight: '900', letterSpacing: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.fileName}</h3>
                                    <p style={{ fontSize: '13px', color: 'var(--fg-muted)', fontWeight: '700' }}>{item.shopName}</p>
                                </div>
                            </div>
                            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                                <span className="badge badge-outline">{item.pages} pages</span>
                                <span className="badge badge-outline">{item.color ? 'Color' : 'B and W'}</span>
                                <span className="badge badge-outline">{item.sides === 'single' ? 'Single side' : 'Double side'}</span>
                                <span className="badge badge-outline">{item.copies} cop{item.copies === 1 ? 'y' : 'ies'}</span>
                                <span className="badge badge-accent"><Clock3 size={12} /> {getTimeLeft(item.createdAt)}</span>
                            </div>
                        </div>
                        <div style={{ background: 'var(--bg-secondary)', borderLeft: '1px solid var(--border)', padding: '22px', display: 'grid', gap: '10px', alignContent: 'center' }}>
                            <div>
                                <p style={{ fontSize: '12px', color: 'var(--fg-subtle)', fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0 }}>Amount</p>
                                <p style={{ fontSize: '28px', fontWeight: '900', letterSpacing: 0 }}>Rs {item.totalAmount.toFixed(2)}</p>
                            </div>
                            <button onClick={() => onCheckout(item)} className="btn btn-accent btn-full" style={{ borderRadius: '12px', fontWeight: '900' }}>
                                <Zap size={16} /> Pay Now
                            </button>
                            <button onClick={() => onEdit(item)} className="btn btn-outline btn-full" style={{ borderRadius: '12px', fontWeight: '800' }}>
                                <Settings2 size={16} /> Edit Settings
                            </button>
                            <button onClick={() => onAddFiles(item, index)} className="btn btn-outline btn-full" style={{ borderRadius: '12px', fontWeight: '800' }}>
                                <PlusCircle size={16} /> Add Files
                            </button>
                            <button onClick={() => onRemove(index)} className="btn btn-outline btn-full" style={{ borderRadius: '12px', color: '#ef4444' }}>
                                <Trash2 size={16} /> Remove
                            </button>
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
}

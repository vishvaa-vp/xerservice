'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
    MessageCircle,
    FileText,
    Trash2,
    Zap,
    RefreshCw,
    ExternalLink,
    Clock,
    ShoppingCart,
    ArrowRight,
    CheckCircle2,
    AlertCircle,
    Store,
} from 'lucide-react';
import { useApp } from '@/context/AppContext';
import { supabase } from '@/lib/supabase/client';

interface WhatsAppFile {
    id: string;
    originalFilename: string;
    mimeType: string;
    fileSize: number;
    pageCount: number;
    validationStatus: string;
    createdAt: string;
    expiresAt: string;
    storagePath: string;
}

interface WhatsAppStatus {
    status: 'not_linked' | 'pending' | 'awaiting_confirmation' | 'connected';
    maskedPhone: string | null;
    linkedAt: string | null;
    orderUpdatesOptIn: boolean;
}

export default function WhatsAppDocumentsPage() {
    const router = useRouter();
    const { addToCart, isLoggedIn, isLoading, authInitialized } = useApp();

    const [status, setStatus] = useState<WhatsAppStatus>({
        status: 'not_linked',
        maskedPhone: null,
        linkedAt: null,
        orderUpdatesOptIn: false,
    });
    const [files, setFiles] = useState<WhatsAppFile[]>([]);
    const [loading, setLoading] = useState(true);
    const [configuringId, setConfiguringId] = useState<string | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [actionMsg, setActionMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    const loadData = useCallback(async () => {
        setLoading(true);
        setActionMsg(null);
        try {
            const { data: sessionData } = await supabase.auth.getSession();
            const token = sessionData.session?.access_token;
            if (!token) return;

            // Load WhatsApp connection status
            const statusRes = await fetch('/api/customer/whatsapp/status', {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (statusRes.ok) {
                const statusData = await statusRes.json();
                setStatus({
                    status: statusData.status || 'not_linked',
                    maskedPhone: statusData.maskedPhone || null,
                    linkedAt: statusData.linkedAt || null,
                    orderUpdatesOptIn: !!statusData.orderUpdatesOptIn,
                });
            }

            // Load incoming WhatsApp files
            const filesRes = await fetch('/api/customer/whatsapp/files', {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (filesRes.ok) {
                const filesData = await filesRes.json();
                if (Array.isArray(filesData.files)) {
                    setFiles(filesData.files);
                }
            }
        } catch (err) {
            console.error('Failed to load WhatsApp data:', err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (!authInitialized || isLoading) return;
        if (!isLoggedIn) {
            router.push('/login?redirect=/dashboard/whatsapp');
            return;
        }
        loadData();
    }, [authInitialized, isLoading, isLoggedIn, router, loadData]);

    const handleConfigureFile = async (fileId: string) => {
        setConfiguringId(fileId);
        setActionMsg(null);
        try {
            const { data: sessionData } = await supabase.auth.getSession();
            const token = sessionData.session?.access_token;
            if (!token) {
                router.push('/login?redirect=/dashboard/whatsapp');
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
                setActionMsg({ type: 'error', text: data.error || 'Failed to prepare WhatsApp document for cart.' });
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

            setFiles(prev => prev.filter(f => f.id !== fileId));
            setActionMsg({ type: 'success', text: `"${data.cartItem.fileName}" added to your cart!` });
            router.push('/cart');
        } catch (err) {
            console.error('Error configuring WhatsApp file:', err);
            setActionMsg({ type: 'error', text: 'Network error configuring document.' });
        } finally {
            setConfiguringId(null);
        }
    };

    const handleDeleteFile = async (fileId: string) => {
        if (!confirm('Are you sure you want to remove this imported WhatsApp document?')) return;
        setDeletingId(fileId);
        setActionMsg(null);
        try {
            const { data: sessionData } = await supabase.auth.getSession();
            const token = sessionData.session?.access_token;
            if (!token) return;

            const res = await fetch(`/api/customer/whatsapp/files/${fileId}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` },
            });

            if (res.ok) {
                setFiles(prev => prev.filter(f => f.id !== fileId));
                setActionMsg({ type: 'success', text: 'Document removed from WhatsApp queue.' });
            } else {
                const data = await res.json();
                setActionMsg({ type: 'error', text: data.error || 'Failed to remove document.' });
            }
        } catch (err) {
            console.error('Error deleting WhatsApp file:', err);
            setActionMsg({ type: 'error', text: 'Network error deleting document.' });
        } finally {
            setDeletingId(null);
        }
    };

    if (!authInitialized || (isLoading && !isLoggedIn)) {
        return (
            <div style={{ minHeight: '70vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span className="spinner spinner-lg" />
            </div>
        );
    }

    return (
        <div className="page-wrapper">
            <section className="section-sm">
                <div className="container-sm" style={{ maxWidth: '900px' }}>
                    {/* Header bar matching Cart */}
                    <div
                        style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'flex-end',
                            gap: '16px',
                            flexWrap: 'wrap',
                            marginBottom: '28px',
                            borderBottom: '1px solid var(--border)',
                            paddingBottom: '20px',
                        }}
                    >
                        <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
                                <h1 style={{ fontSize: '30px', fontWeight: '900', letterSpacing: '-0.02em', margin: 0 }}>
                                    WhatsApp Documents
                                </h1>
                            </div>
                            <p style={{ fontSize: '15px', color: 'var(--fg-muted)', margin: 0 }}>
                                {files.length} document{files.length === 1 ? '' : 's'} imported from WhatsApp bot
                            </p>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <button
                                onClick={loadData}
                                disabled={loading}
                                className="btn btn-outline btn-sm"
                                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px' }}
                                title="Refresh files"
                            >
                                <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                                <span>Refresh</span>
                            </button>
                            <Link href="/cart" className="btn btn-primary btn-sm" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                <ShoppingCart size={15} />
                                <span>View Cart</span>
                            </Link>
                        </div>
                    </div>

                    {/* Notification feedback if any */}
                    {actionMsg && (
                        <div
                            style={{
                                padding: '12px 16px',
                                borderRadius: '12px',
                                marginBottom: '20px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '10px',
                                fontSize: '14px',
                                fontWeight: '600',
                                background: actionMsg.type === 'success' ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                                color: actionMsg.type === 'success' ? '#16a34a' : '#ef4444',
                                border: `1px solid ${actionMsg.type === 'success' ? 'rgba(34, 197, 94, 0.25)' : 'rgba(239, 68, 68, 0.25)'}`,
                            }}
                        >
                            {actionMsg.type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
                            <span>{actionMsg.text}</span>
                        </div>
                    )}

                    {/* Single Horizontal WhatsApp Connection Status Card */}
                    <div
                        className="card"
                        style={{
                            padding: '22px 26px',
                            marginBottom: '26px',
                            border: status.status === 'connected' ? '1.5px solid rgba(34, 197, 94, 0.35)' : '1px solid var(--border)',
                            background: status.status === 'connected' ? 'var(--bg-secondary)' : 'var(--bg)',
                            borderRadius: '16px',
                        }}
                    >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px', maxWidth: '620px' }}>
                                <div
                                    style={{
                                        width: '42px',
                                        height: '42px',
                                        borderRadius: '12px',
                                        background: 'rgba(22, 163, 74, 0.12)',
                                        color: '#16a34a',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        flexShrink: 0,
                                        marginTop: '2px',
                                    }}
                                >
                                    <MessageCircle size={22} />
                                </div>
                                <div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                                        <h2 style={{ fontSize: '18px', fontWeight: '800', margin: 0, letterSpacing: '-0.01em' }}>
                                            WhatsApp Document Import
                                        </h2>
                                        {status.status === 'connected' ? (
                                            <span className="badge badge-success" style={{ fontSize: '11px', textTransform: 'uppercase' }}>
                                                Connected
                                            </span>
                                        ) : status.status === 'awaiting_confirmation' ? (
                                            <span className="badge badge-accent" style={{ fontSize: '11px', textTransform: 'uppercase' }}>
                                                Awaiting Confirmation
                                            </span>
                                        ) : (
                                            <span className="badge badge-outline" style={{ fontSize: '11px' }}>
                                                Not linked
                                            </span>
                                        )}
                                    </div>
                                    <p style={{ color: 'var(--fg-muted)', fontSize: '13px', lineHeight: '1.5', margin: '6px 0 0 0' }}>
                                        {status.status === 'connected'
                                            ? `Linked to ${status.maskedPhone || 'your WhatsApp account'}${status.linkedAt ? ` on ${new Date(status.linkedAt).toLocaleDateString()}` : ''}. Documents sent to XerService on WhatsApp will automatically sync here and to your cart.`
                                            : status.status === 'awaiting_confirmation'
                                            ? `Verification message received from ${status.maskedPhone || 'your number'}. Please confirm to finalize linking.`
                                            : 'Link your WhatsApp phone number to automatically import documents sent to XerService WhatsApp bot into your cart.'}
                                    </p>
                                </div>
                            </div>
                            <div>
                                {status.status === 'connected' ? (
                                    <Link
                                        href="/dashboard/profile#whatsapp"
                                        className="btn btn-outline btn-sm"
                                        style={{ borderRadius: '8px', fontSize: '13px', fontWeight: '700' }}
                                    >
                                        Manage in Profile
                                    </Link>
                                ) : (
                                    <Link
                                        href="/dashboard/profile?connectWhatsapp=1#whatsapp-connect"
                                        className="btn btn-accent btn-sm"
                                        style={{ borderRadius: '8px', fontWeight: '800', fontSize: '13px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                                    >
                                        <span>{status.status === 'awaiting_confirmation' ? 'Confirm Connection' : 'Connect WhatsApp'}</span>
                                        <ArrowRight size={14} />
                                    </Link>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Documents List */}
                    {loading && files.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '60px 20px' }}>
                            <span className="spinner spinner-md" />
                            <p style={{ color: 'var(--fg-muted)', fontSize: '14px', marginTop: '12px' }}>Loading WhatsApp documents…</p>
                        </div>
                    ) : files.length === 0 ? (
                        /* Empty State matching Cart's clean aesthetic */
                        <div
                            style={{
                                textAlign: 'center',
                                padding: '72px 24px',
                                background: 'var(--bg-secondary)',
                                border: '2px dashed var(--border)',
                                borderRadius: '22px',
                            }}
                        >
                            <div
                                style={{
                                    width: '74px',
                                    height: '74px',
                                    borderRadius: '24px',
                                    background: 'var(--bg)',
                                    border: '1px solid var(--border)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    margin: '0 auto 20px',
                                    color: '#16a34a',
                                }}
                            >
                                <MessageCircle size={36} />
                            </div>
                            <h2 style={{ fontSize: '22px', fontWeight: '900', letterSpacing: '-0.02em', marginBottom: '8px' }}>
                                No WhatsApp documents yet
                            </h2>
                            <p style={{ fontSize: '15px', color: 'var(--fg-muted)', maxWidth: '460px', margin: '0 auto 24px', lineHeight: '1.6' }}>
                                Send PDF documents, notes, or images directly to the XerService WhatsApp bot, and they will instantly show up here ready to configure and print.
                            </p>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', flexWrap: 'wrap' }}>
                                {status.status !== 'connected' ? (
                                    <Link
                                        href="/dashboard/profile?connectWhatsapp=1#whatsapp-connect"
                                        className="btn btn-accent"
                                        style={{ fontWeight: '800' }}
                                    >
                                        Connect WhatsApp Now
                                    </Link>
                                ) : (
                                    <Link href="/" className="btn btn-outline" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                                        <Store size={16} />
                                        <span>Browse Print Shops</span>
                                    </Link>
                                )}
                            </div>
                        </div>
                    ) : (
                        <div style={{ display: 'grid', gap: '14px' }}>
                            {files.map((file) => (
                                <div
                                    key={file.id}
                                    className="card"
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                        padding: '18px 22px',
                                        background: 'var(--bg)',
                                        borderRadius: '16px',
                                        border: '1px solid var(--border)',
                                        flexWrap: 'wrap',
                                        gap: '16px',
                                    }}
                                >
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px', minWidth: '240px' }}>
                                        <div
                                            style={{
                                                width: '44px',
                                                height: '44px',
                                                borderRadius: '12px',
                                                background: 'var(--bg-secondary)',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                border: '1px solid var(--border)',
                                                color: 'var(--accent)',
                                                flexShrink: 0,
                                            }}
                                        >
                                            <FileText size={22} />
                                        </div>
                                        <div>
                                            <p style={{ fontSize: '15px', fontWeight: '800', margin: 0, wordBreak: 'break-word' }}>
                                                {file.originalFilename}
                                            </p>
                                            <p style={{ fontSize: '12px', color: 'var(--fg-muted)', margin: '4px 0 0', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                                <span>{file.pageCount ? `${file.pageCount} page${file.pageCount === 1 ? '' : 's'}` : '1 image/page'}</span>
                                                <span>•</span>
                                                <span>{(file.fileSize / 1024).toFixed(0)} KB</span>
                                                <span>•</span>
                                                <span>Received {new Date(file.createdAt).toLocaleDateString()}</span>
                                            </p>
                                        </div>
                                    </div>

                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                        <button
                                            onClick={() => handleConfigureFile(file.id)}
                                            disabled={configuringId === file.id}
                                            className="btn btn-sm btn-accent"
                                            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: '800', borderRadius: '8px' }}
                                        >
                                            {configuringId === file.id ? <span className="spinner spinner-xs" /> : <Zap size={14} />}
                                            <span>Configure & Add to Cart</span>
                                        </button>
                                        <button
                                            onClick={() => handleDeleteFile(file.id)}
                                            disabled={deletingId === file.id}
                                            className="btn btn-sm btn-outline"
                                            style={{ color: '#ef4444', borderColor: 'rgba(239, 68, 68, 0.3)', borderRadius: '8px', padding: '7px 10px' }}
                                            title="Delete WhatsApp document"
                                        >
                                            {deletingId === file.id ? <span className="spinner spinner-xs" /> : <Trash2 size={15} />}
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </section>
        </div>
    );
}

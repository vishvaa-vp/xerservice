'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
import AdminHeaderNav from '@/components/admin/AdminHeaderNav';
import {
    Plus,
    Edit3,
    Trash2,
    Check,
    X,
    Clock,
    Layers,
    Image as ImageIcon,
    Shield,
    UploadCloud,
    AlertCircle,
    CheckCircle2,
    RefreshCw,
    Store,
    DollarSign,
} from 'lucide-react';
import ConfirmDialog from '@/components/ui/ConfirmDialog';

interface ShopAssignment {
    shopId: string;
    shopName?: string;
    price: number;
    isAvailable: boolean;
}

interface AddonCatalogItem {
    id: string;
    name: string;
    description: string | null;
    imageUrl: string | null;
    estimatedMinutes: number;
    minPages: number;
    maxPages: number;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
    assignments: ShopAssignment[];
}

interface ShopOption {
    id: string;
    name: string;
    status: string;
}

export default function AdminAddonsPage() {
    const router = useRouter();
    const [loading, setLoading] = useState(true);
    const [authError, setAuthError] = useState<string | null>(null);
    const [addons, setAddons] = useState<AddonCatalogItem[]>([]);
    const [shops, setShops] = useState<ShopOption[]>([]);
    const [adminToken, setAdminToken] = useState<string | null>(null);

    // Modal state for Create / Edit
    const [showModal, setShowModal] = useState(false);
    const [editingAddon, setEditingAddon] = useState<AddonCatalogItem | null>(null);
    const [formName, setFormName] = useState('');
    const [formDescription, setFormDescription] = useState('');
    const [formImageUrl, setFormImageUrl] = useState('');
    const [formPrice, setFormPrice] = useState('30');
    const [formEstimatedMinutes, setFormEstimatedMinutes] = useState('10');
    const [formMinPages, setFormMinPages] = useState('10');
    const [formMaxPages, setFormMaxPages] = useState('200');
    const [formIsActive, setFormIsActive] = useState(true);
    const [formSelectedShopIds, setFormSelectedShopIds] = useState<string[]>([]);

    const [uploadingImage, setUploadingImage] = useState(false);
    const [saving, setSaving] = useState(false);
    const [actionError, setActionError] = useState<string | null>(null);
    const [feedback, setFeedback] = useState<string | null>(null);

    // Delete confirmation
    const [deleteTarget, setDeleteTarget] = useState<AddonCatalogItem | null>(null);

    const checkAdminAuth = useCallback(async () => {
        try {
            setLoading(true);
            const { data: { session } } = await supabase.auth.getSession();
            if (!session?.user || !session.access_token) {
                router.replace('/xad/login?redirect=/admin/addons');
                return;
            }

            setAdminToken(session.access_token);

            // Fetch admin profile
            const { data: profile } = await supabase
                .from('profiles')
                .select('role')
                .eq('user_id', session.user.id)
                .maybeSingle();

            if (profile?.role !== 'admin') {
                setAuthError('Forbidden: Administrator privileges required.');
                setLoading(false);
                return;
            }

            // Load addons & shops
            await loadData(session.access_token);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            setAuthError(msg);
        } finally {
            setLoading(false);
        }
    }, [router]);

    const loadData = async (token: string) => {
        try {
            const [addonsRes, shopsRes] = await Promise.all([
                fetch('/api/admin/addons', { headers: { Authorization: `Bearer ${token}` } }),
                fetch('/api/admin/finance/shops', { headers: { Authorization: `Bearer ${token}` } }).catch(() => null),
            ]);

            if (addonsRes.ok) {
                const data = await addonsRes.json();
                setAddons(data.addons || []);
            }

            if (shopsRes && shopsRes.ok) {
                const shopData = await shopsRes.json();
                setShops((shopData.shops || []).map((s: any) => ({
                    id: s.shopId,
                    name: s.shopName,
                    status: s.shopStatus,
                })));
            } else {
                // Fallback shops
                setShops([
                    { id: '4fa63198-dbe3-485a-a38f-dc4454f0a996', name: 'D-Block Reprography ITECH', status: 'OPEN' }
                ]);
            }
        } catch (err) {
            console.error('[AdminAddons] Load data error:', err);
        }
    };

    useEffect(() => {
        checkAdminAuth();
    }, [checkAdminAuth]);

    const handleOpenCreate = () => {
        setEditingAddon(null);
        setFormName('');
        setFormDescription('');
        setFormImageUrl('');
        setFormPrice('30');
        setFormEstimatedMinutes('10');
        setFormMinPages('10');
        setFormMaxPages('200');
        setFormIsActive(true);
        // Default to all active shops checked
        setFormSelectedShopIds(shops.map(s => s.id));
        setActionError(null);
        setShowModal(true);
    };

    const handleOpenEdit = (item: AddonCatalogItem) => {
        setEditingAddon(item);
        setFormName(item.name);
        setFormDescription(item.description || '');
        setFormImageUrl(item.imageUrl || '');
        const currentPrice = item.assignments?.[0]?.price ?? 30;
        setFormPrice(String(currentPrice));
        setFormEstimatedMinutes(String(item.estimatedMinutes));
        setFormMinPages(String(item.minPages));
        setFormMaxPages(String(item.maxPages));
        setFormIsActive(item.isActive);
        setFormSelectedShopIds(item.assignments?.map(a => a.shopId) || []);
        setActionError(null);
        setShowModal(true);
    };

    const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !adminToken) return;

        setUploadingImage(true);
        setActionError(null);

        try {
            const formData = new FormData();
            formData.append('file', file);

            const res = await fetch('/api/admin/addons/upload-image', {
                method: 'POST',
                headers: { Authorization: `Bearer ${adminToken}` },
                body: formData,
            });

            const json = await res.json();
            if (!res.ok) {
                setActionError(json.error || 'Failed to upload image.');
            } else if (json.imageUrl) {
                setFormImageUrl(json.imageUrl);
            }
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            setActionError(`Image upload error: ${msg}`);
        } finally {
            setUploadingImage(false);
        }
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!adminToken) return;

        const name = formName.trim();
        if (!name) {
            setActionError('Add-on name is required.');
            return;
        }

        const price = Number(formPrice);
        if (isNaN(price) || price < 0) {
            setActionError('Valid positive price is required.');
            return;
        }

        const estimatedMinutes = Math.max(0, parseInt(formEstimatedMinutes, 10) || 0);
        const minPages = Math.max(1, parseInt(formMinPages, 10) || 1);
        const maxPages = Math.max(minPages, parseInt(formMaxPages, 10) || minPages);

        setSaving(true);
        setActionError(null);

        try {
            if (editingAddon) {
                // Update
                const assignments = formSelectedShopIds.map(shopId => ({
                    shopId,
                    price,
                }));

                const res = await fetch(`/api/admin/addons/${editingAddon.id}`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${adminToken}`,
                    },
                    body: JSON.stringify({
                        name,
                        description: formDescription.trim() || null,
                        imageUrl: formImageUrl || null,
                        estimatedMinutes,
                        minPages,
                        maxPages,
                        isActive: formIsActive,
                        shopAssignments: assignments,
                    }),
                });

                const data = await res.json();
                if (!res.ok) {
                    setActionError(data.error || 'Failed to update add-on.');
                    return;
                }
                setFeedback('Add-on updated successfully.');
            } else {
                // Create
                const res = await fetch('/api/admin/addons', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${adminToken}`,
                    },
                    body: JSON.stringify({
                        name,
                        description: formDescription.trim() || null,
                        imageUrl: formImageUrl || null,
                        estimatedMinutes,
                        minPages,
                        maxPages,
                        price,
                        shopIds: formSelectedShopIds,
                    }),
                });

                const data = await res.json();
                if (!res.ok) {
                    setActionError(data.error || 'Failed to create add-on.');
                    return;
                }
                setFeedback('New add-on created and assigned successfully.');
            }

            setShowModal(false);
            await loadData(adminToken);
            setTimeout(() => setFeedback(null), 4000);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            setActionError(`Save failed: ${msg}`);
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async () => {
        if (!deleteTarget || !adminToken) return;

        try {
            const res = await fetch(`/api/admin/addons/${deleteTarget.id}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${adminToken}` },
            });

            const data = await res.json();
            if (res.ok) {
                setFeedback(data.message || 'Add-on deleted.');
                await loadData(adminToken);
                setTimeout(() => setFeedback(null), 4000);
            } else {
                alert(data.error || 'Failed to delete add-on.');
            }
        } catch (err) {
            console.error('Delete error:', err);
        } finally {
            setDeleteTarget(null);
        }
    };

    if (loading) {
        return (
            <div style={{ minHeight: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span className="spinner spinner-lg" />
            </div>
        );
    }

    if (authError) {
        return (
            <div className="container" style={{ padding: '60px 20px', textAlign: 'center' }}>
                <div style={{ maxWidth: '440px', margin: '0 auto', background: 'var(--bg-secondary)', padding: '32px', borderRadius: '16px', border: '1px solid var(--border)' }}>
                    <Shield size={36} color="#ef4444" style={{ marginBottom: '16px' }} />
                    <h2 style={{ fontSize: '20px', fontWeight: '800', marginBottom: '8px' }}>Admin Access Restricted</h2>
                    <p style={{ fontSize: '14px', color: 'var(--fg-muted)', marginBottom: '20px' }}>{authError}</p>
                    <Link href="/xad/login?redirect=/admin/addons" className="btn btn-primary btn-full">Sign in to Admin Console</Link>
                </div>
            </div>
        );
    }

    return (
        <div style={{ maxWidth: '1360px', margin: '0 auto', padding: '32px 16px' }}>
            {/* Header Navigation */}
            <AdminHeaderNav
                activeSection="addons"
                title="Shop services"
                description="Manage binding, stapling, lamination, prices, page limits, and which shops offer each service."
                actions={
                    <button
                        onClick={handleOpenCreate}
                        className="btn btn-primary"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                    >
                        <Plus size={15} /> Add service
                    </button>
                }
            />
                {feedback && (
                    <div style={{ marginBottom: '20px', padding: '12px 16px', borderRadius: '10px', background: 'rgba(34, 197, 94, 0.1)', border: '1px solid rgba(34, 197, 94, 0.25)', color: '#16a34a', fontSize: '13.5px', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <CheckCircle2 size={18} /> {feedback}
                    </div>
                )}

                {/* Add-ons List */}
                <div className="card" style={{ padding: '0', borderRadius: '16px', overflow: 'hidden', border: '1px solid var(--border)', background: 'var(--bg)' }}>
                    <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <h2 style={{ fontSize: '16px', fontWeight: '800', margin: 0 }}>Active Catalog ({addons.length})</h2>
                        <button onClick={() => adminToken && loadData(adminToken)} className="btn-ghost" style={{ padding: '6px', borderRadius: '6px' }} title="Refresh list">
                            <RefreshCw size={15} />
                        </button>
                    </div>

                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
                            <thead>
                                <tr style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)', color: 'var(--fg-subtle)', fontWeight: '800', textTransform: 'uppercase', fontSize: '11px', letterSpacing: '0.04em' }}>
                                    <th style={{ padding: '12px 20px' }}>Add-on</th>
                                    <th style={{ padding: '12px 16px' }}>Price</th>
                                    <th style={{ padding: '12px 16px' }}>Extra Prep Time</th>
                                    <th style={{ padding: '12px 16px' }}>Page Bounds</th>
                                    <th style={{ padding: '12px 16px' }}>Assigned Shops</th>
                                    <th style={{ padding: '12px 16px' }}>Status</th>
                                    <th style={{ padding: '12px 20px', textAlign: 'right' }}>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {addons.length === 0 ? (
                                    <tr>
                                        <td colSpan={7} style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--fg-muted)' }}>
                                            No add-ons created yet. Click "Create Add-on" to get started.
                                        </td>
                                    </tr>
                                ) : (
                                    addons.map(addon => {
                                        const basePrice = addon.assignments?.[0]?.price ?? 30;
                                        return (
                                            <tr key={addon.id} style={{ borderBottom: '1px solid var(--border)' }}>
                                                <td style={{ padding: '14px 20px' }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                                        <div style={{ width: '40px', height: '40px', borderRadius: '8px', background: 'var(--bg-secondary)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 }}>
                                                            {addon.imageUrl ? (
                                                                <img src={addon.imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                                            ) : (
                                                                <Layers size={18} color="var(--accent)" />
                                                            )}
                                                        </div>
                                                        <div>
                                                            <div style={{ fontWeight: '800', color: 'var(--fg)' }}>{addon.name}</div>
                                                            {addon.description && (
                                                                <div style={{ fontSize: '11.5px', color: 'var(--fg-muted)', maxWidth: '280px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                                    {addon.description}
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                </td>
                                                <td style={{ padding: '14px 16px', fontWeight: '800', color: 'var(--accent)' }}>
                                                    ₹{basePrice.toFixed(2)}
                                                </td>
                                                <td style={{ padding: '14px 16px' }}>
                                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: 'var(--fg-muted)', fontSize: '12px' }}>
                                                        <Clock size={13} /> +{addon.estimatedMinutes} min
                                                    </span>
                                                </td>
                                                <td style={{ padding: '14px 16px', fontSize: '12px' }}>
                                                    {addon.minPages} – {addon.maxPages} pages
                                                </td>
                                                <td style={{ padding: '14px 16px' }}>
                                                    {addon.assignments && addon.assignments.length > 0 ? (
                                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                                                            {addon.assignments.map(a => (
                                                                <span key={a.shopId} className="badge badge-outline" style={{ fontSize: '11px', padding: '3px 8px', borderRadius: '6px' }}>
                                                                    {a.shopName || 'Print Shop'} (₹{a.price.toFixed(2)}){a.isAvailable ? '' : ' [Unavailable]'}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    ) : (
                                                        <span style={{ color: 'var(--fg-muted)', fontSize: '12px', fontStyle: 'italic' }}>
                                                            No shops assigned
                                                        </span>
                                                    )}
                                                </td>
                                                <td style={{ padding: '14px 16px' }}>
                                                    <span className={`badge ${addon.isActive ? 'badge-success' : 'badge-outline'}`} style={{ fontSize: '11px' }}>
                                                        {addon.isActive ? 'Active' : 'Inactive'}
                                                    </span>
                                                </td>
                                                <td style={{ padding: '14px 20px', textAlign: 'right' }}>
                                                    <div style={{ display: 'inline-flex', gap: '6px' }}>
                                                        <button
                                                            type="button"
                                                            onClick={() => handleOpenEdit(addon)}
                                                            className="btn btn-outline btn-sm"
                                                            style={{ padding: '6px 10px', fontSize: '11.5px' }}
                                                        >
                                                            <Edit3 size={13} /> Edit
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => setDeleteTarget(addon)}
                                                            className="btn btn-outline btn-sm"
                                                            style={{ padding: '6px 10px', fontSize: '11.5px', color: '#ef4444', borderColor: 'rgba(239, 68, 68, 0.3)' }}
                                                        >
                                                            <Trash2 size={13} />
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

            {/* Create / Edit Modal */}
            {showModal && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
                    <div className="card fade-in" style={{ maxWidth: '580px', width: '100%', maxHeight: '92vh', overflowY: 'auto', padding: '24px', borderRadius: '16px', background: 'var(--bg)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '18px' }}>
                            <h2 style={{ fontSize: '18px', fontWeight: '900', margin: 0 }}>
                                {editingAddon ? 'Edit Print Add-on' : 'Create Print Add-on'}
                            </h2>
                            <button type="button" onClick={() => setShowModal(false)} className="btn-ghost" style={{ padding: '6px' }}>
                                <X size={18} />
                            </button>
                        </div>

                        {actionError && (
                            <div style={{ marginBottom: '16px', padding: '10px 14px', borderRadius: '8px', background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.25)', color: '#ef4444', fontSize: '13px', fontWeight: '600' }}>
                                {actionError}
                            </div>
                        )}

                        <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                            <div>
                                <label style={{ display: 'block', fontSize: '12px', fontWeight: '800', textTransform: 'uppercase', color: 'var(--fg-subtle)', marginBottom: '6px' }}>
                                    Name *
                                </label>
                                <input
                                    type="text"
                                    required
                                    placeholder="e.g. Spiral Binding"
                                    value={formName}
                                    onChange={e => setFormName(e.target.value)}
                                    className="input"
                                    style={{ width: '100%' }}
                                />
                            </div>

                            <div>
                                <label style={{ display: 'block', fontSize: '12px', fontWeight: '800', textTransform: 'uppercase', color: 'var(--fg-subtle)', marginBottom: '6px' }}>
                                    Description
                                </label>
                                <textarea
                                    placeholder="Brief customer-facing summary..."
                                    rows={2}
                                    value={formDescription}
                                    onChange={e => setFormDescription(e.target.value)}
                                    className="input"
                                    style={{ width: '100%', resize: 'vertical' }}
                                />
                            </div>

                            {/* Image Picker */}
                            <div>
                                <label style={{ display: 'block', fontSize: '12px', fontWeight: '800', textTransform: 'uppercase', color: 'var(--fg-subtle)', marginBottom: '6px' }}>
                                    Add-on Image (1:1 Square)
                                </label>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                                    <div style={{ width: '60px', height: '60px', borderRadius: '10px', background: 'var(--bg-secondary)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 }}>
                                        {formImageUrl ? (
                                            <img src={formImageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                        ) : (
                                            <ImageIcon size={22} color="var(--fg-muted)" />
                                        )}
                                    </div>
                                    <label className="btn btn-outline btn-sm" style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                        <UploadCloud size={14} /> {uploadingImage ? 'Uploading...' : 'Choose Image'}
                                        <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleImageUpload} style={{ display: 'none' }} disabled={uploadingImage} />
                                    </label>
                                    {formImageUrl && (
                                        <button type="button" onClick={() => setFormImageUrl('')} className="btn-ghost" style={{ fontSize: '12px', color: '#ef4444' }}>
                                            Remove
                                        </button>
                                    )}
                                </div>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                                <div>
                                    <label style={{ display: 'block', fontSize: '12px', fontWeight: '800', textTransform: 'uppercase', color: 'var(--fg-subtle)', marginBottom: '6px' }}>
                                        Price (₹) *
                                    </label>
                                    <input
                                        type="number"
                                        step="0.5"
                                        min="0"
                                        required
                                        value={formPrice}
                                        onChange={e => setFormPrice(e.target.value)}
                                        className="input"
                                        style={{ width: '100%' }}
                                    />
                                </div>
                                <div>
                                    <label style={{ display: 'block', fontSize: '12px', fontWeight: '800', textTransform: 'uppercase', color: 'var(--fg-subtle)', marginBottom: '6px' }}>
                                        Extra Time (minutes)
                                    </label>
                                    <input
                                        type="number"
                                        min="0"
                                        value={formEstimatedMinutes}
                                        onChange={e => setFormEstimatedMinutes(e.target.value)}
                                        className="input"
                                        style={{ width: '100%' }}
                                    />
                                </div>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                                <div>
                                    <label style={{ display: 'block', fontSize: '12px', fontWeight: '800', textTransform: 'uppercase', color: 'var(--fg-subtle)', marginBottom: '6px' }}>
                                        Min Pages *
                                    </label>
                                    <input
                                        type="number"
                                        min="1"
                                        required
                                        value={formMinPages}
                                        onChange={e => setFormMinPages(e.target.value)}
                                        className="input"
                                        style={{ width: '100%' }}
                                    />
                                </div>
                                <div>
                                    <label style={{ display: 'block', fontSize: '12px', fontWeight: '800', textTransform: 'uppercase', color: 'var(--fg-subtle)', marginBottom: '6px' }}>
                                        Max Pages *
                                    </label>
                                    <input
                                        type="number"
                                        min="1"
                                        required
                                        value={formMaxPages}
                                        onChange={e => setFormMaxPages(e.target.value)}
                                        className="input"
                                        style={{ width: '100%' }}
                                    />
                                </div>
                            </div>

                            {/* Assigned Shops */}
                            <div>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                                    <label style={{ display: 'block', fontSize: '12px', fontWeight: '800', textTransform: 'uppercase', color: 'var(--fg-subtle)', margin: 0 }}>
                                        Available at Print Shops
                                    </label>
                                    <div style={{ display: 'flex', gap: '8px' }}>
                                        <button
                                            type="button"
                                            onClick={() => setFormSelectedShopIds(shops.map(s => s.id))}
                                            className="btn-ghost"
                                            style={{ fontSize: '11.5px', padding: '2px 8px', color: 'var(--accent)', fontWeight: '700' }}
                                        >
                                            Select All
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setFormSelectedShopIds([])}
                                            className="btn-ghost"
                                            style={{ fontSize: '11.5px', padding: '2px 8px', color: 'var(--fg-muted)', fontWeight: '700' }}
                                        >
                                            Deselect All
                                        </button>
                                    </div>
                                </div>
                                <p style={{ fontSize: '12px', color: 'var(--fg-muted)', margin: '0 0 8px' }}>
                                    Check which shops provide this finishing service. Unchecking unassigns the add-on from that shop.
                                </p>
                                <div style={{ border: '1px solid var(--border)', borderRadius: '10px', padding: '10px 14px', background: 'var(--bg-secondary)', display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '180px', overflowY: 'auto' }}>
                                    {shops.length === 0 ? (
                                        <span style={{ fontSize: '12px', color: 'var(--fg-muted)' }}>No shops found in system.</span>
                                    ) : (
                                        shops.map(shop => {
                                            const isChecked = formSelectedShopIds.includes(shop.id);
                                            return (
                                                <label key={shop.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontSize: '13px', fontWeight: '600' }}>
                                                    <input
                                                        type="checkbox"
                                                        checked={isChecked}
                                                        onChange={e => {
                                                            if (e.target.checked) {
                                                                setFormSelectedShopIds(prev => [...prev, shop.id]);
                                                            } else {
                                                                setFormSelectedShopIds(prev => prev.filter(id => id !== shop.id));
                                                            }
                                                        }}
                                                    />
                                                    <span>{shop.name}</span>
                                                    <span style={{ fontSize: '11px', color: 'var(--fg-muted)', marginLeft: 'auto' }}>
                                                        {shop.status}
                                                    </span>
                                                </label>
                                            );
                                        })
                                    )}
                                </div>
                            </div>

                            {/* Active Toggle */}
                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: '700' }}>
                                <input
                                    type="checkbox"
                                    checked={formIsActive}
                                    onChange={e => setFormIsActive(e.target.checked)}
                                />
                                <span>Add-on Active in Customer Catalog</span>
                            </label>

                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '12px', paddingTop: '14px', borderTop: '1px solid var(--border)' }}>
                                <button type="button" onClick={() => setShowModal(false)} className="btn btn-outline" disabled={saving}>
                                    Cancel
                                </button>
                                <button type="submit" className="btn btn-primary" disabled={saving}>
                                    {saving ? 'Saving...' : editingAddon ? 'Update Add-on' : 'Create Add-on'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Delete Confirmation */}
            <ConfirmDialog
                open={Boolean(deleteTarget)}
                title={`Delete "${deleteTarget?.name}"?`}
                message="If this add-on has historical orders attached, it will be automatically soft-disabled to protect past order snapshots."
                confirmLabel="Delete Add-on"
                destructive
                onConfirm={handleDelete}
                onCancel={() => setDeleteTarget(null)}
            />
        </div>
    );
}

'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
import {
    ArrowLeft,
    Store,
    LayoutDashboard,
    FileText,
    Printer,
    Sparkles,
    Percent,
    DollarSign,
    Save,
    Clock,
    Phone,
    MapPin,
    AlertCircle,
    CheckCircle2,
    Shield,
    ExternalLink,
    ShoppingBag,
    Eye,
    Sliders,
    Plus,
    Trash2,
    Edit2,
    Copy,
    Check,
    Layers,
    ChevronDown,
    ChevronUp,
    X,
    UploadCloud,
    Image as ImageIcon,
} from 'lucide-react';
import ShopPhotoCropModal from '@/components/admin/ShopPhotoCropModal';
import type { ShopReadinessReport } from '@/lib/setup-readiness';
import type { ShopCustomerPreview } from '@/lib/customer-preview';

type WorkspaceTab = 'dashboard' | 'profile' | 'pricing' | 'addons' | 'commission';

interface ShopData {
    id: string;
    name: string;
    ownerId: string;
    shopStatus: 'OPEN' | 'PAUSED' | 'CLOSED';
    publishStatus: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
    address: string | null;
    photos: string[];
    contactPhone: string | null;
    openTime: string | null;
    closeTime: string | null;
    closingSoon: boolean;
    closingMessage: string | null;
    createdAt: string;
    updatedAt: string;
}

interface OwnerData {
    userId: string;
    fullName: string | null;
    email: string | null;
    phone: string | null;
    role: string;
    createdAt: string;
}

export default function DedicatedShopWorkspacePage() {
    const params = useParams();
    const router = useRouter();
    const vendorId = (params?.userId || params?.vendorId) as string;
    const shopId = params?.shopId as string;

    const [activeTab, setActiveTab] = useState<WorkspaceTab>('dashboard');
    const [loading, setLoading] = useState(true);
    const [authorized, setAuthorized] = useState(false);
    const [authError, setAuthError] = useState<string | null>(null);

    // Workspace Data
    const [shop, setShop] = useState<ShopData | null>(null);
    const [owner, setOwner] = useState<OwnerData | null>(null);
    const [summary, setSummary] = useState<any>(null);
    const [activeRule, setActiveRule] = useState<any>(null);
    const [rules, setRules] = useState<any[]>([]);
    const [pricing, setPricing] = useState<any[]>([]);
    const [addons, setAddons] = useState<any[]>([]);
    const [recentOrders, setRecentOrders] = useState<any[]>([]);
    const [ledgers, setLedgers] = useState<any[]>([]);

    // Profile Edit State
    const [editName, setEditName] = useState('');
    const [editAddress, setEditAddress] = useState('');
    const [editContactPhone, setEditContactPhone] = useState('');
    const [editTradingStatus, setEditTradingStatus] = useState<'OPEN' | 'PAUSED' | 'CLOSED'>('CLOSED');
    const [editPublishStatus, setEditPublishStatus] = useState<'DRAFT' | 'PUBLISHED' | 'ARCHIVED'>('DRAFT');
    const [editOpenTime, setEditOpenTime] = useState('09:00');
    const [editCloseTime, setEditCloseTime] = useState('18:00');
    const [editClosingSoon, setEditClosingSoon] = useState(false);
    const [editClosingMessage, setEditClosingMessage] = useState('');
    const [editPhotoUrl, setEditPhotoUrl] = useState('');

    const [saving, setSaving] = useState(false);
    const [saveFeedback, setSaveFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

    // Setup Readiness state (Priority 1)
    const [readiness, setReadiness] = useState<ShopReadinessReport | null>(null);
    const [forcePublish, setForcePublish] = useState(false);
    const [readinessExpanded, setReadinessExpanded] = useState(true);

    // Customer Preview state (Priority 2)
    const [customerPreview, setCustomerPreview] = useState<ShopCustomerPreview | null>(null);
    const [previewModalOpen, setPreviewModalOpen] = useState(false);
    const [simulatedStatus, setSimulatedStatus] = useState<'OPEN' | 'PAUSED' | 'CLOSED' | 'CLOSING_SOON' | null>(null);

    // Rate matrix state
    const [matrixRows, setMatrixRows] = useState<Array<{ paper_size: string; print_mode: string; sides: string; price_per_sheet: number; active: boolean; configured?: boolean }>>([]);
    const [savingMatrix, setSavingMatrix] = useState(false);
    const [matrixFeedback, setMatrixFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
    const [matrixFilterPaper, setMatrixFilterPaper] = useState<'ALL' | 'A4' | 'A3' | 'LEGAL'>('ALL');

    // Addons state
    const [availableCatalogue, setAvailableCatalogue] = useState<any[]>([]);
    const [assignModalOpen, setAssignModalOpen] = useState(false);
    const [assignAddonId, setAssignAddonId] = useState('');
    const [assignPrice, setAssignPrice] = useState('20');
    const [assigningAddon, setAssigningAddon] = useState(false);
    const [addonFeedback, setAddonFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

    // Custom add-on creation state
    const [addServiceMode, setAddServiceMode] = useState<'catalogue' | 'custom'>('custom');
    const [customName, setCustomName] = useState('');
    const [customDescription, setCustomDescription] = useState('');
    const [customImageUrl, setCustomImageUrl] = useState('');
    const [customPrice, setCustomPrice] = useState('20');
    const [customPrepTime, setCustomPrepTime] = useState('5');
    const [customMinPages, setCustomMinPages] = useState('1');
    const [customMaxPages, setCustomMaxPages] = useState('100');

    // Editing add-on state
    const [editingAddon, setEditingAddon] = useState<any | null>(null);
    const [editAddonName, setEditAddonName] = useState('');
    const [editAddonDescription, setEditAddonDescription] = useState('');
    const [editAddonImageUrl, setEditAddonImageUrl] = useState('');
    const [editAddonPrice, setEditAddonPrice] = useState('20');
    const [editAddonPrepTime, setEditAddonPrepTime] = useState('5');
    const [editAddonMinPages, setEditAddonMinPages] = useState('1');
    const [editAddonMaxPages, setEditAddonMaxPages] = useState('100');
    const [editAddonAvailable, setEditAddonAvailable] = useState(true);
    const [savingAddon, setSavingAddon] = useState(false);

    // Shop Photo Crop Modal state
    const [cropModalOpen, setCropModalOpen] = useState(false);
    const [cropImageSrc, setCropImageSrc] = useState<string | null>(null);
    const [cropFileInfo, setCropFileInfo] = useState<{ name: string; sizeKb: number } | null>(null);

    // Modern Commission Customizer state
    const [commSimOrderAmount, setCommSimOrderAmount] = useState<number>(100);
    const [showAdvancedScheduling, setShowAdvancedScheduling] = useState(false);

    const [newRuleRate, setNewRuleRate] = useState('10');
    const [newRuleEffectiveFrom, setNewRuleEffectiveFrom] = useState(new Date().toISOString().slice(0, 10));
    const [newRuleEffectiveTo, setNewRuleEffectiveTo] = useState('');
    const [newRuleClosePrevious, setNewRuleClosePrevious] = useState(true);
    const [creatingRule, setCreatingRule] = useState(false);
    const [ruleFeedback, setRuleFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

    const [dryRunLoading, setDryRunLoading] = useState(false);
    const [dryRunResult, setDryRunResult] = useState<any | null>(null);
    const [dryRunError, setDryRunError] = useState<string | null>(null);

    const fetchWorkspace = useCallback(async () => {
        if (!vendorId || !shopId) return;
        setLoading(true);
        setAuthError(null);

        try {
            const { data: { session }, error: sessionErr } = await supabase.auth.getSession();
            if (sessionErr || !session?.user) {
                setAuthError('Please sign in with administrator credentials.');
                setAuthorized(false);
                setLoading(false);
                return;
            }

            const { data: profile, error: profErr } = await supabase
                .from('profiles')
                .select('role')
                .eq('user_id', session.user.id)
                .maybeSingle();

            if (profErr || !profile || profile.role !== 'admin') {
                setAuthError('Access restricted: your account does not have admin privileges.');
                setAuthorized(false);
                setLoading(false);
                return;
            }

            setAuthorized(true);

            // 1. Fetch main workspace payload
            const res = await fetch(`/api/admin/vendors/${vendorId}/shops/${shopId}`, {
                headers: { Authorization: `Bearer ${session.access_token}` },
            });

            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.error || 'Failed to load shop workspace');
            }

            const data = await res.json();
            setShop(data.shop);
            setOwner(data.owner);
            setSummary(data.summary);
            setActiveRule(data.activeRule);
            setRules(data.rules || []);
            setPricing(data.pricing || []);
            setRecentOrders(data.recentOrders || []);
            setLedgers(data.ledgers || []);

            // 2. Fetch full rate matrix
            try {
                const matrixRes = await fetch(`/api/admin/vendors/${vendorId}/shops/${shopId}/pricing`, {
                    headers: { Authorization: `Bearer ${session.access_token}` },
                });
                if (matrixRes.ok) {
                    const mData = await matrixRes.json();
                    if (Array.isArray(mData.matrix)) setMatrixRows(mData.matrix);
                }
            } catch (mErr) {
                console.warn('Could not load full matrix:', mErr);
            }

            // 3. Fetch dedicated shop addons
            try {
                const addonsRes = await fetch(`/api/admin/vendors/${vendorId}/shops/${shopId}/addons`, {
                    headers: { Authorization: `Bearer ${session.access_token}` },
                });
                if (addonsRes.ok) {
                    const aData = await addonsRes.json();
                    if (Array.isArray(aData.assigned)) setAddons(aData.assigned);
                    if (Array.isArray(aData.availableCatalogue)) setAvailableCatalogue(aData.availableCatalogue);
                } else {
                    setAddons(data.addons || []);
                }
            } catch (aErr) {
                setAddons(data.addons || []);
            }

            // Populate form
            setEditName(data.shop.name || '');
            setEditAddress(data.shop.address || '');
            setEditContactPhone(data.shop.contactPhone || '');
            setEditTradingStatus(data.shop.shopStatus || 'CLOSED');
            setEditPublishStatus(data.shop.publishStatus || 'DRAFT');
            setEditOpenTime(data.shop.openTime ? data.shop.openTime.slice(0, 5) : '09:00');
            setEditCloseTime(data.shop.closeTime ? data.shop.closeTime.slice(0, 5) : '18:00');
            setEditClosingSoon(Boolean(data.shop.closingSoon));
            setEditClosingMessage(data.shop.closingMessage || '');
            setEditPhotoUrl(data.shop.photos?.[0] || '');

            if (data.readiness) {
                setReadiness(data.readiness);
            }

            if (data.customerPreview) {
                setCustomerPreview(data.customerPreview);
            }
        } catch (err: any) {
            console.error('Failed to load workspace:', err);
            setAuthError(err.message || 'Error loading shop workspace');
        } finally {
            setLoading(false);
        }
    }, [vendorId, shopId]);

    useEffect(() => {
        fetchWorkspace();
    }, [fetchWorkspace]);

    // Handle profile update
    const handleSaveProfile = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        setSaveFeedback(null);

        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) throw new Error('Not authenticated');

            const res = await fetch(`/api/admin/vendors/${vendorId}/shops/${shopId}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${session.access_token}`,
                },
                body: JSON.stringify({
                    name: editName,
                    address: editAddress,
                    contactPhone: editContactPhone,
                    status: editTradingStatus,
                    publishStatus: editPublishStatus,
                    forcePublish,
                    open_time: editOpenTime ? `${editOpenTime}:00` : null,
                    close_time: editCloseTime ? `${editCloseTime}:00` : null,
                    closing_soon: editClosingSoon,
                    closing_message: editClosingMessage,
                    photos: editPhotoUrl ? [editPhotoUrl] : [],
                }),
            });

            const data = await res.json();
            if (data.readiness) setReadiness(data.readiness);
            if (!res.ok) throw new Error(data.error || 'Failed to save shop profile');

            setShop(data.shop);
            setSaveFeedback({ type: 'success', message: 'Shop profile successfully saved!' });
            setTimeout(() => setSaveFeedback(null), 4000);
        } catch (err: any) {
            setSaveFeedback({ type: 'error', message: err.message || 'Failed to save shop changes' });
        } finally {
            setSaving(false);
        }
    };

    // Rate Matrix Handlers
    const handleMatrixPriceChange = (paper: string, mode: string, side: string, price: number) => {
        setMatrixRows(prev => prev.map(row => {
            if (row.paper_size === paper && row.print_mode === mode && row.sides === side) {
                return { ...row, price_per_sheet: price };
            }
            return row;
        }));
    };

    const handleMatrixActiveToggle = (paper: string, mode: string, side: string) => {
        setMatrixRows(prev => prev.map(row => {
            if (row.paper_size === paper && row.print_mode === mode && row.sides === side) {
                return { ...row, active: !row.active };
            }
            return row;
        }));
    };

    const handleUseSamePrice = (paper: string, mode: string) => {
        const longRow = matrixRows.find(r => r.paper_size === paper && r.print_mode === mode && r.sides === 'DOUBLE_LONG_EDGE');
        if (!longRow) return;
        const targetPrice = longRow.price_per_sheet;
        setMatrixRows(prev => prev.map(row => {
            if (row.paper_size === paper && row.print_mode === mode && row.sides === 'DOUBLE_SHORT_EDGE') {
                return { ...row, price_per_sheet: targetPrice, active: longRow.active };
            }
            return row;
        }));
        setMatrixFeedback({ type: 'success', message: `Copied ${paper} ${mode} Long Edge price (₹${targetPrice}) to Short Edge!` });
        setTimeout(() => setMatrixFeedback(null), 3000);
    };

    const handleSavePricing = async () => {
        setSavingMatrix(true);
        setMatrixFeedback(null);
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) throw new Error('Not authenticated');

            const res = await fetch(`/api/admin/vendors/${vendorId}/shops/${shopId}/pricing`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${session.access_token}`,
                },
                body: JSON.stringify({ rates: matrixRows }),
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to save rate matrix');

            setPricing(data.rates || []);
            setMatrixFeedback({ type: 'success', message: `Successfully saved ${data.updatedCount} rate matrix rules!` });
            setTimeout(() => setMatrixFeedback(null), 4000);
        } catch (err: any) {
            setMatrixFeedback({ type: 'error', message: err.message || 'Failed to save rate matrix' });
        } finally {
            setSavingMatrix(false);
        }
    };
    // Image Handlers
    const handleShopPhotoFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            setCropImageSrc(reader.result as string);
            setCropFileInfo({ name: file.name, sizeKb: Math.round(file.size / 1024) });
            setCropModalOpen(true);
        };
        reader.readAsDataURL(file);
        e.target.value = '';
    };

    const handleCustomImageFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            setCustomImageUrl(reader.result as string);
        };
        reader.readAsDataURL(file);
        e.target.value = '';
    };

    const handleEditAddonImageFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            setEditAddonImageUrl(reader.result as string);
        };
        reader.readAsDataURL(file);
        e.target.value = '';
    };

    const handleAssignAddon = async (e: React.FormEvent) => {
        e.preventDefault();
        setAssigningAddon(true);
        setAddonFeedback(null);
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) throw new Error('Not authenticated');

            const payload = addServiceMode === 'custom'
                ? {
                    name: customName,
                    description: customDescription,
                    imageUrl: customImageUrl.trim() || undefined,
                    price: Number(customPrice) || 0,
                    estimatedMinutes: Number(customPrepTime) || 0,
                    minPages: Number(customMinPages) || 1,
                    maxPages: Number(customMaxPages) || 100,
                    isAvailable: true,
                }
                : {
                    addonId: assignAddonId,
                    price: Number(assignPrice) || 0,
                    isAvailable: true,
                };

            if (addServiceMode === 'custom' && !customName.trim()) {
                throw new Error('Service name is required.');
            }
            if (addServiceMode === 'catalogue' && !assignAddonId) {
                throw new Error('Please choose an add-on service.');
            }

            const res = await fetch(`/api/admin/vendors/${vendorId}/shops/${shopId}/addons`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${session.access_token}`,
                },
                body: JSON.stringify(payload),
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to add service');

            setAddons(prev => [...prev, data.assignment]);
            if (assignAddonId) {
                setAvailableCatalogue(prev => prev.filter(c => c.id !== assignAddonId));
            }
            setAssignAddonId('');
            setCustomName('');
            setCustomDescription('');
            setCustomImageUrl('');
            setCustomPrice('20');
            setCustomPrepTime('5');
            setCustomMinPages('1');
            setCustomMaxPages('100');
            setAssignModalOpen(false);
            setAddonFeedback({ type: 'success', message: 'Service successfully added to shop!' });
            setTimeout(() => setAddonFeedback(null), 4000);
        } catch (err: any) {
            setAddonFeedback({ type: 'error', message: err.message || 'Failed to add service' });
        } finally {
            setAssigningAddon(false);
        }
    };

    const handleStartEditAddon = (addonItem: any) => {
        setEditingAddon(addonItem);
        setEditAddonName(addonItem.name || addonItem.addons?.name || '');
        setEditAddonDescription(addonItem.description || addonItem.addons?.description || '');
        setEditAddonImageUrl(addonItem.image_url || addonItem.imageUrl || addonItem.addons?.image_url || '');
        setEditAddonPrice(String(addonItem.price || '0'));
        setEditAddonPrepTime(String(addonItem.estimated_minutes ?? addonItem.addons?.estimated_minutes ?? 0));
        setEditAddonMinPages(String(addonItem.min_pages ?? addonItem.addons?.min_pages ?? 1));
        setEditAddonMaxPages(String(addonItem.max_pages ?? addonItem.addons?.max_pages ?? 100));
        setEditAddonAvailable(addonItem.is_available !== undefined ? addonItem.is_available : (addonItem.available !== undefined ? addonItem.available : true));
    };

    const handleSaveEditAddon = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!editingAddon) return;
        setSavingAddon(true);
        setAddonFeedback(null);
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) throw new Error('Not authenticated');

            const res = await fetch(`/api/admin/vendors/${vendorId}/shops/${shopId}/addons/${editingAddon.id}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${session.access_token}`,
                },
                body: JSON.stringify({
                    name: editAddonName,
                    description: editAddonDescription,
                    imageUrl: editAddonImageUrl.trim() || undefined,
                    price: Number(editAddonPrice) || 0,
                    estimatedMinutes: Number(editAddonPrepTime) || 0,
                    minPages: Number(editAddonMinPages) || 1,
                    maxPages: Number(editAddonMaxPages) || 100,
                    isAvailable: editAddonAvailable,
                }),
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to update service');

            setAddons(prev => prev.map(a => a.id === editingAddon.id ? data.assignment : a));
            setEditingAddon(null);
            setAddonFeedback({ type: 'success', message: 'Service successfully updated!' });
            setTimeout(() => setAddonFeedback(null), 4000);
        } catch (err: any) {
            setAddonFeedback({ type: 'error', message: err.message || 'Failed to update service' });
        } finally {
            setSavingAddon(false);
        }
    };

    const handleToggleAddonAvailability = async (shopAddonId: string, currentAvailable: boolean) => {
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) throw new Error('Not authenticated');

            const res = await fetch(`/api/admin/vendors/${vendorId}/shops/${shopId}/addons/${shopAddonId}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${session.access_token}`,
                },
                body: JSON.stringify({ isAvailable: !currentAvailable }),
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to update availability');

            setAddons(prev => prev.map(a => a.id === shopAddonId ? { ...a, is_available: !currentAvailable, available: !currentAvailable } : a));
        } catch (err: any) {
            setAddonFeedback({ type: 'error', message: err.message || 'Failed to toggle availability' });
            setTimeout(() => setAddonFeedback(null), 4000);
        }
    };

    const handleDeleteAddon = async (shopAddonId: string) => {
        if (!confirm('Are you sure you want to remove this add-on from this shop?')) return;
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) throw new Error('Not authenticated');

            const res = await fetch(`/api/admin/vendors/${vendorId}/shops/${shopId}/addons/${shopAddonId}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${session.access_token}` },
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to remove add-on');

            const removed = addons.find(a => a.id === shopAddonId);
            setAddons(prev => prev.filter(a => a.id !== shopAddonId));
            if (removed && removed.addons) {
                setAvailableCatalogue(prev => [...prev, removed.addons]);
            }
            setAddonFeedback({ type: 'success', message: 'Add-on successfully removed from this shop.' });
            setTimeout(() => setAddonFeedback(null), 4000);
        } catch (err: any) {
            setAddonFeedback({ type: 'error', message: err.message || 'Failed to remove add-on' });
            setTimeout(() => setAddonFeedback(null), 4000);
        }
    };

    // Handle Create Commission Rule
    const handleCreateRule = async (e: React.FormEvent) => {
        e.preventDefault();
        setCreatingRule(true);
        setRuleFeedback(null);

        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) throw new Error('Not authenticated');

            const res = await fetch('/api/admin/finance/commission-rules', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${session.access_token}`,
                },
                body: JSON.stringify({
                    shop_id: shopId,
                    commission_percentage: Number(newRuleRate),
                    effective_from: newRuleEffectiveFrom ? new Date(newRuleEffectiveFrom).toISOString() : new Date().toISOString(),
                    effective_to: newRuleEffectiveTo ? new Date(newRuleEffectiveTo).toISOString() : null,
                    close_previous: newRuleClosePrevious,
                }),
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to create commission rule');

            setRuleFeedback({ type: 'success', message: data.message || 'Commission rule successfully published!' });
            setTimeout(() => setRuleFeedback(null), 5000);
            fetchWorkspace();
        } catch (err: any) {
            setRuleFeedback({ type: 'error', message: err.message || 'Failed to create commission rule' });
        } finally {
            setCreatingRule(false);
        }
    };

    // Handle Dry Run Evaluation
    const handleRunDryRun = async () => {
        if (!activeRule) {
            setDryRunError('No active commission rule configured for this shop to evaluate.');
            return;
        }

        setDryRunLoading(true);
        setDryRunError(null);
        setDryRunResult(null);

        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) throw new Error('Not authenticated');

            const res = await fetch(`/api/admin/finance/commission-rules/${activeRule.id}/dry-run`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${session.access_token}` },
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Dry run evaluation failed');

            setDryRunResult(data);
        } catch (err: any) {
            setDryRunError(err.message || 'Error running dry run evaluation');
        } finally {
            setDryRunLoading(false);
        }
    };

    if (loading) {
        return (
            <div style={{ minHeight: '60vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px' }}>
                <span className="spinner spinner-lg" />
                <p style={{ color: 'var(--fg-muted)', fontSize: '14px' }}>Loading dedicated shop workspace…</p>
            </div>
        );
    }

    if (!authorized) {
        return (
            <div className="container" style={{ maxWidth: '540px', margin: '80px auto', textAlign: 'center', padding: '32px' }}>
                <div style={{ width: '56px', height: '56px', borderRadius: '16px', background: 'rgba(239, 68, 68, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', color: 'var(--error)' }}>
                    <Shield size={28} />
                </div>
                <h2 style={{ fontSize: '20px', fontWeight: '900', color: 'var(--fg)', marginBottom: '8px' }}>
                    Administrator Access Required
                </h2>
                <p style={{ color: 'var(--fg-muted)', fontSize: '13.5px', marginBottom: '24px', lineHeight: '1.5' }}>
                    {authError || 'You must be signed in with an administrator account to access this shop workspace.'}
                </p>
                <Link
                    href={`/xad/login?redirect=/admin/vendors/${vendorId}/shops/${shopId}`}
                    className="btn"
                    style={{ background: 'var(--accent)', color: '#092b31', fontWeight: '800', textDecoration: 'none', padding: '10px 24px' }}
                >
                    Sign In as Administrator →
                </Link>
            </div>
        );
    }

    if (!shop || !owner) {
        return (
            <div className="container" style={{ maxWidth: '600px', margin: '80px auto', textAlign: 'center', padding: '32px' }}>
                <div style={{ width: '56px', height: '56px', borderRadius: '16px', background: 'var(--bg-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', color: 'var(--fg-muted)' }}>
                    <AlertCircle size={28} />
                </div>
                <h2 style={{ fontSize: '20px', fontWeight: '900', color: 'var(--fg)', marginBottom: '8px' }}>
                    Shop Not Found
                </h2>
                <p style={{ color: 'var(--fg-muted)', fontSize: '13.5px', marginBottom: '24px', lineHeight: '1.5' }}>
                    The print shop could not be found or does not belong to this vendor.
                </p>
                <Link
                    href="/admin/vendors"
                    className="btn btn-outline"
                    style={{ fontWeight: '700', textDecoration: 'none', padding: '10px 20px' }}
                >
                    ← Back to Vendors
                </Link>
            </div>
        );
    }

    const tradingBadge = {
        OPEN: { label: 'Open for Trading', bg: 'rgba(34, 197, 94, 0.12)', color: '#22c55e' },
        PAUSED: { label: 'Trading Paused', bg: 'rgba(245, 158, 11, 0.12)', color: '#f59e0b' },
        CLOSED: { label: 'Trading Closed', bg: 'rgba(239, 68, 68, 0.12)', color: 'var(--error)' },
    }[shop.shopStatus] || { label: 'Closed', bg: 'rgba(239, 68, 68, 0.12)', color: 'var(--error)' };

    const publishBadge = {
        PUBLISHED: { label: 'Published (Discoverable)', bg: 'rgba(0, 240, 255, 0.12)', color: 'var(--accent)' },
        DRAFT: { label: 'Draft (Admin Only)', bg: 'rgba(168, 85, 247, 0.12)', color: '#c084fc' },
        ARCHIVED: { label: 'Archived', bg: 'rgba(255, 255, 255, 0.08)', color: 'var(--fg-muted)' },
    }[shop.publishStatus] || { label: 'Draft', bg: 'rgba(168, 85, 247, 0.12)', color: '#c084fc' };

    return (
        <div className="container" style={{ maxWidth: '1400px', margin: '0 auto', padding: '24px 16px 64px' }}>
            {/* Top Breadcrumbs */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
                <Link
                    href="/admin/vendors"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: '700', color: 'var(--fg-muted)', textDecoration: 'none' }}
                >
                    <ArrowLeft size={16} /> Back to Vendors
                </Link>

                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                    <button
                        onClick={() => {
                            setSimulatedStatus(null);
                            setPreviewModalOpen(true);
                        }}
                        className="btn btn-outline btn-sm"
                        style={{ fontSize: '12px', display: 'inline-flex', alignItems: 'center', gap: '6px', color: 'var(--accent)', borderColor: 'var(--accent)', cursor: 'pointer' }}
                    >
                        <Eye size={13} /> Preview Customer View
                    </button>

                    <Link
                        href={`/admin/people?search=${encodeURIComponent(owner.phone || owner.email || owner.fullName || '')}`}
                        className="btn btn-outline btn-sm"
                        style={{ fontSize: '12px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                    >
                        <ExternalLink size={13} /> Manage Owner in People
                    </Link>
                </div>
            </div>

            {/* Selected Shop Hero Banner */}
            <div style={{
                background: 'var(--bg-card)',
                borderRadius: '16px',
                border: '1px solid var(--border)',
                padding: '24px',
                marginBottom: '28px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '16px',
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <div style={{
                        width: '60px',
                        height: '60px',
                        borderRadius: '16px',
                        background: 'rgba(0, 240, 255, 0.1)',
                        border: '2px solid rgba(0, 240, 255, 0.25)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '24px',
                        fontWeight: '900',
                        color: 'var(--accent)',
                        flexShrink: 0,
                    }}>
                        <Store size={30} />
                    </div>
                    <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                            <h1 style={{ fontSize: '22px', fontWeight: '900', margin: 0, color: 'var(--fg)' }}>
                                {shop.name}
                            </h1>
                            <span style={{
                                fontSize: '11px',
                                fontWeight: '800',
                                padding: '3px 9px',
                                borderRadius: '8px',
                                background: tradingBadge.bg,
                                color: tradingBadge.color,
                            }}>
                                {tradingBadge.label}
                            </span>
                            <span style={{
                                fontSize: '11px',
                                fontWeight: '800',
                                padding: '3px 9px',
                                borderRadius: '8px',
                                background: publishBadge.bg,
                                color: publishBadge.color,
                            }}>
                                {publishBadge.label}
                            </span>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '6px', fontSize: '12.5px', color: 'var(--fg-muted)', flexWrap: 'wrap' }}>
                            <span>👤 Owner: <strong>{owner.fullName || 'Vendor'}</strong> ({owner.email || owner.phone})</span>
                            {shop.address && (
                                <>
                                    <span>•</span>
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                        <MapPin size={12} /> {shop.address}
                                    </span>
                                </>
                            )}
                        </div>
                    </div>
                </div>

                {/* Quick Trading Status Toggle Button */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <button
                        onClick={() => {
                            const next = shop.shopStatus === 'OPEN' ? 'CLOSED' : 'OPEN';
                            setEditTradingStatus(next);
                            setActiveTab('profile');
                        }}
                        className="btn btn-outline btn-sm"
                        style={{
                            fontSize: '12px',
                            fontWeight: '700',
                            borderColor: shop.shopStatus === 'OPEN' ? 'var(--error)' : '#22c55e',
                            color: shop.shopStatus === 'OPEN' ? 'var(--error)' : '#22c55e',
                        }}
                    >
                        {shop.shopStatus === 'OPEN' ? 'Pause / Close Trading' : 'Open for Trading'}
                    </button>
                </div>
            </div>

            {/* Setup Readiness Checklist Card (Priority 1) */}
            {readiness && (
                <div style={{
                    background: 'var(--bg-card)',
                    borderRadius: '16px',
                    border: readiness.isReadyToPublish ? '1px solid rgba(34, 197, 94, 0.35)' : '1px solid rgba(245, 158, 11, 0.35)',
                    padding: '20px 24px',
                    marginBottom: '24px',
                    boxShadow: '0 2px 10px rgba(0, 0, 0, 0.04)',
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                            <div style={{
                                width: '46px',
                                height: '46px',
                                borderRadius: '12px',
                                background: readiness.isReadyToPublish ? 'rgba(34, 197, 94, 0.12)' : 'rgba(245, 158, 11, 0.12)',
                                border: readiness.isReadyToPublish ? '1px solid rgba(34, 197, 94, 0.3)' : '1px solid rgba(245, 158, 11, 0.3)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: readiness.isReadyToPublish ? '#22c55e' : '#f59e0b',
                                flexShrink: 0,
                            }}>
                                {readiness.isReadyToPublish ? <CheckCircle2 size={24} /> : <AlertCircle size={24} />}
                            </div>
                            <div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                                    <h3 style={{ fontSize: '16px', fontWeight: '900', margin: 0, color: 'var(--fg)' }}>
                                        Setup Readiness Checklist
                                    </h3>
                                    <span style={{
                                        fontSize: '11px',
                                        fontWeight: '800',
                                        padding: '2px 8px',
                                        borderRadius: '6px',
                                        background: readiness.isReadyToPublish ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                                        color: readiness.isReadyToPublish ? '#22c55e' : 'var(--error)',
                                    }}>
                                        {readiness.isReadyToPublish ? 'Ready to Publish & Serve' : `${readiness.blockersCount} Launch Blocker${readiness.blockersCount > 1 ? 's' : ''}`}
                                    </span>
                                </div>
                                <p style={{ fontSize: '12px', color: 'var(--fg-muted)', margin: '4px 0 0' }}>
                                    {readiness.completedCount} of {readiness.totalChecks} operational prerequisites satisfied ({readiness.scorePercent}%). {readiness.summaryMessage}
                                </p>
                            </div>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <div style={{ width: '120px', height: '8px', borderRadius: '4px', background: 'var(--bg-muted)', overflow: 'hidden' }}>
                                <div style={{
                                    width: `${readiness.scorePercent}%`,
                                    height: '100%',
                                    borderRadius: '4px',
                                    background: readiness.isReadyToPublish ? '#22c55e' : (readiness.scorePercent >= 50 ? '#f59e0b' : 'var(--error)'),
                                    transition: 'width 0.3s ease',
                                }} />
                            </div>
                            <span style={{ fontSize: '13px', fontWeight: '800', color: 'var(--fg)', minWidth: '38px' }}>
                                {readiness.scorePercent}%
                            </span>
                            <button
                                onClick={() => {
                                    setSimulatedStatus(null);
                                    setPreviewModalOpen(true);
                                }}
                                className="btn btn-outline btn-sm"
                                style={{ fontSize: '11.5px', padding: '4px 10px', display: 'inline-flex', alignItems: 'center', gap: '4px', color: 'var(--accent)', borderColor: 'var(--accent)', cursor: 'pointer' }}
                            >
                                <Eye size={13} /> Customer Preview
                            </button>
                            <button
                                onClick={() => setReadinessExpanded(!readinessExpanded)}
                                className="btn btn-outline btn-sm"
                                style={{ fontSize: '11.5px', padding: '4px 10px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                            >
                                {readinessExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                {readinessExpanded ? 'Collapse' : 'Inspect'}
                            </button>
                        </div>
                    </div>

                    {readinessExpanded && (
                        <div style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))',
                            gap: '12px',
                            marginTop: '18px',
                            paddingTop: '16px',
                            borderTop: '1px solid var(--border)',
                        }}>
                            {readiness.items.map(item => {
                                const isComplete = item.status === 'COMPLETE';
                                return (
                                    <div
                                        key={item.id}
                                        style={{
                                            padding: '12px 14px',
                                            borderRadius: '12px',
                                            background: isComplete ? 'rgba(34, 197, 94, 0.04)' : 'rgba(239, 68, 68, 0.04)',
                                            border: isComplete ? '1px solid rgba(34, 197, 94, 0.2)' : '1px solid rgba(239, 68, 68, 0.2)',
                                            display: 'flex',
                                            flexDirection: 'column',
                                            justifyContent: 'space-between',
                                            gap: '10px',
                                        }}
                                    >
                                        <div>
                                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '4px' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                    {isComplete ? (
                                                        <CheckCircle2 size={16} color="#22c55e" />
                                                    ) : (
                                                        <AlertCircle size={16} color="var(--error)" />
                                                    )}
                                                    <span style={{ fontSize: '13px', fontWeight: '800', color: 'var(--fg)' }}>
                                                        {item.title}
                                                    </span>
                                                </div>
                                                <span style={{
                                                    fontSize: '10px',
                                                    fontWeight: '800',
                                                    padding: '2px 6px',
                                                    borderRadius: '4px',
                                                    background: isComplete ? 'rgba(34, 197, 94, 0.12)' : 'rgba(239, 68, 68, 0.12)',
                                                    color: isComplete ? '#22c55e' : 'var(--error)',
                                                    textTransform: 'uppercase',
                                                }}>
                                                    {isComplete ? 'Passed' : 'Missing'}
                                                </span>
                                            </div>
                                            <p style={{ fontSize: '11.5px', color: 'var(--fg-muted)', margin: '0 0 6px', lineHeight: '1.4' }}>
                                                {item.details || item.description}
                                            </p>
                                        </div>

                                        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                            <button
                                                onClick={() => setActiveTab(item.actionTab)}
                                                className="btn btn-outline btn-sm"
                                                style={{
                                                    fontSize: '11px',
                                                    fontWeight: '700',
                                                    padding: '4px 8px',
                                                    borderColor: isComplete ? 'var(--border)' : 'var(--accent)',
                                                    color: isComplete ? 'var(--fg-muted)' : 'var(--accent)',
                                                }}
                                            >
                                                {item.actionLabel}
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}

            {/* Workspace Layout: Local Navigation Sidebar + Main Tab Content */}
            <div className="shop-workspace-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(200px, 240px) 1fr', gap: '24px', alignItems: 'start' }}>
                {/* Local Menu (Section 5.4) */}
                <div className="card shop-workspace-tabs" style={{
                    padding: '12px',
                    borderRadius: '16px',
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                }}>
                    <button
                        onClick={() => setActiveTab('dashboard')}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '10px',
                            padding: '10px 14px',
                            borderRadius: '10px',
                            border: 'none',
                            cursor: 'pointer',
                            fontSize: '13px',
                            fontWeight: activeTab === 'dashboard' ? '800' : '600',
                            background: activeTab === 'dashboard' ? 'var(--accent-muted)' : 'transparent',
                            color: activeTab === 'dashboard' ? 'var(--accent)' : 'var(--fg-muted)',
                            textAlign: 'left',
                            transition: 'all 0.15s',
                        }}
                    >
                        <LayoutDashboard size={16} /> Dashboard
                    </button>

                    <button
                        onClick={() => setActiveTab('profile')}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '10px',
                            padding: '10px 14px',
                            borderRadius: '10px',
                            border: 'none',
                            cursor: 'pointer',
                            fontSize: '13px',
                            fontWeight: activeTab === 'profile' ? '800' : '600',
                            background: activeTab === 'profile' ? 'var(--accent-muted)' : 'transparent',
                            color: activeTab === 'profile' ? 'var(--accent)' : 'var(--fg-muted)',
                            textAlign: 'left',
                            transition: 'all 0.15s',
                        }}
                    >
                        <FileText size={16} /> Shop Profile
                    </button>

                    <button
                        onClick={() => setActiveTab('pricing')}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '10px',
                            padding: '10px 14px',
                            borderRadius: '10px',
                            border: 'none',
                            cursor: 'pointer',
                            fontSize: '13px',
                            fontWeight: activeTab === 'pricing' ? '800' : '600',
                            background: activeTab === 'pricing' ? 'var(--accent-muted)' : 'transparent',
                            color: activeTab === 'pricing' ? 'var(--accent)' : 'var(--fg-muted)',
                            textAlign: 'left',
                            transition: 'all 0.15s',
                        }}
                    >
                        <Printer size={16} /> Printing & Prices
                    </button>

                    <button
                        onClick={() => setActiveTab('addons')}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '10px',
                            padding: '10px 14px',
                            borderRadius: '10px',
                            border: 'none',
                            cursor: 'pointer',
                            fontSize: '13px',
                            fontWeight: activeTab === 'addons' ? '800' : '600',
                            background: activeTab === 'addons' ? 'var(--accent-muted)' : 'transparent',
                            color: activeTab === 'addons' ? 'var(--accent)' : 'var(--fg-muted)',
                            textAlign: 'left',
                            transition: 'all 0.15s',
                        }}
                    >
                        <Sparkles size={16} /> Add-ons
                    </button>

                    <button
                        onClick={() => setActiveTab('commission')}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '10px',
                            padding: '10px 14px',
                            borderRadius: '10px',
                            border: 'none',
                            cursor: 'pointer',
                            fontSize: '13px',
                            fontWeight: activeTab === 'commission' ? '800' : '600',
                            background: activeTab === 'commission' ? 'var(--accent-muted)' : 'transparent',
                            color: activeTab === 'commission' ? 'var(--accent)' : 'var(--fg-muted)',
                            textAlign: 'left',
                            transition: 'all 0.15s',
                        }}
                    >
                        <Percent size={16} /> Commission
                    </button>
                </div>

                {/* Tab Content Panel */}
                <div style={{ width: '100%' }}>
                    {/* Feedback Alert Banner */}
                    {saveFeedback && (
                        <div style={{
                            padding: '12px 16px',
                            borderRadius: '12px',
                            background: saveFeedback.type === 'success' ? 'rgba(34, 197, 94, 0.12)' : 'rgba(239, 68, 68, 0.12)',
                            color: saveFeedback.type === 'success' ? '#22c55e' : 'var(--error)',
                            border: `1px solid ${saveFeedback.type === 'success' ? '#22c55e' : 'var(--error)'}`,
                            fontSize: '13px',
                            fontWeight: '700',
                            marginBottom: '16px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                        }}>
                            {saveFeedback.type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
                            {saveFeedback.message}
                        </div>
                    )}

                    {/* TAB 1: DASHBOARD */}
                    {activeTab === 'dashboard' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                            {/* Financial Summary KPIs */}
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
                                <div className="card" style={{ padding: '18px', borderRadius: '14px', background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                                    <div style={{ fontSize: '11px', fontWeight: '700', color: 'var(--fg-muted)', textTransform: 'uppercase' }}>
                                        Total Orders
                                    </div>
                                    <div style={{ fontSize: '24px', fontWeight: '900', color: 'var(--fg)', marginTop: '6px' }}>
                                        {summary?.totalOrdersCount ?? 0}
                                    </div>
                                </div>

                                <div className="card" style={{ padding: '18px', borderRadius: '14px', background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                                    <div style={{ fontSize: '11px', fontWeight: '700', color: 'var(--fg-muted)', textTransform: 'uppercase' }}>
                                        Gross Sales
                                    </div>
                                    <div style={{ fontSize: '24px', fontWeight: '900', color: 'var(--fg)', marginTop: '6px' }}>
                                        ₹{(summary?.grossSales ?? 0).toFixed(2)}
                                    </div>
                                </div>

                                <div className="card" style={{ padding: '18px', borderRadius: '14px', background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                                    <div style={{ fontSize: '11px', fontWeight: '700', color: 'var(--fg-muted)', textTransform: 'uppercase' }}>
                                        Shop Earnings
                                    </div>
                                    <div style={{ fontSize: '24px', fontWeight: '900', color: '#22c55e', marginTop: '6px' }}>
                                        ₹{(summary?.vendorEarnings ?? 0).toFixed(2)}
                                    </div>
                                </div>

                                <div className="card" style={{ padding: '18px', borderRadius: '14px', background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                                    <div style={{ fontSize: '11px', fontWeight: '700', color: 'var(--fg-muted)', textTransform: 'uppercase' }}>
                                        Ready to Pay
                                    </div>
                                    <div style={{ fontSize: '24px', fontWeight: '900', color: '#eab308', marginTop: '6px' }}>
                                        ₹{(summary?.payableAmount ?? 0).toFixed(2)}
                                    </div>
                                </div>
                            </div>

                            {/* Recent Orders List */}
                            <div className="card" style={{ padding: '20px', borderRadius: '16px', background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                                <h3 style={{ fontSize: '15px', fontWeight: '800', margin: '0 0 16px', color: 'var(--fg)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <ShoppingBag size={16} style={{ color: 'var(--accent)' }} /> Recent Orders for this Shop
                                </h3>

                                {recentOrders.length === 0 ? (
                                    <div style={{ padding: '36px 16px', textAlign: 'center', color: 'var(--fg-muted)', fontSize: '13px' }}>
                                        No customer orders have been placed with this shop yet.
                                    </div>
                                ) : (
                                    <div style={{ overflowX: 'auto' }}>
                                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                                            <thead>
                                                <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left', color: 'var(--fg-muted)', fontSize: '11.5px', textTransform: 'uppercase' }}>
                                                    <th style={{ padding: '10px 12px' }}>Order #</th>
                                                    <th style={{ padding: '10px 12px' }}>Date</th>
                                                    <th style={{ padding: '10px 12px' }}>Status</th>
                                                    <th style={{ padding: '10px 12px' }}>Payment</th>
                                                    <th style={{ padding: '10px 12px', textAlign: 'right' }}>Amount</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {recentOrders.map(o => (
                                                    <tr key={o.id} style={{ borderBottom: '1px solid var(--border)' }}>
                                                        <td style={{ padding: '12px', fontWeight: '700', fontFamily: 'monospace' }}>{o.order_number}</td>
                                                        <td style={{ padding: '12px', color: 'var(--fg-muted)', fontSize: '12px' }}>
                                                            {new Date(o.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                                                        </td>
                                                        <td style={{ padding: '12px' }}>
                                                            <span style={{ fontSize: '11px', fontWeight: '700', padding: '2px 7px', borderRadius: '6px', background: o.status === 'COMPLETED' ? 'rgba(34, 197, 94, 0.12)' : 'rgba(245, 158, 11, 0.12)', color: o.status === 'COMPLETED' ? '#22c55e' : '#f59e0b' }}>
                                                                {o.status}
                                                            </span>
                                                        </td>
                                                        <td style={{ padding: '12px' }}>
                                                            <span style={{ fontSize: '11px', fontWeight: '700', padding: '2px 7px', borderRadius: '6px', background: o.payment_status === 'COMPLETED' ? 'rgba(34, 197, 94, 0.12)' : 'rgba(245, 158, 11, 0.12)', color: o.payment_status === 'COMPLETED' ? '#22c55e' : '#f59e0b' }}>
                                                                {o.payment_status}
                                                            </span>
                                                        </td>
                                                        <td style={{ padding: '12px', textAlign: 'right', fontWeight: '800' }}>₹{Number(o.total_amount).toFixed(2)}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* TAB 2: SHOP PROFILE EDIT */}
                    {activeTab === 'profile' && (
                        <div className="card" style={{ padding: '24px', borderRadius: '16px', background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                                <div>
                                    <h3 style={{ fontSize: '17px', fontWeight: '800', margin: 0, color: 'var(--fg)' }}>
                                        Shop Profile & Visibility
                                    </h3>
                                    <p style={{ fontSize: '12.5px', color: 'var(--fg-muted)', margin: '4px 0 0' }}>
                                        Configure shop identity, hours, trading availability, and customer publish state.
                                    </p>
                                </div>
                            </div>

                            <form onSubmit={handleSaveProfile} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                                    <div>
                                        <label style={{ fontSize: '12px', fontWeight: '700', color: 'var(--fg-muted)', display: 'block', marginBottom: '6px' }}>
                                            Shop Name *
                                        </label>
                                        <input
                                            type="text"
                                            value={editName}
                                            onChange={e => setEditName(e.target.value)}
                                            required
                                            className="input"
                                            style={{ width: '100%', fontSize: '13px' }}
                                        />
                                    </div>

                                    <div>
                                        <label style={{ fontSize: '12px', fontWeight: '700', color: 'var(--fg-muted)', display: 'block', marginBottom: '6px' }}>
                                            Contact Phone
                                        </label>
                                        <input
                                            type="text"
                                            value={editContactPhone}
                                            onChange={e => setEditContactPhone(e.target.value)}
                                            placeholder="+919876543210"
                                            className="input"
                                            style={{ width: '100%', fontSize: '13px' }}
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label style={{ fontSize: '12px', fontWeight: '700', color: 'var(--fg-muted)', display: 'block', marginBottom: '6px' }}>
                                        Location Address & Campus Description
                                    </label>
                                    <textarea
                                        value={editAddress}
                                        onChange={e => setEditAddress(e.target.value)}
                                        rows={3}
                                        placeholder="e.g. Near Student Centre, West Wing Ground Floor…"
                                        className="input"
                                        style={{ width: '100%', fontSize: '13px', resize: 'vertical' }}
                                    />
                                </div>

                                {/* Status Settings: Separate Trading Status and Publish State */}
                                <div style={{
                                    display: 'grid',
                                    gridTemplateColumns: '1fr 1fr',
                                    gap: '16px',
                                    padding: '16px',
                                    background: 'var(--bg-secondary)',
                                    borderRadius: '12px',
                                    border: '1px solid var(--border)',
                                }}>
                                    <div>
                                        <label style={{ fontSize: '12px', fontWeight: '800', color: 'var(--fg)', display: 'block', marginBottom: '4px' }}>
                                            Trading Status (Daily Operations)
                                        </label>
                                        <p style={{ fontSize: '11.5px', color: 'var(--fg-muted)', margin: '0 0 8px' }}>
                                            Controls if customers can currently check out.
                                        </p>
                                        <select
                                            value={editTradingStatus}
                                            onChange={e => setEditTradingStatus(e.target.value as any)}
                                            className="input"
                                            style={{ width: '100%', fontSize: '13px' }}
                                        >
                                            <option value="OPEN">🟢 OPEN (Accepting Orders)</option>
                                            <option value="PAUSED">🟡 PAUSED (Temporarily Busy)</option>
                                            <option value="CLOSED">🔴 CLOSED (Not Taking Orders)</option>
                                        </select>
                                    </div>

                                    <div>
                                        <label style={{ fontSize: '12px', fontWeight: '800', color: 'var(--fg)', display: 'block', marginBottom: '4px' }}>
                                            Publish Visibility (Customer Discovery)
                                        </label>
                                        <p style={{ fontSize: '11.5px', color: 'var(--fg-muted)', margin: '0 0 8px' }}>
                                            Controls if the shop appears on customer homepage.
                                        </p>
                                        <select
                                            value={editPublishStatus}
                                            onChange={e => setEditPublishStatus(e.target.value as any)}
                                            className="input"
                                            style={{ width: '100%', fontSize: '13px' }}
                                        >
                                            <option value="PUBLISHED">🌐 PUBLISHED (Visible on Homepage)</option>
                                            <option value="DRAFT">🔒 DRAFT (Hidden from Customers)</option>
                                            <option value="ARCHIVED">📦 ARCHIVED (Retired / Inactive)</option>
                                        </select>

                                        {readiness && !readiness.isReadyToPublish && editPublishStatus === 'PUBLISHED' && (
                                            <div style={{
                                                marginTop: '10px',
                                                padding: '12px 14px',
                                                borderRadius: '10px',
                                                background: 'rgba(239, 68, 68, 0.08)',
                                                border: '1px solid rgba(239, 68, 68, 0.3)',
                                                fontSize: '12px',
                                                color: 'var(--fg)',
                                            }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: '800', color: 'var(--error)', marginBottom: '4px' }}>
                                                    <AlertCircle size={15} /> Launch Blocker: {readiness.blockersCount} requirement(s) incomplete
                                                </div>
                                                <p style={{ margin: '0 0 8px', color: 'var(--fg-muted)', fontSize: '11.5px', lineHeight: '1.4' }}>
                                                    {readiness.items.filter(i => i.status === 'MISSING').map(i => i.title).join(', ')}. Publishing in this state may lead to quoting errors for customers.
                                                </p>
                                                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontWeight: '700', fontSize: '11.5px', color: 'var(--fg)' }}>
                                                    <input
                                                        type="checkbox"
                                                        checked={forcePublish}
                                                        onChange={e => setForcePublish(e.target.checked)}
                                                    />
                                                    Admin Override: Force publish anyway (bypass launch blockers)
                                                </label>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Operating Hours */}
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                                    <div>
                                        <label style={{ fontSize: '12px', fontWeight: '700', color: 'var(--fg-muted)', display: 'block', marginBottom: '6px' }}>
                                            Opening Time
                                        </label>
                                        <input
                                            type="time"
                                            value={editOpenTime}
                                            onChange={e => setEditOpenTime(e.target.value)}
                                            className="input"
                                            style={{ width: '100%', fontSize: '13px' }}
                                        />
                                    </div>

                                    <div>
                                        <label style={{ fontSize: '12px', fontWeight: '700', color: 'var(--fg-muted)', display: 'block', marginBottom: '6px' }}>
                                            Closing Time
                                        </label>
                                        <input
                                            type="time"
                                            value={editCloseTime}
                                            onChange={e => setEditCloseTime(e.target.value)}
                                            className="input"
                                            style={{ width: '100%', fontSize: '13px' }}
                                        />
                                    </div>
                                </div>

                                {/* Closing notice */}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: '600' }}>
                                        <input
                                            type="checkbox"
                                            checked={editClosingSoon}
                                            onChange={e => setEditClosingSoon(e.target.checked)}
                                        />
                                        <span>Show "Closing Soon" warning badge on customer card</span>
                                    </label>

                                    <div>
                                        <label style={{ fontSize: '12px', fontWeight: '700', color: 'var(--fg-muted)', display: 'block', marginBottom: '6px' }}>
                                            Custom Status / Closing Message
                                        </label>
                                        <input
                                            type="text"
                                            value={editClosingMessage}
                                            onChange={e => setEditClosingMessage(e.target.value)}
                                            placeholder="e.g. Closed for lunch from 1:00 PM to 2:00 PM…"
                                            className="input"
                                            style={{ width: '100%', fontSize: '13px' }}
                                        />
                                    </div>
                                </div>

                                {/* Shop Photo & 16:9 Storefront Preview */}
                                <div>
                                    <label style={{ fontSize: '12px', fontWeight: '700', color: 'var(--fg-muted)', display: 'block', marginBottom: '8px' }}>
                                        Shop Storefront Photo & Thumbnail (16:9 Optimal)
                                    </label>

                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '16px', alignItems: 'start', background: 'var(--bg-secondary)', padding: '14px', borderRadius: '12px', border: '1px solid var(--border)' }}>
                                        {/* 16:9 Preview Window */}
                                        <div style={{
                                            position: 'relative',
                                            aspectRatio: '16 / 9',
                                            maxHeight: '180px',
                                            borderRadius: '10px',
                                            overflow: 'hidden',
                                            background: '#0c1017',
                                            border: '1px solid var(--border)',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                        }}>
                                            {editPhotoUrl ? (
                                                <>
                                                    <img
                                                        src={editPhotoUrl}
                                                        alt="Storefront Preview"
                                                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                                    />
                                                    <span style={{
                                                        position: 'absolute',
                                                        bottom: 8,
                                                        right: 8,
                                                        background: 'rgba(0, 0, 0, 0.75)',
                                                        color: '#fff',
                                                        fontSize: '10.5px',
                                                        fontWeight: '700',
                                                        padding: '2px 8px',
                                                        borderRadius: '6px',
                                                        backdropFilter: 'blur(4px)',
                                                    }}>
                                                        16:9 Storefront
                                                    </span>
                                                </>
                                            ) : (
                                                <div style={{ textAlign: 'center', color: 'var(--fg-muted)', padding: '16px' }}>
                                                    <ImageIcon size={32} style={{ opacity: 0.4, margin: '0 auto 6px' }} />
                                                    <div style={{ fontSize: '12px', fontWeight: '600' }}>No Photo Configured</div>
                                                    <div style={{ fontSize: '10.5px', opacity: 0.7, marginTop: '2px' }}>Upload a high-resolution 16:9 storefront picture</div>
                                                </div>
                                            )}
                                        </div>

                                        {/* Action buttons & URL */}
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                                <label className="btn btn-outline btn-sm" style={{ cursor: 'pointer', fontSize: '12px', display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '7px 14px', borderRadius: '8px' }}>
                                                    <UploadCloud size={14} /> Upload Picture
                                                    <input
                                                        type="file"
                                                        accept="image/*"
                                                        style={{ display: 'none' }}
                                                        onChange={handleShopPhotoFileChange}
                                                    />
                                                </label>

                                                {editPhotoUrl && (
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            setCropImageSrc(editPhotoUrl);
                                                            setCropFileInfo(null);
                                                            setCropModalOpen(true);
                                                        }}
                                                        className="btn btn-outline btn-sm"
                                                        style={{ fontSize: '12px', display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '7px 14px', borderRadius: '8px' }}
                                                    >
                                                        <Sliders size={14} /> Frame / Crop (16:9)
                                                    </button>
                                                )}

                                                {editPhotoUrl && (
                                                    <button
                                                        type="button"
                                                        onClick={() => setEditPhotoUrl('')}
                                                        className="btn btn-outline btn-sm"
                                                        style={{ fontSize: '12px', color: 'var(--error)', borderColor: 'rgba(239, 68, 68, 0.3)', padding: '7px 12px', borderRadius: '8px' }}
                                                        title="Remove photo"
                                                    >
                                                        <Trash2 size={13} />
                                                    </button>
                                                )}
                                            </div>

                                            <div>
                                                <label style={{ fontSize: '11px', color: 'var(--fg-muted)', display: 'block', marginBottom: '4px' }}>
                                                    Or specify direct Image URL:
                                                </label>
                                                <input
                                                    type="text"
                                                    value={editPhotoUrl}
                                                    onChange={e => setEditPhotoUrl(e.target.value)}
                                                    placeholder="/shops/print-hub.svg or https://…"
                                                    className="input"
                                                    style={{ width: '100%', fontSize: '12.5px' }}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '10px' }}>
                                    <button
                                        type="submit"
                                        disabled={saving}
                                        className="btn"
                                        style={{
                                            background: 'var(--accent)',
                                            color: '#092b31',
                                            fontWeight: '800',
                                            fontSize: '13px',
                                            padding: '10px 22px',
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: '8px',
                                            borderRadius: '10px',
                                        }}
                                    >
                                        <Save size={15} /> {saving ? 'Saving Changes…' : 'Save Profile Changes'}
                                    </button>
                                </div>
                            </form>
                        </div>
                    )}

                    {/* TAB 3: PRINTING & PRICES */}
                    {activeTab === 'pricing' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                            {/* Rate Matrix Card */}
                            <div className="card" style={{ padding: '20px', borderRadius: '16px', background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
                                    <div>
                                        <h3 style={{ fontSize: '16px', fontWeight: '800', margin: 0, color: 'var(--fg)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <Printer size={17} style={{ color: 'var(--accent)' }} /> Shop Print Rate Matrix & Capabilities
                                        </h3>
                                        <p style={{ fontSize: '12px', color: 'var(--fg-muted)', margin: '4px 0 0' }}>
                                            Configure supported paper sizes, color modes, sidedness, and price per physical sheet. Unpriced/disabled combinations cannot be ordered by customers.
                                        </p>
                                    </div>
                                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                        <span style={{ fontSize: '12px', color: 'var(--fg-muted)', background: 'var(--bg-secondary)', padding: '4px 10px', borderRadius: '8px' }}>
                                            {matrixRows.filter(r => r.active && r.price_per_sheet > 0).length} active rate(s)
                                        </span>
                                        <button
                                            type="button"
                                            onClick={handleSavePricing}
                                            disabled={savingMatrix}
                                            className="btn"
                                            style={{
                                                background: 'var(--accent)',
                                                color: '#092b31',
                                                fontWeight: '800',
                                                fontSize: '12.5px',
                                                padding: '8px 18px',
                                                display: 'inline-flex',
                                                alignItems: 'center',
                                                gap: '6px',
                                                borderRadius: '8px',
                                            }}
                                        >
                                            <Save size={14} /> {savingMatrix ? 'Saving Rates…' : 'Save Rate Matrix'}
                                        </button>
                                    </div>
                                </div>

                                {matrixFeedback && (
                                    <div style={{
                                        padding: '10px 14px',
                                        borderRadius: '10px',
                                        marginBottom: '16px',
                                        fontSize: '13px',
                                        fontWeight: '600',
                                        background: matrixFeedback.type === 'success' ? 'rgba(34, 197, 94, 0.12)' : 'rgba(239, 68, 68, 0.12)',
                                        color: matrixFeedback.type === 'success' ? '#22c55e' : 'var(--error)',
                                        border: `1px solid ${matrixFeedback.type === 'success' ? 'rgba(34, 197, 94, 0.25)' : 'rgba(239, 68, 68, 0.25)'}`,
                                    }}>
                                        {matrixFeedback.type === 'success' ? '✓ ' : '✕ '} {matrixFeedback.message}
                                    </div>
                                )}

                                {/* Matrix Table (A4 Unified Single & Double-Sided) */}
                                <div style={{ overflowX: 'auto' }}>
                                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                                        <thead>
                                            <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left', color: 'var(--fg-muted)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                                <th style={{ padding: '10px 12px' }}>Paper Size</th>
                                                <th style={{ padding: '10px 12px' }}>Color Mode</th>
                                                <th style={{ padding: '10px 12px' }}>Sides</th>
                                                <th style={{ padding: '10px 12px', textAlign: 'center' }}>Enabled</th>
                                                <th style={{ padding: '10px 12px', textAlign: 'right' }}>Price / Sheet (₹)</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {matrixRows
                                                .filter(r => r.paper_size === 'A4')
                                                .map(r => {
                                                    const sideLabel = r.sides === 'SINGLE' ? 'Single-sided' : 'Double-sided';
                                                    return (
                                                        <tr key={`${r.paper_size}:${r.print_mode}:${r.sides}`} style={{ borderBottom: '1px solid var(--border)', background: r.active ? 'transparent' : 'rgba(255,255,255,0.01)' }}>
                                                            <td style={{ padding: '12px', fontWeight: '700' }}>
                                                                <span style={{ padding: '3px 10px', borderRadius: '6px', background: 'var(--bg-secondary)', fontSize: '12.5px', fontWeight: '800' }}>
                                                                    {r.paper_size}
                                                                </span>
                                                            </td>
                                                            <td style={{ padding: '12px' }}>
                                                                <span style={{ fontSize: '13px', fontWeight: '700', color: r.print_mode === 'COLOUR' ? '#38bdf8' : 'var(--fg)' }}>
                                                                    {r.print_mode === 'COLOUR' ? 'Colour' : 'Black & White'}
                                                                </span>
                                                            </td>
                                                            <td style={{ padding: '12px', fontSize: '13px', fontWeight: '600' }}>
                                                                {sideLabel}
                                                            </td>
                                                            <td style={{ padding: '12px', textAlign: 'center' }}>
                                                                <input
                                                                    type="checkbox"
                                                                    checked={r.active}
                                                                    onChange={() => handleMatrixActiveToggle(r.paper_size, r.print_mode, r.sides)}
                                                                    style={{ cursor: 'pointer', transform: 'scale(1.15)' }}
                                                                />
                                                            </td>
                                                            <td style={{ padding: '12px', textAlign: 'right' }}>
                                                                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                                                    <span style={{ color: 'var(--fg-muted)', fontSize: '13px', fontWeight: '700' }}>₹</span>
                                                                    <input
                                                                        type="number"
                                                                        step="0.25"
                                                                        min="0"
                                                                        value={r.price_per_sheet}
                                                                        onChange={e => handleMatrixPriceChange(r.paper_size, r.print_mode, r.sides, Math.max(0, parseFloat(e.target.value) || 0))}
                                                                        disabled={!r.active}
                                                                        className="input"
                                                                        style={{
                                                                            width: '90px',
                                                                            textAlign: 'right',
                                                                            fontWeight: '800',
                                                                            fontSize: '13px',
                                                                            padding: '5px 10px',
                                                                            opacity: r.active ? 1 : 0.5,
                                                                        }}
                                                                    />
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* TAB 4: ADD-ONS & FINISHING SERVICES */}
                    {activeTab === 'addons' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                            <div className="card" style={{ padding: '24px', borderRadius: '16px', background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
                                    <div>
                                        <h3 style={{ fontSize: '18px', fontWeight: '800', margin: 0, color: 'var(--fg)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            Shop services
                                        </h3>
                                        <p style={{ fontSize: '12.5px', color: 'var(--fg-muted)', margin: '4px 0 0' }}>
                                            Active Catalog ({addons.length})
                                        </p>
                                    </div>
                                    <div style={{ display: 'flex', gap: '10px' }}>
                                        <button
                                            type="button"
                                            onClick={() => setAssignModalOpen(prev => !prev)}
                                            className="btn btn-sm"
                                            style={{
                                                background: 'var(--accent)',
                                                color: '#092b31',
                                                fontWeight: '800',
                                                fontSize: '13px',
                                                padding: '8px 18px',
                                                display: 'inline-flex',
                                                alignItems: 'center',
                                                gap: '6px',
                                                borderRadius: '10px',
                                            }}
                                        >
                                            <Plus size={15} /> Add service
                                        </button>
                                    </div>
                                </div>

                                {addonFeedback && (
                                    <div style={{
                                        padding: '10px 14px',
                                        borderRadius: '10px',
                                        marginBottom: '16px',
                                        fontSize: '13px',
                                        fontWeight: '600',
                                        background: addonFeedback.type === 'success' ? 'rgba(34, 197, 94, 0.12)' : 'rgba(239, 68, 68, 0.12)',
                                        color: addonFeedback.type === 'success' ? '#22c55e' : 'var(--error)',
                                        border: `1px solid ${addonFeedback.type === 'success' ? 'rgba(34, 197, 94, 0.25)' : 'rgba(239, 68, 68, 0.25)'}`,
                                    }}>
                                        {addonFeedback.type === 'success' ? '✓ ' : '✕ '} {addonFeedback.message}
                                    </div>
                                )}

                                {/* Add Service Panel */}
                                {assignModalOpen && (
                                    <div style={{ padding: '20px', borderRadius: '14px', background: 'var(--bg-secondary)', border: '1px solid var(--border)', marginBottom: '20px' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                                            <div style={{ display: 'flex', gap: '8px' }}>
                                                <button
                                                    type="button"
                                                    onClick={() => setAddServiceMode('custom')}
                                                    style={{
                                                        padding: '6px 14px',
                                                        borderRadius: '8px',
                                                        fontSize: '12.5px',
                                                        fontWeight: '700',
                                                        cursor: 'pointer',
                                                        background: addServiceMode === 'custom' ? 'var(--accent)' : 'transparent',
                                                        color: addServiceMode === 'custom' ? '#092b31' : 'var(--fg-muted)',
                                                        border: `1px solid ${addServiceMode === 'custom' ? 'var(--accent)' : 'var(--border)'}`,
                                                    }}
                                                >
                                                    Create Custom Service
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => setAddServiceMode('catalogue')}
                                                    style={{
                                                        padding: '6px 14px',
                                                        borderRadius: '8px',
                                                        fontSize: '12.5px',
                                                        fontWeight: '700',
                                                        cursor: 'pointer',
                                                        background: addServiceMode === 'catalogue' ? 'var(--accent)' : 'transparent',
                                                        color: addServiceMode === 'catalogue' ? '#092b31' : 'var(--fg-muted)',
                                                        border: `1px solid ${addServiceMode === 'catalogue' ? 'var(--accent)' : 'var(--border)'}`,
                                                    }}
                                                >
                                                    Pick from System Catalogue
                                                </button>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => setAssignModalOpen(false)}
                                                style={{ background: 'none', border: 'none', color: 'var(--fg-muted)', cursor: 'pointer' }}
                                            >
                                                <X size={18} />
                                            </button>
                                        </div>

                                        <form onSubmit={handleAssignAddon}>
                                            {addServiceMode === 'custom' ? (
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
                                                        <div>
                                                            <label style={{ fontSize: '11.5px', fontWeight: '700', color: 'var(--fg-muted)', display: 'block', marginBottom: '4px' }}>
                                                                Service Name *
                                                            </label>
                                                            <input
                                                                type="text"
                                                                placeholder="e.g. Spiral Binding"
                                                                value={customName}
                                                                onChange={e => setCustomName(e.target.value)}
                                                                required
                                                                className="input"
                                                                style={{ width: '100%', fontSize: '13px' }}
                                                            />
                                                        </div>
                                                        <div>
                                                            <label style={{ fontSize: '11.5px', fontWeight: '700', color: 'var(--fg-muted)', display: 'block', marginBottom: '4px' }}>
                                                                Shop Price (₹) *
                                                            </label>
                                                            <input
                                                                type="number"
                                                                step="0.5"
                                                                min="0"
                                                                value={customPrice}
                                                                onChange={e => setCustomPrice(e.target.value)}
                                                                required
                                                                className="input"
                                                                style={{ width: '100%', fontSize: '13px' }}
                                                            />
                                                        </div>
                                                        <div>
                                                            <label style={{ fontSize: '11.5px', fontWeight: '700', color: 'var(--fg-muted)', display: 'block', marginBottom: '4px' }}>
                                                                Extra Prep Time (mins)
                                                            </label>
                                                            <input
                                                                type="number"
                                                                min="0"
                                                                value={customPrepTime}
                                                                onChange={e => setCustomPrepTime(e.target.value)}
                                                                className="input"
                                                                style={{ width: '100%', fontSize: '13px' }}
                                                            />
                                                        </div>
                                                        <div>
                                                            <label style={{ fontSize: '11.5px', fontWeight: '700', color: 'var(--fg-muted)', display: 'block', marginBottom: '4px' }}>
                                                                Page Bounds (Min – Max)
                                                            </label>
                                                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                                                <input
                                                                    type="number"
                                                                    min="1"
                                                                    value={customMinPages}
                                                                    onChange={e => setCustomMinPages(e.target.value)}
                                                                    placeholder="Min"
                                                                    className="input"
                                                                    style={{ width: '100%', fontSize: '13px' }}
                                                                />
                                                                <span style={{ color: 'var(--fg-muted)' }}>–</span>
                                                                <input
                                                                    type="number"
                                                                    min="1"
                                                                    value={customMaxPages}
                                                                    onChange={e => setCustomMaxPages(e.target.value)}
                                                                    placeholder="Max"
                                                                    className="input"
                                                                    style={{ width: '100%', fontSize: '13px' }}
                                                                />
                                                            </div>
                                                        </div>
                                                    </div>

                                                    <div>
                                                        <label style={{ fontSize: '11.5px', fontWeight: '700', color: 'var(--fg-muted)', display: 'block', marginBottom: '4px' }}>
                                                            Description (Optional)
                                                        </label>
                                                        <input
                                                            type="text"
                                                            placeholder="Short details shown to customers at checkout"
                                                            value={customDescription}
                                                            onChange={e => setCustomDescription(e.target.value)}
                                                            className="input"
                                                            style={{ width: '100%', fontSize: '13px' }}
                                                        />
                                                    </div>

                                                    <div>
                                                        <label style={{ fontSize: '11.5px', fontWeight: '700', color: 'var(--fg-muted)', display: 'block', marginBottom: '6px' }}>
                                                            Service Image (Optional)
                                                        </label>
                                                        <div style={{ display: 'flex', gap: '14px', alignItems: 'center', flexWrap: 'wrap' }}>
                                                            {customImageUrl ? (
                                                                <div style={{ position: 'relative', width: '68px', height: '68px', borderRadius: '10px', overflow: 'hidden', border: '1px solid var(--border)', flexShrink: 0 }}>
                                                                    <img src={customImageUrl} alt="Preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => setCustomImageUrl('')}
                                                                        style={{ position: 'absolute', top: 3, right: 3, background: 'rgba(0,0,0,0.7)', border: 'none', borderRadius: '50%', color: '#fff', width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0 }}
                                                                        title="Remove image"
                                                                    >
                                                                        <X size={12} />
                                                                    </button>
                                                                </div>
                                                            ) : (
                                                                <div style={{ width: '68px', height: '68px', borderRadius: '10px', border: '1px dashed var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--fg-muted)', flexShrink: 0, background: 'var(--bg-card)' }}>
                                                                    <ImageIcon size={24} style={{ opacity: 0.4 }} />
                                                                </div>
                                                            )}
                                                            <div style={{ flex: 1, minWidth: '220px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                                                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                                                    <label className="btn btn-outline btn-sm" style={{ cursor: 'pointer', fontSize: '11.5px', display: 'inline-flex', alignItems: 'center', gap: '6px', borderRadius: '8px', padding: '6px 12px' }}>
                                                                        <UploadCloud size={14} /> Upload Image
                                                                        <input
                                                                            type="file"
                                                                            accept="image/*"
                                                                            style={{ display: 'none' }}
                                                                            onChange={handleCustomImageFileChange}
                                                                        />
                                                                    </label>
                                                                    <span style={{ fontSize: '11px', color: 'var(--fg-muted)' }}>or paste an image URL below</span>
                                                                </div>
                                                                <input
                                                                    type="url"
                                                                    placeholder="https://... (direct image link)"
                                                                    value={customImageUrl}
                                                                    onChange={e => setCustomImageUrl(e.target.value)}
                                                                    className="input"
                                                                    style={{ width: '100%', fontSize: '12px' }}
                                                                />
                                                            </div>
                                                        </div>
                                                    </div>

                                                    <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '6px' }}>
                                                        <button
                                                            type="button"
                                                            onClick={() => setAssignModalOpen(false)}
                                                            className="btn btn-outline"
                                                            style={{ fontSize: '12.5px', borderRadius: '8px' }}
                                                        >
                                                            Cancel
                                                        </button>
                                                        <button
                                                            type="submit"
                                                            disabled={assigningAddon || !customName.trim()}
                                                            className="btn"
                                                            style={{ background: 'var(--accent)', color: '#092b31', fontWeight: '800', fontSize: '12.5px', padding: '8px 20px', borderRadius: '8px' }}
                                                        >
                                                            {assigningAddon ? 'Creating…' : 'Create & Add Service'}
                                                        </button>
                                                    </div>
                                                </div>
                                            ) : (
                                                <div>
                                                    {availableCatalogue.length === 0 ? (
                                                        <p style={{ fontSize: '12.5px', color: 'var(--fg-muted)', margin: '8px 0 16px' }}>
                                                            All active catalogue add-ons are already assigned to this shop. You can create a custom service instead.
                                                        </p>
                                                    ) : (
                                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', alignItems: 'end' }}>
                                                            <div>
                                                                <label style={{ fontSize: '11.5px', fontWeight: '700', color: 'var(--fg-muted)', display: 'block', marginBottom: '4px' }}>
                                                                    Select Service
                                                                </label>
                                                                <select
                                                                    value={assignAddonId}
                                                                    onChange={e => setAssignAddonId(e.target.value)}
                                                                    className="input"
                                                                    required
                                                                    style={{ width: '100%', fontSize: '13px' }}
                                                                >
                                                                    <option value="">-- Choose an add-on --</option>
                                                                    {availableCatalogue.map(c => (
                                                                        <option key={c.id} value={c.id}>
                                                                            {c.name} ({c.min_pages || 1}–{c.max_pages || '∞'} pages)
                                                                        </option>
                                                                    ))}
                                                                </select>
                                                            </div>

                                                            <div>
                                                                <label style={{ fontSize: '11.5px', fontWeight: '700', color: 'var(--fg-muted)', display: 'block', marginBottom: '4px' }}>
                                                                    This Shop's Price (₹)
                                                                </label>
                                                                <input
                                                                    type="number"
                                                                    step="0.5"
                                                                    min="0"
                                                                    value={assignPrice}
                                                                    onChange={e => setAssignPrice(e.target.value)}
                                                                    required
                                                                    className="input"
                                                                    style={{ width: '100%', fontSize: '13px' }}
                                                                />
                                                            </div>

                                                            <div style={{ display: 'flex', gap: '8px' }}>
                                                                <button
                                                                    type="submit"
                                                                    disabled={assigningAddon || !assignAddonId}
                                                                    className="btn"
                                                                    style={{ background: 'var(--accent)', color: '#092b31', fontWeight: '800', fontSize: '12.5px', padding: '8px 18px', borderRadius: '8px' }}
                                                                >
                                                                    {assigningAddon ? 'Assigning…' : 'Add to Shop'}
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => setAssignModalOpen(false)}
                                                                    className="btn btn-outline"
                                                                    style={{ fontSize: '12px', borderRadius: '8px' }}
                                                                >
                                                                    Cancel
                                                                </button>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </form>
                                    </div>
                                )}

                                {/* Edit Service Modal / Card */}
                                {editingAddon && (
                                    <div style={{
                                        padding: '20px',
                                        borderRadius: '14px',
                                        background: 'var(--bg-secondary)',
                                        border: '1px solid var(--accent)',
                                        marginBottom: '20px',
                                        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.1)',
                                    }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                                            <h4 style={{ fontSize: '15px', fontWeight: '800', margin: 0, color: 'var(--fg)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                <Edit2 size={16} style={{ color: 'var(--accent)' }} /> Edit Service: {editingAddon.name || editingAddon.addons?.name}
                                            </h4>
                                            <button
                                                type="button"
                                                onClick={() => setEditingAddon(null)}
                                                style={{ background: 'none', border: 'none', color: 'var(--fg-muted)', cursor: 'pointer' }}
                                            >
                                                <X size={18} />
                                            </button>
                                        </div>

                                        <form onSubmit={handleSaveEditAddon}>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
                                                    <div>
                                                        <label style={{ fontSize: '11.5px', fontWeight: '700', color: 'var(--fg-muted)', display: 'block', marginBottom: '4px' }}>
                                                            Service Name *
                                                        </label>
                                                        <input
                                                            type="text"
                                                            value={editAddonName}
                                                            onChange={e => setEditAddonName(e.target.value)}
                                                            required
                                                            className="input"
                                                            style={{ width: '100%', fontSize: '13px' }}
                                                        />
                                                    </div>
                                                    <div>
                                                        <label style={{ fontSize: '11.5px', fontWeight: '700', color: 'var(--fg-muted)', display: 'block', marginBottom: '4px' }}>
                                                            Shop Price (₹) *
                                                        </label>
                                                        <input
                                                            type="number"
                                                            step="0.5"
                                                            min="0"
                                                            value={editAddonPrice}
                                                            onChange={e => setEditAddonPrice(e.target.value)}
                                                            required
                                                            className="input"
                                                            style={{ width: '100%', fontSize: '13px' }}
                                                        />
                                                    </div>
                                                    <div>
                                                        <label style={{ fontSize: '11.5px', fontWeight: '700', color: 'var(--fg-muted)', display: 'block', marginBottom: '4px' }}>
                                                            Extra Prep Time (mins)
                                                        </label>
                                                        <input
                                                            type="number"
                                                            min="0"
                                                            value={editAddonPrepTime}
                                                            onChange={e => setEditAddonPrepTime(e.target.value)}
                                                            className="input"
                                                            style={{ width: '100%', fontSize: '13px' }}
                                                        />
                                                    </div>
                                                    <div>
                                                        <label style={{ fontSize: '11.5px', fontWeight: '700', color: 'var(--fg-muted)', display: 'block', marginBottom: '4px' }}>
                                                            Page Bounds (Min – Max)
                                                        </label>
                                                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                                            <input
                                                                type="number"
                                                                min="1"
                                                                value={editAddonMinPages}
                                                                onChange={e => setEditAddonMinPages(e.target.value)}
                                                                placeholder="Min"
                                                                className="input"
                                                                style={{ width: '100%', fontSize: '13px' }}
                                                            />
                                                            <span style={{ color: 'var(--fg-muted)' }}>–</span>
                                                            <input
                                                                type="number"
                                                                min="1"
                                                                value={editAddonMaxPages}
                                                                onChange={e => setEditAddonMaxPages(e.target.value)}
                                                                placeholder="Max"
                                                                className="input"
                                                                style={{ width: '100%', fontSize: '13px' }}
                                                            />
                                                        </div>
                                                    </div>
                                                </div>

                                                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '16px', alignItems: 'center' }}>
                                                    <div>
                                                        <label style={{ fontSize: '11.5px', fontWeight: '700', color: 'var(--fg-muted)', display: 'block', marginBottom: '4px' }}>
                                                            Description
                                                        </label>
                                                        <input
                                                            type="text"
                                                            value={editAddonDescription}
                                                            onChange={e => setEditAddonDescription(e.target.value)}
                                                            placeholder="Short details shown to customers at checkout"
                                                            className="input"
                                                            style={{ width: '100%', fontSize: '13px' }}
                                                        />
                                                    </div>
                                                    <div>
                                                        <label style={{ fontSize: '11.5px', fontWeight: '700', color: 'var(--fg-muted)', display: 'block', marginBottom: '8px' }}>
                                                            Service Status
                                                        </label>
                                                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: '600' }}>
                                                            <input
                                                                type="checkbox"
                                                                checked={editAddonAvailable}
                                                                onChange={e => setEditAddonAvailable(e.target.checked)}
                                                            />
                                                            <span>{editAddonAvailable ? 'Active' : 'Inactive'}</span>
                                                        </label>
                                                    </div>
                                                </div>

                                                <div>
                                                    <label style={{ fontSize: '11.5px', fontWeight: '700', color: 'var(--fg-muted)', display: 'block', marginBottom: '6px' }}>
                                                        Service Image (Optional)
                                                    </label>
                                                    <div style={{ display: 'flex', gap: '14px', alignItems: 'center', flexWrap: 'wrap' }}>
                                                        {editAddonImageUrl ? (
                                                            <div style={{ position: 'relative', width: '68px', height: '68px', borderRadius: '10px', overflow: 'hidden', border: '1px solid var(--border)', flexShrink: 0 }}>
                                                                <img src={editAddonImageUrl} alt="Preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                                                <button
                                                                    type="button"
                                                                    onClick={() => setEditAddonImageUrl('')}
                                                                    style={{ position: 'absolute', top: 3, right: 3, background: 'rgba(0,0,0,0.7)', border: 'none', borderRadius: '50%', color: '#fff', width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0 }}
                                                                    title="Remove image"
                                                                >
                                                                    <X size={12} />
                                                                </button>
                                                            </div>
                                                        ) : (
                                                            <div style={{ width: '68px', height: '68px', borderRadius: '10px', border: '1px dashed var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--fg-muted)', flexShrink: 0, background: 'var(--bg-card)' }}>
                                                                <ImageIcon size={24} style={{ opacity: 0.4 }} />
                                                            </div>
                                                        )}
                                                        <div style={{ flex: 1, minWidth: '220px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                                                <label className="btn btn-outline btn-sm" style={{ cursor: 'pointer', fontSize: '11.5px', display: 'inline-flex', alignItems: 'center', gap: '6px', borderRadius: '8px', padding: '6px 12px' }}>
                                                                    <UploadCloud size={14} /> Upload Image
                                                                    <input
                                                                        type="file"
                                                                        accept="image/*"
                                                                        style={{ display: 'none' }}
                                                                        onChange={handleEditAddonImageFileChange}
                                                                    />
                                                                </label>
                                                                <span style={{ fontSize: '11px', color: 'var(--fg-muted)' }}>or paste an image URL below</span>
                                                            </div>
                                                            <input
                                                                type="url"
                                                                placeholder="https://... (direct image link)"
                                                                value={editAddonImageUrl}
                                                                onChange={e => setEditAddonImageUrl(e.target.value)}
                                                                className="input"
                                                                style={{ width: '100%', fontSize: '12px' }}
                                                            />
                                                        </div>
                                                    </div>
                                                </div>

                                                <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '8px' }}>
                                                    <button
                                                        type="button"
                                                        onClick={() => setEditingAddon(null)}
                                                        className="btn btn-outline"
                                                        style={{ fontSize: '12.5px', borderRadius: '8px' }}
                                                    >
                                                        Cancel
                                                    </button>
                                                    <button
                                                        type="submit"
                                                        disabled={savingAddon || !editAddonName.trim()}
                                                        className="btn"
                                                        style={{ background: 'var(--accent)', color: '#092b31', fontWeight: '800', fontSize: '12.5px', padding: '8px 20px', borderRadius: '8px' }}
                                                    >
                                                        {savingAddon ? 'Saving…' : 'Save Changes'}
                                                    </button>
                                                </div>
                                            </div>
                                        </form>
                                    </div>
                                )}

                                {addons.length === 0 ? (
                                    <div style={{ padding: '48px 16px', textAlign: 'center', color: 'var(--fg-muted)', fontSize: '13px' }}>
                                        No custom add-ons assigned to this shop yet. Use "+ Add service" above to configure finishing services.
                                    </div>
                                ) : (
                                    <div style={{ overflowX: 'auto' }}>
                                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                                            <thead>
                                                <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left', color: 'var(--fg-muted)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                                    <th style={{ padding: '12px 14px' }}>ADD-ON</th>
                                                    <th style={{ padding: '12px 14px' }}>PRICE</th>
                                                    <th style={{ padding: '12px 14px' }}>EXTRA PREP TIME</th>
                                                    <th style={{ padding: '12px 14px' }}>PAGE BOUNDS</th>
                                                    <th style={{ padding: '12px 14px' }}>STATUS</th>
                                                    <th style={{ padding: '12px 14px', textAlign: 'right' }}>ACTIONS</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {addons.map(a => {
                                                    const saId = a.id;
                                                    const name = a.name || a.addons?.name || 'Add-on';
                                                    const desc = a.description || a.addons?.description || '';
                                                    const prep = a.estimated_minutes ?? a.addons?.estimated_minutes ?? 0;
                                                    const min = a.min_pages ?? a.addons?.min_pages ?? 1;
                                                    const max = a.max_pages ?? a.addons?.max_pages ?? 1000;
                                                    const price = Number(a.price || 0);
                                                    const isAvailable = a.is_available !== undefined ? a.is_available : (a.available !== undefined ? a.available : true);
                                                    const itemImg = a.image_url || a.imageUrl || a.addons?.image_url;

                                                    return (
                                                        <tr key={saId} style={{ borderBottom: '1px solid var(--border)', transition: 'background 0.15s' }}>
                                                            <td style={{ padding: '14px' }}>
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                                                    {itemImg ? (
                                                                        <div style={{
                                                                            width: '36px',
                                                                            height: '36px',
                                                                            borderRadius: '10px',
                                                                            overflow: 'hidden',
                                                                            border: '1px solid var(--border)',
                                                                            flexShrink: 0,
                                                                        }}>
                                                                            <img src={itemImg} alt={name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                                                        </div>
                                                                    ) : (
                                                                        <div style={{
                                                                            width: '36px',
                                                                            height: '36px',
                                                                            borderRadius: '10px',
                                                                            background: 'rgba(56, 189, 248, 0.1)',
                                                                            color: 'var(--accent)',
                                                                            display: 'flex',
                                                                            alignItems: 'center',
                                                                            justifyContent: 'center',
                                                                            flexShrink: 0,
                                                                        }}>
                                                                            <Layers size={18} />
                                                                        </div>
                                                                    )}
                                                                    <div>
                                                                        <div style={{ fontWeight: '700', color: 'var(--fg)', fontSize: '13.5px' }}>{name}</div>
                                                                        {desc && <div style={{ fontSize: '11.5px', color: 'var(--fg-muted)', marginTop: '2px' }}>{desc}</div>}
                                                                    </div>
                                                                </div>
                                                            </td>
                                                            <td style={{ padding: '14px', fontWeight: '800', color: 'var(--fg)', fontSize: '13.5px' }}>
                                                                ₹{price.toFixed(2)}
                                                            </td>
                                                            <td style={{ padding: '14px', color: 'var(--fg)', fontSize: '13px' }}>
                                                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                                                                    <Clock size={13} style={{ color: 'var(--fg-muted)' }} />
                                                                    <span>{prep > 0 ? `${prep} mins` : 'Instant'}</span>
                                                                </span>
                                                            </td>
                                                            <td style={{ padding: '14px', color: 'var(--fg-muted)', fontSize: '13px' }}>
                                                                {min} - {max}
                                                            </td>
                                                            <td style={{ padding: '14px' }}>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleToggleAddonAvailability(saId, isAvailable)}
                                                                    style={{
                                                                        cursor: 'pointer',
                                                                        border: `1px solid ${isAvailable ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
                                                                        background: isAvailable ? 'rgba(34, 197, 94, 0.12)' : 'rgba(239, 68, 68, 0.12)',
                                                                        color: isAvailable ? '#22c55e' : 'var(--error)',
                                                                        fontWeight: '700',
                                                                        fontSize: '11.5px',
                                                                        padding: '4px 12px',
                                                                        borderRadius: '999px',
                                                                        display: 'inline-flex',
                                                                        alignItems: 'center',
                                                                        gap: '5px',
                                                                    }}
                                                                >
                                                                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: isAvailable ? '#22c55e' : 'var(--error)' }} />
                                                                    {isAvailable ? 'Active' : 'Inactive'}
                                                                </button>
                                                            </td>
                                                            <td style={{ padding: '14px', textAlign: 'right' }}>
                                                                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => handleStartEditAddon(a)}
                                                                        className="btn btn-outline btn-sm"
                                                                        style={{
                                                                            fontSize: '12px',
                                                                            padding: '5px 12px',
                                                                            borderRadius: '8px',
                                                                            display: 'inline-flex',
                                                                            alignItems: 'center',
                                                                            gap: '5px',
                                                                        }}
                                                                    >
                                                                        <Edit2 size={13} /> Edit
                                                                    </button>
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => handleDeleteAddon(saId)}
                                                                        style={{
                                                                            cursor: 'pointer',
                                                                            background: 'rgba(239, 68, 68, 0.08)',
                                                                            border: '1px solid rgba(239, 68, 68, 0.2)',
                                                                            color: 'var(--error)',
                                                                            padding: '6px 8px',
                                                                            borderRadius: '8px',
                                                                            display: 'inline-flex',
                                                                            alignItems: 'center',
                                                                            justifyContent: 'center',
                                                                        }}
                                                                        title="Delete service"
                                                                    >
                                                                        <Trash2 size={14} />
                                                                    </button>
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* TAB 5: COMMISSION (Stage A5: Multi-Model Commission Engine) */}
                    {activeTab === 'commission' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                            {/* Active Commercial Policy Header Card */}
                            <div className="card" style={{ padding: '20px', borderRadius: '16px', background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
                                    <div>
                                        <h3 style={{ fontSize: '16px', fontWeight: '800', margin: 0, color: 'var(--fg)' }}>
                                            Active Commercial Policy
                                        </h3>
                                        <p style={{ margin: '2px 0 0', fontSize: '12px', color: 'var(--fg-muted)' }}>
                                            Enforced on this shop's orders at checkout and settlement.
                                        </p>
                                    </div>
                                    <div style={{ display: 'flex', gap: '8px' }}>
                                        {activeRule && (
                                            <button
                                                type="button"
                                                onClick={handleRunDryRun}
                                                disabled={dryRunLoading}
                                                className="btn btn-outline btn-sm"
                                                style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}
                                            >
                                                {dryRunLoading ? 'Evaluating…' : '🔍 Run Dry Run Evaluation'}
                                            </button>
                                        )}
                                        <Link href={`/admin/finance?view=shops&shopId=${shop.id}`} className="btn btn-outline btn-sm" style={{ fontSize: '12px' }}>
                                            Finance Control Center →
                                        </Link>
                                    </div>
                                </div>

                                {activeRule ? (
                                    <div style={{ padding: '16px', borderRadius: '12px', background: 'var(--bg-secondary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '14px' }}>
                                        <div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                <span style={{ fontSize: '12px', color: 'var(--fg-muted)', fontWeight: '700' }}>Active Platform Fee</span>
                                                <span style={{ fontSize: '11px', fontWeight: '700', padding: '2px 8px', borderRadius: '12px', background: 'rgba(34, 197, 94, 0.15)', color: '#22c55e' }}>
                                                    🟢 Live Rule
                                                </span>
                                            </div>
                                            <div style={{ fontSize: '32px', fontWeight: '900', color: 'var(--accent)', marginTop: '4px' }}>
                                                {activeRule.commissionPercentage}%
                                                <span style={{ fontSize: '14px', fontWeight: '600', color: 'var(--fg-muted)', marginLeft: '10px' }}>
                                                    ({activeRule.commission_bps} bps)
                                                </span>
                                            </div>
                                            <div style={{ fontSize: '12px', color: 'var(--fg-muted)', marginTop: '4px' }}>
                                                Effective since: <strong>{new Date(activeRule.effective_from).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</strong>
                                                {activeRule.effective_to && ` · Ends: ${new Date(activeRule.effective_to).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`}
                                            </div>
                                        </div>
                                        <div style={{ textAlign: 'right', minWidth: '160px' }}>
                                            <div style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--fg-muted)', fontWeight: '700' }}>Model Scope</div>
                                            <div style={{ fontSize: '13px', fontWeight: '700', color: 'var(--fg)', marginTop: '2px' }}>Shop Default</div>
                                            <div style={{ fontSize: '11px', color: 'var(--fg-muted)', marginTop: '4px' }}>Calculation: Revenue Percentage</div>
                                        </div>
                                    </div>
                                ) : (
                                    <div style={{ padding: '24px', textAlign: 'center', color: 'var(--fg-muted)', fontSize: '13px' }}>
                                        No active commission rule configured for this shop. All new orders will enter UNCONFIGURED financial state.
                                    </div>
                                )}
                            </div>

                            {/* Dry Run Evaluation Modal / Drawer */}
                            {dryRunResult && (
                                <div className="card" style={{ padding: '20px', borderRadius: '16px', background: 'var(--bg-card)', border: '2px solid var(--accent)' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                                        <div>
                                            <h4 style={{ fontSize: '15px', fontWeight: '800', margin: 0, color: 'var(--accent)' }}>
                                                Dry Run Evaluation Preview (Non-mutating)
                                            </h4>
                                            <p style={{ margin: '2px 0 0', fontSize: '12px', color: 'var(--fg-muted)' }}>
                                                Simulated against active rule window without altering database records.
                                            </p>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => setDryRunResult(null)}
                                            className="btn btn-outline btn-sm"
                                            style={{ fontSize: '11.5px' }}
                                        >
                                            Dismiss Preview ✕
                                        </button>
                                    </div>

                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '12px', marginBottom: '14px' }}>
                                        <div style={{ padding: '10px 14px', borderRadius: '10px', background: 'var(--bg-secondary)' }}>
                                            <div style={{ fontSize: '11px', color: 'var(--fg-muted)', fontWeight: '700' }}>Orders Evaluated</div>
                                            <div style={{ fontSize: '18px', fontWeight: '800', color: 'var(--fg)' }}>{dryRunResult.evaluatedCount}</div>
                                        </div>
                                        <div style={{ padding: '10px 14px', borderRadius: '10px', background: 'var(--bg-secondary)' }}>
                                            <div style={{ fontSize: '11px', color: 'var(--fg-muted)', fontWeight: '700' }}>Projected Gross</div>
                                            <div style={{ fontSize: '18px', fontWeight: '800', color: 'var(--fg)' }}>₹{dryRunResult.projectedGross.toFixed(2)}</div>
                                        </div>
                                        <div style={{ padding: '10px 14px', borderRadius: '10px', background: 'var(--bg-secondary)' }}>
                                            <div style={{ fontSize: '11px', color: 'var(--fg-muted)', fontWeight: '700' }}>Projected XerService Fee</div>
                                            <div style={{ fontSize: '18px', fontWeight: '800', color: 'var(--accent)' }}>₹{dryRunResult.projectedFee.toFixed(2)}</div>
                                        </div>
                                        <div style={{ padding: '10px 14px', borderRadius: '10px', background: 'var(--bg-secondary)' }}>
                                            <div style={{ fontSize: '11px', color: 'var(--fg-muted)', fontWeight: '700' }}>Projected Shop Net</div>
                                            <div style={{ fontSize: '18px', fontWeight: '800', color: '#22c55e' }}>₹{dryRunResult.projectedNet.toFixed(2)}</div>
                                        </div>
                                    </div>

                                    {dryRunResult.simulatedOrders.length > 0 ? (
                                        <div style={{ overflowX: 'auto' }}>
                                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                                                <thead>
                                                    <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left', color: 'var(--fg-muted)', fontSize: '11px' }}>
                                                        <th style={{ padding: '6px 8px' }}>Order #</th>
                                                        <th style={{ padding: '6px 8px' }}>Current State</th>
                                                        <th style={{ padding: '6px 8px', textAlign: 'right' }}>Gross</th>
                                                        <th style={{ padding: '6px 8px', textAlign: 'right' }}>Simulated Fee</th>
                                                        <th style={{ padding: '6px 8px', textAlign: 'right' }}>Simulated Net</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {dryRunResult.simulatedOrders.map((o: any) => (
                                                        <tr key={o.orderId} style={{ borderBottom: '1px solid var(--border)' }}>
                                                            <td style={{ padding: '6px 8px', fontWeight: '700' }}>{o.orderNumber}</td>
                                                            <td style={{ padding: '6px 8px' }}>{o.currentStatus}</td>
                                                            <td style={{ padding: '6px 8px', textAlign: 'right' }}>₹{o.grossAmount.toFixed(2)}</td>
                                                            <td style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--accent)', fontWeight: '700' }}>₹{o.projectedCommission.toFixed(2)}</td>
                                                            <td style={{ padding: '6px 8px', textAlign: 'right', color: '#22c55e', fontWeight: '700' }}>₹{o.projectedVendorNet.toFixed(2)}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    ) : (
                                        <div style={{ fontSize: '12px', color: 'var(--fg-muted)', textAlign: 'center', padding: '10px' }}>
                                            No unconfigured orders currently fall within this rule's effective window.
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Modern & Friendly Commission Engine */}
                            <div className="card" style={{ padding: '24px', borderRadius: '16px', background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
                                    <div>
                                        <h3 style={{ fontSize: '16px', fontWeight: '800', margin: 0, color: 'var(--fg)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <Percent size={18} style={{ color: 'var(--accent)' }} /> Commission Model & Rate Customizer
                                        </h3>
                                        <p style={{ margin: '3px 0 0', fontSize: '12px', color: 'var(--fg-muted)' }}>
                                            Adjust the platform fee percentage XerService charges on completed orders for this shop.
                                        </p>
                                    </div>
                                    <span style={{ fontSize: '11px', background: 'var(--accent-muted)', color: 'var(--accent)', padding: '3px 10px', borderRadius: '8px', fontWeight: '700' }}>
                                        Interactive Customizer
                                    </span>
                                </div>

                                {ruleFeedback && (
                                    <div style={{
                                        padding: '10px 14px',
                                        borderRadius: '10px',
                                        marginBottom: '16px',
                                        fontSize: '13px',
                                        fontWeight: '600',
                                        background: ruleFeedback.type === 'success' ? 'rgba(34, 197, 94, 0.12)' : 'rgba(239, 68, 68, 0.12)',
                                        color: ruleFeedback.type === 'success' ? '#22c55e' : 'var(--error)',
                                        border: `1px solid ${ruleFeedback.type === 'success' ? 'rgba(34, 197, 94, 0.25)' : 'rgba(239, 68, 68, 0.25)'}`,
                                    }}>
                                        {ruleFeedback.message}
                                    </div>
                                )}

                                {/* Rate Preset Pills */}
                                <div style={{ marginBottom: '18px' }}>
                                    <label style={{ fontSize: '12px', fontWeight: '700', color: 'var(--fg-muted)', display: 'block', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                        Quick Select Plan / Preset:
                                    </label>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                                        {[
                                            { pct: '5', label: '5% Partner' },
                                            { pct: '8', label: '8% Preferred' },
                                            { pct: '10', label: '10% Standard' },
                                            { pct: '12', label: '12% High-Volume' },
                                            { pct: '15', label: '15% Starter' },
                                        ].map(preset => {
                                            const isSelected = newRuleRate === preset.pct;
                                            return (
                                                <button
                                                    key={preset.pct}
                                                    type="button"
                                                    onClick={() => setNewRuleRate(preset.pct)}
                                                    style={{
                                                        padding: '6px 14px',
                                                        borderRadius: '8px',
                                                        border: isSelected ? '1px solid var(--accent)' : '1px solid var(--border)',
                                                        background: isSelected ? 'var(--accent)' : 'var(--bg-secondary)',
                                                        color: isSelected ? '#092b31' : 'var(--fg)',
                                                        fontWeight: '700',
                                                        fontSize: '12px',
                                                        cursor: 'pointer',
                                                        transition: 'all 0.15s ease',
                                                    }}
                                                >
                                                    {preset.label}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>

                                {/* Slider + Numeric Input */}
                                <div style={{ background: 'var(--bg-secondary)', padding: '16px', borderRadius: '12px', border: '1px solid var(--border)', marginBottom: '18px' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                                        <label style={{ fontSize: '12px', fontWeight: '700', color: 'var(--fg)' }}>
                                            Platform Commission Rate
                                        </label>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                            <input
                                                type="number"
                                                step="0.1"
                                                min="0"
                                                max="100"
                                                value={newRuleRate}
                                                onChange={e => setNewRuleRate(e.target.value)}
                                                className="input"
                                                style={{ width: '70px', textAlign: 'right', fontWeight: '800', fontSize: '14px', padding: '4px 8px' }}
                                            />
                                            <span style={{ fontWeight: '800', fontSize: '14px', color: 'var(--accent)' }}>%</span>
                                        </div>
                                    </div>

                                    <input
                                        type="range"
                                        min="0"
                                        max="30"
                                        step="0.5"
                                        value={Math.min(30, Math.max(0, parseFloat(newRuleRate) || 0))}
                                        onChange={e => setNewRuleRate(e.target.value)}
                                        style={{ width: '100%', accentColor: 'var(--accent)', cursor: 'pointer' }}
                                    />
                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--fg-muted)', marginTop: '4px' }}>
                                        <span>0% (Free)</span>
                                        <span>10% (Standard)</span>
                                        <span>20%</span>
                                        <span>30%</span>
                                    </div>
                                </div>

                                {/* Live Earnings Split Preview */}
                                {(() => {
                                    const rateNum = Math.max(0, Math.min(100, parseFloat(newRuleRate) || 0));
                                    const orderGross = Math.max(0, commSimOrderAmount || 0);
                                    const xerFee = Math.round(orderGross * (rateNum / 100) * 100) / 100;
                                    const vendorNet = Math.round((orderGross - xerFee) * 100) / 100;
                                    const vendorPct = Math.max(0, 100 - rateNum);

                                    return (
                                        <div style={{ background: 'var(--bg-secondary)', padding: '16px', borderRadius: '12px', border: '1px solid var(--border)', marginBottom: '18px' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
                                                <div style={{ fontSize: '12px', fontWeight: '700', color: 'var(--fg)' }}>
                                                    Order Revenue Split Simulation
                                                </div>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                    <span style={{ fontSize: '11.5px', color: 'var(--fg-muted)' }}>Simulate Order:</span>
                                                    {[50, 100, 250, 500].map(amt => (
                                                        <button
                                                            key={amt}
                                                            type="button"
                                                            onClick={() => setCommSimOrderAmount(amt)}
                                                            className="btn btn-outline btn-sm"
                                                            style={{
                                                                fontSize: '11px',
                                                                padding: '2px 7px',
                                                                borderRadius: '6px',
                                                                background: commSimOrderAmount === amt ? 'var(--accent-muted)' : 'transparent',
                                                                color: commSimOrderAmount === amt ? 'var(--accent)' : 'var(--fg-muted)',
                                                            }}
                                                        >
                                                            ₹{amt}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>

                                            {/* Visual Two-Tone Split Bar */}
                                            <div style={{ height: '24px', borderRadius: '8px', overflow: 'hidden', display: 'flex', background: 'var(--border)', marginBottom: '14px' }}>
                                                <div
                                                    style={{
                                                        width: `${vendorPct}%`,
                                                        background: '#10b981',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        color: '#fff',
                                                        fontSize: '11px',
                                                        fontWeight: '800',
                                                        transition: 'width 0.2s ease',
                                                    }}
                                                    title={`Vendor: ${vendorPct.toFixed(1)}%`}
                                                >
                                                    {vendorPct >= 20 ? `Shop ${vendorPct.toFixed(1)}%` : ''}
                                                </div>
                                                <div
                                                    style={{
                                                        width: `${rateNum}%`,
                                                        background: 'var(--accent)',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        color: '#092b31',
                                                        fontSize: '11px',
                                                        fontWeight: '800',
                                                        transition: 'width 0.2s ease',
                                                    }}
                                                    title={`XerService Fee: ${rateNum.toFixed(1)}%`}
                                                >
                                                    {rateNum >= 12 ? `Fee ${rateNum.toFixed(1)}%` : ''}
                                                </div>
                                            </div>

                                            {/* 3 Metric Cards */}
                                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '10px' }}>
                                                <div style={{ padding: '10px 14px', borderRadius: '10px', background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                                                    <div style={{ fontSize: '11px', color: 'var(--fg-muted)', fontWeight: '700' }}>Customer Gross</div>
                                                    <div style={{ fontSize: '18px', fontWeight: '800', color: 'var(--fg)' }}>₹{orderGross.toFixed(2)}</div>
                                                </div>
                                                <div style={{ padding: '10px 14px', borderRadius: '10px', background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                                                    <div style={{ fontSize: '11px', color: 'var(--accent)', fontWeight: '700' }}>XerService Fee ({rateNum}%)</div>
                                                    <div style={{ fontSize: '18px', fontWeight: '800', color: 'var(--accent)' }}>₹{xerFee.toFixed(2)}</div>
                                                </div>
                                                <div style={{ padding: '10px 14px', borderRadius: '10px', background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                                                    <div style={{ fontSize: '11px', color: '#10b981', fontWeight: '700' }}>Shop Net ({vendorPct.toFixed(1)}%)</div>
                                                    <div style={{ fontSize: '18px', fontWeight: '800', color: '#10b981' }}>₹{vendorNet.toFixed(2)}</div>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })()}

                                {/* Apply Form & Advanced Scheduling */}
                                <form onSubmit={handleCreateRule}>
                                    <div style={{ marginBottom: '14px' }}>
                                        <button
                                            type="button"
                                            onClick={() => setShowAdvancedScheduling(prev => !prev)}
                                            style={{ background: 'none', border: 'none', color: 'var(--fg-muted)', fontSize: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px', padding: 0 }}
                                        >
                                            {showAdvancedScheduling ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                            {showAdvancedScheduling ? 'Hide Advanced Scheduling' : 'Advanced Scheduling (Custom Dates)'}
                                        </button>
                                    </div>

                                    {showAdvancedScheduling && (
                                        <div style={{ background: 'var(--bg-secondary)', padding: '14px', borderRadius: '10px', border: '1px solid var(--border)', marginBottom: '16px' }}>
                                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', marginBottom: '10px' }}>
                                                <div>
                                                    <label style={{ fontSize: '11.5px', fontWeight: '700', color: 'var(--fg-muted)', display: 'block', marginBottom: '4px' }}>
                                                        Effective From
                                                    </label>
                                                    <input
                                                        type="date"
                                                        required
                                                        value={newRuleEffectiveFrom}
                                                        onChange={e => setNewRuleEffectiveFrom(e.target.value)}
                                                        className="input"
                                                        style={{ width: '100%', fontSize: '13px' }}
                                                    />
                                                </div>
                                                <div>
                                                    <label style={{ fontSize: '11.5px', fontWeight: '700', color: 'var(--fg-muted)', display: 'block', marginBottom: '4px' }}>
                                                        Effective To (Optional)
                                                    </label>
                                                    <input
                                                        type="date"
                                                        value={newRuleEffectiveTo}
                                                        onChange={e => setNewRuleEffectiveTo(e.target.value)}
                                                        className="input"
                                                        style={{ width: '100%', fontSize: '13px' }}
                                                    />
                                                </div>
                                            </div>
                                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--fg)', cursor: 'pointer' }}>
                                                <input
                                                    type="checkbox"
                                                    checked={newRuleClosePrevious}
                                                    onChange={e => setNewRuleClosePrevious(e.target.checked)}
                                                />
                                                <span>Safely close previous active rule at Effective From date</span>
                                            </label>
                                        </div>
                                    )}

                                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                        <button
                                            type="submit"
                                            disabled={creatingRule}
                                            className="btn"
                                            style={{
                                                background: 'var(--accent)',
                                                color: '#092b31',
                                                fontWeight: '800',
                                                fontSize: '13px',
                                                padding: '10px 24px',
                                                borderRadius: '8px',
                                                display: 'inline-flex',
                                                alignItems: 'center',
                                                gap: '6px',
                                            }}
                                        >
                                            <Check size={16} /> {creatingRule ? 'Applying Rate…' : `Apply ${newRuleRate}% Commission Rate`}
                                        </button>
                                    </div>
                                </form>
                            </div>

                            {/* Section 8.1: Full Versioned Rule History Table */}
                            {rules.length > 0 && (
                                <div className="card" style={{ padding: '20px', borderRadius: '16px', background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                                    <h4 style={{ fontSize: '14px', fontWeight: '800', margin: '0 0 12px', color: 'var(--fg)' }}>
                                        Policy Audit Trail & Rule History
                                    </h4>
                                    <div style={{ overflowX: 'auto' }}>
                                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' }}>
                                            <thead>
                                                <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left', color: 'var(--fg-muted)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                                    <th style={{ padding: '8px 10px' }}>Rate (%)</th>
                                                    <th style={{ padding: '8px 10px' }}>Basis Points</th>
                                                    <th style={{ padding: '8px 10px' }}>Scope</th>
                                                    <th style={{ padding: '8px 10px' }}>Effective From</th>
                                                    <th style={{ padding: '8px 10px' }}>Effective To</th>
                                                    <th style={{ padding: '8px 10px', textAlign: 'center' }}>State</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {rules.map(r => (
                                                    <tr key={r.id} style={{ borderBottom: '1px solid var(--border)' }}>
                                                        <td style={{ padding: '10px', fontWeight: '800', color: 'var(--fg)' }}>
                                                            {r.commission_bps / 100}%
                                                        </td>
                                                        <td style={{ padding: '10px', color: 'var(--fg-muted)' }}>
                                                            {r.commission_bps} bps
                                                        </td>
                                                        <td style={{ padding: '10px', color: 'var(--fg-muted)' }}>
                                                            Shop Default
                                                        </td>
                                                        <td style={{ padding: '10px', color: 'var(--fg-muted)' }}>
                                                            {new Date(r.effective_from).toLocaleDateString('en-IN')}
                                                        </td>
                                                        <td style={{ padding: '10px', color: 'var(--fg-muted)' }}>
                                                            {r.effective_to ? new Date(r.effective_to).toLocaleDateString('en-IN') : 'Indefinite'}
                                                        </td>
                                                        <td style={{ padding: '10px', textAlign: 'center' }}>
                                                            <span style={{
                                                                fontSize: '11px',
                                                                fontWeight: '700',
                                                                padding: '2px 8px',
                                                                borderRadius: '6px',
                                                                background: r.is_active ? 'rgba(34, 197, 94, 0.12)' : 'rgba(100, 116, 139, 0.12)',
                                                                color: r.is_active ? '#22c55e' : 'var(--fg-muted)',
                                                            }}>
                                                                {r.is_active ? '🟢 Current' : '⚪ Historical'}
                                                            </span>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
            {/* Customer Storefront Preview Modal (Priority 2) */}
            {previewModalOpen && customerPreview && (
                <div style={{
                    position: 'fixed',
                    inset: 0,
                    zIndex: 9999,
                    background: 'rgba(0, 0, 0, 0.75)',
                    backdropFilter: 'blur(5px)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '20px',
                }}>
                    <div style={{
                        background: 'var(--bg-card)',
                        borderRadius: '20px',
                        border: '1px solid var(--border)',
                        width: '100%',
                        maxWidth: '1080px',
                        maxHeight: '90vh',
                        display: 'flex',
                        flexDirection: 'column',
                        overflow: 'hidden',
                        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
                    }}>
                        {/* Modal Header */}
                        <div style={{
                            padding: '20px 24px',
                            borderBottom: '1px solid var(--border)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            flexWrap: 'wrap',
                            gap: '12px',
                        }}>
                            <div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                    <h2 style={{ fontSize: '18px', fontWeight: '900', margin: 0, color: 'var(--fg)' }}>
                                        Customer Storefront Preview
                                    </h2>
                                    <span style={{
                                        fontSize: '11px',
                                        fontWeight: '800',
                                        padding: '2px 8px',
                                        borderRadius: '6px',
                                        background: 'rgba(0, 240, 255, 0.15)',
                                        color: 'var(--accent)',
                                    }}>
                                        Marketplace Fidelity
                                    </span>
                                </div>
                                <p style={{ fontSize: '12px', color: 'var(--fg-muted)', margin: '4px 0 0' }}>
                                    Inspect how customers discover this shop and verify all supported capabilities before publishing.
                                </p>
                            </div>

                            <button
                                onClick={() => setPreviewModalOpen(false)}
                                className="btn btn-outline btn-sm"
                                style={{ padding: '6px 10px', borderRadius: '8px', color: 'var(--fg-muted)', cursor: 'pointer' }}
                                aria-label="Close preview modal"
                            >
                                <X size={16} />
                            </button>
                        </div>

                        {/* Simulation Bar */}
                        <div style={{
                            padding: '12px 24px',
                            background: 'var(--bg-muted)',
                            borderBottom: '1px solid var(--border)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            flexWrap: 'wrap',
                            gap: '10px',
                        }}>
                            <span style={{ fontSize: '12px', fontWeight: '800', color: 'var(--fg)' }}>
                                Simulate Availability:
                            </span>
                            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                {[
                                    { id: null, label: `Real (${shop.shopStatus})` },
                                    { id: 'OPEN', label: '🟢 Open' },
                                    { id: 'PAUSED', label: '🟡 Paused' },
                                    { id: 'CLOSING_SOON', label: '🟠 Closing Soon' },
                                    { id: 'CLOSED', label: '🔴 Closed' },
                                ].map(option => (
                                    <button
                                        key={String(option.id)}
                                        onClick={() => setSimulatedStatus(option.id as any)}
                                        className="btn btn-sm"
                                        style={{
                                            fontSize: '11px',
                                            padding: '4px 10px',
                                            borderRadius: '6px',
                                            background: simulatedStatus === option.id ? 'var(--accent)' : 'var(--bg-card)',
                                            color: simulatedStatus === option.id ? '#092b31' : 'var(--fg)',
                                            border: '1px solid var(--border)',
                                            fontWeight: simulatedStatus === option.id ? '800' : '600',
                                            cursor: 'pointer',
                                        }}
                                    >
                                        {option.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Modal Body: Two Columns */}
                        <div style={{
                            padding: '24px',
                            overflowY: 'auto',
                            display: 'grid',
                            gridTemplateColumns: 'minmax(320px, 380px) 1fr',
                            gap: '28px',
                            alignItems: 'start',
                        }}>
                            {/* Column 1: Vertical 16:9 Card */}
                            <div>
                                <h3 style={{ fontSize: '13px', fontWeight: '800', textTransform: 'uppercase', color: 'var(--fg-muted)', marginBottom: '12px', letterSpacing: '0.5px' }}>
                                    Homepage Discovery Card
                                </h3>

                                {(() => {
                                    const effectiveStatus = simulatedStatus || (shop.closingSoon ? 'CLOSING_SOON' : shop.shopStatus);
                                    const isClosed = effectiveStatus === 'CLOSED';
                                    const isPaused = effectiveStatus === 'PAUSED';
                                    const isClosingSoon = effectiveStatus === 'CLOSING_SOON';
                                    const isUnavailable = isClosed || isPaused || isClosingSoon;

                                    return (
                                        <div
                                            className="shop-card-vertical"
                                            style={{
                                                background: 'var(--bg-card)',
                                                borderRadius: '16px',
                                                border: `1px solid ${isClosingSoon || isPaused ? '#f59e0b' : 'var(--border)'}`,
                                                overflow: 'hidden',
                                                boxShadow: '0 8px 24px rgba(0, 0, 0, 0.08)',
                                                opacity: isUnavailable ? 0.8 : 1,
                                            }}
                                        >
                                            {/* 16:9 Banner */}
                                            <div style={{
                                                width: '100%',
                                                height: '180px',
                                                position: 'relative',
                                                background: 'linear-gradient(135deg, #1e293b, #0f172a)',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                            }}>
                                                {customerPreview.imageUrl ? (
                                                    <img
                                                        src={customerPreview.imageUrl}
                                                        alt={customerPreview.name}
                                                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                                    />
                                                ) : (
                                                    <div style={{
                                                        width: '72px',
                                                        height: '72px',
                                                        borderRadius: '20px',
                                                        background: 'rgba(0, 240, 255, 0.15)',
                                                        border: '2px solid rgba(0, 240, 255, 0.3)',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        fontSize: '28px',
                                                        fontWeight: '900',
                                                        color: 'var(--accent)',
                                                    }}>
                                                        {customerPreview.imageInitials}
                                                    </div>
                                                )}

                                                <div style={{ position: 'absolute', top: '12px', right: '12px' }}>
                                                    {isClosed ? (
                                                        <span className="badge badge-outline" style={{ fontSize: '10px', fontWeight: '800', textTransform: 'uppercase', background: 'rgba(0,0,0,0.6)', color: 'var(--error)' }}>Closed</span>
                                                    ) : isPaused ? (
                                                        <span className="badge" style={{ fontSize: '10px', fontWeight: '800', textTransform: 'uppercase', background: '#f59e0b', color: '#fff' }}>Paused</span>
                                                    ) : isClosingSoon ? (
                                                        <span className="badge" style={{ fontSize: '10px', fontWeight: '800', textTransform: 'uppercase', background: '#f97316', color: '#fff' }}>Closing soon</span>
                                                    ) : (
                                                        <span className="badge" style={{ fontSize: '10px', fontWeight: '800', textTransform: 'uppercase', background: '#22c55e', color: '#fff' }}>Open</span>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Body */}
                                            <div style={{ padding: '16px' }}>
                                                <h4 style={{ fontSize: '16px', fontWeight: '900', margin: '0 0 6px', color: 'var(--fg)' }}>
                                                    {customerPreview.name}
                                                </h4>

                                                {customerPreview.address && (
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--fg-muted)', marginBottom: '4px' }}>
                                                        <MapPin size={13} style={{ flexShrink: 0 }} />
                                                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{customerPreview.address}</span>
                                                    </div>
                                                )}

                                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--fg-muted)', marginBottom: '12px' }}>
                                                    <Clock size={13} style={{ flexShrink: 0 }} />
                                                    <span>{customerPreview.openTime} – {customerPreview.closeTime}</span>
                                                </div>

                                                {(isClosingSoon || isPaused) && (
                                                    <p style={{ fontSize: '11.5px', color: '#f59e0b', background: 'rgba(245, 158, 11, 0.1)', padding: '6px 10px', borderRadius: '6px', margin: '0 0 12px', fontWeight: '600' }}>
                                                        {shop.closingMessage || (isPaused ? 'Orders temporarily paused.' : 'Orders paused — closing soon.')}
                                                    </p>
                                                )}

                                                {/* Service Chips */}
                                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '14px' }}>
                                                    {customerPreview.supportedServices.map(service => (
                                                        <span
                                                            key={service}
                                                            style={{
                                                                fontSize: '11px',
                                                                fontWeight: '700',
                                                                padding: '2px 8px',
                                                                borderRadius: '6px',
                                                                background: 'var(--bg-muted)',
                                                                color: 'var(--fg)',
                                                                border: '1px solid var(--border)',
                                                            }}
                                                        >
                                                            {service}
                                                        </span>
                                                    ))}
                                                </div>

                                                {/* Price basis */}
                                                <div style={{ padding: '10px 12px', borderRadius: '10px', background: 'var(--bg-muted)', marginBottom: '16px' }}>
                                                    {customerPreview.startingPrice !== null ? (
                                                        <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
                                                            <span style={{ fontSize: '12.5px', color: 'var(--fg-muted)' }}>From</span>
                                                            <strong style={{ fontSize: '15px', color: 'var(--fg)' }}>₹{customerPreview.startingPrice.toFixed(2)}</strong>
                                                            <span style={{ fontSize: '11px', color: 'var(--fg-muted)' }}>({customerPreview.startingPriceBasis})</span>
                                                        </div>
                                                    ) : (
                                                        <span style={{ fontSize: '12px', color: 'var(--fg-muted)' }}>Standard rates apply</span>
                                                    )}
                                                    {customerPreview.priceColorPerPage !== null && (
                                                        <div style={{ fontSize: '11.5px', color: 'var(--accent)', marginTop: '4px', fontWeight: '700' }}>
                                                            Colour from ₹{customerPreview.priceColorPerPage.toFixed(2)}
                                                        </div>
                                                    )}
                                                </div>

                                                {/* CTA */}
                                                <button
                                                    disabled={isUnavailable}
                                                    className="btn btn-accent"
                                                    style={{
                                                        width: '100%',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        gap: '8px',
                                                        fontWeight: '800',
                                                        opacity: isUnavailable ? 0.6 : 1,
                                                        cursor: isUnavailable ? 'not-allowed' : 'default',
                                                    }}
                                                >
                                                    <UploadCloud size={15} />
                                                    <span>{isClosed ? 'Closed' : isPaused ? 'Paused' : 'Print here'}</span>
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })()}
                            </div>

                            {/* Column 2: Supported Settings & Capabilities Matrix */}
                            <div>
                                <h3 style={{ fontSize: '13px', fontWeight: '800', textTransform: 'uppercase', color: 'var(--fg-muted)', marginBottom: '12px', letterSpacing: '0.5px' }}>
                                    Supported Customer Capabilities
                                </h3>

                                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                    {/* Paper Sizes */}
                                    <div style={{ background: 'var(--bg-muted)', padding: '14px', borderRadius: '12px', border: '1px solid var(--border)' }}>
                                        <div style={{ fontSize: '12px', fontWeight: '800', color: 'var(--fg)', marginBottom: '8px' }}>
                                            📄 Supported Paper Sizes ({customerPreview.supportedCapabilities.paperSizes.length})
                                        </div>
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                                            {customerPreview.supportedCapabilities.paperSizes.length > 0 ? (
                                                customerPreview.supportedCapabilities.paperSizes.map(p => (
                                                    <span key={p} style={{ fontSize: '11.5px', fontWeight: '700', padding: '3px 9px', borderRadius: '6px', background: 'var(--bg-card)', color: 'var(--accent)', border: '1px solid var(--border)' }}>
                                                        {p}
                                                    </span>
                                                ))
                                            ) : (
                                                <span style={{ fontSize: '11.5px', color: 'var(--error)' }}>No paper sizes configured</span>
                                            )}
                                        </div>
                                    </div>

                                    {/* Print Modes */}
                                    <div style={{ background: 'var(--bg-muted)', padding: '14px', borderRadius: '12px', border: '1px solid var(--border)' }}>
                                        <div style={{ fontSize: '12px', fontWeight: '800', color: 'var(--fg)', marginBottom: '8px' }}>
                                            🎨 Print Modes ({customerPreview.supportedCapabilities.printModes.length})
                                        </div>
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                                            {customerPreview.supportedCapabilities.printModes.includes('BW') && (
                                                <span style={{ fontSize: '11.5px', fontWeight: '700', padding: '3px 9px', borderRadius: '6px', background: 'var(--bg-card)', color: 'var(--fg)', border: '1px solid var(--border)' }}>
                                                    ⚫ Black & White
                                                </span>
                                            )}
                                            {customerPreview.supportedCapabilities.printModes.includes('COLOUR') && (
                                                <span style={{ fontSize: '11.5px', fontWeight: '700', padding: '3px 9px', borderRadius: '6px', background: 'var(--bg-card)', color: '#c084fc', border: '1px solid var(--border)' }}>
                                                    🌈 Full Colour
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    {/* Duplex / Sides */}
                                    <div style={{ background: 'var(--bg-muted)', padding: '14px', borderRadius: '12px', border: '1px solid var(--border)' }}>
                                        <div style={{ fontSize: '12px', fontWeight: '800', color: 'var(--fg)', marginBottom: '8px' }}>
                                            🔄 Duplex / Sides Support ({customerPreview.supportedCapabilities.duplexModes.length})
                                        </div>
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                                            {customerPreview.supportedCapabilities.duplexModes.map(m => (
                                                <span key={m} style={{ fontSize: '11.5px', fontWeight: '700', padding: '3px 9px', borderRadius: '6px', background: 'var(--bg-card)', color: 'var(--fg)', border: '1px solid var(--border)' }}>
                                                    {m === 'SINGLE' ? 'Single-sided (Simplex)' : m === 'DOUBLE_LONG_EDGE' ? 'Double-sided (Long Edge)' : 'Double-sided (Short Edge)'}
                                                </span>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Active Add-ons */}
                                    <div style={{ background: 'var(--bg-muted)', padding: '14px', borderRadius: '12px', border: '1px solid var(--border)' }}>
                                        <div style={{ fontSize: '12px', fontWeight: '800', color: 'var(--fg)', marginBottom: '8px' }}>
                                            ✨ Active Add-on Services ({customerPreview.supportedCapabilities.activeAddons.length})
                                        </div>
                                        {customerPreview.supportedCapabilities.activeAddons.length > 0 ? (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                                {customerPreview.supportedCapabilities.activeAddons.map(a => (
                                                    <div key={a.name} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', padding: '4px 0', borderBottom: '1px dashed var(--border)' }}>
                                                        <span style={{ fontWeight: '600', color: 'var(--fg)' }}>{a.name}</span>
                                                        <strong style={{ color: '#22c55e' }}>₹{a.price.toFixed(2)} {a.priceUnit ? `/${a.priceUnit.toLowerCase()}` : ''}</strong>
                                                    </div>
                                                ))}
                                            </div>
                                        ) : (
                                            <span style={{ fontSize: '11.5px', color: 'var(--fg-muted)' }}>No add-ons assigned to this shop</span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            <ShopPhotoCropModal
                open={cropModalOpen}
                imageSrc={cropImageSrc}
                fileInfo={cropFileInfo}
                onClose={() => setCropModalOpen(false)}
                onSave={(croppedDataUrl) => {
                    setEditPhotoUrl(croppedDataUrl);
                    setCropModalOpen(false);
                }}
            />
        </div>
    );
}

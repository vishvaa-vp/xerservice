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
} from 'lucide-react';
import type { ShopReadinessReport } from '@/lib/setup-readiness';
import type { ShopCustomerPreview } from '@/lib/customer-preview';

type WorkspaceTab = 'dashboard' | 'profile' | 'pricing' | 'addons' | 'commission' | 'finance';

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

    // Quote simulator state
    const [simPages, setSimPages] = useState<number>(8);
    const [simPaperSize, setSimPaperSize] = useState<'A4' | 'A3' | 'LEGAL'>('A4');
    const [simMode, setSimMode] = useState<'BW' | 'COLOUR'>('BW');
    const [simSides, setSimSides] = useState<'SINGLE' | 'DOUBLE_LONG_EDGE' | 'DOUBLE_SHORT_EDGE'>('DOUBLE_LONG_EDGE');
    const [simCopies, setSimCopies] = useState<number>(1);
    const [simPagesPerSide, setSimPagesPerSide] = useState<number>(2);
    const [simSelectedAddons, setSimSelectedAddons] = useState<string[]>([]);

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

    // Commission Simulator & Management state (Stage A5)
    const [commSimMethod, setCommSimMethod] = useState<'REVENUE_PERCENTAGE' | 'CONFIGURED_PROFIT_PERCENTAGE' | 'FIXED_PER_UNIT'>('REVENUE_PERCENTAGE');
    const [commSimRate, setCommSimRate] = useState<number>(10);
    const [commSimCostBasis, setCommSimCostBasis] = useState<number>(2.40);
    const [commSimQuantity, setCommSimQuantity] = useState<number>(2);
    const [commSimUnit, setCommSimUnit] = useState<'PHYSICAL_SHEET' | 'PRINTED_SIDE' | 'DOCUMENT_PAGE' | 'SERVICE_UNIT'>('PHYSICAL_SHEET');
    const [commSimRevenue, setCommSimRevenue] = useState<number>(4.00);

    const [newRuleRate, setNewRuleRate] = useState('5');
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

    // Addon Handlers
    const handleAssignAddon = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!assignAddonId) return;
        setAssigningAddon(true);
        setAddonFeedback(null);
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) throw new Error('Not authenticated');

            const res = await fetch(`/api/admin/vendors/${vendorId}/shops/${shopId}/addons`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${session.access_token}`,
                },
                body: JSON.stringify({
                    addonId: assignAddonId,
                    price: Number(assignPrice) || 0,
                    isAvailable: true,
                }),
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to assign add-on');

            setAddons(prev => [...prev, data.assignment]);
            setAvailableCatalogue(prev => prev.filter(c => c.id !== assignAddonId));
            setAssignAddonId('');
            setAssignModalOpen(false);
            setAddonFeedback({ type: 'success', message: 'Add-on successfully assigned to shop!' });
            setTimeout(() => setAddonFeedback(null), 4000);
        } catch (err: any) {
            setAddonFeedback({ type: 'error', message: err.message || 'Failed to assign add-on' });
        } finally {
            setAssigningAddon(false);
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

    // Calculate Quote in Simulator (Section 6.3)
    const calculateSimQuote = () => {
        // Find matching rate in matrixRows or pricing
        const matchingRow = matrixRows.length > 0
            ? matrixRows.find(p => p.paper_size === simPaperSize && p.print_mode === simMode && p.sides === simSides && p.active)
            : pricing.find(p => p.paper_size === simPaperSize && p.print_mode === simMode && p.sides === simSides && p.active);

        const sheetRate = matchingRow && Number(matchingRow.price_per_sheet) > 0 ? Number(matchingRow.price_per_sheet) : null;
        if (sheetRate === null) {
            return { error: `Price needed: ${simPaperSize} ${simMode === 'BW' ? 'B&W' : 'Colour'} (${simSides.replace(/_/g, ' ')}) is not active or priced for this shop. Customers will be blocked.` };
        }

        const printedSidesPerCopy = Math.ceil(simPages / Math.max(1, simPagesPerSide));
        const sheetsPerCopy = simSides.includes('DOUBLE')
            ? Math.ceil(printedSidesPerCopy / 2)
            : printedSidesPerCopy;
        const totalPhysicalSheets = sheetsPerCopy * Math.max(1, simCopies);
        const printingAmount = Math.round(totalPhysicalSheets * sheetRate * 100) / 100;

        // Calculate selected add-ons amount
        let addonsAmount = 0;
        for (const saId of simSelectedAddons) {
            const foundSa = addons.find(a => (a.id === saId || a.addon_id === saId));
            if (foundSa) {
                addonsAmount += Number(foundSa.price || 0);
            }
        }
        addonsAmount = Math.round(addonsAmount * 100) / 100;

        const totalAmount = Math.round((printingAmount + addonsAmount) * 100) / 100;
        const commissionPct = activeRule ? Number(activeRule.commissionPercentage || 0) : 0;
        const commissionAmount = Math.round((totalAmount * (commissionPct / 100)) * 100) / 100;
        const vendorNet = Math.round((totalAmount - commissionAmount) * 100) / 100;

        return {
            rate: sheetRate,
            printedSidesPerCopy,
            sheetsPerCopy,
            totalPhysicalSheets,
            printingAmount,
            addonsAmount,
            totalAmount,
            commissionPct,
            commissionAmount,
            vendorNet,
        };
    };

    // Load standard Astraplan Section 8.2 worked example presets
    const loadScenarioPreset = (scenario: 1 | 2 | 3 | 4) => {
        if (scenario === 1) {
            setCommSimMethod('REVENUE_PERCENTAGE');
            setCommSimRate(10);
            setCommSimRevenue(4.00);
            setCommSimQuantity(2);
            setCommSimUnit('PHYSICAL_SHEET');
        } else if (scenario === 2) {
            setCommSimMethod('CONFIGURED_PROFIT_PERCENTAGE');
            setCommSimRate(10);
            setCommSimCostBasis(2.40);
            setCommSimRevenue(4.00);
            setCommSimQuantity(2);
            setCommSimUnit('PHYSICAL_SHEET');
        } else if (scenario === 3) {
            setCommSimMethod('FIXED_PER_UNIT');
            setCommSimRate(0.25);
            setCommSimRevenue(4.00);
            setCommSimQuantity(2);
            setCommSimUnit('PHYSICAL_SHEET');
        } else if (scenario === 4) {
            setCommSimMethod('REVENUE_PERCENTAGE');
            setCommSimRate(10);
            setCommSimRevenue(24.00);
            setCommSimQuantity(2);
            setCommSimUnit('PHYSICAL_SHEET');
        }
    };

    // Calculate dynamic commission in simulator
    const calculateCommSimQuote = () => {
        let fee = 0;
        let formula = '';
        const revenue = Math.round(Number(commSimRevenue || 0) * 100) / 100;

        if (commSimMethod === 'REVENUE_PERCENTAGE') {
            fee = Math.round(revenue * (commSimRate / 100) * 100) / 100;
            formula = `₹${revenue.toFixed(2)} × ${commSimRate}% = ₹${fee.toFixed(2)}`;
        } else if (commSimMethod === 'CONFIGURED_PROFIT_PERCENTAGE') {
            const cost = Math.round(Number(commSimCostBasis || 0) * 100) / 100;
            const profit = Math.max(0, Math.round((revenue - cost) * 100) / 100);
            fee = Math.round(profit * (commSimRate / 100) * 100) / 100;
            formula = `max(₹${revenue.toFixed(2)} - ₹${cost.toFixed(2)}, 0) × ${commSimRate}% = ₹${profit.toFixed(2)} × ${commSimRate}% = ₹${fee.toFixed(2)}`;
        } else if (commSimMethod === 'FIXED_PER_UNIT') {
            fee = Math.round(commSimQuantity * commSimRate * 100) / 100;
            formula = `${commSimQuantity} ${commSimUnit.toLowerCase().replace(/_/g, ' ')}(s) × ₹${commSimRate.toFixed(2)} = ₹${fee.toFixed(2)}`;
        }

        if (fee > revenue) {
            fee = revenue;
            formula += ` (capped at revenue ₹${revenue.toFixed(2)})`;
        }
        const shopNet = Math.round((revenue - fee) * 100) / 100;

        return {
            revenue,
            fee,
            shopNet,
            formula,
        };
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

    const simResult = calculateSimQuote();

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
                            gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
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
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(200px, 240px) 1fr', gap: '24px', alignItems: 'start' }}>
                {/* Local Menu (Section 5.4) */}
                <div className="card" style={{
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

                    <button
                        onClick={() => setActiveTab('finance')}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '10px',
                            padding: '10px 14px',
                            borderRadius: '10px',
                            border: 'none',
                            cursor: 'pointer',
                            fontSize: '13px',
                            fontWeight: activeTab === 'finance' ? '800' : '600',
                            background: activeTab === 'finance' ? 'var(--accent-muted)' : 'transparent',
                            color: activeTab === 'finance' ? 'var(--accent)' : 'var(--fg-muted)',
                            textAlign: 'left',
                            transition: 'all 0.15s',
                        }}
                    >
                        <DollarSign size={16} /> Orders & Money
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

                                {/* Photo URL */}
                                <div>
                                    <label style={{ fontSize: '12px', fontWeight: '700', color: 'var(--fg-muted)', display: 'block', marginBottom: '6px' }}>
                                        Shop Photo / Thumbnail URL
                                    </label>
                                    <input
                                        type="text"
                                        value={editPhotoUrl}
                                        onChange={e => setEditPhotoUrl(e.target.value)}
                                        placeholder="/shops/print-hub.svg or https://…"
                                        className="input"
                                        style={{ width: '100%', fontSize: '13px' }}
                                    />
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

                                {/* Paper Filter Bar */}
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '10px' }}>
                                    <div style={{ display: 'flex', gap: '6px' }}>
                                        {(['ALL', 'A4', 'A3', 'LEGAL'] as const).map(p => (
                                            <button
                                                key={p}
                                                type="button"
                                                onClick={() => setMatrixFilterPaper(p)}
                                                className="btn btn-sm"
                                                style={{
                                                    fontSize: '11.5px',
                                                    fontWeight: matrixFilterPaper === p ? '800' : '600',
                                                    background: matrixFilterPaper === p ? 'var(--accent)' : 'var(--bg-secondary)',
                                                    color: matrixFilterPaper === p ? '#092b31' : 'var(--fg-muted)',
                                                    border: '1px solid var(--border)',
                                                    borderRadius: '6px',
                                                    padding: '4px 10px',
                                                }}
                                            >
                                                {p === 'ALL' ? 'All Sizes' : p}
                                            </button>
                                        ))}
                                    </div>

                                    <div style={{ display: 'flex', gap: '8px' }}>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                handleUseSamePrice('A4', 'BW');
                                                handleUseSamePrice('A4', 'COLOUR');
                                            }}
                                            className="btn btn-outline btn-sm"
                                            style={{ fontSize: '11.5px', padding: '4px 10px', borderRadius: '6px' }}
                                            title="Sync Double Short Edge price to match Double Long Edge for A4"
                                        >
                                            <Copy size={12} style={{ marginRight: '4px' }} /> Copy Long → Short Edge (A4)
                                        </button>
                                    </div>
                                </div>

                                {/* Matrix Table */}
                                <div style={{ overflowX: 'auto' }}>
                                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                                        <thead>
                                            <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left', color: 'var(--fg-muted)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                                <th style={{ padding: '8px 10px' }}>Paper Size</th>
                                                <th style={{ padding: '8px 10px' }}>Color Mode</th>
                                                <th style={{ padding: '8px 10px' }}>Sides</th>
                                                <th style={{ padding: '8px 10px', textAlign: 'center' }}>Enabled</th>
                                                <th style={{ padding: '8px 10px', textAlign: 'right' }}>Price / Sheet (₹)</th>
                                                <th style={{ padding: '8px 10px', textAlign: 'center' }}>Action</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {matrixRows
                                                .filter(r => matrixFilterPaper === 'ALL' || r.paper_size === matrixFilterPaper)
                                                .map(r => {
                                                    const isShortEdge = r.sides === 'DOUBLE_SHORT_EDGE';
                                                    return (
                                                        <tr key={`${r.paper_size}:${r.print_mode}:${r.sides}`} style={{ borderBottom: '1px solid var(--border)', background: r.active ? 'transparent' : 'rgba(255,255,255,0.01)' }}>
                                                            <td style={{ padding: '10px', fontWeight: '700' }}>
                                                                <span style={{ padding: '2px 8px', borderRadius: '6px', background: 'var(--bg-secondary)', fontSize: '12px' }}>
                                                                    {r.paper_size}
                                                                </span>
                                                            </td>
                                                            <td style={{ padding: '10px' }}>
                                                                <span style={{ fontSize: '12px', fontWeight: '600', color: r.print_mode === 'COLOUR' ? '#38bdf8' : 'var(--fg)' }}>
                                                                    {r.print_mode === 'COLOUR' ? 'Colour' : 'Black & White'}
                                                                </span>
                                                            </td>
                                                            <td style={{ padding: '10px', fontSize: '12.5px' }}>
                                                                {r.sides === 'SINGLE' && 'Single-sided'}
                                                                {r.sides === 'DOUBLE_LONG_EDGE' && 'Double-sided (Long Edge)'}
                                                                {r.sides === 'DOUBLE_SHORT_EDGE' && 'Double-sided (Short Edge)'}
                                                            </td>
                                                            <td style={{ padding: '10px', textAlign: 'center' }}>
                                                                <input
                                                                    type="checkbox"
                                                                    checked={r.active}
                                                                    onChange={() => handleMatrixActiveToggle(r.paper_size, r.print_mode, r.sides)}
                                                                    style={{ cursor: 'pointer', transform: 'scale(1.1)' }}
                                                                />
                                                            </td>
                                                            <td style={{ padding: '10px', textAlign: 'right' }}>
                                                                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                                                    <span style={{ color: 'var(--fg-muted)', fontSize: '12px' }}>₹</span>
                                                                    <input
                                                                        type="number"
                                                                        step="0.25"
                                                                        min="0"
                                                                        value={r.price_per_sheet}
                                                                        onChange={e => handleMatrixPriceChange(r.paper_size, r.print_mode, r.sides, Math.max(0, parseFloat(e.target.value) || 0))}
                                                                        disabled={!r.active}
                                                                        className="input"
                                                                        style={{
                                                                            width: '84px',
                                                                            textAlign: 'right',
                                                                            fontWeight: '800',
                                                                            fontSize: '13px',
                                                                            padding: '4px 8px',
                                                                            opacity: r.active ? 1 : 0.5,
                                                                        }}
                                                                    />
                                                                </div>
                                                            </td>
                                                            <td style={{ padding: '10px', textAlign: 'center' }}>
                                                                {isShortEdge ? (
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => handleUseSamePrice(r.paper_size, r.print_mode)}
                                                                        className="btn btn-outline btn-sm"
                                                                        style={{ fontSize: '11px', padding: '2px 8px' }}
                                                                        title="Use Long Edge price"
                                                                    >
                                                                        Same as Long
                                                                    </button>
                                                                ) : (
                                                                    <span style={{ fontSize: '11px', color: 'var(--fg-muted)' }}>—</span>
                                                                )}
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            {/* Section 6.3 Arithmetic Quote Simulator */}
                            <div className="card" style={{ padding: '20px', borderRadius: '16px', background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
                                    <h3 style={{ fontSize: '15px', fontWeight: '800', margin: 0, color: 'var(--fg)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <Sliders size={16} style={{ color: 'var(--accent)' }} /> Arithmetic Quote Simulator (Section 6.3)
                                    </h3>
                                    <span style={{ fontSize: '11.5px', color: 'var(--fg-muted)' }}>
                                        Exact server-side arithmetic engine simulation
                                    </span>
                                </div>

                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '12px', marginBottom: '16px' }}>
                                    <div>
                                        <label style={{ fontSize: '11.5px', fontWeight: '700', color: 'var(--fg-muted)' }}>Document Pages</label>
                                        <input
                                            type="number"
                                            min={1}
                                            value={simPages}
                                            onChange={e => setSimPages(Math.max(1, parseInt(e.target.value) || 1))}
                                            className="input"
                                            style={{ width: '100%', fontSize: '13px', marginTop: '4px' }}
                                        />
                                    </div>

                                    <div>
                                        <label style={{ fontSize: '11.5px', fontWeight: '700', color: 'var(--fg-muted)' }}>Pages / Side</label>
                                        <select
                                            value={simPagesPerSide}
                                            onChange={e => setSimPagesPerSide(parseInt(e.target.value))}
                                            className="input"
                                            style={{ width: '100%', fontSize: '13px', marginTop: '4px' }}
                                        >
                                            <option value={1}>1 (Standard)</option>
                                            <option value={2}>2-up</option>
                                            <option value={4}>4-up</option>
                                            <option value={6}>6-up</option>
                                            <option value={9}>9-up</option>
                                        </select>
                                    </div>

                                    <div>
                                        <label style={{ fontSize: '11.5px', fontWeight: '700', color: 'var(--fg-muted)' }}>Paper Size</label>
                                        <select
                                            value={simPaperSize}
                                            onChange={e => setSimPaperSize(e.target.value as any)}
                                            className="input"
                                            style={{ width: '100%', fontSize: '13px', marginTop: '4px' }}
                                        >
                                            <option value="A4">A4</option>
                                            <option value="A3">A3</option>
                                            <option value="LEGAL">Legal</option>
                                        </select>
                                    </div>

                                    <div>
                                        <label style={{ fontSize: '11.5px', fontWeight: '700', color: 'var(--fg-muted)' }}>Color Mode</label>
                                        <select
                                            value={simMode}
                                            onChange={e => setSimMode(e.target.value as any)}
                                            className="input"
                                            style={{ width: '100%', fontSize: '13px', marginTop: '4px' }}
                                        >
                                            <option value="BW">Black & White</option>
                                            <option value="COLOUR">Colour</option>
                                        </select>
                                    </div>

                                    <div>
                                        <label style={{ fontSize: '11.5px', fontWeight: '700', color: 'var(--fg-muted)' }}>Sidedness</label>
                                        <select
                                            value={simSides}
                                            onChange={e => setSimSides(e.target.value as any)}
                                            className="input"
                                            style={{ width: '100%', fontSize: '13px', marginTop: '4px' }}
                                        >
                                            <option value="SINGLE">Single-sided</option>
                                            <option value="DOUBLE_LONG_EDGE">Double (Long Edge)</option>
                                            <option value="DOUBLE_SHORT_EDGE">Double (Short Edge)</option>
                                        </select>
                                    </div>

                                    <div>
                                        <label style={{ fontSize: '11.5px', fontWeight: '700', color: 'var(--fg-muted)' }}>Copies</label>
                                        <input
                                            type="number"
                                            min={1}
                                            value={simCopies}
                                            onChange={e => setSimCopies(Math.max(1, parseInt(e.target.value) || 1))}
                                            className="input"
                                            style={{ width: '100%', fontSize: '13px', marginTop: '4px' }}
                                        />
                                    </div>
                                </div>

                                {/* Addons in Simulator */}
                                {addons.length > 0 && (
                                    <div style={{ marginBottom: '16px', padding: '12px 14px', borderRadius: '12px', background: 'var(--bg-secondary)' }}>
                                        <label style={{ fontSize: '12px', fontWeight: '700', color: 'var(--fg)', display: 'block', marginBottom: '8px' }}>
                                            Include Finishing Add-ons in Quote:
                                        </label>
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                                            {addons.map(a => {
                                                const aId = a.id || a.addon_id;
                                                const aName = a.name || a.addons?.name || 'Add-on';
                                                const aPrice = Number(a.price || 0);
                                                const isChecked = simSelectedAddons.includes(aId);
                                                return (
                                                    <label key={aId} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', cursor: 'pointer', background: 'var(--bg-card)', padding: '6px 10px', borderRadius: '8px', border: `1px solid ${isChecked ? 'var(--accent)' : 'var(--border)'}` }}>
                                                        <input
                                                            type="checkbox"
                                                            checked={isChecked}
                                                            onChange={e => {
                                                                if (e.target.checked) setSimSelectedAddons(prev => [...prev, aId]);
                                                                else setSimSelectedAddons(prev => prev.filter(id => id !== aId));
                                                            }}
                                                        />
                                                        <span>{aName} (+₹{aPrice.toFixed(2)})</span>
                                                    </label>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}

                                {/* Simulator Calculation & Breakdown Display */}
                                <div style={{
                                    padding: '16px',
                                    borderRadius: '12px',
                                    background: 'var(--bg-secondary)',
                                    border: '1px solid var(--border)',
                                }}>
                                    {'error' in simResult ? (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#f59e0b', fontSize: '13px', fontWeight: '600' }}>
                                            <AlertCircle size={18} />
                                            <span>{simResult.error}</span>
                                        </div>
                                    ) : (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
                                                <div>
                                                    <div style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--fg-muted)', fontWeight: '700', letterSpacing: '0.04em' }}>
                                                        Imposition & Sheet Arithmetic
                                                    </div>
                                                    <div style={{ fontSize: '13px', color: 'var(--fg)', marginTop: '4px' }}>
                                                        <strong>{simPages}</strong> pages ÷ <strong>{simPagesPerSide}</strong>/side = <strong>{simResult.printedSidesPerCopy}</strong> printed side(s) → <strong>{simResult.sheetsPerCopy}</strong> sheet(s)/copy × <strong>{simCopies}</strong> copies = <strong>{simResult.totalPhysicalSheets}</strong> physical sheet(s)
                                                    </div>
                                                </div>
                                                <div style={{ textAlign: 'right' }}>
                                                    <div style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--fg-muted)', fontWeight: '700' }}>
                                                        Customer Total Quote
                                                    </div>
                                                    <div style={{ fontSize: '24px', fontWeight: '900', color: 'var(--accent)', marginTop: '2px' }}>
                                                        ₹{simResult.totalAmount.toFixed(2)}
                                                    </div>
                                                </div>
                                            </div>

                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '10px', borderTop: '1px solid var(--border)', fontSize: '12px', color: 'var(--fg-muted)', flexWrap: 'wrap', gap: '8px' }}>
                                                <div>
                                                    <span>Printing: <strong>₹{simResult.printingAmount.toFixed(2)}</strong> ({simResult.totalPhysicalSheets} × ₹{simResult.rate})</span>
                                                    {simResult.addonsAmount > 0 && (
                                                        <span style={{ marginLeft: '12px' }}>Add-ons: <strong>+₹{simResult.addonsAmount.toFixed(2)}</strong></span>
                                                    )}
                                                </div>
                                                <div>
                                                    <span>Platform Fee ({simResult.commissionPct}%): <strong>₹{simResult.commissionAmount.toFixed(2)}</strong></span>
                                                    <span style={{ margin: '0 8px' }}>•</span>
                                                    <span style={{ color: '#22c55e', fontWeight: '700' }}>Vendor Net: ₹{simResult.vendorNet.toFixed(2)}</span>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* TAB 4: ADD-ONS */}
                    {activeTab === 'addons' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                            <div className="card" style={{ padding: '20px', borderRadius: '16px', background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
                                    <div>
                                        <h3 style={{ fontSize: '16px', fontWeight: '800', margin: 0, color: 'var(--fg)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <Sparkles size={17} style={{ color: 'var(--accent)' }} /> Assigned Shop Add-ons
                                        </h3>
                                        <p style={{ fontSize: '12px', color: 'var(--fg-muted)', margin: '4px 0 0' }}>
                                            Finishing services offered by this shop with shop-specific pricing and availability.
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
                                                fontSize: '12.5px',
                                                padding: '8px 16px',
                                                display: 'inline-flex',
                                                alignItems: 'center',
                                                gap: '6px',
                                                borderRadius: '8px',
                                            }}
                                        >
                                            <Plus size={14} /> Assign Add-on from Catalogue
                                        </button>
                                        <Link href="/admin/addons" className="btn btn-outline btn-sm" style={{ fontSize: '12px', borderRadius: '8px', padding: '8px 14px' }}>
                                            Global Catalogue →
                                        </Link>
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

                                {/* Assign Add-on Panel */}
                                {assignModalOpen && (
                                    <form onSubmit={handleAssignAddon} style={{ padding: '16px', borderRadius: '12px', background: 'var(--bg-secondary)', border: '1px solid var(--border)', marginBottom: '16px' }}>
                                        <h4 style={{ fontSize: '14px', fontWeight: '800', margin: '0 0 10px', color: 'var(--fg)' }}>
                                            Assign Service from Global Catalogue
                                        </h4>
                                        {availableCatalogue.length === 0 ? (
                                            <p style={{ fontSize: '12.5px', color: 'var(--fg-muted)', margin: 0 }}>
                                                All active catalogue add-ons are already assigned to this shop.
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
                                                        style={{ background: 'var(--accent)', color: '#092b31', fontWeight: '800', fontSize: '12.5px', padding: '8px 16px', borderRadius: '8px' }}
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
                                    </form>
                                )}

                                {addons.length === 0 ? (
                                    <div style={{ padding: '36px 16px', textAlign: 'center', color: 'var(--fg-muted)', fontSize: '13px' }}>
                                        No custom add-ons assigned to this shop yet. Use "Assign Add-on from Catalogue" above to enable finishing services.
                                    </div>
                                ) : (
                                    <div style={{ overflowX: 'auto' }}>
                                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                                            <thead>
                                                <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left', color: 'var(--fg-muted)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                                    <th style={{ padding: '8px 10px' }}>Service Name</th>
                                                    <th style={{ padding: '8px 10px' }}>Prep Time</th>
                                                    <th style={{ padding: '8px 10px' }}>Page Limits</th>
                                                    <th style={{ padding: '8px 10px', textAlign: 'right' }}>Shop Price</th>
                                                    <th style={{ padding: '8px 10px', textAlign: 'center' }}>Availability</th>
                                                    <th style={{ padding: '8px 10px', textAlign: 'center' }}>Action</th>
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

                                                    return (
                                                        <tr key={saId} style={{ borderBottom: '1px solid var(--border)' }}>
                                                            <td style={{ padding: '12px 10px' }}>
                                                                <div style={{ fontWeight: '700', color: 'var(--fg)' }}>{name}</div>
                                                                {desc && <div style={{ fontSize: '11.5px', color: 'var(--fg-muted)', marginTop: '2px' }}>{desc}</div>}
                                                            </td>
                                                            <td style={{ padding: '12px 10px', color: 'var(--fg-muted)', fontSize: '12px' }}>
                                                                {prep > 0 ? `+${prep} mins` : 'Instant'}
                                                            </td>
                                                            <td style={{ padding: '12px 10px', color: 'var(--fg-muted)', fontSize: '12px' }}>
                                                                {min}–{max} pages
                                                            </td>
                                                            <td style={{ padding: '12px 10px', textAlign: 'right', fontWeight: '800', color: 'var(--fg)' }}>
                                                                ₹{price.toFixed(2)}
                                                            </td>
                                                            <td style={{ padding: '12px 10px', textAlign: 'center' }}>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleToggleAddonAvailability(saId, isAvailable)}
                                                                    style={{
                                                                        cursor: 'pointer',
                                                                        border: 'none',
                                                                        fontSize: '11px',
                                                                        fontWeight: '700',
                                                                        padding: '4px 9px',
                                                                        borderRadius: '6px',
                                                                        background: isAvailable ? 'rgba(34, 197, 94, 0.12)' : 'rgba(239, 68, 68, 0.12)',
                                                                        color: isAvailable ? '#22c55e' : 'var(--error)',
                                                                    }}
                                                                >
                                                                    {isAvailable ? '✓ Available' : '✕ Unavailable'}
                                                                </button>
                                                            </td>
                                                            <td style={{ padding: '12px 10px', textAlign: 'center' }}>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleDeleteAddon(saId)}
                                                                    style={{
                                                                        cursor: 'pointer',
                                                                        background: 'none',
                                                                        border: 'none',
                                                                        color: 'var(--error)',
                                                                        padding: '4px',
                                                                    }}
                                                                    title="Remove add-on from this shop"
                                                                >
                                                                    <Trash2 size={15} />
                                                                </button>
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

                            {/* Section 8.1 & 8.2: Interactive Commission Simulator */}
                            <div className="card" style={{ padding: '20px', borderRadius: '16px', background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
                                    <div>
                                        <h3 style={{ fontSize: '15px', fontWeight: '800', margin: 0, color: 'var(--fg)' }}>
                                            Interactive Before / After Calculator (Astraplan Section 8.2)
                                        </h3>
                                        <p style={{ margin: '2px 0 0', fontSize: '12px', color: 'var(--fg-muted)' }}>
                                            Simulates mathematical models and verifies exact rounding invariants before publishing rules.
                                        </p>
                                    </div>
                                    <span style={{ fontSize: '11px', background: 'var(--accent-muted)', color: 'var(--accent)', padding: '3px 8px', borderRadius: '6px', fontWeight: '700' }}>
                                        Section 8.2 Verified
                                    </span>
                                </div>

                                {/* Astraplan Worked Example Presets */}
                                <div style={{ marginBottom: '16px', padding: '12px 14px', borderRadius: '12px', background: 'var(--bg-secondary)' }}>
                                    <div style={{ fontSize: '11.5px', fontWeight: '700', color: 'var(--fg-muted)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                        One-Click Astraplan 8.2 Worked Examples:
                                    </div>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                                        <button
                                            type="button"
                                            onClick={() => loadScenarioPreset(1)}
                                            className="btn btn-outline btn-sm"
                                            style={{ fontSize: '11.5px', borderRadius: '8px' }}
                                        >
                                            Example 1: 10% Revenue (₹4 sale → ₹0.40 fee, ₹3.60 shop)
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => loadScenarioPreset(2)}
                                            className="btn btn-outline btn-sm"
                                            style={{ fontSize: '11.5px', borderRadius: '8px' }}
                                        >
                                            Example 2: 10% Profit (Cost ₹2.40 → ₹0.16 fee, ₹3.84 shop)
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => loadScenarioPreset(3)}
                                            className="btn btn-outline btn-sm"
                                            style={{ fontSize: '11.5px', borderRadius: '8px' }}
                                        >
                                            Example 3: ₹0.25 / Sheet (2 sheets = ₹4 → ₹0.50 fee, ₹3.50 shop)
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => loadScenarioPreset(4)}
                                            className="btn btn-outline btn-sm"
                                            style={{ fontSize: '11.5px', borderRadius: '8px' }}
                                        >
                                            Example 4: Mixed (₹24 sale → ₹1.40 fee, ₹22.60 shop)
                                        </button>
                                    </div>
                                </div>

                                {/* Simulator Inputs */}
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '14px', marginBottom: '16px' }}>
                                    <div>
                                        <label style={{ fontSize: '11.5px', fontWeight: '700', color: 'var(--fg-muted)', display: 'block', marginBottom: '4px' }}>
                                            Calculation Method
                                        </label>
                                        <select
                                            value={commSimMethod}
                                            onChange={e => setCommSimMethod(e.target.value as any)}
                                            className="input"
                                            style={{ width: '100%', fontSize: '13px' }}
                                        >
                                            <option value="REVENUE_PERCENTAGE">Percentage of Revenue</option>
                                            <option value="CONFIGURED_PROFIT_PERCENTAGE">Percentage of Configured Profit</option>
                                            <option value="FIXED_PER_UNIT">Fixed Amount per Unit</option>
                                        </select>
                                    </div>

                                    <div>
                                        <label style={{ fontSize: '11.5px', fontWeight: '700', color: 'var(--fg-muted)', display: 'block', marginBottom: '4px' }}>
                                            Customer Sale Amount (₹)
                                        </label>
                                        <input
                                            type="number"
                                            step="0.1"
                                            min={0}
                                            value={commSimRevenue}
                                            onChange={e => setCommSimRevenue(Math.max(0, parseFloat(e.target.value) || 0))}
                                            className="input"
                                            style={{ width: '100%', fontSize: '13px' }}
                                        />
                                    </div>

                                    <div>
                                        <label style={{ fontSize: '11.5px', fontWeight: '700', color: 'var(--fg-muted)', display: 'block', marginBottom: '4px' }}>
                                            {commSimMethod === 'FIXED_PER_UNIT' ? 'Fixed Fee per Unit (₹)' : 'Commission Percentage (%)'}
                                        </label>
                                        <input
                                            type="number"
                                            step={commSimMethod === 'FIXED_PER_UNIT' ? '0.05' : '0.5'}
                                            min={0}
                                            value={commSimRate}
                                            onChange={e => setCommSimRate(Math.max(0, parseFloat(e.target.value) || 0))}
                                            className="input"
                                            style={{ width: '100%', fontSize: '13px' }}
                                        />
                                    </div>

                                    {commSimMethod === 'CONFIGURED_PROFIT_PERCENTAGE' && (
                                        <div>
                                            <label style={{ fontSize: '11.5px', fontWeight: '700', color: 'var(--fg-muted)', display: 'block', marginBottom: '4px' }}>
                                                Configured Direct Cost Basis (₹)
                                            </label>
                                            <input
                                                type="number"
                                                step="0.1"
                                                min={0}
                                                value={commSimCostBasis}
                                                onChange={e => setCommSimCostBasis(Math.max(0, parseFloat(e.target.value) || 0))}
                                                className="input"
                                                style={{ width: '100%', fontSize: '13px' }}
                                            />
                                        </div>
                                    )}

                                    {commSimMethod === 'FIXED_PER_UNIT' && (
                                        <>
                                            <div>
                                                <label style={{ fontSize: '11.5px', fontWeight: '700', color: 'var(--fg-muted)', display: 'block', marginBottom: '4px' }}>
                                                    Quantity
                                                </label>
                                                <input
                                                    type="number"
                                                    min={1}
                                                    value={commSimQuantity}
                                                    onChange={e => setCommSimQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                                                    className="input"
                                                    style={{ width: '100%', fontSize: '13px' }}
                                                />
                                            </div>
                                            <div>
                                                <label style={{ fontSize: '11.5px', fontWeight: '700', color: 'var(--fg-muted)', display: 'block', marginBottom: '4px' }}>
                                                    Unit Type
                                                </label>
                                                <select
                                                    value={commSimUnit}
                                                    onChange={e => setCommSimUnit(e.target.value as any)}
                                                    className="input"
                                                    style={{ width: '100%', fontSize: '13px' }}
                                                >
                                                    <option value="PHYSICAL_SHEET">Physical Sheet</option>
                                                    <option value="PRINTED_SIDE">Printed Side</option>
                                                    <option value="DOCUMENT_PAGE">Document Page</option>
                                                    <option value="SERVICE_UNIT">Service Unit / Item</option>
                                                </select>
                                            </div>
                                        </>
                                    )}
                                </div>

                                {/* Simulator Calculation Results Display */}
                                {(() => {
                                    const calc = calculateCommSimQuote();
                                    return (
                                        <div style={{ padding: '16px', borderRadius: '12px', background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '12px' }}>
                                                <div>
                                                    <div style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--fg-muted)', fontWeight: '700' }}>
                                                        Mathematical Calculation Formula
                                                    </div>
                                                    <div style={{ fontSize: '13px', fontWeight: '700', color: 'var(--fg)', marginTop: '2px' }}>
                                                        {calc.formula}
                                                    </div>
                                                </div>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', background: 'rgba(34, 197, 94, 0.15)', color: '#22c55e', padding: '3px 8px', borderRadius: '6px', fontWeight: '700' }}>
                                                    <CheckCircle2 size={13} />
                                                    <span>Gross (₹{calc.revenue.toFixed(2)}) = Fee (₹{calc.fee.toFixed(2)}) + Net (₹{calc.shopNet.toFixed(2)})</span>
                                                </div>
                                            </div>

                                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '10px' }}>
                                                <div style={{ padding: '10px 14px', borderRadius: '10px', background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                                                    <div style={{ fontSize: '11px', color: 'var(--fg-muted)', fontWeight: '700' }}>Customer Gross</div>
                                                    <div style={{ fontSize: '18px', fontWeight: '800', color: 'var(--fg)' }}>₹{calc.revenue.toFixed(2)}</div>
                                                </div>
                                                <div style={{ padding: '10px 14px', borderRadius: '10px', background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                                                    <div style={{ fontSize: '11px', color: 'var(--fg-muted)', fontWeight: '700' }}>XerService Platform Fee</div>
                                                    <div style={{ fontSize: '18px', fontWeight: '800', color: 'var(--accent)' }}>₹{calc.fee.toFixed(2)}</div>
                                                </div>
                                                <div style={{ padding: '10px 14px', borderRadius: '10px', background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                                                    <div style={{ fontSize: '11px', color: 'var(--fg-muted)', fontWeight: '700' }}>Shop Net Earnings</div>
                                                    <div style={{ fontSize: '18px', fontWeight: '800', color: '#22c55e' }}>₹{calc.shopNet.toFixed(2)}</div>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })()}
                            </div>

                            {/* Section 8.1: Publish / Adjust Commission Rule Form */}
                            <div className="card" style={{ padding: '20px', borderRadius: '16px', background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                                <h3 style={{ fontSize: '15px', fontWeight: '800', margin: '0 0 6px', color: 'var(--fg)' }}>
                                    Publish New Commission Policy
                                </h3>
                                <p style={{ margin: '0 0 16px', fontSize: '12px', color: 'var(--fg-muted)' }}>
                                    Creates a versioned rule for this shop. Overlapping active dates are automatically prevented.
                                </p>

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

                                <form onSubmit={handleCreateRule}>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '14px', marginBottom: '16px' }}>
                                        <div>
                                            <label style={{ fontSize: '11.5px', fontWeight: '700', color: 'var(--fg-muted)', display: 'block', marginBottom: '4px' }}>
                                                Commission Rate (%)
                                            </label>
                                            <input
                                                type="number"
                                                step="0.01"
                                                min={0}
                                                max={100}
                                                required
                                                value={newRuleRate}
                                                onChange={e => setNewRuleRate(e.target.value)}
                                                className="input"
                                                style={{ width: '100%', fontSize: '13px' }}
                                            />
                                        </div>

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

                                    <div style={{ marginBottom: '16px' }}>
                                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12.5px', color: 'var(--fg)', cursor: 'pointer' }}>
                                            <input
                                                type="checkbox"
                                                checked={newRuleClosePrevious}
                                                onChange={e => setNewRuleClosePrevious(e.target.checked)}
                                            />
                                            <span>Safely close previous active rule at Effective From date (prevents overlap conflict)</span>
                                        </label>
                                    </div>

                                    <button
                                        type="submit"
                                        disabled={creatingRule}
                                        className="btn"
                                        style={{ background: 'var(--accent)', color: '#092b31', fontWeight: '800', fontSize: '13px', padding: '9px 20px', borderRadius: '8px' }}
                                    >
                                        {creatingRule ? 'Publishing Policy…' : 'Publish Commission Policy'}
                                    </button>
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

                    {/* TAB 6: ORDERS & MONEY */}
                    {activeTab === 'finance' && (
                        <div className="card" style={{ padding: '20px', borderRadius: '16px', background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                                <h3 style={{ fontSize: '16px', fontWeight: '800', margin: 0, color: 'var(--fg)' }}>
                                    Financial Ledger & Settlements
                                </h3>
                                <Link href="/admin/settlements" className="btn btn-outline btn-sm" style={{ fontSize: '12px' }}>
                                    View Platform Settlements →
                                </Link>
                            </div>

                            {ledgers.length === 0 ? (
                                <div style={{ padding: '36px 16px', textAlign: 'center', color: 'var(--fg-muted)', fontSize: '13px' }}>
                                    No financial ledger entries for this shop yet.
                                </div>
                            ) : (
                                <div style={{ overflowX: 'auto' }}>
                                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                                        <thead>
                                            <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left', color: 'var(--fg-muted)', fontSize: '11.5px', textTransform: 'uppercase' }}>
                                                <th style={{ padding: '10px 12px' }}>Order #</th>
                                                <th style={{ padding: '10px 12px' }}>Date</th>
                                                <th style={{ padding: '10px 12px', textAlign: 'right' }}>Gross Sales</th>
                                                <th style={{ padding: '10px 12px', textAlign: 'right' }}>Fee Amount</th>
                                                <th style={{ padding: '10px 12px', textAlign: 'right' }}>Vendor Net</th>
                                                <th style={{ padding: '10px 12px', textAlign: 'center' }}>Settlement State</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {ledgers.map(l => (
                                                <tr key={l.id} style={{ borderBottom: '1px solid var(--border)' }}>
                                                    <td style={{ padding: '12px', fontWeight: '700', fontFamily: 'monospace' }}>{l.orderNumber}</td>
                                                    <td style={{ padding: '12px', color: 'var(--fg-muted)', fontSize: '12px' }}>
                                                        {new Date(l.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                                                    </td>
                                                    <td style={{ padding: '12px', textAlign: 'right' }}>₹{l.grossAmount.toFixed(2)}</td>
                                                    <td style={{ padding: '12px', textAlign: 'right', color: 'var(--accent)' }}>
                                                        ₹{(l.platformCommissionAmount || 0).toFixed(2)}
                                                    </td>
                                                    <td style={{ padding: '12px', textAlign: 'right', fontWeight: '800', color: '#22c55e' }}>
                                                        ₹{(l.vendorNetAmount || 0).toFixed(2)}
                                                    </td>
                                                    <td style={{ padding: '12px', textAlign: 'center' }}>
                                                        <span style={{ fontSize: '11px', fontWeight: '700', padding: '2px 7px', borderRadius: '6px', background: l.financialStatus === 'SETTLED' ? 'rgba(34, 197, 94, 0.12)' : 'rgba(234, 179, 8, 0.12)', color: l.financialStatus === 'SETTLED' ? '#22c55e' : '#eab308' }}>
                                                            {l.financialStatus}
                                                        </span>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
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
        </div>
    );
}

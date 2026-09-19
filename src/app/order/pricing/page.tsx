'use client';
import { useReconnectRefresh } from '@/hooks/useReconnectRefresh';
import { notify } from '@/components/ui/Feedback';

import { useEffect, useRef, useState, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useApp } from '@/context/AppContext';
import Link from 'next/link';
import {
    ArrowLeft,
    CheckCircle2,
    Clock3,
    Coins,
    Download,
    FileText,
    Layers,
    Plus,
    Lock,
    RefreshCw,
    Settings2,
    ShieldCheck,
    ShoppingCart,
    Smartphone,
    Sparkles,
    Store,
    Zap,
    AlertCircle,
    Loader2
} from 'lucide-react';
import LivePrintPreview from '@/components/pdf/LivePrintPreview';
import PrintSettingsModal from '@/components/order/PrintSettingsModal';
import { OrderStatusChat } from '@/components/order/OrderStatusChat';
import { documentPrintTotals, summarizePrintDocuments, type PrintDocument } from '@/lib/print-order';
import { fromDbPrintSettings, toDbPrintSettings, type PrintSettings } from '@/lib/print-settings';
import { supabase } from '@/lib/supabase/client';
import {
    saveLocalOrderDraft,
    getLocalOrderDraft,
    clearLocalOrderDraft,
    evaluateDraftState,
    evaluatePaymentRetrySafety,
    type OrderDraft,
} from '@/lib/recovery';
import { parseShopProfileMetadata } from '@/lib/shop-profile';
import styles from './review-pay.module.css';

interface AuthoritativeQuote {
    orderId: string;
    orderNumber: string;
    status: string;
    totalOriginalPages: number;
    totalPrintablePages: number;
    totalSheets: number;
    printingSubtotal?: number;
    addonsSubtotal?: number;
    totalAmount: number;
    estimatedExtraMinutes?: number;
    files?: Array<{
        orderFileId: string;
        originalPages: number;
        selectedPages: number;
        printablePages: number;
        physicalSheets: number;
        unitPrice: number;
        lineTotal: number;
        addons?: Array<{
            shopAddonId: string;
            addonName: string;
            unitPrice: number;
            quantity: number;
            totalPrice: number;
        }>;
    }>;
}

interface DbOrderDetails {
    id: string;
    orderNumber: string;
    shopId?: string;
    shopName: string;
    shopAddress?: string;
    status: string;
    totalAmount: number;
    files: Array<{
        id: string;
        filename: string;
        printablePages: number;
        physicalSheets: number;
        unitPrice: number;
        lineTotal: number;
        settings: {
            colourMode?: string;
            sides?: string;
            copies?: number;
            paperSize?: string;
            orientation?: string;
        };
        addons: Array<{
            id: string;
            name: string;
            price: number;
            quantity: number;
            total: number;
        }>;
    }>;
}

const EMPTY_DOCUMENTS: PrintDocument[] = [];

type PaymentStep = 'select' | 'opening' | 'verifying' | 'success' | 'cancelled' | 'failed';

let razorpayScriptPromise: Promise<boolean> | null = null;
function loadRazorpayScript(): Promise<boolean> {
    if (typeof window === 'undefined') return Promise.resolve(false);
    if ((window as any).Razorpay) return Promise.resolve(true);
    if (razorpayScriptPromise) return razorpayScriptPromise;
    razorpayScriptPromise = new Promise(resolve => {
        const script = document.createElement('script');
        const finish = (ok: boolean) => {
            clearTimeout(timeout);
            script.onload = null; script.onerror = null;
            if (!ok) { script.remove(); razorpayScriptPromise = null; }
            resolve(ok);
        };
        const timeout = window.setTimeout(() => finish(false), 15000);
        script.src = 'https://checkout.razorpay.com/v1/checkout.js';
        script.async = true;
        script.onload = () => finish(Boolean((window as any).Razorpay));
        script.onerror = () => finish(false);
        document.body.appendChild(script);
    });
    return razorpayScriptPromise;
}

function ReviewAndPayPageContent() {
    const {
        currentOrder,
        setCurrentOrder,
        cart,
        addToCart,
        removeFromCart,
        user,
        isLoggedIn,
        isLoading,
        authInitialized,
        refreshWallet,
        refreshOrders,
        setLastOrderId
    } = useApp();

    const router = useRouter();
    const params = useSearchParams();

    // Fallback: If targetOrderId is not in params or currentOrder, auto-resolve user's latest active draft/order
    const [resolvedOrderId, setResolvedOrderId] = useState<string | null>(null);
    const targetOrderId = params.get('order') || currentOrder.orderId || resolvedOrderId;

    // Document Selection & Editing
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [editing, setEditing] = useState(false);
    const [editError, setEditError] = useState('');
    const autoEdited = useRef(false);

    // Downloaded file cache for restoring LivePrintPreview on direct link / reload
    const [restoredFiles, setRestoredFiles] = useState<Record<string, File>>({});
    const downloadingRef = useRef<Set<string>>(new Set());
    const [downloadingFile, setDownloadingFile] = useState(false);

    // Authoritative Server Quote States
    const [quoteLoading, setQuoteLoading] = useState(false);
    const [quoteError, setQuoteError] = useState<string | null>(null);
    const [authoritativeQuote, setAuthoritativeQuote] = useState<AuthoritativeQuote | null>(null);

    // Enriched Database Details (Fallback & Sync)
    const [dbOrder, setDbOrder] = useState<DbOrderDetails | null>(null);

    // Payment States
    const [method, setMethod] = useState<'upi' | 'wallet'>('upi');
    const [step, setStep] = useState<PaymentStep>('select');
    const [paymentError, setPaymentError] = useState<string | null>(null);
    const [isSubmitting, updateSubmitting] = useState(false);
    const paymentInFlight = useRef(false);
    const setIsSubmitting = (value: boolean) => { paymentInFlight.current = value; updateSubmitting(value); };
    const [paymentPending, setPaymentPending] = useState(false);
    const paymentConfirming = useRef(false);
    const [successOrderId, setSuccessOrderId] = useState<string | null>(null);
    const [receiptAvailable, setReceiptAvailable] = useState(false);
    const [downloadingReceipt, setDownloadingReceipt] = useState(false);
    const [addedToCart, setAddedToCart] = useState(false);

    // Preload Razorpay Checkout Script


    const pendingKey = targetOrderId ? `xer_payment_pending:${targetOrderId}` : '';
    useEffect(() => {
        try { setPaymentPending(Boolean(pendingKey && sessionStorage.getItem(pendingKey))); } catch {}
    }, [pendingKey]);
    const rememberPending = () => {
        setPaymentPending(true);
        try { if (pendingKey) sessionStorage.setItem(pendingKey, '1'); } catch {}
    };
    const checkPaymentStatus = async () => {
        if (!targetOrderId) return;
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        const response = await fetch(`/api/orders/${targetOrderId}/payment/status`, { headers: { Authorization: `Bearer ${session.access_token}` } });
        if (!response.ok) return;
        const data = await response.json();
        if (data.paymentStatus === 'PAID' || data.safeToRetry) {
            setPaymentPending(false);
            try { sessionStorage.removeItem(pendingKey); } catch {}
            if (data.paymentStatus === 'PAID') { setSuccessOrderId(data.orderNumber); setStep('success'); }
            else { setStep('select'); setPaymentError(null); }
        }
    };
    useReconnectRefresh(checkPaymentStatus, paymentPending, 10_000);

    // Documents from AppContext
    const documents = currentOrder.documents || EMPTY_DOCUMENTS;
    const selectedDocument = documents[selectedIndex] || documents[0];

    // Determine actual File object (from memory or restored blob)
    const activeFileId = selectedDocument?.id || dbOrder?.files[selectedIndex]?.id || dbOrder?.files[0]?.id;
    const actualFile = (typeof File !== 'undefined' && selectedDocument?.file instanceof File)
        ? selectedDocument.file
        : (activeFileId && restoredFiles[activeFileId] ? restoredFiles[activeFileId] : null);

    const activeShopId = currentOrder.shopId || dbOrder?.shopId;
    const uploadUrl = activeShopId
        ? `/order/upload?shop=${activeShopId}${targetOrderId ? `&order=${targetOrderId}` : ''}&resume=1`
        : '/#shops';

    // Safe Recovery: Auto-save configuration draft when documents change
    useEffect(() => {
        if (documents.length > 0 && activeShopId) {
            saveLocalOrderDraft({
                draftId: `draft-${activeShopId}`,
                shopId: activeShopId,
                shopName: currentOrder.shopName || dbOrder?.shopName,
                files: documents.map(d => ({
                    id: d.id,
                    originalFilename: d.name || d.file?.name || 'document.pdf',
                    fileSizeBytes: d.file?.size || d.fileSizeBytes || 0,
                    mimeType: d.file?.type || d.mimeType || 'application/pdf',
                    pageCount: d.pages || 1,
                    printSettings: {
                        copies: d.settings?.copies || 1,
                        colourMode: d.settings?.color === 'color' ? 'colour' : 'bw',
                        sides: d.settings?.sides === 'double_short' ? 'double_short' : (d.settings?.sides === 'double_long' ? 'double_long' : 'single'),
                        paperSize: d.settings?.paperSize || 'a4',
                        orientation: d.settings?.orientation || 'portrait',
                        pageRange: d.settings?.pageRange || 'all',
                        customRange: d.settings?.customRange || '',
                    },
                    finishingAddonIds: [],
                })),
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                expiresAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
            });
        }
    }, [documents, activeShopId, currentOrder.shopName, dbOrder?.shopName]);

    // Load full order details and breakdown from database
    const loadOrderFromDb = useCallback(async () => {
        if (!targetOrderId) return;
        try {
            const { data: orderData, error } = await supabase
                .from('orders')
                .select(`
                    id, order_number, shop_id, total_amount, status, payment_status, expires_at,
                    shops (id, name, description),
                    order_files (
                        id, original_filename, original_pages, printable_pages, physical_sheets, unit_price, line_total,
                        print_settings (*)
                    ),
                    order_file_addons (
                        id, order_file_id, shop_addon_id, addon_name_snapshot, unit_price_snapshot, quantity, total_price
                    )
                `)
                .eq('id', targetOrderId)
                .maybeSingle();

            if (!error && orderData) {
                const rawFiles = (orderData.order_files || []) as any[];
                const rawAddons = (orderData.order_file_addons || []) as any[];
                const shopInfo = (orderData.shops as any) || null;

                const parsedFiles = rawFiles.map((f: any) => {
                    const matchedAddons = rawAddons
                        .filter((a: any) => a.order_file_id === f.id)
                        .map((a: any) => ({
                            id: a.id,
                            name: a.addon_name_snapshot || 'Print Add-on',
                            price: Number(a.unit_price_snapshot || 0),
                            quantity: Number(a.quantity || 1),
                            total: Number(a.total_price || 0),
                        }));

                    const rawSettings = Array.isArray(f.print_settings) ? f.print_settings[0] : f.print_settings;

                    return {
                        id: f.id,
                        filename: f.original_filename,
                        printablePages: f.printable_pages,
                        physicalSheets: f.physical_sheets,
                        unitPrice: Number(f.unit_price || 0),
                        lineTotal: Number(f.line_total || 0),
                        settings: {
                            colourMode: rawSettings?.colour_mode,
                            sides: rawSettings?.sides,
                            copies: rawSettings?.copies,
                            paperSize: rawSettings?.paper_size,
                            orientation: rawSettings?.orientation,
                        },
                        addons: matchedAddons,
                    };
                });

                const restoredDocuments: PrintDocument[] = rawFiles.map((file: any) => ({
                    id: file.id, name: file.original_filename, pages: file.original_pages,
                    settings: { ...fromDbPrintSettings(Array.isArray(file.print_settings) ? file.print_settings[0] : file.print_settings || {}), addonIds: rawAddons.filter(addon => addon.order_file_id === file.id).map(addon => addon.shop_addon_id) },
                }));
                setCurrentOrder(previous => previous.orderId === orderData.id && previous.documents?.length ? previous : {
                    ...previous, orderId: orderData.id, orderNumber: orderData.order_number,
                    shopId: orderData.shop_id, shopName: shopInfo?.name || 'Print Shop',
                    documents: restoredDocuments,
                });
                if (orderData.payment_status === 'PAID') {
                    setPaymentPending(false);
                    try { sessionStorage.removeItem(`xer_payment_pending:${orderData.id}`); } catch {}
                    setSuccessOrderId(orderData.order_number);
                    setStep('success'); setIsSubmitting(false);
                }
                setDbOrder({
                    id: orderData.id,
                    orderNumber: orderData.order_number,
                    shopId: orderData.shop_id,
                    shopName: shopInfo?.name || 'Print Shop',
                    shopAddress: (shopInfo?.description ? parseShopProfileMetadata(shopInfo.description).address : null) || undefined,
                    status: orderData.status,
                    totalAmount: Number(orderData.total_amount || 0),
                    files: parsedFiles,
                });
            }
        } catch (err) {
            console.warn('[ReviewAndPay] Error loading order from DB:', err);
        }
    }, [targetOrderId, setCurrentOrder]);

    useReconnectRefresh(loadOrderFromDb, Boolean(targetOrderId) && user?.type === 'customer', 15_000);

    // Authoritative Server Quote Calculation
    const loadAuthoritativeQuote = useCallback(async (customDocs?: PrintDocument[]) => {
        if (!targetOrderId) return;
        setQuoteLoading(true);
        setQuoteError(null);

        try {
            const { data: sessionData } = await supabase.auth.getSession();
            const token = sessionData?.session?.access_token;
            if (!token) {
                setQuoteError('Please sign in to view authoritative order pricing.');
                setQuoteLoading(false);
                return;
            }

            const docsToQuote = customDocs || documents;
            const fileAddons = docsToQuote
                .filter(d => Boolean(d.id))
                .map(d => ({
                    orderFileId: d.id,
                    addons: (d.settings?.addonIds || []).map(id => ({ shopAddonId: id, quantity: 1 })),
                }));

            const res = await fetch(`/api/orders/${targetOrderId}/quote`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(docsToQuote.length ? { fileAddons } : {}),
            });

            const json = await res.json();
            if (!res.ok) {
                if (json.error && json.error.includes('AWAITING_PAYMENT')) {
                    // The order quote is already finalized and authoritative in the database
                    setQuoteError(null);
                } else {
                    setQuoteError(json.error || 'Failed to calculate pricing quote.');
                    setAuthoritativeQuote(null);
                }
            } else {
                setAuthoritativeQuote(json);
                setQuoteError(null);
                setCurrentOrder(prev => ({
                    ...prev,
                    orderId: json.orderId,
                    orderNumber: json.orderNumber,
                    totalAmount: json.totalAmount,
                    pages: json.totalOriginalPages,
                    totalEstimatedPages: json.totalPrintablePages,
                }));
            }
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            setQuoteError(`Network error while fetching quote: ${msg}`);
            setAuthoritativeQuote(null);
        } finally {
            setQuoteLoading(false);
        }
    }, [targetOrderId, documents, setCurrentOrder]);

    // Sync browser URL to keep ?order=... present on page refresh
    useEffect(() => {
        if (targetOrderId && typeof window !== 'undefined' && !params.get('order')) {
            const newUrl = `/order/pricing?order=${targetOrderId}`;
            window.history.replaceState({ ...window.history.state, as: newUrl, url: newUrl }, '', newUrl);
        }
    }, [targetOrderId, params]);

    // Query user's latest active draft or awaiting payment order if none specified
    useEffect(() => {
        if (targetOrderId || !isLoggedIn) return;
        void (async () => {
            try {
                const { data: { user: currentUser } } = await supabase.auth.getUser();
                if (!currentUser) return;
                const { data } = await supabase
                    .from('orders')
                    .select('id')
                    .eq('user_id', currentUser.id)
                    .in('status', ['DRAFT', 'AWAITING_PAYMENT'])
                    .order('created_at', { ascending: false })
                    .limit(1)
                    .maybeSingle();
                if (data?.id) {
                    setResolvedOrderId(data.id);
                }
            } catch (err) {
                console.warn('[ReviewAndPay] Error resolving latest active order:', err);
            }
        })();
    }, [targetOrderId, isLoggedIn]);

    // Restore PDF File object from server if missing in memory
    useEffect(() => {
        if (actualFile || !targetOrderId) return;

        const targetFileId = selectedDocument?.id || dbOrder?.files[selectedIndex]?.id || dbOrder?.files[0]?.id;
        if (!targetFileId || restoredFiles[targetFileId] || downloadingRef.current.has(targetFileId)) return;

        downloadingRef.current.add(targetFileId);
        setDownloadingFile(true);

        let mounted = true;
        void (async () => {
            try {
                const { data: sessionData } = await supabase.auth.getSession();
                const token = sessionData?.session?.access_token;
                const res = await fetch(`/api/customer/orders/${targetOrderId}/files/${targetFileId}/download`, {
                    headers: token ? { Authorization: `Bearer ${token}` } : {},
                });
                if (res.ok && mounted) {
                    const { downloadUrl } = await res.json();
                    if (!downloadUrl) throw new Error('Document download is unavailable.');
                    const download = await fetch(downloadUrl);
                    if (!download.ok) throw new Error('Document download failed.');
                    const blob = await download.blob();
                    const filename = selectedDocument?.name || dbOrder?.files[selectedIndex]?.filename || dbOrder?.files[0]?.filename || 'document.pdf';
                    const fileObj = new File([blob], filename, { type: blob.type || 'application/pdf' });
                    setRestoredFiles(prev => ({ ...prev, [targetFileId]: fileObj }));
                }
            } catch (err) {
                notify('The preview could not be loaded. Check your connection and reopen the document.');
            } finally {
                downloadingRef.current.delete(targetFileId);
                if (mounted) setDownloadingFile(false);
            }
        })();

        return () => { mounted = false; };
    }, [actualFile, targetOrderId, selectedDocument?.id, selectedDocument?.name, dbOrder?.files, selectedIndex, restoredFiles]);

    // Authentication Guard
    useEffect(() => {
        if (!authInitialized || isLoading) return;
        if (!isLoggedIn) {
            const currentSearch = params.toString() ? `?${params.toString()}` : '';
            router.push(`/login?redirect=${encodeURIComponent(`/order/pricing${currentSearch}`)}`);
        }
    }, [isLoggedIn, isLoading, authInitialized, router, params]);

    // Initial Data Fetch
    useEffect(() => {
        if (isLoggedIn && targetOrderId) {
            loadOrderFromDb();
            loadAuthoritativeQuote();
        }
    }, [isLoggedIn, targetOrderId, loadAuthoritativeQuote, loadOrderFromDb]);

    // Auto-open print settings modal if requested via URL (?edit=1)
    useEffect(() => {
        if (params.get('edit') === '1' && actualFile && !autoEdited.current) {
            autoEdited.current = true;
            setEditing(true);
        }
    }, [params, actualFile]);

    // Save Print Settings from Modal
    const saveSettings = async (settings: PrintSettings, applyAll: boolean) => {
        const next: PrintDocument[] = documents.map(document =>
            applyAll || document.id === selectedDocument?.id ? { ...document, settings: { ...settings } } : document
        );
        if (next.some(document => documentPrintTotals(document).faces === 0)) {
            setEditError('The page range must be valid for every selected document.');
            return false;
        }

        try {
            const dbSettings = toDbPrintSettings(settings);
            const targetFileDbIds = applyAll
                ? documents.map(d => d.id).filter(Boolean)
                : [selectedDocument?.id].filter(Boolean);

            if (targetFileDbIds.length > 0) {
                const { data, error } = await supabase
                    .from('print_settings')
                    .update(dbSettings)
                    .in('order_file_id', targetFileDbIds)
                    .select('order_file_id');
                if (error || data?.length !== targetFileDbIds.length) throw new Error('Your settings could not be saved. Check your connection and try again.');
            }
        } catch (err) {
            setEditError(err instanceof Error ? err.message : 'Settings could not be saved.');
            return false;
        }

        setCurrentOrder(previous => ({ ...previous, ...summarizePrintDocuments(next) }));
        setAddedToCart(false);
        setEditing(false);
        setEditError('');

        // Recalculate authoritative quote from server with updated settings
        loadAuthoritativeQuote(next);
        loadOrderFromDb();
        return true;
    };

    // Check receipt availability on success
    useEffect(() => {
        if (step !== 'success' || !targetOrderId) return;
        let isCancelled = false;
        async function checkReceipt() {
            try {
                const res = await fetch(`/api/customer/orders/${targetOrderId}/receipt`);
                if (!isCancelled && res.ok) {
                    setReceiptAvailable(true);
                }
            } catch (err) {
                console.warn('[Receipt] Status check notice:', err);
            }
        }
        checkReceipt();
        return () => { isCancelled = true; };
    }, [step, targetOrderId]);

    // Download PDF Receipt
    const handleDownloadReceipt = async () => {
        if (!targetOrderId || downloadingReceipt) return;
        setDownloadingReceipt(true);
        try {
            const res = await fetch(`/api/customer/orders/${targetOrderId}/receipt?format=pdf`);
            if (!res.ok) {
                const json = await res.json().catch(() => ({}));
                notify(json.error || 'Receipt PDF not yet ready. Please try again.');
                return;
            }
            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `receipt-${targetOrderId}.pdf`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
        } catch (err) {
            console.error('[Receipt] Download error:', err);
            notify('Failed to download receipt.');
        } finally {
            setDownloadingReceipt(false);
        }
    };

    // Derived Authoritative Amounts
    const price = authoritativeQuote
        ? authoritativeQuote.totalAmount
        : (dbOrder?.totalAmount || currentOrder.totalAmount || 0);

    const printingCharges = authoritativeQuote?.printingSubtotal !== undefined
        ? authoritativeQuote.printingSubtotal
        : (dbOrder?.files.reduce((sum, f) => sum + f.lineTotal, 0) || (documents.length ? documents.reduce((sum, d) => sum + documentPrintTotals(d).amount, 0) : price));

    const addonsTotal = authoritativeQuote?.addonsSubtotal !== undefined
        ? authoritativeQuote.addonsSubtotal
        : (dbOrder?.files.reduce((sum, f) => sum + f.addons.reduce((aSum, a) => aSum + a.total, 0), 0) || 0);

    const sheets = authoritativeQuote
        ? authoritativeQuote.totalSheets
        : (dbOrder?.files.reduce((sum, f) => sum + f.physicalSheets, 0) || documents.reduce((sum, d) => sum + documentPrintTotals(d).sheets, 0));

    const effectivePages = Math.max(1, (currentOrder.pages || 1) * (currentOrder.copies || 1));
    const estimatedPages = authoritativeQuote
        ? authoritativeQuote.totalPrintablePages
        : (dbOrder?.files.reduce((sum, f) => sum + f.printablePages, 0) || currentOrder.totalEstimatedPages || effectivePages);

    // Multi-file Details
    const hasMultipleFiles = documents.length > 1 || (dbOrder?.files.length || 0) > 1;
    const fileCount = documents.length || dbOrder?.files.length || 1;

    // Display Labels
    const shopDisplayName = dbOrder?.shopName || currentOrder.shopName || 'Print Shop';
    const orderDisplayNumber = dbOrder?.orderNumber || authoritativeQuote?.orderNumber || currentOrder.orderNumber || (targetOrderId ? `#${targetOrderId.slice(0, 8)}` : '');

    // Active Print Settings for selected document
    const activeSettings = selectedDocument?.settings || {
        color: (dbOrder?.files[selectedIndex]?.settings?.colourMode as any) || 'bw',
        sides: (dbOrder?.files[selectedIndex]?.settings?.sides as any) || 'single',
        copies: dbOrder?.files[selectedIndex]?.settings?.copies || currentOrder.copies || 1,
        orientation: (dbOrder?.files[selectedIndex]?.settings?.orientation as any) || currentOrder.orientation || 'portrait',
        paperSize: dbOrder?.files[selectedIndex]?.settings?.paperSize || 'a4',
        pageRange: 'all',
    };

    // Itemized Add-ons List across files
    const allItemizedAddons: Array<{ name: string; quantity: number; price: number; total: number }> = [];
    if (authoritativeQuote?.files) {
        for (const file of authoritativeQuote.files) {
            if (file.addons) {
                for (const a of file.addons) {
                    allItemizedAddons.push({
                        name: a.addonName,
                        quantity: a.quantity,
                        price: a.unitPrice,
                        total: a.totalPrice,
                    });
                }
            }
        }
    } else if (dbOrder?.files) {
        for (const file of dbOrder.files) {
            for (const a of file.addons) {
                allItemizedAddons.push({
                    name: a.name,
                    quantity: a.quantity,
                    price: a.price,
                    total: a.total,
                });
            }
        }
    }

    // Wallet Status
    const xerCoinsBalance = user?.xerCoins ?? 0;
    const canPayWallet = xerCoinsBalance >= price && price > 0;

    const isOrderReady = Boolean(
        targetOrderId &&
        price > 0 &&
        !quoteLoading &&
        !quoteError
    );

    // Save to Cart
    const addCurrentOrderToCart = () => {
        if (!isOrderReady) return;
        const fileNamesList = currentOrder.files && currentOrder.files.length > 0
            ? currentOrder.files.map(f => f.name)
            : [currentOrder.fileName || selectedDocument?.name || 'Document'];

        const originalIndex = currentOrder.editingCartCreatedAt
            ? cart.findIndex(item => item.createdAt === currentOrder.editingCartCreatedAt && item.shopId === currentOrder.shopId)
            : -1;
        const originalItem = cart[originalIndex];
        if (originalIndex !== -1) removeFromCart(originalIndex);

        addToCart({
            orderId: targetOrderId || undefined,
            orderNumber: orderDisplayNumber,
            documents,
            shopId: currentOrder.shopId,
            shopName: shopDisplayName,
            fileName: currentOrder.fileName || selectedDocument?.name || 'Document',
            fileNames: fileNamesList,
            pages: currentOrder.pages,
            color: currentOrder.color,
            sides: currentOrder.sides,
            orientation: currentOrder.orientation,
            copies: currentOrder.copies,
            totalAmount: price,
            createdAt: originalItem?.createdAt || new Date().toISOString(),
            source: originalItem?.source || 'upload',
        });
        setCurrentOrder(previous => ({ ...previous, editingCartCreatedAt: undefined }));
        setAddedToCart(true);
    };

    // Authoritative Payment Execution
    const handlePay = async () => {
        if (!isOrderReady || paymentInFlight.current || paymentPending) return;

        // Fail-Closed Payment Retry Protection
        const safety = evaluatePaymentRetrySafety({
            orderId: targetOrderId || '',
            orderStatus: authoritativeQuote?.status || dbOrder?.status || 'pending',
            paymentStatus: dbOrder?.status === 'PAID' ? 'paid' : (paymentPending ? 'pending' : 'pending'),
            hasActiveLedgerRow: dbOrder?.status === 'PAID',
        });

        if (safety.isRetryBlocked) {
            setPaymentError(safety.userMessage);
            setIsSubmitting(false);
            if (safety.safetyState === 'ALREADY_CAPTURED') {
                clearLocalOrderDraft();
                setStep('success');
            } else {
                setStep('failed');
            }
            return;
        }

        setPaymentError(null);
        paymentConfirming.current = false;
        setIsSubmitting(true);
        setStep('opening');

        try {
            const { data: sessionData } = await supabase.auth.getSession();
            const token = sessionData?.session?.access_token;
            if (!token) {
                setPaymentError('Authentication session expired. Please sign in again.');
                setIsSubmitting(false);
                setStep('failed');
                return;
            }

            // Wallet Payment
            if (method === 'wallet') {
                const walletRes = await fetch(`/api/orders/${targetOrderId}/payment/wallet`, {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                });

                const walletData = await walletRes.json();
                if (!walletRes.ok) {
                    setPaymentError(walletData.error || 'Wallet payment failed.');
                    setIsSubmitting(false);
                    setStep('failed');
                    return;
                }

                await refreshWallet();
                await refreshOrders();
                const confirmedOrderNumber = walletData.orderNumber || orderDisplayNumber || targetOrderId;
                setSuccessOrderId(confirmedOrderNumber);
                setLastOrderId(targetOrderId || '');
                setCurrentOrder(prev => ({ ...prev, paymentMethod: 'wallet' }));
                clearLocalOrderDraft();
                setIsSubmitting(false);
                setStep('success');
                return;
            }

            // Razorpay Payment: 1. Authoritative Server Preparation
            const prepRes = await fetch(`/api/orders/${targetOrderId}/payment/prepare`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            });

            const prepData = await prepRes.json();
            if (!prepRes.ok) {
                setPaymentError(prepData.error || 'Failed to prepare payment.');
                setIsSubmitting(false);
                setStep('failed');
                return;
            }

            // 2. Ensure Razorpay Checkout SDK is ready
            const isScriptLoaded = await loadRazorpayScript();
            if (!isScriptLoaded || !(window as any).Razorpay) {
                setPaymentError('Could not load Razorpay payment gateway. Please check your internet connection.');
                setIsSubmitting(false);
                setStep('failed');
                return;
            }

            // 3. Open Razorpay Standard Checkout
            const options = {
                key: prepData.razorpayKeyId,
                amount: prepData.amount,
                currency: prepData.currency || 'INR',
                name: 'XerService',
                description: `Print Order ${prepData.orderNumber || orderDisplayNumber}`,
                order_id: prepData.razorpayOrderId,
                prefill: {
                    name: user?.name || '',
                    email: user?.email || '',
                    contact: user?.mobile || '',
                },
                theme: {
                    color: '#54bdce', // XerService deep teal brand accent
                },
                handler: async function (response: {
                    razorpay_payment_id: string;
                    razorpay_order_id: string;
                    razorpay_signature: string;
                }) {
                    paymentConfirming.current = true;
                    rememberPending();
                    setStep('verifying');
                    try {
                        const verifyRes = await fetch('/api/payments/razorpay/verify', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                Authorization: `Bearer ${token}`,
                            },
                            body: JSON.stringify(response),
                        });

                        const verifyData = await verifyRes.json();
                        if (!verifyRes.ok) {
                            setPaymentError(verifyData.error || 'Payment signature verification failed.');
                            setIsSubmitting(false);
                            setStep('failed');
                            return;
                        }

                        await refreshOrders();
                        const confirmedOrderNumber = verifyData.orderNumber || prepData.orderNumber || orderDisplayNumber;
                        setSuccessOrderId(confirmedOrderNumber);
                        setLastOrderId(targetOrderId || '');
                        setCurrentOrder(prev => ({ ...prev, paymentMethod: method }));
                        clearLocalOrderDraft();
                        setIsSubmitting(false);
                        setStep('success');
                    } catch (verifyErr: unknown) {
                        const msg = verifyErr instanceof Error ? verifyErr.message : String(verifyErr);
                        setPaymentError('Your payment is awaiting confirmation. Check My Orders before paying again.');
                        void loadOrderFromDb();
                        setIsSubmitting(false);
                        setStep('failed');
                    }
                },
                modal: {
                    ondismiss: function () {
                        if (paymentConfirming.current) return;
                        setIsSubmitting(false);
                        setPaymentError('Checkout closed. If you were charged, wait for confirmation before trying again.');
                        setStep('cancelled');
                        void loadOrderFromDb();
                    },
                },
            };

            const rzp = new (window as any).Razorpay(options);
            rzp.on('payment.failed', function (resp: any) {
                console.error('[Razorpay] Payment failed event:', resp.error);
                setPaymentError(resp.error?.description || 'Payment was not completed by the issuing bank.');
                setIsSubmitting(false);
                setStep('failed');
            });
            rzp.open();
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            if (method === 'wallet') rememberPending();
            setPaymentError(method === 'wallet' ? 'Checking whether your wallet payment completed. Please wait before retrying.' : `Payment initiation error: ${msg}`);
            setIsSubmitting(false);
            setStep('failed');
        }
    };

    // Auth Loading Screen
    if (!authInitialized || (isLoading && !isLoggedIn)) {
        return (
            <div style={{ minHeight: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span className="spinner spinner-lg" />
            </div>
        );
    }

    // Unauthenticated State
    if (!isLoggedIn) {
        const currentSearch = params.toString() ? `?${params.toString()}` : '';
        return (
            <div style={{ minHeight: '80vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '20px', padding: '40px' }}>
                <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: 'var(--accent-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Zap size={28} color="var(--accent)" />
                </div>
                <div style={{ textAlign: 'center' }}>
                    <p style={{ fontSize: '18px', fontWeight: '700', marginBottom: '8px' }}>Sign in required</p>
                    <p style={{ fontSize: '14px', color: 'var(--fg-muted)', marginBottom: '20px' }}>Please sign in to review your order and complete payment.</p>
                    <Link href={`/login?redirect=${encodeURIComponent(`/order/pricing${currentSearch}`)}`} className="btn btn-accent">
                        Sign In to Continue
                    </Link>
                </div>
            </div>
        );
    }

    // Payment Successful Screen
    if (step === 'success') {
        const displayConfirmedOrder = successOrderId || orderDisplayNumber || targetOrderId || '';
        return (
            <div className={styles.pageContainer}>
                <div className={styles.contentWrapper}>
                    <div className={styles.successCard}>
                        <div className={styles.successIconWrap}>
                            <CheckCircle2 size={36} />
                        </div>
                        <h1 className={styles.successTitle}>Payment Successful!</h1>
                        <p className={styles.successSub}>
                            Your print order has been queued and sent to <strong>{shopDisplayName}</strong> for fulfillment.
                        </p>

                        <div className={styles.successDetails}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                                <span style={{ color: 'var(--fg-muted)' }}>Order Reference</span>
                                <span style={{ fontWeight: 800, fontFamily: 'monospace' }}>#{displayConfirmedOrder}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                                <span style={{ color: 'var(--fg-muted)' }}>Print Partner</span>
                                <span style={{ fontWeight: 700 }}>{shopDisplayName}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                                <span style={{ color: 'var(--fg-muted)' }}>Amount Paid</span>
                                <span style={{ fontWeight: 800, color: 'var(--accent)' }}>₹{price.toFixed(2)}</span>
                            </div>
                        </div>

                        <OrderStatusChat
                            status={dbOrder?.status || 'QUEUED'}
                            orderId={displayConfirmedOrder}
                            shopName={shopDisplayName}
                        />

                        <div className={styles.successActions}>
                            {receiptAvailable && (
                                <button
                                    type="button"
                                    onClick={handleDownloadReceipt}
                                    className="btn btn-outline"
                                    disabled={downloadingReceipt}
                                    style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                                >
                                    <Download size={16} />
                                    {downloadingReceipt ? 'Generating Receipt...' : 'Download Official PDF Receipt'}
                                </button>
                            )}

                            <Link href="/dashboard/orders" className="btn btn-accent" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                                View Order Details & Tracking
                            </Link>

                            <Link href="/#shops" className="btn btn-outline" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                                Print Another Document
                            </Link>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // Main Unified "Review & Pay" View
    return (
        <div className={styles.pageContainer}>
            <div className={styles.contentWrapper}>
                {/* Checkout Navigation Breadcrumbs */}
                <nav className={styles.breadcrumb} aria-label="Checkout Progress">
                    <Link href="/#shops" className={styles.breadcrumbStep}>Shops</Link>
                    <span className={styles.breadcrumbSep}>/</span>
                    <Link href={uploadUrl} className={styles.breadcrumbStep}>Configure</Link>
                    <span className={styles.breadcrumbSep}>/</span>
                    <span className={styles.breadcrumbCurrent}>Review & Pay</span>
                </nav>

                {/* Page Title & Subtitle */}
                <div className={styles.pageHeader}>
                    <h1 className={styles.pageTitle}>Review & Pay</h1>
                    <p className={styles.pageSubtitle}>
                        Inspect your live document preview, verify print specifications, and complete your order securely.
                    </p>
                </div>

                {/* Notice Banners (Cancellation / Failure / Quote Error) */}
                {paymentPending && <div className={styles.bannerNotice} role="status"><span>Your payment is awaiting confirmation. Your order is saved; please don’t pay again yet.</span><button type="button" onClick={() => { void checkPaymentStatus().catch(() => notify('Payment confirmation is unavailable. Check your connection and try again.')); }}>Check payment status</button><Link href="/dashboard/orders">My orders</Link></div>}
                {!paymentPending && step === 'cancelled' && (
                    <div className={`${styles.bannerNotice} ${styles.bannerCancelled}`} role="alert">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <Clock3 size={18} />
                            <span>Payment checkout was closed. Your order configuration remains saved and ready.</span>
                        </div>
                        <button type="button" onClick={() => setStep('select')}>
                            Try Payment Again
                        </button>
                    </div>
                )}

                {!paymentPending && (step === 'failed' || paymentError) && (
                    <div className={`${styles.bannerNotice} ${styles.bannerFailed}`} role="alert">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <AlertCircle size={18} />
                            <span>{paymentError || 'Payment could not be completed.'}</span>
                        </div>
                        <button type="button" onClick={() => { setStep('select'); setPaymentError(null); }}>
                            Retry Payment
                        </button>
                    </div>
                )}

                {quoteError && (
                    <div className={`${styles.bannerNotice} ${styles.bannerFailed}`} role="alert">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <AlertCircle size={18} />
                            <span>{quoteError}</span>
                        </div>
                        <button type="button" onClick={() => loadAuthoritativeQuote()}>
                            <RefreshCw size={14} /> Recalculate
                        </button>
                    </div>
                )}

                {/* 2-Column Responsive Layout */}
                <div className={styles.layoutGrid}>
                    {/* LEFT COLUMN: Live Preview, Manifest & Add-ons */}
                    <div className={styles.mainColumn}>
                        {/* Shop Header & Order Badge */}
                        <div className={styles.card}>
                            <div className={styles.cardHeader}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                    <Store size={18} className={styles.cardTitleIcon} />
                                    <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--fg)' }}>
                                        Selected Print Partner
                                    </span>
                                </div>
                                {orderDisplayNumber && (
                                    <span className={styles.badgeOrderNumber}>{orderDisplayNumber}</span>
                                )}
                            </div>

                            <div className={styles.shopBox}>
                                <div className={styles.shopIcon}>
                                    <Store size={22} />
                                </div>
                                <div style={{ flex: 1 }}>
                                    <div className={styles.shopName}>{shopDisplayName}</div>
                                    <div className={styles.shopMeta}>
                                        {dbOrder?.shopAddress || 'On-campus pickup partner'}
                                    </div>
                                </div>
                                <div className={styles.badgeVerified}>
                                    <ShieldCheck size={14} /> Verified
                                </div>
                            </div>
                        </div>

                        {/* Interactive Live Preview Card */}
                        <div className={styles.card}>
                            <div className={styles.cardHeader}>
                                <h2 className={styles.cardTitle}>
                                    <FileText size={18} className={styles.cardTitleIcon} />
                                    Live Print Preview
                                </h2>
                                <span style={{ fontSize: '12px', color: 'var(--fg-muted)' }}>
                                    {estimatedPages} printable pages • {sheets} printed sheets
                                </span>
                            </div>

                            {/* Every document is visible without opening a dropdown. */}
                            {documents.length > 0 && (
                                <div className={styles.docSelectorRow} role="group" aria-label="Choose a document to preview">
                                    <p className={styles.docSelectorLabel} aria-live="polite">
                                        Document {selectedIndex + 1} of {documents.length}
                                    </p>
                                    <div className={styles.docChoices}>
                                        {documents.map((doc, idx) => (
                                            <button key={doc.id || idx} type="button"
                                                className={styles.docChoice}
                                                aria-pressed={selectedIndex === idx}
                                                onClick={() => setSelectedIndex(idx)}>
                                                <span className={styles.docNumber}>{idx + 1}</span>
                                                <span className={styles.docInfo}>
                                                    <strong>{doc.name}</strong>
                                                    <span>{doc.pages} {doc.pages === 1 ? 'page' : 'pages'}{selectedIndex === idx ? ' · Selected' : ' · Tap to preview'}</span>
                                                </span>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Live Preview Canvas or Missing Document State */}
                            <div className={styles.previewContainer}>
                                {actualFile ? (
                                    <LivePrintPreview
                                        review
                                        key={activeFileId || selectedDocument?.id || 'preview'}
                                        file={actualFile}
                                        pageCount={selectedDocument?.pages || dbOrder?.files[selectedIndex]?.printablePages || estimatedPages}
                                        settings={selectedDocument?.settings || activeSettings}
                                    />
                                ) : (
                                    <div className={styles.previewMissing}>
                                        <p style={{ margin: 0, fontSize: '14px' }}>
                                            {downloadingFile
                                                ? 'Loading document preview from server...'
                                                : 'Document preview is preparing. You can still inspect all settings and complete checkout.'}
                                        </p>
                                        {!downloadingFile && (
                                            <Link href={uploadUrl} className="btn btn-outline btn-sm">
                                                Re-upload Original Document
                                            </Link>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Print Settings Manifest */}
                        <div className={styles.card}>
                            <div className={styles.cardHeader}>
                                <h2 className={styles.cardTitle}>
                                    <Settings2 size={18} className={styles.cardTitleIcon} />
                                    Print Configuration
                                </h2>
                                <div className={styles.settingsActions}>
                                    <Link href={uploadUrl} className={styles.editSettingsBtn}>
                                        <Plus size={16} /> Add PDF
                                    </Link>
                                <button
                                    type="button"
                                    onClick={() => {
                                        if (actualFile) setEditing(true);
                                        else router.push(uploadUrl);
                                    }}
                                    className={styles.editSettingsBtn}
                                >
                                    <ArrowLeft size={14} /> Edit Settings
                                </button>
                                </div>
                            </div>

                            <div className={styles.printSettingsGrid}>
                                <div className={styles.settingPill}>
                                    <span className={styles.settingLabel}>Paper Size</span>
                                    <span className={styles.settingVal}>{(activeSettings.paperSize || 'A4').toUpperCase()} Paper</span>
                                </div>
                                <div className={styles.settingPill}>
                                    <span className={styles.settingLabel}>Colour Mode</span>
                                    <span className={styles.settingVal}>{activeSettings.color === 'color' ? 'Colour' : 'Black & White'}</span>
                                </div>
                                <div className={styles.settingPill}>
                                    <span className={styles.settingLabel}>Print Mode</span>
                                    <span className={styles.settingVal}>
                                        {activeSettings.sides === 'single' ? 'Single-sided' : 'Double-sided'}
                                    </span>
                                </div>
                                <div className={styles.settingPill}>
                                    <span className={styles.settingLabel}>Copies</span>
                                    <span className={styles.settingVal}>{activeSettings.copies || 1}</span>
                                </div>
                                <div className={styles.settingPill}>
                                    <span className={styles.settingLabel}>Orientation</span>
                                    <span className={styles.settingVal}>
                                        {(activeSettings.orientation || 'portrait') === 'portrait' ? 'Portrait' : 'Landscape'}
                                    </span>
                                </div>
                                <div className={styles.settingPill}>
                                    <span className={styles.settingLabel}>Page Range</span>
                                    <span className={styles.settingVal}>
                                        {activeSettings.pageRange === 'range' && activeSettings.customRange
                                            ? activeSettings.customRange
                                            : 'All Pages'}
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* Finishing & Add-ons Card (Rendered if present) */}
                        {allItemizedAddons.length > 0 && (
                            <div className={styles.card}>
                                <div className={styles.cardHeader}>
                                    <h2 className={styles.cardTitle}>
                                        <Sparkles size={18} className={styles.cardTitleIcon} />
                                        Finishing & Add-ons
                                    </h2>
                                    <span style={{ fontSize: '12px', color: 'var(--accent)', fontWeight: 700 }}>
                                        +₹{addonsTotal.toFixed(2)}
                                    </span>
                                </div>

                                <div className={styles.addonsList}>
                                    {allItemizedAddons.map((addon, aIdx) => (
                                        <div key={aIdx} className={styles.addonItem}>
                                            <div className={styles.addonLeft}>
                                                <Sparkles size={15} className={styles.addonIcon} />
                                                <span className={styles.addonName}>{addon.name}</span>
                                                <span className={styles.addonQty}>×{addon.quantity}</span>
                                            </div>
                                            <div className={styles.addonPrice}>
                                                ₹{addon.total.toFixed(2)}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* RIGHT COLUMN: Sticky Payment Summary & Method */}
                    <div className={styles.sidebarColumn}>
                        <div className={styles.stickySidebar}>
                            <div className={styles.paymentCard}>
                                <h2 className={styles.summaryTitle}>Payment Summary</h2>

                                {/* Authoritative Cost Breakdown */}
                                <div className={styles.summaryRows}>
                                    <div className={styles.summaryRow}>
                                        <span>Print charges ({estimatedPages} pages • {sheets} physical sheets)</span>
                                        <span className={styles.summaryRowVal}>₹{printingCharges.toFixed(2)}</span>
                                    </div>

                                    {addonsTotal > 0 && (
                                        <div className={styles.summaryRow}>
                                            <span>Add-ons subtotal</span>
                                            <span className={styles.summaryRowVal}>₹{addonsTotal.toFixed(2)}</span>
                                        </div>
                                    )}

                                    <div className={styles.summaryDivider} />

                                    <div className={styles.totalRow}>
                                        <span className={styles.totalLabel}>Total Due</span>
                                        <span className={styles.totalAmount}>
                                            {quoteLoading && !price ? '...' : `₹${price.toFixed(2)}`}
                                        </span>
                                    </div>
                                </div>

                                {/* Payment Method Selector */}
                                <div className={styles.methodSection}>
                                    <div className={styles.methodSectionTitle}>Payment Method</div>
                                    <div className={styles.methodTabs}>
                                        <button
                                            type="button"
                                            onClick={() => { setMethod('upi'); setPaymentError(null); }}
                                            className={`${styles.methodTab} ${method === 'upi' ? styles.methodTabActive : ''}`}
                                            disabled={isSubmitting || paymentPending}
                                        >
                                            <Smartphone size={16} /> Online / UPI
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => { setMethod('wallet'); setPaymentError(null); }}
                                            className={`${styles.methodTab} ${method === 'wallet' ? styles.methodTabActive : ''}`}
                                            disabled={isSubmitting || paymentPending}
                                        >
                                            <Coins size={16} /> XerCoins
                                        </button>
                                    </div>
                                </div>

                                {/* Wallet Context Info */}
                                {method === 'wallet' && (
                                    <div className={styles.walletBox}>
                                        <div className={styles.walletRow}>
                                            <span style={{ color: 'var(--fg-muted)' }}>Wallet Balance:</span>
                                            <span style={{ fontWeight: 800 }}>₹{xerCoinsBalance.toFixed(2)}</span>
                                        </div>
                                        <div className={styles.walletRow}>
                                            <span style={{ color: 'var(--fg-muted)' }}>Balance After:</span>
                                            <span style={{ fontWeight: 800, color: canPayWallet ? '#10b981' : '#ef4444' }}>
                                                ₹{Math.max(0, xerCoinsBalance - price).toFixed(2)}
                                            </span>
                                        </div>
                                        {!canPayWallet && (
                                            <div className={styles.walletInsufficient}>
                                                <AlertCircle size={14} />
                                                <span>Insufficient coins. Switch to Online / UPI.</span>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Authoritative Primary Pay CTA Button */}
                                <button
                                    type="button"
                                    onClick={handlePay}
                                    className={styles.payBtn}
                                    disabled={!isOrderReady || isSubmitting || paymentPending || (method === 'wallet' && !canPayWallet)}
                                    aria-busy={isSubmitting}
                                >
                                    {isSubmitting || step === 'opening' ? (
                                        <>
                                            <Loader2 size={18} className="spin" />
                                            <span>Opening secure payment...</span>
                                        </>
                                    ) : method === 'wallet' ? (
                                        <>
                                            <Coins size={18} />
                                            <span>Pay ₹{price.toFixed(2)} with XerCoins</span>
                                        </>
                                    ) : (
                                        <>
                                            <Lock size={18} />
                                            <span>Pay ₹{price.toFixed(2)} securely</span>
                                        </>
                                    )}
                                </button>

                                {/* Secondary Action: Add to Cart */}
                                <button
                                    type="button"
                                    onClick={addCurrentOrderToCart}
                                    className={styles.cartBtn}
                                    disabled={addedToCart || !isOrderReady || isSubmitting}
                                >
                                    <ShoppingCart size={16} />
                                    {addedToCart ? 'Saved in Cart' : 'Save & Add to Cart'}
                                </button>

                                {/* Security & Trust Badge */}
                                <div className={styles.trustBadge}>
                                    <Lock size={13} className={styles.trustIcon} />
                                    <span>256-bit SSL encrypted • Powered by Razorpay</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* In-place Print Settings Modal */}
            {editing && actualFile && (
                <PrintSettingsModal
                    file={{
                        file: actualFile,
                        pages: selectedDocument?.pages || dbOrder?.files[selectedIndex]?.printablePages || estimatedPages,
                        settings: selectedDocument?.settings || activeSettings,
                    }}
                    hasMultiple={documents.length > 1}
                    onClose={() => { setEditing(false); setEditError(''); }}
                    onSave={saveSettings}
                    onAddFiles={() => router.push(uploadUrl)}
                    error={editError}
                    shopId={currentOrder.shopId || dbOrder?.shopId || dbOrder?.shopName}
                />
            )}
        </div>
    );
}

export default function PricingPage() {
    return (
        <Suspense fallback={
            <div style={{ minHeight: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span className="spinner spinner-lg" />
            </div>
        }>
            <ReviewAndPayPageContent />
        </Suspense>
    );
}

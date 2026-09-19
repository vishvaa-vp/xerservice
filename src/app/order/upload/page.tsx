"use client";

import { useEffect, useState, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useApp } from "@/context/AppContext";
import { supabase } from "@/lib/supabase/client";
import { transferDocument } from "@/lib/document-transfer";
import { notify } from "@/components/ui/Feedback";
import { calculatePrice } from "@/lib/mock-data";
import {
    AlertTriangle,
    FileText,
    Settings,
    Plus,
    Trash2,
    Settings2,
    CheckCircle,
    Clock,
    Store
} from "lucide-react";
import PrintSettingsModal from "@/components/order/PrintSettingsModal";
import { selectedPageNumbers, toDbPrintSettings, fromDbPrintSettings, type PrintSettings } from "@/lib/print-settings";
import { usePdfAnalyzer, PdfAnalysisResult } from "@/hooks/usePdfAnalyzer";
import { MAX_DOCUMENT_BYTES } from "@/lib/pdf-document";
import { summarizePrintDocuments, documentPrintTotals } from "@/lib/print-order";

const SUPPORTED_TYPES = [
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "image/jpeg", "image/png", "image/webp"
];

function getMimeType(fileName: string): string {
    const ext = fileName.split(".").pop()?.toLowerCase();
    switch (ext) {
        case "pdf": return "application/pdf";
        case "doc": return "application/msword";
        case "docx": return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
        case "ppt": return "application/vnd.ms-powerpoint";
        case "pptx": return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
        case "jpg":
        case "jpeg": return "image/jpeg";
        case "png": return "image/png";
        case "webp": return "image/webp";
        default: return "application/pdf";
    }
}

function formatTime(timeStr?: string | null): string {
    if (!timeStr) return "";
    const [hoursStr, minutesStr] = timeStr.split(":");
    const hours = parseInt(hoursStr, 10);
    const minutes = parseInt(minutesStr, 10);
    if (isNaN(hours)) return timeStr;

    const period = hours >= 12 ? "PM" : "AM";
    const displayHours = hours % 12 === 0 ? 12 : hours % 12;
    const displayMinutes = isNaN(minutes) ? "00" : minutes.toString().padStart(2, "0");

    return `${displayHours}:${displayMinutes} ${period}`;
}

function getInitials(name: string): string {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return "XS";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
}

interface ShopData {
    id: string;
    name: string;
    description: string | null;
    status: "OPEN" | "PAUSED" | "CLOSED";
    openTime: string;
    closeTime: string;
    closingSoon: boolean;
    closingMessage: string | null;
    priceBwPerPage: number | null;
    priceColorPerPage: number | null;
    imageInitials: string;
    imageUrl?: string;
}

interface FileWithSettings {
    id: string;
    dbId?: string;
    storagePath?: string;
    file: File;
    preview?: string;
    pages: number;
    analysis?: PdfAnalysisResult;
    uploadProgress?: number;
    status?: "queued" | "saving" | "analyzing" | "uploading" | "ready" | "deleting" | "error";
    analysisError?: string;
    settingsEdited?: boolean;
    settings: PrintSettings;
}

function UploadPageContent() {
    const [files, setFiles] = useState<FileWithSettings[]>([]);
    const filesRef = useRef(files);
    filesRef.current = files;
    const transfers = useRef(new Map<string, AbortController>());
    const removed = useRef(new Set<string>());
    const uploadQueue = useRef(Promise.resolve());
    const uploadMounted = useRef(true);
    useEffect(() => {
        uploadMounted.current = true;
        const activeTransfers = transfers.current;
        return () => {
            uploadMounted.current = false;
            activeTransfers.forEach(controller => controller.abort());
        };
    }, []);
    const [dragging, setDragging] = useState(false);
    const [error, setError] = useState("");
    const [uploading, setUploading] = useState(false);
    const [editingFileId, setEditingFileId] = useState<string | null>(null);
    const [globalApplyEnabled, setGlobalApplyEnabled] = useState(true);
    const [shopData, setShopData] = useState<ShopData | null>(null);
    const [shopAvailability, setShopAvailability] = useState<{ isOpen: boolean; closingSoon: boolean; reason?: string } | null>(null);
    const [draftOrderId, setDraftOrderId] = useState<string | null>(null);
    const [draftOrderNumber, setDraftOrderNumber] = useState<string | null>(null);
    const [draftShopId, setDraftShopId] = useState<string | null>(null);

    const searchParams = useSearchParams();
    const shopParam = searchParams.get("shop");
    const { currentOrder, setCurrentOrder, cart, user, isLoggedIn, isLoading, authInitialized } = useApp();
    const [shopLoading, setShopLoading] = useState(Boolean(shopParam));

    // =========================================================================
    // DRAFT CONCURRENCY LIMITATION NOTE:
    // The single-page draftOrderPromiseRef prevents concurrent draft creation
    // inside a single browser tab (e.g. rapid multiple file drops).
    // However, two simultaneous browser tabs or devices could still create
    // duplicate DRAFT orders if opened at the exact same millisecond.
    // In Phase 5B, this will be solved via a dedicated database RPC:
    //   CREATE OR REPLACE FUNCTION get_or_create_draft_order(...)
    // with row locking / advisory locks for cross-session atomicity.
    // =========================================================================
    const draftOrderPromiseRef = useRef<{ shopId: string; promise: Promise<{ id: string; orderNumber: string }> } | null>(null);
    const isRestoringDraftRef = useRef(false);
    const previousShopIdRef = useRef<string | null>(null);

    const fileRef = useRef<HTMLInputElement>(null);
    const previewUrls = useRef(new Set<string>());
    const { analyze: analyzePdf } = usePdfAnalyzer();
    const router = useRouter();

    const orderPaused = Boolean(shopAvailability && (shopAvailability.isOpen === false || shopAvailability.closingSoon));
    const documentsReady = files.length > 0 && files.every(f => f.status === "ready");

    useEffect(() => {
        if (!authInitialized || isLoading) return;
        if (!isLoggedIn) {
            const currentSearch = searchParams.toString() ? `?${searchParams.toString()}` : "";
            router.push(`/login?redirect=${encodeURIComponent(`/order/upload${currentSearch}`)}`);
        }
    }, [isLoggedIn, isLoading, authInitialized, router, searchParams]);

    useEffect(() => {
        const urls = previewUrls.current;
        return () => { urls.forEach(url => URL.revokeObjectURL(url)); urls.clear(); };
    }, []);

    // 1. Fetch real shop data & active pricing from Supabase (Zero mock fallbacks)
    useEffect(() => {
        let isMounted = true;
        const targetShopId = shopParam || null;

        // Requirement 3: If target shop changes, clear stale draft identifiers belonging to previous shop
        if (targetShopId && previousShopIdRef.current && previousShopIdRef.current !== targetShopId) {
            setDraftOrderId(null);
            setDraftOrderNumber(null);
            setDraftShopId(null);
            draftOrderPromiseRef.current = null;
            transfers.current.forEach(controller => controller.abort());
            filesRef.current.forEach(file => removed.current.add(file.id));
            setFiles([]);
            isRestoringDraftRef.current = false;

            if (typeof window !== "undefined") {
                const currentUrl = new URL(window.location.href);
                if (currentUrl.searchParams.has("order")) {
                    currentUrl.searchParams.delete("order");
                    window.history.replaceState({}, "", currentUrl.toString());
                }
            }
        }
        previousShopIdRef.current = targetShopId || null;

        const fetchShop = async () => {
            try {
                if (targetShopId) {
                    if (isMounted) setShopLoading(true);
                } else {
                    if (isMounted) {
                        setShopData(null);
                        setShopAvailability(null);
                        setShopLoading(false);
                        setCurrentOrder(prev => (prev.shopId ? { ...prev, shopId: '', shopName: '' } : prev));
                        setError("Please select a print shop first before uploading documents.");
                    }
                    return;
                }

                let query = supabase
                    .from("shops")
                    .select("id, name, description, status, open_time, close_time, closing_soon, closing_message")
                    .eq("id", targetShopId);

                const { data, error: shopErr } = await query.maybeSingle();

                if (shopErr || !data) {
                    if (isMounted) {
                        setShopData(null);
                        setShopAvailability(null);
                        setShopLoading(false);
                        setError("Selected print shop could not be loaded. Please choose a shop from the homepage or try again.");
                    }
                    return;
                }

                const { data: pricingData, error: pricingErr } = await supabase
                    .from("shop_pricing")
                    .select("print_mode, price_per_sheet")
                    .eq("shop_id", data.id)
                    .eq("paper_size", "A4")
                    .eq("sides", "SINGLE")
                    .eq("active", true);

                let bwPrice: number | null = null;
                let colorPrice: number | null = null;

                if (!pricingErr && pricingData && pricingData.length > 0) {
                    pricingData.forEach(p => {
                        if (p.print_mode === "BW") bwPrice = Number(p.price_per_sheet);
                        if (p.print_mode === "COLOUR") colorPrice = Number(p.price_per_sheet);
                    });
                }

                if (isMounted) {
                    setShopData({
                        id: data.id,
                        name: data.name,
                        description: data.description,
                        status: data.status as any,
                        openTime: formatTime(data.open_time),
                        closeTime: formatTime(data.close_time),
                        closingSoon: Boolean(data.closing_soon),
                        closingMessage: data.closing_message,
                        priceBwPerPage: bwPrice,
                        priceColorPerPage: colorPrice,
                        imageInitials: getInitials(data.name),
                        imageUrl: "/shops/print-hub.svg",
                    });
                    setShopAvailability({
                        isOpen: data.status === "OPEN",
                        closingSoon: Boolean(data.closing_soon),
                        reason: data.closing_message || undefined,
                    });
                    setShopLoading(false);
                    setCurrentOrder(prev => (
                        prev.shopId === data.id && prev.shopName === data.name
                            ? prev
                            : { ...prev, shopId: data.id, shopName: data.name, method: "instant", scheduledTime: "" }
                    ));
                }
            } catch (err) {
                console.error("[UploadPage] Failed to load shop:", err);
                if (isMounted) {
                    setShopData(null);
                    setShopAvailability(null);
                    setShopLoading(false);
                    setError("Failed to connect to print shop service. Please refresh or try again later.");
                }
            }
        };

        fetchShop();

        if (targetShopId) {
            const channel = supabase
                .channel(`upload_shop_availability_${targetShopId}`)
                .on("postgres_changes", {
                    event: "UPDATE",
                    schema: "public",
                    table: "shops",
                    filter: `id=eq.${targetShopId}`,
                }, (payload) => {
                    const updated = payload.new as any;
                    if (updated && isMounted) {
                        setShopAvailability({
                            isOpen: updated.status === "OPEN",
                            closingSoon: Boolean(updated.closing_soon),
                            reason: updated.closing_message || undefined,
                        });
                        setShopData(prev => prev ? {
                            ...prev,
                            status: updated.status,
                            closingSoon: Boolean(updated.closing_soon),
                            closingMessage: updated.closing_message,
                        } : prev);
                    }
                })
                .subscribe();

            return () => {
                isMounted = false;
                supabase.removeChannel(channel);
            };
        }

        return () => { isMounted = false; };
    }, [shopParam, setCurrentOrder]);

    // 2. Draft order discovery / resumption with real file bytes & shop match enforcement
    useEffect(() => {
        if (!user?.id) return;
        const targetShopId = shopData?.id || shopParam || null;
        if (!targetShopId) return;

        // Requirement 2: If the draft in state belongs to another shop, clear it immediately
        if (draftShopId && draftShopId !== targetShopId) {
            setDraftOrderId(null);
            setDraftOrderNumber(null);
            setDraftShopId(null);
            draftOrderPromiseRef.current = null;
            setFiles([]);
            return;
        }

        let isMounted = true;
        const checkDraftOrder = async () => {
            if (isRestoringDraftRef.current) return;
            try {
                // Requirement 1: Match requested draft only if it belongs to targetShopId
                const targetOrderId = searchParams.get("order") || (currentOrder.shopId === targetShopId ? currentOrder.orderId : undefined) || (draftShopId === targetShopId ? draftOrderId : undefined);
                let draft: any = null;

                if (targetOrderId) {
                    const { data: matchedDraft } = await supabase
                        .from("orders")
                        .select("id, order_number, expires_at, status, shop_id")
                        .eq("id", targetOrderId)
                        .eq("user_id", user.id)
                        .eq("shop_id", targetShopId)
                        .eq("status", "DRAFT")
                        .gt("expires_at", new Date().toISOString())
                        .maybeSingle();

                    if (matchedDraft) {
                        draft = matchedDraft;
                    } else {
                        // Stale/wrong-shop order ID; strip from URL to prevent confusing state
                        if (searchParams.get("order") === targetOrderId && typeof window !== "undefined") {
                            const currentUrl = new URL(window.location.href);
                            currentUrl.searchParams.delete("order");
                            window.history.replaceState({}, "", currentUrl.toString());
                        }
                    }
                }

                if (!draft) {
                    const { data: latestDraft } = await supabase
                        .from("orders")
                        .select("id, order_number, expires_at, status, shop_id")
                        .eq("user_id", user.id)
                        .eq("shop_id", targetShopId)
                        .eq("status", "DRAFT")
                        .gt("expires_at", new Date().toISOString())
                        .order("created_at", { ascending: false })
                        .limit(1)
                        .maybeSingle();

                    if (latestDraft) draft = latestDraft;
                }

                if (draft && isMounted) {
                    setDraftOrderId(draft.id);
                    setDraftOrderNumber(draft.order_number);
                    setDraftShopId(draft.shop_id);

                    if (typeof window !== "undefined") {
                        const currentUrl = new URL(window.location.href);
                        if (currentUrl.searchParams.get("order") !== draft.id) {
                            currentUrl.searchParams.set("order", draft.id);
                            window.history.replaceState({}, "", currentUrl.toString());
                        }
                    }

                    if (files.length === 0 && !isRestoringDraftRef.current) {
                        isRestoringDraftRef.current = true;
                        const { data: filesData, error: filesErr } = await supabase
                            .from("order_files")
                            .select(`
                                id, original_filename, storage_path, mime_type, file_size_bytes, original_pages,
                                print_settings (
                                    colour_mode, sides, orientation, copies, pages_per_sheet,
                                    paper_size, margin, page_selection, page_range, scale, include_filename_page_numbers
                                )
                            `)
                            .eq("order_id", draft.id)
                            .order("created_at", { ascending: true });

                        if (filesErr) {
                            console.error("[UploadPage] Error fetching draft order_files:", filesErr);
                            isRestoringDraftRef.current = false;
                            return;
                        }

                        if (filesData && filesData.length > 0 && isMounted) {
                            // Initial placeholder cards while real bytes are downloaded
                            const initialFiles: FileWithSettings[] = filesData.map(f => {
                                const rawSettings = Array.isArray(f.print_settings) ? f.print_settings[0] : f.print_settings;
                                const settings = fromDbPrintSettings(rawSettings || {});
                                return {
                                    id: f.id,
                                    dbId: f.id,
                                    storagePath: f.storage_path || undefined,
                                    file: new File([], f.original_filename, { type: f.mime_type || "application/pdf" }),
                                    pages: f.original_pages || 1,
                                    status: "analyzing",
                                    settingsEdited: true,
                                    settings,
                                };
                            });
                            setFiles(initialFiles);

                            // Download real bytes from Supabase Storage and analyze
                            for (const f of filesData) {
                                if (!isMounted) break;
                                if (!f.storage_path) {
                                    setFiles(curr => curr.map(item => item.id === f.id ? {
                                        ...item,
                                        status: "error",
                                        analysisError: "Document storage path is missing",
                                    } : item));
                                    continue;
                                }

                                const { data: blob, error: downloadErr } = await supabase.storage
                                    .from("order-documents")
                                    .download(f.storage_path);

                                if (downloadErr || !blob) {
                                    console.error("[UploadPage] Failed to download file from storage:", downloadErr);
                                    if (isMounted) {
                                        setFiles(curr => curr.map(item => item.id === f.id ? {
                                            ...item,
                                            status: "error",
                                            analysisError: "Failed to load file from storage",
                                        } : item));
                                    }
                                    continue;
                                }

                                const realFile = new File([blob], f.original_filename, {
                                    type: f.mime_type || blob.type || "application/pdf",
                                });

                                const preview = realFile.type.startsWith("image/") || /\.(jpe?g|png|webp)$/i.test(realFile.name)
                                    ? URL.createObjectURL(realFile)
                                    : undefined;
                                if (preview) previewUrls.current.add(preview);

                                let realPageCount = f.original_pages || 1;
                                try {
                                    await analyzePdf(realFile, progress => {
                                        const complete = !progress.analyzing && !progress.error;
                                        if (complete && progress.pageCount > 0) {
                                            realPageCount = progress.pageCount;
                                        }
                                        if (isMounted) {
                                            setFiles(curr => curr.map(item => {
                                                if (item.id !== f.id) return item;
                                                return {
                                                    ...item,
                                                    file: complete ? progress.convertedPdfFile || realFile : realFile,
                                                    preview: preview || (progress.pages[0]?.thumbnail ? progress.pages[0].thumbnail : item.preview),
                                                    pages: progress.pageCount || item.pages,
                                                    analysis: progress,
                                                    status: progress.error ? "error" : progress.analyzing ? "analyzing" : "ready",
                                                    analysisError: progress.error || undefined,
                                                };
                                            }));
                                        }
                                    });
                                } catch (analysisErr) {
                                    console.warn("[UploadPage] PDF analysis warning on restored file:", analysisErr);
                                }

                                if (isMounted) {
                                    setFiles(curr => curr.map(item => {
                                        if (item.id !== f.id) return item;
                                        return {
                                            ...item,
                                            file: realFile,
                                            preview: preview || item.preview,
                                            pages: realPageCount,
                                            status: item.status === "error" ? "error" : "ready",
                                        };
                                    }));
                                }
                            }
                        }
                    }
                }
            } catch (err) {
                console.error("[UploadPage] Error checking draft order:", err);
            } finally {
                isRestoringDraftRef.current = false;
            }
        };

        checkDraftOrder();
    }, [user?.id, shopData?.id, shopParam, currentOrder.shopId, currentOrder.orderId, searchParams, draftOrderId, draftShopId, files.length, analyzePdf]);

    // 3. Ensure authoritative draft order exists before uploads (enforces shop match)
    const ensureDraftOrder = async (shopId: string): Promise<{ id: string; orderNumber: string }> => {
        // Requirement 2: Cached Draft Validation
        // If cached draft exists AND matches shopId, reuse it
        if (draftOrderId && draftOrderNumber && draftShopId === shopId) {
            return { id: draftOrderId, orderNumber: draftOrderNumber };
        }

        // If cached draft belongs to another shop, clear it
        if (draftShopId && draftShopId !== shopId) {
            setDraftOrderId(null);
            setDraftOrderNumber(null);
            setDraftShopId(null);
            draftOrderPromiseRef.current = null;
        }

        // In-flight creation promise check for THIS shopId
        if (draftOrderPromiseRef.current && draftOrderPromiseRef.current.shopId === shopId) {
            return draftOrderPromiseRef.current.promise;
        }

        const promise = (async () => {
            if (!user?.id) throw new Error("Please sign in to upload documents.");
            if (!shopId || typeof shopId !== 'string' || !shopId.trim()) {
                throw new Error("An explicit print shop selection is required before creating an order.");
            }

            const { data: s, error: sErr } = await supabase
                .from("shops")
                .select("id, status, closing_soon")
                .eq("id", shopId)
                .maybeSingle();

            if (sErr || !s) {
                throw new Error("Selected shop could not be found.");
            }
            if (s.status !== "OPEN" || s.closing_soon) {
                throw new Error("This shop is currently closed or paused and cannot accept new orders.");
            }

            const { data: activeDraft } = await supabase
                .from("orders")
                .select("id, order_number, expires_at, status, shop_id")
                .eq("user_id", user.id)
                .eq("shop_id", shopId)
                .eq("status", "DRAFT")
                .gt("expires_at", new Date().toISOString())
                .order("created_at", { ascending: false })
                .limit(1)
                .maybeSingle();

            if (activeDraft) {
                setDraftOrderId(activeDraft.id);
                setDraftOrderNumber(activeDraft.order_number);
                setDraftShopId(activeDraft.shop_id);

                if (typeof window !== "undefined") {
                    const currentUrl = new URL(window.location.href);
                    currentUrl.searchParams.set("order", activeDraft.id);
                    window.history.replaceState({}, "", currentUrl.toString());
                }

                return { id: activeDraft.id, orderNumber: activeDraft.order_number };
            }

            const { data: newOrder, error: orderErr } = await supabase
                .from("orders")
                .insert({
                    user_id: user.id,
                    shop_id: shopId,
                    status: "DRAFT",
                    payment_status: "UNPAID",
                    total_original_pages: 0,
                    total_printable_pages: 0,
                    total_sheets: 0,
                    total_amount: 0.00,
                })
                .select("id, order_number, expires_at, shop_id")
                .single();

            if (orderErr || !newOrder) {
                throw new Error(orderErr?.message || "Failed to create draft order. Please try again.");
            }

            setDraftOrderId(newOrder.id);
            setDraftOrderNumber(newOrder.order_number);
            setDraftShopId(newOrder.shop_id);

            if (typeof window !== "undefined") {
                const currentUrl = new URL(window.location.href);
                currentUrl.searchParams.set("order", newOrder.id);
                window.history.replaceState({}, "", currentUrl.toString());
            }

            return { id: newOrder.id, orderNumber: newOrder.order_number };
        })();

        draftOrderPromiseRef.current = { shopId, promise };
        try {
            return await promise;
        } finally {
            if (draftOrderPromiseRef.current?.shopId === shopId) {
                draftOrderPromiseRef.current = null;
            }
        }
    };

    // One queue bounds PDF memory and prevents overlapping batches from racing.
    const processFileUpload = async (item: FileWithSettings, shopId: string) => {
        if (!uploadMounted.current || removed.current.has(item.id)) return;
        const controller = new AbortController();
        transfers.current.set(item.id, controller);
        let fileId: string | undefined;
        let storagePath: string | undefined;
        const check = () => { if (controller.signal.aborted) throw new DOMException('Upload cancelled', 'AbortError'); };
        const update = (patch: Partial<FileWithSettings>) => setFiles(current => current.map(f => f.id === item.id ? { ...f, ...patch } : f));
        try {
            if (user?.type !== 'customer') throw new Error('Sign in with a customer account before uploading.');
            update({ status: 'analyzing', analysisError: undefined, uploadProgress: undefined });
            const analysis = await analyzePdf(item.file, progress => {
                update({ analysis: progress, analysisError: progress.error || undefined });
            }, controller.signal);
            check();
            if (!analysis || analysis.error || !analysis.pageCount) throw new Error('This file could not be opened. Choose a valid, unlocked PDF or image.');
            const uploadFile = analysis.convertedPdfFile || item.file;
            const current = filesRef.current.find(f => f.id === item.id) || item;
            const settings = current.settingsEdited ? current.settings : {
                ...current.settings,
                color: analysis.suggestedColor,
                paperSize: analysis.dominantSize === 'A3' ? 'a3' as const : analysis.dominantSize === 'Legal' ? 'legal' as const : 'a4' as const,
            };
            update({ file: uploadFile, settings, pages: analysis.pageCount });
            const draft = await ensureDraftOrder(shopId);
            check();
            const { data: { session } } = await supabase.auth.getSession();
            if (!session || session.user.id !== user.id) throw new Error('Your session changed. Sign in and retry.');
            fileId = crypto.randomUUID();
            storagePath = `users/${user.id}/orders/${draft.id}/${fileId}/${uploadFile.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
            update({ status: 'uploading', uploadProgress: 0 });
            await transferDocument({
                url: process.env.NEXT_PUBLIC_SUPABASE_URL!, key: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
                token: session.access_token, path: storagePath, file: uploadFile, signal: controller.signal,
                onProgress: uploadProgress => update({ uploadProgress }),
            });
            check();
            update({ status: 'saving' });
            const { error: fileError } = await supabase.from('order_files').insert({
                id: fileId, order_id: draft.id, user_id: user.id,
                original_filename: uploadFile.name, storage_path: storagePath,
                mime_type: 'application/pdf', file_size_bytes: uploadFile.size,
                original_pages: analysis.pageCount, printable_pages: 0, physical_sheets: 0, unit_price: 0, line_total: 0,
            });
            if (fileError) throw new Error('Your file uploaded, but its details could not be saved. Please retry.');
            check();
            const { error: settingsError } = await supabase.from('print_settings').insert({ order_file_id: fileId, ...toDbPrintSettings(settings) });
            if (settingsError) throw new Error('Print settings could not be saved. Please retry.');
            check();
            update({ dbId: fileId, storagePath, status: 'ready', uploadProgress: 100 });
        } catch (error) {
            let cleanupFailed = false;
            // Roll back partial writes before allowing a retry with a new object ID.
            if (fileId) {
                const { error: cleanupError } = await supabase.from('order_files').delete().eq('id', fileId);
                if (cleanupError) { cleanupFailed = true; notify('A partial file could not be removed. Refresh this draft before retrying.'); }
            }
            if (storagePath) {
                const { error: cleanupError } = await supabase.storage.from('order-documents').remove([storagePath]);
                if (cleanupError) { cleanupFailed = true; notify('Document cleanup is pending. Check your connection before retrying.'); }
            }
            if (!controller.signal.aborted) update({ status: 'error', ...(cleanupFailed ? { dbId: fileId, storagePath } : {}), analysisError: error instanceof Error ? error.message : 'Upload failed. Please retry.' });
        } finally { transfers.current.delete(item.id); }
    };

    const queueUpload = (item: FileWithSettings, shopId: string) => {
        uploadQueue.current = uploadQueue.current.then(() => processFileUpload(item, shopId)).catch(() => {});
    };

    const handleFiles = (newDocs: FileList | File[]) => {
        if (uploading || orderPaused) return;
        const currentTargetShopId = shopData?.id || shopParam;
        if (!currentTargetShopId) {
            setError("Please select a print shop first before uploading documents.");
            return;
        }
        const docs = Array.from(newDocs);
        const messages: string[] = [];
        const validDocs = docs.filter(f => {
            if (/\.(docx?|pptx?)$/i.test(f.name) || SUPPORTED_TYPES.slice(1, 5).includes(f.type)) {
                messages.push("For Word or PowerPoint, choose Save as PDF in your document app, then upload the PDF here.");
                return false;
            }
            if (!["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(f.type) && !/\.(pdf|jpe?g|png|webp)$/i.test(f.name)) {
                messages.push("Choose a PDF, JPG, PNG or WebP file.");
                return false;
            }
            if (!f.size || f.size > MAX_DOCUMENT_BYTES) {
                messages.push("Choose a non-empty file smaller than 20 MB.");
                return false;
            }
            return true;
        });

        setError(Array.from(new Set(messages)).join(" "));
        if (validDocs.length === 0) return;

        const targetShopId = shopData?.id || shopParam;
        if (!targetShopId) {
            setError("Please select a print shop before uploading.");
            return;
        }

        const newFiles: FileWithSettings[] = validDocs.map(file => {
            const preview = file.type.startsWith("image/") || /\.(jpe?g|png|webp)$/i.test(file.name) ? URL.createObjectURL(file) : undefined;
            if (preview) previewUrls.current.add(preview);
            return {
                id: crypto.randomUUID(),
                file,
                preview,
                pages: 0,
                status: "queued",
                settings: { copies: 1, color: "bw", sides: "single", paperSize: "a4", orientation: "portrait", pagesPerSheet: 1, pageRange: "all", customRange: "", margins: "default", scale: "default", headersFooters: false },
            };
        });

        setFiles(prev => [...prev, ...newFiles]);

        for (const fileItem of newFiles) queueUpload(fileItem, targetShopId);

        if (fileRef.current) fileRef.current.value = "";
    };

    const printablePages = (file: FileWithSettings) => {
        return Math.ceil(selectedPageNumbers(file.pages, file.settings).length / Math.max(1, file.settings.pagesPerSheet));
    };

    const validSelection = documentsReady && files.every(f => printablePages(f) > 0);

    const bwPrice = shopData?.priceBwPerPage ?? null;
    const colorPrice = shopData?.priceColorPerPage ?? null;
    const pricingAvailable = bwPrice !== null && colorPrice !== null;

    const totalAmount = pricingAvailable ? files.reduce((sum, f) => {
        const pages = printablePages(f);
        return sum + (pages > 0 ? calculatePrice(pages, f.settings.color === "color", f.settings.sides, f.settings.copies, { bwPerPage: bwPrice, colorPerPage: colorPrice }) : 0);
    }, 0) : null;

    const removeFile = async (id: string) => {
        const fileToRemove = files.find(f => f.id === id);
        if (!fileToRemove) return;
        removed.current.add(id);
        transfers.current.get(id)?.abort();

        // If file was not yet persisted to database, remove from state immediately
        if (!fileToRemove.dbId) {
            if (fileToRemove.preview) {
                URL.revokeObjectURL(fileToRemove.preview);
                previewUrls.current.delete(fileToRemove.preview);
            }
            setFiles(prev => prev.filter(f => f.id !== id));
            if (editingFileId === id) setEditingFileId(null);
            return;
        }

        // Set card status to 'deleting' and keep card in UI while deleting
        setFiles(prev => prev.map(f => f.id === id ? { ...f, status: "deleting", analysisError: undefined } : f));
        if (editingFileId === id) setEditingFileId(null);

        // Step 1: Authoritative DB deletion from public.order_files
        try {
            const { error: dbDeleteErr } = await supabase
                .from("order_files")
                .delete()
                .eq("id", fileToRemove.dbId);

            if (dbDeleteErr) {
                // If DB deletion itself fails, keep file in the UI and show real error
                setFiles(prev => prev.map(f => f.id === id ? {
                    ...f,
                    status: "error",
                    analysisError: `Failed to delete file: ${dbDeleteErr.message}`
                } : f));
                return;
            }
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : "Database deletion failed";
            setFiles(prev => prev.map(f => f.id === id ? {
                ...f,
                status: "error",
                analysisError: `Failed to delete file: ${message}`
            } : f));
            return;
        }

        // Step 2: DB deletion succeeded! PostgreSQL order_files is authoritative for order membership.
        // At this point the document is already removed from the order database.
        // Remove from UI state and revoke object URL immediately so the UI does NOT pretend it is still part of the order.
        if (fileToRemove.preview) {
            URL.revokeObjectURL(fileToRemove.preview);
            previewUrls.current.delete(fileToRemove.preview);
        }
        setFiles(prev => prev.filter(f => f.id !== id));

        // Step 3: Best-effort Storage cleanup.
        // If DB deletion succeeded but Storage cleanup fails, the file is already gone from the order.
        // Log warning documenting that the storage object is orphaned and can be cleaned later.
        if (fileToRemove.storagePath) {
            try {
                const { error: storageDelErr } = await supabase.storage
                    .from("order-documents")
                    .remove([fileToRemove.storagePath]);

                if (storageDelErr) {
                    console.warn(
                        `[UploadPage] Storage object cleanup failed for removed order_file (${fileToRemove.dbId}); ` +
                        `file "${fileToRemove.storagePath}" is orphaned and can be cleaned later:`,
                        storageDelErr.message
                    );
                }
            } catch (storageErr) {
                console.warn(
                    `[UploadPage] Storage object deletion exception for order_file (${fileToRemove.dbId}):`,
                    storageErr
                );
            }
        }
    };

    const updateFileSettings = async (id: string, newSettings: Partial<FileWithSettings['settings']>, applyAll = false) => {
        const target = files.find(file => file.id === id);
        if (!target) return false;
        const merged = { ...target.settings, ...newSettings };
        const targets = files.filter(file => applyAll || file.id === id);
        if (targets.some(file => file.status !== 'ready' || !file.dbId || !selectedPageNumbers(file.pages, merged).length)) {
            setError('Wait for uploads and select a valid page range for every affected document.'); return false;
        }
        try {
            const ids = targets.map(file => file.dbId!);
            const { data, error } = await supabase.from('print_settings').update(toDbPrintSettings(merged)).in('order_file_id', ids).select('order_file_id');
            if (error || data?.length !== ids.length) throw new Error('Print settings could not be saved. Check your connection and try again.');
            setFiles(previous => previous.map(file => applyAll || file.id === id ? { ...file, settingsEdited: true, settings: { ...merged } } : file));
            setError(''); return true;
        } catch (error) {
            setError(error instanceof Error ? error.message : 'Settings could not be saved.'); return false;
        }
    };

    const applyFirstFileSettingsToAll = async () => {
        if (files.length > 1) await updateFileSettings(files[0].id, files[0].settings, true);
    };

    const handleContinue = async () => {
        if (files.length === 0) return;
        if (!validSelection) {
            setError("Wait for your files to finish checking and choose a valid page range.");
            return;
        }
        if (orderPaused) {
            setError("This shop is closing in 5-10 minutes and is not accepting new orders right now.");
            return;
        }

        const unready = files.find(f => f.status !== "ready" || !f.dbId);
        if (unready) {
            setError("Please wait for all documents to finish uploading.");
            return;
        }

        if (totalAmount === null) {
            setError("Pricing for this shop is currently unavailable. Please try again or select another shop.");
            return;
        }

        setUploading(true);
        setError("");

        const activeShopId = shopData?.id || currentOrder.shopId || shopParam || "";
        const activeShopName = shopData?.name || currentOrder.shopName || "";

        const validOrderId = (draftOrderId && draftShopId === activeShopId) ? draftOrderId : (currentOrder.shopId === activeShopId ? currentOrder.orderId : undefined);
        const validOrderNumber = (draftOrderNumber && draftShopId === activeShopId) ? draftOrderNumber : (currentOrder.shopId === activeShopId ? currentOrder.orderNumber : undefined);

        setCurrentOrder(prev => ({
            ...prev,
            orderId: validOrderId,
            orderNumber: validOrderNumber,
            ...summarizePrintDocuments(files.map(f => ({
                id: f.dbId || f.id,
                name: f.file.name,
                file: f.file,
                pages: f.pages,
                storagePath: f.storagePath,
                fileSizeBytes: f.file.size,
                mimeType: f.file.type,
                settings: { ...f.settings }
            })), pricingAvailable ? { bwPerPage: bwPrice, colorPerPage: colorPrice } : undefined),
            editingCartCreatedAt: searchParams.has("fromCart") || searchParams.has("resume") ? prev.editingCartCreatedAt : undefined,
            shopId: activeShopId,
            shopName: activeShopName,
            method: "instant",
            scheduledTime: "",
            uploadedAt: new Date().toISOString(),
        }));

        router.push(validOrderId ? `/order/pricing?order=${validOrderId}` : "/order/pricing");
    };

    const activeShop = shopData;

    if (!authInitialized || (isLoading && !isLoggedIn)) {
        return (
            <div style={{ minHeight: "80vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span className="spinner spinner-lg" />
            </div>
        );
    }

    if (!isLoggedIn) {
        const currentSearch = searchParams.toString() ? `?${searchParams.toString()}` : "";
        return (
            <div style={{ minHeight: "80vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "20px", padding: "40px" }}>
                <div style={{ width: "64px", height: "64px", borderRadius: "50%", background: "var(--accent-muted)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Clock size={28} color="var(--accent)" />
                </div>
                <div style={{ textAlign: "center" }}>
                    <p style={{ fontSize: "18px", fontWeight: "700", marginBottom: "8px" }}>Sign in required</p>
                    <p style={{ fontSize: "14px", color: "var(--fg-muted)", marginBottom: "20px" }}>Please sign in to upload documents.</p>
                    <Link href={`/login?redirect=${encodeURIComponent(`/order/upload${currentSearch}`)}`} className="btn btn-accent">Sign In to Continue</Link>
                </div>
            </div>
        );
    }

    return (
        <div className="page-wrapper">
            <section className="section">
                <div className="container" style={{ maxWidth: "1000px" }}>
                    {/* Unselected Shop Alert Banner */}
                    {!shopLoading && !activeShop && (
                        <div className="card no-shop-banner" style={{
                            padding: "16px 20px",
                            borderRadius: "16px",
                            border: "1.5px solid var(--accent)",
                            background: "linear-gradient(135deg, rgba(84, 189, 206, 0.12), rgba(234, 88, 12, 0.08))",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            flexWrap: "wrap",
                            gap: "12px",
                            marginBottom: "24px",
                            boxShadow: "0 4px 16px rgba(84, 189, 206, 0.15)",
                        }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                                <AlertTriangle size={22} color="var(--accent)" style={{ flexShrink: 0 }} />
                                <div>
                                    <strong style={{ fontSize: "15px", color: "var(--fg)", display: "block" }}>
                                        Shop is not selected
                                    </strong>
                                    <span style={{ fontSize: "12.5px", color: "var(--fg-muted)" }}>
                                        Please choose a print shop to unlock accurate rates and instant printing.
                                    </span>
                                </div>
                            </div>
                            <Link href="/#shops" className="btn btn-accent btn-sm" style={{ fontWeight: "800", whiteSpace: "nowrap" }}>
                                Click here to select shop →
                            </Link>
                        </div>
                    )}

                    <div className="upload-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "36px" }}>
                        <div>
                            <h1 style={{ fontSize: "32px", fontWeight: "900", letterSpacing: "-0.04em", marginBottom: "8px" }}>Upload Documents</h1>
                            <p style={{ fontSize: "15px", color: "var(--fg-muted)" }}>
                                Printing at: {activeShop?.name || currentOrder.shopName ? (
                                    <strong style={{ color: "var(--accent)" }}>{activeShop?.name || currentOrder.shopName}</strong>
                                ) : (
                                    <Link href="/#shops" style={{ color: "var(--accent)", fontWeight: "800", textDecoration: "underline" }}>
                                        No shop selected (click here to select)
                                    </Link>
                                )}
                            </p>
                        </div>
                        <div className="upload-steps" style={{ display: "flex", gap: "8px", fontSize: "13px", color: "var(--fg-muted)", fontWeight: "700" }}>
                            <span style={{ color: "var(--accent)" }}>Upload</span><span>→</span><span>Payment</span><span>→</span><span>Collect</span>
                        </div>
                    </div>

                    {shopLoading ? (
                        <div className="card selected-shop-card" style={{ padding: "18px", borderRadius: "18px", marginBottom: "28px", display: "grid", gridTemplateColumns: "72px minmax(0,1fr)", gap: "16px", alignItems: "center", border: "1px solid var(--accent-border)", background: "var(--accent-muted)" }}>
                            <div style={{ width: "72px", height: "72px", borderRadius: "16px", background: "var(--bg-secondary)", display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid var(--border)" }}>
                                <span className="spinner" style={{ width: "22px", height: "22px" }} />
                            </div>
                            <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: "6px" }}>
                                <div style={{ fontSize: "16px", fontWeight: "900", color: "var(--accent)" }}>
                                    {currentOrder.shopName ? `Connecting to ${currentOrder.shopName}...` : "Loading Print Shop..."}
                                </div>
                                <p style={{ fontSize: "12px", color: "var(--fg-muted)", margin: 0 }}>Connecting to print shop pricing and finishing add-ons...</p>
                            </div>
                        </div>
                    ) : activeShop ? (
                        <div className="card selected-shop-card" style={{ padding: "18px", borderRadius: "18px", marginBottom: "28px", display: "grid", gridTemplateColumns: "72px minmax(0,1fr)", gap: "16px", alignItems: "center", border: "1px solid var(--accent-border)", background: "var(--accent-muted)" }}>
                            <div style={{ width: "72px", height: "72px", borderRadius: "16px", background: "var(--fg)", color: "var(--bg)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "22px", fontWeight: "900", overflow: "hidden" }}>
                                {activeShop.imageUrl ? (
                                    <img src={activeShop.imageUrl} alt={activeShop.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                                ) : activeShop.imageInitials}
                            </div>
                            <div style={{ minWidth: 0 }}>
                                <h2 style={{ fontSize: "18px", fontWeight: "900", letterSpacing: 0, marginBottom: "5px" }}>{activeShop.name}</h2>
                                <div style={{ display: "flex", gap: "14px", flexWrap: "wrap", fontSize: "12px", fontWeight: "800", color: "var(--fg-muted)" }}>
                                    <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}><Clock size={14} /> {activeShop.openTime} - {activeShop.closeTime}</span>
                                    {activeShop.priceBwPerPage != null ? (
                                        <span>B and W Rs {activeShop.priceBwPerPage.toFixed(2)}</span>
                                    ) : (
                                        <span>B and W price unavailable</span>
                                    )}
                                    {activeShop.priceColorPerPage != null ? (
                                        <span>Color Rs {activeShop.priceColorPerPage.toFixed(2)}</span>
                                    ) : (
                                        <span>Color price unavailable</span>
                                    )}
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="card selected-shop-card" style={{ padding: "28px 24px", borderRadius: "18px", marginBottom: "28px", textAlign: "center", border: "1px dashed var(--accent-border)", background: "var(--accent-muted)" }}>
                            <h2 style={{ fontSize: "18px", fontWeight: "900", marginBottom: "8px" }}>No Print Shop Selected</h2>
                            <p style={{ fontSize: "14px", color: "var(--fg-muted)", marginBottom: "18px" }}>
                                Please select a print shop first to view pricing and upload documents.
                            </p>
                            <Link href="/#shops" className="btn btn-accent btn-sm">
                                Select Print Shop
                            </Link>
                        </div>
                    )}

                    {orderPaused && (
                        <div className="card" style={{ padding: "16px 18px", borderRadius: "12px", border: "1px solid var(--accent-border)", background: "var(--accent-muted)", color: "var(--accent)", display: "flex", alignItems: "flex-start", gap: "10px", marginBottom: "22px" }}>
                            <AlertTriangle size={18} style={{ marginTop: "2px", flexShrink: 0 }} />
                            <div>
                                <p style={{ fontSize: "14px", fontWeight: "900", marginBottom: "3px" }}>New orders paused</p>
                                <p style={{ fontSize: "13px", fontWeight: "700", lineHeight: 1.5, color: "var(--fg-muted)" }}>
                                    This shop is closing in 5-10 minutes. {shopAvailability?.reason || "Please choose another time."}
                                </p>
                            </div>
                        </div>
                    )}

                    {searchParams.get("fromCart") && files.length > 0 && (
                        <div className="card" style={{ padding: "14px 18px", borderRadius: "12px", border: "1px solid var(--accent)", background: "var(--accent-muted)", display: "flex", alignItems: "center", gap: "10px", marginBottom: "22px" }}>
                            <CheckCircle size={18} color="var(--accent)" style={{ flexShrink: 0 }} />
                            <div>
                                <p style={{ fontSize: "13px", fontWeight: "800", color: "var(--fg)" }}>Files loaded from your cart</p>
                                <p style={{ fontSize: "12px", color: "var(--fg-muted)" }}>
                                    Your existing documents have been restored. You can add more files below before updating your cart.
                                </p>
                            </div>
                        </div>
                    )}

                    {error && <p role="alert" style={{ padding: "16px", marginBottom: "20px", border: "1px solid var(--accent-border)", borderRadius: "8px", overflowWrap: "anywhere" }}>{error}</p>}
                    <div className={`upload-layout ${files.length > 0 ? "with-summary" : ""}`} style={{ display: "grid", gap: "32px", alignItems: "start" }}>
                        {/* Dropzone & List */}
                        <div style={{ display: "flex", flexDirection: "column", gap: "24px", minWidth: 0 }}>
                            <div className="upload-dropzone" onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
                                onDrop={e => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files) handleFiles(e.dataTransfer.files); }}
                                onClick={() => fileRef.current?.click()}
                                role="button" tabIndex={0} aria-label="Add documents"
                                onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileRef.current?.click(); } }}
                                style={{
                                    border: `2.5px dashed ${dragging ? "var(--accent)" : "var(--border-strong)"}`,
                                    borderRadius: "24px",
                                    padding: files.length > 0 ? "40px" : "80px 40px",
                                    textAlign: "center",
                                    cursor: "pointer",
                                    background: dragging ? "var(--accent-muted)" : "var(--bg-secondary)",
                                    transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
                                    boxShadow: dragging ? "var(--shadow-accent)" : "none"
                                    }}>
                                <div style={{ display: "flex", justifyContent: "center", marginBottom: "20px" }}>
                                    <div style={{ width: "64px", height: "64px", borderRadius: "20px", background: dragging ? "var(--accent)" : "var(--bg)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "var(--shadow-sm)" }}>
                                        <Plus size={32} color={dragging ? "#fff" : "var(--accent)"} />
                                    </div>
                                </div>
                                <p style={{ fontSize: "18px", fontWeight: "800", marginBottom: "4px" }}>{files.length > 0 ? "Add more files" : "Select your documents"}</p>
                                <p style={{ fontSize: "14px", color: "var(--fg-muted)" }}>Drag and drop or click to browse</p>
                                <p style={{ fontSize: "12px", color: "var(--fg-muted)", marginTop: "8px" }}>PDF, JPG, PNG or WebP. Up to 20 MB and 500 pages per file.</p>
                                <input ref={fileRef} type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp"
                                    style={{ display: "none" }} onChange={e => e.target.files && handleFiles(e.target.files)} />
                            </div>

                            {files.length > 0 && (
                                <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                                    {files.length > 1 && (
                                        <div className="card" style={{ padding: "18px 20px", borderRadius: "16px", border: "1px solid var(--accent-border)", background: "var(--accent-muted)" }}>
                                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
                                                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                                                    <div style={{ width: "34px", height: "34px", borderRadius: "10px", background: "var(--bg)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--accent)" }}>
                                                        <Settings size={17} />
                                                    </div>
                                                    <div>
                                                        <p style={{ fontSize: "14px", fontWeight: "800" }}>Global Print Settings</p>
                                                        <p style={{ fontSize: "12px", color: "var(--fg-muted)" }}>Use one shared setting for all files</p>
                                                    </div>
                                                </div>
                                                <label className="toggle-wrap">
                                                    <button type="button" role="switch" aria-label="Global Print Settings" aria-checked={globalApplyEnabled} className={`toggle ${globalApplyEnabled ? "on" : ""}`} onClick={() => setGlobalApplyEnabled(prev => !prev)}>
                                                        <span className="toggle-knob" />
                                                    </button>
                                                    <span style={{ fontSize: "12px", fontWeight: "700", color: "var(--fg-muted)" }}>{globalApplyEnabled ? "ON" : "OFF"}</span>
                                                </label>
                                            </div>
                                            {globalApplyEnabled && (
                                                <button className="btn btn-outline btn-sm" style={{ marginTop: "12px" }} onClick={applyFirstFileSettingsToAll}>
                                                    Apply first file settings to all
                                                </button>
                                            )}
                                        </div>
                                    )}
                                    {files.map(f => (
                                        <div key={f.id} className="card upload-file-card" style={{ padding: "24px", borderRadius: "20px", border: editingFileId === f.id ? "2px solid var(--accent)" : "1px solid var(--border)", transition: "all 0.3s" }}>
                                            <div className="upload-file-row" style={{ display: "flex", gap: "20px", alignItems: "center" }}>
                                                <div style={{ width: "60px", height: "80px", background: "var(--bg-tertiary)", borderRadius: "12px", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, border: "1px solid var(--border)" }}>
                                                    {f.preview || f.analysis?.pages[0]?.thumbnail ? (
                                                        <img src={f.preview || f.analysis?.pages[0]?.thumbnail} alt="First page" style={{ width: "100%", height: "100%", objectFit: "contain", filter: f.settings.color === "bw" ? "grayscale(1)" : undefined }} />
                                                    ) : (
                                                        <FileText size={24} color="var(--fg-subtle)" />
                                                    )}
                                                </div>
                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                    <p style={{ fontSize: "16px", fontWeight: "700", marginBottom: "4px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{f.file.name}</p>
                                                    <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", color: "var(--fg-muted)", fontSize: "13px", fontWeight: "600" }}>
                                                        <span>{(f.file.size / 1024).toFixed(1)} KB</span>
                                                        <span>•</span>
                                                        <span>{f.status === "queued" ? "Waiting to upload" : f.status === "saving" ? "Saving print settings…" : f.status === "analyzing" ? `Analysing ${f.analysis?.pages.length || 0} of ${f.analysis?.pageCount || "…"} pages` : f.status === "uploading" ? `Uploading ${f.uploadProgress || 0}%` : f.status === "deleting" ? "Deleting..." : f.status === "error" ? "Needs attention" : `${f.pages} ${f.pages === 1 ? "page" : "pages"}`}</span>
                                                        <span className="badge badge-accent" style={{ fontSize: "10px" }}>{f.settings.color === "bw" ? "B&W" : "Color"}</span>
                                                        {f.settings.addonIds && f.settings.addonIds.length > 0 && (
                                                            <span className="badge" style={{ fontSize: "10px", background: "var(--accent)", color: "#fff" }}>
                                                                ✨ {f.settings.addonIds.length} finishing
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                                <div className="upload-file-actions" style={{ display: "flex", gap: "10px" }}>
                                                    <button aria-label={`Print settings for ${f.file.name}`} title="Print settings and live preview" disabled={uploading || f.status !== "ready"} onClick={() => setEditingFileId(editingFileId === f.id ? null : f.id)} className="btn btn-outline" style={{ width: "44px", height: "44px", padding: 0, borderRadius: "12px" }}>
                                                        <Settings2 size={20} />
                                                    </button>
                                                    <button aria-label={`Remove ${f.file.name}`} title="Remove file" disabled={uploading || f.status === "deleting"} onClick={() => removeFile(f.id)} className="btn btn-ghost" style={{ width: "44px", height: "44px", padding: 0, borderRadius: "12px", color: "var(--fg-subtle)" }}>
                                                        <Trash2 size={20} />
                                                    </button>
                                                </div>
                                            </div>

                                            {f.status === 'uploading' && <progress className="upload-progress" aria-label={`Uploading ${f.file.name}`} max={100} value={f.uploadProgress || 0} />}
                                            {(f.status === 'analyzing' || f.status === 'saving') && <progress className="upload-progress" aria-label={f.status === 'saving' ? 'Saving print settings' : 'Analysing document'} />}
                                            {f.status === 'error' && !f.dbId && <button className="btn btn-outline" disabled={orderPaused} onClick={() => { setFiles(current => current.map(item => item.id === f.id ? { ...item, status: 'queued', analysisError: undefined } : item)); queueUpload(f, shopData?.id || shopParam || currentOrder.shopId); }}>Retry file</button>}
                                            {f.analysisError && <p role="alert" style={{ fontSize: "13px", marginTop: "12px", overflowWrap: "anywhere" }}>{f.analysisError}</p>}
                                            {f.status === "ready" && (
                                                <div className="mobile-only mobile-document-detail">
                                                    <span className="mobile-doc-specs">
                                                        {f.settings.color === "bw" ? "B&W" : "Color"} · {f.settings.sides === "single" ? "Single-sided" : "Double-sided"} · {f.settings.paperSize.toUpperCase()}
                                                    </span>
                                                    {pricingAvailable && (
                                                        <strong className="mobile-doc-price">
                                                            ₹{documentPrintTotals(f, { bwPerPage: bwPrice, colorPerPage: colorPrice }).amount.toFixed(2)}
                                                        </strong>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Order Summary Sidebar */}
                        {files.length > 0 && (
                            <div className="upload-summary" style={{ position: "sticky", top: "150px" }}>
                                <div className="card" style={{ padding: "32px", borderRadius: "28px", background: "var(--fg)", color: "var(--bg)", boxShadow: "var(--shadow-lg)" }}>
                                    <h2 style={{ fontSize: "20px", fontWeight: "800", marginBottom: "24px" }}>Order Details</h2>

                                    <div style={{ display: "flex", flexDirection: "column", gap: "16px", marginBottom: "32px" }}>
                                        <div style={{ display: "flex", justifyContent: "space-between", opacity: 0.7, fontSize: "14px" }}>
                                            <span>Total Files</span>
                                            <span>{files.length}</span>
                                        </div>
                                        <div style={{ display: "flex", justifyContent: "space-between", opacity: 0.7, fontSize: "14px" }}>
                                            <span>Total Printable Sheets</span>
                                            <span>{documentsReady ? files.reduce((acc, f) => acc + ((f.settings.sides === "single" ? printablePages(f) : Math.ceil(printablePages(f) / 2)) * f.settings.copies), 0) : "Checking..."}</span>
                                        </div>
                                        <div style={{ height: "1px", background: "rgba(255,255,255,0.1)" }} />
                                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "18px", fontWeight: "900" }}>
                                            <span>Estimated Price</span>
                                            <span style={{ color: "var(--accent)" }}>{validSelection && totalAmount !== null ? `Rs ${totalAmount.toFixed(2)}` : "--"}</span>
                                        </div>
                                    </div>

                                    <button onClick={handleContinue} className="btn btn-accent btn-full btn-lg" style={{ height: "60px", borderRadius: "18px", fontSize: "16px", fontWeight: "900" }} disabled={uploading || orderPaused || !validSelection || totalAmount === null}>
                                        {uploading ? <><span className="spinner" /> Checking files</> : <><CheckCircle size={20} /> Confirm & Pay</>}
                                    </button>

                                    <p style={{ fontSize: "12px", opacity: 0.7, textAlign: "center", marginTop: "16px" }}>
                                        {documentsReady && totalAmount === null
                                            ? "Shop pricing is not configured. Please contact the vendor."
                                            : documentsReady && !validSelection
                                            ? "Choose a valid page range for each file."
                                            : "Review your total before payment."}
                                    </p>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </section>

            <style>{`
                .upload-layout.with-summary {
                    grid-template-columns: minmax(0, 1fr) 380px;
                }
                @media (max-width: 992px) {
                    .upload-layout.with-summary {
                        grid-template-columns: 1fr;
                    }
                    .upload-summary {
                        position: relative !important;
                        top: 0 !important;
                    }
                }
                @media (max-width: 640px) {
                    .upload-head {
                        align-items: flex-start !important;
                        flex-direction: column !important;
                        gap: 14px !important;
                        margin-bottom: 26px !important;
                    }
                    .upload-head h1 {
                        font-size: 28px !important;
                    }
                    .upload-steps {
                        width: 100%;
                        justify-content: space-between;
                    }
                    .selected-shop-card {
                        grid-template-columns: 56px minmax(0, 1fr) !important;
                        gap: 12px !important;
                        padding: 14px !important;
                        border-radius: 12px !important;
                    }
                    .selected-shop-card > div:first-child {
                        width: 56px !important;
                        height: 56px !important;
                        border-radius: 12px !important;
                    }
                    .upload-file-row {
                        align-items: flex-start !important;
                        gap: 12px !important;
                    }
                    .upload-file-actions {
                        flex-direction: column !important;
                        gap: 8px !important;
                    }
                    .upload-layout .card {
                        border-radius: 12px !important;
                    }
                    .upload-summary .card {
                        padding: 22px !important;
                        border-radius: 16px !important;
                    }
                }
            `}</style>

            {editingFileId && files.find(f => f.id === editingFileId) && (
                <PrintSettingsModal
                    file={files.find(f => f.id === editingFileId)!}
                    onClose={() => setEditingFileId(null)}
                    error={error}
                    onSave={async (newSettings, applyAll) => {
                        if (await updateFileSettings(editingFileId, newSettings, applyAll || globalApplyEnabled)) setEditingFileId(null);
                    }}
                    hasMultiple={files.length > 1}
                    shopId={shopData?.id || currentOrder.shopId || shopParam || undefined}
                />
            )}
        </div>
    );
}

export default function UploadPage() {
    return (
        <Suspense fallback={
            <div style={{ minHeight: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span className="spinner spinner-lg" />
            </div>
        }>
            <UploadPageContent />
        </Suspense>
    );
}

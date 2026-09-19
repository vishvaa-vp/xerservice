/**
 * XerService Desktop Runtime Foundation Entry Point
 */

import {
    abortPrintJob,
    cancelNativePrintJob,
    dispatchPrintJob,
    downloadVendorOrderDocument,
    fetchPrintingCapabilities,
    fetchPrintJobRecord,
    fetchPrintJobStatus,
    fetchPersistedPrintJobs,
    fetchPrinters,
    fetchRuntimeInfo,
    fetchOrderPrintJob,
    fetchVendorQueueOrders,
    getPrintQueue,
    recordFrontendTelemetry,
    saveTemporaryDocument,
    triggerRecoveryReconciliation,
    updateVendorOrderStatus,
    fetchVendorOverview,
    fetchVendorShopProfile,
    updateVendorShopProfile,
    fetchVendorStatements,
    downloadVendorStatementCsv,
    downloadVendorOrderDocumentOriginal,
    fetchOrderPricingAudit,
    TempDocumentInfo,
    VendorQueueOrder,
    VendorOrderFile,
    VendorOverviewData,
    VendorShopProfileData,
    VendorStatementData,
    VendorStatementTransaction,
    DEFAULT_BACKEND_URL,
} from './ipc';
import {
    fromDbPrintSettings,
    selectedPageNumbers,
    sheetDimensions,
    formatPrintSidesMode,
    formatDocumentPages,
    formatPrintableSides,
    formatPhysicalSheets,
    formatPaperSidesAndSheets,
    formatOrderStatus,
    formatPaperSizeName,
    formatColourModeName,
    formatFinishingServiceName,
    evaluateHonestConnectivity,
    type HonestConnectivityInputs,
    type HonestConnectivitySnapshot,
    evaluatePrintRetrySafety,
    type PrintRetrySafetySnapshot,
} from '@packages/shared';
import type { PdfViewer } from './pdf-viewer';
import { validateJobAgainstPrinter } from '@packages/printing';
import type {
    NormalizedPrinter,
    PrintJobRecord,
    PrintJobRequest,
    PrintJobResult,
    PrintQueueItem,
} from '@packages/printing';
import { authenticateVendor, signOutVendor, type AuthenticatedVendorSession } from './supabase';

let discoveredPrinters: NormalizedPrinter[] = [];
let loadedVendorOrders: VendorQueueOrder[] = [];
let selectedDrawerOrder: VendorQueueOrder | null = null;
let currentBackendUrl: string = DEFAULT_BACKEND_URL;
let ui_lastSyncTimestamp: number | null = null;
let ui_backendReachable: boolean = true;
let ui_backendLatencyMs: number | undefined = undefined;

async function processOrderFile(
    order: VendorQueueOrder,
    printerId: string,
    token: string,
    backendUrl?: string
): Promise<{ success: boolean; error?: string; localJobId?: string; nativeJobId?: string; status?: string }> {
    const effectiveBackendUrl = backendUrl || currentBackendUrl || DEFAULT_BACKEND_URL;

    // 1. Order validity checks
    if (!order || !order.id) {
        return { success: false, error: 'INVALID_ORDER: Order object is null or missing ID.' };
    }
    if (order.payment_status !== 'PAID') {
        return {
            success: false,
            error: `UNPAID_ORDER_BLOCKED: Order ${order.order_number} payment status is ${order.payment_status}. Only PAID orders can be printed.`,
        };
    }
    if (order.status !== 'QUEUED' && order.status !== 'PRINTING') {
        return {
            success: false,
            error: `INVALID_STATUS_BLOCKED: Order ${order.order_number} status is ${order.status}. Only QUEUED or PRINTING orders can be printed.`,
        };
    }

    if (!order.order_files?.length) return { success: false, error: 'No printable documents.' };
    const mappingId = `${order.id}:${order.order_files[0].id}`;

    // 2. Pre-flight duplicate check against persistent store (In-memory & SQLite / JSON)
    const existingMapping = await fetchOrderPrintJob(mappingId);
    if (existingMapping) {
        if (existingMapping.status === 'QUEUED' || existingMapping.status === 'PRINTING' || existingMapping.status === 'COMPLETED') {
            return {
                success: false,
                error: `DUPLICATE_PRINT_BLOCKED: Order ${order.order_number} already has an active or completed print job (${existingMapping.localJobId}) with status ${existingMapping.status}.`,
                localJobId: existingMapping.localJobId,
                nativeJobId: existingMapping.nativeJobId,
                status: existingMapping.status,
            };
        }
    }

    // 3. Target printer discovery check
    const printers = await fetchPrinters();
    discoveredPrinters = printers;
    const targetPrinter = printers.find(p => p.printerId === printerId);
    if (!targetPrinter) {
        return {
            success: false,
            error: `PRINTER_NOT_FOUND: Target printer '${printerId}' is not discovered or offline.`,
        };
    }

    // 4. Document and print settings resolution
    if (!order.order_files || order.order_files.length === 0) {
        return {
            success: false,
            error: `NO_DOCUMENTS: Order ${order.order_number} has no printable files attached.`,
        };
    }
    const file = order.order_files[0];
    const rawSettings = Array.isArray(file.print_settings) ? file.print_settings[0] : file.print_settings;
    const settings = fromDbPrintSettings(rawSettings as any || {});

    const localJobId = `job-${order.id}-${file.id}-${Date.now()}`;
    const jobRequest: PrintJobRequest = {
        jobId: localJobId, orderId: mappingId, orderNumber: order.order_number,
        fileId: file.id, fileName: file.original_filename || 'document.pdf',
        documentUri: `${effectiveBackendUrl}/api/vendor/orders/${order.id}/files/${file.id}/download`,
        mimeType: 'application/pdf', copies: settings.copies, colorMode: settings.color,
        paperSize: settings.paperSize, duplexMode: settings.sides,
        shopId: order.shop_id, destination: { printerId: targetPrinter.printerId },
        createdAt: new Date().toISOString(), settings,
    };

    // 5. Capability validation (Fail-closed)
    const validation = validateJobAgainstPrinter(jobRequest, targetPrinter);
    if (!validation.valid && validation.error) {
        return {
            success: false,
            error: `CAPABILITY_MISMATCH: ${validation.error.message}`,
        };
    }

    // 6. Download authorized document via vendor Bearer token
    let downloadResult: { buffer: ArrayBuffer; filename: string; mimeType: string };
    try {
        downloadResult = await downloadVendorOrderDocument(effectiveBackendUrl, token, order.id, file.id);
    } catch (err: any) {
        return {
            success: false,
            error: `DOWNLOAD_FAILED: Could not download customer document: ${err?.message || 'Network error'}`,
        };
    }

    // 7. Save temporary document in Rust & compute SHA-256 fingerprint
    let tempDocInfo: TempDocumentInfo;
    try {
        tempDocInfo = await saveTemporaryDocument(localJobId, downloadResult.filename, new Uint8Array(downloadResult.buffer));
    } catch (err: any) {
        return {
            success: false,
            error: `TEMP_SAVE_FAILED: Failed to stage document for spooling: ${err?.message || 'IO error'}`,
        };
    }

    // 8. Submit to native CUPS print engine
    let submissionResult: PrintJobResult;
    try {
        submissionResult = await dispatchPrintJob({
            ...jobRequest,
            orderId: mappingId,
            documentPath: tempDocInfo.tempPath,
            documentFingerprint: tempDocInfo.sha256Fingerprint,
            destination: { printerId: targetPrinter.printerId },
        });
    } catch (err: any) {
        return {
            success: false,
            error: `SUBMISSION_ERROR: ${err?.message || 'Unknown submission error'}`,
            localJobId,
        };
    }

    if (submissionResult.status === 'FAILED') {
        return {
            success: false,
            error: `PRINT_SUBMISSION_FAILED: ${submissionResult.error?.message || 'Native submission rejected by CUPS.'}`,
            localJobId,
            status: 'FAILED',
        };
    }

    // 9. Transition order status: QUEUED -> PRINTING
    if (order.status === 'QUEUED') {
        try {
            await updateVendorOrderStatus(effectiveBackendUrl, token, order.id, 'QUEUED', 'PRINTING');
        } catch (statusErr: any) {
            console.warn('[XerService Desktop] Order status transition to PRINTING notice:', statusErr?.message);
        }
    }

    // 10. Check if CUPS spooler completed synchronously or shortly after submission
    let finalStatus = submissionResult.status;
    if (submissionResult.nativeJobId) {
        try {
            const currentNative = await fetchPrintJobStatus(localJobId, targetPrinter.printerId);
            if (currentNative.status === 'COMPLETED') {
                finalStatus = 'COMPLETED';
            }
        } catch {
            // Non-blocking status query
        }
    }

    return {
        success: true,
        localJobId,
        nativeJobId: submissionResult.nativeJobId,
        status: finalStatus,
    };
}

const activeOrderSubmissions = new Set<string>();
export async function processOrderPrint(order: VendorQueueOrder, printerId: string, token: string, backendUrl?: string) {
    if (!order?.id || !order.order_files?.length) return { success: false, error: 'No printable documents.' };
    if (activeOrderSubmissions.has(order.id)) return { success: false, error: 'DUPLICATE_PRINT_BLOCKED: This order is already being submitted.' };
    if (order.has_active_refund) return { success: false, error: 'This order has a pending refund. Resolve it before printing.' };
    activeOrderSubmissions.add(order.id);
    try {
        // Legacy mappings represented one file only. Never blindly reprint an old order.
        if (await fetchOrderPrintJob(order.id)) return { success: false, error: 'This order has a previous print job. Review the print queue before continuing.' };
        let last: Awaited<ReturnType<typeof processOrderFile>> | undefined;
        for (const file of order.order_files) {
            const existing = await fetchOrderPrintJob(`${order.id}:${file.id}`);
            if (existing) {
                if (['QUEUED', 'PRINTING', 'COMPLETED'].includes(existing.status)) continue;
                return { success: false, error: 'A document needs print-job review. It will not be automatically reprinted.' };
            }
            last = await processOrderFile({ ...order, order_files: [file] }, printerId, token, backendUrl);
            if (!last.success) return last;
        }
        await syncOrderPrintStatus(order.id, backendUrl, token);
        return last || { success: true, status: 'PRINTING' };
    } finally { activeOrderSubmissions.delete(order.id); }
}

/** Native completion is evidence for a transition, never proof that the backend accepted it. */
export async function syncOrderPrintStatus(orderId: string, backendUrl?: string, token?: string): Promise<{ orderStatus: string; printStatus?: string; transitioned: boolean }> {
    const url = backendUrl || currentBackendUrl;
    if (!token) return { orderStatus: 'UNKNOWN', transitioned: false };
    const orders = await fetchVendorQueueOrders(url, token);
    const order = orders.find(item => item.id === orderId);
    if (!order) return { orderStatus: 'UNKNOWN', transitioned: false };
    const legacy = await fetchOrderPrintJob(orderId);
    const mappings = legacy && order.order_files.length === 1 ? [legacy] : await Promise.all(order.order_files.map(file => fetchOrderPrintJob(`${orderId}:${file.id}`)));
    if (!mappings.length || mappings.some(mapping => !mapping)) return { orderStatus: order.status, transitioned: false };
    const statuses = await Promise.all(mappings.map(async mapping => {
        if (!mapping) return 'UNKNOWN';
        if (mapping.status === 'COMPLETED') return 'COMPLETED';
        if (!mapping.nativeJobId) return mapping.status;
        try { return (await fetchPrintJobStatus(mapping.localJobId, mapping.printerId)).status; }
        catch { return 'UNKNOWN'; }
    }));
    const complete = statuses.every(status => status === 'COMPLETED');
    let state = order.status;
    let transitioned = false;
    if (state === 'QUEUED') {
        await updateVendorOrderStatus(url, token, orderId, 'QUEUED', 'PRINTING');
        state = 'PRINTING'; transitioned = true;
    }
    if (state === 'PRINTING' && complete && !order.order_files.some(file => file.addons?.length)) {
        await updateVendorOrderStatus(url, token, orderId, 'PRINTING', 'READY');
        state = 'READY'; transitioned = true;
    }
    return { orderStatus: state, printStatus: complete ? 'COMPLETED' : statuses.includes('FAILED') ? 'FAILED' : 'PRINTING', transitioned };
}

async function bootstrap() {
    console.log('[XerService Desktop] Initializing Desktop Runtime Foundation...');

    // STAGE B: Signal that WebView has loaded and JS runtime is active
    await recordFrontendTelemetry('STAGE_B_WEBVIEW_LOADED', undefined, 'DOM content loaded; JS runtime initialized in Tauri WebView');

    // 1. get_runtime_info
    await recordFrontendTelemetry('STAGE_C_INVOKE_CALLED', 'get_runtime_info', 'Calling invoke("get_runtime_info") via @tauri-apps/api/core');
    const runtime = await fetchRuntimeInfo();
    currentBackendUrl = runtime.backendUrl || DEFAULT_BACKEND_URL;
    await recordFrontendTelemetry('STAGE_F_RESPONSE_PROCESSED', 'get_runtime_info', `Received appName="${runtime.appName}", platform="${runtime.platform}", isNative=${runtime.isNativeRuntime}`);

    // 2. get_printing_capabilities
    await recordFrontendTelemetry('STAGE_C_INVOKE_CALLED', 'get_printing_capabilities', 'Calling invoke("get_printing_capabilities") via @tauri-apps/api/core');
    const capabilities = await fetchPrintingCapabilities();
    await recordFrontendTelemetry('STAGE_F_RESPONSE_PROCESSED', 'get_printing_capabilities', `Received platform="${capabilities.platform}", silent=${capabilities.supportsSilentPrinting}`);

    // 3. list_printers
    await recordFrontendTelemetry('STAGE_C_INVOKE_CALLED', 'list_printers', 'Calling invoke("list_printers") via @tauri-apps/api/core');
    const printers = await fetchPrinters();
    discoveredPrinters = printers;
    await recordFrontendTelemetry('STAGE_F_RESPONSE_PROCESSED', 'list_printers', `Received ${printers.length} printers from host OS`);

    const elAppName = document.getElementById('val-app-name');
    const elVersion = document.getElementById('val-version');
    const elTauriVersion = document.getElementById('val-tauri-version');
    const elPlatform = document.getElementById('val-platform');
    const elBackendUrl = document.getElementById('val-backend-url');
    const elPrintStatus = document.getElementById('val-print-status');
    const elCapsStatus = document.getElementById('val-caps-status');
    const elPrintersCount = document.getElementById('val-printers-count');
    const elPrintersDetail = document.getElementById('val-printers-detail');
    const elRuntimeBadge = document.getElementById('val-runtime-badge');

    if (elAppName) elAppName.textContent = runtime.appName;
    if (elVersion) elVersion.textContent = runtime.version;
    if (elTauriVersion) elTauriVersion.textContent = runtime.tauriVersion;
    if (elPlatform) elPlatform.textContent = runtime.platform;
    if (elBackendUrl) elBackendUrl.textContent = runtime.backendUrl;
    if (elPrintStatus) elPrintStatus.textContent = runtime.printSubsystemStatus;
    if (elCapsStatus) {
        elCapsStatus.textContent = capabilities.platform === 'unsupported'
            ? 'NO_NATIVE_ADAPTER'
            : `${capabilities.platform} (CUPS Discovery Active)`;
    }
    if (elPrintersCount) {
        elPrintersCount.textContent = `${printers.length} Installed`;
    }
    if (elPrintersDetail) {
        elPrintersDetail.textContent = printers.length === 0
            ? '0 OS destinations (Matches host lpstat)'
            : printers.map(p => p.name).join(', ');
    }
    if (elRuntimeBadge) {
        elRuntimeBadge.textContent = runtime.isNativeRuntime
            ? 'NATIVE TAURI v2 RUNTIME'
            : 'WEB FALLBACK (NOT NATIVE)';
        if (!runtime.isNativeRuntime) {
            elRuntimeBadge.classList.add('fallback-mode');
        }
    }

    // Initial queue load and wire up refresh button
    await refreshQueueUI();

    const btnRefresh = document.getElementById('btn-refresh-queue-legacy');
    if (btnRefresh) {
        btnRefresh.addEventListener('click', async () => {
            await refreshQueueUI();
        });
    }

    // 8. Initial persisted jobs load and wire up persisted table buttons
    await refreshPersistedJobsUI();

    const btnRefreshPersisted = document.getElementById('btn-refresh-persisted-legacy');
    if (btnRefreshPersisted) {
        btnRefreshPersisted.addEventListener('click', async () => {
            await refreshPersistedJobsUI();
        });
    }

    const btnReconcile = document.getElementById('btn-reconcile-recovery');
    if (btnReconcile) {
        btnReconcile.addEventListener('click', async () => {
            btnReconcile.setAttribute('disabled', 'true');
            const originalText = btnReconcile.textContent;
            btnReconcile.textContent = 'Reconciling...';
            try {
                await triggerRecoveryReconciliation();
                await refreshPersistedJobsUI();
            } finally {
                btnReconcile.removeAttribute('disabled');
                btnReconcile.textContent = originalText;
            }
        });
    }

    // 9. Step 17: Vendor Orders Setup
    const inputToken = document.getElementById('input-vendor-token') as HTMLInputElement | null;

    const btnRefreshOrders = document.getElementById('btn-refresh-orders-legacy');
    if (btnRefreshOrders) {
        btnRefreshOrders.addEventListener('click', async () => {
            await refreshVendorOrdersUI();
        });
    }

    const btnCloseDrawer = document.getElementById('btn-close-drawer');
    const drawer = document.getElementById('order-print-drawer');
    if (btnCloseDrawer && drawer) {
        btnCloseDrawer.addEventListener('click', () => {
            drawer.style.display = 'none';
            selectedDrawerOrder = null;
        });
    }

    const selectPrinter = document.getElementById('select-order-printer') as HTMLSelectElement | null;
    const validationBox = document.getElementById('drawer-validation-box');
    const btnStartPrinting = document.getElementById('btn-start-printing') as HTMLButtonElement | null;
    const spinner = document.getElementById('print-progress-spinner');

    if (selectPrinter && validationBox && btnStartPrinting) {
        selectPrinter.addEventListener('change', async () => {
            const chosenId = selectPrinter.value;
            if (!chosenId || !selectedDrawerOrder) {
                validationBox.textContent = 'Select printer to validate capabilities.';
                validationBox.style.color = 'var(--text-secondary)';
                btnStartPrinting.disabled = true;
                return;
            }

            const targetP = discoveredPrinters.find(p => p.printerId === chosenId);
            if (!targetP) {
                validationBox.textContent = `Target printer '${chosenId}' is not discovered.`;
                validationBox.style.color = '#ef4444';
                btnStartPrinting.disabled = true;
                return;
            }

            // Pre-flight duplicate check
            const existingJob = await fetchOrderPrintJob(selectedDrawerOrder.id);
            if (existingJob && (existingJob.status === 'QUEUED' || existingJob.status === 'PRINTING' || existingJob.status === 'COMPLETED')) {
                validationBox.textContent = `❌ Duplicate print blocked: Order already has an active or completed print job (${existingJob.localJobId} / ${existingJob.status}).`;
                validationBox.style.color = '#ef4444';
                btnStartPrinting.disabled = true;
                return;
            }

            const file = selectedDrawerOrder.order_files[0];
            const settings = file?.print_settings;
            const probeJob: PrintJobRequest = {
                jobId: `probe-${selectedDrawerOrder.id}`,
                orderId: selectedDrawerOrder.id,
                orderNumber: selectedDrawerOrder.order_number,
                fileId: file?.id || 'file-1',
                fileName: file?.original_filename || 'doc.pdf',
                documentUri: 'local://probe',
                mimeType: file?.mime_type || 'application/pdf',
                copies: settings?.copies ?? 1,
                colorMode: (settings?.colour_mode === 'colour' || settings?.colour_mode === 'color') ? 'color' : 'bw',
                paperSize: (settings?.paper_size?.toLowerCase() as any) || 'a4',
                duplexMode: (settings?.sides === 'double_long' || settings?.sides === 'double_short' || settings?.sides === 'double') ? 'double_long' : 'single',
                shopId: selectedDrawerOrder.shop_id,
                destination: { printerId: targetP.printerId },
                createdAt: new Date().toISOString(),
                settings: {
                    copies: settings?.copies ?? 1,
                    color: (settings?.colour_mode === 'colour' || settings?.colour_mode === 'color') ? 'color' : 'bw',
                    sides: (settings?.sides === 'double_long' || settings?.sides === 'double_short' || settings?.sides === 'double') ? 'double_long' : 'single',
                    paperSize: (settings?.paper_size?.toLowerCase() as any) || 'a4',
                    orientation: (settings?.orientation as any) || 'portrait',
                    pagesPerSheet: 1,
                    pageRange: (settings?.page_range as any) || 'all',
                    customRange: '',
                    margins: 'default',
                    scale: 'fit',
                    headersFooters: false,
                },
            };

            const val = validateJobAgainstPrinter(probeJob, targetP);
            if (!val.valid) {
                validationBox.textContent = `⚠️ Capability Validation Error: ${val.error?.message || 'Unsupported settings'}`;
                validationBox.style.color = '#f59e0b';
                btnStartPrinting.disabled = true;
            } else {
                validationBox.textContent = `✓ Discovered printer '${targetP.name}' verified compatible with order print settings. Ready to print.`;
                validationBox.style.color = 'var(--accent-cyan)';
                btnStartPrinting.disabled = false;
            }
        });

        btnStartPrinting.addEventListener('click', async () => {
            if (!selectedDrawerOrder) return;
            const chosenId = selectPrinter.value;
            if (!chosenId) return;

            const token = inputToken?.value.trim() || '';
            if (!token) {
                alert('Please enter a valid Vendor Bearer Token first.');
                return;
            }

            btnStartPrinting.disabled = true;
            if (spinner) spinner.style.display = 'inline';

            try {
                const res = await processOrderPrint(selectedDrawerOrder, chosenId, token);
                if (res.success) {
                    alert(`Print job submitted successfully!\nLocal Job ID: ${res.localJobId}\nNative Job ID: ${res.nativeJobId || 'Pending Spooler'}\nStatus: ${res.status}`);
                    if (drawer) drawer.style.display = 'none';
                    selectedDrawerOrder = null;
                    await refreshVendorOrdersUI();
                    await refreshPersistedJobsUI();
                    await refreshQueueUI();
                } else {
                    alert(`Print submission failed:\n${res.error}`);
                    btnStartPrinting.disabled = false;
                }
            } catch (err: any) {
                alert(`Unexpected error: ${err?.message || 'Unknown error'}`);
                btnStartPrinting.disabled = false;
            } finally {
                if (spinner) spinner.style.display = 'none';
            }
        });
    }

    // If a token was saved, attempt initial vendor orders load
    if (inputToken && inputToken.value.trim()) {
        await refreshVendorOrdersUI();
    }
}

async function refreshVendorOrdersUI() {
    const tbody = document.getElementById('vendor-orders-body');
    if (!tbody) return;

    const inputToken = document.getElementById('input-vendor-token') as HTMLInputElement | null;
    const token = inputToken?.value.trim() || '';

    if (!token) {
        tbody.innerHTML = `<tr><td colspan="7" class="queue-empty">Enter vendor bearer token above and click Fetch Orders.</td></tr>`;
        return;
    }

    try {
        const orders = await fetchVendorQueueOrders(currentBackendUrl, token);
        loadedVendorOrders = orders;

        if (orders.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" class="queue-empty">No active queued orders found for this vendor shop.</td></tr>`;
            return;
        }

        tbody.innerHTML = '';
        for (const ord of orders) {
            const row = document.createElement('tr');

            // Order Number
            const tdNumber = document.createElement('td');
            tdNumber.style.fontFamily = 'monospace';
            tdNumber.style.fontWeight = '600';
            tdNumber.textContent = ord.order_number;

            // Customer
            const tdCustomer = document.createElement('td');
            tdCustomer.textContent = ord.customerName || 'Customer';

            // Documents / Pages
            const tdDocs = document.createElement('td');
            const fileCount = ord.order_files?.length || 0;
            tdDocs.textContent = `${fileCount} doc(s) • ${ord.total_printable_pages || 1} pages`;

            // Total Amount
            const tdAmount = document.createElement('td');
            const ordAmt = Number(ord.total_amount);
            tdAmount.textContent = `₹${isNaN(ordAmt) ? '0.00' : ordAmt.toFixed(2)}`;

            // Order Status
            const tdStatus = document.createElement('td');
            const statusPill = document.createElement('span');
            statusPill.className = `pill pill-${ord.status.toLowerCase()}`;
            statusPill.textContent = ord.status;
            tdStatus.appendChild(statusPill);

            // Native Spooler
            const tdSpooler = document.createElement('td');
            const mapping = await fetchOrderPrintJob(ord.id);
            if (mapping) {
                const spoolPill = document.createElement('span');
                spoolPill.className = `pill pill-${mapping.status.toLowerCase()}`;
                spoolPill.textContent = `${mapping.status} (${mapping.nativeJobId || mapping.localJobId.slice(0, 10)})`;
                tdSpooler.appendChild(spoolPill);
            } else {
                tdSpooler.textContent = 'Not Spooled';
                tdSpooler.style.color = 'var(--text-muted)';
                tdSpooler.style.fontSize = '0.75rem';
            }

            // Actions
            const tdAction = document.createElement('td');
            const btnReview = document.createElement('button');
            btnReview.className = 'btn-cancel-job';
            btnReview.style.background = 'var(--accent-cyan)';
            btnReview.style.color = '#000';
            btnReview.style.borderColor = 'var(--accent-cyan)';
            btnReview.textContent = ord.status === 'QUEUED' ? 'Review & Print' : 'View Details';
            btnReview.onclick = () => openOrderPrintDrawer(ord);
            tdAction.appendChild(btnReview);

            row.appendChild(tdNumber);
            row.appendChild(tdCustomer);
            row.appendChild(tdDocs);
            row.appendChild(tdAmount);
            row.appendChild(tdStatus);
            row.appendChild(tdSpooler);
            row.appendChild(tdAction);
            tbody.appendChild(row);
        }
    } catch (err: any) {
        tbody.innerHTML = `<tr><td colspan="7" class="queue-empty" style="color:#ef4444;">Failed to load orders: ${err?.message || 'Unknown error'}</td></tr>`;
    }
}

function openOrderPrintDrawer(order: VendorQueueOrder) {
    selectedDrawerOrder = order;
    const drawer = document.getElementById('order-print-drawer');
    if (!drawer) return;

    const title = document.getElementById('drawer-order-title');
    const docName = document.getElementById('drawer-doc-name');
    const docMeta = document.getElementById('drawer-doc-meta');
    const docSettings = document.getElementById('drawer-doc-settings');
    const docAddons = document.getElementById('drawer-doc-addons');
    const selectPrinter = document.getElementById('select-order-printer') as HTMLSelectElement | null;
    const validationBox = document.getElementById('drawer-validation-box');
    const btnStart = document.getElementById('btn-start-printing') as HTMLButtonElement | null;

    if (title) title.textContent = `Order #${order.order_number} — Native Print Confirmation`;

    const file = order.order_files && order.order_files.length > 0 ? order.order_files[0] : null;
    if (file) {
        if (docName) docName.textContent = file.original_filename || 'document.pdf';
        if (docMeta) docMeta.textContent = `${formatPrintableSides(file.printable_pages || 1)} • ${formatPhysicalSheets(file.physical_sheets || 1)}`;
        const s = file.print_settings;
        if (docSettings) {
            const sidesInfo = formatPrintSidesMode(s?.sides);
            const colourText = formatColourModeName(s?.colour_mode);
            const paperText = formatPaperSizeName(s?.paper_size);
            docSettings.textContent = `${s?.copies || 1} copy(ies) • ${colourText} • ${sidesInfo.shortLabel} • ${paperText}`;
        }
        if (docAddons) {
            docAddons.textContent = file.addons && file.addons.length > 0 ? file.addons.map(a => formatFinishingServiceName(a.name)).join(', ') : 'None';
        }
    } else {
        if (docName) docName.textContent = 'No files';
        if (docMeta) docMeta.textContent = '—';
        if (docSettings) docSettings.textContent = '—';
        if (docAddons) docAddons.textContent = 'None';
    }

    // Populate printer select dropdown
    if (selectPrinter) {
        selectPrinter.innerHTML = '<option value="">-- Select a discovered printer --</option>';
        if (discoveredPrinters.length === 0) {
            const opt = document.createElement('option');
            opt.value = '';
            opt.textContent = '-- 0 Discovered Printers Available on Host --';
            opt.disabled = true;
            selectPrinter.appendChild(opt);
        } else {
            for (const p of discoveredPrinters) {
                const opt = document.createElement('option');
                opt.value = p.printerId;
                opt.textContent = `${p.name} (${p.status})${p.isDefault ? ' [Default]' : ''}`;
                selectPrinter.appendChild(opt);
            }
        }
    }

    if (validationBox) {
        validationBox.textContent = discoveredPrinters.length === 0
            ? 'Host has 0 physical printers. Native spooling requires at least 1 discovered printer destination.'
            : 'Select printer to validate capabilities against order print settings.';
        validationBox.style.color = discoveredPrinters.length === 0 ? '#ef4444' : 'var(--text-secondary)';
    }

    if (btnStart) {
        btnStart.disabled = true;
    }

    drawer.style.display = 'block';
}

async function refreshQueueUI(printerId?: string) {
    const tbody = document.getElementById('queue-table-body');
    if (!tbody) return;

    try {
        const queue = await getPrintQueue(printerId);
        if (queue.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" class="queue-empty">Spooler queue is empty (0 active jobs).</td></tr>`;
            return;
        }

        tbody.innerHTML = '';
        for (const item of queue) {
            const row = document.createElement('tr');

            const tdPrinter = document.createElement('td');
            tdPrinter.textContent = item.printerId;

            const tdJobId = document.createElement('td');
            tdJobId.textContent = item.jobId;

            const tdTitle = document.createElement('td');
            tdTitle.textContent = item.title || 'Untitled Document';

            const tdStatus = document.createElement('td');
            const statusPill = document.createElement('span');
            statusPill.className = `pill pill-${item.status.toLowerCase()}`;
            statusPill.textContent = item.status;
            tdStatus.appendChild(statusPill);

            const tdManaged = document.createElement('td');
            const managedPill = document.createElement('span');
            managedPill.className = `pill ${item.managedByXerService ? 'pill-managed' : 'pill-external'}`;
            managedPill.textContent = item.managedByXerService ? 'XerService' : 'External';
            tdManaged.appendChild(managedPill);

            const tdAction = document.createElement('td');
            if (item.cancellable) {
                const cancelBtn = document.createElement('button');
                cancelBtn.className = 'btn-cancel-job';
                cancelBtn.textContent = 'Cancel';
                cancelBtn.onclick = async () => {
                    cancelBtn.disabled = true;
                    cancelBtn.textContent = 'Cancelling...';
                    await cancelNativePrintJob(item.jobId, item.printerId);
                    await refreshQueueUI(printerId);
                };
                tdAction.appendChild(cancelBtn);
            } else {
                const span = document.createElement('span');
                span.style.color = 'var(--text-muted)';
                span.style.fontSize = '0.75rem';
                span.textContent = item.managedByXerService ? 'Non-cancellable' : 'Protected';
                tdAction.appendChild(span);
            }

            row.appendChild(tdPrinter);
            row.appendChild(tdJobId);
            row.appendChild(tdTitle);
            row.appendChild(tdStatus);
            row.appendChild(tdManaged);
            row.appendChild(tdAction);
            tbody.appendChild(row);
        }
    } catch (err: any) {
        tbody.innerHTML = `<tr><td colspan="6" class="queue-empty" style="color:#ef4444;">Error reading queue: ${err?.message || 'Unknown'}</td></tr>`;
    }
}

async function refreshPersistedJobsUI() {
    const tbody = document.getElementById('persisted-table-body');
    if (!tbody) return;

    try {
        const jobs = await fetchPersistedPrintJobs();
        if (jobs.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" class="queue-empty">No persisted print job records found in durable store.</td></tr>`;
            return;
        }

        tbody.innerHTML = '';
        for (const job of jobs) {
            const row = document.createElement('tr');

            const tdLocalId = document.createElement('td');
            tdLocalId.textContent = job.localJobId;
            tdLocalId.style.fontFamily = 'monospace';
            tdLocalId.style.fontSize = '0.75rem';

            const tdOrderId = document.createElement('td');
            tdOrderId.textContent = job.xerServiceOrderId || '—';
            tdOrderId.style.fontFamily = 'monospace';
            tdOrderId.style.fontSize = '0.75rem';

            const tdNativeId = document.createElement('td');
            tdNativeId.textContent = job.nativeJobId || '—';
            tdNativeId.style.fontFamily = 'monospace';
            tdNativeId.style.fontSize = '0.75rem';

            const tdPrinter = document.createElement('td');
            tdPrinter.textContent = job.printerId || '—';

            const tdStatus = document.createElement('td');
            const statusPill = document.createElement('span');
            statusPill.className = `pill pill-${job.status.toLowerCase()}`;
            statusPill.textContent = job.status;
            tdStatus.appendChild(statusPill);

            const tdRecovery = document.createElement('td');
            const recState = job.recoveryState || 'RECONCILED';
            const recPill = document.createElement('span');
            if (recState === 'INVESTIGATION_REQUIRED') {
                recPill.className = 'pill pill-investigation';
            } else if (recState === 'MISSING_FROM_CUPS') {
                recPill.className = 'pill pill-missing';
            } else {
                recPill.className = 'pill pill-reconciled';
            }
            recPill.textContent = recState;
            tdRecovery.appendChild(recPill);

            const tdUpdated = document.createElement('td');
            try {
                const date = new Date(job.updatedAt);
                tdUpdated.textContent = date.toLocaleTimeString();
            } catch {
                tdUpdated.textContent = job.updatedAt;
            }
            tdUpdated.style.fontSize = '0.75rem';
            tdUpdated.style.color = 'var(--text-muted)';

            row.appendChild(tdLocalId);
            row.appendChild(tdOrderId);
            row.appendChild(tdNativeId);
            row.appendChild(tdPrinter);
            row.appendChild(tdStatus);
            row.appendChild(tdRecovery);
            row.appendChild(tdUpdated);
            tbody.appendChild(row);
        }
    } catch (err: any) {
        tbody.innerHTML = `<tr><td colspan="7" class="queue-empty" style="color:#ef4444;">Error reading persisted jobs: ${err?.message || 'Unknown'}</td></tr>`;
    }
}

// Global declaration for explicit test submission and status query runner
declare global {
    interface Window {
        __xerserviceSubmitTestPrint?: (
            printerId: string,
            settings?: {
                copies?: number;
                colorMode?: 'bw' | 'color';
                paperSize?: 'a4' | 'a3' | 'legal';
                duplexMode?: 'single' | 'double';
            }
        ) => Promise<any>;
        __xerserviceQueryJobStatus?: (jobId: string, printerId?: string) => Promise<any>;
        __xerserviceCancelJob?: (jobId: string, printerId?: string) => Promise<any>;
        __xerserviceGetQueue?: (printerId?: string) => Promise<PrintQueueItem[]>;
        __xerserviceGetPersistedJobs?: () => Promise<PrintJobRecord[]>;
        __xerserviceRecoverJobs?: () => Promise<PrintJobRecord[]>;
        __xerserviceFetchVendorOrders?: (backendUrl: string, token: string) => Promise<VendorQueueOrder[]>;
        __xerserviceProcessOrderPrint?: (
            order: VendorQueueOrder,
            printerId: string,
            token: string,
            backendUrl?: string
        ) => Promise<{
            success: boolean;
            error?: string;
            localJobId?: string;
            nativeJobId?: string;
            status?: string;
        }>;
        __xerserviceGetOrderJobMapping?: (orderId: string) => Promise<PrintJobRecord | null>;
        __xerserviceSyncOrderPrintStatus?: (
            orderId: string,
            backendUrl?: string,
            token?: string
        ) => Promise<{ orderStatus: string; printStatus?: string; transitioned: boolean }>;
    }
}

if (typeof window !== 'undefined') {
    window.__xerserviceSubmitTestPrint = async (printerId: string, settings?: any) => {
        await recordFrontendTelemetry('STAGE_C_INVOKE_CALLED', 'submit_print_job', `Explicit test submission to printer=${printerId}`);
        const res = await dispatchPrintJob({
            jobId: `step12-test-${Date.now()}`,
            orderId: 'step12-test-order',
            orderNumber: 'XS-STEP12',
            fileId: 'test-file-12',
            fileName: 'xerservice-native-print-test.txt',
            documentUri: 'local://test',
            mimeType: 'text/plain',
            copies: settings?.copies ?? 1,
            colorMode: settings?.colorMode ?? 'bw',
            paperSize: settings?.paperSize ?? 'a4',
            duplexMode: settings?.duplexMode ?? 'single',
            shopId: 'test-shop',
            destination: { printerId },
            createdAt: new Date().toISOString(),
            settings: {
                copies: settings?.copies ?? 1,
                color: settings?.colorMode ?? 'bw',
                sides: settings?.duplexMode ?? 'single',
                paperSize: settings?.paperSize ?? 'a4',
                orientation: 'portrait',
                pagesPerSheet: 1,
                pageRange: 'all',
                customRange: '',
                margins: 'default',
                scale: 'fit',
                headersFooters: false,
            },
        });
        await recordFrontendTelemetry('STAGE_F_RESPONSE_PROCESSED', 'submit_print_job', `Explicit test result: status=${res.status}, code=${res.error?.code}`);
        return res;
    };

    window.__xerserviceQueryJobStatus = async (jobId: string, printerId?: string) => {
        return await fetchPrintJobStatus(jobId, printerId);
    };

    window.__xerserviceCancelJob = async (jobId: string, printerId?: string) => {
        return await cancelNativePrintJob(jobId, printerId);
    };

    window.__xerserviceGetQueue = async (printerId?: string) => {
        return await getPrintQueue(printerId);
    };

    window.__xerserviceGetPersistedJobs = async () => {
        return await fetchPersistedPrintJobs();
    };

    window.__xerserviceRecoverJobs = async () => {
        const jobs = await triggerRecoveryReconciliation();
        await refreshPersistedJobsUI();
        return jobs;
    };

    window.__xerserviceFetchVendorOrders = async (backendUrl: string, token: string) => {
        return await fetchVendorQueueOrders(backendUrl, token);
    };

    window.__xerserviceProcessOrderPrint = async (
        order: VendorQueueOrder,
        printerId: string,
        token: string,
        backendUrl?: string
    ) => {
        return await processOrderPrint(order, printerId, token, backendUrl);
    };

    window.__xerserviceGetOrderJobMapping = async (orderId: string) => {
        return await fetchOrderPrintJob(orderId);
    };

    window.__xerserviceSyncOrderPrintStatus = async (
        orderId: string,
        backendUrl?: string,
        token?: string
    ) => {
        return await syncOrderPrintStatus(orderId, backendUrl, token);
    };
}

// ──────────────────────────────────────────────
    //  Vendor Dashboard UI Bootstrap (Step 17.1)
    // ──────────────────────────────────────────────

    let ui_printers: NormalizedPrinter[] = [];
    let ui_orders: VendorQueueOrder[] = [];
    let ui_activeOrderFilter: string = 'all';
    let ui_modalOrder: VendorQueueOrder | null = null;
    let ui_pdfViewer: PdfViewer | null = null;
    let ui_activeOrderFile: VendorOrderFile | null = null;
    let ui_activeViewMode: 'prepared' | 'original' = 'prepared';
    let ui_token: string = '';
    let ui_backendUrl: string = DEFAULT_BACKEND_URL;
    let ui_ordersLoading: boolean = false;
    let ui_ordersError: string | null = null;

    // Currency and HTML formatting helpers
    function ui_formatCurrency(amount: any): string {
        const num = Number(amount);
        return isNaN(num) ? '0.00' : num.toFixed(2);
    }

    function ui_escapeHtml(str: string): string {
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    let ui_currentTheme: 'system' | 'light' | 'dark' = 'system';
    let ui_shopProfile: VendorShopProfileData | null = null;
    let ui_overviewData: VendorOverviewData | null = null;
    let ui_searchQuery: string = '';
    let ui_dateFilter: string = '';
    let ui_statementPeriod: string = 'all';
    let ui_statementFrom: string = '';
    let ui_statementTo: string = '';
    let ui_statementSearch: string = '';
    let ui_statementData: VendorStatementData | null = null;
    let ui_statementLoading: boolean = false;

    // Theme switcher with persistence
    function ui_setTheme(theme: 'system' | 'light' | 'dark') {
        ui_currentTheme = theme;
        try {
            localStorage.setItem('xerservice_desktop_theme', theme);
        } catch { /* ignore */ }

        if (theme === 'system') {
            const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
        } else {
            document.documentElement.setAttribute('data-theme', theme);
        }

        const toggleBtn = document.getElementById('btn-theme-toggle');
        if (toggleBtn) {
            toggleBtn.title = `Theme: ${theme.toUpperCase()} (Click to toggle)`;
            if (theme === 'light') {
                toggleBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;
            } else if (theme === 'dark') {
                toggleBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`;
            } else {
                toggleBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`;
            }
        }

        const radio = document.getElementById(`theme-radio-${theme}`) as HTMLInputElement | null;
        if (radio) radio.checked = true;
    }

    function ui_cycleTheme() {
        if (ui_currentTheme === 'system') ui_setTheme('light');
        else if (ui_currentTheme === 'light') ui_setTheme('dark');
        else ui_setTheme('system');
    }

    // Topbar header status and connection pill sync
    function ui_updateHeaderStatus(shopName?: string, shopStatus?: string, isOnline: boolean = true) {
        const name = shopName || ui_vendorSession?.shopName || 'Your Shop';
        const status = (shopStatus || ui_vendorSession?.shopStatus || 'OPEN').toUpperCase();

        const nameEl = document.getElementById('header-shop-name');
        if (nameEl) nameEl.textContent = name;
        const sideNameEl = document.getElementById('sidebar-shop-name');
        if (sideNameEl) sideNameEl.textContent = name;

        const statusPill = document.getElementById('header-shop-status');
        const statusText = document.getElementById('header-shop-status-text');
        if (statusPill && statusText) {
            statusPill.className = `trading-pill trading-pill-${status.toLowerCase()}`;
            statusText.textContent = status;
        }

        const connIndicator = document.getElementById('header-conn-status-text');
        const connDot = document.getElementById('header-conn-dot');
        if (connIndicator && connDot) {
            if (isOnline) {
                connDot.className = 'conn-dot conn-dot-ok';
                connIndicator.textContent = 'Connected';
            } else {
                connDot.className = 'conn-dot conn-dot-warn';
                connIndicator.textContent = 'Offline';
            }
        }

        // Sync availability toggle buttons in Overview side panel
        document.querySelectorAll('.btn-avail').forEach(b => b.classList.remove('active'));
        const activeAvailBtn = document.getElementById(`btn-shop-${status.toLowerCase()}`);
        if (activeAvailBtn) activeAvailBtn.classList.add('active');

        const availNote = document.getElementById('shop-availability-note');
        if (availNote) {
            if (status === 'OPEN') {
                availNote.innerHTML = 'Your shop is currently <strong>OPEN</strong> and accepting customer print orders.';
            } else if (status === 'PAUSED') {
                availNote.innerHTML = 'Your shop is currently <strong>PAUSED</strong>. Customers can view the shop, but new checkout is suspended.';
            } else {
                availNote.innerHTML = 'Your shop is currently <strong>CLOSED</strong>. Orders will resume during operational hours.';
            }
        }
    }

    // Side panel printer summary
    function ui_updatePrinterAttention() {
        const block = document.getElementById('printer-attention-summary');
        const banner = document.getElementById('no-printer-banner');
        if (!block) return;

        if (ui_printers.length === 0) {
            block.innerHTML = `
                <div style="display:flex; align-items:center; gap:0.5rem; color:var(--amber);">
                    <span style="font-size:1.1rem;">⚠️</span>
                    <div>
                        <strong>No native printers detected</strong>
                        <p style="font-size:0.75rem; color:var(--fg-muted); margin-top:0.15rem;">Connect a physical printer or configure system CUPS printer.</p>
                    </div>
                </div>
            `;
            if (banner) banner.style.display = 'flex';
        } else {
            const names = ui_printers.map(p => p.name).join(', ');
            block.innerHTML = `
                <div style="display:flex; align-items:center; gap:0.5rem; color:var(--emerald);">
                    <span style="font-size:1.1rem;">✅</span>
                    <div>
                        <strong>${ui_printers.length} native printer${ui_printers.length > 1 ? 's' : ''} detected</strong>
                        <p style="font-size:0.75rem; color:var(--fg-muted); margin-top:0.15rem;" title="${ui_escapeHtml(names)}">Ready for direct native spooler dispatch</p>
                    </div>
                </div>
            `;
            if (banner) banner.style.display = 'none';
        }
        ui_updateHonestConnectivityHud(ui_modalOrder);
    }

    // Authoritative Honest Connectivity HUD & Hardware Spooling Diagnostics
    function ui_updateHonestConnectivityHud(selectedOrder?: VendorQueueOrder | null, activeJobRecord?: any): HonestConnectivitySnapshot {
        const selPrinterEl = document.getElementById('modal-printer-select') as HTMLSelectElement | null;
        const selectedPrinterId = selPrinterEl?.value;
        const targetPrinter = ui_printers.find(p => p.printerId === selectedPrinterId) || ui_printers[0] || null;

        const inputs: HonestConnectivityInputs = {
            isBackendReachable: ui_backendReachable,
            backendLatencyMs: ui_backendLatencyMs,
            lastSyncTimestamp: ui_lastSyncTimestamp,
            isSyncing: ui_ordersLoading,
            staleThresholdSeconds: 60,
            detectedPrintersCount: ui_printers.length,
            selectedPrinter: targetPrinter ? {
                id: targetPrinter.printerId,
                name: targetPrinter.name,
                status: targetPrinter.status,
                isDefault: targetPrinter.isDefault,
            } : null,
            activeJob: activeJobRecord ? {
                localJobId: activeJobRecord.localJobId,
                nativeJobId: activeJobRecord.nativeJobId,
                submissionState: activeJobRecord.submissionState,
                status: activeJobRecord.status,
                submittedAt: activeJobRecord.submittedAt,
                completedAt: activeJobRecord.completedAt,
                errorMessage: activeJobRecord.errorMessage,
            } : (selectedOrder ? {
                status: selectedOrder.status === 'PRINTING' ? 'PRINTING' : (selectedOrder.status === 'READY' || selectedOrder.status === 'COMPLETED') ? 'COMPLETED' : 'QUEUED',
            } : null),
        };

        const snap = evaluateHonestConnectivity(inputs);

        // 1. Backend Connectivity Indicator
        const connIndicator = document.getElementById('header-conn-status-text');
        const connDot = document.getElementById('header-conn-dot');
        if (connIndicator && connDot) {
            connIndicator.textContent = snap.backendConnected.label;
            connDot.className = snap.backendConnected.isOk ? 'conn-dot conn-dot-ok' : 'conn-dot conn-dot-warn';
        }

        // 2. Data Freshness Indicator
        const dataIndicator = document.getElementById('header-data-status-text');
        const dataDot = document.getElementById('header-data-dot');
        if (dataIndicator && dataDot) {
            dataIndicator.textContent = snap.dataCurrent.label;
            dataDot.className = snap.dataCurrent.isOk ? 'conn-dot conn-dot-ok' : (snap.dataCurrent.status === 'SYNCING' ? 'conn-dot conn-dot-info' : 'conn-dot conn-dot-warn');
        }

        // 3. Printer Discovery Indicator
        const printerLabel = document.getElementById('printer-status-label');
        const printerDot = document.getElementById('printer-status-dot');
        if (printerLabel && printerDot) {
            printerLabel.textContent = snap.printerDetected.label;
            printerDot.className = snap.printerDetected.isOk ? 'printer-dot printer-dot-ready' : 'printer-dot printer-dot-none';
        }

        // 4. Printer Ready Indicator
        const readyIndicator = document.getElementById('header-ready-status-text');
        const readyDot = document.getElementById('header-ready-dot');
        if (readyIndicator && readyDot) {
            readyIndicator.textContent = snap.printerReady.label;
            readyDot.className = snap.printerReady.isOk ? 'conn-dot conn-dot-ok' : 'conn-dot conn-dot-warn';
        }

        // 5 & 6. Spooling & Completion Badges in Modal
        const spoolBadge = document.getElementById('modal-spool-submitted-badge');
        const finishedBadge = document.getElementById('modal-spool-finished-badge');
        const troubleBox = document.getElementById('modal-hardware-troubleshooting');

        if (spoolBadge) {
            spoolBadge.textContent = snap.jobSubmitted.label;
            spoolBadge.style.color = snap.jobSubmitted.isOk ? 'var(--emerald)' : (snap.jobSubmitted.status === 'SUBMISSION_FAILED' ? 'var(--crimson)' : 'var(--fg-muted)');
        }
        if (finishedBadge) {
            finishedBadge.textContent = snap.jobFinished.label;
            finishedBadge.style.color = snap.jobFinished.isOk ? 'var(--emerald)' : (snap.jobFinished.status === 'IN_PROGRESS' ? 'var(--cyan)' : 'var(--fg-muted)');
        }
        if (troubleBox) {
            if (snap.troubleshooting.length > 0) {
                troubleBox.style.display = 'block';
                troubleBox.innerHTML = `⚠️ <strong>Diagnostics:</strong><br/>${snap.troubleshooting.join('<br/>')}`;
            } else {
                troubleBox.style.display = 'none';
                troubleBox.innerHTML = '';
            }
        }

        return snap;
    }

    async function ui_checkBackendHealth() {
        try {
            const start = Date.now();
            const res = await fetch(`${ui_backendUrl}/api/health`, { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
            if (res.ok) {
                ui_backendReachable = true;
                ui_backendLatencyMs = Math.max(1, Date.now() - start);
            } else {
                ui_backendReachable = false;
                ui_backendLatencyMs = undefined;
            }
        } catch {
            ui_backendReachable = false;
            ui_backendLatencyMs = undefined;
        }
        ui_updateHonestConnectivityHud(ui_modalOrder);
    }

    // Refresh Overview dashboard metrics from backend
    async function ui_refreshOverview() {
        if (!ui_token) return;
        try {
            const data = await fetchVendorOverview(ui_backendUrl, ui_token);
            ui_overviewData = data;

            // 1. Primary KPI cards
            const queuedCount = ui_orders.filter(o => o.status === 'QUEUED').length;
            const printingCount = ui_orders.filter(o => o.status === 'PRINTING').length;
            const readyCount = ui_orders.filter(o => o.status === 'READY').length;
            const completedCount = data.metrics.todayCompletedOrders || ui_orders.filter(o => o.status === 'COMPLETED').length;

            const statQueued = document.getElementById('stat-queued');
            if (statQueued) statQueued.textContent = String(queuedCount);
            const statPrinting = document.getElementById('stat-printing');
            if (statPrinting) statPrinting.textContent = String(printingCount);
            const statReady = document.getElementById('stat-ready');
            if (statReady) statReady.textContent = String(readyCount);
            const statCompleted = document.getElementById('stat-completed-today');
            if (statCompleted) statCompleted.textContent = String(completedCount);

            // 2. Secondary Earnings Strip (3 cards)
            const statEarnings = document.getElementById('stat-earnings-today');
            if (statEarnings) {
                statEarnings.textContent = `₹${ui_formatCurrency(data.metrics.todayRevenue || 0)}`;
            }

            const statUnsettled = document.getElementById('stat-unsettled-balance');
            if (statUnsettled) {
                statUnsettled.textContent = `₹${ui_formatCurrency(data.metrics.unsettledBalance || 0)}`;
            }

            const statPayout = document.getElementById('stat-last-payout');
            const statPayoutSub = document.getElementById('stat-last-payout-sub');
            if (statPayout) {
                if (data.metrics.lastPayout) {
                    statPayout.textContent = `₹${ui_formatCurrency(data.metrics.lastPayout.amount)}`;
                    if (statPayoutSub) {
                        const dateStr = data.metrics.lastPayout.date ? new Date(data.metrics.lastPayout.date).toLocaleDateString() : '';
                        const ref = data.metrics.lastPayout.settlementNumber || '';
                        statPayoutSub.textContent = `Settled ${dateStr}${ref ? ` (${ref})` : ''}`;
                    }
                } else {
                    statPayout.textContent = '₹0.00';
                    if (statPayoutSub) statPayoutSub.textContent = 'No disbursements recorded yet';
                }
            }

            // 3. Header & status sync
            if (data.shop) {
                ui_updateHeaderStatus(data.shop.name, data.shop.status || 'OPEN', true);
            }

            // 4. Side panel printer summary
            ui_updatePrinterAttention();

        } catch (err: any) {
            console.warn('[Vendor UI] Overview fetch failed:', err?.message);
            ui_updateHeaderStatus(undefined, undefined, false);
        }
    }

    // Set shop availability directly with instant server sync
    async function ui_setShopAvailability(status: 'OPEN' | 'PAUSED' | 'CLOSED') {
        if (!ui_token) return;
        ui_updateHeaderStatus(undefined, status, true);
        try {
            await updateVendorShopProfile(ui_backendUrl, ui_token, { status });
            if (ui_shopProfile) ui_shopProfile.status = status;
        } catch (err: any) {
            console.warn('[Vendor UI] Failed to update shop availability:', err?.message);
        }
    }

    // Live Customer Card Preview sync
    function ui_updateCustomerPreview() {
        const nameInput = document.getElementById('settings-shop-name') as HTMLInputElement | null;
        const addrInput = document.getElementById('settings-shop-address') as HTMLInputElement | null;
        const phoneInput = document.getElementById('settings-shop-phone') as HTMLInputElement | null;
        const openInput = document.getElementById('settings-open-time') as HTMLInputElement | null;
        const closeInput = document.getElementById('settings-close-time') as HTMLInputElement | null;
        const selectedStatus = (document.querySelector('input[name="settings-status"]:checked') as HTMLInputElement | null)?.value || 'OPEN';

        const previewName = document.getElementById('preview-shop-name');
        if (previewName) previewName.textContent = nameInput?.value.trim() || 'Your Shop';

        const previewAddress = document.getElementById('preview-shop-address');
        if (previewAddress) previewAddress.textContent = addrInput?.value.trim() || 'Shop location address';

        const previewPhone = document.getElementById('preview-shop-phone');
        if (previewPhone) previewPhone.textContent = phoneInput?.value.trim() ? `📞 ${phoneInput.value.trim()}` : '📞 Contact available';

        const previewHours = document.getElementById('preview-shop-hours');
        if (previewHours) {
            const openTime = openInput?.value || '09:00';
            const closeTime = closeInput?.value || '20:00';
            previewHours.textContent = `⏰ ${openTime} – ${closeTime}`;
        }

        const previewStatus = document.getElementById('preview-shop-status');
        if (previewStatus) {
            previewStatus.textContent = selectedStatus;
            previewStatus.className = `preview-card-status preview-status-${selectedStatus.toLowerCase()}`;
            if (selectedStatus === 'OPEN') previewStatus.style.background = 'rgba(16, 185, 129, 0.9)';
            else if (selectedStatus === 'PAUSED') previewStatus.style.background = 'rgba(245, 158, 11, 0.9)';
            else previewStatus.style.background = 'rgba(148, 163, 184, 0.9)';
        }

        const previewServices = document.getElementById('preview-shop-services');
        if (previewServices && ui_shopProfile?.customerPreview?.supportedServices) {
            previewServices.innerHTML = ui_shopProfile.customerPreview.supportedServices.map(s =>
                `<span class="service-chip">${ui_escapeHtml(s)}</span>`
            ).join('');
        }

        const previewStartingPrice = document.getElementById('preview-shop-starting-price');
        if (previewStartingPrice && ui_shopProfile?.customerPreview) {
            const cp = ui_shopProfile.customerPreview;
            if (cp.startingPrice !== null) {
                previewStartingPrice.textContent = `From ₹${cp.startingPrice.toFixed(2)} (${cp.startingPriceBasis})`;
            }
        }

        const previewColorPrice = document.getElementById('preview-shop-color-price');
        if (previewColorPrice && ui_shopProfile?.customerPreview) {
            const cp = ui_shopProfile.customerPreview;
            if (cp.priceColorPerPage !== null) {
                previewColorPrice.textContent = `Colour from ₹${cp.priceColorPerPage.toFixed(2)}`;
                previewColorPrice.style.display = 'block';
            } else {
                previewColorPrice.style.display = 'none';
            }
        }

        const previewCta = document.getElementById('preview-shop-cta');
        if (previewCta) {
            previewCta.textContent = selectedStatus === 'OPEN' ? 'Print here →' : (selectedStatus === 'PAUSED' ? 'Paused' : 'Closed');
        }
    }

    // Load Shop Settings tab data
    async function ui_loadShopSettings() {
        if (!ui_token) return;
        try {
            const shop = await fetchVendorShopProfile(ui_backendUrl, ui_token);
            ui_shopProfile = shop;

            const nameInput = document.getElementById('settings-shop-name') as HTMLInputElement | null;
            if (nameInput) nameInput.value = shop.name || '';

            const addrInput = document.getElementById('settings-shop-address') as HTMLInputElement | null;
            if (addrInput) addrInput.value = shop.address || '';

            const phoneInput = document.getElementById('settings-shop-phone') as HTMLInputElement | null;
            if (phoneInput) phoneInput.value = shop.contactPhone || '';

            const openInput = document.getElementById('settings-open-time') as HTMLInputElement | null;
            if (openInput) openInput.value = shop.openTime || '09:00';

            const closeInput = document.getElementById('settings-close-time') as HTMLInputElement | null;
            if (closeInput) closeInput.value = shop.closeTime || '20:00';

            const statusRadio = document.getElementById(`status-radio-${(shop.status || 'open').toLowerCase()}`) as HTMLInputElement | null;
            if (statusRadio) statusRadio.checked = true;

            const termsCycle = document.getElementById('terms-settlement-cycle');
            if (termsCycle) termsCycle.textContent = shop.commercialTerms?.settlementCycle || 'Daily (T+1)';

            const termsModel = document.getElementById('terms-commission-model');
            if (termsModel) termsModel.textContent = shop.commercialTerms?.commercialPlan || 'Standard Platform Terms';

            ui_updateCustomerPreview();

            // Populate readiness card (Priority 1)
            const readinessCard = document.getElementById('settings-readiness-card');
            if (readinessCard && shop.readiness) {
                readinessCard.style.display = 'block';
                const rBadge = document.getElementById('settings-readiness-badge');
                const rDesc = document.getElementById('settings-readiness-desc');
                const rScore = document.getElementById('settings-readiness-score');
                const rItems = document.getElementById('settings-readiness-items');

                if (rScore) rScore.textContent = `${shop.readiness.scorePercent}%`;
                if (rDesc) rDesc.textContent = `${shop.readiness.completedCount} of ${shop.readiness.totalChecks} operational prerequisites satisfied (${shop.readiness.scorePercent}%). ${shop.readiness.summaryMessage}`;

                if (rBadge) {
                    if (shop.readiness.isReadyToPublish) {
                        rBadge.textContent = 'Ready';
                        rBadge.style.background = 'rgba(34,197,94,0.15)';
                        rBadge.style.color = '#22c55e';
                    } else {
                        rBadge.textContent = `${shop.readiness.blockersCount} Blocker${shop.readiness.blockersCount > 1 ? 's' : ''}`;
                        rBadge.style.background = 'rgba(239,68,68,0.15)';
                        rBadge.style.color = 'var(--accent-red, #ef4444)';
                    }
                }

                if (rItems && Array.isArray(shop.readiness.items)) {
                    rItems.innerHTML = shop.readiness.items.map(item => `
                        <div style="display:flex; align-items:center; justify-content:space-between; padding:6px 10px; border-radius:6px; background:${item.status === 'COMPLETE' ? 'rgba(34,197,94,0.06)' : 'rgba(239,68,68,0.06)'}; border:1px solid ${item.status === 'COMPLETE' ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'};">
                            <span style="font-size:12px; font-weight:700; color:var(--text-main);">${item.status === 'COMPLETE' ? '✓' : '⚠️'} ${ui_escapeHtml(item.title)}</span>
                            <span style="font-size:11px; color:${item.status === 'COMPLETE' ? '#22c55e' : '#ef4444'}; font-weight:800;">${item.status === 'COMPLETE' ? 'Passed' : 'Action Required'}</span>
                        </div>
                    `).join('');
                }
            }

            // Populate preferred printer selector
            const printerSelect = document.getElementById('settings-default-printer') as HTMLSelectElement | null;
            if (printerSelect) {
                const savedPref = localStorage.getItem('xerservice_default_printer') || '';
                printerSelect.innerHTML = '<option value="">— Select preferred default printer —</option>' +
                    ui_printers.map(p => `<option value="${p.printerId}" ${p.printerId === savedPref ? 'selected' : ''}>${p.name || p.printerId} (${p.status || 'idle'})</option>`).join('');
            }

            // Populate printer diagnostics
            const diagBox = document.getElementById('settings-printer-diagnostics');
            if (diagBox) {
                if (ui_printers.length === 0) {
                    diagBox.textContent = 'No physical or virtual printers discovered. Printing requires system CUPS / OS printer setup.';
                } else {
                    diagBox.innerHTML = `
                        <strong>Discovered Devices (${ui_printers.length}):</strong><br/>
                        ${ui_printers.map(p => `• <strong>${ui_escapeHtml(p.name)}</strong>: ${p.capabilities?.colorSupported ? 'Colour & B&W' : 'B&W only'}, Duplex: ${p.capabilities?.duplexSupported ? 'Yes' : 'Simplex only'}, Paper: ${p.capabilities?.supportedPaperSizes?.join(', ') || 'A4'}`).join('<br/>')}
                    `;
                }
            }
        } catch (err: any) {
            console.warn('[Vendor UI] Failed to load shop settings:', err?.message);
        }
    }

    // Save Shop Settings
    async function ui_saveShopSettings() {
        if (!ui_token) return;
        const btn = document.getElementById('btn-save-settings') as HTMLButtonElement | null;
        const spinner = document.getElementById('save-settings-spinner');
        const label = document.getElementById('save-settings-label');
        const feedback = document.getElementById('settings-feedback-msg');

        const nameInput = document.getElementById('settings-shop-name') as HTMLInputElement | null;
        const addrInput = document.getElementById('settings-shop-address') as HTMLInputElement | null;
        const phoneInput = document.getElementById('settings-shop-phone') as HTMLInputElement | null;
        const openInput = document.getElementById('settings-open-time') as HTMLInputElement | null;
        const closeInput = document.getElementById('settings-close-time') as HTMLInputElement | null;
        const statusVal = (document.querySelector('input[name="settings-status"]:checked') as HTMLInputElement | null)?.value || 'OPEN';

        if (btn) btn.disabled = true;
        if (spinner) spinner.style.display = 'inline-block';
        if (label) label.textContent = 'Saving…';
        if (feedback) feedback.style.display = 'none';

        try {
            const updated = await updateVendorShopProfile(ui_backendUrl, ui_token, {
                name: nameInput?.value.trim() || undefined,
                address: addrInput?.value.trim() || undefined,
                contactPhone: phoneInput?.value.trim() || undefined,
                openTime: openInput?.value || undefined,
                closeTime: closeInput?.value || undefined,
                status: statusVal as 'OPEN' | 'PAUSED' | 'CLOSED',
            });
            ui_shopProfile = updated;
            ui_updateHeaderStatus(updated.name, updated.status, true);

            if (feedback) {
                feedback.textContent = '✓ Shop settings saved successfully!';
                feedback.className = 'settings-feedback success';
                feedback.style.display = 'inline-block';
                setTimeout(() => { if (feedback) feedback.style.display = 'none'; }, 3000);
            }
        } catch (err: any) {
            if (feedback) {
                feedback.textContent = `✗ Failed: ${err?.message || 'Error saving settings'}`;
                feedback.className = 'settings-feedback error';
                feedback.style.display = 'inline-block';
            }
        } finally {
            if (btn) btn.disabled = false;
            if (spinner) spinner.style.display = 'none';
            if (label) label.textContent = 'Save Shop Settings';
        }
    }

    // Refresh device jobs tables in the Orders → Device Jobs sub-panel
    async function ui_refreshDeviceJobs() {
        // Active spooler queue → device-jobs-tbody
        const djTbody = document.getElementById('device-jobs-tbody');
        if (djTbody) {
            try {
                const queue = await getPrintQueue();
                if (queue.length === 0) {
                    djTbody.innerHTML = `<tr><td colspan="4" class="empty-row"><span style="color:var(--fg-muted);font-size:0.85rem;">No active device print jobs.</span></td></tr>`;
                } else {
                    djTbody.innerHTML = '';
                    for (const item of queue) {
                        const tr = document.createElement('tr');
                        const isXS = item.managedByXerService;
                        tr.innerHTML = `
                            <td style="color:var(--fg);">${item.printerId}</td>
                            <td style="color:var(--fg);">${item.title || 'Document'}</td>
                            <td>${ui_pill(item.status)}</td>
                            <td>
                                ${item.cancellable && isXS
                                    ? `<button class="btn-action btn-action-cancel" data-dj-job="${item.jobId}" data-dj-printer="${item.printerId}">Cancel</button>`
                                    : `<span style="color:var(--fg-subtle);font-size:0.75rem;">${isXS ? 'Not cancellable' : 'External'}</span>`
                                }
                            </td>
                        `;
                        tr.querySelector('[data-dj-job]')?.addEventListener('click', async (e) => {
                            const btn = e.target as HTMLButtonElement;
                            const jobId = btn.getAttribute('data-dj-job') || '';
                            const pid = btn.getAttribute('data-dj-printer') || undefined;
                            btn.disabled = true; btn.textContent = 'Cancelling…';
                            await cancelNativePrintJob(jobId, pid);
                            await ui_refreshDeviceJobs();
                        });
                        djTbody.appendChild(tr);
                    }
                }
            } catch (err: any) {
                djTbody.innerHTML = `<tr><td colspan="4" class="empty-row" style="color:var(--red);">Unable to read print queue. ${err?.message || ''}</td></tr>`;
            }
        }

        // Persisted (completed/failed) jobs → device-persisted-tbody
        const dpTbody = document.getElementById('device-persisted-tbody');
        if (dpTbody) {
            try {
                const jobs = await fetchPersistedPrintJobs();
                if (jobs.length === 0) {
                    dpTbody.innerHTML = `<tr><td colspan="4" class="empty-row"><span style="color:var(--fg-muted);font-size:0.85rem;">No job history for this session.</span></td></tr>`;
                } else {
                    dpTbody.innerHTML = '';
                    for (const job of jobs) {
                        const relatedOrder = ui_orders.find(o => o.id === job.xerServiceOrderId);
                        const orderLabel = relatedOrder ? relatedOrder.order_number : (job.xerServiceOrderId ? job.xerServiceOrderId.slice(0, 10) + '…' : '—');
                        const tr = document.createElement('tr');
                        tr.innerHTML = `
                            <td style="font-family:monospace;font-size:0.8125rem;color:var(--fg);">${orderLabel}</td>
                            <td style="color:var(--fg-muted);">${job.printerId || '—'}</td>
                            <td>${ui_pill(job.status)}</td>
                            <td style="font-size:0.75rem;color:var(--fg-subtle);">${ui_relativeTime(job.updatedAt)}</td>
                        `;
                        dpTbody.appendChild(tr);
                    }
                }
            } catch (err: any) {
                dpTbody.innerHTML = `<tr><td colspan="4" class="empty-row" style="color:var(--red);">Unable to read job history. ${err?.message || ''}</td></tr>`;
            }
        }

        // Also keep legacy tbodies in sync
        void ui_refreshPrintQueue();
        void ui_refreshPersistedJobs();
    }

    // Client-side search + date filtering for the orders table
    function ui_applyOrdersFiltering() {
        if (ui_activeOrderFilter === 'device-jobs') return; // not applicable to device tab
        let filtered = [...ui_orders];

        // Status filter
        if (ui_activeOrderFilter && ui_activeOrderFilter !== 'all') {
            filtered = filtered.filter(o => o.status === ui_activeOrderFilter);
        }

        // Search query (order number or customer name)
        if (ui_searchQuery) {
            filtered = filtered.filter(o =>
                (o.order_number || '').toLowerCase().includes(ui_searchQuery) ||
                (o.customerName || '').toLowerCase().includes(ui_searchQuery)
            );
        }

        // Date filter
        if (ui_dateFilter) {
            filtered = filtered.filter(o => {
                if (!o.created_at) return false;
                return o.created_at.startsWith(ui_dateFilter);
            });
        }

        const tbody = document.getElementById('orders-tbody');
        if (!tbody) return;
        if (filtered.length === 0) {
            const label = ui_searchQuery ? 'matching' : ui_activeOrderFilter !== 'all' ? ui_activeOrderFilter.toLowerCase() : 'active';
            tbody.innerHTML = `<tr><td colspan="7" class="empty-row"><div class="empty-state"><div class="empty-emoji">📦</div><p class="empty-title">No ${label} orders</p><p class="empty-sub">${ui_searchQuery ? 'Try a different search term.' : 'Customer orders will appear here when placed.'}</p></div></td></tr>`;
            return;
        }

        tbody.innerHTML = '';
        for (const ord of filtered) {
            const tr = document.createElement('tr');
            tr.className = 'order-table-row';
            const docCount = ord.order_files?.length || 0;
            const docName = ord.order_files?.[0]?.original_filename || (docCount > 0 ? `${docCount} document(s)` : 'No document attached');
            const isActionable = ord.status === 'QUEUED' || ord.status === 'PRINTING';
            const filesTooltip = ord.order_files?.map((f: any) => f?.original_filename)?.filter(Boolean)?.join(', ') || '';

            tr.innerHTML = `
                <td style="font-family:monospace; font-weight:600; color:var(--fg);">${ui_escapeHtml(ord.order_number)}</td>
                <td style="color:var(--fg);">${ui_escapeHtml(ord.customerName || 'Customer')}</td>
                <td>
                    <span style="color:var(--fg);" title="${ui_escapeHtml(filesTooltip)}">${ui_escapeHtml(docName)}</span>
                    <br/><span style="font-size:0.75rem; color:var(--fg-muted);">${ord.total_printable_pages || 0} pages</span>
                </td>
                <td style="color:var(--fg); font-weight:600;">₹${ui_formatCurrency(ord.total_amount)}</td>
                <td>${ui_pill(ord.status)}</td>
                <td style="font-size:0.75rem; color:var(--fg-muted);">${ui_relativeTime(ord.created_at)}</td>
                <td>
                    <button class="btn-action ${isActionable ? 'btn-action-primary' : ''}" style="${!isActionable ? 'background:var(--bg-3); color:var(--fg-muted); border:1px solid var(--border-strong);' : ''}"
                        data-order-id="${ord.id}">
                        ${isActionable ? '🖨 Print' : 'View'}
                    </button>
                </td>
            `;
            tr.querySelector('button')?.addEventListener('click', (e) => { e.stopPropagation(); ui_openOrderModal(ord); });
            tr.style.cursor = 'pointer';
            tr.addEventListener('click', () => ui_openOrderModal(ord));
            tbody.appendChild(tr);
        }
    }

    // Helper: navigate tabs with view state synchronization
    function ui_activateTab(tabId: string) {
        document.querySelectorAll('.tab-panel').forEach(el => el.classList.remove('active'));
        document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
        const panel = document.getElementById(`tab-${tabId}`);
        if (panel) panel.classList.add('active');
        const navItem = document.querySelector(`.nav-item[data-tab="${tabId}"]`);
        if (navItem) navItem.classList.add('active');
        const titleEl = document.getElementById('page-title');
        if (titleEl) {
            const titles: Record<string, string> = {
                overview: 'Dashboard', orders: 'Orders',
                settings: 'Shop Settings',
                printqueue: 'Print Queue', reports: 'Reports'
            };
            titleEl.textContent = titles[tabId] || tabId;
        }

        // Synchronize view state when tab becomes active
        if (tabId === 'orders') {
            const tabDomExists = panel !== null;
            const tbody = document.getElementById('orders-tbody');
            const tbodyDomExists = tbody !== null;
            void recordFrontendTelemetry('STAGE_6_TAB_ACTIVATE', 'ui_activateTab', `panelExists=${tabDomExists}, tbodyExists=${tbodyDomExists}, ordersCount=${ui_orders.length}`);

            if (ui_activeOrderFilter === 'device-jobs') {
                const tableWrap = document.getElementById('orders-table-wrap');
                const deviceWrap = document.getElementById('orders-device-jobs-container');
                if (tableWrap) tableWrap.style.display = 'none';
                if (deviceWrap) deviceWrap.style.display = 'block';
                void ui_refreshPrintQueue();
                void ui_refreshPersistedJobs();
            } else {
                const tableWrap = document.getElementById('orders-table-wrap');
                const deviceWrap = document.getElementById('orders-device-jobs-container');
                if (tableWrap) tableWrap.style.display = 'block';
                if (deviceWrap) deviceWrap.style.display = 'none';

                if (ui_ordersLoading) {
                    ui_renderOrdersLoading('orders-tbody');
                } else if (ui_ordersError) {
                    ui_renderOrdersError('orders-tbody', ui_ordersError);
                } else if (ui_orders.length === 0 && ui_token) {
                    void ui_refreshOrders();
                } else {
                    ui_renderOrdersTable(ui_orders, 'orders-tbody', undefined, ui_activeOrderFilter);
                }
            }
        } else if (tabId === 'overview') {
            ui_updateStatCards(ui_orders);
            ui_renderOverviewRecentOrders(ui_orders);
            void ui_refreshOverview();
        } else if (tabId === 'settings') {
            void ui_loadShopSettings();
        } else if (tabId === 'printqueue') {
            ui_refreshPrintQueue();
            ui_refreshPersistedJobs();
        } else if (tabId === 'reports') {
            ui_renderReportsSummary();
            void ui_loadStatements();
        }
    }

    // Status pill helper
    function ui_pill(status: string): string {
        const cls = status.toLowerCase();
        const labels: Record<string, string> = {
            queued: 'Queued', printing: 'Printing', ready: 'Ready for Pickup',
            completed: 'Completed', cancelled: 'Cancelled', failed: 'Failed', paid: 'Paid'
        };
        return `<span class="pill pill-${cls}">${labels[cls] || status}</span>`;
    }

    // Date formatting
    function ui_relativeTime(iso: string): string {
        try {
            if (!iso) return '—';
            const timestamp = new Date(iso).getTime();
            if (isNaN(timestamp)) return '—';
            const diff = Date.now() - timestamp;
            const m = Math.floor(diff / 60000);
            if (m < 1) return 'Just now';
            if (m < 60) return `${m}m ago`;
            const h = Math.floor(m / 60);
            if (h < 24) return `${h}h ago`;
            return `${Math.floor(h / 24)}d ago`;
        } catch { return '—'; }
    }

    // Update status tracker in modal
    function ui_updateStatusTrack(orderStatus: string) {
        const steps = ['queued', 'printing', 'ready', 'completed'];
        const activeIdx = steps.indexOf(orderStatus.toLowerCase());
        steps.forEach((step, idx) => {
            const el = document.getElementById(`track-${step}`);
            if (!el) return;
            el.classList.remove('done', 'active');
            if (idx < activeIdx) el.classList.add('done');
            else if (idx === activeIdx) el.classList.add('active');
        });
    }

    // Render modal action area based on order status
    function ui_renderModalActions(order: VendorQueueOrder) {
        const area = document.getElementById('modal-action-area');
        if (!area) return;

        if (order.status === 'QUEUED') {
            const noPrinter = ui_printers.length === 0;
            area.innerHTML = `
                <button id="modal-btn-start-print" class="btn-primary"
                    ${noPrinter ? 'disabled' : ''}
                    style="width:100%; justify-content:center; padding:0.7rem 1.25rem; font-size:0.875rem;">
                    🖨️ ${noPrinter ? 'Printer Unavailable' : 'Start Printing'}
                </button>
                ${noPrinter ? `<p style="font-size:0.75rem; color:var(--amber); text-align:center; margin-top:0.25rem;">No printers available on this device</p>` : ''}
                <button id="modal-btn-spinner" style="display:none;" class="btn-secondary" disabled>
                    <span class="btn-spinner"></span> Starting Print…
                </button>
            `;
            document.getElementById('modal-btn-start-print')?.addEventListener('click', () => ui_handleStartPrint(order));
        } else if (order.status === 'PRINTING') {
            area.innerHTML = `
                <div class="info-banner info-banner-warning" style="margin-bottom:0; display:flex; align-items:center; gap:0.5rem;">
                    <span class="btn-spinner" style="width:14px; height:14px;"></span>
                    <span><strong>Printing and finishing</strong> Check the print queue for progress.</span>
                </div>
                <button id="modal-btn-start-print" class="btn-secondary">Continue remaining documents</button>
                <button id="modal-btn-spinner" class="btn-secondary" style="display:none" disabled>Starting print…</button>
                <button id="modal-btn-ready" class="btn-primary">Confirm finishing is done · Mark ready</button>
            `;
            document.getElementById('modal-btn-start-print')?.addEventListener('click', () => ui_handleStartPrint(order));
            document.getElementById('modal-btn-ready')?.addEventListener('click', async (event) => {
                const button = event.currentTarget as HTMLButtonElement;
                button.disabled = true;
                try {
                    const result = await syncOrderPrintStatus(order.id, ui_backendUrl, ui_token);
                    if (result.printStatus !== 'COMPLETED') throw new Error('All documents must finish printing before marking this order ready.');
                    if (result.orderStatus !== 'READY') await updateVendorOrderStatus(ui_backendUrl, ui_token, order.id, 'PRINTING', 'READY');
                    await ui_refreshOrders(); ui_renderModalActions({ ...order, status: 'READY' }); ui_updateStatusTrack('READY');
                } catch (error) { button.textContent = error instanceof Error ? error.message : 'Could not update order. Try again.'; button.disabled = false; }
            });
        } else if (order.status === 'READY') {
            area.innerHTML = `
                <div class="info-banner info-banner-info" style="margin-bottom:0; display:flex; align-items:center; gap:0.5rem;">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20,6 9,17 4,12"/></svg>
                    <span><strong>Ready for Pickup</strong> Printed successfully. Waiting for customer to collect.</span>
                </div>
                <button id="modal-btn-collected" class="btn-primary">Confirm customer collected order</button>
            `;
            document.getElementById('modal-btn-collected')?.addEventListener('click', async (event) => {
                const button = event.currentTarget as HTMLButtonElement; button.disabled = true;
                try {
                    await updateVendorOrderStatus(ui_backendUrl, ui_token, order.id, 'READY', 'COMPLETED');
                    ui_renderModalActions({ ...order, status: 'COMPLETED' }); ui_updateStatusTrack('COMPLETED'); await ui_refreshOrders();
                } catch { button.textContent = 'Could not confirm collection. Try again.'; button.disabled = false; }
            });
        } else if (order.status === 'COMPLETED') {
            area.innerHTML = `
                <div class="info-banner info-banner-info" style="margin-bottom:0;">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20,6 9,17 4,12"/></svg>
                    <span>Order completed. Customer has collected their printout.</span>
                </div>
            `;
        } else if (order.status === 'CANCELLED') {
            area.innerHTML = `
                <div class="info-banner info-banner-warn" style="margin-bottom:0;">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
                    <span>This order has been cancelled.</span>
                </div>
            `;
        }
    }

    // ──────────────────────────────────────────────
    //  STAGE A9: PDF Preview & Workspace Helpers
    // ──────────────────────────────────────────────

    function ui_cleanupPdfViewer() {
        if (ui_pdfViewer) {
            try { ui_pdfViewer.destroy(); } catch { /* ignore */ }
            ui_pdfViewer = null;
        }
        ui_activeOrderFile = null;
    }

    async function ui_initPdfViewer(): Promise<PdfViewer> {
        if (ui_pdfViewer) return ui_pdfViewer;

        const canvasContainer = document.getElementById('modal-pdf-canvas-container');
        const thumbnailContainer = document.getElementById('modal-thumbnails-container');
        const pageInput = document.getElementById('pdf-page-input') as HTMLInputElement | null;
        const pageTotal = document.getElementById('pdf-page-total');
        const zoomSelect = document.getElementById('pdf-zoom-select') as HTMLSelectElement | null;

        if (!canvasContainer) {
            throw new Error('Canvas container not found in DOM');
        }

        const { createPdfViewer } = await import('./pdf-viewer');
        ui_pdfViewer = createPdfViewer({
            canvasContainer,
            thumbnailContainer: thumbnailContainer || undefined,
            pageInput: pageInput || undefined,
            pageTotal: pageTotal || undefined,
            zoomSelect: zoomSelect || undefined,
            onPageCountReady: (count) => {
                if (ui_activeOrderFile) {
                    ui_updateSheetCountDisplay(ui_activeOrderFile, count);
                }
            },
            onError: (err) => {
                console.warn('[PdfViewer] Error:', err);
            },
        });

        // Wire toolbar button listeners
        document.getElementById('btn-pdf-prev')?.addEventListener('click', () => ui_pdfViewer?.prevPage());
        document.getElementById('btn-pdf-next')?.addEventListener('click', () => ui_pdfViewer?.nextPage());
        if (pageInput) {
            pageInput.addEventListener('change', () => {
                const val = parseInt(pageInput.value, 10);
                if (!isNaN(val)) ui_pdfViewer?.setPage(val);
            });
        }
        if (zoomSelect) {
            zoomSelect.addEventListener('change', () => {
                const val = zoomSelect.value;
                if (val === 'fit-page' || val === 'fit-width') {
                    ui_pdfViewer?.setZoom(val);
                } else {
                    const pct = parseInt(val, 10);
                    if (!isNaN(pct)) ui_pdfViewer?.setZoom(pct);
                }
            });
        }

        // View mode toggle
        const btnLayout = document.getElementById('btn-view-print-layout');
        const btnOrig = document.getElementById('btn-view-original');
        if (btnLayout) btnLayout.addEventListener('click', () => ui_switchViewMode('prepared'));
        if (btnOrig) btnOrig.addEventListener('click', () => ui_switchViewMode('original'));

        return ui_pdfViewer;
    }

    function ui_updateSheetCountDisplay(file: VendorOrderFile, renderedPages?: number) {
        const parityBanner = document.getElementById('pdf-parity-banner');
        const parityRow = document.getElementById('modal-parity-row');
        const parityStatus = document.getElementById('modal-parity-status');
        if (!parityBanner || !parityRow || !parityStatus) return;

        const rawSettings = Array.isArray(file.print_settings) ? file.print_settings[0] : file.print_settings;
        const s = fromDbPrintSettings(rawSettings as any || {});
        const totalPages = renderedPages || file.printable_pages || 1;
        const selectedPages = selectedPageNumbers(totalPages, s);
        const nup = s.pagesPerSheet || 1;
        const sheetsOnSide = Math.ceil(selectedPages.length / nup);
        const isDuplex = s.sides === 'double_long' || s.sides === 'double_short';
        const expectedSheets = isDuplex ? Math.ceil(sheetsOnSide / 2) : sheetsOnSide;

        const quotedSheets = file.physical_sheets || expectedSheets;
        if (quotedSheets !== expectedSheets && expectedSheets > 0) {
            parityBanner.style.display = 'flex';
            parityBanner.innerHTML = `⚠️ <strong>Notice:</strong> Document layout calculates ${expectedSheets} physical sheet(s) (${isDuplex ? 'Double-sided' : 'Single-sided'}, ${nup}-up), but quote recorded ${quotedSheets} sheet(s). Check printer settings.`;
            parityRow.style.display = 'flex';
            parityStatus.textContent = `Notice (${expectedSheets} vs ${quotedSheets})`;
            parityStatus.style.color = 'var(--amber)';
        } else {
            parityBanner.style.display = 'none';
            parityRow.style.display = 'flex';
            parityStatus.textContent = '✓ 100% Parity';
            parityStatus.style.color = 'var(--emerald)';
        }
    }

    async function ui_loadDocumentPreview(file: VendorOrderFile, orderId: string) {
        const viewer = await ui_initPdfViewer();
        const isPrepared = ui_activeViewMode === 'prepared';
        try {
            const res = await downloadVendorOrderDocument(
                ui_backendUrl,
                ui_token,
                orderId,
                file.id,
                isPrepared
            );
            await viewer.loadDocument(res.buffer);
            ui_updateSheetCountDisplay(file);
        } catch (err: any) {
            console.error('[PdfPreview] Download or preview failed:', err);
        }
    }

    async function ui_switchViewMode(mode: 'prepared' | 'original') {
        if (ui_activeViewMode === mode) return;
        ui_activeViewMode = mode;
        const btnLayout = document.getElementById('btn-view-print-layout');
        const btnOrig = document.getElementById('btn-view-original');
        if (btnLayout) btnLayout.classList.toggle('active', mode === 'prepared');
        if (btnOrig) btnOrig.classList.toggle('active', mode === 'original');
        if (ui_modalOrder && ui_activeOrderFile) {
            await ui_loadDocumentPreview(ui_activeOrderFile, ui_modalOrder.id);
        }
    }

    async function ui_selectOrderFile(order: VendorQueueOrder, file: VendorOrderFile) {
        ui_activeOrderFile = file;

        // Highlight active document in list
        document.querySelectorAll('.modal-doc-item').forEach(el => {
            const docId = el.getAttribute('data-doc-id');
            el.classList.toggle('active', docId === file.id);
        });

        // Update document info and print settings for selected file
        const s = file?.print_settings;
        const setVal = (id: string, val: string) => { const el = document.getElementById(id); if (el) el.textContent = val; };
        setVal('modal-filename', file?.original_filename || '—');
        setVal('modal-pages', file?.printable_pages ? formatPrintableSides(file.printable_pages) : '—');
        setVal('modal-sheets', file?.physical_sheets ? formatPhysicalSheets(file.physical_sheets) : '—');
        setVal('modal-copies', s?.copies ? String(s.copies) : '1');
        setVal('modal-colour', formatColourModeName(s?.colour_mode));
        setVal('modal-sides', formatPrintSidesMode(s?.sides).label);
        setVal('modal-paper', formatPaperSizeName(s?.paper_size));
        setVal('modal-orientation', s?.orientation ? (s.orientation.charAt(0).toUpperCase() + s.orientation.slice(1)) : 'Portrait');
        setVal('modal-addons', file?.addons?.length ? file.addons.map((a: any) => formatFinishingServiceName(a.name)).join(', ') : 'None');

        // Revalidate printer against new file settings if printer is selected
        const sel = document.getElementById('modal-printer-select') as HTMLSelectElement | null;
        if (sel && sel.value) {
            ui_onPrinterSelect(order, sel.value);
        }

        // Load preview
        await ui_loadDocumentPreview(file, order.id);
    }

    function ui_renderDocumentsList(order: VendorQueueOrder) {
        const container = document.getElementById('modal-documents-list');
        if (!container) return;
        container.innerHTML = '';

        const files = order.order_files || [];
        if (files.length === 0) {
            container.innerHTML = `<p style="font-size:0.75rem; color:var(--fg-muted);">No documents attached.</p>`;
            return;
        }

        files.forEach((file, index) => {
            const item = document.createElement('div');
            const isActive = ui_activeOrderFile ? ui_activeOrderFile.id === file.id : index === 0;
            item.className = `modal-doc-item ${isActive ? 'active' : ''}`;
            item.setAttribute('data-doc-id', file.id);
            item.innerHTML = `
                <div class="modal-doc-name" title="${ui_escapeHtml(file.original_filename)}">📄 ${ui_escapeHtml(file.original_filename)}</div>
                <div class="modal-doc-pages">${file.printable_pages || 1}p</div>
            `;
            item.addEventListener('click', () => ui_selectOrderFile(order, file));
            container.appendChild(item);
        });
    }

    // Open order detail modal
    async function ui_openOrderModal(order: VendorQueueOrder) {
        ui_modalOrder = order;
        const backdrop = document.getElementById('modal-backdrop');
        if (!backdrop) return;

        // Active file selection
        ui_activeOrderFile = order.order_files?.[0] || null;
        ui_activeViewMode = 'prepared';

        // Reset view mode toggle button states
        const btnLayout = document.getElementById('btn-view-print-layout');
        const btnOrig = document.getElementById('btn-view-original');
        if (btnLayout) btnLayout.classList.add('active');
        if (btnOrig) btnOrig.classList.remove('active');

        // Render multi-file documents list
        ui_renderDocumentsList(order);

        // Fill header
        const numEl = document.getElementById('modal-order-num');
        const custEl = document.getElementById('modal-customer');
        if (numEl) numEl.textContent = `Order #${order.order_number}`;
        if (custEl) custEl.textContent = order.customerName || 'Customer';

        // Fill document info
        const file = ui_activeOrderFile || order.order_files?.[0];
        const s = file?.print_settings;
        const setVal = (id: string, val: string) => { const el = document.getElementById(id); if (el) el.textContent = val; };
        setVal('modal-filename', file?.original_filename || '—');
        setVal('modal-pages', file?.printable_pages ? formatPrintableSides(file.printable_pages) : '—');
        setVal('modal-sheets', file?.physical_sheets ? formatPhysicalSheets(file.physical_sheets) : '—');
        setVal('modal-copies', s?.copies ? String(s.copies) : '1');
        setVal('modal-colour', formatColourModeName(s?.colour_mode));
        setVal('modal-sides', formatPrintSidesMode(s?.sides).label);
        setVal('modal-paper', formatPaperSizeName(s?.paper_size));
        setVal('modal-orientation', s?.orientation ? (s.orientation.charAt(0).toUpperCase() + s.orientation.slice(1)) : 'Portrait');
        setVal('modal-addons', file?.addons?.length ? file.addons.map((a: any) => formatFinishingServiceName(a.name)).join(', ') : 'None');
        setVal('modal-total', `₹${ui_formatCurrency(order.total_amount)}`);
        setVal('modal-payment-status', order.payment_status || '—');

        // Commercial Breakdown Toggle
        const auditBtn = document.getElementById('btn-commercial-breakdown');
        const auditCard = document.getElementById('modal-commercial-audit-card');
        if (auditCard) auditCard.style.display = 'none';

        if (auditBtn) {
            auditBtn.onclick = async () => {
                if (!auditCard) return;
                if (auditCard.style.display === 'block') {
                    auditCard.style.display = 'none';
                    return;
                }
                auditBtn.innerText = 'Loading Audit...';
                try {
                    const audit = await fetchOrderPricingAudit(ui_backendUrl, ui_token, order.id);
                    if (audit) {
                        setVal('modal-commercial-narrative', audit.humanNarrative || '');
                        const firstFile = audit.fileBreakdowns?.[0];
                        if (firstFile) {
                            setVal('modal-audit-rate', `₹${firstFile.appliedUnitPrice.toFixed(2)}/sheet`);
                        }
                        if (audit.commissionAudit) {
                            setVal('modal-audit-earnings', audit.commissionAudit.vendorNetAmount !== null ? `₹${audit.commissionAudit.vendorNetAmount.toFixed(2)}` : '—');
                            setVal('modal-audit-commission', audit.commissionAudit.appliedPercentage !== null ? `${audit.commissionAudit.appliedPercentage.toFixed(2)}% (₹${(audit.commissionAudit.platformCommissionAmount || 0).toFixed(2)})` : '—');
                        }
                        const deltaEl = document.getElementById('modal-audit-rate-delta');
                        if (deltaEl) {
                            if (audit.hasCommercialChangesSinceCheckout) {
                                deltaEl.textContent = '⚠️ ' + (audit.commissionAudit?.commissionDeltaExplanation || 'Rates updated since checkout.');
                                deltaEl.style.display = 'block';
                            } else {
                                deltaEl.style.display = 'none';
                            }
                        }
                        auditCard.style.display = 'block';
                    }
                } catch (err: any) {
                    setVal('modal-commercial-narrative', `Could not load audit: ${err.message}`);
                    auditCard.style.display = 'block';
                } finally {
                    auditBtn.innerHTML = '<span>📊 Commercial Breakdown</span>';
                }
            };
        }

        // Populate printer dropdown
        const sel = document.getElementById('modal-printer-select') as HTMLSelectElement | null;
        if (sel) {
            sel.innerHTML = ui_printers.length === 0
                ? `<option value="">— No printers available on this device —</option>`
                : `<option value="">— Select a printer —</option>` + ui_printers.map(p =>
                    `<option value="${p.printerId}">${p.name}${p.isDefault ? ' (Default)' : ''}${p.status !== 'idle' && p.status !== 'busy' ? ` — ${p.status}` : ''}</option>`
                ).join('');

            sel.onchange = () => ui_onPrinterSelect(order, sel.value);
        }

        // Validation box
        const vbox = document.getElementById('modal-validation-box');
        if (vbox) {
            vbox.textContent = ui_printers.length === 0
                ? 'No physical printers detected on this device. Connect a printer to enable printing.'
                : 'Select a printer to validate compatibility with this order\'s settings.';
            vbox.style.color = ui_printers.length === 0 ? 'var(--amber)' : '';
        }

        // Status track
        ui_updateStatusTrack(order.status);

        // Action area
        ui_renderModalActions(order);

        // Message area
        const msg = document.getElementById('modal-msg');
        if (msg) msg.style.display = 'none';

        // Check for existing job mapping & Safe Print Recovery safety
        let existingJob: any = null;
        try {
            existingJob = await fetchOrderPrintJob(order.id);
            const safety = evaluatePrintRetrySafety({
                orderId: order.id,
                orderPaymentStatus: order.payment_status || (order.status !== 'QUEUED' && order.status !== 'CANCELLED' ? 'paid' : 'pending'),
                activePrintJob: existingJob,
            });

            const recoveryCard = document.getElementById('modal-recovery-warning-card');
            const recoveryTitle = document.getElementById('modal-recovery-title');
            const recoveryMsg = document.getElementById('modal-recovery-message');
            const inspectBtn = document.getElementById('modal-btn-recovery-inspect');

            if (recoveryCard && recoveryTitle && recoveryMsg) {
                if (safety.isPrintBlocked && (existingJob || safety.safetyState === 'AMBIGUOUS_SPOOL_CHECK_REQUIRED')) {
                    recoveryCard.style.display = 'block';
                    recoveryTitle.textContent = `⚠️ ${safety.headline}`;
                    recoveryMsg.textContent = safety.userMessage;
                    const btn = document.getElementById('modal-btn-start-print') as HTMLButtonElement | null;
                    if (btn) btn.disabled = true;
                } else {
                    recoveryCard.style.display = 'none';
                }
            }

            if (inspectBtn) {
                inspectBtn.onclick = () => {
                    backdrop.style.display = 'none';
                    ui_activateTab('printqueue');
                };
            }

            if (existingJob && (existingJob.status === 'QUEUED' || existingJob.status === 'PRINTING')) {
                const btn = document.getElementById('modal-btn-start-print') as HTMLButtonElement | null;
                if (btn) btn.disabled = true;
                if (vbox) {
                    vbox.textContent = `A print job is already active for this order (${existingJob.status}). Monitor it in the Print Queue tab.`;
                    vbox.style.color = 'var(--amber)';
                }
            } else if (existingJob && existingJob.status === 'COMPLETED' && order.status === 'QUEUED') {
                // Printer completed but order not yet transitioned — inform vendor
                if (vbox) {
                    vbox.textContent = `A previous print job for this order completed. The order may still need manual status update.`;
                    vbox.style.color = 'var(--accent)';
                }
            }
        } catch { /* non-critical */ }

        ui_updateHonestConnectivityHud(order, existingJob);

        backdrop.style.display = 'flex';

        // Load PDF preview for active document
        if (ui_activeOrderFile) {
            ui_loadDocumentPreview(ui_activeOrderFile, order.id);
        }
    }

    // Printer change handler in modal
    function ui_onPrinterSelect(order: VendorQueueOrder, printerId: string) {
        const vbox = document.getElementById('modal-validation-box');
        const startBtn = document.getElementById('modal-btn-start-print') as HTMLButtonElement | null;

        if (!printerId) {
            if (vbox) { vbox.textContent = 'Select a printer to validate compatibility.'; vbox.style.color = ''; }
            if (startBtn) startBtn.disabled = true;
            ui_updateHonestConnectivityHud(order);
            return;
        }

        const printer = ui_printers.find(p => p.printerId === printerId);
        if (!printer) {
            if (vbox) { vbox.textContent = 'Printer not found. Refresh and try again.'; vbox.style.color = 'var(--red)'; }
            if (startBtn) startBtn.disabled = true;
            ui_updateHonestConnectivityHud(order);
            return;
        }

        const file = ui_activeOrderFile || order.order_files?.[0];
        const s = file?.print_settings;
        const probeJob: PrintJobRequest = {
            jobId: `probe-${order.id}`,
            orderId: order.id,
            orderNumber: order.order_number,
            fileId: file?.id || 'file-1',
            fileName: file?.original_filename || 'doc.pdf',
            documentUri: 'local://probe',
            mimeType: file?.mime_type || 'application/pdf',
            copies: s?.copies ?? 1,
            colorMode: (s?.colour_mode === 'colour' || s?.colour_mode === 'color') ? 'color' : 'bw',
            paperSize: (s?.paper_size?.toLowerCase() as any) || 'a4',
            duplexMode: (s?.sides === 'double_long' || s?.sides === 'double' || s?.sides === 'double_short') ? 'double_long' : 'single',
            shopId: order.shop_id,
            destination: { printerId: printer.printerId },
            createdAt: new Date().toISOString(),
            settings: {
                copies: s?.copies ?? 1,
                color: (s?.colour_mode === 'colour' || s?.colour_mode === 'color') ? 'color' : 'bw',
                sides: (s?.sides === 'double_long' || s?.sides === 'double' || s?.sides === 'double_short') ? 'double_long' : 'single',
                paperSize: (s?.paper_size?.toLowerCase() as any) || 'a4',
                orientation: (s?.orientation as any) || 'portrait',
                pagesPerSheet: 1,
                pageRange: (s?.page_range as any) || 'all',
                customRange: '', margins: 'default', scale: 'fit', headersFooters: false,
            },
        };

        const val = validateJobAgainstPrinter(probeJob, printer);
        if (vbox) {
            if (!val.valid) {
                vbox.textContent = `⚠ ${val.error?.message || 'This printer is not compatible with the order settings.'}`;
                vbox.style.color = 'var(--amber)';
                if (startBtn) startBtn.disabled = true;
            } else {
                vbox.textContent = `✓ ${printer.name} is compatible with this order. Ready to print.`;
                vbox.style.color = 'var(--emerald)';
                if (startBtn) startBtn.disabled = false;
            }
        }
        ui_updateHonestConnectivityHud(order);
    }

    // Handle Start Printing button click in modal
    async function ui_handleStartPrint(order: VendorQueueOrder) {
        const sel = document.getElementById('modal-printer-select') as HTMLSelectElement | null;
        const printerId = sel?.value;
        if (!printerId) return;

        const startBtn = document.getElementById('modal-btn-start-print') as HTMLButtonElement | null;
        const msg = document.getElementById('modal-msg');

        if (startBtn) startBtn.style.display = 'none';

        // Show spinner
        const spinnerBtn = document.getElementById('modal-btn-spinner') as HTMLButtonElement | null;
        if (spinnerBtn) {
            spinnerBtn.innerHTML = '<span class="btn-spinner"></span> Starting Print…';
            spinnerBtn.style.display = 'flex';
        }

        if (msg) { msg.style.display = 'none'; msg.className = 'modal-msg'; }

        // Fail-Closed Print Retry Safety Check
        try {
            const existingJob = await fetchOrderPrintJob(order.id).catch(() => null);
            const printSafety = evaluatePrintRetrySafety({
                orderId: order.id,
                orderPaymentStatus: order.payment_status || (order.status !== 'QUEUED' && order.status !== 'CANCELLED' ? 'paid' : 'pending'),
                activePrintJob: existingJob,
            });

            if (printSafety.isPrintBlocked) {
                const recoveryCard = document.getElementById('modal-recovery-warning-card');
                const recoveryTitle = document.getElementById('modal-recovery-title');
                const recoveryMsg = document.getElementById('modal-recovery-message');
                if (recoveryCard && recoveryTitle && recoveryMsg) {
                    recoveryCard.style.display = 'block';
                    recoveryTitle.textContent = `⚠️ ${printSafety.headline}`;
                    recoveryMsg.textContent = printSafety.userMessage;
                }
                if (msg) {
                    msg.textContent = printSafety.userMessage;
                    msg.className = 'modal-msg error';
                    msg.style.display = 'block';
                }
                if (startBtn) startBtn.style.display = 'flex';
                if (spinnerBtn) spinnerBtn.style.display = 'none';
                return;
            }
        } catch { /* proceed to guarded execution */ }

        try {
            const result = await processOrderPrint(order, printerId, ui_token, ui_backendUrl);
            if (result.success) {
                const isCompleted = result.status === 'COMPLETED';
                ui_updateHonestConnectivityHud(order, {
                    localJobId: result.localJobId,
                    nativeJobId: result.nativeJobId,
                    submissionState: 'SUBMITTED',
                    status: result.status,
                    submittedAt: new Date().toISOString(),
                    completedAt: isCompleted ? new Date().toISOString() : undefined,
                });
                if (msg) {
                    msg.textContent = isCompleted
                        ? 'Printing finished. Checking the order and finishing requirements…'
                        : 'Print job submitted successfully. Spooling to printer…';
                    msg.className = 'modal-msg success';
                    msg.style.display = 'block';
                }
                const confirmed = await syncOrderPrintStatus(order.id, ui_backendUrl, ui_token);
                const newStatus = confirmed.orderStatus === 'READY' ? 'READY' : 'PRINTING';
                ui_updateStatusTrack(newStatus);
                ui_renderModalActions({ ...order, status: newStatus });
                // Refresh orders list in background
                setTimeout(() => ui_refreshOrders(), 1500);
                setTimeout(() => ui_refreshPrintQueue(), 1500);
                setTimeout(() => ui_refreshPersistedJobs(), 1500);
            } else {
                ui_updateHonestConnectivityHud(order, {
                    submissionState: 'SUBMISSION_FAILED',
                    status: 'FAILED',
                    errorMessage: result.error,
                });
                if (startBtn) startBtn.style.display = 'flex';
                if (msg) {
                    // Translate internal error codes to friendly messages
                    let friendlyError = result.error || 'Submission failed. Please try again.';
                    if (friendlyError.includes('UNPAID_ORDER_BLOCKED')) friendlyError = 'This order has not been paid yet. Only paid orders can be printed.';
                    else if (friendlyError.includes('DUPLICATE_PRINT_BLOCKED')) friendlyError = 'A print job is already active for this order.';
                    else if (friendlyError.includes('PRINTER_NOT_FOUND')) friendlyError = 'The selected printer is no longer available. Refresh and try again.';
                    else if (friendlyError.includes('CAPABILITY_MISMATCH')) friendlyError = `Printer not compatible: ${friendlyError.split('CAPABILITY_MISMATCH: ')[1] || ''}`;
                    else if (friendlyError.includes('DOWNLOAD_FAILED')) friendlyError = 'Could not download the customer document. Check your connection.';
                    else if (friendlyError.includes('NO_DOCUMENTS')) friendlyError = 'This order has no printable documents attached.';
                    else if (friendlyError.includes('NO_PRINTERS')) friendlyError = 'No printers are available on this device.';
                    msg.textContent = friendlyError;
                    msg.className = 'modal-msg error';
                    msg.style.display = 'block';
                }
            }
        } catch (err: any) {
            const recoveryCard = document.getElementById('modal-recovery-warning-card');
            const recoveryTitle = document.getElementById('modal-recovery-title');
            const recoveryMsg = document.getElementById('modal-recovery-message');
            if (recoveryCard && recoveryTitle && recoveryMsg) {
                recoveryCard.style.display = 'block';
                recoveryTitle.textContent = '⚠️ Spooler Outcome Unknown';
                recoveryMsg.textContent = 'Spool request timed out or returned an ambiguous error. Inspect the print queue before retrying.';
            }
            ui_updateHonestConnectivityHud(order, {
                submissionState: 'SUBMISSION_FAILED',
                status: 'FAILED',
                errorMessage: err?.message,
            });
            if (startBtn) startBtn.style.display = 'flex';
            if (msg) {
                msg.textContent = `Unexpected error: ${err?.message || 'Unknown error'}. Please verify print queue before retrying.`;
                msg.className = 'modal-msg error';
                msg.style.display = 'block';
            }
        } finally {
            if (spinnerBtn) spinnerBtn.style.display = 'none';
        }
    }

    // Render orders table loading state
    function ui_renderOrdersLoading(tbodyId: string = 'orders-tbody') {
        const tbody = document.getElementById(tbodyId);
        if (!tbody) return;
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="empty-row">
                    <div class="empty-state">
                        <div class="table-spinner"></div>
                        <p class="empty-title">Loading orders…</p>
                        <p class="empty-sub">Fetching active orders from XerService backend.</p>
                    </div>
                </td>
            </tr>
        `;
    }

    // Render orders table error state with retry action
    function ui_renderOrdersError(tbodyId: string = 'orders-tbody', errorMsg: string = 'Failed to load orders') {
        const tbody = document.getElementById(tbodyId);
        if (!tbody) return;
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="empty-row">
                    <div class="empty-state">
                        <div class="empty-emoji">⚠️</div>
                        <p class="empty-title" style="color:var(--red);">Failed to load orders</p>
                        <p class="empty-sub" style="max-width:420px; margin:0 auto 1rem auto; word-break:break-word;">${ui_escapeHtml(errorMsg)}</p>
                        <button class="btn-secondary" id="btn-orders-retry" style="display:inline-flex; align-items:center; gap:0.4rem; margin:0 auto;">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23,4 23,10 17,10"/><polyline points="1,20 1,14 7,14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
                            Retry
                        </button>
                    </div>
                </td>
            </tr>
        `;
        tbody.querySelector('#btn-orders-retry')?.addEventListener('click', () => {
            ui_refreshOrders();
        });
    }

    // Render orders table (used by both overview and orders tab)
    function ui_renderOrdersTable(orders: VendorQueueOrder[], tbodyId: string, maxRows?: number, filterStatus?: string) {
        const activeFilter = filterStatus || 'all';

        const tbody = document.getElementById(tbodyId);
        if (!tbody) {
            return;
        }

        try {
            const safeOrders = Array.isArray(orders) ? orders : [];
            let filtered = activeFilter !== 'all'
                ? safeOrders.filter(o => o.status === activeFilter)
                : safeOrders;

            if (maxRows) filtered = filtered.slice(0, maxRows);

            if (filtered.length === 0) {
                const label = activeFilter !== 'all' ? activeFilter.toLowerCase() : 'active';
                const sub = activeFilter !== 'all'
                    ? `There are currently no orders with status '${activeFilter}'.`
                    : 'Customer orders will appear here when placed.';
                tbody.innerHTML = `<tr><td colspan="7" class="empty-row"><div class="empty-state"><div class="empty-emoji">📦</div><p class="empty-title">No ${label} orders</p><p class="empty-sub">${sub}</p></div></td></tr>`;
                void recordFrontendTelemetry('STAGE_13_RENDER_SUCCESS', 'ui_renderOrdersTable', `empty state, filter=${activeFilter}`);
                return;
            }

            tbody.innerHTML = '';
            for (const ord of filtered) {
                const tr = document.createElement('tr');
                tr.className = 'order-table-row';
                const docCount = ord.order_files?.length || 0;
                const docName = ord.order_files?.[0]?.original_filename || (docCount > 0 ? `${docCount} document(s)` : 'No document attached');
                const isActionable = ord.status === 'QUEUED' || ord.status === 'PRINTING';
                const filesTooltip = ord.order_files?.map((f: any) => f?.original_filename)?.filter(Boolean)?.join(', ') || '';

                tr.innerHTML = `
                    <td style="font-family:monospace; font-weight:600; color:var(--fg);">${ui_escapeHtml(ord.order_number)}</td>
                    <td style="color:var(--fg);">${ui_escapeHtml(ord.customerName || 'Customer')}</td>
                    <td>
                        <span style="color:var(--fg);" title="${ui_escapeHtml(filesTooltip)}">${ui_escapeHtml(docName)}</span>
                        <br/><span style="font-size:0.75rem; color:var(--fg-muted);">${ord.total_printable_pages || 0} pages</span>
                    </td>
                    <td style="color:var(--fg); font-weight:600;">₹${ui_formatCurrency(ord.total_amount)}</td>
                    <td>${ui_pill(ord.status)}</td>
                    <td style="font-size:0.75rem; color:var(--fg-muted);">${ui_relativeTime(ord.created_at)}</td>
                    <td>
                        <button class="btn-action ${isActionable ? 'btn-action-primary' : ''}" style="${!isActionable ? 'background:var(--bg-3); color:var(--fg-muted); border:1px solid var(--border-strong);' : ''}"
                            data-order-id="${ord.id}">
                            ${isActionable ? '🖨 Print' : 'View'}
                        </button>
                    </td>
                `;
                tr.querySelector('button')?.addEventListener('click', (e) => {
                    e.stopPropagation();
                    ui_openOrderModal(ord);
                });
                tr.style.cursor = 'pointer';
                tr.addEventListener('click', () => ui_openOrderModal(ord));
                tbody.appendChild(tr);
            }

            void recordFrontendTelemetry('STAGE_13_RENDER_SUCCESS', 'ui_renderOrdersTable', `rows=${filtered.length}, tbody=${tbodyId}`);
        } catch (err: any) {
            void recordFrontendTelemetry('STAGE_13_RENDER_EXCEPTION', 'ui_renderOrdersTable', `error=${err?.message || 'unknown'}`);
            ui_renderOrdersError(tbodyId, err?.message || 'Rendering failed unexpectedly');
        }
    }

    // Render overview recent orders
    function ui_renderOverviewRecentOrders(orders: VendorQueueOrder[]) {
        const container = document.getElementById('overview-recent-orders');
        if (!container) return;

        const active = orders.filter(o => o.status !== 'COMPLETED' && o.status !== 'CANCELLED').slice(0, 5);
        if (active.length === 0) {
            container.innerHTML = `<div class="empty-state"><div class="empty-emoji">📋</div><p class="empty-title">No active orders</p><p class="empty-sub">Orders from customers will appear here.</p></div>`;
            return;
        }

        container.innerHTML = active.map(ord => `
            <div class="recent-order-row" data-order-id="${ord.id}" style="cursor:pointer;">
                <div class="recent-order-left">
                    <span class="recent-order-num">${ui_escapeHtml(ord.order_number)}</span>
                    <span class="recent-order-meta">${ui_escapeHtml(ord.customerName || 'Customer')} · ${ord.total_printable_pages || 0} pages · ₹${ui_formatCurrency(ord.total_amount)}</span>
                </div>
                <div style="display:flex; align-items:center; gap:0.75rem;">
                    ${ui_pill(ord.status)}
                    <button class="btn-action ${(ord.status === 'QUEUED' || ord.status === 'PRINTING') ? 'btn-action-primary' : ''}"
                        style="${(ord.status !== 'QUEUED' && ord.status !== 'PRINTING') ? 'background:var(--bg-3);color:var(--fg-muted);border:1px solid var(--border-strong);' : ''} font-size:0.75rem; padding:0.25rem 0.6rem;">
                        ${(ord.status === 'QUEUED' || ord.status === 'PRINTING') ? 'Print' : 'View'}
                    </button>
                </div>
            </div>
        `).join('');

        container.querySelectorAll('.recent-order-row').forEach((row) => {
            const ordId = row.getAttribute('data-order-id');
            const ord = orders.find(o => o.id === ordId);
            if (ord) {
                row.querySelector('button')?.addEventListener('click', (e) => {
                    e.stopPropagation();
                    ui_openOrderModal(ord);
                });
                (row as HTMLElement).addEventListener('click', () => ui_openOrderModal(ord));
            }
        });
    }

    // ──────────────────────────────────────────────
    //  STAGE A10: Shop Passbook & Statements Logic
    // ──────────────────────────────────────────────

    async function ui_loadStatements() {
        if (!ui_token) return;
        ui_statementLoading = true;
        const tbody = document.getElementById('statement-tbody');
        const emptyState = document.getElementById('statement-empty-state');
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:2rem; color:var(--fg-muted);"><span class="btn-spinner" style="width:16px;height:16px;margin-right:8px;vertical-align:middle;display:inline-block;"></span> Loading passbook statements…</td></tr>`;
        }
        if (emptyState) emptyState.style.display = 'none';

        try {
            const data = await fetchVendorStatements(ui_backendUrl, ui_token, {
                period: ui_statementPeriod,
                from: ui_statementFrom,
                to: ui_statementTo,
                search: ui_statementSearch,
            });
            ui_statementData = data;
            ui_renderStatementSummary(data);
            ui_renderStatementTable(data.transactions);
        } catch (err: any) {
            console.error('[Statements] Failed to fetch:', err);
            if (tbody) {
                tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:2rem; color:var(--red);">Failed to load statement: ${ui_escapeHtml(err?.message || 'Network error')}</td></tr>`;
            }
        } finally {
            ui_statementLoading = false;
        }
    }

    function ui_renderStatementSummary(data: VendorStatementData) {
        const setVal = (id: string, val: string | number) => {
            const el = document.getElementById(id);
            if (el) el.textContent = String(val);
        };

        setVal('statement-shop-name', data.shop.name || 'Vendor Shop');
        const periodLabel = data.period.name === 'all'
            ? 'All Time'
            : data.period.name === 'month'
            ? 'This Month'
            : data.period.name === '7d'
            ? 'Last 7 Days'
            : data.period.name === 'today'
            ? 'Today'
            : `${data.period.from} to ${data.period.to}`;
        setVal('statement-period-badge', periodLabel);
        setVal('statement-payment-account', data.shop.paymentAccount || 'UPI: ven***@okhdfcbank');

        setVal('statement-opening-balance', `₹${ui_formatCurrency(data.summary.openingBalance)}`);
        setVal('statement-earned', `₹${ui_formatCurrency(data.summary.earnedInPeriod)}`);
        setVal('statement-adjustments', `₹${ui_formatCurrency(data.summary.adjustmentsInPeriod)}`);
        setVal('statement-payments-received', `₹${ui_formatCurrency(data.summary.paymentsReceivedInPeriod)}`);
        setVal('statement-closing-balance', `₹${ui_formatCurrency(data.summary.closingBalance)}`);

        setVal('statement-ready-to-receive', `₹${ui_formatCurrency(data.summary.readyToReceive)}`);
        setVal('statement-pending-fulfillment', `₹${ui_formatCurrency(data.summary.pendingFulfillment)}`);

        // Keep legacy summary stats updated
        ui_renderReportsSummary();
    }

    function ui_renderStatementTable(transactions: VendorStatementTransaction[]) {
        const tbody = document.getElementById('statement-tbody');
        const emptyState = document.getElementById('statement-empty-state');
        if (!tbody) return;

        tbody.innerHTML = '';

        if (!transactions || transactions.length === 0) {
            if (emptyState) emptyState.style.display = 'block';
            return;
        }
        if (emptyState) emptyState.style.display = 'none';

        transactions.forEach(tx => {
            const tr = document.createElement('tr');
            tr.className = 'statement-row';

            let dateFormatted = '—';
            try {
                dateFormatted = new Date(tx.date).toLocaleString('en-IN', {
                    month: 'short', day: 'numeric', year: 'numeric',
                    hour: '2-digit', minute: '2-digit'
                });
            } catch { dateFormatted = tx.date; }

            let typeBadgeClass = 'badge-neutral';
            if (tx.type === 'EARNING') typeBadgeClass = 'badge-emerald';
            else if (tx.type === 'PAYMENT') typeBadgeClass = 'badge-cyan';
            else if (tx.type === 'REFUND') typeBadgeClass = 'badge-amber';

            const creditText = tx.credit !== null ? `<span style="color:var(--emerald); font-weight:600;">+₹${ui_formatCurrency(tx.credit)}</span>` : '<span style="color:var(--fg-subtle);">—</span>';
            const debitText = tx.debit !== null ? `<span style="color:var(--amber); font-weight:600;">−₹${ui_formatCurrency(tx.debit)}</span>` : '<span style="color:var(--fg-subtle);">—</span>';
            const balanceText = `₹${ui_formatCurrency(tx.runningBalance)}`;

            tr.innerHTML = `
                <td style="white-space:nowrap; font-size:0.8rem; color:var(--fg-muted);">${dateFormatted}</td>
                <td style="font-weight:600; font-size:0.8125rem;">${ui_escapeHtml(tx.reference)}</td>
                <td style="font-size:0.8125rem;">${ui_escapeHtml(tx.description)}</td>
                <td><span class="badge ${typeBadgeClass}">${tx.type}</span></td>
                <td style="text-align:right;">${creditText}</td>
                <td style="text-align:right;">${debitText}</td>
                <td style="text-align:right; font-weight:700; color:var(--fg);">${balanceText}</td>
                <td style="text-align:center;">
                    ${tx.orderId ? `<button class="btn-icon-round statement-view-order-btn" title="View Order" data-order-id="${tx.orderId}" style="width:28px; height:28px; margin:auto;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button>` : '—'}
                </td>
            `;

            if (tx.orderId) {
                tr.querySelector('.statement-view-order-btn')?.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const ord = ui_orders.find(o => o.id === tx.orderId);
                    if (ord) {
                        ui_openOrderModal(ord);
                    }
                });
            }

            tbody.appendChild(tr);
        });
    }

    async function ui_exportStatementCsv() {
        if (!ui_token) return;
        const btn = document.getElementById('btn-statement-csv') as HTMLButtonElement | null;
        if (btn) { btn.disabled = true; btn.innerHTML = '<span class="btn-spinner" style="width:14px;height:14px;display:inline-block;vertical-align:middle;margin-right:4px;"></span> Exporting…'; }
        try {
            const { csv, filename } = await downloadVendorStatementCsv(ui_backendUrl, ui_token, {
                period: ui_statementPeriod,
                from: ui_statementFrom,
                to: ui_statementTo,
                search: ui_statementSearch,
            });
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(link.href);
        } catch (err: any) {
            alert('Failed to export statement CSV: ' + (err?.message || 'Error'));
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg><span>Export CSV</span>`;
            }
        }
    }

    function ui_printStatementPdf() {
        window.print();
    }

    // Render session reports summary
    function ui_renderReportsSummary() {
        const setEl = (id: string, val: string | number) => {
            const el = document.getElementById(id);
            if (el) el.textContent = String(val);
        };
        setEl('report-total-orders', ui_orders.length);
        const totalPages = ui_orders.reduce((acc, o) => acc + (Number(o.total_printable_pages) || 0), 0);
        setEl('report-total-pages', totalPages);
        const totalRev = ui_orders.reduce((acc, o) => acc + (Number(o.total_amount) || 0), 0);
        setEl('report-total-revenue', `₹${ui_formatCurrency(totalRev)}`);
    }

    // Update overview stat cards
    function ui_updateStatCards(orders: VendorQueueOrder[]) {
        const queued = orders.filter(o => o.status === 'QUEUED').length;
        const printing = orders.filter(o => o.status === 'PRINTING').length;
        const ready = orders.filter(o => o.status === 'READY').length;

        const setEl = (id: string, val: string | number) => {
            const el = document.getElementById(id);
            if (el) el.textContent = String(val);
        };
        setEl('stat-queued', queued);
        setEl('stat-printing', printing);
        setEl('stat-ready', ready);
        setEl('stat-printers', ui_printers.length);

        // Update orders badge in sidebar
        const badge = document.getElementById('nav-orders-badge');
        const urgentCount = queued + printing;
        if (badge) {
            badge.textContent = String(urgentCount);
            badge.style.display = urgentCount > 0 ? 'inline-flex' : 'none';
        }

        // No printer banner
        const noBanner = document.getElementById('no-printer-banner');
        if (noBanner) noBanner.style.display = ui_printers.length === 0 ? 'flex' : 'none';

        // Keep reports summary in sync
        ui_renderReportsSummary();
    }

    // Refresh vendor orders from API
    async function ui_refreshOrders() {
        if (!ui_token || ui_ordersLoading) return;
        ui_ordersLoading = true;
        ui_ordersError = null;
        ui_renderOrdersLoading('orders-tbody');
        ui_updateHonestConnectivityHud(ui_modalOrder);

        try {
            let orders = await fetchVendorQueueOrders(ui_backendUrl, ui_token);
            for (const order of orders.filter(item => item.status === 'PRINTING' || item.status === 'QUEUED')) {
                try { await syncOrderPrintStatus(order.id, ui_backendUrl, ui_token); } catch { /* Retry after reconnection; retain backend state. */ }
            }
            orders = await fetchVendorQueueOrders(ui_backendUrl, ui_token);
            ui_orders = orders;
            loadedVendorOrders = orders; // keep legacy in sync
            ui_ordersLoading = false;
            ui_lastSyncTimestamp = Date.now();
            ui_backendReachable = true;
            ui_updateHonestConnectivityHud(ui_modalOrder);
            void recordFrontendTelemetry('STAGE_5_STATE_LENGTH', undefined, `count=${ui_orders.length}`);

            ui_updateStatCards(orders);
            ui_renderOverviewRecentOrders(orders);
            ui_renderOrdersTable(orders, 'orders-tbody', undefined, ui_activeOrderFilter);

            // Also update legacy hidden tbody for test compat
            const legacyTbody = document.getElementById('vendor-orders-body');
            if (legacyTbody) {
                legacyTbody.setAttribute('data-order-count', String(orders.length));
            }
        } catch (err: any) {
            ui_ordersLoading = false;
            ui_backendReachable = false;
            ui_updateHonestConnectivityHud(ui_modalOrder);
            ui_ordersError = err?.message || 'Failed to load orders';
            console.error('[XerService Vendor UI] Failed to load orders:', err?.message);
            ui_renderOrdersError('orders-tbody', ui_ordersError || 'Failed to load orders');
        }
    }

    // Refresh print queue (CUPS spooler)
    async function ui_refreshPrintQueue() {
        const tbody = document.getElementById('queue-tbody');
        if (!tbody) return;
        try {
            const queue = await getPrintQueue();
            if (queue.length === 0) {
                tbody.innerHTML = `<tr><td colspan="4" class="empty-row"><div class="empty-state"><div class="empty-emoji">🖨️</div><p class="empty-title">No active print jobs</p><p class="empty-sub">Jobs currently being printed will appear here.</p></div></td></tr>`;
                return;
            }
            tbody.innerHTML = '';
            for (const item of queue) {
                const tr = document.createElement('tr');
                const isXerService = item.managedByXerService;
                tr.innerHTML = `
                    <td style="color:var(--fg);">${item.printerId}</td>
                    <td style="color:var(--fg);">${item.title || 'Document'}</td>
                    <td>${ui_pill(item.status)}</td>
                    <td>
                        ${item.cancellable && isXerService
                            ? `<button class="btn-action btn-action-cancel" data-job-id="${item.jobId}" data-printer-id="${item.printerId}">Cancel</button>`
                            : `<span style="color:var(--fg-subtle); font-size:0.75rem;">${isXerService ? 'Not cancellable' : 'External job'}</span>`
                        }
                    </td>
                `;
                tr.querySelector('[data-job-id]')?.addEventListener('click', async (e) => {
                    const btn = e.target as HTMLButtonElement;
                    const jobId = btn.getAttribute('data-job-id') || '';
                    const pid = btn.getAttribute('data-printer-id') || undefined;
                    btn.disabled = true;
                    btn.textContent = 'Cancelling…';
                    await cancelNativePrintJob(jobId, pid);
                    await ui_refreshPrintQueue();
                });
                tbody.appendChild(tr);
            }

            // Also sync legacy hidden table
            const legacyTbody = document.getElementById('queue-table-body');
            if (legacyTbody) legacyTbody.setAttribute('data-job-count', String(queue.length));

        } catch (err: any) {
            tbody.innerHTML = `<tr><td colspan="4" class="empty-row" style="color:var(--red);">Unable to read print queue. ${err?.message || ''}</td></tr>`;
        }
    }

    // Refresh persisted jobs
    async function ui_refreshPersistedJobs() {
        const tbody = document.getElementById('persisted-tbody');
        if (!tbody) return;
        try {
            const jobs = await fetchPersistedPrintJobs();

            // Also sync legacy hidden tbody for test compat
            const legacyTbody = document.getElementById('persisted-table-body');
            if (legacyTbody) legacyTbody.setAttribute('data-job-count', String(jobs.length));

            if (jobs.length === 0) {
                tbody.innerHTML = `<tr><td colspan="4" class="empty-row"><span style="color:var(--fg-muted); font-size:0.85rem;">No job history for this session.</span></td></tr>`;
                return;
            }
            tbody.innerHTML = '';
            for (const job of jobs) {
                // Find related order number if possible
                const relatedOrder = ui_orders.find(o => o.id === job.xerServiceOrderId);
                const orderLabel = relatedOrder ? relatedOrder.order_number : (job.xerServiceOrderId ? job.xerServiceOrderId.slice(0, 10) + '…' : '—');

                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td style="font-family:monospace; font-size:0.8125rem; color:var(--fg);">${orderLabel}</td>
                    <td style="color:var(--fg-muted);">${job.printerId || '—'}</td>
                    <td>${ui_pill(job.status)}</td>
                    <td style="font-size:0.75rem; color:var(--fg-subtle);">${ui_relativeTime(job.updatedAt)}</td>
                `;
                tbody.appendChild(tr);
            }
        } catch (err: any) {
            tbody.innerHTML = `<tr><td colspan="4" class="empty-row" style="color:var(--red);">Unable to read job history. ${err?.message || ''}</td></tr>`;
        }
    }

    // Update printer status indicator in top bar
    function ui_updatePrinterIndicator() {
        const dot = document.getElementById('printer-status-dot');
        const label = document.getElementById('printer-status-label');
        if (!dot || !label) return;
        if (ui_printers.length === 0) {
            dot.className = 'printer-dot printer-dot-warn';
            label.textContent = 'No printers';
        } else {
            dot.className = 'printer-dot printer-dot-ok';
            label.textContent = `${ui_printers.length} printer${ui_printers.length > 1 ? 's' : ''} ready`;
        }
    }

    let ui_vendorSession: AuthenticatedVendorSession | null = null;

    // Sign-in flow: Authenticate vendor with email & password via existing Supabase Auth
    async function ui_signIn() {
        const emailInput = document.getElementById('login-email') as HTMLInputElement | null;
        const passwordInput = document.getElementById('login-password') as HTMLInputElement | null;
        const errorBox = document.getElementById('login-error');
        const signInBtn = document.getElementById('btn-sign-in') as HTMLButtonElement | null;
        const label = document.getElementById('sign-in-label');
        const spinner = document.getElementById('sign-in-spinner');

        const email = emailInput?.value.trim() || '';
        const password = passwordInput?.value || '';

        if (!email) {
            if (errorBox) { errorBox.textContent = 'Please enter your registered vendor email.'; errorBox.style.display = 'block'; }
            return;
        }
        if (!password) {
            if (errorBox) { errorBox.textContent = 'Please enter your password.'; errorBox.style.display = 'block'; }
            return;
        }

        if (signInBtn) signInBtn.disabled = true;
        if (label) label.style.display = 'none';
        if (spinner) spinner.style.display = 'inline-block';
        if (errorBox) errorBox.style.display = 'none';

        let signInStage: 'authentication' | 'backend' | 'printers' = 'authentication';
        try {
            // 1. Authenticate against Supabase Auth authority with in-memory session (never in localStorage)
            const session = await authenticateVendor(email, password);
            ui_vendorSession = session;
            ui_token = session.accessToken; // kept strictly in memory for this application session
            void recordFrontendTelemetry('STAGE_1_AUTH_SUCCESS', 'authenticateVendor', 'vendor authenticated');

            // 2. Fetch active orders for this authorized vendor shop
            ui_ordersLoading = true;
            ui_ordersError = null;
            ui_renderOrdersLoading('orders-tbody');

            signInStage = 'backend';
            const orders = await fetchVendorQueueOrders(ui_backendUrl, session.accessToken);
            ui_orders = orders;
            loadedVendorOrders = orders;
            ui_ordersLoading = false;
            void recordFrontendTelemetry('STAGE_5_STATE_LENGTH', undefined, `count=${ui_orders.length}`);

            // 3. Discover host printers
            signInStage = 'printers';
            ui_printers = await fetchPrinters();
            discoveredPrinters = ui_printers;

            // 4. Update vendor identity & shop information in sidebar
            const shopNameEl = document.getElementById('sidebar-shop-name');
            if (shopNameEl) shopNameEl.textContent = session.shopName;

            const vendorNameEl = document.getElementById('sidebar-vendor-name');
            if (vendorNameEl) vendorNameEl.textContent = session.fullName;

            const avatarEl = document.getElementById('sidebar-avatar');
            if (avatarEl) avatarEl.textContent = (session.fullName || session.email || 'V').charAt(0).toUpperCase();

            // 5. Clear password from input element for security
            if (passwordInput) { passwordInput.value = ''; passwordInput.type = 'password'; }
            const toggle = document.getElementById('toggle-password');
            if (toggle) { toggle.textContent = 'Show'; toggle.setAttribute('aria-label', 'Show password'); toggle.setAttribute('aria-pressed', 'false'); }

            // 6. Ensure localStorage NEVER contains any authentication token
            try {
                localStorage.removeItem('xerservice_vendor_token');
            } catch { /* ignore */ }

            // 7. Switch to dashboard view
            const loginScreen = document.getElementById('login-screen');
            const appShell = document.getElementById('app-shell');
            if (loginScreen) loginScreen.style.display = 'none';
            if (appShell) appShell.style.display = 'grid';

            // 8. Update UI tables and indicators
            ui_updatePrinterIndicator();
            ui_updatePrinterAttention();
            ui_updateStatCards(orders);
            ui_renderOverviewRecentOrders(orders);
            ui_renderOrdersTable(orders, 'orders-tbody', undefined, ui_activeOrderFilter);
            await ui_refreshPrintQueue();
            await ui_refreshPersistedJobs();

            // 9. Stage A8: Fetch overview metrics and update header status
            ui_updateHeaderStatus(session.shopName, session.shopStatus || 'OPEN', true);
            void ui_refreshOverview();

        } catch (err: any) {
            ui_ordersLoading = false;
            ui_ordersError = err?.message || 'Authentication failed';
            if (errorBox) {
                let msg = err?.message || 'Authentication failed. Please check your credentials.';
                if (msg === 'Load failed' || msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
                    errorBox.textContent = signInStage === 'authentication'
                        ? 'Could not reach the sign-in service. Check your internet connection and Supabase configuration, then try again.'
                        : signInStage === 'backend'
                            ? `Could not reach the website server at ${ui_backendUrl}. For local development, run pnpm dev in the project folder and try again.`
                            : 'Could not connect to the printer service. Open the native app with pnpm desktop and try again.';
                } else {
                    errorBox.textContent = msg;
                }
                errorBox.style.display = 'block';
            }
        } finally {
            if (signInBtn) signInBtn.disabled = false;
            if (label) label.style.display = 'inline';
            if (spinner) spinner.style.display = 'none';
        }
    }

    // Vendor Dashboard UI initialization
    async function vendorUIBootstrap() {
        // Initialize backend URL from saved preference, runtime, or default
        const savedUrl = (typeof localStorage !== 'undefined') ? localStorage.getItem('xerservice_desktop_backend_url') : null;
        if (savedUrl) {
            ui_backendUrl = savedUrl;
            currentBackendUrl = savedUrl;
        } else {
            try {
                const rt = await fetchRuntimeInfo();
                ui_backendUrl = rt.backendUrl || DEFAULT_BACKEND_URL;
                currentBackendUrl = ui_backendUrl;
            } catch {
                ui_backendUrl = DEFAULT_BACKEND_URL;
                currentBackendUrl = ui_backendUrl;
            }
        }

        // Synchronize server selection UI
        const serverSel = document.getElementById('login-server-url') as HTMLSelectElement | null;
        const customServerInput = document.getElementById('login-custom-server') as HTMLInputElement | null;
        if (serverSel) {
            if (ui_backendUrl === 'http://localhost:3000' || ui_backendUrl === 'https://api.xerservice.in') {
                serverSel.value = ui_backendUrl;
                if (customServerInput) customServerInput.style.display = 'none';
            } else {
                serverSel.value = 'custom';
                if (customServerInput) {
                    customServerInput.style.display = 'block';
                    customServerInput.value = ui_backendUrl;
                }
            }
            serverSel.addEventListener('change', () => {
                if (serverSel.value === 'custom') {
                    if (customServerInput) {
                        customServerInput.style.display = 'block';
                        customServerInput.focus();
                    }
                } else {
                    if (customServerInput) customServerInput.style.display = 'none';
                    ui_backendUrl = serverSel.value;
                    currentBackendUrl = ui_backendUrl;
                    try { localStorage.setItem('xerservice_desktop_backend_url', ui_backendUrl); } catch { /* ignore */ }
                    void ui_checkBackendHealth();
                }
            });
        }
        if (customServerInput) {
            customServerInput.addEventListener('input', () => {
                const val = customServerInput.value.trim();
                if (val) {
                    ui_backendUrl = val;
                    currentBackendUrl = ui_backendUrl;
                    try { localStorage.setItem('xerservice_desktop_backend_url', ui_backendUrl); } catch { /* ignore */ }
                    void ui_checkBackendHealth();
                }
            });
        }

        const internalUrl = document.getElementById('internal-backend-url') as HTMLInputElement | null;
        if (internalUrl) internalUrl.value = ui_backendUrl;

        // Initial honest connectivity ping and HUD refresh
        void ui_checkBackendHealth();
        ui_updateHonestConnectivityHud();

        // Ensure localStorage contains NO authentication credentials
        try {
            localStorage.removeItem('xerservice_vendor_token');
        } catch { /* ignore */ }

        // Accessible visibility toggle; showing a password never submits the form.
        const passwordInput = document.getElementById('login-password') as HTMLInputElement | null;
        const passwordToggle = document.getElementById('toggle-password');
        passwordToggle?.addEventListener('click', () => {
            if (!passwordInput) return;
            const show = passwordInput.type === 'password';
            passwordInput.type = show ? 'text' : 'password';
            passwordToggle.textContent = show ? 'Hide' : 'Show';
            passwordToggle.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
            passwordToggle.setAttribute('aria-pressed', String(show));
        });

        // Sign-in button & keyboard enter handlers
        document.getElementById('btn-sign-in')?.addEventListener('click', ui_signIn);
        document.getElementById('login-email')?.addEventListener('keydown', (e: Event) => {
            if ((e as KeyboardEvent).key === 'Enter') {
                const pass = document.getElementById('login-password') as HTMLInputElement | null;
                if (pass && !pass.value) pass.focus();
                else ui_signIn();
            }
        });
        document.getElementById('login-password')?.addEventListener('keydown', (e: Event) => {
            if ((e as KeyboardEvent).key === 'Enter') ui_signIn();
        });

        const refreshWhenVisible = () => {
            void ui_checkBackendHealth();
            if (ui_token && document.visibilityState !== 'hidden') void ui_refreshOrders();
        };
        const statusTimer = window.setInterval(refreshWhenVisible, 15000);
        window.addEventListener('focus', refreshWhenVisible);
        window.addEventListener('online', refreshWhenVisible);
        window.addEventListener('beforeunload', () => clearInterval(statusTimer), { once: true });

        // Sign-out button: clears session from memory and Supabase client
        document.getElementById('btn-signout')?.addEventListener('click', async () => {
            await signOutVendor();
            ui_vendorSession = null;
            ui_token = '';
            ui_orders = [];
            ui_printers = [];
            ui_updateHonestConnectivityHud();
            try {
                localStorage.removeItem('xerservice_vendor_token');
            } catch { /* ignore */ }
            const loginScreen = document.getElementById('login-screen');
            const appShell = document.getElementById('app-shell');
            if (loginScreen) loginScreen.style.display = 'flex';
            if (appShell) appShell.style.display = 'none';
            const passEl = document.getElementById('login-password') as HTMLInputElement | null;
            if (passEl) passEl.value = '';
            const errEl = document.getElementById('login-error');
            if (errEl) errEl.style.display = 'none';
        });

        // Sidebar brand click -> navigate to overview
        document.getElementById('sidebar-brand')?.addEventListener('click', () => ui_activateTab('overview'));

        // Tab navigation
        document.querySelectorAll('.nav-item[data-tab]').forEach(el => {
            el.addEventListener('click', () => {
                const tab = el.getAttribute('data-tab');
                if (tab) ui_activateTab(tab);
            });
        });

        // Tab-jump links (e.g. "View all →" on overview, Return to Overview on reports)
        document.querySelectorAll('[data-tab-jump]').forEach(el => {
            el.addEventListener('click', () => {
                const tab = el.getAttribute('data-tab-jump');
                if (tab) ui_activateTab(tab);
            });
        });

        // Filter tabs on Orders (including device-jobs toggle)
        document.querySelectorAll('.filter-tab').forEach(el => {
            el.addEventListener('click', () => {
                document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
                el.classList.add('active');
                ui_activeOrderFilter = el.getAttribute('data-filter') || 'all';

                const tableWrap = document.getElementById('orders-table-wrap');
                const deviceWrap = document.getElementById('orders-device-jobs-container');

                if (ui_activeOrderFilter === 'device-jobs') {
                    if (tableWrap) tableWrap.style.display = 'none';
                    if (deviceWrap) deviceWrap.style.display = 'block';
                    void ui_refreshDeviceJobs();
                } else {
                    if (tableWrap) tableWrap.style.display = 'block';
                    if (deviceWrap) deviceWrap.style.display = 'none';
                    ui_renderOrdersTable(ui_orders, 'orders-tbody', undefined, ui_activeOrderFilter);
                }
            });
        });

        // ── Stage A8: Theme toggle ──
        document.getElementById('btn-theme-toggle')?.addEventListener('click', ui_cycleTheme);

        // ── Stage A8: Theme radio cards in Settings ──
        document.querySelectorAll('input[name="app-theme"]').forEach(radio => {
            radio.addEventListener('change', (e) => {
                const value = (e.target as HTMLInputElement).value as 'system' | 'light' | 'dark';
                ui_setTheme(value);
            });
        });

        // Initialize theme from localStorage
        const savedTheme = localStorage.getItem('xerservice_desktop_theme') as 'system' | 'light' | 'dark' | null;
        ui_setTheme(savedTheme || 'system');

        // ── Stage A8: Shop availability toggle buttons ──
        document.getElementById('btn-shop-open')?.addEventListener('click', () => ui_setShopAvailability('OPEN'));
        document.getElementById('btn-shop-paused')?.addEventListener('click', () => ui_setShopAvailability('PAUSED'));
        document.getElementById('btn-shop-closed')?.addEventListener('click', () => ui_setShopAvailability('CLOSED'));

        // ── Stage A8: Save shop settings ──
        document.getElementById('btn-save-settings')?.addEventListener('click', ui_saveShopSettings);

        // ── Stage A8: Customer card preview live sync ──
        ['settings-shop-name', 'settings-shop-address', 'settings-shop-phone', 'settings-open-time', 'settings-close-time'].forEach(id => {
            document.getElementById(id)?.addEventListener('input', ui_updateCustomerPreview);
        });

        // ── Stage A8: Default printer persistence ──
        document.getElementById('settings-default-printer')?.addEventListener('change', (e) => {
            const value = (e.target as HTMLSelectElement).value;
            try { localStorage.setItem('xerservice_default_printer', value); } catch { /* ignore */ }
        });

        // ── Stage A8: Device Jobs refresh & reconcile ──
        document.getElementById('btn-refresh-device-jobs')?.addEventListener('click', () => void ui_refreshDeviceJobs());
        document.getElementById('btn-device-reconcile')?.addEventListener('click', async () => {
            const btn = document.getElementById('btn-device-reconcile') as HTMLButtonElement | null;
            if (btn) { btn.disabled = true; btn.textContent = 'Reconciling…'; }
            try {
                await triggerRecoveryReconciliation();
                await ui_refreshDeviceJobs();
            } finally {
                if (btn) { btn.disabled = false; btn.innerHTML = '🔄 Reconcile Jobs'; }
            }
        });

        // ── Stage A8: Orders search filtering ──
        document.getElementById('orders-search')?.addEventListener('input', (e) => {
            ui_searchQuery = ((e.target as HTMLInputElement).value || '').trim().toLowerCase();
            ui_applyOrdersFiltering();
        });

        // ── Stage A8: Orders date filtering ──
        document.getElementById('orders-date-filter')?.addEventListener('change', (e) => {
            ui_dateFilter = (e.target as HTMLInputElement).value || '';
            ui_applyOrdersFiltering();
        });

        // Refresh buttons
        document.getElementById('btn-refresh-orders')?.addEventListener('click', ui_refreshOrders);
        document.getElementById('btn-refresh-queue')?.addEventListener('click', ui_refreshPrintQueue);
        document.getElementById('btn-refresh-persisted')?.addEventListener('click', ui_refreshPersistedJobs);
        document.getElementById('btn-refresh-all')?.addEventListener('click', async () => {
            await ui_refreshOrders();
            await ui_refreshPrintQueue();
            await ui_refreshPersistedJobs();
        });

        // ── Stage A10: Shop Passbook & Statements listeners ──
        document.getElementById('statement-period-select')?.addEventListener('change', (e) => {
            const val = (e.target as HTMLSelectElement).value;
            ui_statementPeriod = val;
            const customDates = document.getElementById('statement-custom-dates');
            if (val === 'custom') {
                if (customDates) customDates.style.display = 'flex';
            } else {
                if (customDates) customDates.style.display = 'none';
                ui_statementFrom = '';
                ui_statementTo = '';
                void ui_loadStatements();
            }
        });

        document.getElementById('btn-statement-apply-date')?.addEventListener('click', () => {
            const fromInput = document.getElementById('statement-from-date') as HTMLInputElement | null;
            const toInput = document.getElementById('statement-to-date') as HTMLInputElement | null;
            if (fromInput?.value && toInput?.value) {
                ui_statementPeriod = 'custom';
                ui_statementFrom = fromInput.value;
                ui_statementTo = toInput.value;
                void ui_loadStatements();
            }
        });

        document.getElementById('statement-search-input')?.addEventListener('input', (e) => {
            ui_statementSearch = ((e.target as HTMLInputElement).value || '').trim().toLowerCase();
            if (ui_statementData) {
                let filtered = ui_statementData.transactions;
                if (ui_statementSearch) {
                    filtered = filtered.filter(tx =>
                        tx.reference.toLowerCase().includes(ui_statementSearch) ||
                        tx.description.toLowerCase().includes(ui_statementSearch) ||
                        tx.type.toLowerCase().includes(ui_statementSearch)
                    );
                }
                ui_renderStatementTable(filtered);
            }
        });

        document.getElementById('btn-statement-csv')?.addEventListener('click', ui_exportStatementCsv);
        document.getElementById('btn-statement-print')?.addEventListener('click', ui_printStatementPdf);
        document.getElementById('btn-statement-refresh')?.addEventListener('click', ui_loadStatements);

        // Modal close
        document.getElementById('btn-modal-close')?.addEventListener('click', () => {
            const backdrop = document.getElementById('modal-backdrop');
            if (backdrop) backdrop.style.display = 'none';
            ui_cleanupPdfViewer();
            ui_modalOrder = null;
        });
        document.getElementById('modal-backdrop')?.addEventListener('click', (e) => {
            if ((e.target as HTMLElement).id === 'modal-backdrop') {
                const backdrop = document.getElementById('modal-backdrop');
                if (backdrop) backdrop.style.display = 'none';
                ui_cleanupPdfViewer();
                ui_modalOrder = null;
            }
        });

        // Safe in-app handlers for reports / web dashboard elements (never navigate out of desktop app)
        document.getElementById('btn-reports-overview')?.addEventListener('click', () => ui_activateTab('overview'));
        document.getElementById('link-web-dashboard')?.addEventListener('click', (e) => {
            e.preventDefault();
            ui_activateTab('overview');
        });

        // Global safeguard: intercept any link navigation to guarantee desktop webview containment
        document.addEventListener('click', (e) => {
            const anchor = (e.target as HTMLElement).closest('a');
            if (anchor) {
                const href = anchor.getAttribute('href');
                if (href && (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('/') || href === '#')) {
                    e.preventDefault();
                    console.warn('[XerService Desktop] External URL navigation blocked to preserve native shell:', href);
                }
            }
        });

        // Test and verification hooks on window
        (window as any).__xerserviceActivateTab = ui_activateTab;
        (window as any).__xerserviceFormatCurrency = ui_formatCurrency;
        (window as any).__xerserviceRenderOrdersTable = ui_renderOrdersTable;
        (window as any).__xerserviceRenderOrdersLoading = ui_renderOrdersLoading;
        (window as any).__xerserviceRenderOrdersError = ui_renderOrdersError;
        (window as any).__xerserviceRenderReportsSummary = ui_renderReportsSummary;
        (window as any).__xerserviceHandleStartPrint = ui_handleStartPrint;
        (window as any).__xerserviceProcessOrderPrint = processOrderPrint;
        (window as any).__xerserviceSyncOrderPrintStatus = syncOrderPrintStatus;
        (window as any).__xerserviceGetOrdersState = () => ({
            orders: ui_orders,
            loading: ui_ordersLoading,
            error: ui_ordersError,
            filter: ui_activeOrderFilter,
        });
        (window as any).__xerserviceUpdateHonestConnectivityHud = ui_updateHonestConnectivityHud;
        (window as any).__xerserviceEvaluateHonestConnectivity = evaluateHonestConnectivity;
        (window as any).__xerserviceCheckBackendHealth = ui_checkBackendHealth;
        (window as any).__xerserviceEvaluatePrintRetrySafety = evaluatePrintRetrySafety;
    }

    const startApp = async () => {
        await bootstrap();       // Runs legacy Step 8-17 IPC probes and sets up window test hooks
        await vendorUIBootstrap(); // Runs new Vendor Dashboard UI
    };

    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
        if (document.readyState === 'loading') {
            window.addEventListener('DOMContentLoaded', startApp);
        } else {
            void startApp();
        }
    }

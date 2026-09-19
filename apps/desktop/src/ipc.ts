/**
 * XerService Desktop IPC Boundary
 *
 * Provides strongly-typed client access to the Tauri v2 desktop runtime and host subsystem.
 * Strictly uses @packages/printing domain contracts for all print operations.
 */

import { invoke as tauriInvoke, isTauri } from '@tauri-apps/api/core';
import type {
    NormalizedPrinter,
    PlatformPrintingCapabilities,
    PrintErrorCode,
    PrintJobRequest,
    PrintJobResult,
    PrintJobStatus,
    PrintJobStatusInfo,
    PrintQueueItem,
    PrintJobRecord,
} from '@packages/printing';

const viteEnv = (import.meta as ImportMeta & {
    env: { DEV: boolean; VITE_BACKEND_URL?: string };
}).env;

const savedBackendUrl = (typeof window !== 'undefined' && typeof localStorage !== 'undefined')
    ? localStorage.getItem('xerservice_desktop_backend_url')
    : null;

export const DEFAULT_BACKEND_URL = savedBackendUrl || viteEnv.VITE_BACKEND_URL || 'http://localhost:3000';

export interface DesktopRuntimeInfo {
    appName: string;
    version: string;
    tauriVersion: string;
    environment: string;
    platform: string;
    backendUrl: string;
    printSubsystemStatus: string;
    isNativeRuntime: boolean;
}

// Global declaration for Tauri IPC bridge
declare global {
    interface Window {
        __TAURI__?: {
            core?: {
                invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T>;
            };
            invoke?<T>(cmd: string, args?: Record<string, unknown>): Promise<T>;
        };
        __xerserviceCustomInvoker?: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
    }
}

/**
 * Sets an explicit IPC invoker delegate (used for integration testing and headless automation).
 */
export function setIpcInvoker(invoker?: (<T>(cmd: string, args?: Record<string, unknown>) => Promise<T>) | null) {
    if (typeof window !== 'undefined') {
        window.__xerserviceCustomInvoker = invoker || undefined;
    }
}

/**
 * Invokes a Tauri IPC command with fallback for headless/browser execution.
 */
async function invokeTauri<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    if (typeof window !== 'undefined') {
        if (window.__xerserviceCustomInvoker) {
            return await window.__xerserviceCustomInvoker<T>(cmd, args);
        }
        if (isTauri()) {
            return await tauriInvoke<T>(cmd, args);
        }
        const invoker = window.__TAURI__?.core?.invoke || window.__TAURI__?.invoke;
        if (invoker) {
            return await invoker<T>(cmd, args);
        }
    }
    throw new Error(`IPC_UNAVAILABLE: Command '${cmd}' called outside Tauri v2 runtime webview.`);
}

/**
 * Sends frontend-initiated lifecycle/execution evidence across Tauri IPC to Rust.
 */
export async function recordFrontendTelemetry(stage: string, command?: string, details?: string): Promise<boolean> {
    try {
        return await invokeTauri<boolean>('record_frontend_event', {
            event: { stage, command: command ?? null, details: details ?? null },
        });
    } catch {
        return false;
    }
}

const KNOWN_PRINT_ERROR_CODES = new Set<PrintErrorCode>([
    'PRINTER_NOT_FOUND',
    'PRINTER_OFFLINE',
    'PRINTER_BUSY',
    'UNSUPPORTED_PAPER_SIZE',
    'UNSUPPORTED_COLOR_MODE',
    'UNSUPPORTED_DUPLEX',
    'INVALID_DOCUMENT',
    'PRINT_SUBMISSION_FAILED',
    'PRINT_CANCEL_FAILED',
    'PRINT_TIMEOUT',
    'UNKNOWN_PRINT_ERROR',
]);

/**
 * Preserves canonical error codes across Rust -> IPC -> TypeScript -> @packages/printing.
 */
export function mapToCanonicalErrorCode(rawCode?: string | null): PrintErrorCode {
    if (!rawCode) return 'UNKNOWN_PRINT_ERROR';
    if (KNOWN_PRINT_ERROR_CODES.has(rawCode as PrintErrorCode)) {
        return rawCode as PrintErrorCode;
    }
    switch (rawCode) {
        case 'NO_NATIVE_ADAPTER':
            return 'PRINT_SUBMISSION_FAILED';
        case 'JOB_NOT_FOUND':
            return 'PRINT_CANCEL_FAILED';
        case 'TIMEOUT':
            return 'PRINT_TIMEOUT';
        default:
            return 'UNKNOWN_PRINT_ERROR';
    }
}

/**
 * Queries desktop shell environment and subsystem health.
 */
export async function fetchRuntimeInfo(): Promise<DesktopRuntimeInfo> {
    try {
        const raw = await invokeTauri<{
            app_name: string;
            version: string;
            tauri_version: string;
            environment: string;
            platform: string;
            backend_url: string;
            print_subsystem_status: string;
        }>('get_runtime_info');

        return {
            appName: raw.app_name,
            version: raw.version,
            tauriVersion: raw.tauri_version,
            environment: raw.environment,
            platform: raw.platform,
            backendUrl: viteEnv.VITE_BACKEND_URL || raw.backend_url,
            printSubsystemStatus: raw.print_subsystem_status,
            isNativeRuntime: true,
        };
    } catch {
        return {
            appName: 'XerService Desktop Shell (Web Fallback)',
            version: '0.1.0',
            tauriVersion: 'None (Browser / Dev Fallback)',
            environment: viteEnv.DEV ? 'development' : 'production',
            platform: 'web-fallback',
            backendUrl: DEFAULT_BACKEND_URL,
            printSubsystemStatus: 'WEB_FALLBACK_SIMULATION (NO_NATIVE_RUNTIME)',
            isNativeRuntime: false,
        };
    }
}

/**
 * Queries printing capabilities reported by the desktop runtime.
 */
export async function fetchPrintingCapabilities(): Promise<PlatformPrintingCapabilities> {
    try {
        const raw = await invokeTauri<{
            supports_silent_printing?: boolean;
            supportsSilentPrinting?: boolean;
            supports_job_cancellation?: boolean;
            supportsJobCancellation?: boolean;
            supports_status_polling?: boolean;
            supportsStatusPolling?: boolean;
            platform: 'mock' | 'windows' | 'macos' | 'linux' | 'unsupported';
            native_adapter_status?: string;
            nativeAdapterStatus?: string;
            message?: string;
        }>('get_printing_capabilities');

        return {
            supportsSilentPrinting: (raw.supportsSilentPrinting ?? raw.supports_silent_printing) ?? false,
            supportsJobCancellation: (raw.supportsJobCancellation ?? raw.supports_job_cancellation) ?? false,
            supportsStatusPolling: (raw.supportsStatusPolling ?? raw.supports_status_polling) ?? false,
            platform: raw.platform,
        };
    } catch {
        return {
            supportsSilentPrinting: false,
            supportsJobCancellation: false,
            supportsStatusPolling: false,
            platform: 'unsupported',
        };
    }
}

/**
 * Lists available physical printers.
 * NOTE: Returns empty array in Step 10 as physical printer enumeration is not implemented.
 */
export async function fetchPrinters(): Promise<NormalizedPrinter[]> {
    try {
        return await invokeTauri<NormalizedPrinter[]>('list_printers');
    } catch {
        return [];
    }
}

/**
 * Dispatches a print job to the desktop runtime.
 * Invokes native host CUPS submission adapter with printer and capability validation.
 */
export async function dispatchPrintJob(
    job: PrintJobRequest & { documentPath?: string; documentFingerprint?: string; isTestJob?: boolean }
): Promise<PrintJobResult> {
    const timestamp = new Date().toISOString();
    try {
        const raw = await invokeTauri<{
            job_id?: string;
            jobId?: string;
            status: 'QUEUED' | 'SUBMITTING' | 'PRINTING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
            printer_id?: string;
            printerId?: string;
            submitted_at?: string;
            submittedAt?: string;
            native_job_id?: string;
            nativeJobId?: string;
            error_code?: string;
            errorCode?: string;
            message: string;
            retryable?: boolean;
        }>('submit_print_job', {
            jobId: job.jobId,
            orderId: job.orderId || null,
            printerId: job.destination?.printerId || null,
            documentPath: (job as any).documentPath || null,
            documentFingerprint: (job as any).documentFingerprint || null,
            copies: job.copies ?? 1,
            colorMode: job.colorMode || null,
            paperSize: job.paperSize || null,
            duplexMode: job.duplexMode || null,
            isTestJob: (job as any).isTestJob ?? false,
        });

        const rawErrorCode = raw.errorCode ?? raw.error_code;
        const finalJobId = (raw.jobId ?? raw.job_id) || job.jobId;
        const finalPrinterId = (raw.printerId ?? raw.printer_id) || job.destination?.printerId || 'none';
        const finalNativeJobId = raw.nativeJobId ?? raw.native_job_id;

        return {
            jobId: finalJobId,
            status: raw.status,
            printerId: finalPrinterId,
            submittedAt: raw.submittedAt ?? raw.submitted_at ?? timestamp,
            nativeJobId: finalNativeJobId,
            error: rawErrorCode ? {
                code: mapToCanonicalErrorCode(rawErrorCode),
                message: raw.message,
                retryable: raw.retryable ?? false,
                rawError: rawErrorCode,
                timestamp,
            } : undefined,
        };
    } catch (err: any) {
        return {
            jobId: job.jobId,
            status: 'FAILED',
            printerId: job.destination?.printerId || 'none',
            submittedAt: timestamp,
            completedAt: timestamp,
            error: {
                code: 'PRINT_SUBMISSION_FAILED',
                message: err?.message || 'Native print submission failed.',
                retryable: false,
                rawError: 'IPC_UNAVAILABLE',
                timestamp,
            },
        };
    }
}

/**
 * Fetches status for a print job.
 */
export async function fetchPrintJobStatus(jobId: string, printerId?: string): Promise<PrintJobStatusInfo> {
    const timestamp = new Date().toISOString();
    await recordFrontendTelemetry(
        'STAGE_C_STATUS_REQUESTED',
        'get_print_job_status',
        `Calling invoke("get_print_job_status") with jobId="${jobId}", printerId="${printerId || 'none'}"`
    );

    try {
        const raw = await invokeTauri<{
            jobId?: string;
            job_id?: string;
            status: string;
            printerId?: string;
            printer_id?: string;
            updatedAt?: string;
            updated_at?: string;
            nativeJobId?: string;
            native_job_id?: string;
            errorCode?: string;
            error_code?: string;
            message: string;
            retryable?: boolean;
        }>('get_print_job_status', {
            jobId,
            printerId: printerId || null,
        });

        const validStatuses = new Set<PrintJobStatus>([
            'QUEUED',
            'SUBMITTING',
            'PRINTING',
            'COMPLETED',
            'FAILED',
            'CANCELLED',
        ]);
        const normalizedStatus: PrintJobStatus = validStatuses.has(raw.status as PrintJobStatus)
            ? (raw.status as PrintJobStatus)
            : 'FAILED';

        const rawErrorCode = raw.errorCode ?? raw.error_code;
        const finalJobId = (raw.jobId ?? raw.job_id) || jobId;
        const finalPrinterId = raw.printerId ?? raw.printer_id;
        const finalNativeJobId = raw.nativeJobId ?? raw.native_job_id;

        await recordFrontendTelemetry(
            'STAGE_F_STATUS_RESPONSE_PROCESSED',
            'get_print_job_status',
            `Received status=${normalizedStatus}, code=${rawErrorCode || 'none'}, nativeId=${finalNativeJobId || 'none'}`
        );

        return {
            jobId: finalJobId,
            status: normalizedStatus,
            printerId: finalPrinterId,
            updatedAt: raw.updatedAt ?? raw.updated_at ?? timestamp,
            nativeJobId: finalNativeJobId,
            error: rawErrorCode ? {
                code: mapToCanonicalErrorCode(rawErrorCode),
                message: raw.message,
                retryable: raw.retryable ?? false,
                rawError: rawErrorCode,
                timestamp,
            } : undefined,
        };
    } catch (err: any) {
        await recordFrontendTelemetry(
            'STAGE_F_STATUS_RESPONSE_PROCESSED',
            'get_print_job_status',
            `IPC error / fallback: ${err?.message || 'Unknown'}`
        );
        return {
            jobId,
            status: 'FAILED',
            updatedAt: timestamp,
            error: {
                code: 'PRINT_SUBMISSION_FAILED',
                message: err?.message || 'No active native spooler job exists.',
                retryable: false,
                rawError: 'IPC_UNAVAILABLE',
                timestamp,
            },
        };
    }
}

export interface NativePrintCancelResponse {
    jobId: string;
    success: boolean;
    status: PrintJobStatus;
    errorCode?: PrintErrorCode;
    message: string;
}

/**
 * Executes controlled cancellation of a native print job.
 */
export async function cancelNativePrintJob(
    jobId: string,
    printerId?: string
): Promise<NativePrintCancelResponse> {
    await recordFrontendTelemetry(
        'STAGE_C_CANCEL_REQUESTED',
        'cancel_print_job',
        `Calling invoke("cancel_print_job") with jobId="${jobId}", printerId="${printerId || 'none'}"`
    );

    try {
        const raw = await invokeTauri<{
            jobId?: string;
            job_id?: string;
            success: boolean;
            status: string;
            errorCode?: string;
            error_code?: string;
            message: string;
        }>('cancel_print_job', {
            jobId,
            printerId: printerId || null,
        });

        const validStatuses = new Set<PrintJobStatus>([
            'QUEUED',
            'SUBMITTING',
            'PRINTING',
            'COMPLETED',
            'FAILED',
            'CANCELLED',
        ]);
        const normalizedStatus: PrintJobStatus = validStatuses.has(raw.status as PrintJobStatus)
            ? (raw.status as PrintJobStatus)
            : 'FAILED';

        const rawErrorCode = raw.errorCode ?? raw.error_code;
        const mappedCode = rawErrorCode ? mapToCanonicalErrorCode(rawErrorCode) : undefined;
        const finalJobId = (raw.jobId ?? raw.job_id) || jobId;

        await recordFrontendTelemetry(
            'STAGE_F_CANCEL_RESPONSE_PROCESSED',
            'cancel_print_job',
            `Received cancel result: success=${raw.success}, status=${normalizedStatus}, code=${mappedCode || 'none'}`
        );

        return {
            jobId: finalJobId,
            success: raw.success,
            status: normalizedStatus,
            errorCode: mappedCode,
            message: raw.message,
        };
    } catch (err: any) {
        await recordFrontendTelemetry(
            'STAGE_F_CANCEL_RESPONSE_PROCESSED',
            'cancel_print_job',
            `IPC error during cancel: ${err?.message || 'Unknown'}`
        );
        return {
            jobId,
            success: false,
            status: 'FAILED',
            errorCode: 'PRINT_CANCEL_FAILED',
            message: err?.message || 'Failed to execute cancel_print_job via IPC.',
        };
    }
}

/**
 * Cancels a print job conforming to PrintProvider.cancelPrintJob.
 */
export async function abortPrintJob(jobId: string, printerId?: string): Promise<boolean> {
    const res = await cancelNativePrintJob(jobId, printerId);
    return res.success;
}

/**
 * Queries active native CUPS print queue via Tauri IPC.
 */
export async function getPrintQueue(printerId?: string): Promise<PrintQueueItem[]> {
    await recordFrontendTelemetry(
        'STAGE_C_QUEUE_REQUESTED',
        'get_print_queue',
        `Calling invoke("get_print_queue") with printerId="${printerId || 'all'}"`
    );

    try {
        const rawItems = await invokeTauri<Array<{
            jobId?: string;
            job_id?: string;
            printerId?: string;
            printer_id?: string;
            status: string;
            title?: string | null;
            submittedAt?: string | null;
            submitted_at?: string | null;
            owner?: string | null;
            pages?: number | null;
            sizeBytes?: number | null;
            size_bytes?: number | null;
            message?: string | null;
            managedByXerService?: boolean;
            managed_by_xer_service?: boolean;
            cancellable: boolean;
        }>>('get_print_queue', {
            printerId: printerId || null,
        });

        const validStatuses = new Set<PrintJobStatus>([
            'QUEUED',
            'SUBMITTING',
            'PRINTING',
            'COMPLETED',
            'FAILED',
            'CANCELLED',
        ]);

        const items: PrintQueueItem[] = (rawItems || []).map(raw => {
            const normalizedStatus: PrintJobStatus = validStatuses.has(raw.status as PrintJobStatus)
                ? (raw.status as PrintJobStatus)
                : 'QUEUED';

            const managed = raw.managedByXerService ?? raw.managed_by_xer_service ?? false;
            // CRITICAL INVARIANT: Unmanaged jobs are never cancellable
            const cancellable = managed && (raw.cancellable ?? false);

            return {
                jobId: raw.jobId || raw.job_id || 'unknown',
                printerId: raw.printerId || raw.printer_id || 'unknown',
                status: normalizedStatus,
                title: raw.title || undefined,
                submittedAt: (raw.submittedAt || raw.submitted_at) || undefined,
                owner: raw.owner || undefined,
                pages: raw.pages || undefined,
                sizeBytes: (raw.sizeBytes ?? raw.size_bytes) || undefined,
                message: raw.message || undefined,
                managedByXerService: managed,
                cancellable,
            };
        });

        await recordFrontendTelemetry(
            'STAGE_F_QUEUE_RESPONSE_PROCESSED',
            'get_print_queue',
            `Received ${items.length} print queue items from native CUPS spooler`
        );

        return items;
    } catch (err: any) {
        await recordFrontendTelemetry(
            'STAGE_F_QUEUE_RESPONSE_PROCESSED',
            'get_print_queue',
            `Failed to query queue via IPC: ${err?.message || 'Unknown error'}`
        );
        throw err;
    }
}

/**
 * Normalizes raw Rust PrintJobRecord into strongly-typed TypeScript contract.
 */
function normalizePrintJobRecord(raw: any): PrintJobRecord {
    const validStatuses = new Set<PrintJobStatus>([
        'QUEUED',
        'SUBMITTING',
        'PRINTING',
        'COMPLETED',
        'FAILED',
        'CANCELLED',
    ]);
    const rawStatus = raw.status;
    const normalizedStatus: PrintJobStatus = validStatuses.has(rawStatus)
        ? rawStatus
        : 'FAILED';

    return {
        localJobId: raw.localJobId || raw.local_job_id || 'unknown',
        xerServiceOrderId: (raw.xerServiceOrderId || raw.xer_service_order_id) || undefined,
        nativeJobId: (raw.nativeJobId || raw.native_job_id) || undefined,
        printerId: raw.printerId || raw.printer_id || 'unknown',
        status: normalizedStatus,
        title: raw.title || undefined,
        submittedAt: raw.submittedAt || raw.submitted_at || new Date().toISOString(),
        updatedAt: raw.updatedAt || raw.updated_at || new Date().toISOString(),
        managedByXerService: raw.managedByXerService ?? raw.managed_by_xer_service ?? true,
        submissionState: raw.submissionState || raw.submission_state || 'SUBMITTED',
        recoveryState: raw.recoveryState || raw.recovery_state || 'NOT_APPLICABLE',
        lastKnownNativeStatus: raw.lastKnownNativeStatus || raw.last_known_native_status || undefined,
        retryCount: raw.retryCount ?? raw.retry_count ?? 0,
        cancellationRequested: raw.cancellationRequested ?? raw.cancellation_requested ?? false,
        completedAt: (raw.completedAt || raw.completed_at) || undefined,
        failedAt: (raw.failedAt || raw.failed_at) || undefined,
        errorCode: (raw.errorCode || raw.error_code) ? mapToCanonicalErrorCode(raw.errorCode || raw.error_code) : undefined,
        errorMessage: (raw.errorMessage || raw.error_message) || undefined,
    };
}

/**
 * Queries all persisted print job records from the native desktop runtime.
 */
export async function fetchPersistedPrintJobs(): Promise<PrintJobRecord[]> {
    await recordFrontendTelemetry(
        'STAGE_C_PERSISTENCE_REQUESTED',
        'get_persisted_print_jobs',
        'Calling invoke("get_persisted_print_jobs") via @tauri-apps/api/core'
    );

    try {
        const rawList = await invokeTauri<any[]>('get_persisted_print_jobs');
        const records = (rawList || []).map(normalizePrintJobRecord);

        await recordFrontendTelemetry(
            'STAGE_F_PERSISTENCE_RESPONSE_PROCESSED',
            'get_persisted_print_jobs',
            `Received ${records.length} persisted print job records`
        );

        return records;
    } catch (err: any) {
        await recordFrontendTelemetry(
            'STAGE_F_PERSISTENCE_RESPONSE_PROCESSED',
            'get_persisted_print_jobs',
            `Failed to fetch persisted print jobs: ${err?.message || 'Unknown'}`
        );
        throw err;
    }
}

/**
 * Queries a specific persisted print job record by local job ID.
 */
export async function fetchPrintJobRecord(localJobId: string): Promise<PrintJobRecord | null> {
    await recordFrontendTelemetry(
        'STAGE_C_PERSISTENCE_REQUESTED',
        'get_print_job_record',
        `Calling invoke("get_print_job_record") for localJobId="${localJobId}"`
    );

    try {
        const raw = await invokeTauri<any | null>('get_print_job_record', { localJobId });
        const record = raw ? normalizePrintJobRecord(raw) : null;

        await recordFrontendTelemetry(
            'STAGE_F_PERSISTENCE_RESPONSE_PROCESSED',
            'get_print_job_record',
            `Record found: ${record !== null}`
        );

        return record;
    } catch (err: any) {
        await recordFrontendTelemetry(
            'STAGE_F_PERSISTENCE_RESPONSE_PROCESSED',
            'get_print_job_record',
            `Failed to query record: ${err?.message || 'Unknown'}`
        );
        throw err;
    }
}

/**
 * Triggers startup/manual reconciliation of persisted jobs against authoritative native CUPS spooler state.
 */
export async function triggerRecoveryReconciliation(): Promise<PrintJobRecord[]> {
    await recordFrontendTelemetry(
        'STAGE_C_PERSISTENCE_REQUESTED',
        'recover_print_jobs',
        'Calling invoke("recover_print_jobs") to reconcile jobs against native CUPS'
    );

    try {
        const rawList = await invokeTauri<any[]>('recover_print_jobs');
        const records = (rawList || []).map(normalizePrintJobRecord);

        await recordFrontendTelemetry(
            'STAGE_F_PERSISTENCE_RESPONSE_PROCESSED',
            'recover_print_jobs',
            `Reconciled ${records.length} persisted records with native CUPS`
        );

        return records;
    } catch (err: any) {
        await recordFrontendTelemetry(
            'STAGE_F_PERSISTENCE_RESPONSE_PROCESSED',
            'recover_print_jobs',
            `Failed to run recovery reconciliation: ${err?.message || 'Unknown'}`
        );
        throw err;
    }
}

export interface TempDocumentInfo {
    tempPath: string;
    fileSizeBytes: number;
    sha256Fingerprint: string;
    filename: string;
}

/**
 * Saves authorized document bytes to an isolated temporary file and returns metadata and SHA-256 fingerprint.
 */
export async function saveTemporaryDocument(
    jobId: string,
    filename: string,
    bytes: Uint8Array | number[]
): Promise<TempDocumentInfo> {
    await recordFrontendTelemetry(
        'STAGE_C_TEMP_DOC_REQUESTED',
        'save_temp_document',
        `Saving temp document for jobId="${jobId}", filename="${filename}", bytes=${bytes.length}`
    );
    const result = await invokeTauri<TempDocumentInfo>('save_temp_document', {
        jobId,
        filename,
        bytes: Array.from(bytes),
    });
    await recordFrontendTelemetry(
        'STAGE_F_TEMP_DOC_SAVED',
        'save_temp_document',
        `Saved temp document at path="${result.tempPath}", size=${result.fileSizeBytes}, fingerprint=${result.sha256Fingerprint}`
    );
    return result;
}

/**
 * Retrieves the persisted print job record for a given XerService order ID.
 */
export async function fetchOrderPrintJob(orderId: string): Promise<PrintJobRecord | null> {
    await recordFrontendTelemetry(
        'STAGE_C_PERSISTENCE_REQUESTED',
        'get_order_print_job',
        `Calling invoke("get_order_print_job") for orderId="${orderId}"`
    );
    const raw = await invokeTauri<any | null>('get_order_print_job', { orderId });
    const record = raw ? normalizePrintJobRecord(raw) : null;
    await recordFrontendTelemetry(
        'STAGE_F_PERSISTENCE_RESPONSE_PROCESSED',
        'get_order_print_job',
        `Record for orderId="${orderId}" found: ${record !== null}`
    );
    return record;
}

export interface VendorOrderFile {
    id: string;
    original_filename: string;
    mime_type: string;
    file_size_bytes: number;
    printable_pages: number;
    physical_sheets: number;
    print_settings: {
        colour_mode: string;
        sides: string;
        orientation: string;
        copies: number;
        paper_size: string;
        page_range: string;
    } | null;
    addons?: Array<{
        name: string;
        price: number;
        category: string;
    }>;
}

export interface VendorQueueOrder {
    id: string;
    order_number: string;
    user_id: string;
    shop_id: string;
    status: 'QUEUED' | 'PRINTING' | 'READY' | 'COMPLETED' | 'CANCELLED';
    payment_status: string;
    total_printable_pages: number;
    total_sheets: number;
    total_amount: number;
    created_at: string;
    customerName: string;
    has_active_refund: boolean;
    order_files: VendorOrderFile[];
}

/**
 * Fetches active QUEUED / PRINTING / READY orders for the authenticated vendor's shop.
 */
export async function fetchVendorQueueOrders(backendUrl: string, token: string): Promise<VendorQueueOrder[]> {
    await recordFrontendTelemetry('STAGE_2_API_REQUEST', 'fetchVendorQueueOrders', 'vendor orders request started');

    const res = await fetch(`${backendUrl}/api/vendor/orders`, {
        headers: {
            Authorization: `Bearer ${token}`,
            'Cache-Control': 'no-store',
        },
    });

    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const errMsg = data.error || `Failed to fetch vendor orders: HTTP ${res.status}`;
        await recordFrontendTelemetry('STAGE_3_RESPONSE_RECORDED', 'fetchVendorQueueOrders', `status=${res.status}`);
        throw new Error(errMsg);
    }
    const data = await res.json();
    const orders: VendorQueueOrder[] = data.orders || [];
    await recordFrontendTelemetry(
        'STAGE_3_RESPONSE_RECORDED',
        'fetchVendorQueueOrders',
        `status=${res.status}, count=${orders.length}`
    );
    return orders;
}

/**
 * Downloads authorized document bytes for a specific order and file using vendor bearer credentials.
 */
export async function downloadVendorOrderDocument(
    backendUrl: string,
    token: string,
    orderId: string,
    fileId: string,
    prepared: boolean = true
): Promise<{ buffer: ArrayBuffer; filename: string; mimeType: string }> {
    const url = `${backendUrl}/api/vendor/orders/${orderId}/files/${fileId}/download?inline=true${prepared ? '&prepared=true' : ''}`;
    const res = await fetch(url, {
        headers: {
            Authorization: `Bearer ${token}`,
            'Cache-Control': 'no-store',
        },
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed to download document: HTTP ${res.status}`);
    }
    const buffer = await res.arrayBuffer();
    const contentType = res.headers.get('Content-Type') || 'application/pdf';
    let filename = `order_${orderId}_file_${fileId}.pdf`;
    const disposition = res.headers.get('Content-Disposition');
    if (disposition) {
        const match = disposition.match(/filename\*?=(?:UTF-8'')?["']?([^"';]+)["']?/i);
        if (match && match[1]) {
            try {
                filename = decodeURIComponent(match[1]);
            } catch {
                filename = match[1];
            }
        }
    }
    return {
        buffer,
        filename,
        mimeType: contentType,
    };
}

export async function downloadVendorOrderDocumentOriginal(
    backendUrl: string,
    token: string,
    orderId: string,
    fileId: string
): Promise<{ buffer: ArrayBuffer; filename: string; mimeType: string }> {
    return downloadVendorOrderDocument(backendUrl, token, orderId, fileId, false);
}

/**
 * Authoritatively transitions a vendor order status via backend RPC (e.g. QUEUED -> PRINTING, PRINTING -> READY).
 */
export async function updateVendorOrderStatus(
    backendUrl: string,
    token: string,
    orderId: string,
    expectedStatus: string,
    newStatus: string
): Promise<any> {
    const res = await fetch(`${backendUrl}/api/vendor/orders/${orderId}/status`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
        },
        body: JSON.stringify({ expectedStatus, newStatus }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(data.error || `Status transition failed: HTTP ${res.status}`);
    }
    return data;
}

export interface VendorOverviewData {
    shop: {
        id: string;
        name: string;
        status?: string;
    };
    metrics: {
        commissionConfigured: boolean;
        todayRevenue: number | null;
        totalRevenue: number | null;
        unsettledBalance?: number | null;
        lastPayout?: { amount: number; date: string; settlementNumber?: string } | null;
        grossSales: number;
        todayCompletedOrders: number;
        totalOrders: number;
    };
    paymentSummary?: {
        upiPayments: number;
        successfulPayments: number;
        refundedPayments: number;
    };
}

export interface VendorShopProfileData {
    id: string;
    name: string;
    ownerId: string;
    status: 'OPEN' | 'PAUSED' | 'CLOSED';
    publishStatus: string;
    address: string | null;
    contactPhone: string | null;
    photos: string[];
    openTime: string;
    closeTime: string;
    closingSoon: boolean;
    closingMessage: string | null;
    commercialTerms: {
        settlementCycle: string;
        commercialPlan: string;
    };
    readiness?: {
        scorePercent: number;
        isReadyToPublish: boolean;
        blockersCount: number;
        completedCount: number;
        totalChecks: number;
        items: Array<{
            id: string;
            category: string;
            title: string;
            description: string;
            status: 'COMPLETE' | 'MISSING';
            isBlocker: boolean;
            details?: string;
        }>;
        summaryMessage: string;
    };
    customerPreview?: {
        startingPrice: number | null;
        startingPriceBasis: string;
        priceColorPerPage: number | null;
        supportedServices: string[];
        supportedCapabilities: {
            paperSizes: string[];
            printModes: string[];
            duplexModes: string[];
            activeAddons: Array<{ name: string; price: number; priceUnit: string | null }>;
        };
    };
    updatedAt?: string;
}

/**
 * Fetches vendor overview with KPIs, earnings, and shop status.
 */
export async function fetchVendorOverview(
    backendUrl: string,
    token: string,
    range: string = 'today'
): Promise<VendorOverviewData> {
    const res = await fetch(`${backendUrl}/api/vendor/overview?range=${range}`, {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${token}`,
            'Cache-Control': 'no-store',
        },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(data.error || `Failed to fetch overview: HTTP ${res.status}`);
    }
    return data as VendorOverviewData;
}

/**
 * Fetches vendor shop profile, hours, trading status, and commercial terms.
 */
export async function fetchVendorShopProfile(
    backendUrl: string,
    token: string
): Promise<VendorShopProfileData> {
    const res = await fetch(`${backendUrl}/api/vendor/shop`, {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${token}`,
            'Cache-Control': 'no-store',
        },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(data.error || `Failed to fetch shop profile: HTTP ${res.status}`);
    }
    return data.shop as VendorShopProfileData;
}

/**
 * Updates vendor shop profile (name, address, hours, status, phone).
 */
export async function updateVendorShopProfile(
    backendUrl: string,
    token: string,
    updates: Partial<VendorShopProfileData>
): Promise<VendorShopProfileData> {
    const res = await fetch(`${backendUrl}/api/vendor/shop`, {
        method: 'PATCH',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
        },
        body: JSON.stringify(updates),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(data.error || `Failed to update shop profile: HTTP ${res.status}`);
    }
    return data.shop as VendorShopProfileData;
}

// ─────────────────────────────────────────────────────────────────────────────
// STAGE A10: VENDOR STATEMENTS & PASSBOOK
// ─────────────────────────────────────────────────────────────────────────────

export interface VendorStatementTransaction {
    id: string;
    date: string;
    type: 'EARNING' | 'REFUND' | 'PAYMENT';
    reference: string;
    orderId?: string;
    description: string;
    grossAmount?: number;
    credit: number | null;
    debit: number | null;
    runningBalance: number;
}

export interface VendorStatementSummary {
    openingBalance: number;
    earnedInPeriod: number;
    adjustmentsInPeriod: number;
    paymentsReceivedInPeriod: number;
    closingBalance: number;
    readyToReceive: number;
    pendingFulfillment: number;
}

export interface VendorStatementData {
    shop: {
        id: string;
        name: string;
        paymentAccount: string;
    };
    period: {
        name: string;
        from: string;
        to: string;
    };
    summary: VendorStatementSummary;
    transactions: VendorStatementTransaction[];
}

/**
 * Fetches vendor passbook statement summary and ledger transactions.
 */
export async function fetchVendorStatements(
    backendUrl: string,
    token: string,
    params: { period?: string; from?: string; to?: string; search?: string } = {}
): Promise<VendorStatementData> {
    const query = new URLSearchParams();
    if (params.period) query.set('period', params.period);
    if (params.from) query.set('from', params.from);
    if (params.to) query.set('to', params.to);
    if (params.search) query.set('search', params.search);

    const url = `${backendUrl}/api/vendor/statements?${query.toString()}`;
    const res = await fetch(url, {
        headers: {
            Authorization: `Bearer ${token}`,
            'Cache-Control': 'no-store',
        },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(data.error || `Failed to fetch statements: HTTP ${res.status}`);
    }
    return data as VendorStatementData;
}

/**
 * Downloads the filtered vendor passbook statement as CSV.
 */
export async function downloadVendorStatementCsv(
    backendUrl: string,
    token: string,
    params: { period?: string; from?: string; to?: string; search?: string } = {}
): Promise<{ csv: string; filename: string }> {
    const query = new URLSearchParams({ format: 'csv' });
    if (params.period) query.set('period', params.period);
    if (params.from) query.set('from', params.from);
    if (params.to) query.set('to', params.to);
    if (params.search) query.set('search', params.search);

    const url = `${backendUrl}/api/vendor/statements?${query.toString()}`;
    const res = await fetch(url, {
        headers: {
            Authorization: `Bearer ${token}`,
            'Cache-Control': 'no-store',
        },
    });
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Failed to export statement CSV: HTTP ${res.status}`);
    }
    const csv = await res.text();
    let filename = 'vendor_statement.csv';
    const disposition = res.headers.get('Content-Disposition');
    if (disposition) {
        const match = disposition.match(/filename\*?=(?:UTF-8'')?["']?([^"';]+)["']?/i);
        if (match && match[1]) {
            filename = decodeURIComponent(match[1]);
        }
    }
    return { csv, filename };
}

/**
 * STAGE A15 / PRIORITY 4: COMMERCIAL AUDIT
 * Fetches commercial pricing audit and rate snapshot comparison for an order.
 */
export async function fetchOrderPricingAudit(
    backendUrl: string,
    token: string,
    orderId: string
): Promise<any> {
    const url = `${backendUrl.replace(/\/+$/, '')}/api/vendor/orders/${orderId}/pricing-audit`;
    const res = await fetch(url, {
        headers: {
            Authorization: `Bearer ${token}`,
            'Cache-Control': 'no-store',
        },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(data.error || `Failed to fetch pricing audit: HTTP ${res.status}`);
    }
    return data.audit;
}

/**
 * XerService Platform-Neutral Native Printing Types & Contracts
 *
 * Establishes the boundary between web applications, shared print contracts,
 * future desktop runtimes, and host OS print spoolers.
 *
 * STRICT INVARIANT: Pure platform-agnostic contracts only.
 * NO React, NO Next.js, NO browser DOM, and NO OS-specific driver implementations.
 */

import type {
    ColorMode,
    PageOrientation,
    PaperSize,
    PrintSettings,
    PrintSides,
} from '@packages/types';

/**
 * Normalized native print-job status.
 *
 * NOTE: This is the low-level technical lifecycle for OS spooler execution,
 * completely distinct from the authoritative business OrderLifecycleStatus
 * ('DRAFT' | 'AWAITING_PAYMENT' | 'QUEUED' | 'PRINTING' | 'READY' | 'COMPLETED' | 'CANCELLED').
 */
export type PrintJobStatus =
    | 'QUEUED'
    | 'SUBMITTING'
    | 'PRINTING'
    | 'COMPLETED'
    | 'FAILED'
    | 'CANCELLED';

/**
 * Normalized error codes returned by native print providers.
 * Host-specific error codes (e.g. CUPS errors, Win32 Spooler codes) must be
 * mapped into this canonical set before leaving the adapter boundary.
 */
export type PrintErrorCode =
    | 'PRINTER_NOT_FOUND'
    | 'PRINTER_OFFLINE'
    | 'PRINTER_BUSY'
    | 'UNSUPPORTED_PAPER_SIZE'
    | 'UNSUPPORTED_COLOR_MODE'
    | 'UNSUPPORTED_DUPLEX'
    | 'INVALID_DOCUMENT'
    | 'PRINT_SUBMISSION_FAILED'
    | 'PRINT_CANCEL_FAILED'
    | 'PRINT_TIMEOUT'
    | 'UNKNOWN_PRINT_ERROR';

/**
 * Normalized print error structure.
 */
export interface PrintError {
    code: PrintErrorCode;
    message: string;
    retryable: boolean;
    rawError?: string;
    timestamp?: string;
}

/**
 * Print destination representing target hardware selected by the runtime.
 */
export interface PrintDestination {
    printerId: string;
    tray?: string;
    resolutionDpi?: number;
    mediaType?: string;
}

/**
 * Request issued by the application to print a target file payload.
 */
export interface PrintJobRequest {
    jobId: string;
    orderId: string;
    orderNumber: string;
    fileId: string;
    fileName: string;
    documentUri: string;
    mimeType: string;
    fileSizeBytes?: number;
    pageCount?: number;
    settings: PrintSettings;
    copies: number;
    colorMode: ColorMode;
    paperSize: PaperSize;
    duplexMode: PrintSides;
    orientation?: PageOrientation;
    pageRange?: string;
    addonIds?: string[];
    shopId: string;
    destination?: PrintDestination;
    createdAt: string;
    metadata?: Record<string, unknown>;
}

/**
 * Final or intermediate execution result returned by a print provider.
 */
export interface PrintJobResult {
    jobId: string;
    status: PrintJobStatus;
    printerId: string;
    submittedAt: string;
    completedAt?: string;
    nativeJobId?: string;
    pagesPrinted?: number;
    error?: PrintError;
    metadata?: Record<string, unknown>;
}

/**
 * Detailed status telemetry for an active or completed print job.
 */
export interface PrintJobStatusInfo {
    jobId: string;
    status: PrintJobStatus;
    printerId?: string;
    updatedAt: string;
    pagesPrinted?: number;
    totalPages?: number;
    nativeJobId?: string;
    error?: PrintError;
}

/**
 * Platform-neutral representation of a print job in the native spooler queue.
 */
export interface PrintQueueItem {
    jobId: string;
    printerId: string;
    status: PrintJobStatus;
    title?: string;
    submittedAt?: string;
    owner?: string;
    pages?: number;
    sizeBytes?: number;
    message?: string;
    managedByXerService: boolean;
    cancellable: boolean;
}

export type PrintJobSubmissionState = 'PENDING_SUBMISSION' | 'SUBMITTED' | 'FAILED';
export type PrintJobRecoveryState = 'NOT_APPLICABLE' | 'RECONCILED' | 'INVESTIGATION_REQUIRED' | 'MISSING_FROM_CUPS';

/**
 * Durable native desktop print job record and order-safe mapping model.
 * Persisted by the native Rust desktop runtime to survive restarts, crashes, and spooler reboots.
 */
export interface PrintJobRecord {
    localJobId: string;
    xerServiceOrderId?: string;
    nativeJobId?: string;
    printerId: string;
    status: PrintJobStatus;
    title?: string;
    submittedAt: string;
    updatedAt: string;
    managedByXerService: boolean;
    submissionState: PrintJobSubmissionState;
    recoveryState: PrintJobRecoveryState;
    lastKnownNativeStatus?: string;
    retryCount: number;
    cancellationRequested: boolean;
    completedAt?: string;
    failedAt?: string;
    errorCode?: PrintErrorCode;
    errorMessage?: string;
}

/**
 * Normalized operational state of a physical or virtual printer.
 */
export type NormalizedPrinterStatus = 'idle' | 'busy' | 'offline' | 'error';

/**
 * Hardware and driver capabilities exposed by a printer.
 */
export interface PrinterCapabilities {
    supportedPaperSizes: PaperSize[];
    colorSupported?: boolean | null;
    duplexSupported?: boolean | null;
    supportedOrientations?: PageOrientation[];
    supportedMediaTypes?: string[];
    maxCopies?: number | null;
    trays?: string[];
    maxResolutionDpi?: number;
}

/**
 * Normalized printer representation.
 */
export interface NormalizedPrinter {
    printerId: string;
    name: string;
    status: NormalizedPrinterStatus;
    isDefault: boolean;
    capabilities: PrinterCapabilities;
    description?: string;
    connectionType?: 'usb' | 'network' | 'virtual';
}

/**
 * Capabilities of the underlying platform runtime.
 */
export interface PlatformPrintingCapabilities {
    supportsSilentPrinting: boolean;
    supportsJobCancellation: boolean;
    supportsStatusPolling: boolean;
    platform: 'mock' | 'windows' | 'macos' | 'linux' | 'unsupported';
}

/**
 * Redacted audit log event for printing operations.
 *
 * CRITICAL SECURITY INVARIANT:
 * NEVER log customer document contents, binary bytes, auth tokens,
 * passwords, or service-role keys.
 */
export interface PrintJobLog {
    timestamp: string;
    operation: 'submit' | 'cancel' | 'status_poll' | 'capability_query' | 'printer_list';
    jobId?: string;
    orderId?: string;
    printerId?: string;
    normalizedStatus?: PrintJobStatus;
    errorCode?: PrintErrorCode;
    details?: string;
}

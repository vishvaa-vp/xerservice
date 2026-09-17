/**
 * XerService Platform-Neutral Native Print Provider Contracts & Reference Implementation
 *
 * Defines the abstract interface between applications and native printing engines.
 * Includes capability validation, error normalization, safe audit logging, and
 * an in-memory MockPrintProvider for testing and CI.
 */

import type {
    NormalizedPrinter,
    PlatformPrintingCapabilities,
    PrintError,
    PrintErrorCode,
    PrintJobLog,
    PrintJobRequest,
    PrintJobResult,
    PrintJobStatus,
    PrintJobStatusInfo,
    PrintQueueItem,
} from './types';

/**
 * Platform-neutral interface implemented by native printing adapters
 * (e.g., Tauri adapter, mock test adapter).
 */
export interface PrintProvider {
    /**
     * Query runtime capabilities (silent printing, cancellation, status polling).
     */
    getCapabilities(): Promise<PlatformPrintingCapabilities>;

    /**
     * List all installed/available printers discovered by the OS spooler.
     */
    listPrinters(): Promise<NormalizedPrinter[]>;

    /**
     * Submit a normalized print job for execution.
     */
    submitPrintJob(job: PrintJobRequest): Promise<PrintJobResult>;

    /**
     * Attempt to cancel an in-flight or queued print job.
     */
    cancelPrintJob(jobId: string): Promise<boolean>;

    /**
     * Query real-time status of a submitted print job.
     */
    getPrintJobStatus(jobId: string): Promise<PrintJobStatusInfo>;

    /**
     * Query native print queue for all printers or a specific printer destination.
     */
    getPrintQueue?(printerId?: string): Promise<PrintQueueItem[]>;
}

/**
 * Validates whether a PrintJobRequest is compatible with a target printer's hardware capabilities.
 */
export function validateJobAgainstPrinter(
    job: PrintJobRequest,
    printer: NormalizedPrinter
): { valid: boolean; error?: PrintError } {
    if (printer.status === 'offline') {
        return {
            valid: false,
            error: {
                code: 'PRINTER_OFFLINE',
                message: `Target printer '${printer.name}' (${printer.printerId}) is currently offline.`,
                retryable: true,
                timestamp: new Date().toISOString(),
            },
        };
    }

    if (printer.status === 'error') {
        return {
            valid: false,
            error: {
                code: 'PRINTER_BUSY',
                message: `Target printer '${printer.name}' is in an error state.`,
                retryable: true,
                timestamp: new Date().toISOString(),
            },
        };
    }

    // Check paper size
    if (!printer.capabilities.supportedPaperSizes.includes(job.paperSize)) {
        return {
            valid: false,
            error: {
                code: 'UNSUPPORTED_PAPER_SIZE',
                message: `Paper size '${job.paperSize}' is not supported by printer '${printer.name}'. Supported: ${printer.capabilities.supportedPaperSizes.join(', ')}`,
                retryable: false,
                timestamp: new Date().toISOString(),
            },
        };
    }

    // Check color mode
    if (job.colorMode === 'color') {
        if (printer.capabilities.colorSupported === false) {
            return {
                valid: false,
                error: {
                    code: 'UNSUPPORTED_COLOR_MODE',
                    message: `Color printing requested but printer '${printer.name}' only supports monochrome/black-and-white.`,
                    retryable: false,
                    timestamp: new Date().toISOString(),
                },
            };
        } else if (printer.capabilities.colorSupported == null) {
            return {
                valid: false,
                error: {
                    code: 'UNSUPPORTED_COLOR_MODE',
                    message: `Color printing requested but printer '${printer.name}' color capability is unknown or unverified.`,
                    retryable: false,
                    timestamp: new Date().toISOString(),
                },
            };
        }
    }

    // Check duplex mode
    const isDuplexRequested = job.duplexMode === 'double_long' || job.duplexMode === 'double_short';
    if (isDuplexRequested) {
        if (printer.capabilities.duplexSupported === false) {
            return {
                valid: false,
                error: {
                    code: 'UNSUPPORTED_DUPLEX',
                    message: `Duplex printing (${job.duplexMode}) requested but printer '${printer.name}' does not support automatic duplex.`,
                    retryable: false,
                    timestamp: new Date().toISOString(),
                },
            };
        } else if (printer.capabilities.duplexSupported == null) {
            return {
                valid: false,
                error: {
                    code: 'UNSUPPORTED_DUPLEX',
                    message: `Duplex printing (${job.duplexMode}) requested but printer '${printer.name}' duplex capability is unknown or unverified.`,
                    retryable: false,
                    timestamp: new Date().toISOString(),
                },
            };
        }
    }

    // Check copies
    if (printer.capabilities.maxCopies != null && job.copies > printer.capabilities.maxCopies) {
        return {
            valid: false,
            error: {
                code: 'PRINT_SUBMISSION_FAILED',
                message: `Requested ${job.copies} copies exceeds maximum allowed copies (${printer.capabilities.maxCopies}) for printer '${printer.name}'.`,
                retryable: false,
                timestamp: new Date().toISOString(),
            },
        };
    }

    return { valid: true };
}

/**
 * Normalizes any native, OS, or runtime error into a standard PrintError.
 */
export function normalizePrinterError(rawError: unknown): PrintError {
    const timestamp = new Date().toISOString();

    if (rawError && typeof rawError === 'object' && 'code' in rawError && 'message' in rawError) {
        const candidate = rawError as Partial<PrintError>;
        if (typeof candidate.code === 'string' && typeof candidate.message === 'string') {
            return {
                code: candidate.code as PrintErrorCode,
                message: candidate.message,
                retryable: Boolean(candidate.retryable),
                rawError: candidate.rawError || String(rawError),
                timestamp,
            };
        }
    }

    const rawString = String(rawError instanceof Error ? rawError.message : rawError).toLowerCase();

    let code: PrintErrorCode = 'UNKNOWN_PRINT_ERROR';
    let retryable = false;

    if (rawString.includes('offline') || rawString.includes('not connected') || rawString.includes('unreachable')) {
        code = 'PRINTER_OFFLINE';
        retryable = true;
    } else if (rawString.includes('not found') || rawString.includes('unknown printer') || rawString.includes('no such printer')) {
        code = 'PRINTER_NOT_FOUND';
        retryable = false;
    } else if (rawString.includes('busy') || rawString.includes('in use') || rawString.includes('jam')) {
        code = 'PRINTER_BUSY';
        retryable = true;
    } else if (rawString.includes('paper size') || rawString.includes('media size') || rawString.includes('unsupported paper')) {
        code = 'UNSUPPORTED_PAPER_SIZE';
        retryable = false;
    } else if (rawString.includes('color') || rawString.includes('monochrome')) {
        code = 'UNSUPPORTED_COLOR_MODE';
        retryable = false;
    } else if (rawString.includes('duplex') || rawString.includes('two-sided')) {
        code = 'UNSUPPORTED_DUPLEX';
        retryable = false;
    } else if (rawString.includes('timeout') || rawString.includes('timed out')) {
        code = 'PRINT_TIMEOUT';
        retryable = true;
    } else if (rawString.includes('cancel') || rawString.includes('abort')) {
        code = 'PRINT_CANCEL_FAILED';
        retryable = false;
    } else if (rawString.includes('invalid') || rawString.includes('corrupt') || rawString.includes('pdf')) {
        code = 'INVALID_DOCUMENT';
        retryable = false;
    }

    return {
        code,
        message: rawError instanceof Error ? rawError.message : String(rawError),
        retryable,
        rawError: String(rawError),
        timestamp,
    };
}

/**
 * Creates a redacted audit log record for printing operations.
 * GUARANTEE: Never captures document bytes, authentication headers, or sensitive secrets.
 */
export function createPrintJobLog(
    operation: PrintJobLog['operation'],
    data: Omit<PrintJobLog, 'timestamp' | 'operation'>
): PrintJobLog {
    return {
        timestamp: new Date().toISOString(),
        operation,
        jobId: data.jobId,
        orderId: data.orderId,
        printerId: data.printerId,
        normalizedStatus: data.normalizedStatus,
        errorCode: data.errorCode,
        details: data.details,
    };
}

/**
 * Reference in-memory mock implementation of PrintProvider.
 * Used for testing, headless verification, and CI environments without native OS printers.
 */
export class MockPrintProvider implements PrintProvider {
    private printers: Map<string, NormalizedPrinter> = new Map();
    private jobs: Map<
        string,
        {
            request: PrintJobRequest;
            status: PrintJobStatus;
            pagesPrinted: number;
            nativeJobId: string;
            updatedAt: string;
            error?: PrintError;
        }
    > = new Map();

    constructor(initialPrinters?: NormalizedPrinter[]) {
        if (initialPrinters && initialPrinters.length > 0) {
            for (const p of initialPrinters) {
                this.printers.set(p.printerId, p);
            }
        } else {
            // Default mock hardware suite
            this.printers.set('mock-laser-office', {
                printerId: 'mock-laser-office',
                name: 'Office LaserJet Pro (A4/Color/Duplex)',
                status: 'idle',
                isDefault: true,
                capabilities: {
                    supportedPaperSizes: ['a4', 'legal'],
                    colorSupported: true,
                    duplexSupported: true,
                    supportedOrientations: ['portrait', 'landscape'],
                    maxCopies: 99,
                    trays: ['Tray 1', 'Tray 2 (Bypass)'],
                },
                connectionType: 'network',
            });

            this.printers.set('mock-bw-copier', {
                printerId: 'mock-bw-copier',
                name: 'High-Speed Copier (A4/A3/BW/Duplex)',
                status: 'idle',
                isDefault: false,
                capabilities: {
                    supportedPaperSizes: ['a4', 'a3', 'legal'],
                    colorSupported: false,
                    duplexSupported: true,
                    supportedOrientations: ['portrait', 'landscape'],
                    maxCopies: 500,
                    trays: ['Tray 1 (A4)', 'Tray 2 (A3)'],
                },
                connectionType: 'network',
            });

            this.printers.set('mock-offline-kiosk', {
                printerId: 'mock-offline-kiosk',
                name: 'Campus Kiosk Terminal 01 (Offline)',
                status: 'offline',
                isDefault: false,
                capabilities: {
                    supportedPaperSizes: ['a4'],
                    colorSupported: false,
                    duplexSupported: false,
                    supportedOrientations: ['portrait'],
                    maxCopies: 10,
                },
                connectionType: 'usb',
            });
        }
    }

    async getCapabilities(): Promise<PlatformPrintingCapabilities> {
        return {
            supportsSilentPrinting: true,
            supportsJobCancellation: true,
            supportsStatusPolling: true,
            platform: 'mock',
        };
    }

    async listPrinters(): Promise<NormalizedPrinter[]> {
        return Array.from(this.printers.values());
    }

    async addPrinter(printer: NormalizedPrinter): Promise<void> {
        this.printers.set(printer.printerId, printer);
    }

    async submitPrintJob(job: PrintJobRequest): Promise<PrintJobResult> {
        const submittedAt = new Date().toISOString();

        // 1. Identify destination printer
        let targetPrinter: NormalizedPrinter | undefined;
        if (job.destination?.printerId) {
            targetPrinter = this.printers.get(job.destination.printerId);
        } else {
            targetPrinter = Array.from(this.printers.values()).find(p => p.isDefault) || Array.from(this.printers.values())[0];
        }

        if (!targetPrinter) {
            const err: PrintError = {
                code: 'PRINTER_NOT_FOUND',
                message: `No printer available matching destination '${job.destination?.printerId || 'default'}'.`,
                retryable: false,
                timestamp: submittedAt,
            };
            return {
                jobId: job.jobId,
                status: 'FAILED',
                printerId: job.destination?.printerId || 'unknown',
                submittedAt,
                completedAt: submittedAt,
                error: err,
            };
        }

        // 2. Validate capabilities against hardware
        const validation = validateJobAgainstPrinter(job, targetPrinter);
        if (!validation.valid && validation.error) {
            return {
                jobId: job.jobId,
                status: 'FAILED',
                printerId: targetPrinter.printerId,
                submittedAt,
                completedAt: submittedAt,
                error: validation.error,
            };
        }

        // 3. Register job in memory
        const nativeJobId = `mock-job-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        const totalPages = (job.pageCount || 1) * job.copies;

        this.jobs.set(job.jobId, {
            request: job,
            status: 'COMPLETED',
            pagesPrinted: totalPages,
            nativeJobId,
            updatedAt: new Date().toISOString(),
        });

        return {
            jobId: job.jobId,
            status: 'COMPLETED',
            printerId: targetPrinter.printerId,
            submittedAt,
            completedAt: new Date().toISOString(),
            nativeJobId,
            pagesPrinted: totalPages,
        };
    }

    async cancelPrintJob(jobId: string): Promise<boolean> {
        const job = this.jobs.get(jobId);
        if (!job) return false;

        if (job.status === 'COMPLETED' || job.status === 'FAILED' || job.status === 'CANCELLED') {
            return false;
        }

        job.status = 'CANCELLED';
        job.updatedAt = new Date().toISOString();
        return true;
    }

    async getPrintJobStatus(jobId: string): Promise<PrintJobStatusInfo> {
        const job = this.jobs.get(jobId);
        if (!job) {
            return {
                jobId,
                status: 'FAILED',
                updatedAt: new Date().toISOString(),
                error: {
                    code: 'PRINT_SUBMISSION_FAILED',
                    message: `Print job '${jobId}' not found in active spool memory.`,
                    retryable: false,
                    timestamp: new Date().toISOString(),
                },
            };
        }

        return {
            jobId,
            status: job.status,
            printerId: job.request.destination?.printerId,
            updatedAt: job.updatedAt,
            pagesPrinted: job.pagesPrinted,
            totalPages: (job.request.pageCount || 1) * job.request.copies,
            nativeJobId: job.nativeJobId,
            error: job.error,
        };
    }

    async getPrintQueue(printerId?: string): Promise<PrintQueueItem[]> {
        const queue: PrintQueueItem[] = [];
        for (const [jobId, record] of this.jobs.entries()) {
            const targetPrinter = record.request.destination?.printerId || 'mock-default-deskjet';
            if (printerId && targetPrinter !== printerId) {
                continue;
            }
            const isCancellable = record.status === 'QUEUED' || record.status === 'PRINTING';
            queue.push({
                jobId: record.nativeJobId || jobId,
                printerId: targetPrinter,
                status: record.status,
                title: record.request.fileName || `XerService Job ${jobId}`,
                submittedAt: record.request.createdAt,
                owner: 'xerservice-mock',
                pages: (record.request.pageCount || 1) * record.request.copies,
                managedByXerService: true,
                cancellable: isCancellable,
            });
        }
        return queue;
    }
}

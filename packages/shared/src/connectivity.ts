/**
 * @packages/shared/connectivity
 * Authoritative Honest Hardware Connectivity Engine for XerService.
 *
 * Implements the six distinct operational layers required by astraplan.md Section 19:
 * 1. BACKEND_CONNECTED: Network reachability between client and central XerService API.
 * 2. DATA_CURRENT: Queue data freshness against PostgreSQL (fresh vs stale cached state).
 * 3. PRINTER_DETECTED: OS/CUPS driver enumeration of physical or virtual printers.
 * 4. PRINTER_READY: Hardware readiness of selected printer (online, idle, zero jams, paper loaded).
 * 5. JOB_SUBMITTED: Document payload spooled into the native host OS print spooler.
 * 6. JOB_FINISHED: Spooler and hardware confirm physical output has reached the exit tray.
 *
 * STRICT INVARIANT: Pure platform-agnostic calculation only. Zero DOM, zero DB side-effects.
 */

export type HonestConnectivityStage =
    | 'BACKEND_CONNECTED'
    | 'DATA_CURRENT'
    | 'PRINTER_DETECTED'
    | 'PRINTER_READY'
    | 'JOB_SUBMITTED'
    | 'JOB_FINISHED';

export type BackendConnectionState = 'CONNECTED' | 'DISCONNECTED' | 'CONNECTING';
export type DataFreshnessState = 'CURRENT' | 'STALE' | 'SYNCING' | 'UNINITIALIZED';
export type PrinterDetectionState = 'DETECTED' | 'NOT_DETECTED';
export type PrinterReadinessState = 'READY' | 'NOT_READY' | 'NO_PRINTER_SELECTED';
export type JobSubmissionState = 'NOT_SUBMITTED' | 'SUBMITTING' | 'SUBMITTED' | 'SUBMISSION_FAILED';
export type JobCompletionState = 'NOT_STARTED' | 'IN_PROGRESS' | 'FINISHED' | 'FAILED' | 'CANCELLED';

export interface HonestConnectivityInputs {
    /** Whether backend health-check or API calls succeeded recently */
    isBackendReachable: boolean;
    /** Round-trip ping latency in milliseconds, if known */
    backendLatencyMs?: number;
    /** ISO timestamp of last successful sync with remote database */
    lastSyncTimestamp?: string | number | Date | null;
    /** Whether an active sync operation is underway right now */
    isSyncing?: boolean;
    /** Max age in seconds before data is marked stale (default: 60s) */
    staleThresholdSeconds?: number;
    /** Number of printers detected by host OS / CUPS */
    detectedPrintersCount: number;
    /** Currently selected target printer details */
    selectedPrinter?: {
        id: string;
        name: string;
        status: 'idle' | 'busy' | 'offline' | 'error' | string;
        isDefault?: boolean;
    } | null;
    /** Print job execution state for active order */
    activeJob?: {
        localJobId?: string;
        nativeJobId?: string;
        submissionState?: 'PENDING_SUBMISSION' | 'SUBMITTED' | 'FAILED' | string;
        status?: 'QUEUED' | 'SUBMITTING' | 'PRINTING' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | string;
        submittedAt?: string | null;
        completedAt?: string | null;
        errorMessage?: string | null;
    } | null;
}

export interface HonestConnectivitySnapshot {
    backendConnected: {
        stage: 'BACKEND_CONNECTED';
        status: BackendConnectionState;
        latencyMs?: number;
        label: string;
        message: string;
        isOk: boolean;
    };
    dataCurrent: {
        stage: 'DATA_CURRENT';
        status: DataFreshnessState;
        lastSyncTimestamp: string | null;
        ageSeconds: number | null;
        staleThresholdSeconds: number;
        label: string;
        message: string;
        isOk: boolean;
    };
    printerDetected: {
        stage: 'PRINTER_DETECTED';
        status: PrinterDetectionState;
        detectedCount: number;
        label: string;
        message: string;
        isOk: boolean;
    };
    printerReady: {
        stage: 'PRINTER_READY';
        status: PrinterReadinessState;
        targetPrinterName?: string;
        hardwareStatus?: string;
        label: string;
        message: string;
        isOk: boolean;
    };
    jobSubmitted: {
        stage: 'JOB_SUBMITTED';
        status: JobSubmissionState;
        localJobId?: string;
        nativeJobId?: string;
        submittedAt?: string;
        label: string;
        message: string;
        isOk: boolean;
    };
    jobFinished: {
        stage: 'JOB_FINISHED';
        status: JobCompletionState;
        completedAt?: string;
        label: string;
        message: string;
        isOk: boolean;
    };
    overallReadyForPrinting: boolean;
    overallHealthy: boolean;
    troubleshooting: string[];
}

/**
 * Pure authoritative evaluator that constructs an HonestConnectivitySnapshot.
 * Strictly isolates each operational failure mode from the others.
 */
export function evaluateHonestConnectivity(
    inputs: HonestConnectivityInputs
): HonestConnectivitySnapshot {
    const troubleshooting: string[] = [];

    // ── 1. BACKEND_CONNECTED ──────────────────────────────────────────────────
    let backendStatus: BackendConnectionState = inputs.isBackendReachable ? 'CONNECTED' : 'DISCONNECTED';
    let backendLabel = backendStatus === 'CONNECTED'
        ? (inputs.backendLatencyMs != null ? `Backend Connected (${inputs.backendLatencyMs}ms)` : 'Backend Connected')
        : 'Backend Offline';
    let backendMessage = backendStatus === 'CONNECTED'
        ? (inputs.backendLatencyMs != null
            ? `Connected to central XerService API (${inputs.backendLatencyMs}ms latency).`
            : 'Connected to central XerService API.')
        : 'Central backend API unreachable. Check internet connection or API server status.';

    if (backendStatus === 'DISCONNECTED') {
        troubleshooting.push('Central backend API unreachable: Check internet connection or server status.');
    }

    // ── 2. DATA_CURRENT ───────────────────────────────────────────────────────
    const staleThreshold = inputs.staleThresholdSeconds ?? 60;
    let dataStatus: DataFreshnessState = 'UNINITIALIZED';
    let ageSeconds: number | null = null;
    let syncTimestampStr: string | null = null;

    if (inputs.isSyncing) {
        dataStatus = 'SYNCING';
    } else if (inputs.lastSyncTimestamp) {
        const syncTime = new Date(inputs.lastSyncTimestamp).getTime();
        if (!isNaN(syncTime)) {
            syncTimestampStr = new Date(syncTime).toISOString();
            ageSeconds = Math.max(0, Math.floor((Date.now() - syncTime) / 1000));
            dataStatus = ageSeconds <= staleThreshold ? 'CURRENT' : 'STALE';
        }
    }

    let dataLabel = 'Data Fresh';
    let dataMessage = 'Order queue is synced in real-time with remote database.';
    if (dataStatus === 'SYNCING') {
        dataLabel = 'Syncing Orders…';
        dataMessage = 'Synchronizing queue with remote database…';
    } else if (dataStatus === 'STALE') {
        dataLabel = `Data Stale (${ageSeconds}s ago)`;
        dataMessage = `Showing cached orders from ${ageSeconds}s ago. Reconnecting to sync latest updates.`;
        troubleshooting.push(`Data stale: Local queue has not synced for ${ageSeconds}s. Refresh or reconnect.`);
    } else if (dataStatus === 'UNINITIALIZED') {
        dataLabel = 'Not Synced';
        dataMessage = 'Order data has not yet been fetched from the server.';
    }

    // ── 3. PRINTER_DETECTED ───────────────────────────────────────────────────
    const detectedCount = Math.max(0, inputs.detectedPrintersCount || 0);
    const printerDetectedStatus: PrinterDetectionState = detectedCount > 0 ? 'DETECTED' : 'NOT_DETECTED';
    const printerDetectedLabel = detectedCount > 0
        ? `${detectedCount} Printer${detectedCount > 1 ? 's' : ''} Detected`
        : 'No Printers Detected';
    const printerDetectedMessage = detectedCount > 0
        ? `Found ${detectedCount} printer${detectedCount > 1 ? 's' : ''} enumerated on local host.`
        : 'No printers found on local OS spooler. Check USB cable or Wi-Fi network.';

    if (printerDetectedStatus === 'NOT_DETECTED') {
        troubleshooting.push('No printers detected: Connect printer via USB or configure CUPS driver.');
    }

    // ── 4. PRINTER_READY ──────────────────────────────────────────────────────
    let printerReadyStatus: PrinterReadinessState = 'NO_PRINTER_SELECTED';
    let printerReadyLabel = 'No Printer Selected';
    let printerReadyMessage = 'Select a detected printer to evaluate hardware readiness.';
    let hardwareStatus: string | undefined = undefined;
    let targetPrinterName: string | undefined = undefined;

    if (inputs.selectedPrinter) {
        targetPrinterName = inputs.selectedPrinter.name;
        hardwareStatus = String(inputs.selectedPrinter.status || '').toLowerCase();

        if (hardwareStatus === 'idle' || hardwareStatus === 'ready') {
            printerReadyStatus = 'READY';
            printerReadyLabel = `${targetPrinterName} Ready`;
            printerReadyMessage = `Printer "${targetPrinterName}" is idle and ready for print jobs.`;
        } else if (hardwareStatus.includes('jam')) {
            printerReadyStatus = 'NOT_READY';
            printerReadyLabel = `${targetPrinterName} (paper-jam)`;
            printerReadyMessage = `Printer "${targetPrinterName}" reports a paper jam. Clear the paper path.`;
            troubleshooting.push(`Hardware Alert: Printer "${targetPrinterName}" has a paper jam.`);
        } else if (hardwareStatus.includes('empty') || hardwareStatus.includes('out_of_paper')) {
            printerReadyStatus = 'NOT_READY';
            printerReadyLabel = `${targetPrinterName} (Out of Paper)`;
            printerReadyMessage = `Printer "${targetPrinterName}" is out of paper. Load paper into the tray.`;
            troubleshooting.push(`Hardware Alert: Printer "${targetPrinterName}" is out of paper.`);
        } else if (hardwareStatus === 'offline') {
            printerReadyStatus = 'NOT_READY';
            printerReadyLabel = `${targetPrinterName} Offline`;
            printerReadyMessage = `Printer "${targetPrinterName}" is powered off or disconnected.`;
            troubleshooting.push(`Hardware Alert: Printer "${targetPrinterName}" is offline. Turn power on.`);
        } else if (hardwareStatus === 'busy' || hardwareStatus.includes('printing')) {
            printerReadyStatus = 'READY';
            printerReadyLabel = `${targetPrinterName} Printing…`;
            printerReadyMessage = `Printer "${targetPrinterName}" is actively executing another job.`;
        } else {
            printerReadyStatus = 'NOT_READY';
            printerReadyLabel = `${targetPrinterName} (${inputs.selectedPrinter.status})`;
            printerReadyMessage = `Printer "${targetPrinterName}" state is ${inputs.selectedPrinter.status}.`;
        }
    }

    // ── 5. JOB_SUBMITTED ──────────────────────────────────────────────────────
    let submissionStatus: JobSubmissionState = 'NOT_SUBMITTED';
    let submissionLabel = 'Not Submitted';
    let submissionMessage = 'Document has not yet been spooled to the printer.';
    let localJobId: string | undefined = undefined;
    let nativeJobId: string | undefined = undefined;
    let submittedAt: string | undefined = undefined;

    if (inputs.activeJob) {
        localJobId = inputs.activeJob.localJobId;
        nativeJobId = inputs.activeJob.nativeJobId;
        submittedAt = inputs.activeJob.submittedAt || undefined;

        const sState = inputs.activeJob.submissionState;
        const jStatus = inputs.activeJob.status;

        if (sState === 'SUBMITTED' || jStatus === 'PRINTING' || jStatus === 'COMPLETED') {
            submissionStatus = 'SUBMITTED';
            submissionLabel = nativeJobId ? `Spool Job #${nativeJobId}` : 'Job Spooled';
            submissionMessage = nativeJobId
                ? `Accepted into OS spooler as native job #${nativeJobId}.`
                : 'Accepted into native OS print spooler.';
        } else if (sState === 'SUBMITTING' || jStatus === 'SUBMITTING') {
            submissionStatus = 'SUBMITTING';
            submissionLabel = 'Submitting Spool…';
            submissionMessage = 'Spool payload being transmitted to host OS spooler.';
        } else if (sState === 'FAILED' || sState === 'SUBMISSION_FAILED' || inputs.activeJob.errorMessage) {
            submissionStatus = 'SUBMISSION_FAILED';
            submissionLabel = 'Spooling Failed';
            submissionMessage = inputs.activeJob.errorMessage || 'Native spooler rejected print payload.';
            troubleshooting.push(`Spool submission failed: ${submissionMessage}`);
        } else if (jStatus === 'QUEUED') {
            submissionStatus = 'NOT_SUBMITTED';
            submissionLabel = 'Awaiting Print Command';
            submissionMessage = 'Order is queued; ready for vendor to initiate print.';
        }
    }

    // ── 6. JOB_FINISHED ───────────────────────────────────────────────────────
    let finishStatus: JobCompletionState = 'NOT_STARTED';
    let finishLabel = 'Not Printed';
    let finishMessage = 'Physical printing has not yet completed.';
    let completedAt: string | undefined = undefined;

    if (inputs.activeJob) {
        completedAt = inputs.activeJob.completedAt || undefined;
        const jStatus = inputs.activeJob.status;

        if (jStatus === 'COMPLETED' || completedAt != null) {
            finishStatus = 'FINISHED';
            finishLabel = 'Job Finished (Physical Output Ready)';
            finishMessage = 'Physical sheets dispensed to output tray.';
        } else if (jStatus === 'FAILED') {
            finishStatus = 'FAILED';
            finishLabel = 'Print Hardware Failure';
            finishMessage = inputs.activeJob.errorMessage || 'Print hardware failed during execution.';
        } else if (jStatus === 'CANCELLED') {
            finishStatus = 'CANCELLED';
            finishLabel = 'Print Cancelled';
            finishMessage = 'Print job was cancelled by operator.';
        } else if (jStatus === 'PRINTING') {
            finishStatus = 'IN_PROGRESS';
            finishLabel = 'Printing in Progress (Spooling to Hardware)';
            finishMessage = 'Paper feed and raster engine actively printing.';
        }
    }

    // Combined readiness for new print job submission
    const overallReadyForPrinting =
        backendStatus === 'CONNECTED' &&
        printerDetectedStatus === 'DETECTED' &&
        printerReadyStatus === 'READY';

    return {
        backendConnected: {
            stage: 'BACKEND_CONNECTED',
            status: backendStatus,
            latencyMs: inputs.backendLatencyMs,
            label: backendLabel,
            message: backendMessage,
            isOk: backendStatus === 'CONNECTED',
        },
        dataCurrent: {
            stage: 'DATA_CURRENT',
            status: dataStatus,
            lastSyncTimestamp: syncTimestampStr,
            ageSeconds,
            staleThresholdSeconds: staleThreshold,
            label: dataLabel,
            message: dataMessage,
            isOk: dataStatus === 'CURRENT' || dataStatus === 'SYNCING',
        },
        printerDetected: {
            stage: 'PRINTER_DETECTED',
            status: printerDetectedStatus,
            detectedCount,
            label: printerDetectedLabel,
            message: printerDetectedMessage,
            isOk: printerDetectedStatus === 'DETECTED',
        },
        printerReady: {
            stage: 'PRINTER_READY',
            status: printerReadyStatus,
            targetPrinterName,
            hardwareStatus,
            label: printerReadyLabel,
            message: printerReadyMessage,
            isOk: printerReadyStatus === 'READY',
        },
        jobSubmitted: {
            stage: 'JOB_SUBMITTED',
            status: submissionStatus,
            localJobId,
            nativeJobId,
            submittedAt,
            label: submissionLabel,
            message: submissionMessage,
            isOk: submissionStatus === 'SUBMITTED',
        },
        jobFinished: {
            stage: 'JOB_FINISHED',
            status: finishStatus,
            completedAt,
            label: finishLabel,
            message: finishMessage,
            isOk: finishStatus === 'FINISHED',
        },
        overallReadyForPrinting,
        overallHealthy: overallReadyForPrinting,
        troubleshooting,
    };
}

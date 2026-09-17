/**
 * @packages/shared/recovery
 * Authoritative Safe Order Recovery & Anti-Collision Engine for XerService.
 *
 * Implements the resilience requirements of astraplan.md Section 19:
 * > "7. Safe recovery: retain drafts and failed-action input; resolve unknown
 * > outcomes before retrying money or printing actions."
 *
 * Provides:
 * 1. Draft Retention & Input Preservation (order drafts, file manifests, print settings).
 * 2. Fail-Closed Payment Retry Protection (prevents customer double-charging on gateway timeouts).
 * 3. Fail-Closed Print Spooling Protection (prevents duplicate physical prints on native spooler timeouts).
 * 4. Structured Recovery Diagnostics (deterministic recovery actions).
 *
 * STRICT INVARIANT: Pure platform-agnostic logic. Zero DOM, zero direct DB mutations.
 */

// ── 1. DRAFT RETENTION TYPES & INTERFACES ────────────────────────────────────

export interface OrderDraftFile {
    id: string;
    originalFilename: string;
    fileSizeBytes: number;
    mimeType: string;
    pageCount: number;
    previewUrl?: string;
    printSettings: {
        copies: number;
        colourMode: 'bw' | 'colour' | 'color';
        sides: 'single' | 'double' | 'double_long' | 'double_short';
        paperSize: 'a4' | 'a3' | 'a5' | 'letter' | 'legal' | string;
        orientation?: 'portrait' | 'landscape';
        pageRange?: string;
        customRange?: string;
    };
    finishingAddonIds?: string[];
}

export interface OrderDraft {
    draftId: string;
    shopId: string;
    shopName?: string;
    customerId?: string;
    files: OrderDraftFile[];
    customerNotes?: string;
    deliveryMethod?: 'pickup' | 'delivery';
    createdAt: string;
    updatedAt: string;
    expiresAt: string;
    metadata?: Record<string, unknown>;
}

export type DraftState =
    | 'NO_DRAFT'
    | 'DRAFT_AVAILABLE'
    | 'DRAFT_EXPIRED'
    | 'DRAFT_RESTORED'
    | 'DRAFT_DISCARDED';

export interface DraftEvaluationResult {
    state: DraftState;
    draft: OrderDraft | null;
    isValid: boolean;
    ageMinutes: number | null;
    userPrompt?: string;
}

// ── 2. FAIL-CLOSED PAYMENT RETRY TYPES & INTERFACES ──────────────────────────

export type PaymentRetrySafetyState =
    | 'SAFE_TO_INITIATE'
    | 'AMBIGUOUS_VERIFY_REQUIRED'
    | 'ALREADY_CAPTURED'
    | 'SAFE_RETRY_PERMITTED'
    | 'PERMANENTLY_FAILED';

export interface PaymentRetryInputs {
    orderId: string;
    orderStatus: string;
    paymentStatus: string; // 'pending' | 'paid' | 'failed' | 'refunded'
    gatewayTransactionStatus?: 'captured' | 'authorized' | 'failed' | 'timeout' | 'pending' | string | null;
    hasActiveLedgerRow?: boolean;
    lastAttemptTimestamp?: string | number | null;
    attemptCount?: number;
    verificationError?: string | null;
}

export interface PaymentRetrySafetySnapshot {
    safetyState: PaymentRetrySafetyState;
    isRetryBlocked: boolean;
    canInitiateNewPayment: boolean;
    actionRequired:
        | 'VERIFY_PAYMENT_OUTCOME'
        | 'PROCEED_TO_ORDERS'
        | 'SAFE_RETRY_READY'
        | 'INITIATE_PAYMENT'
        | 'CONTACT_SUPPORT';
    headline: string;
    userMessage: string;
    recommendedButtonLabel?: string;
}

// ── 3. FAIL-CLOSED PRINT REPRINT TYPES & INTERFACES ──────────────────────────

export type PrintRetrySafetyState =
    | 'SAFE_TO_PRINT'
    | 'AMBIGUOUS_SPOOL_CHECK_REQUIRED'
    | 'SPOOL_ALREADY_ACTIVE'
    | 'SPOOL_ALREADY_COMPLETED'
    | 'SAFE_REPRINT_PERMITTED'
    | 'PRINTER_BLOCKED_UNPAID';

export interface PrintRetryInputs {
    orderId: string;
    orderPaymentStatus: string;
    activePrintJob?: {
        jobId?: string;
        localJobId?: string;
        nativeJobId?: string;
        status: string; // 'QUEUED' | 'PRINTING' | 'COMPLETED' | 'FAILED' | 'CANCELLED'
        submissionState?: string; // 'SUBMITTED' | 'FAILED' | 'SUBMITTING'
        submittedAt?: string | null;
    } | null;
    hostSpoolerJobs?: Array<{
        jobId?: string;
        nativeJobId?: string;
        status?: string;
    }>;
    lastSubmissionAttempt?: {
        timestamp: string | number;
        outcome: 'success' | 'failed' | 'timeout' | 'unknown';
        errorMessage?: string;
    } | null;
}

export interface PrintRetrySafetySnapshot {
    safetyState: PrintRetrySafetyState;
    isPrintBlocked: boolean;
    canSubmitPrint: boolean;
    activeNativeJobId?: string;
    actionRequired:
        | 'CHECK_SPOOLER'
        | 'MONITOR_ACTIVE_PRINT'
        | 'SAFE_REPRINT_READY'
        | 'PROCEED_TO_DISPATCH'
        | 'COLLECT_PAYMENT_FIRST';
    headline: string;
    userMessage: string;
    recommendedButtonLabel?: string;
}

// ── 4. UNIFIED SAFE RECOVERY SNAPSHOT ────────────────────────────────────────

export type SafeRecoveryPrimaryAction =
    | 'RESTORE_DRAFT'
    | 'VERIFY_PAYMENT_OUTCOME'
    | 'CHECK_SPOOLER'
    | 'SAFE_RETRY_READY'
    | 'SAFE_PRINT_READY'
    | 'ABORT_AND_REFUND'
    | 'NO_ACTION_NEEDED';

export interface SafeRecoverySnapshot {
    draft: DraftEvaluationResult;
    payment: PaymentRetrySafetySnapshot;
    printing: PrintRetrySafetySnapshot;
    recommendedAction: SafeRecoveryPrimaryAction;
    summaryMessage: string;
    hasBlockingUnknownOutcome: boolean;
}

// ── 5. AUTHORITATIVE EVALUATORS ─────────────────────────────────────────────

/**
 * Evaluates whether a cached order draft is available, fresh, and restorable.
 * Default TTL: 24 hours (1440 minutes).
 */
export function evaluateDraftState(
    draft: OrderDraft | null | undefined,
    currentTime: number | string | Date = Date.now(),
    ttlMinutes: number = 1440
): DraftEvaluationResult {
    if (!draft || !draft.files || draft.files.length === 0) {
        return {
            state: 'NO_DRAFT',
            draft: null,
            isValid: false,
            ageMinutes: null,
        };
    }

    const now = typeof currentTime === 'number' ? currentTime : new Date(currentTime).getTime();
    const updatedTime = new Date(draft.updatedAt || draft.createdAt).getTime();

    if (isNaN(updatedTime)) {
        return {
            state: 'NO_DRAFT',
            draft: null,
            isValid: false,
            ageMinutes: null,
        };
    }

    const ageMinutes = Math.max(0, Math.floor((now - updatedTime) / 60000));
    const isExpired = ageMinutes > ttlMinutes;

    if (isExpired) {
        return {
            state: 'DRAFT_EXPIRED',
            draft,
            isValid: false,
            ageMinutes,
            userPrompt: `Previous draft for ${draft.files.length} document${draft.files.length > 1 ? 's' : ''} has expired.`,
        };
    }

    return {
        state: 'DRAFT_AVAILABLE',
        draft,
        isValid: true,
        ageMinutes,
        userPrompt: `We restored your unsubmitted print configuration (${draft.files.length} file${draft.files.length > 1 ? 's' : ''}, updated ${ageMinutes}m ago).`,
    };
}

/**
 * Evaluates whether retrying payment for an order is safe.
 * Strictly blocks retry if gateway outcome is unknown or payment was already captured.
 */
export function evaluatePaymentRetrySafety(
    inputs: PaymentRetryInputs
): PaymentRetrySafetySnapshot {
    const paymentStatus = (inputs.paymentStatus || '').toLowerCase();
    const gatewayStatus = (inputs.gatewayTransactionStatus || '').toLowerCase();

    // 1. Order already confirmed paid or ledger row exists
    if (paymentStatus === 'paid' || gatewayStatus === 'captured' || inputs.hasActiveLedgerRow) {
        return {
            safetyState: 'ALREADY_CAPTURED',
            isRetryBlocked: true,
            canInitiateNewPayment: false,
            actionRequired: 'PROCEED_TO_ORDERS',
            headline: 'Payment Already Captured',
            userMessage: 'This order has already been successfully paid. No retry is necessary; your order is in queue.',
            recommendedButtonLabel: 'View Order Status',
        };
    }

    // 2. Gateway outcome is ambiguous or timed out
    if (
        gatewayStatus === 'timeout' ||
        gatewayStatus === 'pending' ||
        gatewayStatus === 'authorized' ||
        (inputs.lastAttemptTimestamp && gatewayStatus === '')
    ) {
        return {
            safetyState: 'AMBIGUOUS_VERIFY_REQUIRED',
            isRetryBlocked: true,
            canInitiateNewPayment: false,
            actionRequired: 'VERIFY_PAYMENT_OUTCOME',
            headline: 'Verifying Payment Outcome',
            userMessage: 'A payment attempt was recently sent to the gateway. Please verify the outcome before retrying to prevent double charges.',
            recommendedButtonLabel: 'Verify Payment Status',
        };
    }

    // 3. Gateway confirmed payment failure or customer aborted
    if (paymentStatus === 'failed' || gatewayStatus === 'failed') {
        return {
            safetyState: 'SAFE_RETRY_PERMITTED',
            isRetryBlocked: false,
            canInitiateNewPayment: true,
            actionRequired: 'SAFE_RETRY_READY',
            headline: 'Payment Failed — Safe to Retry',
            userMessage: inputs.verificationError || 'The previous payment attempt did not complete. You may safely try again or select another payment method.',
            recommendedButtonLabel: 'Retry Payment Safely',
        };
    }

    // 4. Initial attempt (clean pending)
    return {
        safetyState: 'SAFE_TO_INITIATE',
        isRetryBlocked: false,
        canInitiateNewPayment: true,
        actionRequired: 'INITIATE_PAYMENT',
        headline: 'Ready for Payment',
        userMessage: 'Order is ready for checkout.',
        recommendedButtonLabel: 'Pay Now',
    };
}

/**
 * Evaluates whether spooling or re-printing an order is safe in the native vendor shell.
 * Strictly blocks reprint if native spooler or active job registry already holds the print job.
 */
export function evaluatePrintRetrySafety(
    inputs: PrintRetryInputs
): PrintRetrySafetySnapshot {
    // 1. Block printing if order is unpaid
    const payStatus = (inputs.orderPaymentStatus || '').toLowerCase();
    if (payStatus !== 'paid') {
        return {
            safetyState: 'PRINTER_BLOCKED_UNPAID',
            isPrintBlocked: true,
            canSubmitPrint: false,
            actionRequired: 'COLLECT_PAYMENT_FIRST',
            headline: 'Unpaid Order Blocked',
            userMessage: 'This order has not yet been paid. Only paid orders can be dispatched to hardware.',
            recommendedButtonLabel: 'Awaiting Customer Payment',
        };
    }

    const job = inputs.activePrintJob;
    const spoolerJobs = inputs.hostSpoolerJobs || [];

    // Check if active in order registry
    const isRegistryActive = job && (job.status === 'QUEUED' || job.status === 'PRINTING');
    // Check if present in native host spooler
    const isSpoolerActive = job?.nativeJobId
        ? spoolerJobs.some(sj => sj.nativeJobId === job.nativeJobId || sj.jobId === job.jobId)
        : false;

    // 2. Already active on hardware or spooler
    if (isRegistryActive || isSpoolerActive) {
        const nativeId = job?.nativeJobId || 'active';
        return {
            safetyState: 'SPOOL_ALREADY_ACTIVE',
            isPrintBlocked: true,
            canSubmitPrint: false,
            activeNativeJobId: job?.nativeJobId,
            actionRequired: 'MONITOR_ACTIVE_PRINT',
            headline: 'Print Job Active in Spooler',
            userMessage: `A print job is already active in the OS spooler (#${nativeId}). Retrying now would produce duplicate physical sheets.`,
            recommendedButtonLabel: 'View in Print Queue',
        };
    }

    // 3. Ambiguous timeout during spooling
    if (inputs.lastSubmissionAttempt?.outcome === 'timeout' || inputs.lastSubmissionAttempt?.outcome === 'unknown') {
        return {
            safetyState: 'AMBIGUOUS_SPOOL_CHECK_REQUIRED',
            isPrintBlocked: true,
            canSubmitPrint: false,
            actionRequired: 'CHECK_SPOOLER',
            headline: 'Spooler Outcome Unknown',
            userMessage: 'The previous spooling request timed out. Check the native CUPS/OS spooler before re-submitting to prevent duplicate prints.',
            recommendedButtonLabel: 'Inspect Native Spooler',
        };
    }

    // 4. Job already completed
    if (job && job.status === 'COMPLETED') {
        return {
            safetyState: 'SPOOL_ALREADY_COMPLETED',
            isPrintBlocked: false,
            canSubmitPrint: true,
            activeNativeJobId: job.nativeJobId,
            actionRequired: 'SAFE_REPRINT_READY',
            headline: 'Previous Print Completed',
            userMessage: 'This order was previously printed. If customer requested additional physical copies, you may re-print.',
            recommendedButtonLabel: 'Print Additional Copy',
        };
    }

    // 5. Clean state — safe to dispatch
    return {
        safetyState: 'SAFE_TO_PRINT',
        isPrintBlocked: false,
        canSubmitPrint: true,
        actionRequired: 'PROCEED_TO_DISPATCH',
        headline: 'Ready to Print',
        userMessage: 'Order is paid and ready for native hardware spooling.',
        recommendedButtonLabel: 'Start Printing',
    };
}

/**
 * Unified evaluator that combines draft state, payment retry safety, and print retry safety.
 */
export function evaluateSafeRecovery(inputs: {
    draft?: OrderDraft | null;
    payment?: PaymentRetryInputs;
    printing?: PrintRetryInputs;
    currentTime?: number | string | Date;
}): SafeRecoverySnapshot {
    const draftResult = evaluateDraftState(inputs.draft, inputs.currentTime);

    const paymentResult = inputs.payment
        ? evaluatePaymentRetrySafety(inputs.payment)
        : {
            safetyState: 'SAFE_TO_INITIATE' as PaymentRetrySafetyState,
            isRetryBlocked: false,
            canInitiateNewPayment: true,
            actionRequired: 'INITIATE_PAYMENT' as const,
            headline: 'No Active Payment',
            userMessage: 'Ready for payment.',
        };

    const printingResult = inputs.printing
        ? evaluatePrintRetrySafety(inputs.printing)
        : {
            safetyState: 'SAFE_TO_PRINT' as PrintRetrySafetyState,
            isPrintBlocked: false,
            canSubmitPrint: true,
            actionRequired: 'PROCEED_TO_DISPATCH' as const,
            headline: 'No Active Print',
            userMessage: 'Ready to print.',
        };

    // Priority ordering of recommended action:
    // 1. Ambiguous payment outcome (highest financial risk)
    // 2. Ambiguous spooler outcome (hardware resource waste risk)
    // 3. Draft restoration (customer experience risk)
    let recommendedAction: SafeRecoveryPrimaryAction = 'NO_ACTION_NEEDED';
    let summaryMessage = 'All order flows operating normally.';
    const hasBlockingUnknownOutcome =
        paymentResult.safetyState === 'AMBIGUOUS_VERIFY_REQUIRED' ||
        printingResult.safetyState === 'AMBIGUOUS_SPOOL_CHECK_REQUIRED';

    if (paymentResult.safetyState === 'AMBIGUOUS_VERIFY_REQUIRED') {
        recommendedAction = 'VERIFY_PAYMENT_OUTCOME';
        summaryMessage = paymentResult.userMessage;
    } else if (printingResult.safetyState === 'AMBIGUOUS_SPOOL_CHECK_REQUIRED') {
        recommendedAction = 'CHECK_SPOOLER';
        summaryMessage = printingResult.userMessage;
    } else if (draftResult.state === 'DRAFT_AVAILABLE') {
        recommendedAction = 'RESTORE_DRAFT';
        summaryMessage = draftResult.userPrompt || 'Restorable draft found.';
    } else if (paymentResult.safetyState === 'SAFE_RETRY_PERMITTED') {
        recommendedAction = 'SAFE_RETRY_READY';
        summaryMessage = paymentResult.userMessage;
    } else if (printingResult.safetyState === 'SAFE_TO_PRINT') {
        recommendedAction = 'SAFE_PRINT_READY';
        summaryMessage = printingResult.userMessage;
    }

    return {
        draft: draftResult,
        payment: paymentResult,
        printing: printingResult,
        recommendedAction,
        summaryMessage,
        hasBlockingUnknownOutcome,
    };
}

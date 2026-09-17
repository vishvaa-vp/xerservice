/**
 * Acceptance Test Suite for Priority 7: Safe Order Recovery
 *
 * Verifies the complete Safe Order Recovery implementation according to astraplan.md Section 19:
 * > "7. Safe recovery: retain drafts and failed-action input; resolve unknown
 * > outcomes before retrying money or printing actions."
 *
 * Covers:
 * 1. Draft Retention & Input Preservation (TTL, expiration, restorable prompts).
 * 2. Fail-Closed Payment Retry Protection (prevents customer double-charging on gateway timeouts).
 * 3. Fail-Closed Print Spooling Protection (prevents duplicate physical prints on native spooler timeouts).
 * 4. Unified Safe Recovery Decision Engine (prioritized resolution of unknown outcomes).
 * 5. Cross-app static HTML, DOM, and runtime code wiring.
 * 6. Financial baseline invariant certification (zero delta on Supabase remote database).
 */

import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

// Import pure recovery engine directly
import {
    evaluateDraftState,
    evaluatePaymentRetrySafety,
    evaluatePrintRetrySafety,
    evaluateSafeRecovery,
} from '../packages/shared/src/recovery.ts';

let passed = 0;
let failed = 0;

function assert(condition, message) {
    if (condition) {
        passed++;
        console.log(`  ✓ PASS [${passed + failed}]: ${message}`);
    } else {
        failed++;
        console.error(`  ✗ FAIL [${passed + failed}]: ${message}`);
    }
}

// ── Read Environment Variables ──────────────────────────────────────────────
function getEnv() {
    const envPath = path.resolve(process.cwd(), '.env.local');
    const vars = {};
    if (fs.existsSync(envPath)) {
        const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
                const idx = trimmed.indexOf('=');
                vars[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
            }
        }
    }
    return vars;
}

// ── Invariant Helper ────────────────────────────────────────────────────────
async function getBaselineInvariants(sb) {
    const { count: ledgerCount, error: err1 } = await sb
        .from('order_financial_ledger')
        .select('*', { count: 'exact', head: true });
    if (err1) throw new Error(`Failed to query order_financial_ledger: ${err1.message}`);

    const { data: wallets, error: err2 } = await sb
        .from('wallet_accounts')
        .select('balance');
    if (err2) throw new Error(`Failed to query wallet_accounts: ${err2.message}`);
    const walletSum = (wallets || []).reduce((sum, w) => sum + Number(w.balance || 0), 0);

    const { count: rulesCount, error: err3 } = await sb
        .from('shop_commission_rules')
        .select('*', { count: 'exact', head: true });
    if (err3) throw new Error(`Failed to query shop_commission_rules: ${err3.message}`);

    const { count: batchCount, error: err4 } = await sb
        .from('vendor_settlement_batches')
        .select('*', { count: 'exact', head: true });
    if (err4) throw new Error(`Failed to query vendor_settlement_batches: ${err4.message}`);

    const { count: itemCount, error: err5 } = await sb
        .from('vendor_settlement_items')
        .select('*', { count: 'exact', head: true });
    if (err5) throw new Error(`Failed to query vendor_settlement_items: ${err5.message}`);

    return {
        ledgerCount: ledgerCount || 0,
        walletSum: Math.round(walletSum * 100) / 100,
        rulesCount: rulesCount || 0,
        batchCount: batchCount || 0,
        itemCount: itemCount || 0,
    };
}

async function main() {
    console.log('========================================================================');
    console.log('PRIORITY 7 ACCEPTANCE SUITE: SAFE ORDER RECOVERY');
    console.log('========================================================================\n');

    const env = getEnv();
    const supabaseUrl = env['NEXT_PUBLIC_SUPABASE_URL'] || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = env['SUPABASE_SECRET_KEY'] || process.env.SUPABASE_SECRET_KEY || env['SUPABASE_SERVICE_ROLE_KEY'] || process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
        throw new Error('Supabase credentials missing from .env.local');
    }

    const sb = createClient(supabaseUrl, serviceRoleKey);

    // Initial Database Invariant Check
    console.log('--- Initial Financial Baseline Verification ---');
    const baseline = await getBaselineInvariants(sb);
    console.log(`  Initial Baseline: ledger=${baseline.ledgerCount}, wallets=₹${baseline.walletSum}, rules=${baseline.rulesCount}, batches=${baseline.batchCount}, items=${baseline.itemCount}`);
    assert(baseline.ledgerCount === 17, 'Baseline invariant order_financial_ledger count is 17');
    assert(baseline.walletSum === 88.00, 'Baseline invariant wallet_accounts total is ₹88.00');
    assert(baseline.rulesCount === 2, 'Baseline invariant shop_commission_rules count is 2');
    assert(baseline.batchCount === 1, 'Baseline invariant vendor_settlement_batches count is 1');
    assert(baseline.itemCount === 4, 'Baseline invariant vendor_settlement_items count is 4');

    const now = Date.now();

    // ── SECTION 1: Draft Retention & Input Preservation ────────────────────────
    console.log('\n--- SECTION 1: Draft Retention & Input Preservation ---');

    const sampleFreshDraft = {
        draftId: 'draft-shop-123',
        shopId: 'shop-123',
        shopName: 'Green Xerox',
        files: [
            {
                id: 'f1',
                originalFilename: 'assignment.pdf',
                fileSizeBytes: 1024 * 500,
                mimeType: 'application/pdf',
                pageCount: 12,
                printSettings: {
                    copies: 2,
                    colourMode: 'colour',
                    sides: 'double_long',
                    paperSize: 'a4',
                    orientation: 'portrait',
                    pageRange: 'all',
                },
            },
        ],
        createdAt: new Date(now - 10 * 60 * 1000).toISOString(),
        updatedAt: new Date(now - 10 * 60 * 1000).toISOString(), // 10 mins ago
        expiresAt: new Date(now + 23 * 3600 * 1000).toISOString(),
    };

    const freshDraftResult = evaluateDraftState(sampleFreshDraft, now);
    assert(freshDraftResult.state === 'DRAFT_AVAILABLE', 'Fresh draft within TTL is marked DRAFT_AVAILABLE');
    assert(freshDraftResult.isValid === true, 'Fresh draft isValid is true');
    assert(freshDraftResult.ageMinutes === 10, 'Fresh draft ageMinutes matches elapsed time (10m)');
    assert(freshDraftResult.userPrompt.includes('assignment.pdf') || freshDraftResult.userPrompt.includes('1 file'), 'User prompt communicates restorable draft details');

    const sampleExpiredDraft = {
        ...sampleFreshDraft,
        updatedAt: new Date(now - 25 * 3600 * 1000).toISOString(), // 25 hours ago
    };
    const expiredDraftResult = evaluateDraftState(sampleExpiredDraft, now, 1440); // 24h TTL
    assert(expiredDraftResult.state === 'DRAFT_EXPIRED', 'Draft older than 24h TTL is marked DRAFT_EXPIRED');
    assert(expiredDraftResult.isValid === false, 'Expired draft isValid is false');

    const emptyDraftResult = evaluateDraftState(null, now);
    assert(emptyDraftResult.state === 'NO_DRAFT', 'Null draft is marked NO_DRAFT');
    assert(emptyDraftResult.isValid === false, 'Null draft isValid is false');

    const noFilesDraftResult = evaluateDraftState({ ...sampleFreshDraft, files: [] }, now);
    assert(noFilesDraftResult.state === 'NO_DRAFT', 'Draft with empty files list is marked NO_DRAFT');

    // ── SECTION 2: Fail-Closed Payment Retry Protection ────────────────────────
    console.log('\n--- SECTION 2: Fail-Closed Payment Retry Protection ---');

    // Scenario 2.1: Payment already captured in gateway / DB
    const snapAlreadyCaptured = evaluatePaymentRetrySafety({
        orderId: 'ord-100',
        orderStatus: 'PAID',
        paymentStatus: 'paid',
        gatewayTransactionStatus: 'captured',
    });
    assert(snapAlreadyCaptured.safetyState === 'ALREADY_CAPTURED', 'Captured order marked ALREADY_CAPTURED');
    assert(snapAlreadyCaptured.isRetryBlocked === true, 'Retry strictly blocked for captured order (prevents double charge)');
    assert(snapAlreadyCaptured.canInitiateNewPayment === false, 'canInitiateNewPayment is false');
    assert(snapAlreadyCaptured.actionRequired === 'PROCEED_TO_ORDERS', 'Directs customer to view order queue');

    // Scenario 2.2: Active ledger row guarantees double-charge protection
    const snapLedgerGuarded = evaluatePaymentRetrySafety({
        orderId: 'ord-101',
        orderStatus: 'PENDING',
        paymentStatus: 'pending',
        hasActiveLedgerRow: true,
    });
    assert(snapLedgerGuarded.safetyState === 'ALREADY_CAPTURED', 'Existing financial ledger row treats payment as captured');
    assert(snapLedgerGuarded.isRetryBlocked === true, 'Retry blocked when ledger entry exists');

    // Scenario 2.3: Ambiguous timeout during gateway communication
    const snapGatewayTimeout = evaluatePaymentRetrySafety({
        orderId: 'ord-102',
        orderStatus: 'PENDING',
        paymentStatus: 'pending',
        gatewayTransactionStatus: 'timeout',
        lastAttemptTimestamp: now - 30000,
    });
    assert(snapGatewayTimeout.safetyState === 'AMBIGUOUS_VERIFY_REQUIRED', 'Gateway timeout marked AMBIGUOUS_VERIFY_REQUIRED');
    assert(snapGatewayTimeout.isRetryBlocked === true, 'Payment retry strictly blocked during ambiguous timeout');
    assert(snapGatewayTimeout.actionRequired === 'VERIFY_PAYMENT_OUTCOME', 'actionRequired is VERIFY_PAYMENT_OUTCOME');
    assert(snapGatewayTimeout.headline.includes('Verifying Payment Outcome'), 'Headline emphasizes verification over blind retry');

    // Scenario 2.4: Ambiguous pending authorization
    const snapPendingAuth = evaluatePaymentRetrySafety({
        orderId: 'ord-103',
        orderStatus: 'PENDING',
        paymentStatus: 'pending',
        gatewayTransactionStatus: 'pending',
    });
    assert(snapPendingAuth.safetyState === 'AMBIGUOUS_VERIFY_REQUIRED', 'Pending gateway transaction marked AMBIGUOUS_VERIFY_REQUIRED');
    assert(snapPendingAuth.isRetryBlocked === true, 'Retry blocked while gateway authorization pending');

    // Scenario 2.5: Confirmed gateway failure — safe to retry
    const snapConfirmedFailed = evaluatePaymentRetrySafety({
        orderId: 'ord-104',
        orderStatus: 'PENDING',
        paymentStatus: 'failed',
        gatewayTransactionStatus: 'failed',
        verificationError: 'Card declined by issuing bank',
    });
    assert(snapConfirmedFailed.safetyState === 'SAFE_RETRY_PERMITTED', 'Confirmed failure marked SAFE_RETRY_PERMITTED');
    assert(snapConfirmedFailed.isRetryBlocked === false, 'Retry permitted after explicit failure confirmation');
    assert(snapConfirmedFailed.canInitiateNewPayment === true, 'canInitiateNewPayment is true');
    assert(snapConfirmedFailed.actionRequired === 'SAFE_RETRY_READY', 'actionRequired is SAFE_RETRY_READY');

    // Scenario 2.6: Initial clean attempt
    const snapCleanPayment = evaluatePaymentRetrySafety({
        orderId: 'ord-105',
        orderStatus: 'PENDING',
        paymentStatus: 'pending',
        gatewayTransactionStatus: null,
    });
    assert(snapCleanPayment.safetyState === 'SAFE_TO_INITIATE', 'Initial unpaid order marked SAFE_TO_INITIATE');
    assert(snapCleanPayment.isRetryBlocked === false, 'Payment initiation allowed');
    assert(snapCleanPayment.actionRequired === 'INITIATE_PAYMENT', 'actionRequired is INITIATE_PAYMENT');

    // ── SECTION 3: Fail-Closed Print Spooling Collision Protection ─────────────
    console.log('\n--- SECTION 3: Fail-Closed Print Spooling Collision Protection ---');

    // Scenario 3.1: Active job in registry (QUEUED or PRINTING)
    const snapSpoolActiveRegistry = evaluatePrintRetrySafety({
        orderId: 'ord-201',
        orderPaymentStatus: 'paid',
        activePrintJob: {
            jobId: 'local-job-1',
            nativeJobId: 'CUPS-9021',
            status: 'PRINTING',
            submissionState: 'SUBMITTED',
        },
    });
    assert(snapSpoolActiveRegistry.safetyState === 'SPOOL_ALREADY_ACTIVE', 'Active printing job marked SPOOL_ALREADY_ACTIVE');
    assert(snapSpoolActiveRegistry.isPrintBlocked === true, 'Print strictly blocked (prevents duplicate physical output)');
    assert(snapSpoolActiveRegistry.canSubmitPrint === false, 'canSubmitPrint is false');
    assert(snapSpoolActiveRegistry.activeNativeJobId === 'CUPS-9021', 'Preserves active native spool job ID');
    assert(snapSpoolActiveRegistry.actionRequired === 'MONITOR_ACTIVE_PRINT', 'Directs vendor to monitor active print queue');

    // Scenario 3.2: Active job detected in host OS spooler queue
    const snapSpoolActiveHost = evaluatePrintRetrySafety({
        orderId: 'ord-202',
        orderPaymentStatus: 'paid',
        activePrintJob: {
            jobId: 'local-job-2',
            nativeJobId: 'CUPS-9022',
            status: 'QUEUED',
        },
        hostSpoolerJobs: [
            { nativeJobId: 'CUPS-9022', status: 'processing' },
        ],
    });
    assert(snapSpoolActiveHost.safetyState === 'SPOOL_ALREADY_ACTIVE', 'Job enumerated in host spooler marked SPOOL_ALREADY_ACTIVE');
    assert(snapSpoolActiveHost.isPrintBlocked === true, 'Reprint blocked when present in CUPS spooler');

    // Scenario 3.3: Ambiguous timeout during spool submission
    const snapSpoolTimeout = evaluatePrintRetrySafety({
        orderId: 'ord-203',
        orderPaymentStatus: 'paid',
        activePrintJob: null,
        lastSubmissionAttempt: {
            timestamp: now - 15000,
            outcome: 'timeout',
            errorMessage: 'IPC timeout waiting for native spooler response',
        },
    });
    assert(snapSpoolTimeout.safetyState === 'AMBIGUOUS_SPOOL_CHECK_REQUIRED', 'Spooler timeout marked AMBIGUOUS_SPOOL_CHECK_REQUIRED');
    assert(snapSpoolTimeout.isPrintBlocked === true, 'Blind reprint blocked during ambiguous timeout');
    assert(snapSpoolTimeout.actionRequired === 'CHECK_SPOOLER', 'actionRequired is CHECK_SPOOLER');
    assert(snapSpoolTimeout.headline.includes('Spooler Outcome Unknown'), 'Headline guides spooler inspection');

    // Scenario 3.4: Order already printed to exit tray
    const snapSpoolCompleted = evaluatePrintRetrySafety({
        orderId: 'ord-204',
        orderPaymentStatus: 'paid',
        activePrintJob: {
            jobId: 'local-job-4',
            nativeJobId: 'CUPS-9024',
            status: 'COMPLETED',
        },
    });
    assert(snapSpoolCompleted.safetyState === 'SPOOL_ALREADY_COMPLETED', 'Completed print marked SPOOL_ALREADY_COMPLETED');
    assert(snapSpoolCompleted.isPrintBlocked === false, 'Reprint not hard-blocked if operator explicitly chooses extra copy');
    assert(snapSpoolCompleted.actionRequired === 'SAFE_REPRINT_READY', 'actionRequired is SAFE_REPRINT_READY');

    // Scenario 3.5: Order unpaid — printer blocked
    const snapSpoolUnpaid = evaluatePrintRetrySafety({
        orderId: 'ord-205',
        orderPaymentStatus: 'pending',
    });
    assert(snapSpoolUnpaid.safetyState === 'PRINTER_BLOCKED_UNPAID', 'Unpaid order marked PRINTER_BLOCKED_UNPAID');
    assert(snapSpoolUnpaid.isPrintBlocked === true, 'Hard blocks dispatch for unpaid orders');
    assert(snapSpoolUnpaid.actionRequired === 'COLLECT_PAYMENT_FIRST', 'actionRequired is COLLECT_PAYMENT_FIRST');

    // Scenario 3.6: Clean paid order ready for print
    const snapSpoolClean = evaluatePrintRetrySafety({
        orderId: 'ord-206',
        orderPaymentStatus: 'paid',
        activePrintJob: null,
    });
    assert(snapSpoolClean.safetyState === 'SAFE_TO_PRINT', 'Clean paid order marked SAFE_TO_PRINT');
    assert(snapSpoolClean.isPrintBlocked === false, 'Dispatch allowed');
    assert(snapSpoolClean.canSubmitPrint === true, 'canSubmitPrint is true');
    assert(snapSpoolClean.actionRequired === 'PROCEED_TO_DISPATCH', 'actionRequired is PROCEED_TO_DISPATCH');

    // ── SECTION 4: Unified Safe Recovery State Machine ──────────────────────────
    console.log('\n--- SECTION 4: Unified Safe Recovery State Machine ---');

    // Test priority ranking: Payment ambiguity trumps all
    const snapUnifiedPaymentAmbiguity = evaluateSafeRecovery({
        draft: sampleFreshDraft,
        payment: {
            orderId: 'ord-301',
            orderStatus: 'PENDING',
            paymentStatus: 'pending',
            gatewayTransactionStatus: 'timeout',
        },
        printing: {
            orderId: 'ord-301',
            orderPaymentStatus: 'pending',
        },
    });
    assert(snapUnifiedPaymentAmbiguity.hasBlockingUnknownOutcome === true, 'Ambiguous payment outcome sets hasBlockingUnknownOutcome to true');
    assert(snapUnifiedPaymentAmbiguity.recommendedAction === 'VERIFY_PAYMENT_OUTCOME', 'Ambiguous payment is highest priority action');

    // Test priority ranking: Spooler ambiguity trumps draft
    const snapUnifiedSpoolAmbiguity = evaluateSafeRecovery({
        draft: sampleFreshDraft,
        payment: {
            orderId: 'ord-302',
            orderStatus: 'PAID',
            paymentStatus: 'paid',
        },
        printing: {
            orderId: 'ord-302',
            orderPaymentStatus: 'paid',
            lastSubmissionAttempt: {
                timestamp: now - 5000,
                outcome: 'timeout',
            },
        },
    });
    assert(snapUnifiedSpoolAmbiguity.hasBlockingUnknownOutcome === true, 'Ambiguous spooler outcome sets hasBlockingUnknownOutcome to true');
    assert(snapUnifiedSpoolAmbiguity.recommendedAction === 'CHECK_SPOOLER', 'Ambiguous spooler is recommended action');

    // Test draft recovery recommendation when no ambiguities exist
    const snapUnifiedDraft = evaluateSafeRecovery({
        draft: sampleFreshDraft,
    });
    assert(snapUnifiedDraft.hasBlockingUnknownOutcome === false, 'No blocking outcome for healthy draft recovery');
    assert(snapUnifiedDraft.recommendedAction === 'RESTORE_DRAFT', 'Restores draft when no pending transactions');

    // ── SECTION 5: Cross-Application Static Wiring Verification ─────────────────
    console.log('\n--- SECTION 5: Static Code & DOM Wiring Verification ---');

    const sharedRecoveryPath = path.resolve(process.cwd(), 'packages/shared/src/recovery.ts');
    const webLibRecoveryPath = path.resolve(process.cwd(), 'src/lib/recovery.ts');
    const desktopHtmlPath = path.resolve(process.cwd(), 'apps/desktop/index.html');
    const desktopMainPath = path.resolve(process.cwd(), 'apps/desktop/src/main.ts');
    const customerPricingPagePath = path.resolve(process.cwd(), 'src/app/order/pricing/page.tsx');

    assert(fs.existsSync(sharedRecoveryPath), 'packages/shared/src/recovery.ts exists');
    assert(fs.existsSync(webLibRecoveryPath), 'src/lib/recovery.ts bridge exists');

    const htmlContent = fs.readFileSync(desktopHtmlPath, 'utf-8');
    assert(htmlContent.includes('id="modal-recovery-warning-card"'), 'Modal recovery warning card exists in desktop HTML');
    assert(htmlContent.includes('id="modal-recovery-title"'), 'Modal recovery title element exists in desktop HTML');
    assert(htmlContent.includes('id="modal-recovery-message"'), 'Modal recovery message element exists in desktop HTML');
    assert(htmlContent.includes('id="modal-btn-recovery-inspect"'), 'Modal inspect spooler button exists in desktop HTML');

    const mainContent = fs.readFileSync(desktopMainPath, 'utf-8');
    assert(mainContent.includes('evaluatePrintRetrySafety'), 'main.ts imports evaluatePrintRetrySafety');
    assert(mainContent.includes('modal-recovery-warning-card'), 'main.ts manages modal-recovery-warning-card');
    assert(mainContent.includes('__xerserviceEvaluatePrintRetrySafety'), 'main.ts exports __xerserviceEvaluatePrintRetrySafety test hook');

    const pricingContent = fs.readFileSync(customerPricingPagePath, 'utf-8');
    assert(pricingContent.includes('saveLocalOrderDraft'), 'pricing page imports saveLocalOrderDraft');
    assert(pricingContent.includes('clearLocalOrderDraft'), 'pricing page imports clearLocalOrderDraft');
    assert(pricingContent.includes('evaluatePaymentRetrySafety'), 'pricing page imports evaluatePaymentRetrySafety');

    // ── SECTION 6: Financial Baseline Invariant Certification ──────────────────
    console.log('\n--- SECTION 6: Financial Baseline Invariant Certification ---');

    const finalInvariants = await getBaselineInvariants(sb);
    console.log(`  Final Invariants:    ledger=${finalInvariants.ledgerCount}, wallets=₹${finalInvariants.walletSum}, rules=${finalInvariants.rulesCount}, batches=${finalInvariants.batchCount}, items=${finalInvariants.itemCount}`);

    assert(finalInvariants.ledgerCount === baseline.ledgerCount, `Financial ledger count invariant preserved (=${baseline.ledgerCount})`);
    assert(finalInvariants.walletSum === baseline.walletSum, `Customer & Vendor wallet balances invariant preserved (=₹${baseline.walletSum.toFixed(2)})`);
    assert(finalInvariants.rulesCount === baseline.rulesCount, `Commission rules count invariant preserved (=${baseline.rulesCount})`);
    assert(finalInvariants.batchCount === baseline.batchCount, `Vendor settlement batches invariant preserved (=${baseline.batchCount})`);
    assert(finalInvariants.itemCount === baseline.itemCount, `Vendor settlement items invariant preserved (=${baseline.itemCount})`);

    assert(finalInvariants.ledgerCount === 17, 'Zero financial delta in order_financial_ledger');
    assert(finalInvariants.walletSum === 88.00, 'Zero financial delta in wallet_accounts balance');
    assert(finalInvariants.rulesCount === 2, 'Zero financial delta in shop_commission_rules');
    assert(finalInvariants.batchCount === 1, 'Zero financial delta in vendor_settlement_batches');
    assert(finalInvariants.itemCount === 4, 'Zero financial delta in vendor_settlement_items');

    // ── Summary ───────────────────────────────────────────────────────────────
    console.log('\n========================================================================');
    console.log(`ACCEPTANCE SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log('========================================================================\n');

    if (failed > 0) process.exit(1);
}

main().catch(err => {
    console.error('Fatal test runner error:', err);
    process.exit(1);
});

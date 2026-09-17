/**
 * Acceptance Test Suite for Priority 6: Honest Hardware Connectivity
 *
 * Verifies that XerService provides honest, non-deceptive, granular hardware diagnostics
 * separating 6 distinct operational stages:
 * 1. BACKEND_CONNECTED: REST/WS reachability between desktop/web client and central API.
 * 2. DATA_CURRENT: Queue sync freshness against PostgreSQL (fresh vs stale cached state; 60s threshold).
 * 3. PRINTER_DETECTED: OS/CUPS driver enumeration of physical or virtual printers.
 * 4. PRINTER_READY: Hardware readiness of target printer (online, idle, zero jams, paper loaded).
 * 5. JOB_SUBMITTED: Document payload spooled into the native host OS print spooler.
 * 6. JOB_FINISHED: Native spooler & hardware confirm physical output has reached the exit tray.
 *
 * Ensures remote database baseline invariants are preserved with 0 delta.
 */

import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

// Import pure connectivity engine directly
import {
    evaluateHonestConnectivity,
} from '../packages/shared/src/connectivity.ts';

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
    console.log('PRIORITY 6 ACCEPTANCE SUITE: HONEST HARDWARE CONNECTIVITY');
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

    // ── SECTION 1: Pure Connectivity Engine Tests (6 Discrete Layers) ───────────
    console.log('\n--- SECTION 1: Connectivity Engine Layer Discrimination ---');

    const now = Date.now();

    // 1. BACKEND_CONNECTED layer
    const snapBackendOnline = evaluateHonestConnectivity({
        isBackendReachable: true,
        backendLatencyMs: 25,
        detectedPrintersCount: 1,
    });
    assert(snapBackendOnline.backendConnected.status === 'CONNECTED', 'Backend connected status is CONNECTED');
    assert(snapBackendOnline.backendConnected.isOk === true, 'Backend connected isOk is true');
    assert(snapBackendOnline.backendConnected.label.includes('25ms'), 'Backend connected label displays latency');

    const snapBackendOffline = evaluateHonestConnectivity({
        isBackendReachable: false,
        detectedPrintersCount: 1,
    });
    assert(snapBackendOffline.backendConnected.status === 'DISCONNECTED', 'Backend disconnected status is DISCONNECTED');
    assert(snapBackendOffline.backendConnected.isOk === false, 'Backend disconnected isOk is false');
    assert(snapBackendOffline.backendConnected.label.toLowerCase().includes('offline'), 'Backend disconnected label indicates Offline');

    // 2. DATA_CURRENT layer
    const snapDataFresh = evaluateHonestConnectivity({
        isBackendReachable: true,
        lastSyncTimestamp: now - 5000,
        isSyncing: false,
        staleThresholdSeconds: 60,
    });
    assert(snapDataFresh.dataCurrent.status === 'CURRENT', 'Data within 60s is marked CURRENT');
    assert(snapDataFresh.dataCurrent.isOk === true, 'Data fresh isOk is true');

    const snapDataSyncing = evaluateHonestConnectivity({
        isBackendReachable: true,
        lastSyncTimestamp: now - 5000,
        isSyncing: true,
    });
    assert(snapDataSyncing.dataCurrent.status === 'SYNCING', 'In-flight sync is marked SYNCING');
    assert(snapDataSyncing.dataCurrent.isOk === true, 'Syncing isOk is true');
    assert(snapDataSyncing.dataCurrent.label.includes('Syncing'), 'Syncing label contains Syncing');

    const snapDataStale = evaluateHonestConnectivity({
        isBackendReachable: true,
        lastSyncTimestamp: now - 120000, // 2 minutes ago
        isSyncing: false,
        staleThresholdSeconds: 60,
    });
    assert(snapDataStale.dataCurrent.status === 'STALE', 'Data older than 60s is marked STALE');
    assert(snapDataStale.dataCurrent.isOk === false, 'Stale data isOk is false');
    assert(snapDataStale.dataCurrent.label.toLowerCase().includes('stale'), 'Stale data label contains Stale');

    const snapDataNever = evaluateHonestConnectivity({
        isBackendReachable: true,
        lastSyncTimestamp: null,
    });
    assert(snapDataNever.dataCurrent.status === 'UNINITIALIZED', 'Unsynced client is marked UNINITIALIZED');
    assert(snapDataNever.dataCurrent.isOk === false, 'UNINITIALIZED isOk is false');

    // 3. PRINTER_DETECTED layer
    const snapPrintersDetected = evaluateHonestConnectivity({
        detectedPrintersCount: 4,
    });
    assert(snapPrintersDetected.printerDetected.status === 'DETECTED', 'Detected count > 0 is marked DETECTED');
    assert(snapPrintersDetected.printerDetected.isOk === true, 'Printer detected isOk is true');
    assert(snapPrintersDetected.printerDetected.label.includes('4 Printers'), 'Printer detected label shows count');

    const snapSinglePrinter = evaluateHonestConnectivity({
        detectedPrintersCount: 1,
    });
    assert(snapSinglePrinter.printerDetected.label.includes('1 Printer Detected'), 'Singular printer detected label matches');

    const snapNoPrinters = evaluateHonestConnectivity({
        detectedPrintersCount: 0,
    });
    assert(snapNoPrinters.printerDetected.status === 'NOT_DETECTED', 'Zero detected is marked NOT_DETECTED');
    assert(snapNoPrinters.printerDetected.isOk === false, 'NOT_DETECTED isOk is false');
    assert(snapNoPrinters.printerDetected.label.includes('No Printers'), 'Zero detected label indicates No Printers');

    // 4. PRINTER_READY layer
    const snapPrinterReady = evaluateHonestConnectivity({
        detectedPrintersCount: 1,
        selectedPrinter: { id: 'p1', name: 'Canon ImageRunner', status: 'idle' },
    });
    assert(snapPrinterReady.printerReady.status === 'READY', 'Idle printer without errors is READY');
    assert(snapPrinterReady.printerReady.isOk === true, 'Printer ready isOk is true');
    assert(snapPrinterReady.printerReady.label.includes('Canon ImageRunner Ready'), 'Printer ready label contains printer name and Ready');

    const snapPrinterBusy = evaluateHonestConnectivity({
        detectedPrintersCount: 1,
        selectedPrinter: { id: 'p1', name: 'Canon ImageRunner', status: 'busy' },
    });
    assert(snapPrinterBusy.printerReady.status === 'READY', 'Busy printer is READY to accept prints');
    assert(snapPrinterBusy.printerReady.isOk === true, 'Busy printer isOk is true');
    assert(snapPrinterBusy.printerReady.label.includes('Printing'), 'Busy printer label contains Printing');

    const snapPrinterJam = evaluateHonestConnectivity({
        detectedPrintersCount: 1,
        selectedPrinter: { id: 'p1', name: 'Canon ImageRunner', status: 'paper-jam' },
    });
    assert(snapPrinterJam.printerReady.status === 'NOT_READY', 'Paper jam is marked NOT_READY');
    assert(snapPrinterJam.printerReady.isOk === false, 'Hardware error isOk is false');
    assert(snapPrinterJam.printerReady.label.includes('paper-jam'), 'Hardware error label specifies error details');

    const snapNoPrinterSelected = evaluateHonestConnectivity({
        detectedPrintersCount: 1,
        selectedPrinter: null,
    });
    assert(snapNoPrinterSelected.printerReady.status === 'NO_PRINTER_SELECTED', 'Unselected printer is NO_PRINTER_SELECTED');
    assert(snapNoPrinterSelected.printerReady.isOk === false, 'NO_PRINTER_SELECTED isOk is false');

    // 5. JOB_SUBMITTED layer
    const snapJobSubmitted = evaluateHonestConnectivity({
        activeJob: {
            localJobId: 'job-1',
            nativeJobId: 'CUPS-8841',
            submissionState: 'SUBMITTED',
            status: 'QUEUED',
        },
    });
    assert(snapJobSubmitted.jobSubmitted.status === 'SUBMITTED', 'Spooled job is marked SUBMITTED');
    assert(snapJobSubmitted.jobSubmitted.isOk === true, 'SUBMITTED isOk is true');
    assert(snapJobSubmitted.jobSubmitted.label.includes('CUPS-8841'), 'Submission label shows native spool job ID');

    const snapJobSubmitting = evaluateHonestConnectivity({
        activeJob: {
            submissionState: 'SUBMITTING',
            status: 'QUEUED',
        },
    });
    assert(snapJobSubmitting.jobSubmitted.status === 'SUBMITTING', 'Submitting job is marked SUBMITTING');
    assert(snapJobSubmitting.jobSubmitted.isOk === false, 'SUBMITTING isOk is false');

    const snapJobFailedSubmission = evaluateHonestConnectivity({
        activeJob: {
            submissionState: 'SUBMISSION_FAILED',
            status: 'FAILED',
            errorMessage: 'CUPS spooler rejected format',
        },
    });
    assert(snapJobFailedSubmission.jobSubmitted.status === 'SUBMISSION_FAILED', 'Failed submission is SUBMISSION_FAILED');
    assert(snapJobFailedSubmission.jobSubmitted.isOk === false, 'SUBMISSION_FAILED isOk is false');

    const snapJobNotSubmitted = evaluateHonestConnectivity({
        activeJob: null,
    });
    assert(snapJobNotSubmitted.jobSubmitted.status === 'NOT_SUBMITTED', 'Null job is NOT_SUBMITTED');
    assert(snapJobNotSubmitted.jobSubmitted.isOk === false, 'NOT_SUBMITTED isOk is false');

    // 6. JOB_FINISHED layer
    const snapJobFinished = evaluateHonestConnectivity({
        activeJob: {
            nativeJobId: 'CUPS-8841',
            submissionState: 'SUBMITTED',
            status: 'COMPLETED',
            completedAt: new Date().toISOString(),
        },
    });
    assert(snapJobFinished.jobFinished.status === 'FINISHED', 'Completed native print job is FINISHED');
    assert(snapJobFinished.jobFinished.isOk === true, 'FINISHED isOk is true');
    assert(snapJobFinished.jobFinished.label.includes('Physical Output Ready'), 'FINISHED label confirms physical output ready');

    const snapJobInProgress = evaluateHonestConnectivity({
        activeJob: {
            nativeJobId: 'CUPS-8841',
            submissionState: 'SUBMITTED',
            status: 'PRINTING',
        },
    });
    assert(snapJobInProgress.jobFinished.status === 'IN_PROGRESS', 'Active printing job is IN_PROGRESS');
    assert(snapJobInProgress.jobFinished.isOk === false, 'IN_PROGRESS isOk is false');
    assert(snapJobInProgress.jobFinished.label.includes('Printing in Progress'), 'IN_PROGRESS label confirms spooling');

    const snapJobHardwareFailed = evaluateHonestConnectivity({
        activeJob: {
            nativeJobId: 'CUPS-8841',
            submissionState: 'SUBMITTED',
            status: 'FAILED',
            errorMessage: 'Printer head overheat',
        },
    });
    assert(snapJobHardwareFailed.jobFinished.status === 'FAILED', 'Failed job is FAILED');
    assert(snapJobHardwareFailed.jobFinished.isOk === false, 'FAILED isOk is false');
    assert(snapJobHardwareFailed.jobFinished.label.includes('Print Hardware Failure'), 'FAILED label warns of print failure');

    // ── SECTION 2: Actionable Diagnostics Generation ────────────────────────────
    console.log('\n--- SECTION 2: Actionable Troubleshooting Diagnostics ---');

    const fullFailSnap = evaluateHonestConnectivity({
        isBackendReachable: false,
        lastSyncTimestamp: now - 300000,
        detectedPrintersCount: 0,
        activeJob: {
            submissionState: 'SUBMISSION_FAILED',
            errorMessage: 'Native spooler unavailable',
        },
    });

    assert(fullFailSnap.troubleshooting.length >= 3, 'Multiple diagnostics generated for multiple failure modes');
    assert(fullFailSnap.troubleshooting.some(t => t.toLowerCase().includes('central backend api unreachable')), 'Diagnoses backend unreachability');
    assert(fullFailSnap.troubleshooting.some(t => t.toLowerCase().includes('stale')), 'Diagnoses queue staleness');
    assert(fullFailSnap.troubleshooting.some(t => t.toLowerCase().includes('no printers detected')), 'Diagnoses missing native printers');
    assert(fullFailSnap.troubleshooting.some(t => t.toLowerCase().includes('spool submission failed')), 'Diagnoses spool submission failure');

    const allHealthySnap = evaluateHonestConnectivity({
        isBackendReachable: true,
        backendLatencyMs: 15,
        lastSyncTimestamp: now - 2000,
        isSyncing: false,
        detectedPrintersCount: 2,
        selectedPrinter: { id: 'p1', name: 'Office Jet Pro', status: 'idle' },
        activeJob: {
            nativeJobId: '101',
            submissionState: 'SUBMITTED',
            status: 'COMPLETED',
        },
    });
    assert(allHealthySnap.troubleshooting.length === 0, 'No diagnostics when all layers are healthy');
    assert(allHealthySnap.overallHealthy === true, 'overallHealthy is true when all 6 layers are sound');

    // ── SECTION 3: Static Desktop Shell Wiring Verification ─────────────────────
    console.log('\n--- SECTION 3: Desktop Shell HUD Elements & Code Hooks ---');

    const desktopHtmlPath = path.resolve(process.cwd(), 'apps/desktop/index.html');
    const desktopMainPath = path.resolve(process.cwd(), 'apps/desktop/src/main.ts');

    const html = fs.readFileSync(desktopHtmlPath, 'utf-8');
    assert(html.includes('id="header-conn-indicator"'), 'Header backend connection indicator present in desktop HTML');
    assert(html.includes('id="header-conn-status-text"'), 'Header backend text present in desktop HTML');
    assert(html.includes('id="header-data-indicator"'), 'Header data freshness indicator present in desktop HTML');
    assert(html.includes('id="header-data-status-text"'), 'Header data text present in desktop HTML');
    assert(html.includes('id="printer-indicator"'), 'Printer discovery indicator present in desktop HTML');
    assert(html.includes('id="printer-status-label"'), 'Printer discovery label present in desktop HTML');
    assert(html.includes('id="header-ready-indicator"'), 'Printer readiness indicator present in desktop HTML');
    assert(html.includes('id="header-ready-status-text"'), 'Printer readiness text present in desktop HTML');
    assert(html.includes('id="modal-honest-connectivity-group"'), 'Modal honest connectivity group present in desktop HTML');
    assert(html.includes('id="modal-spool-submitted-badge"'), 'Modal spool submitted badge present in desktop HTML');
    assert(html.includes('id="modal-spool-finished-badge"'), 'Modal spool finished badge present in desktop HTML');
    assert(html.includes('id="modal-hardware-troubleshooting"'), 'Modal troubleshooting container present in desktop HTML');

    const main = fs.readFileSync(desktopMainPath, 'utf-8');
    assert(main.includes('evaluateHonestConnectivity'), 'main.ts imports evaluateHonestConnectivity');
    assert(main.includes('function ui_updateHonestConnectivityHud'), 'main.ts defines ui_updateHonestConnectivityHud');
    assert(main.includes('async function ui_checkBackendHealth'), 'main.ts defines ui_checkBackendHealth');
    assert(main.includes('__xerserviceUpdateHonestConnectivityHud'), 'main.ts exports __xerserviceUpdateHonestConnectivityHud');
    assert(main.includes('__xerserviceEvaluateHonestConnectivity'), 'main.ts exports __xerserviceEvaluateHonestConnectivity');
    assert(main.includes('__xerserviceCheckBackendHealth'), 'main.ts exports __xerserviceCheckBackendHealth');

    // ── SECTION 4: Architecture Bridge & API Route Verification ────────────────
    console.log('\n--- SECTION 4: Architecture Bridge & API Verification ---');

    const sharedConnectivityPath = path.resolve(process.cwd(), 'packages/shared/src/connectivity.ts');
    const webLibConnectivityPath = path.resolve(process.cwd(), 'src/lib/connectivity.ts');
    const healthRoutePath = path.resolve(process.cwd(), 'src/app/api/health/route.ts');

    assert(fs.existsSync(sharedConnectivityPath), 'packages/shared/src/connectivity.ts exists');
    assert(fs.existsSync(webLibConnectivityPath), 'src/lib/connectivity.ts bridge exists');
    assert(fs.existsSync(healthRoutePath), 'src/app/api/health/route.ts exists');

    const healthContent = fs.readFileSync(healthRoutePath, 'utf-8');
    assert(healthContent.includes('status') && healthContent.includes('ok'), 'Health route returns status ok');

    // ── SECTION 5: Financial Baseline Invariant Certification ──────────────────
    console.log('\n--- SECTION 5: Financial Baseline Invariant Certification ---');

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

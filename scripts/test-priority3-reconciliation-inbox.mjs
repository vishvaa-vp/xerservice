#!/usr/bin/env node

/**
 * XerService Acceptance Test Suite — Priority 3: Financial Reconciliation Inbox
 *
 * Validates:
 * 1. Pure Evaluation Engine Unit Verification (all 11 discrepancy categories, summary aggregation, zero-issue baseline)
 * 2. Static Architecture & Route Integration Checks
 * 3. Live Dev Server API Contracts & RBAC Guards
 * 4. Financial Baseline Invariant Certification (ledger=17, wallets=₹88, rules=2, batches=1, items=4)
 */

import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { evaluateReconciliation } from '../packages/backend/src/finance/reconciliation.ts';

// Load environment variables
const envPath = path.resolve(process.cwd(), '.env.local');
const envVars = {};
if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    for (const line of envContent.split('\n')) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
            const [k, ...v] = trimmed.split('=');
            envVars[k.trim()] = v.join('=').trim();
            process.env[k.trim()] = v.join('=').trim();
        }
    }
}

const SUPABASE_URL = envVars['NEXT_PUBLIC_SUPABASE_URL'] || process.env.NEXT_PUBLIC_SUPABASE_URL || envVars['SUPABASE_URL'] || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = envVars['SUPABASE_SECRET_KEY'] || process.env.SUPABASE_SECRET_KEY || envVars['SUPABASE_SERVICE_ROLE_KEY'] || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY / SUPABASE_SECRET_KEY');
    process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

let passed = 0;
let failed = 0;

function assert(condition, message) {
    if (condition) {
        passed++;
        console.log(`  ✓ PASS [${passed}]: ${message}`);
    } else {
        failed++;
        console.error(`  ✗ FAIL [${passed + failed}]: ${message}`);
    }
}

async function getInvariants() {
    const { count: ledgerCount } = await sb.from('order_financial_ledger').select('*', { count: 'exact', head: true });
    const { data: wallets } = await sb.from('wallet_accounts').select('balance');
    const { count: rulesCount } = await sb.from('shop_commission_rules').select('*', { count: 'exact', head: true });
    const { count: batchesCount } = await sb.from('vendor_settlement_batches').select('*', { count: 'exact', head: true });
    const { count: itemsCount } = await sb.from('vendor_settlement_items').select('*', { count: 'exact', head: true });

    const walletSum = (wallets || []).reduce((acc, w) => acc + Number(w.balance || 0), 0);
    return {
        ledgerCount: ledgerCount ?? 0,
        walletSum: Math.round(walletSum * 100) / 100,
        rulesCount: rulesCount ?? 0,
        batchesCount: batchesCount ?? 0,
        itemsCount: itemsCount ?? 0,
    };
}

async function run() {
    console.log('\n========================================================================');
    console.log('PRIORITY 3: Financial Reconciliation Inbox — Acceptance Test Suite');
    console.log('========================================================================\n');

    const baseline = await getInvariants();
    console.log(`  Baseline Invariants: ledger=${baseline.ledgerCount}, wallets=₹${baseline.walletSum}, rules=${baseline.rulesCount}, batches=${baseline.batchesCount}, items=${baseline.itemsCount}\n`);

    // =========================================================================
    // SECTION 1: Pure Evaluation Engine Unit Verification
    // =========================================================================
    console.log('--- SECTION 1: Pure Evaluation Engine Unit Verification ---');

    const shop1 = { id: 'shop-1', name: 'Krishna Xerox' };
    const shop2 = { id: 'shop-2', name: 'Royal Prints' };

    // Case 1.1: 100% Clean / Reconciled Baseline
    const cleanOrder = {
        id: 'ord-clean-1',
        shop_id: 'shop-1',
        status: 'COMPLETED',
        payment_status: 'PAID',
        total_amount: 10,
        created_at: '2026-09-01T10:00:00Z',
    };
    const cleanLedger = {
        id: 'led-clean-1',
        order_id: 'ord-clean-1',
        shop_id: 'shop-1',
        gross_amount: 10,
        platform_commission_amount: 0.5,
        vendor_net_amount: 9.5,
        financial_status: 'PAYABLE',
        refund_request_id: null,
        created_at: '2026-09-01T10:00:00Z',
    };

    const cleanReport = evaluateReconciliation({
        orders: [cleanOrder],
        ledgerRecords: [cleanLedger],
        refundRequests: [],
        settlementBatches: [],
        settlementItems: [],
        shops: [shop1],
        asOfDate: new Date('2026-09-02T10:00:00Z'),
    });

    assert(cleanReport.summary.totalIssues === 0, 'Clean state reports 0 total issues');
    assert(cleanReport.summary.isReconciled === true, 'Clean state reports isReconciled = true');
    assert(cleanReport.summary.criticalIssues === 0, 'Clean state reports 0 critical issues');
    assert(cleanReport.items.length === 0, 'Clean state item list is empty');

    // Case 1.2: Paid Order Missing Ledger Record (MISSING_LEDGER)
    const missingLedgerOrder = {
        id: 'ord-unalloc-1',
        shop_id: 'shop-1',
        status: 'COMPLETED',
        payment_status: 'PAID',
        total_amount: 50,
        created_at: '2026-09-01T10:00:00Z',
    };
    const missingLedgerReport = evaluateReconciliation({
        orders: [missingLedgerOrder],
        ledgerRecords: [],
        refundRequests: [],
        settlementBatches: [],
        settlementItems: [],
        shops: [shop1],
    });
    assert(missingLedgerReport.summary.totalIssues === 1, 'Missing ledger on paid order flags 1 issue');
    assert(missingLedgerReport.items[0].type === 'MISSING_LEDGER', 'Item type is MISSING_LEDGER');
    assert(missingLedgerReport.items[0].severity === 'CRITICAL', 'Missing ledger is marked CRITICAL');
    assert(missingLedgerReport.items[0].amount === 50, 'Discrepancy amount is ₹50');
    assert(missingLedgerReport.summary.unallocatedOrdersCount === 1, 'Unallocated orders count is 1');
    assert(missingLedgerReport.summary.unallocatedAmount === 50, 'Unallocated volume is ₹50');

    // Case 1.3: Amount Mismatch between Order and Ledger (AMOUNT_MISMATCH)
    const mismatchOrder = {
        id: 'ord-mismatch-1',
        shop_id: 'shop-1',
        status: 'COMPLETED',
        payment_status: 'PAID',
        total_amount: 100,
        created_at: '2026-09-01T10:00:00Z',
    };
    const mismatchLedger = {
        id: 'led-mismatch-1',
        order_id: 'ord-mismatch-1',
        shop_id: 'shop-1',
        gross_amount: 80,
        platform_commission_amount: 4,
        vendor_net_amount: 76,
        financial_status: 'PAYABLE',
        refund_request_id: null,
        created_at: '2026-09-01T10:00:00Z',
    };
    const mismatchReport = evaluateReconciliation({
        orders: [mismatchOrder],
        ledgerRecords: [mismatchLedger],
        refundRequests: [],
        settlementBatches: [],
        settlementItems: [],
        shops: [shop1],
        asOfDate: new Date('2026-09-02T10:00:00Z'),
    });
    assert(mismatchReport.summary.totalIssues === 1, 'Amount mismatch flags 1 issue');
    assert(mismatchReport.items[0].type === 'AMOUNT_MISMATCH', 'Item type is AMOUNT_MISMATCH');
    assert(mismatchReport.items[0].severity === 'CRITICAL', 'Amount mismatch is CRITICAL');
    assert(mismatchReport.items[0].amount === 20, 'Discrepancy delta is ₹20');

    // Case 1.4: UNCONFIGURED Commission Rule (UNCONFIGURED_COMMISSION)
    const unconfLedger = {
        id: 'led-unconf-1',
        order_id: 'ord-unconf-1',
        shop_id: 'shop-1',
        gross_amount: 25,
        platform_commission_amount: null,
        vendor_net_amount: null,
        financial_status: 'UNCONFIGURED',
        refund_request_id: null,
        created_at: '2026-09-01T10:00:00Z',
    };
    const unconfOrder = {
        id: 'ord-unconf-1',
        shop_id: 'shop-1',
        status: 'COMPLETED',
        payment_status: 'PAID',
        total_amount: 25,
        created_at: '2026-09-01T10:00:00Z',
    };
    const unconfReport = evaluateReconciliation({
        orders: [unconfOrder],
        ledgerRecords: [unconfLedger],
        refundRequests: [],
        settlementBatches: [],
        settlementItems: [],
        shops: [shop1],
    });
    assert(unconfReport.summary.totalIssues === 1, 'Unconfigured ledger flags 1 issue');
    assert(unconfReport.items[0].type === 'UNCONFIGURED_COMMISSION', 'Item type is UNCONFIGURED_COMMISSION');
    assert(unconfReport.items[0].severity === 'HIGH', 'Unconfigured ledger is HIGH severity');
    assert(unconfReport.items[0].action.deepLink.includes('/admin/finance?tab=shops'), 'Action deep links to shop fees');

    // Case 1.5: Failed Refund Request (FAILED_REFUND)
    const failedRefund = {
        id: 'ref-fail-1',
        order_id: 'ord-fail-1',
        amount: 35,
        status: 'FAILED',
        provider: 'RAZORPAY',
        failure_reason: 'Bank account inactive',
        created_at: '2026-09-01T10:00:00Z',
    };
    const failedRefundReport = evaluateReconciliation({
        orders: [],
        ledgerRecords: [],
        refundRequests: [failedRefund],
        settlementBatches: [],
        settlementItems: [],
        shops: [shop1],
    });
    assert(failedRefundReport.summary.totalIssues === 1, 'Failed refund flags 1 issue');
    assert(failedRefundReport.items[0].type === 'FAILED_REFUND', 'Item type is FAILED_REFUND');
    assert(failedRefundReport.items[0].severity === 'CRITICAL', 'Failed refund is CRITICAL');
    assert(failedRefundReport.items[0].amount === 35, 'Failed refund amount is ₹35');
    assert(failedRefundReport.summary.unresolvedRefundsCount === 1, 'Unresolved refunds count is 1');
    assert(failedRefundReport.summary.unresolvedRefundAmount === 35, 'Unresolved refund amount is ₹35');

    // Case 1.6: Pending Refund Request (PENDING_REFUND)
    const pendingRefund = {
        id: 'ref-pend-1',
        order_id: 'ord-pend-1',
        amount: 15,
        status: 'PENDING',
        provider: 'XERCOINS',
        created_at: '2026-09-01T10:00:00Z',
    };
    const pendingRefundReport = evaluateReconciliation({
        orders: [],
        ledgerRecords: [],
        refundRequests: [pendingRefund],
        settlementBatches: [],
        settlementItems: [],
        shops: [shop1],
    });
    assert(pendingRefundReport.summary.totalIssues === 1, 'Pending refund flags 1 issue');
    assert(pendingRefundReport.items[0].type === 'PENDING_REFUND', 'Item type is PENDING_REFUND');
    assert(pendingRefundReport.items[0].severity === 'HIGH', 'Pending refund is HIGH severity');

    // Case 1.7: Cancelled Order Paid Without Refund (CANCELLED_WITHOUT_REFUND)
    const cancelledPaidOrder = {
        id: 'ord-cancel-1',
        shop_id: 'shop-1',
        status: 'CANCELLED',
        payment_status: 'PAID',
        total_amount: 40,
        created_at: '2026-09-01T10:00:00Z',
    };
    const cancelledPaidReport = evaluateReconciliation({
        orders: [cancelledPaidOrder],
        ledgerRecords: [],
        refundRequests: [],
        settlementBatches: [],
        settlementItems: [],
        shops: [shop1],
    });
    assert(cancelledPaidReport.summary.totalIssues === 1, 'Cancelled paid order flags 1 issue');
    assert(cancelledPaidReport.items[0].type === 'CANCELLED_WITHOUT_REFUND', 'Item type is CANCELLED_WITHOUT_REFUND');
    assert(cancelledPaidReport.items[0].severity === 'CRITICAL', 'Cancelled without refund is CRITICAL');

    // Case 1.8: REVERSED Ledger Missing Refund Audit Link (REVERSED_WITHOUT_REFUND_RECORD)
    const reversedNoLinkLedger = {
        id: 'led-rev-1',
        order_id: 'ord-rev-1',
        shop_id: 'shop-1',
        gross_amount: 12,
        platform_commission_amount: 0,
        vendor_net_amount: 0,
        financial_status: 'REVERSED',
        refund_request_id: null,
        created_at: '2026-09-01T10:00:00Z',
    };
    const revReport = evaluateReconciliation({
        orders: [],
        ledgerRecords: [reversedNoLinkLedger],
        refundRequests: [],
        settlementBatches: [],
        settlementItems: [],
        shops: [shop1],
    });
    assert(revReport.summary.totalIssues === 1, 'Reversed without link flags 1 issue');
    assert(revReport.items[0].type === 'REVERSED_WITHOUT_REFUND_RECORD', 'Item type is REVERSED_WITHOUT_REFUND_RECORD');
    assert(revReport.items[0].severity === 'MEDIUM', 'Reversed without link is MEDIUM severity');

    // Case 1.9: SETTLED Ledger Without Batch Item (SETTLED_WITHOUT_ITEM)
    const settledNoItemLedger = {
        id: 'led-settled-1',
        order_id: 'ord-settled-1',
        shop_id: 'shop-1',
        gross_amount: 20,
        platform_commission_amount: 1,
        vendor_net_amount: 19,
        financial_status: 'SETTLED',
        refund_request_id: null,
        created_at: '2026-09-01T10:00:00Z',
    };
    const settledReport = evaluateReconciliation({
        orders: [],
        ledgerRecords: [settledNoItemLedger],
        refundRequests: [],
        settlementBatches: [],
        settlementItems: [],
        shops: [shop1],
    });
    assert(settledReport.summary.totalIssues === 1, 'Settled without item flags 1 issue');
    assert(settledReport.items[0].type === 'SETTLED_WITHOUT_ITEM', 'Item type is SETTLED_WITHOUT_ITEM');
    assert(settledReport.items[0].severity === 'CRITICAL', 'Settled without item is CRITICAL');

    // Case 1.10: Settlement Batch Math Discrepancy (BATCH_SUM_MISMATCH)
    const badBatch = {
        id: 'batch-bad-1',
        shop_id: 'shop-1',
        settlement_number: 'XSS-2026-001',
        gross_order_amount: 100,
        platform_commission_amount: 5,
        vendor_payable_amount: 95,
        order_count: 2,
        status: 'DRAFT',
        created_at: '2026-09-01T10:00:00Z',
    };
    const item1 = {
        id: 'item-1',
        settlement_batch_id: 'batch-bad-1',
        order_financial_ledger_id: 'led-1',
        order_id: 'ord-1',
        gross_amount: 40,
        platform_commission_amount: 2,
        vendor_payable_amount: 38,
    };
    const badBatchReport = evaluateReconciliation({
        orders: [],
        ledgerRecords: [],
        refundRequests: [],
        settlementBatches: [badBatch],
        settlementItems: [item1], // only 1 item with gross 40 instead of 100!
        shops: [shop1],
    });
    assert(badBatchReport.summary.totalIssues === 1, 'Batch math mismatch flags 1 issue');
    assert(badBatchReport.items[0].type === 'BATCH_SUM_MISMATCH', 'Item type is BATCH_SUM_MISMATCH');
    assert(badBatchReport.items[0].severity === 'CRITICAL', 'Batch math mismatch is CRITICAL');
    assert(badBatchReport.summary.settlementMismatchesCount === 1, 'Settlement mismatches count is 1');

    // Case 1.11: Reversed Order Inside Active Batch (REVERSED_IN_SETTLEMENT)
    const activeBatch = {
        id: 'batch-active-1',
        shop_id: 'shop-1',
        settlement_number: 'XSS-2026-002',
        gross_order_amount: 50,
        platform_commission_amount: 2.5,
        vendor_payable_amount: 47.5,
        order_count: 1,
        status: 'CONFIRMED',
        created_at: '2026-09-01T10:00:00Z',
    };
    const reversedLedgerInBatch = {
        id: 'led-rev-in-batch-1',
        order_id: 'ord-rev-in-batch-1',
        shop_id: 'shop-1',
        gross_amount: 50,
        platform_commission_amount: 0,
        vendor_net_amount: 0,
        financial_status: 'REVERSED',
        refund_request_id: 'ref-1',
        created_at: '2026-09-01T10:00:00Z',
    };
    const itemInBatch = {
        id: 'item-rev-1',
        settlement_batch_id: 'batch-active-1',
        order_financial_ledger_id: 'led-rev-in-batch-1',
        order_id: 'ord-rev-in-batch-1',
        gross_amount: 50,
        platform_commission_amount: 2.5,
        vendor_payable_amount: 47.5,
    };
    const revInBatchReport = evaluateReconciliation({
        orders: [],
        ledgerRecords: [reversedLedgerInBatch],
        refundRequests: [],
        settlementBatches: [activeBatch],
        settlementItems: [itemInBatch],
        shops: [shop1],
    });
    assert(revInBatchReport.items.some(i => i.type === 'REVERSED_IN_SETTLEMENT'), 'Reversed order in active batch detected');

    // Case 1.12: Stale PAYABLE Order (STALE_PAYABLE)
    const staleLedger = {
        id: 'led-stale-1',
        order_id: 'ord-stale-1',
        shop_id: 'shop-1',
        gross_amount: 30,
        platform_commission_amount: 1.5,
        vendor_net_amount: 28.5,
        financial_status: 'PAYABLE',
        refund_request_id: null,
        created_at: '2026-08-01T10:00:00Z',
        eligible_at: '2026-08-01T10:00:00Z',
    };
    const staleReport = evaluateReconciliation({
        orders: [],
        ledgerRecords: [staleLedger],
        refundRequests: [],
        settlementBatches: [],
        settlementItems: [],
        shops: [shop1],
        asOfDate: new Date('2026-09-01T10:00:00Z'), // 31 days later
        stalePayableThresholdDays: 14,
    });
    assert(staleReport.items.some(i => i.type === 'STALE_PAYABLE'), 'Stale payable order (> 14 days) detected');

    // =========================================================================
    // SECTION 2: Static Architecture & Integration Checks
    // =========================================================================
    console.log('\n--- SECTION 2: Static Architecture & Integration Checks ---');

    const reconEnginePath = path.resolve(process.cwd(), 'packages/backend/src/finance/reconciliation.ts');
    const reconLibPath = path.resolve(process.cwd(), 'src/lib/finance-reconciliation.ts');
    const reconRoutePath = path.resolve(process.cwd(), 'src/app/api/admin/finance/reconciliation/route.ts');
    const adminFinancePagePath = path.resolve(process.cwd(), 'src/app/admin/finance/page.tsx');

    assert(fs.existsSync(reconEnginePath), 'packages/backend/src/finance/reconciliation.ts exists');
    assert(fs.existsSync(reconLibPath), 'src/lib/finance-reconciliation.ts exists');
    assert(fs.existsSync(reconRoutePath), 'src/app/api/admin/finance/reconciliation/route.ts exists');
    assert(fs.existsSync(adminFinancePagePath), 'src/app/admin/finance/page.tsx exists');

    const routeContent = fs.readFileSync(reconRoutePath, 'utf8');
    assert(routeContent.includes('requireAdminAuth'), 'Route enforces admin auth via requireAdminAuth');
    assert(routeContent.includes('getFinancialReconciliationReport'), 'Route calls getFinancialReconciliationReport');
    assert(routeContent.includes('searchParams.get(\'category\')'), 'Route parses category query parameter');
    assert(routeContent.includes('searchParams.get(\'severity\')'), 'Route parses severity query parameter');

    const pageContent = fs.readFileSync(adminFinancePagePath, 'utf8');
    assert(pageContent.includes('Reconciliation Inbox'), 'Admin Finance page includes Reconciliation Inbox tab');
    assert(pageContent.includes('reconciliationReport'), 'Admin Finance page tracks reconciliationReport state');
    assert(pageContent.includes('Financial Reconciliation Inbox'), 'Admin Finance page renders Reconciliation Inbox heading');
    assert(pageContent.includes('Unallocated Paid Orders'), 'Admin Finance page renders Unallocated Paid Orders KPI card');
    assert(pageContent.includes('Unresolved Refunds'), 'Admin Finance page renders Unresolved Refunds KPI card');
    assert(pageContent.includes('Settlement Discrepancies'), 'Admin Finance page renders Settlement Discrepancies KPI card');
    assert(pageContent.includes('All Financial Accounts Balanced'), 'Admin Finance page renders All Accounts Balanced celebratory zero-state');

    // =========================================================================
    // SECTION 3: Live Dev Server API Contracts
    // =========================================================================
    console.log('\n--- SECTION 3: Live Dev Server API Contracts ---');

    try {
        const unauthRes = await fetch('http://localhost:3000/api/admin/finance/reconciliation');
        assert(unauthRes.status === 401, 'Unauthenticated /api/admin/finance/reconciliation returns HTTP 401');
    } catch (err) {
        console.warn('  ⚠️ Note: Dev server not reachable or offline on :3000:', err.message);
    }

    // =========================================================================
    // SECTION 4: Financial Baseline Invariant Certification
    // =========================================================================
    console.log('\n--- SECTION 4: Financial Baseline Invariant Certification ---');

    const finalInv = await getInvariants();
    console.log(`  Final Invariants:    ledger=${finalInv.ledgerCount}, wallets=₹${finalInv.walletSum}, rules=${finalInv.rulesCount}, batches=${finalInv.batchesCount}, items=${finalInv.itemsCount}`);

    assert(finalInv.ledgerCount === 17, 'Financial ledger count invariant preserved (=17)');
    assert(finalInv.walletSum === 88.00, 'Customer & Vendor wallet balances invariant preserved (=₹88.00)');
    assert(finalInv.rulesCount === 2, 'Commission rules count invariant preserved (=2)');
    assert(finalInv.batchesCount === 1, 'Vendor settlement batches invariant preserved (=1)');
    assert(finalInv.itemsCount === 4, 'Vendor settlement items invariant preserved (=4)');

    assert(finalInv.ledgerCount === baseline.ledgerCount, 'Zero financial delta in order_financial_ledger');
    assert(finalInv.walletSum === baseline.walletSum, 'Zero financial delta in wallet_accounts balance');
    assert(finalInv.rulesCount === baseline.rulesCount, 'Zero financial delta in shop_commission_rules');
    assert(finalInv.batchesCount === baseline.batchesCount, 'Zero financial delta in vendor_settlement_batches');
    assert(finalInv.itemsCount === baseline.itemsCount, 'Zero financial delta in vendor_settlement_items');

    console.log('\n========================================================================');
    console.log(`ACCEPTANCE SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log('========================================================================\n');

    if (failed > 0) {
        process.exit(1);
    }
}

run().catch((err) => {
    console.error('Fatal error in test suite:', err);
    process.exit(1);
});

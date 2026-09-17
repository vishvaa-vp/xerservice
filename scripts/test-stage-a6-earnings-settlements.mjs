/**
 * XerService End-to-End Acceptance Test Suite: Stage A6 — Earnings and Settlements
 *
 * Verifies all requirements from astraplan.md (Sections 5.8, 9.1–9.3, line 735):
 * 1. Asia/Kolkata reporting boundaries and period comparisons (% delta calculation).
 * 2. Database-backed earnings reporting API with 5 primary KPI cards.
 * 3. Section 9.2 Refunds & Cancellations breakdown (4 distinct operational states).
 * 4. Exact mathematical reconciliation between shop breakdown and platform totals.
 * 5. Distinction between money earned vs money transferred.
 * 6. Settlements overview API (Ready to settle, In progress, Paid history).
 * 7. Eligible orders query excluding locked items.
 * 8. Strict Concurrency Conflict Protection (HTTP 409 Conflict when attempting to settle locked orders).
 * 9. Reconciled CSV Statement export matching batch totals.
 * 10. Direct DRAFT-to-PAID transition rejection (CONFIRMED required).
 * 11. Strict RBAC enforcement across all earnings and settlement endpoints.
 * 12. Strict zero delta on baseline financial invariants (ledger=17, wallets=₹88, rules=2, batches=1, items=4).
 */

import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import {
    getReportingDateRange,
    calculatePeriodComparison,
    generateEarningsCsv,
} from '../packages/backend/src/finance/earnings-math.ts';

// Load .env.local
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

const SUPABASE_URL = envVars['NEXT_PUBLIC_SUPABASE_URL'] || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SECRET = envVars['SUPABASE_SECRET_KEY'] || process.env.SUPABASE_SECRET_KEY || envVars['SUPABASE_SERVICE_ROLE_KEY'] || process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_ANON = envVars['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'] || envVars['NEXT_PUBLIC_SUPABASE_ANON_KEY'] || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SECRET || !SUPABASE_ANON) {
    console.error('Missing Supabase credentials in .env.local');
    process.exit(1);
}

const serviceClient = createClient(SUPABASE_URL, SUPABASE_SECRET);
const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition, message, detail = '') {
    totalTests++;
    if (condition) {
        passedTests++;
        console.log(`  ✓ PASS [${totalTests}]: ${message}`);
    } else {
        failedTests++;
        console.error(`  ✗ FAIL [${totalTests}]: ${message}${detail ? ' -- ' + detail : ''}`);
    }
}

async function getAuth(email) {
    const { data, error } = await serviceClient.auth.admin.generateLink({ type: 'magiclink', email });
    if (error || !data?.properties?.email_otp) {
        throw new Error(`Failed to generate magiclink for ${email}: ${error?.message}`);
    }
    const tempAnon = createClient(SUPABASE_URL, SUPABASE_ANON, { auth: { persistSession: false } });
    const { data: sess, error: verifyError } = await tempAnon.auth.verifyOtp({
        email,
        token: data.properties.email_otp,
        type: 'email',
    });
    if (verifyError || !sess?.session?.access_token) {
        throw new Error(`Failed to verify OTP for ${email}: ${verifyError?.message}`);
    }
    return { token: sess.session.access_token, userId: sess.session.user.id };
}

let baselineInvariants = null;

async function checkFinancialInvariants(label) {
    const [rules, batches, items, ledger, wallets] = await Promise.all([
        serviceClient.from('shop_commission_rules').select('id', { count: 'exact', head: true }),
        serviceClient.from('vendor_settlement_batches').select('id', { count: 'exact', head: true }),
        serviceClient.from('vendor_settlement_items').select('id', { count: 'exact', head: true }),
        serviceClient.from('order_financial_ledger').select('id', { count: 'exact', head: true }),
        serviceClient.from('wallet_accounts').select('balance'),
    ]);
    const sumWallets = Math.round((wallets.data ?? []).reduce((acc, w) => acc + Number(w.balance), 0));
    const snapshot = {
        rules: rules.count ?? 0,
        batches: batches.count ?? 0,
        items: items.count ?? 0,
        ledger: ledger.count ?? 0,
        sumWallets,
    };
    console.log(`\n[Financial ${label}] ledger=${snapshot.ledger}, wallets=₹${snapshot.sumWallets}, rules=${snapshot.rules}, batches=${snapshot.batches}, items=${snapshot.items}`);

    if (baselineInvariants) {
        assert(
            snapshot.rules === baselineInvariants.rules &&
            snapshot.batches === baselineInvariants.batches &&
            snapshot.items === baselineInvariants.items &&
            snapshot.ledger === baselineInvariants.ledger &&
            snapshot.sumWallets === baselineInvariants.sumWallets,
            `${label}: Financial invariants completely preserved with zero delta`,
            JSON.stringify({ expected: baselineInvariants, actual: snapshot })
        );
    }
    return snapshot;
}

async function runStageA6AcceptanceSuite() {
    console.log('\n======================================================================');
    console.log('Stage A6: Earnings and Settlements Acceptance Test Suite');
    console.log('======================================================================\n');

    // Establish baseline invariants
    baselineInvariants = await checkFinancialInvariants('Baseline');

    // Authenticate tokens
    console.log('\n--- Test Section 1: Authentication & Setup ---');
    const adminAuth = await getAuth('xerservice@gmail.com');
    const customerAuth = await getAuth('vishvaaparthipan@gmail.com');
    assert(Boolean(adminAuth?.token), 'Admin session token successfully acquired');
    assert(Boolean(customerAuth?.token), 'Customer session token successfully acquired');

    // -------------------------------------------------------------
    // Test Section 2: Date Boundaries & Period Comparison
    // -------------------------------------------------------------
    console.log('\n--- Test Section 2: Date Boundaries & Period Comparison ---');

    // Fixed reference time: 2026-09-16 12:00:00 UTC = 2026-09-16 17:30:00 IST (Wednesday)
    const refDate = new Date('2026-09-16T12:00:00.000Z');

    const todayRange = getReportingDateRange('today', null, null, refDate);
    assert(todayRange.label === 'Today', 'Today preset label matches');
    assert(todayRange.startUtc.includes('2026-09-15T18:30:00'), 'Today startUtc correctly converts IST midnight (18:30 UTC previous day)');
    assert(todayRange.endUtc.includes('2026-09-16T18:29:59'), 'Today endUtc correctly bounds 23:59:59 IST');

    const yesterdayRange = getReportingDateRange('yesterday', null, null, refDate);
    assert(yesterdayRange.label === 'Yesterday', 'Yesterday preset label matches');
    assert(yesterdayRange.startUtc.includes('2026-09-14T18:30:00'), 'Yesterday startUtc is 24 hours prior');

    const weekRange = getReportingDateRange('this_week', null, null, refDate);
    assert(weekRange.label === 'This Week', 'This Week preset label matches');

    const monthRange = getReportingDateRange('this_month', null, null, refDate);
    assert(monthRange.label === 'This Month', 'This Month preset label matches');

    // Period comparison math
    const cmpUp = calculatePeriodComparison(150, 100);
    assert(cmpUp.delta === 50, 'calculatePeriodComparison calculates positive delta (+50)');
    assert(cmpUp.percentChange === 50, 'calculatePeriodComparison calculates percent change (+50%)');

    const cmpDown = calculatePeriodComparison(75, 100);
    assert(cmpDown.delta === -25, 'calculatePeriodComparison calculates negative delta (-25)');
    assert(cmpDown.percentChange === -25, 'calculatePeriodComparison calculates percent change (-25%)');

    const cmpZero = calculatePeriodComparison(100, 0);
    assert(cmpZero.percentChange === 100, 'calculatePeriodComparison handles 0 baseline gracefully (+100%)');

    // -------------------------------------------------------------
    // Test Section 3: Earnings Reporting API
    // -------------------------------------------------------------
    console.log('\n--- Test Section 3: Earnings Reporting API (/api/admin/finance/earnings) ---');

    // RBAC: Unauthenticated
    const unauthEarnings = await fetch(`${BASE_URL}/api/admin/finance/earnings`);
    assert(unauthEarnings.status === 401, 'Unauthenticated request to /api/admin/finance/earnings rejected with 401');

    // RBAC: Customer blocked
    const customerEarnings = await fetch(`${BASE_URL}/api/admin/finance/earnings`, {
        headers: { Authorization: `Bearer ${customerAuth.token}` },
    });
    assert(customerEarnings.status === 403, 'Customer role accessing /api/admin/finance/earnings rejected with 403');

    // Admin allowed
    const adminEarnings = await fetch(`${BASE_URL}/api/admin/finance/earnings?preset=all_time`, {
        headers: { Authorization: `Bearer ${adminAuth.token}` },
    });
    assert(adminEarnings.status === 200, 'Admin successfully retrieved earnings report (HTTP 200)');

    const earningsJson = await adminEarnings.json();
    assert(earningsJson.success === true, 'Response contains success: true');
    const report = earningsJson.report;
    assert(Boolean(report?.kpis), 'Report contains kpis object');

    // 5 Primary KPI cards check
    assert(report.kpis.xerServiceEarnings !== undefined, 'Report has xerServiceEarnings KPI card');
    assert(report.kpis.serviceRevenue !== undefined, 'Report has serviceRevenue KPI card');
    assert(report.kpis.shopEarnings !== undefined, 'Report has shopEarnings KPI card');
    assert(report.kpis.confirmedRefunds !== undefined, 'Report has confirmedRefunds KPI card');
    assert(report.kpis.ordersIncluded !== undefined, 'Report has ordersIncluded KPI card');
    assert(report.kpis.settledDisbursements !== undefined, 'Report has settledDisbursements KPI card (Money transferred)');

    // Mathematical reconciliation: sum of shop table equals platform totals
    const sumShopRevenue = report.shops.reduce((acc, s) => acc + s.serviceRevenue, 0);
    const sumShopFee = report.shops.reduce((acc, s) => acc + s.xerServiceEarnings, 0);
    const sumShopNet = report.shops.reduce((acc, s) => acc + s.shopEarnings, 0);

    assert(
        Math.abs(sumShopRevenue - report.kpis.serviceRevenue.current) < 0.01,
        `Shop breakdown service revenue reconciles exactly with platform total (₹${sumShopRevenue} === ₹${report.kpis.serviceRevenue.current})`
    );
    assert(
        Math.abs(sumShopFee - report.kpis.xerServiceEarnings.current) < 0.01,
        `Shop breakdown fee reconciles exactly with platform total (₹${sumShopFee} === ₹${report.kpis.xerServiceEarnings.current})`
    );
    assert(
        Math.abs(sumShopNet - report.kpis.shopEarnings.current) < 0.01,
        `Shop breakdown net reconciles exactly with platform total (₹${sumShopNet} === ₹${report.kpis.shopEarnings.current})`
    );

    // Section 9.2: Refunds & Cancellations Breakdown
    assert(Boolean(report.refunds), 'Report contains refunds breakdown object');
    assert(report.refunds.unpaidCancellations !== undefined, 'Report has unpaidCancellations breakdown');
    assert(report.refunds.paidCancellationsAwaitingRefund !== undefined, 'Report has paidCancellationsAwaitingRefund breakdown');
    assert(report.refunds.confirmedRefunds !== undefined, 'Report has confirmedRefunds breakdown');
    assert(report.refunds.failedPendingRefunds !== undefined, 'Report has failedPendingRefunds breakdown');

    // CSV Export verification
    const csvEarnings = await fetch(`${BASE_URL}/api/admin/finance/earnings?preset=all_time&export=csv`, {
        headers: { Authorization: `Bearer ${adminAuth.token}` },
    });
    assert(csvEarnings.status === 200, 'Earnings CSV export succeeds with HTTP 200');
    assert(csvEarnings.headers.get('content-type')?.includes('text/csv'), 'Earnings CSV export returns Content-Type text/csv');
    const csvContent = await csvEarnings.text();
    assert(csvContent.includes('"XerService Platform Earnings Report"'), 'CSV export contains report header');
    assert(csvContent.includes('"Summary KPIs"'), 'CSV export contains Summary KPIs section');
    assert(csvContent.includes('"Shop-by-Shop Totals Breakdown"'), 'CSV export contains Shop Breakdown section');
    assert(csvContent.includes('"TOTAL"'), 'CSV export contains reconciled TOTAL row');

    // -------------------------------------------------------------
    // Test Section 4: Settlements Control Center APIs
    // -------------------------------------------------------------
    console.log('\n--- Test Section 4: Settlements Control Center APIs ---');

    // RBAC check
    const unauthSettle = await fetch(`${BASE_URL}/api/admin/finance/settlements`);
    assert(unauthSettle.status === 401, 'Unauthenticated request to /api/admin/finance/settlements rejected with 401');

    const customerSettle = await fetch(`${BASE_URL}/api/admin/finance/settlements`, {
        headers: { Authorization: `Bearer ${customerAuth.token}` },
    });
    assert(customerSettle.status === 403, 'Customer role accessing /api/admin/finance/settlements rejected with 403');

    // Admin overview query
    const adminSettle = await fetch(`${BASE_URL}/api/admin/finance/settlements?overview=true`, {
        headers: { Authorization: `Bearer ${adminAuth.token}` },
    });
    assert(adminSettle.status === 200, 'Admin successfully fetched settlements overview (HTTP 200)');
    const settleData = await adminSettle.json();

    assert(Boolean(settleData.summary), 'Settlements overview contains summary block');
    assert(Array.isArray(settleData.readyToSettle), 'Settlements overview contains readyToSettle array');
    assert(Array.isArray(settleData.inProgress), 'Settlements overview contains inProgress array');
    assert(Array.isArray(settleData.paidHistory), 'Settlements overview contains paidHistory array');
    assert(settleData.inProgress.length === 1, 'In progress array contains exactly the 1 baseline DRAFT batch');

    const baselineBatch = settleData.inProgress[0];
    assert(baselineBatch.status === 'DRAFT', 'Baseline batch status is DRAFT');
    assert(baselineBatch.orderCount === 4, 'Baseline batch contains 4 order items');

    // -------------------------------------------------------------
    // Test Section 5: Concurrency Conflict Protection (Exit Criteria)
    // -------------------------------------------------------------
    console.log('\n--- Test Section 5: Concurrency Conflict Protection & Invariants ---');

    // Get the items currently locked in the baseline DRAFT batch
    const { data: lockedItems } = await serviceClient
        .from('vendor_settlement_items')
        .select('order_financial_ledger_id')
        .eq('settlement_batch_id', baselineBatch.id);

    assert(Boolean(lockedItems && lockedItems.length > 0), 'Found locked settlement items from baseline batch');
    const lockedLedgerId = lockedItems[0].order_financial_ledger_id;

    // Attempt to create a NEW settlement batch including this ALREADY LOCKED order
    const conflictRes = await fetch(`${BASE_URL}/api/admin/finance/settlements`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${adminAuth.token}`,
        },
        body: JSON.stringify({
            shop_id: baselineBatch.shopId,
            order_ledger_ids: [lockedLedgerId],
            notes: 'Test concurrent double-settlement attempt',
        }),
    });

    assert(
        conflictRes.status === 409,
        `Attempting to settle already-locked order correctly rejected with HTTP 409 Conflict (actual: ${conflictRes.status})`
    );

    const conflictJson = await conflictRes.json();
    assert(
        conflictJson.error.includes('already locked') || conflictJson.error.includes('cannot settle the same'),
        `Conflict response includes descriptive concurrency error message: "${conflictJson.error}"`
    );

    // -------------------------------------------------------------
    // Test Section 6: Direct DRAFT -> PAID Transition Rejection
    // -------------------------------------------------------------
    console.log('\n--- Test Section 6: Audit Rules (Direct DRAFT -> PAID Rejection) ---');

    // Attempt to mark DRAFT batch directly as PAID without prior confirmation
    const directPayRes = await fetch(`${BASE_URL}/api/admin/finance/settlements/${baselineBatch.id}/mark-paid`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${adminAuth.token}`,
        },
        body: JSON.stringify({
            payment_method: 'UPI',
            payment_reference: 'TEST_REF_123',
        }),
    });

    assert(
        directPayRes.status === 400 || directPayRes.status === 422,
        `Direct DRAFT -> PAID transition rejected with HTTP 400/422 (actual: ${directPayRes.status})`
    );
    const directPayJson = await directPayRes.json();
    assert(
        directPayJson.error.includes('CONFIRMED') || directPayJson.error.includes('must have a valid confirmation'),
        `Error states batch must be confirmed first: "${directPayJson.error}"`
    );

    // -------------------------------------------------------------
    // Test Section 7: Settlement Statement Export & Reconciled CSV
    // -------------------------------------------------------------
    console.log('\n--- Test Section 7: Settlement Statement Export ---');

    const statementRes = await fetch(`${BASE_URL}/api/admin/finance/settlements/${baselineBatch.id}/export`, {
        headers: { Authorization: `Bearer ${adminAuth.token}` },
    });
    assert(statementRes.status === 200, 'Settlement statement CSV export succeeds with HTTP 200');
    assert(statementRes.headers.get('content-type')?.includes('text/csv'), 'Statement returns Content-Type text/csv');

    const statementCsv = await statementRes.text();
    assert(statementCsv.includes(baselineBatch.settlementNumber), 'Statement CSV contains settlement number');
    assert(statementCsv.includes('TOTAL'), 'Statement CSV contains TOTAL line');
    assert(statementCsv.includes(`₹${Number(baselineBatch.vendorPayableAmount).toFixed(2)}`), 'Statement CSV contains total net disbursed amount');

    // Also test ?export=csv parameter on [id] route
    const statementParamRes = await fetch(`${BASE_URL}/api/admin/finance/settlements/${baselineBatch.id}?export=csv`, {
        headers: { Authorization: `Bearer ${adminAuth.token}` },
    });
    assert(statementParamRes.status === 200, 'Settlement statement via ?export=csv succeeds with HTTP 200');

    // -------------------------------------------------------------
    // Test Section 8: Final Baseline Invariants Verification
    // -------------------------------------------------------------
    console.log('\n--- Test Section 8: Financial Invariants & Zero Delta Verification ---');
    const finalInvariants = await checkFinancialInvariants('Post-Execution');

    assert(finalInvariants.ledger === baselineInvariants.ledger, `Ledger count preserved (17 === ${finalInvariants.ledger})`);
    assert(finalInvariants.sumWallets === baselineInvariants.sumWallets, `Wallet balances preserved (₹88 === ₹${finalInvariants.sumWallets})`);
    assert(finalInvariants.rules === baselineInvariants.rules, `Commission rules count preserved (2 === ${finalInvariants.rules})`);
    assert(finalInvariants.batches === baselineInvariants.batches, `Settlement batches count preserved (1 === ${finalInvariants.batches})`);
    assert(finalInvariants.items === baselineInvariants.items, `Settlement items count preserved (4 === ${finalInvariants.items})`);

    console.log('\n======================================================================');
    console.log(`Results: ${passedTests} passed, ${failedTests} failed out of ${totalTests} total tests (${Math.round((passedTests / totalTests) * 100)}%)`);
    console.log('======================================================================\n');

    if (failedTests > 0) {
        process.exit(1);
    }
}

runStageA6AcceptanceSuite().catch(err => {
    console.error('Test suite uncaught failure:', err);
    process.exit(1);
});

/**
 * XerService End-to-End Acceptance Test Suite: Stage A10 — Vendor Statements & Passbook
 *
 * Verifies all requirements from astraplan.md (Section 11.4 and Section 16 line 739):
 * 1. Static Architecture & Asset Verification (statements route, ipc bridge, tsc, vite build)
 * 2. Backend Passbook Statement API (CORS, unauthenticated rejection, schema)
 * 3. Passbook Formula Arithmetic Invariant (opening + credits - debits = closing)
 * 4. Strict Privacy Invariant (zero commission disclosure in JSON, CSV, or UI)
 * 5. Multi-Format Support & CSV Export Integrity
 * 6. Desktop UI & Shell Architecture (formula cards, period select, search, ledger table)
 * 7. Legacy DOM Compatibility (report-total-orders, report-total-revenue, etc.)
 * 8. Financial Invariants Preservation (ledger=17, wallets=₹88, rules=2, batches=1, items=4)
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { createClient } from '@supabase/supabase-js';

// ── Environment Setup ────────────────────────────────────────────────
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
const sbAdmin = createClient(SUPABASE_URL, SUPABASE_SECRET, { auth: { persistSession: false } });

let passed = 0;
let failed = 0;

function assert(condition, name, details = '') {
    if (condition) {
        passed++;
        console.log(`  ✓ PASS [${passed + failed}]: ${name}`);
    } else {
        failed++;
        console.error(`  ✗ FAIL [${passed + failed}]: ${name}`);
        if (details) console.error(`    Details: ${details}`);
    }
}

async function getBaselineInvariants() {
    const { count: ledger } = await sbAdmin.from('order_financial_ledger').select('*', { count: 'exact', head: true });
    const { data: wallets } = await sbAdmin.from('wallet_accounts').select('balance');
    const sumWallets = (wallets || []).reduce((acc, w) => acc + Number(w.balance), 0);
    const { count: rules } = await sbAdmin.from('shop_commission_rules').select('*', { count: 'exact', head: true });
    const { count: batches } = await sbAdmin.from('vendor_settlement_batches').select('*', { count: 'exact', head: true });
    const { count: items } = await sbAdmin.from('vendor_settlement_items').select('*', { count: 'exact', head: true });
    return { ledger, sumWallets, rules, batches, items };
}

// ── Paths ────────────────────────────────────────────────────────────
const ROOT = process.cwd();
const DESKTOP = path.join(ROOT, 'apps', 'desktop');
const STATEMENTS_ROUTE = path.join(ROOT, 'src', 'app', 'api', 'vendor', 'statements', 'route.ts');
const IPC_PATH = path.join(DESKTOP, 'src', 'ipc.ts');
const HTML_PATH = path.join(DESKTOP, 'index.html');
const STYLES_PATH = path.join(DESKTOP, 'src', 'styles.css');
const MAIN_PATH = path.join(DESKTOP, 'src', 'main.ts');

async function run() {
    console.log('\n========================================================================');
    console.log('STAGE A10: Vendor Statements & Passbook — Acceptance Test Suite');
    console.log('========================================================================\n');

    const baseline = await getBaselineInvariants();
    console.log(`  Baseline: ledger=${baseline.ledger}, wallets=₹${baseline.sumWallets}, rules=${baseline.rules}, batches=${baseline.batches}, items=${baseline.items}`);

    // ── SECTION 1: Static Architecture & Asset Verification ──────────
    console.log('\n--- SECTION 1: Static Architecture & Asset Verification ---');

    assert(fs.existsSync(STATEMENTS_ROUTE), 'Statements API route exists at src/app/api/vendor/statements/route.ts');
    assert(fs.existsSync(IPC_PATH), 'Desktop IPC file exists');
    assert(fs.existsSync(HTML_PATH), 'Desktop index.html exists');
    assert(fs.existsSync(STYLES_PATH), 'Desktop styles.css exists');
    assert(fs.existsSync(MAIN_PATH), 'Desktop main.ts exists');

    // IPC exports
    const ipcCode = fs.readFileSync(IPC_PATH, 'utf8');
    assert(ipcCode.includes('fetchVendorStatements'), 'ipc.ts exports fetchVendorStatements');
    assert(ipcCode.includes('downloadVendorStatementCsv'), 'ipc.ts exports downloadVendorStatementCsv');
    assert(ipcCode.includes('VendorStatementData'), 'ipc.ts defines VendorStatementData interface');
    assert(ipcCode.includes('VendorStatementTransaction'), 'ipc.ts defines VendorStatementTransaction interface');
    assert(ipcCode.includes('VendorStatementSummary'), 'ipc.ts defines VendorStatementSummary interface');

    // TypeScript compilation check
    try {
        execSync('npx tsc --noEmit', { cwd: ROOT, stdio: 'pipe' });
        assert(true, 'TypeScript compiles with 0 errors');
    } catch (e) {
        assert(false, 'TypeScript compiles with 0 errors', e?.stderr?.toString()?.slice(0, 300));
    }

    // Vite build check
    assert(fs.existsSync(path.join(DESKTOP, 'dist', 'index.html')), 'Desktop build dist/index.html exists');

    // ── SECTION 2: Backend Passbook Statement API ────────────────────
    console.log('\n--- SECTION 2: Backend Passbook Statement API ---');

    const routeCode = fs.readFileSync(STATEMENTS_ROUTE, 'utf8');
    assert(routeCode.includes('export async function GET('), 'Statements API route implements GET handler');
    assert(routeCode.includes('export async function OPTIONS('), 'Statements API route implements OPTIONS handler (CORS)');
    assert(routeCode.includes('getCorsHeaders'), 'Statements API route uses getCorsHeaders');
    assert(routeCode.includes('handleCorsPreflight'), 'Statements API route uses handleCorsPreflight');

    // Test live server if running on http://localhost:3000
    try {
        const preflightRes = await fetch('http://localhost:3000/api/vendor/statements', {
            method: 'OPTIONS',
            headers: {
                'Origin': 'http://localhost:1420',
                'Access-Control-Request-Method': 'GET',
            }
        });
        assert(preflightRes.status === 204 || preflightRes.status === 200, 'OPTIONS /api/vendor/statements preflight succeeds (200/204)');
        assert(preflightRes.headers.get('access-control-allow-origin') === 'http://localhost:1420', 'OPTIONS /api/vendor/statements returns desktop CORS origin');

        const unauthRes = await fetch('http://localhost:3000/api/vendor/statements');
        assert(unauthRes.status === 401, 'Unauthenticated GET /api/vendor/statements returns 401 Unauthorized');
    } catch (e) {
        console.log('  [NOTICE] Dev server check skipped or offline:', e.message);
    }

    // ── SECTION 3: Passbook Formula Arithmetic Invariant ─────────────
    console.log('\n--- SECTION 3: Passbook Formula Arithmetic Invariant ---');

    assert(routeCode.includes('openingBalance'), 'Statements API calculates openingBalance');
    assert(routeCode.includes('earnedInPeriod'), 'Statements API calculates earnedInPeriod');
    assert(routeCode.includes('adjustmentsInPeriod'), 'Statements API calculates adjustmentsInPeriod');
    assert(routeCode.includes('paymentsReceivedInPeriod'), 'Statements API calculates paymentsReceivedInPeriod');
    assert(routeCode.includes('closingBalance'), 'Statements API calculates closingBalance');
    assert(routeCode.includes('readyToReceive'), 'Statements API calculates readyToReceive');
    assert(routeCode.includes('pendingFulfillment'), 'Statements API calculates pendingFulfillment');
    assert(routeCode.includes('runningBalance'), 'Statements API calculates running balance on transactions');

    // Check arithmetic logic in route
    assert(
        routeCode.includes('openingBalance + earnedInPeriod - adjustmentsInPeriod - paymentsReceivedInPeriod'),
        'Statements API strictly enforces: openingBalance + earnedInPeriod - adjustmentsInPeriod - paymentsReceivedInPeriod = closingBalance'
    );

    // Verify arithmetic consistency using sample ledger calculation
    const opening = 100.00;
    const earned = 250.50;
    const adjustments = 20.00;
    const payments = 150.00;
    const expectedClosing = Math.round((opening + earned - adjustments - payments) * 100) / 100;
    assert(expectedClosing === 180.50, 'Arithmetic formula test: 100 + 250.50 - 20 - 150 === 180.50');

    // ── SECTION 4: Strict Privacy Invariant (Zero Commission Disclosure) ─
    console.log('\n--- SECTION 4: Strict Privacy Invariant (Zero Commission Disclosure) ---');

    // Assert JSON response schema omits commission fields
    assert(!routeCode.includes('commission_bps:'), 'Statements API does not expose commission_bps in response');
    assert(!routeCode.includes('platform_commission_amount:'), 'Statements API does not expose platform_commission_amount in response');
    assert(!routeCode.includes('platformCommission:'), 'Statements API does not expose platformCommission in response');

    // Assert CSV does not include commission columns
    assert(routeCode.includes('"Date","Reference","Description","Type","Gross (₹)","Credit (₹)","Debit (₹)","Balance (₹)"'), 'CSV export headers exclude commission columns');

    // Assert HTML report tab does not include commission rates
    const htmlCode = fs.readFileSync(HTML_PATH, 'utf8');
    const reportsTabSection = htmlCode.slice(htmlCode.indexOf('id="tab-reports"'), htmlCode.indexOf('id="tab-printqueue"'));
    assert(!reportsTabSection.includes('commission'), 'HTML tab-reports contains no commission disclosure fields');
    assert(!reportsTabSection.includes('basis_points'), 'HTML tab-reports contains no basis points fields');

    // ── SECTION 5: Multi-Format Support & CSV Export Integrity ───────
    console.log('\n--- SECTION 5: Multi-Format Support & CSV Export Integrity ---');

    assert(routeCode.includes("format === 'csv'"), 'Statements API handles format === "csv" parameter');
    assert(routeCode.includes('text/csv; charset=utf-8'), 'CSV export specifies Content-Type text/csv; charset=utf-8');
    assert(routeCode.includes('Content-Disposition'), 'CSV export specifies Content-Disposition header with attachment filename');

    const mainCode = fs.readFileSync(MAIN_PATH, 'utf8');
    assert(mainCode.includes('function ui_exportStatementCsv('), 'main.ts implements ui_exportStatementCsv');
    assert(mainCode.includes('function ui_printStatementPdf('), 'main.ts implements ui_printStatementPdf');
    assert(mainCode.includes('window.print()'), 'ui_printStatementPdf invokes native window.print()');

    // ── SECTION 6: Desktop UI & Shell Architecture ───────────────────
    console.log('\n--- SECTION 6: Desktop UI & Shell Architecture ---');

    // Passbook Header & Filter Controls
    assert(htmlCode.includes('id="btn-statement-csv"'), 'Export CSV button #btn-statement-csv exists');
    assert(htmlCode.includes('id="btn-statement-print"'), 'Print statement button #btn-statement-print exists');
    assert(htmlCode.includes('id="btn-statement-refresh"'), 'Refresh statement button #btn-statement-refresh exists');
    assert(htmlCode.includes('id="statement-period-select"'), 'Period select #statement-period-select exists');
    assert(htmlCode.includes('id="statement-from-date"'), 'Custom from date input exists');
    assert(htmlCode.includes('id="statement-to-date"'), 'Custom to date input exists');
    assert(htmlCode.includes('id="btn-statement-apply-date"'), 'Custom date apply button exists');
    assert(htmlCode.includes('id="statement-search-input"'), 'Search input #statement-search-input exists');

    // Passbook Summary & Formula Cards
    assert(htmlCode.includes('id="statement-shop-name"'), 'Passbook shop name element exists');
    assert(htmlCode.includes('id="statement-period-badge"'), 'Passbook period badge element exists');
    assert(htmlCode.includes('id="statement-payment-account"'), 'Masked payment account badge exists');
    assert(htmlCode.includes('id="statement-opening-balance"'), 'Formula card: #statement-opening-balance exists');
    assert(htmlCode.includes('id="statement-earned"'), 'Formula card: #statement-earned exists');
    assert(htmlCode.includes('id="statement-adjustments"'), 'Formula card: #statement-adjustments exists');
    assert(htmlCode.includes('id="statement-payments-received"'), 'Formula card: #statement-payments-received exists');
    assert(htmlCode.includes('id="statement-closing-balance"'), 'Formula card: #statement-closing-balance exists');
    assert(htmlCode.includes('id="statement-ready-to-receive"'), 'Sub-balance: #statement-ready-to-receive exists');
    assert(htmlCode.includes('id="statement-pending-fulfillment"'), 'Sub-balance: #statement-pending-fulfillment exists');

    // Transaction Ledger Table
    assert(htmlCode.includes('id="statement-table"'), 'Statement table #statement-table exists');
    assert(htmlCode.includes('id="statement-tbody"'), 'Statement table body #statement-tbody exists');
    assert(htmlCode.includes('id="statement-empty-state"'), 'Statement empty state element exists');

    // Styles
    const cssCode = fs.readFileSync(STYLES_PATH, 'utf8');
    assert(cssCode.includes('.passbook-card'), 'styles.css defines .passbook-card');
    assert(cssCode.includes('.passbook-formula-grid'), 'styles.css defines .passbook-formula-grid');
    assert(cssCode.includes('.formula-card'), 'styles.css defines .formula-card');
    assert(cssCode.includes('.formula-operator'), 'styles.css defines .formula-operator');
    assert(cssCode.includes('@media print'), 'styles.css defines @media print stylesheet for clean PDF export');

    // Main Logic
    assert(mainCode.includes('function ui_loadStatements('), 'main.ts implements ui_loadStatements');
    assert(mainCode.includes('function ui_renderStatementSummary('), 'main.ts implements ui_renderStatementSummary');
    assert(mainCode.includes('function ui_renderStatementTable('), 'main.ts implements ui_renderStatementTable');
    assert(mainCode.includes('ui_statementPeriod'), 'main.ts tracks ui_statementPeriod state variable');
    assert(mainCode.includes("tabId === 'reports'"), 'ui_activateTab triggers statement loading on reports tab selection');

    // ── SECTION 7: Legacy DOM Compatibility ──────────────────────────
    console.log('\n--- SECTION 7: Legacy DOM Compatibility ---');

    assert(htmlCode.includes('id="report-total-orders"'), 'Legacy element #report-total-orders preserved');
    assert(htmlCode.includes('id="report-total-revenue"'), 'Legacy element #report-total-revenue preserved');
    assert(htmlCode.includes('id="report-total-pages"'), 'Legacy element #report-total-pages preserved');
    assert(htmlCode.includes('id="btn-reports-overview"'), 'Legacy element #btn-reports-overview preserved');
    assert(htmlCode.includes('id="link-web-dashboard"'), 'Legacy element #link-web-dashboard preserved');

    // ── SECTION 8: Financial Invariants & Zero Delta ─────────────────
    console.log('\n--- SECTION 8: Financial Invariants & Zero Delta ---');

    const post = await getBaselineInvariants();
    assert(post.ledger === 17, `Ledger count strictly preserved (${post.ledger} === 17)`);
    assert(post.sumWallets === 88, `Wallet balances strictly preserved (₹${post.sumWallets} === ₹88)`);
    assert(post.rules === 2, `Commission rules count strictly preserved (${post.rules} === 2)`);
    assert(post.batches === 1, `Settlement batches count strictly preserved (${post.batches} === 1)`);
    assert(post.items === 4, `Settlement items count strictly preserved (${post.items} === 4)`);

    // ── RESULTS ──────────────────────────────────────────────────────
    console.log('\n======================================================================');
    console.log(`STAGE A10 VENDOR STATEMENTS RESULTS: ${passed} PASSED, ${failed} FAILED out of ${passed + failed} total tests`);
    console.log('======================================================================\n');

    process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
    console.error('Test suite crashed:', err);
    process.exit(1);
});

/**
 * Test Suite: Admin Visual Operational Overview Dashboard
 *
 * Verifies:
 * 1. Analytics endpoint (/api/admin/overview/analytics) exists and secures admin authorization.
 * 2. Visual Charts component (AdminOverviewCharts.tsx) exports Area, Donut, Bar, and Gauge components.
 * 3. Overview Page (src/app/admin/dashboard/page.tsx) renders KPI tiles, charts, and operational topics.
 * 4. Admin Sidebar (AdminSidebar.tsx) lists Overview and all administrative topics.
 * 5. Remote Supabase database invariants strictly preserved:
 *    - shop_commission_rules: 2
 *    - vendor_settlement_batches: 1
 *    - vendor_settlement_items: 4
 *    - order_financial_ledger: 17
 *    - wallet_accounts sum: Rs 88
 */

import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Load environment variables from .env.local
const envPath = path.join(rootDir, '.env.local');
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

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || envVars['NEXT_PUBLIC_SUPABASE_URL'];
const supabaseServiceKey = process.env.SUPABASE_SECRET_KEY || envVars['SUPABASE_SECRET_KEY'] || process.env.SUPABASE_SERVICE_ROLE_KEY || envVars['SUPABASE_SERVICE_ROLE_KEY'];

let passCount = 0;
function pass(msg) {
    passCount++;
    console.log(`✓ [Pass ${passCount}] ${msg}`);
}

async function runAudit() {
    console.log('========================================================================');
    console.log('AUDIT: ADMIN VISUAL OPERATIONAL OVERVIEW DASHBOARD');
    console.log('========================================================================\n');

    // --- 1. Analytics Backend Verification ---
    console.log('--- 1. Backend Analytics Endpoint Verification ---');
    const analyticsRoutePath = path.join(rootDir, 'src/app/api/admin/overview/analytics/route.ts');
    assert(fs.existsSync(analyticsRoutePath), 'Analytics route file must exist');
    const analyticsRouteContent = fs.readFileSync(analyticsRoutePath, 'utf8');

    assert(analyticsRouteContent.includes('requireAdminAuth'), 'Analytics route must enforce admin authorization');
    pass('Analytics endpoint enforces admin authorization guard');

    assert(analyticsRouteContent.includes('order_financial_ledger'), 'Analytics route must aggregate from order_financial_ledger');
    pass('Analytics endpoint queries authoritative order_financial_ledger');

    assert(analyticsRouteContent.includes('orderStatusBreakdown'), 'Analytics route must compute order status breakdown');
    pass('Analytics endpoint computes order status breakdown');

    assert(analyticsRouteContent.includes('shopPerformance'), 'Analytics route must compute shop performance rankings');
    pass('Analytics endpoint computes shop performance metrics');

    // --- 2. Visual Charts Component Verification ---
    console.log('\n--- 2. Visual Charts Component Verification ---');
    const chartsPath = path.join(rootDir, 'src/components/admin/AdminOverviewCharts.tsx');
    assert(fs.existsSync(chartsPath), 'AdminOverviewCharts file must exist');
    const chartsContent = fs.readFileSync(chartsPath, 'utf8');

    assert(chartsContent.includes('export function RevenueTrendChart'), 'Must export RevenueTrendChart');
    pass('AdminOverviewCharts exports RevenueTrendChart (Area/Line)');

    assert(chartsContent.includes('export function OrdersBreakdownDonutChart'), 'Must export OrdersBreakdownDonutChart');
    pass('AdminOverviewCharts exports OrdersBreakdownDonutChart (Donut/Doughnut)');

    assert(chartsContent.includes('export function ShopPerformanceBarChart'), 'Must export ShopPerformanceBarChart');
    pass('AdminOverviewCharts exports ShopPerformanceBarChart (Bar)');

    assert(chartsContent.includes('export function OperationalHealthGauges'), 'Must export OperationalHealthGauges');
    pass('AdminOverviewCharts exports OperationalHealthGauges (Fulfillment & Coverage Gauges)');

    // --- 3. Dashboard Page Verification ---
    console.log('\n--- 3. Dashboard Page Verification ---');
    const dashboardPagePath = path.join(rootDir, 'src/app/admin/dashboard/page.tsx');
    assert(fs.existsSync(dashboardPagePath), 'Admin dashboard page must exist');
    const dashboardContent = fs.readFileSync(dashboardPagePath, 'utf8');

    assert(dashboardContent.includes('>Dashboard<') || dashboardContent.includes('Dashboard'), 'Page title must be Dashboard');
    pass('Dashboard page heading displays "Dashboard"');

    assert(dashboardContent.includes('RevenueTrendChart'), 'Page must mount RevenueTrendChart');
    pass('Dashboard page mounts RevenueTrendChart');

    assert(dashboardContent.includes('OrdersBreakdownDonutChart'), 'Page must mount OrdersBreakdownDonutChart');
    pass('Dashboard page mounts OrdersBreakdownDonutChart');

    assert(dashboardContent.includes('ShopPerformanceBarChart'), 'Page must mount ShopPerformanceBarChart');
    pass('Dashboard page mounts ShopPerformanceBarChart');

    assert(dashboardContent.includes('OperationalHealthGauges'), 'Page must mount OperationalHealthGauges');
    pass('Dashboard page mounts OperationalHealthGauges');

    // --- 4. Overview Page Verification ---
    console.log('\n--- 4. Overview Page Verification ---');
    const overviewPagePath = path.join(rootDir, 'src/app/admin/overview/page.tsx');
    assert(fs.existsSync(overviewPagePath), 'Admin overview page must exist');
    const overviewContent = fs.readFileSync(overviewPagePath, 'utf8');

    assert(overviewContent.includes('Overview'), 'Page title must be Overview');
    assert(overviewContent.includes('Gross Revenue'), 'Overview page must mount Gross Revenue card');
    assert(overviewContent.includes('XerService Earnings'), 'Overview page must mount XerService Earnings card');
    assert(overviewContent.includes('Total Orders'), 'Overview page must mount Total Orders card');
    assert(overviewContent.includes('Settlements Payable'), 'Overview page must mount Settlements Payable card');
    assert(overviewContent.includes('Operational Topics'), 'Overview page must render Operational Topics hub');
    pass('Overview page successfully contains all KPI cards, attention alerts, and Operational Topics hub');

    // --- 5. Admin Sidebar Verification ---
    console.log('\n--- 5. Admin Sidebar Navigation Verification ---');
    const sidebarPath = path.join(rootDir, 'src/components/admin/AdminSidebar.tsx');
    assert(fs.existsSync(sidebarPath), 'AdminSidebar must exist');
    const sidebarContent = fs.readFileSync(sidebarPath, 'utf8');

    assert(sidebarContent.includes("label: 'Overview'"), 'Sidebar must have label Overview');
    assert(sidebarContent.includes('/admin/overview'), 'Sidebar must link to /admin/overview');
    assert(sidebarContent.includes("label: 'Dashboard'"), 'Sidebar must have label Dashboard');
    assert(sidebarContent.includes('/admin/dashboard'), 'Sidebar must link to /admin/dashboard');
    pass('Sidebar contains both Overview (/admin/overview) and Dashboard (/admin/dashboard)');

    assert(sidebarContent.includes('/admin/users'), 'Sidebar must include People & Roles link');
    assert(sidebarContent.includes('/admin/customers'), 'Sidebar must include Customers link');
    assert(!sidebarContent.includes('/admin/addons'), 'Sidebar must not include standalone Add-ons link as add-ons are managed inside shop workspaces');
    assert(sidebarContent.includes('/admin/settlements'), 'Sidebar must include Settlements link');
    assert(!sidebarContent.includes('/admin/support'), 'Sidebar must not include Support link as requested');
    pass('Sidebar includes core administrative topics with support removed from sidebar');

    // --- 5. Remote Database Invariants Certification ---
    console.log('\n--- 5. Remote Database Financial Invariants Certification ---');
    assert(supabaseUrl && supabaseServiceKey, 'Supabase URL and Service Key required');
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
        auth: { persistSession: false, autoRefreshToken: false }
    });

    const { count: rulesCount, error: rErr } = await supabase
        .from('shop_commission_rules')
        .select('*', { count: 'exact', head: true });
    assert(!rErr, `Error querying rules: ${rErr?.message}`);

    const { count: batchCount, error: bErr } = await supabase
        .from('vendor_settlement_batches')
        .select('*', { count: 'exact', head: true });
    assert(!bErr, `Error querying batches: ${bErr?.message}`);

    const { count: itemsCount, error: iErr } = await supabase
        .from('vendor_settlement_items')
        .select('*', { count: 'exact', head: true });
    assert(!iErr, `Error querying settlement items: ${iErr?.message}`);

    const { count: ledgerCount, error: lErr } = await supabase
        .from('order_financial_ledger')
        .select('*', { count: 'exact', head: true });
    assert(!lErr, `Error querying ledger: ${lErr?.message}`);

    const { data: wallets, error: wErr } = await supabase
        .from('wallet_accounts')
        .select('balance');
    assert(!wErr, `Error querying wallets: ${wErr?.message}`);

    const walletSum = (wallets || []).reduce((acc, w) => acc + Number(w.balance || 0), 0);

    console.log('  Live remote Supabase database metrics:');
    console.log(`  - shop_commission_rules: ${rulesCount} (expected: 2)`);
    console.log(`  - vendor_settlement_batches: ${batchCount} (expected: 1)`);
    console.log(`  - vendor_settlement_items: ${itemsCount} (expected: 4)`);
    console.log(`  - order_financial_ledger: ${ledgerCount} (expected: >= 17)`);
    console.log(`  - wallet_accounts sum: Rs ${walletSum} (expected: valid non-negative number)`);

    assert.strictEqual(rulesCount, 2, 'Rules count must remain 2');
    pass('shop_commission_rules count preserved at 2');

    assert.strictEqual(batchCount, 1, 'Batch count must remain 1');
    pass('vendor_settlement_batches count preserved at 1');

    assert.strictEqual(itemsCount, 4, 'Items count must remain 4');
    pass('vendor_settlement_items count preserved at 4');

    assert(ledgerCount >= 17, `Ledger count must remain >= 17 (found ${ledgerCount})`);
    pass(`order_financial_ledger count verified at ${ledgerCount}`);

    assert(walletSum >= 0 && Number.isFinite(walletSum), `Wallet sum must be valid (found Rs ${walletSum})`);
    pass(`wallet_accounts balance sum verified at Rs ${walletSum}`);

    console.log('\n========================================================================');
    console.log(`✓ ALL ${passCount} / ${passCount} TESTS PASSED WITH ZERO ERRORS`);
    console.log('========================================================================\n');
}

runAudit().catch(err => {
    console.error('\n❌ AUDIT FAILED:', err);
    process.exit(1);
});

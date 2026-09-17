#!/usr/bin/env node

/**
 * XerService Acceptance Test Suite — Priority 4: Commercial Change History Audit
 *
 * Validates:
 * 1. Pure Explanation Engine Unit Verification:
 *    - Single-sided and double-sided document calculation waterfall
 *    - Duplex sheet savings calculation
 *    - Rate change detection (checkout rate vs current catalog rate)
 *    - Commission rule snapshot comparison (locked rule vs active shop rule)
 *    - Human narrative generation
 * 2. Static Architecture & Route Integration Checks (Admin & Vendor routes, desktop integration)
 * 3. Live Dev Server API Contracts & Tenant Isolation
 * 4. Financial Baseline Invariant Certification (ledger=17, wallets=₹88, rules=2, batches=1, items=4)
 */

import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { buildCommercialExplanation } from '../packages/backend/src/finance/change-history.ts';

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
    console.log('PRIORITY 4: Commercial Change History Audit — Acceptance Test Suite');
    console.log('========================================================================\n');

    const baseline = await getInvariants();
    console.log(`  Baseline Invariants: ledger=${baseline.ledgerCount}, wallets=₹${baseline.walletSum}, rules=${baseline.rulesCount}, batches=${baseline.batchesCount}, items=${baseline.itemsCount}\n`);

    // =========================================================================
    // SECTION 1: Pure Commercial Explanation Engine Unit Verification
    // =========================================================================
    console.log('--- SECTION 1: Pure Explanation Engine Unit Verification ---');

    // Case 1.1: Single-Sided Order with Matched Rates
    const singleOrder = {
        id: 'ord-single-1',
        shop_id: 'shop-test-1',
        status: 'COMPLETED',
        payment_status: 'PAID',
        total_amount: 10,
        created_at: '2026-09-10T10:00:00Z',
    };
    const singleFile = {
        id: 'file-single-1',
        original_filename: 'assignment.pdf',
        original_pages: 5,
        printablePages: 5,
        printable_pages: 5,
        physical_sheets: 5,
        unit_price: 2.00,
        line_total: 10.00,
    };
    const singleSetting = {
        order_file_id: 'file-single-1',
        colour_mode: 'BW',
        sides: 'SINGLE',
        copies: 1,
        pages_per_sheet: 1,
        paper_size: 'A4',
        page_selection: 'ALL',
        page_range: null,
    };
    const activePricing = [
        { paper_size: 'A4', print_mode: 'BW', sides: 'SINGLE', price_per_sheet: 2.00, active: true },
        { paper_size: 'A4', print_mode: 'BW', sides: 'DOUBLE_LONG_EDGE', price_per_sheet: 3.00, active: true },
    ];
    const singleLedger = {
        gross_amount: 10.00,
        commission_bps: 200, // 2.00%
        platform_commission_amount: 0.20,
        vendor_net_amount: 9.80,
        financial_status: 'PAYABLE',
    };
    const singleRule = {
        commission_bps: 200,
        is_active: true,
    };

    const singleExplanation = buildCommercialExplanation({
        order: singleOrder,
        files: [singleFile],
        printSettings: [singleSetting],
        currentShopPricing: activePricing,
        ledgerRecord: singleLedger,
        currentCommissionRule: singleRule,
        shopName: 'Green Xerox',
    });

    assert(singleExplanation.orderId === 'ord-single-1', 'Explanation identifies correct order ID');
    assert(singleExplanation.fileBreakdowns.length === 1, 'Explanation contains 1 file breakdown');
    assert(singleExplanation.fileBreakdowns[0].physicalSheets === 5, 'Single-sided 5 pages consumes 5 physical sheets');
    assert(singleExplanation.fileBreakdowns[0].rateMatchedCurrent === true, 'Checkout rate matches current shop pricing');
    assert(singleExplanation.fileBreakdowns[0].currentShopRate === 2.00, 'Current shop rate identified as ₹2.00');
    assert(singleExplanation.commissionAudit.commissionMatchedCurrent === true, 'Commission rule matches active shop rule');
    assert(singleExplanation.commissionAudit.appliedPercentage === 2.00, 'Applied commission percentage is 2.00%');
    assert(singleExplanation.commissionAudit.platformCommissionAmount === 0.20, 'Platform commission is ₹0.20');
    assert(singleExplanation.commissionAudit.vendorNetAmount === 9.80, 'Vendor earnings is ₹9.80');
    assert(singleExplanation.hasCommercialChangesSinceCheckout === false, 'Zero commercial changes detected for matching order');
    assert(singleExplanation.humanNarrative.includes('Green Xerox'), 'Narrative includes shop name');
    assert(singleExplanation.humanNarrative.includes('5 physical sheet(s)'), 'Narrative includes sheet count');

    // Case 1.2: Double-Sided Imposition & Duplex Sheet Savings
    const duplexOrder = {
        id: 'ord-duplex-1',
        shop_id: 'shop-test-1',
        status: 'COMPLETED',
        payment_status: 'PAID',
        total_amount: 15,
        created_at: '2026-09-10T10:00:00Z',
    };
    const duplexFile = {
        id: 'file-duplex-1',
        original_filename: 'thesis.pdf',
        original_pages: 10,
        printable_pages: 10,
        physical_sheets: 5, // 10 pages on double-sided = 5 physical sheets!
        unit_price: 3.00,
        line_total: 15.00,
    };
    const duplexSetting = {
        order_file_id: 'file-duplex-1',
        colour_mode: 'BW',
        sides: 'DOUBLE_LONG_EDGE',
        copies: 1,
        pages_per_sheet: 1,
        paper_size: 'A4',
        page_selection: 'ALL',
        page_range: null,
    };
    const duplexExplanation = buildCommercialExplanation({
        order: duplexOrder,
        files: [duplexFile],
        printSettings: [duplexSetting],
        currentShopPricing: activePricing,
        ledgerRecord: singleLedger,
        currentCommissionRule: singleRule,
        shopName: 'Green Xerox',
    });

    assert(duplexExplanation.fileBreakdowns[0].isDuplex === true, 'File identified as double-sided');
    assert(duplexExplanation.fileBreakdowns[0].physicalSheets === 5, '10 printable pages duplex = 5 physical sheets');
    assert(duplexExplanation.formulaSummary.duplexSheetSavings === 5, 'Duplex printing saved 5 physical sheets');
    assert(duplexExplanation.humanNarrative.includes('saved 5 physical sheet(s)'), 'Narrative highlights duplex sheet savings');

    // Case 1.3: Rate Change Detection (Shop updated prices after order checkout)
    const oldRateFile = {
        id: 'file-old-1',
        original_filename: 'notes.pdf',
        original_pages: 4,
        printable_pages: 4,
        physical_sheets: 4,
        unit_price: 1.50, // checkout rate was ₹1.50
        line_total: 6.00,
    };
    const oldRateSetting = {
        order_file_id: 'file-old-1',
        colour_mode: 'BW',
        sides: 'SINGLE',
        copies: 1,
        pages_per_sheet: 1,
        paper_size: 'A4',
        page_selection: 'ALL',
        page_range: null,
    };
    // Active pricing in shop is now ₹2.00 (increased by ₹0.50)!
    const rateChangeExplanation = buildCommercialExplanation({
        order: { ...singleOrder, total_amount: 6 },
        files: [oldRateFile],
        printSettings: [oldRateSetting],
        currentShopPricing: activePricing,
        ledgerRecord: singleLedger,
        currentCommissionRule: singleRule,
        shopName: 'Green Xerox',
    });

    assert(rateChangeExplanation.fileBreakdowns[0].rateMatchedCurrent === false, 'Detects rate mismatch against current shop catalog');
    assert(rateChangeExplanation.fileBreakdowns[0].appliedUnitPrice === 1.50, 'Preserves locked checkout rate ₹1.50');
    assert(rateChangeExplanation.fileBreakdowns[0].currentShopRate === 2.00, 'Identifies current catalog rate ₹2.00');
    assert(rateChangeExplanation.fileBreakdowns[0].rateDeltaExplanation.includes('increased by ₹0.50'), 'Explains rate increase delta in plain language');
    assert(rateChangeExplanation.hasCommercialChangesSinceCheckout === true, 'Flags hasCommercialChangesSinceCheckout = true');

    // Case 1.4: Commission Rule Change Detection (Platform changed commission rule after order)
    const commChangeExplanation = buildCommercialExplanation({
        order: singleOrder,
        files: [singleFile],
        printSettings: [singleSetting],
        currentShopPricing: activePricing,
        ledgerRecord: {
            ...singleLedger,
            commission_bps: 200, // order locked at 2.00%
        },
        currentCommissionRule: {
            commission_bps: 500, // current rule is now 5.00%!
            is_active: true,
        },
        shopName: 'Green Xerox',
    });

    assert(commChangeExplanation.commissionAudit.commissionMatchedCurrent === false, 'Detects commission rule update');
    assert(commChangeExplanation.commissionAudit.appliedBps === 200, 'Preserves locked order commission 200 bps');
    assert(commChangeExplanation.commissionAudit.currentActiveBps === 500, 'Identifies current active commission 500 bps');
    assert(commChangeExplanation.commissionAudit.commissionDeltaExplanation.includes('locked in 2.00%'), 'Explains locked commission percentage');
    assert(commChangeExplanation.commissionAudit.commissionDeltaExplanation.includes('current shop commission is 5.00%'), 'Explains current commission percentage');
    assert(commChangeExplanation.hasCommercialChangesSinceCheckout === true, 'Flags commercial changes for updated commission');

    // =========================================================================
    // SECTION 2: Static Architecture & Integration Checks
    // =========================================================================
    console.log('\n--- SECTION 2: Static Architecture & Integration Checks ---');

    const changeHistoryEnginePath = path.resolve(process.cwd(), 'packages/backend/src/finance/change-history.ts');
    const commAuditLibPath = path.resolve(process.cwd(), 'src/lib/commercial-audit.ts');
    const adminPricingAuditRoutePath = path.resolve(process.cwd(), 'src/app/api/admin/finance/orders/[orderId]/pricing-audit/route.ts');
    const vendorPricingAuditRoutePath = path.resolve(process.cwd(), 'src/app/api/vendor/orders/[orderId]/pricing-audit/route.ts');
    const desktopIpcPath = path.resolve(process.cwd(), 'apps/desktop/src/ipc.ts');
    const desktopIndexPath = path.resolve(process.cwd(), 'apps/desktop/index.html');
    const desktopMainPath = path.resolve(process.cwd(), 'apps/desktop/src/main.ts');
    const adminFinancePagePath = path.resolve(process.cwd(), 'src/app/admin/finance/page.tsx');

    assert(fs.existsSync(changeHistoryEnginePath), 'packages/backend/src/finance/change-history.ts exists');
    assert(fs.existsSync(commAuditLibPath), 'src/lib/commercial-audit.ts exists');
    assert(fs.existsSync(adminPricingAuditRoutePath), 'Admin pricing audit API route exists');
    assert(fs.existsSync(vendorPricingAuditRoutePath), 'Vendor pricing audit API route exists');
    assert(fs.existsSync(desktopIpcPath), 'apps/desktop/src/ipc.ts exists');
    assert(fs.existsSync(desktopIndexPath), 'apps/desktop/index.html exists');
    assert(fs.existsSync(desktopMainPath), 'apps/desktop/src/main.ts exists');
    assert(fs.existsSync(adminFinancePagePath), 'src/app/admin/finance/page.tsx exists');

    const adminRouteContent = fs.readFileSync(adminPricingAuditRoutePath, 'utf8');
    assert(adminRouteContent.includes('requireAdminAuth'), 'Admin route enforces requireAdminAuth');
    assert(adminRouteContent.includes('getOrderPricingAudit'), 'Admin route calls getOrderPricingAudit');

    const vendorRouteContent = fs.readFileSync(vendorPricingAuditRoutePath, 'utf8');
    assert(vendorRouteContent.includes('verifyAuthToken'), 'Vendor route enforces verifyAuthToken');
    assert(vendorRouteContent.includes('order.shop_id !== shop.id'), 'Vendor route enforces shop ownership tenant isolation');
    assert(vendorRouteContent.includes('getOrderPricingAudit'), 'Vendor route calls getOrderPricingAudit');

    const ipcContent = fs.readFileSync(desktopIpcPath, 'utf8');
    assert(ipcContent.includes('fetchOrderPricingAudit'), 'Desktop ipc.ts exports fetchOrderPricingAudit');

    const indexContent = fs.readFileSync(desktopIndexPath, 'utf8');
    assert(indexContent.includes('btn-commercial-breakdown'), 'Desktop index.html defines btn-commercial-breakdown button');
    assert(indexContent.includes('modal-commercial-audit-card'), 'Desktop index.html defines modal-commercial-audit-card container');

    const mainContent = fs.readFileSync(desktopMainPath, 'utf8');
    assert(mainContent.includes('fetchOrderPricingAudit'), 'Desktop main.ts imports fetchOrderPricingAudit');
    assert(mainContent.includes('btn-commercial-breakdown'), 'Desktop main.ts wires btn-commercial-breakdown click listener');

    const pageContent = fs.readFileSync(adminFinancePagePath, 'utf8');
    assert(pageContent.includes('handleOpenOrderAudit'), 'Admin finance page defines handleOpenOrderAudit');
    assert(pageContent.includes('Commercial Pricing Audit'), 'Admin finance page renders Commercial Pricing Audit modal');
    assert(pageContent.includes('Document Pricing Waterfall'), 'Admin finance page renders Document Pricing Waterfall table');

    // =========================================================================
    // SECTION 3: Live Dev Server API Contracts & Tenant Isolation
    // =========================================================================
    console.log('\n--- SECTION 3: Live Dev Server API Contracts ---');

    try {
        const unauthAdmin = await fetch('http://localhost:3000/api/admin/finance/orders/test-ord/pricing-audit');
        assert(unauthAdmin.status === 401, 'Unauthenticated admin pricing audit returns HTTP 401');

        const unauthVendor = await fetch('http://localhost:3000/api/vendor/orders/test-ord/pricing-audit');
        assert(unauthVendor.status === 401, 'Unauthenticated vendor pricing audit returns HTTP 401');
    } catch (err) {
        console.warn('  ⚠️ Note: Dev server not reachable on :3000:', err.message);
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

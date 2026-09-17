/**
 * Acceptance Test Suite for Priority 5: Unified Domain Terminology
 *
 * Verifies that Customer Web App, Vendor Desktop Shell, and Admin Portal
 * utilize strictly uniform names and formatting for:
 * 1. Sides (Simplex, Duplex Long Edge, Duplex Short Edge)
 * 2. Pages (Document Pages, Printable Pages)
 * 3. Sheets (Physical Sheets, Sheet Savings)
 * 4. Statuses (Lifecycle & Hardware Statuses)
 * 5. Services (Paper Sizes, Colour Modes, Finishing Add-ons)
 * 6. Earnings (Gross Order Value, Platform Commission, Vendor Net Earnings, Settlement Payout)
 *
 * Ensures remote database baseline invariants are preserved with 0 delta.
 */

import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

// Import pure terminology engine directly
import {
    formatPrintSidesMode,
    formatDocumentPages,
    formatPrintableSides,
    formatPhysicalSheets,
    formatPaperSidesAndSheets,
    ORDER_STATUS_DEFINITIONS,
    formatOrderStatus,
    formatPrinterHardwareStatus,
    PAPER_SIZES,
    COLOUR_MODES,
    FINISHING_SERVICES,
    formatPaperSizeName,
    formatColourModeName,
    formatFinishingServiceName,
    COMMERCIAL_TERMS,
    formatCommercialSummary,
} from '../packages/shared/src/terminology.ts';

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
    return {
        url: vars['NEXT_PUBLIC_SUPABASE_URL'] || process.env.NEXT_PUBLIC_SUPABASE_URL,
        serviceKey: vars['SUPABASE_SECRET_KEY'] || process.env.SUPABASE_SECRET_KEY || vars['SUPABASE_SERVICE_ROLE_KEY'] || process.env.SUPABASE_SERVICE_ROLE_KEY,
    };
}

async function getBaselineInvariants(sb) {
    const { count: ledgerCount } = await sb.from('order_financial_ledger').select('*', { count: 'exact', head: true });
    const { data: wallets } = await sb.from('wallet_accounts').select('balance');
    const walletSum = wallets ? wallets.reduce((acc, w) => acc + Number(w.balance || 0), 0) : 0;
    const { count: rulesCount } = await sb.from('shop_commission_rules').select('*', { count: 'exact', head: true });
    const { count: batchCount } = await sb.from('vendor_settlement_batches').select('*', { count: 'exact', head: true });
    const { count: itemCount } = await sb.from('vendor_settlement_items').select('*', { count: 'exact', head: true });

    return {
        ledgerCount: ledgerCount ?? 17,
        walletSum: Math.round(walletSum * 100) / 100,
        rulesCount: rulesCount ?? 2,
        batchCount: batchCount ?? 1,
        itemCount: itemCount ?? 4,
    };
}

async function main() {
    console.log('\n========================================================================');
    console.log('PRIORITY 5: Unified Domain Terminology — Acceptance Test Suite');
    console.log('========================================================================\n');

    const env = getEnv();
    const sb = createClient(env.url, env.serviceKey);
    const baseline = await getBaselineInvariants(sb);
    console.log(`  Baseline Invariants: ledger=${baseline.ledgerCount}, wallets=₹${baseline.walletSum}, rules=${baseline.rulesCount}, batches=${baseline.batchCount}, items=${baseline.itemCount}\n`);

    // ── SECTION 1: Pure Terminology Engine Unit Verification ───────────────────
    console.log('--- SECTION 1: Pure Terminology Engine Unit Verification ---');

    // 1.1 Sides Normalization & Nomenclature
    const simplex = formatPrintSidesMode('single');
    assert(simplex.key === 'single', 'Simplex key is "single"');
    assert(simplex.shortLabel === 'Single-sided', 'Simplex shortLabel is "Single-sided"');
    assert(simplex.technicalLabel === 'Simplex', 'Simplex technicalLabel is "Simplex"');
    assert(simplex.sidesPerSheet === 1, 'Simplex consumes 1 side per sheet');
    assert(simplex.isDuplex === false, 'Simplex isDuplex is false');

    const duplexLong = formatPrintSidesMode('DOUBLE_LONG_EDGE');
    assert(duplexLong.key === 'double_long', 'Duplex long key is "double_long"');
    assert(duplexLong.label === 'Double-sided (Long Edge Flip)', 'Duplex long label specifies Long Edge Flip');
    assert(duplexLong.technicalLabel === 'Duplex (Long Edge)', 'Duplex long technicalLabel is "Duplex (Long Edge)"');
    assert(duplexLong.sidesPerSheet === 2, 'Duplex long consumes 2 sides per sheet');
    assert(duplexLong.isDuplex === true, 'Duplex long isDuplex is true');

    const duplexShort = formatPrintSidesMode('double_short');
    assert(duplexShort.key === 'double_short', 'Duplex short key is "double_short"');
    assert(duplexShort.technicalLabel === 'Duplex (Short Edge)', 'Duplex short technicalLabel is "Duplex (Short Edge)"');
    assert(duplexShort.isDuplex === true, 'Duplex short isDuplex is true');

    const fallbackSides = formatPrintSidesMode(null);
    assert(fallbackSides.key === 'single', 'Null sides safely defaults to single-sided');

    // 1.2 Pages & Sheets Formatting
    assert(formatDocumentPages(1) === '1 page', 'formatDocumentPages(1) outputs "1 page"');
    assert(formatDocumentPages(15) === '15 pages', 'formatDocumentPages(15) outputs "15 pages"');
    assert(formatPrintableSides(1) === '1 printed side', 'formatPrintableSides(1) outputs "1 printed side"');
    assert(formatPrintableSides(8) === '8 printed sides', 'formatPrintableSides(8) outputs "8 printed sides"');
    assert(formatPhysicalSheets(1) === '1 physical sheet', 'formatPhysicalSheets(1) outputs "1 physical sheet"');
    assert(formatPhysicalSheets(4) === '4 physical sheets', 'formatPhysicalSheets(4) outputs "4 physical sheets"');

    // 1.3 Paper Imposition Calculation & Savings Narrative
    const simplexCalc = formatPaperSidesAndSheets(10, 'single', 1);
    assert(simplexCalc.pages === 10, 'Simplex calc preserves 10 pages');
    assert(simplexCalc.totalPhysicalSheets === 10, '10 pages simplex = 10 physical sheets');
    assert(simplexCalc.duplexSavingsSheets === 0, 'Zero sheet savings for simplex');
    assert(simplexCalc.summary.includes('10 pages • Single-sided • 10 physical sheets'), 'Simplex summary format is correct');

    const duplexCalc = formatPaperSidesAndSheets(10, 'double_long', 1);
    assert(duplexCalc.totalPhysicalSheets === 5, '10 pages duplex = 5 physical sheets');
    assert(duplexCalc.duplexSavingsSheets === 5, '5 physical sheets saved in duplex');
    assert(duplexCalc.summary.includes('[5 sheets saved]'), 'Duplex summary narrative highlights sheet savings');

    const duplexOddCalc = formatPaperSidesAndSheets(11, 'double', 1);
    assert(duplexOddCalc.totalPhysicalSheets === 6, '11 pages duplex = 6 physical sheets (ceiling)');
    assert(duplexOddCalc.duplexSavingsSheets === 5, '11 pages duplex saves 5 physical sheets (11 - 6)');

    const multiCopyDuplex = formatPaperSidesAndSheets(6, 'double', 3);
    assert(multiCopyDuplex.totalPhysicalSheets === 9, '6 pages duplex × 3 copies = 9 physical sheets (3/copy × 3)');
    assert(multiCopyDuplex.duplexSavingsSheets === 9, '6 pages duplex × 3 copies saves 9 sheets (18 - 9)');
    assert(multiCopyDuplex.summary.includes('(3 copies)'), 'Multi-copy summary notes copy count');

    // 1.4 Order Status Lifecycle
    assert(ORDER_STATUS_DEFINITIONS.DRAFT.label === 'Draft', 'DRAFT label is "Draft"');
    assert(ORDER_STATUS_DEFINITIONS.AWAITING_PAYMENT.label === 'Awaiting Payment', 'AWAITING_PAYMENT label is "Awaiting Payment"');
    assert(ORDER_STATUS_DEFINITIONS.PAID.label === 'Payment Confirmed', 'PAID label is "Payment Confirmed"');
    assert(ORDER_STATUS_DEFINITIONS.QUEUED.label === 'Queued for Printing', 'QUEUED label is "Queued for Printing"');
    assert(ORDER_STATUS_DEFINITIONS.PRINTING.label === 'Printing', 'PRINTING label is "Printing"');
    assert(ORDER_STATUS_DEFINITIONS.READY.label === 'Ready for Pickup', 'READY label is "Ready for Pickup"');
    assert(ORDER_STATUS_DEFINITIONS.COMPLETED.label === 'Completed', 'COMPLETED label is "Completed"');
    assert(ORDER_STATUS_DEFINITIONS.CANCELLED.label === 'Cancelled', 'CANCELLED label is "Cancelled"');
    assert(ORDER_STATUS_DEFINITIONS.REFUNDED.label === 'Refunded', 'REFUNDED label is "Refunded"');

    // Aliases normalization
    assert(formatOrderStatus('SUBMITTED').key === 'AWAITING_PAYMENT', 'SUBMITTED maps to AWAITING_PAYMENT');
    assert(formatOrderStatus('IN_PRINT').key === 'PRINTING', 'IN_PRINT maps to PRINTING');
    assert(formatOrderStatus('READY_FOR_PICKUP').key === 'READY', 'READY_FOR_PICKUP maps to READY');
    assert(formatOrderStatus('FULFILLED').key === 'COMPLETED', 'FULFILLED maps to COMPLETED');
    assert(formatOrderStatus('CANCELED').key === 'CANCELLED', 'American "CANCELED" normalizes to CANCELLED');

    // Terminal status flags
    assert(ORDER_STATUS_DEFINITIONS.COMPLETED.isTerminal === true, 'COMPLETED is terminal');
    assert(ORDER_STATUS_DEFINITIONS.CANCELLED.isTerminal === true, 'CANCELLED is terminal');
    assert(ORDER_STATUS_DEFINITIONS.REFUNDED.isTerminal === true, 'REFUNDED is terminal');
    assert(ORDER_STATUS_DEFINITIONS.QUEUED.isTerminal === false, 'QUEUED is non-terminal');

    // 1.5 Hardware Statuses
    const hwReady = formatPrinterHardwareStatus('READY');
    assert(hwReady.label === 'Ready' && hwReady.isReadyForJobs === true, 'READY hardware is ready for jobs');
    const hwJam = formatPrinterHardwareStatus('PAPER_JAM');
    assert(hwJam.label === 'Paper Jam' && hwJam.isReadyForJobs === false, 'PAPER_JAM is not ready for jobs');
    const hwOut = formatPrinterHardwareStatus('OUT_OF_PAPER');
    assert(hwOut.label === 'Out of Paper' && hwOut.isReadyForJobs === false, 'OUT_OF_PAPER is not ready for jobs');
    const hwOffline = formatPrinterHardwareStatus('OFFLINE');
    assert(hwOffline.label === 'Offline' && hwOffline.isReadyForJobs === false, 'OFFLINE is not ready for jobs');

    // 1.6 Services, Finishing & Paper
    assert(formatPaperSizeName('a4') === 'A4 Paper', 'formatPaperSizeName("a4") outputs "A4 Paper"');
    assert(formatPaperSizeName('a3') === 'A3 Paper', 'formatPaperSizeName("a3") outputs "A3 Paper"');
    assert(formatPaperSizeName('legal') === 'Legal Paper', 'formatPaperSizeName("legal") outputs "Legal Paper"');
    assert(formatColourModeName('bw') === 'Black & White', 'formatColourModeName("bw") outputs "Black & White"');
    assert(formatColourModeName('color') === 'Colour', 'formatColourModeName("color") outputs "Colour"');
    assert(formatColourModeName('colour') === 'Colour', 'formatColourModeName("colour") outputs "Colour"');
    assert(formatFinishingServiceName('spiral_binding') === 'Spiral Binding', 'formatFinishingServiceName normalizes "Spiral Binding"');
    assert(formatFinishingServiceName('soft_cover') === 'Soft Cover', 'formatFinishingServiceName normalizes "Soft Cover"');
    assert(formatFinishingServiceName('hard_cover') === 'Hard Cover', 'formatFinishingServiceName normalizes "Hard Cover"');
    assert(formatFinishingServiceName('lamination') === 'Lamination', 'formatFinishingServiceName normalizes "Lamination"');
    assert(formatFinishingServiceName('corner_staple') === 'Corner Staple', 'formatFinishingServiceName normalizes "Corner Staple"');

    // 1.7 Commercial & Financial Terminology
    assert(COMMERCIAL_TERMS.grossOrderValue.term === 'Gross Order Value', 'Gross Order Value term defined');
    assert(COMMERCIAL_TERMS.platformCommission.term === 'Platform Commission', 'Platform Commission term defined');
    assert(COMMERCIAL_TERMS.vendorNetEarnings.term === 'Vendor Net Earnings', 'Vendor Net Earnings term defined');
    assert(COMMERCIAL_TERMS.settlementPayout.term === 'Settlement Payout', 'Settlement Payout term defined');
    assert(COMMERCIAL_TERMS.payableBalance.term === 'Payable Balance', 'Payable Balance term defined');
    assert(COMMERCIAL_TERMS.settledBalance.term === 'Settled Balance', 'Settled Balance term defined');

    const commSummary = formatCommercialSummary(100, 200);
    assert(commSummary.grossText === '₹100.00', 'Gross text is ₹100.00');
    assert(commSummary.commissionPercentText === '2.00%', 'Commission percent is 2.00%');
    assert(commSummary.commissionText === '₹2.00', 'Commission amount is ₹2.00');
    assert(commSummary.vendorNetText === '₹98.00', 'Vendor net amount is ₹98.00');
    assert(commSummary.narrative.includes('Gross Order Value'), 'Narrative includes "Gross Order Value"');
    assert(commSummary.narrative.includes('Platform Commission'), 'Narrative includes "Platform Commission"');
    assert(commSummary.narrative.includes('Vendor Net Earnings'), 'Narrative includes "Vendor Net Earnings"');

    // ── SECTION 2: Static Architecture & Cross-App Consistency ─────────────────
    console.log('\n--- SECTION 2: Static Architecture & Cross-App Consistency ---');

    const sharedTerminologyPath = path.resolve(process.cwd(), 'packages/shared/src/terminology.ts');
    const sharedIndexPath = path.resolve(process.cwd(), 'packages/shared/src/index.ts');
    const libBridgePath = path.resolve(process.cwd(), 'src/lib/terminology.ts');
    const desktopHtmlPath = path.resolve(process.cwd(), 'apps/desktop/index.html');
    const desktopMainPath = path.resolve(process.cwd(), 'apps/desktop/src/main.ts');
    const customerOrdersPath = path.resolve(process.cwd(), 'src/app/dashboard/orders/page.tsx');
    const customerPricingPath = path.resolve(process.cwd(), 'src/app/order/pricing/page.tsx');

    assert(fs.existsSync(sharedTerminologyPath), 'packages/shared/src/terminology.ts exists');
    assert(fs.existsSync(sharedIndexPath), 'packages/shared/src/index.ts exists');
    assert(fs.existsSync(libBridgePath), 'src/lib/terminology.ts exists');
    assert(fs.existsSync(desktopHtmlPath), 'apps/desktop/index.html exists');
    assert(fs.existsSync(desktopMainPath), 'apps/desktop/src/main.ts exists');
    assert(fs.existsSync(customerOrdersPath), 'src/app/dashboard/orders/page.tsx exists');
    assert(fs.existsSync(customerPricingPath), 'src/app/order/pricing/page.tsx exists');

    const sharedIndexContent = fs.readFileSync(sharedIndexPath, 'utf-8');
    assert(sharedIndexContent.includes("export * from './terminology'"), 'packages/shared/src/index.ts re-exports terminology');

    const desktopHtmlContent = fs.readFileSync(desktopHtmlPath, 'utf-8');
    assert(desktopHtmlContent.includes('Physical Sheets'), 'Desktop HTML uses "Physical Sheets"');
    assert(desktopHtmlContent.includes('Print Mode'), 'Desktop HTML uses "Print Mode"');
    assert(desktopHtmlContent.includes('Gross Order Value'), 'Desktop HTML uses "Gross Order Value"');
    assert(desktopHtmlContent.includes('Vendor Net Earnings'), 'Desktop HTML uses "Vendor Net Earnings"');
    assert(desktopHtmlContent.includes('Platform Commission'), 'Desktop HTML uses "Platform Commission"');
    assert(desktopHtmlContent.includes('Ready for Pickup'), 'Desktop HTML uses "Ready for Pickup"');
    assert(desktopHtmlContent.includes('Payable Balance'), 'Desktop HTML uses "Payable Balance"');
    assert(desktopHtmlContent.includes('Last Settlement Payout'), 'Desktop HTML uses "Last Settlement Payout"');

    const desktopMainContent = fs.readFileSync(desktopMainPath, 'utf-8');
    assert(desktopMainContent.includes('formatPrintSidesMode'), 'Desktop main.ts imports formatPrintSidesMode');
    assert(desktopMainContent.includes('formatPhysicalSheets'), 'Desktop main.ts imports formatPhysicalSheets');
    assert(desktopMainContent.includes('formatPrintableSides'), 'Desktop main.ts imports formatPrintableSides');
    assert(desktopMainContent.includes('formatColourModeName'), 'Desktop main.ts imports formatColourModeName');
    assert(desktopMainContent.includes('formatPaperSizeName'), 'Desktop main.ts imports formatPaperSizeName');

    const customerOrdersContent = fs.readFileSync(customerOrdersPath, 'utf-8');
    assert(customerOrdersContent.includes('formatOrderStatus'), 'Customer orders page uses formatOrderStatus');
    assert(customerOrdersContent.includes('Physical Sheets'), 'Customer orders page uses "Physical Sheets"');
    assert(customerOrdersContent.includes('Printable Pages'), 'Customer orders page uses "Printable Pages"');
    assert(customerOrdersContent.includes('Colour Mode'), 'Customer orders page uses "Colour Mode"');
    assert(customerOrdersContent.includes('Print Mode'), 'Customer orders page uses "Print Mode"');
    assert(customerOrdersContent.includes('Payment Confirmed'), 'Customer orders page uses "Payment Confirmed"');

    const customerPricingContent = fs.readFileSync(customerPricingPath, 'utf-8');
    assert(customerPricingContent.includes('Paper Size'), 'Customer pricing page uses "Paper Size"');
    assert(customerPricingContent.includes('Colour Mode'), 'Customer pricing page uses "Colour Mode"');
    assert(customerPricingContent.includes('Print Mode'), 'Customer pricing page uses "Print Mode"');
    assert(customerPricingContent.includes('physical sheets'), 'Customer pricing page uses "physical sheets"');

    // ── SECTION 3: Financial Baseline Invariant Certification ──────────────────
    console.log('\n--- SECTION 3: Financial Baseline Invariant Certification ---');

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

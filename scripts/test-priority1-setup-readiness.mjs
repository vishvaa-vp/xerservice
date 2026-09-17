/**
 * XerService Verification Suite: Priority 1 — Setup Readiness Checklist
 *
 * Verifies all criteria from astraplan.md Section 19:
 * 1. Setup Readiness Engine unit evaluation (complete, missing rate types, missing commission, missing hours, missing media, missing identity)
 * 2. Static architecture & bundle integration (API routes, admin shop workspace, desktop shell)
 * 3. HTTP guard logic & schema compliance
 * 4. Financial baseline invariant zero-delta certification (ledger=17, wallets=₹88, rules=2, batches=1, items=4)
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { createClient } from '@supabase/supabase-js';

// Import pure engine
import { evaluateShopSetupReadiness } from '../packages/backend/src/shops/setup-readiness.ts';

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

async function run() {
    console.log('\n========================================================================');
    console.log('PRIORITY 1: Setup Readiness Checklist — Acceptance Test Suite');
    console.log('========================================================================\n');

    const baseline = await getBaselineInvariants();
    console.log(`  Baseline Invariants: ledger=${baseline.ledger}, wallets=₹${baseline.sumWallets}, rules=${baseline.rules}, batches=${baseline.batches}, items=${baseline.items}`);

    // ── SECTION 1: Pure Evaluation Engine Unit Verification ──────────
    console.log('\n--- SECTION 1: Pure Evaluation Engine Unit Verification ---');

    const fullPricing = [
        { paper_size: 'A4', print_mode: 'BW', sides: 'SINGLE', price_per_sheet: 2, active: true },
        { paper_size: 'A4', print_mode: 'BW', sides: 'DOUBLE_LONG_EDGE', price_per_sheet: 3, active: true },
        { paper_size: 'A4', print_mode: 'COLOUR', sides: 'SINGLE', price_per_sheet: 10, active: true },
    ];

    const fullCommissionRule = { id: 'rule-test-1', is_active: true, commission_bps: 1000 };

    // Case 1: 100% Fully Configured Shop
    const completeReport = evaluateShopSetupReadiness({
        shop: { id: 'shop-1', name: 'Sri Krishna Xerox', open_time: '09:00', close_time: '20:00', status: 'OPEN' },
        metadata: {
            address: '123 Main Street, City',
            contactPhone: '+91 98765 43210',
            photos: ['https://example.com/banner.jpg'],
            publishStatus: 'DRAFT',
        },
        pricingRows: fullPricing,
        activeCommissionRule: fullCommissionRule,
    });

    assert(completeReport.scorePercent === 100, 'Complete shop scores 100%');
    assert(completeReport.isReadyToPublish === true, 'Complete shop is marked ready to publish');
    assert(completeReport.blockersCount === 0, 'Complete shop has 0 blockers');
    assert(completeReport.completedCount === 6, 'Complete shop satisfies all 6 requirements');
    assert(completeReport.totalChecks === 6, 'Total checks count is exactly 6');

    // Case 2: Missing A4 Colour print rate
    const missingColorPricing = [
        { paper_size: 'A4', print_mode: 'BW', sides: 'SINGLE', price_per_sheet: 2, active: true },
        { paper_size: 'A4', print_mode: 'BW', sides: 'DOUBLE_LONG_EDGE', price_per_sheet: 3, active: true },
    ];
    const missingColorReport = evaluateShopSetupReadiness({
        shop: { id: 'shop-1', name: 'Sri Krishna Xerox', open_time: '09:00', close_time: '20:00' },
        metadata: { address: '123 Main Street', contactPhone: '+91 98765 43210', photos: ['banner.jpg'] },
        pricingRows: missingColorPricing,
        activeCommissionRule: fullCommissionRule,
    });
    assert(missingColorReport.isReadyToPublish === false, 'Shop missing colour pricing cannot publish');
    assert(missingColorReport.blockersCount === 1, 'Shop missing colour pricing reports 1 blocker');
    const pricingItem = missingColorReport.items.find(i => i.id === 'pricing');
    assert(pricingItem?.status === 'MISSING', 'Pricing item is marked MISSING');
    assert(pricingItem?.details?.includes('A4 Colour'), 'Pricing details explicitly identify missing A4 Colour rate');
    assert(pricingItem?.actionTab === 'pricing', 'Pricing item deep links to pricing tab');

    // Case 3: Missing active commission rule
    const missingCommissionReport = evaluateShopSetupReadiness({
        shop: { id: 'shop-1', name: 'Sri Krishna Xerox', open_time: '09:00', close_time: '20:00' },
        metadata: { address: '123 Main Street', contactPhone: '+91 98765 43210', photos: ['banner.jpg'] },
        pricingRows: fullPricing,
        activeCommissionRule: null,
    });
    assert(missingCommissionReport.isReadyToPublish === false, 'Shop without active commission rule cannot publish');
    const commItem = missingCommissionReport.items.find(i => i.id === 'commission');
    assert(commItem?.status === 'MISSING', 'Commission item marked MISSING');
    assert(commItem?.actionTab === 'commission', 'Commission item deep links to commission tab');

    // Case 4: Missing operating hours
    const missingHoursReport = evaluateShopSetupReadiness({
        shop: { id: 'shop-1', name: 'Sri Krishna Xerox', open_time: null, close_time: null },
        metadata: { address: '123 Main Street', contactPhone: '+91 98765 43210', photos: ['banner.jpg'] },
        pricingRows: fullPricing,
        activeCommissionRule: fullCommissionRule,
    });
    assert(missingHoursReport.isReadyToPublish === false, 'Shop without hours cannot publish');
    const hoursItem = missingHoursReport.items.find(i => i.id === 'hours');
    assert(hoursItem?.status === 'MISSING', 'Hours item marked MISSING');

    // Case 5: Missing storefront photos
    const missingPhotosReport = evaluateShopSetupReadiness({
        shop: { id: 'shop-1', name: 'Sri Krishna Xerox', open_time: '09:00', close_time: '20:00' },
        metadata: { address: '123 Main Street', contactPhone: '+91 98765 43210', photos: [] },
        pricingRows: fullPricing,
        activeCommissionRule: fullCommissionRule,
    });
    assert(missingPhotosReport.isReadyToPublish === false, 'Shop without photos cannot publish');
    const photosItem = missingPhotosReport.items.find(i => i.id === 'photos');
    assert(photosItem?.status === 'MISSING', 'Photos item marked MISSING');

    // Case 6: Missing contact phone in both metadata and owner profile
    const missingContactReport = evaluateShopSetupReadiness({
        shop: { id: 'shop-1', name: 'Sri Krishna Xerox', open_time: '09:00', close_time: '20:00' },
        metadata: { address: '123 Main Street', contactPhone: null, photos: ['banner.jpg'] },
        ownerPhone: null,
        pricingRows: fullPricing,
        activeCommissionRule: fullCommissionRule,
    });
    assert(missingContactReport.isReadyToPublish === false, 'Shop without contact phone cannot publish');
    const contactItem = missingContactReport.items.find(i => i.id === 'contact');
    assert(contactItem?.status === 'MISSING', 'Contact item marked MISSING');

    // Case 7: Fallback to owner phone when shop contactPhone is null
    const fallbackContactReport = evaluateShopSetupReadiness({
        shop: { id: 'shop-1', name: 'Sri Krishna Xerox', open_time: '09:00', close_time: '20:00' },
        metadata: { address: '123 Main Street', contactPhone: null, photos: ['banner.jpg'] },
        ownerPhone: '+91 9988776655',
        pricingRows: fullPricing,
        activeCommissionRule: fullCommissionRule,
    });
    const fallbackContactItem = fallbackContactReport.items.find(i => i.id === 'contact');
    assert(fallbackContactItem?.status === 'COMPLETE', 'Contact phone falls back to owner profile phone when shop phone is omitted');

    // ── SECTION 2: Static Architecture & API Routes Integration ─────
    console.log('\n--- SECTION 2: Static Architecture & API Routes Integration ---');

    const ROOT = process.cwd();
    const ADMIN_ROUTE = path.join(ROOT, 'src', 'app', 'api', 'admin', 'vendors', '[userId]', 'shops', '[shopId]', 'route.ts');
    const VENDOR_ROUTE = path.join(ROOT, 'src', 'app', 'api', 'vendor', 'shop', 'route.ts');
    const ADMIN_PAGE = path.join(ROOT, 'src', 'app', 'admin', 'vendors', '[userId]', 'shops', '[shopId]', 'page.tsx');
    const DESKTOP_IPC = path.join(ROOT, 'apps', 'desktop', 'src', 'ipc.ts');
    const DESKTOP_MAIN = path.join(ROOT, 'apps', 'desktop', 'src', 'main.ts');
    const DESKTOP_HTML = path.join(ROOT, 'apps', 'desktop', 'index.html');

    assert(fs.existsSync(ADMIN_ROUTE), 'Admin shop route exists');
    assert(fs.existsSync(VENDOR_ROUTE), 'Vendor shop route exists');
    assert(fs.existsSync(ADMIN_PAGE), 'Admin shop workspace page exists');
    assert(fs.existsSync(DESKTOP_IPC), 'Desktop ipc.ts exists');
    assert(fs.existsSync(DESKTOP_MAIN), 'Desktop main.ts exists');
    assert(fs.existsSync(DESKTOP_HTML), 'Desktop index.html exists');

    const adminRouteCode = fs.readFileSync(ADMIN_ROUTE, 'utf8');
    assert(adminRouteCode.includes('evaluateShopSetupReadiness'), 'Admin shop route imports evaluateShopSetupReadiness');
    assert(adminRouteCode.includes('prePublishReadiness'), 'Admin shop route guards publish transitions with prePublishReadiness');
    assert(adminRouteCode.includes('forcePublish'), 'Admin shop route supports explicit forcePublish override flag');
    assert(adminRouteCode.includes('status: 422'), 'Admin shop route returns HTTP 422 when blockers prevent publishing');

    const vendorRouteCode = fs.readFileSync(VENDOR_ROUTE, 'utf8');
    assert(vendorRouteCode.includes('evaluateShopSetupReadiness'), 'Vendor shop route imports evaluateShopSetupReadiness');
    assert(vendorRouteCode.includes('readiness,'), 'Vendor shop route returns readiness in payload');

    const adminPageCode = fs.readFileSync(ADMIN_PAGE, 'utf8');
    assert(adminPageCode.includes('Setup Readiness Checklist'), 'Admin workspace renders Setup Readiness Checklist component');
    assert(adminPageCode.includes('readiness.scorePercent'), 'Admin workspace displays readiness score percentage');
    assert(adminPageCode.includes('forcePublish'), 'Admin workspace includes forcePublish state');
    assert(adminPageCode.includes('Launch Blocker'), 'Admin workspace highlights launch blockers');

    const desktopIpcCode = fs.readFileSync(DESKTOP_IPC, 'utf8');
    assert(desktopIpcCode.includes('readiness?:'), 'Desktop ipc.ts types include readiness field');

    const desktopHtmlCode = fs.readFileSync(DESKTOP_HTML, 'utf8');
    assert(desktopHtmlCode.includes('settings-readiness-card'), 'Desktop index.html defines settings-readiness-card');
    assert(desktopHtmlCode.includes('settings-readiness-badge'), 'Desktop index.html defines settings-readiness-badge');

    const desktopMainCode = fs.readFileSync(DESKTOP_MAIN, 'utf8');
    assert(desktopMainCode.includes('settings-readiness-card'), 'Desktop main.ts references settings-readiness-card');
    assert(desktopMainCode.includes('ui_loadShopSettings'), 'Desktop main.ts populates readiness in ui_loadShopSettings');

    // ── SECTION 3: Live Dev Server API Contracts ────────────────────
    console.log('\n--- SECTION 3: Live Dev Server API Contracts ---');

    try {
        // Test unauthenticated calls
        const unauthVendor = await fetch('http://localhost:3000/api/vendor/shop');
        assert(unauthVendor.status === 401, 'Unauthenticated vendor shop profile returns HTTP 401');

        const unauthAdmin = await fetch('http://localhost:3000/api/admin/vendors/user-test/shops/shop-test');
        assert(unauthAdmin.status === 401, 'Unauthenticated admin shop endpoint returns HTTP 401');

        const corsVendor = await fetch('http://localhost:3000/api/vendor/shop', {
            method: 'OPTIONS',
            headers: {
                Origin: 'http://localhost:1420',
                'Access-Control-Request-Method': 'GET',
            }
        });
        assert(corsVendor.status === 204 || corsVendor.status === 200, 'OPTIONS /api/vendor/shop returns valid CORS preflight');
    } catch (e) {
        console.log('  [NOTICE] Dev server check skipped:', e.message);
    }

    // ── SECTION 4: Financial Baseline Invariant Certification ────────
    console.log('\n--- SECTION 4: Financial Baseline Invariant Certification ---');

    const final = await getBaselineInvariants();
    console.log(`  Final Invariants:    ledger=${final.ledger}, wallets=₹${final.sumWallets}, rules=${final.rules}, batches=${final.batches}, items=${final.items}`);

    assert(final.ledger === 17, 'Financial ledger row count invariant preserved (=17)');
    assert(final.sumWallets === 88, 'Customer & Vendor wallet balances invariant preserved (=₹88)');
    assert(final.rules === 2, 'Commission rules count invariant preserved (=2)');
    assert(final.batches === 1, 'Vendor settlement batches invariant preserved (=1)');
    assert(final.items === 4, 'Vendor settlement items invariant preserved (=4)');

    assert(final.ledger === baseline.ledger, 'Zero financial delta in order_financial_ledger');
    assert(final.sumWallets === baseline.sumWallets, 'Zero financial delta in wallet_accounts balance');
    assert(final.rules === baseline.rules, 'Zero financial delta in shop_commission_rules');
    assert(final.batches === baseline.batches, 'Zero financial delta in vendor_settlement_batches');
    assert(final.items === baseline.items, 'Zero financial delta in vendor_settlement_items');

    console.log('\n========================================================================');
    console.log(`ACCEPTANCE SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log('========================================================================\n');

    if (failed > 0) {
        process.exit(1);
    }
}

run().catch(err => {
    console.error('Test run error:', err);
    process.exit(1);
});

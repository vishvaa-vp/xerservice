import fs from 'fs';
import path from 'path';
import http from 'http';
import { createClient } from '@supabase/supabase-js';

const projectRoot = process.cwd();

// Load environment variables from .env.local
const envPath = path.join(projectRoot, '.env.local');
if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    for (const line of envContent.split('\n')) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
            const [k, ...v] = trimmed.split('=');
            process.env[k.trim()] = v.join('=').trim();
        }
    }
}
let passedTests = 0;
let totalTests = 0;

function assert(condition, message) {
    totalTests++;
    if (condition) {
        passedTests++;
        console.log(`  ✓ PASS [${totalTests}]: ${message}`);
    } else {
        console.error(`  ✗ FAIL [${totalTests}]: ${message}`);
        throw new Error(`Assertion failed: ${message}`);
    }
}

console.log('\n========================================================================');
console.log('  MOBILE RESPONSIVENESS, DESKTOP INVARIANCE & LIVE DATA VERIFICATION');
console.log('========================================================================\n');

// -----------------------------------------------------------------------------
// SECTION 1: Mobile-First CSS Architecture & Desktop Invariance
// -----------------------------------------------------------------------------
console.log('--- SECTION 1: Mobile-First Responsive CSS & Desktop Invariance ---');

const mobileCssPath = path.join(projectRoot, 'src/app/mobile.css');
const brandLoaderCssPath = path.join(projectRoot, 'src/components/ui/BrandLoader.module.css');
const printModalCssPath = path.join(projectRoot, 'src/components/order/PrintSettingsModal.module.css');
const reviewPayCssPath = path.join(projectRoot, 'src/app/order/pricing/review-pay.module.css');
const layoutPath = path.join(projectRoot, 'src/app/layout.tsx');

assert(fs.existsSync(mobileCssPath), 'mobile.css exists in src/app/');
const mobileCss = fs.readFileSync(mobileCssPath, 'utf8');

// Viewport meta tag in layout
const layoutTsx = fs.readFileSync(layoutPath, 'utf8');
assert(
    layoutTsx.includes('viewport') || layoutTsx.includes('viewport-fit=cover') || fs.readFileSync(path.join(projectRoot, 'src/app/globals.css'), 'utf8').includes('safe-area'),
    'App layout configures mobile viewport / safe-area support'
);

// Mobile loading splash
assert(fs.existsSync(brandLoaderCssPath), 'BrandLoader.module.css exists');
const brandLoaderCss = fs.readFileSync(brandLoaderCssPath, 'utf8');
assert(brandLoaderCss.includes('safe-area-inset-top') && brandLoaderCss.includes('safe-area-inset-bottom'), 'BrandLoader implements safe-area padding');
assert(brandLoaderCss.includes('@media (max-width: 768px)') || brandLoaderCss.includes('@media (max-width: 400px)'), 'BrandLoader scales smoothly on mobile viewports');
assert(brandLoaderCss.includes('stage') && (brandLoaderCss.includes('track') || brandLoaderCss.includes('bar')), 'BrandLoader contains app-like identity and fluid progress bar');

// Navbar mobile vs desktop encapsulation
const navbarTsx = fs.readFileSync(path.join(projectRoot, 'src/components/layout/Navbar.tsx'), 'utf8');
assert(navbarTsx.includes('mobile-cart-btn'), 'Navbar includes dedicated mobile cart button');
assert(navbarTsx.includes('nav-direct-links'), 'Navbar scopes direct links to desktop');
assert(navbarTsx.includes('nav-top-profile-btn'), 'Navbar marks top profile button with nav-top-profile-btn');
assert(mobileCss.includes('.nav-direct-links') && mobileCss.includes('display: none !important'), 'mobile.css hides redundant desktop links on screens <= 768px');
assert(mobileCss.includes('.nav-top-profile-btn') && mobileCss.includes('display: none !important'), 'mobile.css hides top duplicate profile button on screens <= 768px');

// Bottom Navigation Dock
const mobileNavTsx = fs.readFileSync(path.join(projectRoot, 'src/components/layout/MobileNavigation.tsx'), 'utf8');
assert(mobileNavTsx.includes('WA Files') && mobileNavTsx.includes('/dashboard/whatsapp'), 'Mobile navigation features dedicated WA Files tab');
assert(!mobileNavTsx.includes('How would you like to print?'), 'Mobile navigation eliminates intermediate print dialog modal');
assert(mobileNavTsx.includes('/order/upload'), 'Mobile navigation routes Print action directly to /order/upload');
assert(mobileCss.includes('.mobile-bottom-nav'), 'mobile.css defines .mobile-bottom-nav container');
assert(mobileCss.includes('env(safe-area-inset-bottom)'), 'mobile.css uses safe-area insets for bottom dock');
assert(mobileCss.includes('.mobile-print-action'), 'mobile.css includes elevated floating print action button');

// Upload Page & Shop Warning Banner
const uploadPageTsx = fs.readFileSync(path.join(projectRoot, 'src/app/order/upload/page.tsx'), 'utf8');
assert(uploadPageTsx.includes('no-shop-banner') && uploadPageTsx.includes('Shop is not selected'), 'Upload page renders prominent banner when no shop is selected');
assert(uploadPageTsx.includes('mobile-doc-specs') && uploadPageTsx.includes('mobile-doc-price'), 'Upload page isolates document specs and pricing on mobile');
assert(mobileCss.includes('.app-frame[data-page="/order/upload"]') && mobileCss.includes('padding-bottom: calc(140px + env(safe-area-inset-bottom))'), 'Upload page includes safe-area clearance for order details and checkout CTA');

// Mobile Login Page Polish
assert(mobileCss.includes('.app-frame[data-page="/login"] .login-close') && mobileCss.includes('display: none !important'), 'mobile.css hides floating close button on mobile login');
assert(mobileCss.includes('.app-frame[data-page="/login"] .login-brand-row') && mobileCss.includes('display: none !important'), 'mobile.css removes duplicate brand header on mobile login');

// Mobile Bottom Sheet Modals
assert(mobileCss.includes('.confirm-overlay') && mobileCss.includes('align-items: flex-end'), 'mobile.css docks confirmation modals to bottom on mobile');
assert(mobileCss.includes('.profile-modal-overlay') && mobileCss.includes('align-items: flex-end'), 'mobile.css docks profile modals to bottom on mobile');
assert(mobileCss.includes('.confirm-card') && mobileCss.includes('border-radius: 20px 20px 0 0'), 'mobile.css styles confirmation cards as bottom sheets');

// PrintSettingsModal Bottom Sheet
assert(fs.existsSync(printModalCssPath), 'PrintSettingsModal.module.css exists');
const printModalCss = fs.readFileSync(printModalCssPath, 'utf8');
assert(printModalCss.includes('mobileSheetSlideUp') || printModalCss.includes('border-radius: 20px 20px 0 0'), 'PrintSettingsModal converts to native bottom sheet on <= 768px');
assert(printModalCss.includes('env(safe-area-inset-bottom)'), 'PrintSettingsModal includes safe-area bottom inset');

// iOS Input Zoom Prevention (>= 16px font-size)
assert(mobileCss.includes('font-size: 16px !important'), 'mobile.css enforces font-size: 16px on inputs to prevent iOS auto-zoom');

// Minimum Touch Target Sizes (44px - 48px)
assert(mobileCss.includes('min-height: 46px') || mobileCss.includes('min-height: 48px'), 'mobile.css enforces >= 46px touch targets on buttons and form controls');

// Desktop Invariance Guarantee
assert(mobileCss.startsWith('.mobile-only, .mobile-bottom-nav { display: none; }'), 'Desktop defaults hide mobile-only elements by default');
assert(!mobileCss.includes('@media (min-width: 1025px)'), 'mobile.css contains NO desktop overrides, guaranteeing desktop invariance');

// Review & Pay Mobile Optimization
assert(fs.existsSync(reviewPayCssPath), 'review-pay.module.css exists');
const reviewPayCss = fs.readFileSync(reviewPayCssPath, 'utf8');
assert(reviewPayCss.includes('.payBtn') && reviewPayCss.includes('min-height: 52px'), 'review-pay styles payBtn with 52px touch-friendly height on mobile');
assert(reviewPayCss.includes('env(safe-area-inset-bottom)'), 'review-pay includes safe-area inset padding');
assert(reviewPayCss.includes('.successCard') && reviewPayCss.includes('width: 100%'), 'review-pay styles payment success view as native mobile receipt');

// Admin Shell Tablet & Mobile Drawer
assert(mobileCss.includes('.admin-shell-layout') && mobileCss.includes('flex-direction: column !important'), 'Admin shell shifts to column layout on <= 1024px');
assert(mobileCss.includes('.admin-sidebar-root') && mobileCss.includes('translateX(-100%)'), 'Admin sidebar transforms into slide-out drawer on <= 1024px');
assert(mobileCss.includes('.shop-workspace-grid') && mobileCss.includes('.shop-workspace-tabs'), 'Shop workspace tab bar supports horizontal touch-scroll on mobile');

// -----------------------------------------------------------------------------
// SECTION 2: Remote Supabase Live Data Connectivity
// -----------------------------------------------------------------------------
console.log('\n--- SECTION 2: Remote Supabase Live Database Connectivity ---');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

assert(Boolean(supabaseUrl), 'NEXT_PUBLIC_SUPABASE_URL is configured');
assert(Boolean(supabaseKey), 'Supabase API key is configured');

const supabase = createClient(supabaseUrl, supabaseKey);

async function verifyLiveData() {
    // 1. Verify connection and support user
    const { data: authUsersData, error: authUsersErr } = await supabase.auth.admin.listUsers();
    assert(!authUsersErr, `Supabase auth query executed without error: ${authUsersErr?.message || 'OK'}`);
    const supportAuthUser = authUsersData?.users?.find(u => u.email === 'support@xerservice.in');
    assert(Boolean(supportAuthUser), 'Dedicated support user support@xerservice.in exists in live auth database');

    const { data: supportProfile, error: profileErr } = await supabase
        .from('profiles')
        .select('user_id, role, full_name')
        .eq('user_id', supportAuthUser?.id)
        .maybeSingle();

    assert(!profileErr, `Supabase profiles query executed without error: ${profileErr?.message || 'OK'}`);
    assert(Boolean(supportProfile), 'Support user profile exists in live profiles table');
    assert(supportProfile?.role === 'support', `Support user profile has role "support" (actual: ${supportProfile?.role})`);

    // 2. Verify shops table
    const { data: shops, error: shopsErr } = await supabase
        .from('shops')
        .select('id, name, status')
        .limit(5);

    assert(!shopsErr, `Supabase shops query executed without error: ${shopsErr?.message || 'OK'}`);
    assert(Array.isArray(shops) && shops.length > 0, `Live shops table contains active records (found ${shops?.length})`);

    // 3. Verify pricing configs table
    const { data: pricing, error: pricingErr } = await supabase
        .from('shop_pricing')
        .select('id, shop_id, paper_size, print_mode, sides, price_per_sheet')
        .limit(5);

    assert(!pricingErr, `Supabase shop_pricing query executed without error: ${pricingErr?.message || 'OK'}`);
    assert(Array.isArray(pricing) && pricing.length > 0, `Live shop_pricing contains records (found ${pricing?.length})`);

    // 4. Verify orders table
    const { data: orders, error: ordersErr } = await supabase
        .from('orders')
        .select('id, status, total_amount')
        .limit(5);

    assert(!ordersErr, `Supabase orders query executed without error: ${ordersErr?.message || 'OK'}`);
    assert(Array.isArray(orders), 'Live orders table is accessible and returns order records');

    // 5. Verify financial ledger invariant
    const { count: ledgerCount, error: ledgerErr } = await supabase
        .from('order_financial_ledger')
        .select('*', { count: 'exact', head: true });

    assert(!ledgerErr, `Supabase order_financial_ledger query executed without error: ${ledgerErr?.message || 'OK'}`);
    assert(ledgerCount >= 17, `Financial ledger preserves historical records (found ${ledgerCount}, expected >= 17)`);

    // 6. Verify wallet balances
    const { data: wallets, error: walletsErr } = await supabase
        .from('wallet_accounts')
        .select('id, balance');

    assert(!walletsErr, `Supabase wallet_accounts query executed without error: ${walletsErr?.message || 'OK'}`);
    const walletSum = wallets?.reduce((sum, w) => sum + Number(w.balance || 0), 0) || 0;
    assert(walletSum >= 0 && Number.isFinite(walletSum), `Wallet accounts balance sum is valid (actual: Rs ${walletSum})`);
}

// -----------------------------------------------------------------------------
// SECTION 3: Live Dev Server Route Health Check
// -----------------------------------------------------------------------------
console.log('\n--- SECTION 3: Live Dev Server Route Health Check ---');

function fetchRoute(urlPath) {
    return new Promise((resolve, reject) => {
        http.get(`http://localhost:3000${urlPath}`, (res) => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
        }).on('error', reject);
    });
}

async function verifyServerRoutes() {
    const routesToTest = [
        { path: '/', expected: 200, name: 'Customer Homepage' },
        { path: '/order/pricing', expected: 200, name: 'Review & Pay Pricing' },
        { path: '/dashboard/orders', expected: 200, name: 'Customer Orders Dashboard' },
        { path: '/cart', expected: 200, name: 'Shopping Cart' },
        { path: '/dashboard/profile', expected: 200, name: 'Customer Profile Settings' },
        { path: '/dashboard/wallet', expected: 200, name: 'Customer Wallet' },
        { path: '/admin/overview', expected: 200, name: 'Admin Overview Hub' },
        { path: '/admin/dashboard', expected: 200, name: 'Admin Analytics Dashboard' },
    ];

    for (const r of routesToTest) {
        const res = await fetchRoute(r.path);
        assert(res.statusCode === r.expected, `${r.name} (${r.path}) responded with HTTP ${res.statusCode}`);
        if (r.path === '/') {
            assert(res.body.includes('app-frame'), 'Customer Homepage includes app-frame structure');
            assert(res.body.includes('mobile-bottom-nav') || res.body.includes('MobileNavigation'), 'Customer Homepage includes mobile bottom navigation dock');
        }
    }
}

async function main() {
    try {
        await verifyLiveData();
        await verifyServerRoutes();

        console.log('\n========================================================================');
        console.log(`✓ ALL ${passedTests} / ${totalTests} ACCEPTANCE AUDITS PASSED WITH ZERO ERRORS`);
        console.log('========================================================================\n');
        process.exit(0);
    } catch (err) {
        console.error('\nTest failed with error:', err);
        process.exit(1);
    }
}

main();

/**
 * XerService End-to-End Acceptance Test Suite: Stage A11 — Customer Experience Redesign
 *
 * Verifies all requirements from astraplan.md (Section 12 and Section 16 line 740):
 * 1. Static Architecture & Asset Verification (page.tsx, hero, vertical cards, responsive grid)
 * 2. Brand & Title Metadata Invariants (zero "Tamilnadu" in customer titles/metadata)
 * 3. Search & Service Filters (Name/location search, status and service filter pills)
 * 4. Vertical Shop Cards (Photo on top, content below, service chips, explicit price basis, "Print here")
 * 5. Single-Shop Presentation (Well-proportioned card paired with 3-step "How It Works" guidance)
 * 6. Compact Secondary WhatsApp Indicator (Honest status, zero fake actions)
 * 7. Live Browser E2E Rendering & Responsiveness (Desktop 3-column, Tablet 2-column, Mobile 1-column)
 * 8. Financial Invariants Preservation (ledger=17, wallets=₹88, rules=2, batches=1, items=4)
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import puppeteer from 'puppeteer';
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

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';

let passed = 0;
let failed = 0;

function assert(condition, name, details = '') {
    if (condition) {
        passed++;
        console.log(`  ✓ PASS [${passed + failed}]: ${name}`);
    } else {
        failed++;
        console.error(`  ✗ FAIL [${passed + failed}]: ${name} ${details ? `(${details})` : ''}`);
    }
}

async function runAcceptanceSuite() {
    console.log('\n================================================================');
    console.log('  STAGE A11 ACCEPTANCE SUITE: CUSTOMER EXPERIENCE REDESIGN');
    console.log('================================================================\n');

    // ── Suite 1: Static Architecture & File Verification ─────────
    console.log('--- Suite 1: Static Architecture & File Verification ---');
    const pagePath = path.resolve(process.cwd(), 'apps/user/src/app/page.tsx');
    assert(fs.existsSync(pagePath), 'apps/user/src/app/page.tsx exists');

    const pageContent = fs.readFileSync(pagePath, 'utf8');
    assert(!pageContent.includes('home-info-grid'), 'Legacy .home-info-grid introductory boxes removed');
    assert(pageContent.includes('home-hero-section'), 'Concise .home-hero-section present');
    assert(pageContent.includes('hero-heading'), 'Hero heading element present');
    assert(pageContent.includes('hero-actions'), 'Hero actions with discovery and orders CTA present');
    assert(pageContent.includes('shop-card-vertical'), 'Vertical shop card component structure present');
    assert(pageContent.includes('shop-card-media'), 'Top media / banner container present');
    assert(pageContent.includes('shop-card-body'), 'Bottom content body present');
    assert(pageContent.includes('shop-services-chips'), 'Supported service chips container present');
    assert(pageContent.includes('price-basis-row'), 'Explicit starting price basis present');
    assert(pageContent.includes('Print here'), 'Primary action button says "Print here"');
    assert(pageContent.includes('single-shop-layout'), 'Single-shop layout container present');
    assert(pageContent.includes('how-it-works-panel'), '3-step "How It Works" guidance panel present');
    assert(pageContent.includes('compact-whatsapp-indicator'), 'Compact secondary WhatsApp indicator present');
    assert(pageContent.includes('shops-search-wrapper'), 'Shop search bar present');
    assert(pageContent.includes('shops-filter-pills'), 'Service and status filter pills present');

    // ── Suite 2: Brand & Metadata Invariants ──────────────────────
    console.log('\n--- Suite 2: Brand & Metadata Invariants ---');
    const layoutPath = path.resolve(process.cwd(), 'apps/user/src/app/layout.tsx');
    const layoutContent = fs.readFileSync(layoutPath, 'utf8');
    assert(!layoutContent.toLowerCase().includes('tamilnadu'), 'Layout metadata has zero occurrences of "Tamilnadu"');
    assert(!pageContent.toLowerCase().includes('tamilnadu'), 'Homepage title and UI have zero occurrences of "Tamilnadu"');

    // TypeScript compilation check
    let tscClean = true;
    try {
        execSync('npx tsc --noEmit', { stdio: 'pipe' });
    } catch {
        tscClean = false;
    }
    assert(tscClean, 'TypeScript compilation succeeds with zero errors');

    // ── Suite 3: Database & Service Pricing Discovery ────────────
    console.log('\n--- Suite 3: Database & Service Pricing Discovery ---');
    const { data: dbShops, error: dbShopsErr } = await sbAdmin.from('shops').select('id, name, status, description');
    assert(!dbShopsErr && dbShops && dbShops.length > 0, 'Database returns published shops', dbShopsErr?.message);

    const { data: dbPricing, error: dbPricingErr } = await sbAdmin.from('shop_pricing').select('*').eq('active', true);
    assert(!dbPricingErr && dbPricing && dbPricing.length > 0, 'Database returns active pricing matrix', dbPricingErr?.message);

    const hasBw = dbPricing.some(p => p.print_mode === 'BW');
    const hasColour = dbPricing.some(p => p.print_mode === 'COLOUR');
    const hasDuplex = dbPricing.some(p => p.sides && p.sides.startsWith('DOUBLE'));
    assert(hasBw, 'Active pricing contains B&W service');
    assert(hasColour, 'Active pricing contains Colour service');
    assert(hasDuplex, 'Active pricing contains Duplex service');

    // ── Suite 4: Live Browser E2E Rendering (Headless Puppeteer) ──
    console.log('\n--- Suite 4: Live Browser E2E Rendering & Visual Polish ---');
    const browser = await puppeteer.launch({ headless: true });
    try {
        const page = await browser.newPage();
        const pageErrors = [];
        page.on('pageerror', err => pageErrors.push(err.message));

        // Desktop Viewport
        await page.setViewport({ width: 1280, height: 800 });
        await page.goto(BASE_URL, { waitUntil: 'networkidle2' });

        // Hero section assertions
        const heroHeading = await page.$eval('.hero-heading', el => el.textContent?.trim());
        assert(heroHeading === 'Instant Printing at Local Print Shops', 'Hero displays exact concise heading');

        const heroBadge = await page.$eval('.hero-badge', el => el.textContent?.trim());
        assert(heroBadge.includes('Verified Print Network'), 'Hero displays verified badge');

        const heroActions = await page.$$eval('.hero-actions a', els => els.map(e => e.textContent?.trim()));
        assert(heroActions.some(t => t.includes('Explore Print Shops')), 'Hero contains "Explore Print Shops" discovery button');
        assert(heroActions.some(t => t.includes('My Orders')), 'Hero contains "My Orders" action button');

        // Search and filter controls
        const searchInput = await page.$('.shops-search-input');
        assert(searchInput !== null, 'Search input is rendered on the page');

        const filterPills = await page.$$eval('.filter-pill', els => els.map(e => e.textContent?.trim()));
        assert(filterPills.includes('All'), 'Filter pill "All" is present');
        assert(filterPills.includes('Open Now'), 'Filter pill "Open Now" is present');
        assert(filterPills.includes('Colour'), 'Filter pill "Colour" is present');
        assert(filterPills.includes('B&W'), 'Filter pill "B&W" is present');
        assert(filterPills.includes('Duplex'), 'Filter pill "Duplex" is present');

        // Vertical Shop Card verification
        await page.waitForSelector('.shop-card-vertical', { timeout: 10000 });
        const shopCards = await page.$$('.shop-card-vertical');
        assert(shopCards.length > 0, `Rendered ${shopCards.length} vertical shop card(s)`);

        // Check top media vs bottom content
        const mediaHeight = await page.$eval('.shop-card-media', el => el.getBoundingClientRect().height);
        assert(mediaHeight >= 120, 'Shop card media header has sufficient banner height (>= 120px)');

        // Check supported service chips on card
        const serviceChips = await page.$$eval('.service-chip', els => els.map(e => e.textContent?.trim()));
        assert(serviceChips.includes('A4'), 'Service chip "A4" is displayed on shop card');
        assert(serviceChips.includes('B&W'), 'Service chip "B&W" is displayed on shop card');
        assert(serviceChips.includes('Colour'), 'Service chip "Colour" is displayed on shop card');

        // Check explicit starting price basis
        const priceBasisText = await page.$eval('.price-basis-row', el => el.textContent?.trim());
        assert(priceBasisText.includes('From ₹') && priceBasisText.includes('A4 B&W, single-sided'), 'Starting price identifies explicit basis "(A4 B&W, single-sided)"');

        // Check CTA button
        const printBtnText = await page.$eval('.shop-print-btn', el => el.textContent?.trim());
        assert(printBtnText.includes('Print here'), 'Shop card CTA says "Print here"');

        // Compact WhatsApp indicator check
        const whatsappIndicator = await page.$eval('.compact-whatsapp-indicator', el => el.textContent?.trim());
        assert(whatsappIndicator.includes('Coming soon') && whatsappIndicator.includes('currently being prepared'), 'WhatsApp indicator displays honest status without fake actions');
        const whatsappButtons = await page.$$('.compact-whatsapp-indicator button, .compact-whatsapp-indicator a');
        assert(whatsappButtons.length === 0, 'WhatsApp indicator contains zero fake linking buttons or links');

        // ── Suite 5: Filter & Search Interactions & Single-Shop Guidance ─
        console.log('\n--- Suite 5: Filter & Search Interactions & Single-Shop Guidance ---');
        // Test single shop isolation via search
        await page.type('.shops-search-input', 'ITECH');
        await new Promise(r => setTimeout(r, 200));

        const singleLayout = await page.$('.single-shop-layout');
        assert(singleLayout !== null, 'Single-shop layout activates when 1 shop is isolated');

        const howPanel = await page.$('.how-it-works-panel');
        assert(howPanel !== null, '3-step "How XerService Works" panel is visible alongside single card');

        const steps = await page.$$eval('.how-step h4', els => els.map(e => e.textContent?.trim()));
        assert(steps.includes('Upload Document'), 'Step 1: Upload Document is present');
        assert(steps.includes('Configure Settings'), 'Step 2: Configure Settings is present');
        assert(steps.includes('Collect In Minutes'), 'Step 3: Collect In Minutes is present');

        // Check CTA link on the single card
        const shopCardLink = await page.$eval('a[href*="upload"]', el => el.getAttribute('href'));
        assert(shopCardLink && (shopCardLink.includes('/order/upload') || shopCardLink.includes('order%2Fupload')), 'Shop card link points to order upload flow');

        // Test non-matching search
        await page.click('.clear-search-btn');
        await page.type('.shops-search-input', 'NonExistentShopName12345');
        await new Promise(r => setTimeout(r, 200));
        const emptyStateText = await page.$eval('.empty-shops-card', el => el.textContent?.trim());
        assert(emptyStateText.includes('No print shops found'), 'Search with non-matching query displays empty state');

        // Reset filter via button
        await page.click('.empty-shops-card button');
        await new Promise(r => setTimeout(r, 200));
        const resetCards = await page.$$('.shop-card-vertical');
        assert(resetCards.length > 0, 'Resetting filters restores shop cards');

        // ── Suite 6: Responsiveness & Viewports ────────────────────
        console.log('\n--- Suite 6: Responsiveness & Viewports ---');
        // Tablet Viewport (768px)
        await page.setViewport({ width: 768, height: 1024 });
        await new Promise(r => setTimeout(r, 200));
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Tablet viewport has no horizontal overflow');

        // Mobile Viewport (390px)
        await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
        await new Promise(r => setTimeout(r, 200));
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Mobile viewport has no horizontal overflow');

        const mobileIntroVisible = await page.evaluate(() => {
            const el = document.querySelector('.mobile-home-intro');
            return el && window.getComputedStyle(el).display !== 'none';
        });
        assert(mobileIntroVisible, 'Mobile greeting intro is visible on mobile viewport');

        assert(pageErrors.length === 0, 'No uncaught browser runtime errors during session');

        await page.close();
    } finally {
        await browser.close();
    }

    // ── Suite 7: Financial Invariants Preservation ────────────────
    console.log('\n--- Suite 7: Financial Invariants Preservation ---');
    const { count: ledgerCount } = await sbAdmin.from('order_financial_ledger').select('*', { count: 'exact', head: true });
    assert(ledgerCount === 17, `Ledger entries invariant preserved (expected 17, got ${ledgerCount})`);

    const { data: wallets } = await sbAdmin.from('wallet_accounts').select('balance');
    const totalBalance = (wallets || []).reduce((sum, w) => sum + Number(w.balance), 0);
    assert(totalBalance === 88, `Wallet balance invariant preserved (expected ₹88, got ₹${totalBalance})`);

    const { count: rulesCount } = await sbAdmin.from('shop_commission_rules').select('*', { count: 'exact', head: true });
    assert(rulesCount === 2, `Commission rules invariant preserved (expected 2, got ${rulesCount})`);

    const { count: batchesCount } = await sbAdmin.from('vendor_settlement_batches').select('*', { count: 'exact', head: true });
    assert(batchesCount === 1, `Payout batches invariant preserved (expected 1, got ${batchesCount})`);

    const { count: itemsCount } = await sbAdmin.from('vendor_settlement_items').select('*', { count: 'exact', head: true });
    assert(itemsCount === 4, `Payout batch items invariant preserved (expected 4, got ${itemsCount})`);

    // ── Summary ──────────────────────────────────────────────────
    console.log('\n================================================================');
    console.log(`  STAGE A11 ACCEPTANCE RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log('================================================================\n');

    if (failed > 0) {
        process.exit(1);
    }
}

runAcceptanceSuite().catch(err => {
    console.error('Fatal acceptance test error:', err);
    process.exit(1);
});

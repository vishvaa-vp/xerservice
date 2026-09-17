/**
 * XerService End-to-End Acceptance Test Suite: Stage A8 — Vendor Desktop Shell
 *
 * Verifies all requirements from astraplan.md (Section 11 and roadmap line 737):
 * 1. Static Architecture & Build Verification
 * 2. Navigation Clean-Up & Legacy Preservation (no primary Print Queue entry)
 * 3. Theme Parity & Restart Persistence
 * 4. Storage Security Invariant (RAM-only auth)
 * 5. Header & Dashboard Architecture (Section 11.1)
 * 6. Integrated Orders & Device Jobs (Section 11.2)
 * 7. Shop Settings & Customer Card Preview (Section 11.5)
 * 8. Backend API & CORS Integration
 * 9. Financial Invariants & Zero Delta
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
const SUPABASE_ANON = envVars['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'] || envVars['NEXT_PUBLIC_SUPABASE_ANON_KEY'] || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';

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

async function getVendorAuth(email) {
    const { data, error } = await sbAdmin.auth.admin.generateLink({ type: 'magiclink', email });
    if (error || !data?.properties?.email_otp) throw new Error(`Failed to generate magiclink for ${email}: ${error?.message}`);
    const tempAnon = createClient(SUPABASE_URL, SUPABASE_ANON, { auth: { persistSession: false } });
    const { data: sess, error: verifyError } = await tempAnon.auth.verifyOtp({ email, token: data.properties.email_otp, type: 'email' });
    if (verifyError || !sess?.session?.access_token) throw new Error(`Failed to verify OTP for ${email}: ${verifyError?.message}`);
    return sess.session.access_token;
}

// ── Paths ────────────────────────────────────────────────────────────
const ROOT = process.cwd();
const DESKTOP = path.join(ROOT, 'apps', 'desktop');
const HTML_PATH = path.join(DESKTOP, 'index.html');
const STYLES_PATH = path.join(DESKTOP, 'src', 'styles.css');
const MAIN_PATH = path.join(DESKTOP, 'src', 'main.ts');
const IPC_PATH = path.join(DESKTOP, 'src', 'ipc.ts');
const VENDOR_SHOP_API = path.join(ROOT, 'src', 'app', 'api', 'vendor', 'shop', 'route.ts');
const VENDOR_OVERVIEW_API = path.join(ROOT, 'src', 'app', 'api', 'vendor', 'overview', 'route.ts');

async function run() {
    console.log('\n========================================================================');
    console.log('STAGE A8: Vendor Desktop Shell — Acceptance Test Suite');
    console.log('========================================================================\n');

    const baseline = await getBaselineInvariants();
    console.log(`  Baseline: ledger=${baseline.ledger}, wallets=₹${baseline.sumWallets}, rules=${baseline.rules}, batches=${baseline.batches}, items=${baseline.items}`);

    // ── SECTION 1: Static Architecture & Build Verification ──────────
    console.log('\n--- SECTION 1: Static Architecture & Build Verification ---');

    assert(fs.existsSync(HTML_PATH), 'index.html exists');
    assert(fs.existsSync(STYLES_PATH), 'styles.css exists');
    assert(fs.existsSync(MAIN_PATH), 'main.ts exists');
    assert(fs.existsSync(IPC_PATH), 'ipc.ts exists');
    assert(fs.existsSync(VENDOR_SHOP_API), 'Vendor Shop API route exists');
    assert(fs.existsSync(VENDOR_OVERVIEW_API), 'Vendor Overview API route exists');

    // TypeScript compilation
    try {
        execSync('npx tsc --noEmit', { cwd: ROOT, stdio: 'pipe' });
        assert(true, 'TypeScript compiles with 0 errors');
    } catch (e) {
        assert(false, 'TypeScript compiles with 0 errors', e?.stderr?.toString()?.slice(0, 300));
    }

    // Vite build
    try {
        execSync('pnpm build', { cwd: DESKTOP, stdio: 'pipe' });
        const distExists = fs.existsSync(path.join(DESKTOP, 'dist', 'index.html'));
        assert(distExists, 'pnpm build produces dist/ with index.html');
        const distFiles = fs.readdirSync(path.join(DESKTOP, 'dist', 'assets'));
        const hasJS = distFiles.some(f => f.endsWith('.js'));
        const hasCSS = distFiles.some(f => f.endsWith('.css'));
        assert(hasJS, 'dist/assets contains JS bundle');
        assert(hasCSS, 'dist/assets contains CSS bundle');
    } catch (e) {
        assert(false, 'pnpm build executes cleanly', e?.stderr?.toString()?.slice(0, 300));
    }

    // ── SECTION 2: Navigation Clean-Up & Legacy Preservation ─────────
    console.log('\n--- SECTION 2: Navigation Clean-Up & Legacy Preservation ---');

    const html = fs.readFileSync(HTML_PATH, 'utf8');

    // No primary sidebar printqueue nav
    const navPrintqueue = html.match(/class="nav-item[^"]*"[^>]*data-tab="printqueue"/);
    assert(!navPrintqueue, 'Sidebar nav has NO primary data-tab="printqueue"');

    // Required nav tabs exist
    assert(html.includes('data-tab="overview"'), 'Sidebar nav has overview tab');
    assert(html.includes('data-tab="orders"'), 'Sidebar nav has orders tab');
    assert(html.includes('data-tab="settings"'), 'Sidebar nav has settings tab');
    assert(html.includes('data-tab="reports"'), 'Sidebar nav has reports tab');

    // Legacy DOM elements preserved
    assert(html.includes('id="tab-printqueue"'), 'Legacy #tab-printqueue preserved in DOM');
    assert(html.includes('id="queue-tbody"'), 'Legacy #queue-tbody preserved in DOM');
    assert(html.includes('id="persisted-tbody"'), 'Legacy #persisted-tbody preserved in DOM');
    assert(html.includes('id="queue-table-body"'), 'Legacy #queue-table-body preserved in DOM');
    assert(html.includes('id="persisted-table-body"'), 'Legacy #persisted-table-body preserved in DOM');
    assert(html.includes('id="order-print-drawer"'), 'Legacy #order-print-drawer preserved in DOM');

    // ── SECTION 3: Theme Parity & Restart Persistence ────────────────
    console.log('\n--- SECTION 3: Theme Parity & Restart Persistence ---');

    const css = fs.readFileSync(STYLES_PATH, 'utf8');
    const mainTs = fs.readFileSync(MAIN_PATH, 'utf8');

    assert(css.includes('[data-theme="light"]'), 'styles.css defines [data-theme="light"] tokens');
    assert(css.includes('[data-theme="dark"]'), 'styles.css defines [data-theme="dark"] tokens');

    // Inline head theme initializer (FOUC prevention)
    const headScript = html.match(/<head>[\s\S]*?<script[\s\S]*?xerservice_desktop_theme[\s\S]*?<\/script>/);
    assert(!!headScript, 'index.html contains inline theme initializer in <head> reading xerservice_desktop_theme');

    // ui_setTheme function
    assert(mainTs.includes('function ui_setTheme('), 'main.ts defines ui_setTheme function');
    assert(mainTs.includes("'system'") && mainTs.includes("'light'") && mainTs.includes("'dark'"), 'ui_setTheme supports system, light, dark');
    assert(mainTs.includes("localStorage.setItem('xerservice_desktop_theme'"), 'ui_setTheme persists theme to localStorage');

    // ui_cycleTheme function
    assert(mainTs.includes('function ui_cycleTheme('), 'main.ts defines ui_cycleTheme function');

    // Theme radio cards in settings
    assert(html.includes('name="app-theme"'), 'index.html has app-theme radio inputs');
    assert(html.includes('id="theme-radio-system"'), 'Theme radio: system');
    assert(html.includes('id="theme-radio-dark"'), 'Theme radio: dark');
    assert(html.includes('id="theme-radio-light"'), 'Theme radio: light');

    // ── SECTION 4: Storage Security Invariant ────────────────────────
    console.log('\n--- SECTION 4: Storage Security Invariant ---');

    // Check that main.ts NEVER writes access_token or xerservice_vendor_token to localStorage
    const lsSetLines = mainTs.split('\n').filter(l => l.includes('localStorage.setItem('));
    const forbiddenSetItems = lsSetLines.filter(l =>
        l.includes('access_token') || l.includes('xerservice_vendor_token') || l.includes('refresh_token')
    );
    assert(forbiddenSetItems.length === 0, 'Zero auth tokens written to localStorage', `Found: ${forbiddenSetItems.join('; ')}`);

    // Permitted keys only
    const permittedKeys = ['xerservice_desktop_theme', 'xerservice_default_printer', 'xerservice_vendor_email'];
    const setItemValues = lsSetLines.map(l => {
        const match = l.match(/localStorage\.setItem\(\s*['"]([^'"]+)['"]/);
        return match ? match[1] : null;
    }).filter(Boolean);
    const allPermitted = setItemValues.every(key => permittedKeys.includes(key));
    assert(allPermitted, 'Only permitted non-sensitive keys written to localStorage', `Keys found: ${setItemValues.join(', ')}`);

    // In-memory auth
    assert(mainTs.includes('authenticateVendor'), 'Auth uses authenticateVendor (in-memory storage adapter)');
    assert(mainTs.includes("ui_vendorSession = null;"), 'Sign-out clears ui_vendorSession to null');
    assert(mainTs.includes("ui_token = '';"), 'Sign-out clears ui_token to empty string');

    // ── SECTION 5: Header & Dashboard Architecture ───────────────────
    console.log('\n--- SECTION 5: Header & Dashboard Architecture (Section 11.1) ---');

    // Header elements
    assert(html.includes('id="header-shop-name"'), 'Header contains shop name element');
    assert(html.includes('id="header-shop-status"'), 'Header contains trading status pill');
    assert(html.includes('id="header-conn-status-text"') || html.includes('id="header-conn-dot"'), 'Header contains connection status indicator');
    assert(html.includes('id="btn-theme-toggle"'), 'Header contains theme toggle button');

    // 4 Primary KPI cards
    assert(html.includes('id="stat-queued"'), 'Dashboard KPI: stat-queued');
    assert(html.includes('id="stat-printing"'), 'Dashboard KPI: stat-printing');
    assert(html.includes('id="stat-ready"'), 'Dashboard KPI: stat-ready');
    assert(html.includes('id="stat-completed-today"'), 'Dashboard KPI: stat-completed-today');

    // 3 Secondary earnings strip cards
    assert(html.includes('id="stat-earnings-today"'), 'Earnings strip: stat-earnings-today');
    assert(html.includes('id="stat-unsettled-balance"'), 'Earnings strip: stat-unsettled-balance');
    assert(html.includes('id="stat-last-payout"'), 'Earnings strip: stat-last-payout');

    // Availability quick toggle
    assert(html.includes('id="btn-shop-open"'), 'Availability toggle: OPEN button');
    assert(html.includes('id="btn-shop-paused"'), 'Availability toggle: PAUSED button');
    assert(html.includes('id="btn-shop-closed"'), 'Availability toggle: CLOSED button');
    assert(mainTs.includes('ui_setShopAvailability('), 'main.ts defines ui_setShopAvailability function');

    // Overview refresh function
    assert(mainTs.includes('ui_refreshOverview('), 'main.ts defines ui_refreshOverview function');
    assert(mainTs.includes('fetchVendorOverview('), 'main.ts calls fetchVendorOverview');

    // Empty state
    assert(html.includes('No active orders') || mainTs.includes('No active orders'), 'Honest "No active orders" empty state exists');

    // ── SECTION 6: Integrated Orders & Device Jobs ───────────────────
    console.log('\n--- SECTION 6: Integrated Orders & Device Jobs (Section 11.2) ---');

    // Filter tabs
    assert(html.includes('data-filter="all"'), 'Filter tab: all');
    assert(html.includes('data-filter="QUEUED"'), 'Filter tab: QUEUED');
    assert(html.includes('data-filter="PRINTING"'), 'Filter tab: PRINTING');
    assert(html.includes('data-filter="READY"'), 'Filter tab: READY');
    assert(html.includes('data-filter="COMPLETED"'), 'Filter tab: COMPLETED');
    assert(html.includes('data-filter="CANCELLED"'), 'Filter tab: CANCELLED');
    assert(html.includes('data-filter="device-jobs"'), 'Filter tab: device-jobs');

    // Search and date filter controls
    assert(html.includes('id="orders-search"'), 'Orders search input present');
    assert(html.includes('id="orders-date-filter"'), 'Orders date filter present');

    // Device Jobs sub-panel
    assert(html.includes('id="orders-device-jobs-container"'), 'Device Jobs container in Orders tab');
    assert(html.includes('id="device-jobs-tbody"'), 'Device Jobs tbody for active spooler');
    assert(html.includes('id="device-persisted-tbody"'), 'Device persisted jobs tbody');

    // Device refresh and reconcile buttons
    assert(html.includes('id="btn-refresh-device-jobs"'), 'Device Jobs refresh button');
    assert(html.includes('id="btn-device-reconcile"'), 'Device reconcile button');

    // Search/filter wiring in main.ts
    assert(mainTs.includes('ui_applyOrdersFiltering('), 'main.ts defines ui_applyOrdersFiltering function');
    assert(mainTs.includes('ui_refreshDeviceJobs('), 'main.ts defines ui_refreshDeviceJobs function');

    // ── SECTION 7: Shop Settings & Customer Card Preview ─────────────
    console.log('\n--- SECTION 7: Shop Settings & Customer Card Preview (Section 11.5) ---');

    // Settings form fields
    assert(html.includes('id="settings-shop-name"'), 'Settings form: shop name input');
    assert(html.includes('id="settings-shop-address"'), 'Settings form: shop address input');
    assert(html.includes('id="settings-shop-phone"'), 'Settings form: phone input');
    assert(html.includes('id="settings-open-time"'), 'Settings form: open time input');
    assert(html.includes('id="settings-close-time"'), 'Settings form: close time input');
    assert(html.includes('id="btn-save-settings"'), 'Settings form: save button');

    // Customer card preview
    assert(html.includes('id="preview-shop-name"'), 'Customer preview: shop name');
    assert(html.includes('id="preview-shop-address"'), 'Customer preview: shop address');
    assert(html.includes('id="preview-shop-phone"'), 'Customer preview: phone');
    assert(html.includes('id="preview-shop-status"'), 'Customer preview: status badge');
    assert(mainTs.includes('ui_updateCustomerPreview('), 'main.ts defines ui_updateCustomerPreview function');

    // Read-only commercial terms (no private commission rates)
    assert(html.includes('id="terms-settlement-cycle"'), 'Commercial terms: settlement cycle (read-only)');
    assert(html.includes('id="terms-commission-model"'), 'Commercial terms: commission model label (read-only)');

    // Verify NO private commission rates/basis points exposed in HTML
    const htmlLower = html.toLowerCase();
    assert(!htmlLower.includes('basis point'), 'No private basis points exposed in HTML');
    assert(!htmlLower.includes('commission rate'), 'No private commission rate labels in HTML');

    // Default printer selector
    assert(html.includes('id="settings-default-printer"'), 'Default printer selector present');
    assert(html.includes('id="settings-printer-diagnostics"'), 'Printer diagnostics present');

    // Settings save and load functions
    assert(mainTs.includes('ui_saveShopSettings('), 'main.ts defines ui_saveShopSettings function');
    assert(mainTs.includes('ui_loadShopSettings('), 'main.ts defines ui_loadShopSettings function');
    assert(mainTs.includes('updateVendorShopProfile('), 'main.ts calls updateVendorShopProfile');
    assert(mainTs.includes('fetchVendorShopProfile('), 'main.ts calls fetchVendorShopProfile');

    // ── SECTION 8: Backend API & CORS Integration ────────────────────
    console.log('\n--- SECTION 8: Backend API & CORS Integration ---');

    const shopApi = fs.readFileSync(VENDOR_SHOP_API, 'utf8');
    const overviewApi = fs.readFileSync(VENDOR_OVERVIEW_API, 'utf8');

    // Vendor Shop API
    assert(shopApi.includes('export async function GET('), 'Vendor Shop API has GET handler');
    assert(shopApi.includes('export async function PATCH(') || shopApi.includes('export async function PUT('), 'Vendor Shop API has PATCH/PUT handler');
    assert(shopApi.includes('export async function OPTIONS('), 'Vendor Shop API has OPTIONS handler (CORS preflight)');
    assert(shopApi.includes('getCorsHeaders') || shopApi.includes('handleCorsPreflight'), 'Vendor Shop API uses CORS headers');

    // Vendor Overview API CORS
    assert(overviewApi.includes('export async function OPTIONS('), 'Vendor Overview API has OPTIONS handler');
    assert(overviewApi.includes('getCorsHeaders') || overviewApi.includes('handleCorsPreflight'), 'Vendor Overview API uses CORS headers');

    // IPC bridge functions
    const ipcTs = fs.readFileSync(IPC_PATH, 'utf8');
    assert(ipcTs.includes('fetchVendorOverview('), 'ipc.ts exports fetchVendorOverview');
    assert(ipcTs.includes('fetchVendorShopProfile('), 'ipc.ts exports fetchVendorShopProfile');
    assert(ipcTs.includes('updateVendorShopProfile('), 'ipc.ts exports updateVendorShopProfile');

    // Live API tests (OPTIONS preflight — must include approved desktop origin)
    const desktopOrigin = 'http://localhost:1420';
    try {
        const optionsRes = await fetch(`${BASE_URL}/api/vendor/shop`, {
            method: 'OPTIONS',
            headers: { 'Origin': desktopOrigin }
        });
        assert(optionsRes.status === 204, 'OPTIONS /api/vendor/shop returns 204 (preflight OK)', `Got: ${optionsRes.status}`);
        const acHeader = optionsRes.headers.get('access-control-allow-origin');
        assert(!!acHeader, 'OPTIONS /api/vendor/shop returns Access-Control-Allow-Origin header');
    } catch (e) {
        assert(false, 'OPTIONS /api/vendor/shop preflight', `Fetch failed: ${e?.message}`);
    }

    try {
        const optionsRes = await fetch(`${BASE_URL}/api/vendor/overview`, {
            method: 'OPTIONS',
            headers: { 'Origin': desktopOrigin }
        });
        assert(optionsRes.status === 204, 'OPTIONS /api/vendor/overview returns 204 (preflight OK)', `Got: ${optionsRes.status}`);
    } catch (e) {
        assert(false, 'OPTIONS /api/vendor/overview preflight', `Fetch failed: ${e?.message}`);
    }

    // Live API tests (authenticated GET)
    try {
        const { data: profiles } = await sbAdmin.from('profiles').select('id, email, role').eq('role', 'vendor').limit(1);
        if (profiles && profiles.length > 0) {
            const vendorEmail = profiles[0].email;
            const vendorToken = await getVendorAuth(vendorEmail);

            // GET /api/vendor/shop
            const shopRes = await fetch(`${BASE_URL}/api/vendor/shop`, {
                headers: { 'Authorization': `Bearer ${vendorToken}` }
            });
            assert(shopRes.status === 200, 'GET /api/vendor/shop returns 200 with vendor token', `Got: ${shopRes.status}`);
            const shopData = await shopRes.json();
            assert(shopData.name !== undefined, 'GET /api/vendor/shop returns shop name');
            assert(shopData.commercialTerms !== undefined, 'GET /api/vendor/shop returns commercial terms');
            const shopJson = JSON.stringify(shopData);
            assert(!shopJson.includes('basisPoints') && !shopJson.includes('basis_points'), 'GET /api/vendor/shop does NOT expose private commission basis points');

            // GET /api/vendor/overview
            const overviewRes = await fetch(`${BASE_URL}/api/vendor/overview`, {
                headers: { 'Authorization': `Bearer ${vendorToken}` }
            });
            assert(overviewRes.status === 200, 'GET /api/vendor/overview returns 200 with vendor token', `Got: ${overviewRes.status}`);
            const overviewData = await overviewRes.json();
            assert(overviewData.metrics !== undefined, 'GET /api/vendor/overview returns metrics');
            assert(overviewData.metrics.todayRevenue !== undefined || overviewData.metrics.todayCompletedOrders !== undefined, 'Overview metrics contain revenue or completed order data');

            // PATCH /api/vendor/shop
            const patchRes = await fetch(`${BASE_URL}/api/vendor/shop`, {
                method: 'PATCH',
                headers: { 'Authorization': `Bearer ${vendorToken}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: 'OPEN' })
            });
            assert(patchRes.status === 200, 'PATCH /api/vendor/shop returns 200 on status update', `Got: ${patchRes.status}`);
        } else {
            console.log('  [SKIP] No vendor profiles found for live API testing');
        }
    } catch (e) {
        assert(false, 'Live vendor API integration test', `Error: ${e?.message}`);
    }

    // Unauthorized access rejection
    try {
        const noAuthRes = await fetch(`${BASE_URL}/api/vendor/shop`);
        assert(noAuthRes.status === 401 || noAuthRes.status === 403, 'GET /api/vendor/shop rejects unauthenticated requests', `Got: ${noAuthRes.status}`);
    } catch (e) {
        assert(false, 'Unauthenticated access rejection', `Error: ${e?.message}`);
    }

    // ── SECTION 9: Financial Invariants & Zero Delta ─────────────────
    console.log('\n--- SECTION 9: Financial Invariants & Zero Delta ---');

    const post = await getBaselineInvariants();
    assert(post.ledger === 17, `Ledger count preserved (${post.ledger} === 17)`);
    assert(post.sumWallets === 88, `Wallet balances preserved (₹${post.sumWallets} === ₹88)`);
    assert(post.rules === 2, `Commission rules count preserved (${post.rules} === 2)`);
    assert(post.batches === 1, `Settlement batches count preserved (${post.batches} === 1)`);
    assert(post.items === 4, `Settlement items count preserved (${post.items} === 4)`);

    // ── RESULTS ──────────────────────────────────────────────────────
    console.log('\n======================================================================');
    console.log(`STAGE A8 DESKTOP SHELL RESULTS: ${passed} PASSED, ${failed} FAILED out of ${passed + failed} total tests`);
    console.log('======================================================================\n');

    process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
    console.error('Test suite crashed:', err);
    process.exit(1);
});

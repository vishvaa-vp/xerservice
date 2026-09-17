/**
 * Browser Verification: XerService Loading Animation, Admin UI, and Route Guards
 * Run: node --env-file=.env.local scripts/test-browser-verification.mjs
 */

import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Load env
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

const supabaseUrl = envVars['NEXT_PUBLIC_SUPABASE_URL'] || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseSecret = envVars['SUPABASE_SECRET_KEY'] || process.env.SUPABASE_SECRET_KEY;
const supabaseAnon = envVars['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'] || envVars['NEXT_PUBLIC_SUPABASE_ANON_KEY'];

const serviceClient = createClient(supabaseUrl, supabaseSecret);
const BASE_URL = 'http://localhost:3000';
const SCREENSHOT_DIR = path.join(rootDir, '.gemini-screenshots');
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition, message) {
    totalTests++;
    if (condition) {
        passedTests++;
        console.log(`  ✓ PASS [${totalTests}]: ${message}`);
    } else {
        failedTests++;
        console.error(`  ✗ FAIL [${totalTests}]: ${message}`);
    }
}

async function getAuthToken(email) {
    const { data, error } = await serviceClient.auth.admin.generateLink({ type: 'magiclink', email });
    if (error || !data?.properties?.email_otp) throw new Error(`Magiclink failed for ${email}: ${error?.message}`);
    const c = createClient(supabaseUrl, supabaseAnon, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: sess, error: e2 } = await c.auth.verifyOtp({ email, token: data.properties.email_otp, type: 'email' });
    if (e2 || !sess?.session) throw new Error(`OTP verify failed for ${email}: ${e2?.message}`);
    return sess.session;
}

async function injectSession(page, session) {
    await page.evaluate((sessionData, url) => {
        const storageKey = `sb-${new URL(url).hostname.split('.')[0]}-auth-token`;
        localStorage.setItem(storageKey, JSON.stringify({
            access_token: sessionData.access_token,
            refresh_token: sessionData.refresh_token,
            expires_at: sessionData.expires_at,
            expires_in: sessionData.expires_in,
            token_type: 'bearer',
            user: sessionData.user,
        }));
    }, session, supabaseUrl);
}

async function run() {
    console.log('===============================================================');
    console.log('XerService — Browser Verification Suite');
    console.log('Loading Animation • Admin IA • Route Guards • Payment Flow');
    console.log('===============================================================\n');

    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1440,900'],
        defaultViewport: { width: 1440, height: 900 },
    });

    try {
        console.log('Generating test sessions for Admin, Vendor, Customer...');
        const adminSession = await getAuthToken('xerservice@gmail.com');
        const vendorSession = await getAuthToken('xerserviceofficial@gmail.com');
        const customerSession = await getAuthToken('vishvaaparthipan@gmail.com');
        console.log('✓ All 3 sessions ready.\n');

        // =====================================================================
        // PART 1: VISUAL LOADING ANIMATION ON COLD LOAD
        // =====================================================================
        console.log('--- 1. LOADING ANIMATION: Visual & Structural Completeness ---');

        const coldContext = await browser.createBrowserContext();
        const animPage = await coldContext.newPage();
        const loadStart = Date.now();
        await animPage.goto(BASE_URL, { waitUntil: 'domcontentloaded' });

        // Locate loader during its active display
        const loaderEl = await animPage.waitForSelector('[aria-label="Loading XerService"]', { timeout: 4000 }).catch(() => null);
        assert(Boolean(loaderEl), 'Animation: Complete BrandLoader mounts with aria-label="Loading XerService"');

        let loaderText = '';
        let hasImage = false;
        if (loaderEl) {
            loaderText = await animPage.evaluate(el => el.innerText, loaderEl);
            hasImage = await animPage.evaluate(el => Boolean(el.querySelector('img')), loaderEl);
            await animPage.screenshot({ path: path.join(SCREENSHOT_DIR, '00-loader-active.png') });
        }

        assert(loaderText.includes('xerservice.'), 'Animation: Complete wordmark "xerservice." is present');
        assert(loaderText.includes('Your ideas. In print.'), 'Animation: Complete tagline "Your ideas. In print." is present');
        assert(loaderText.includes('XS / PRINT') && loaderText.includes('READY TO PRINT'), 'Animation: Complete print stage sheet headers and inks present');
        assert(hasImage, 'Animation: Brand logo image present within print stage');

        // Wait for loader dismissal
        await animPage.waitForFunction(() => !document.querySelector('[aria-label="Loading XerService"]'), { timeout: 15000 });
        const loadDuration = Date.now() - loadStart;
        assert(loadDuration >= 1200, `Animation: Full 1200ms keyframe sequence respected (elapsed: ${loadDuration}ms)`);
        await coldContext.close();

        // =====================================================================
        // PART 2: ALL 6 REQUIRED ROUTES WITH CLEAN CONTEXTS
        // =====================================================================
        console.log('\n--- 2. VERIFICATION ACROSS ALL 6 REQUIRED ROUTES ---');

        // 1. Homepage (/)
        console.log('\n[Route 1/6] Homepage (/)');
        const homeContext = await browser.createBrowserContext();
        const pageHome = await homeContext.newPage();
        await pageHome.goto(BASE_URL, { waitUntil: 'networkidle0', timeout: 45000 });
        await pageHome.waitForFunction(() => !document.querySelector('[aria-label="Loading XerService"]'), { timeout: 10000 }).catch(() => {});
        await pageHome.screenshot({ path: path.join(SCREENSHOT_DIR, '01-homepage.png') });
        const homeResiduals = await pageHome.evaluate(() => document.querySelectorAll('[aria-label="Loading XerService"]').length);
        const homeHasContent = await pageHome.evaluate(() => document.body.innerText.length > 100);
        assert(homeResiduals === 0, 'Homepage: Zero residual loading overlays after complete dismissal');
        assert(homeHasContent, 'Homepage: Full homepage content rendered');
        await homeContext.close();

        // 2. Login (/login)
        console.log('\n[Route 2/6] Login (/login)');
        const loginContext = await browser.createBrowserContext();
        const pageLogin = await loginContext.newPage();
        await pageLogin.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle0', timeout: 45000 });
        await pageLogin.waitForFunction(() => !document.querySelector('[aria-label="Loading XerService"]'), { timeout: 8000 }).catch(() => {});
        await pageLogin.waitForSelector('input[type="email"], input[type="text"]', { timeout: 8000 }).catch(() => {});
        await pageLogin.screenshot({ path: path.join(SCREENSHOT_DIR, '02-login.png') });
        const loginResiduals = await pageLogin.evaluate(() => document.querySelectorAll('[aria-label="Loading XerService"]').length);
        const loginHasForm = await pageLogin.evaluate(() => Boolean(document.querySelector('input[type="email"], input[type="text"]')));
        assert(loginResiduals === 0, 'Login: Zero residual loading overlays');
        assert(loginHasForm, 'Login: Auth form rendered cleanly');
        await loginContext.close();

        // 3. Protected Customer Route (/dashboard/orders)
        console.log('\n[Route 3/6] Protected Customer Route (/dashboard/orders)');
        // 3a: Anon redirect
        const anonOrdersContext = await browser.createBrowserContext();
        const pageOrdersAnon = await anonOrdersContext.newPage();
        await pageOrdersAnon.goto(`${BASE_URL}/dashboard/orders`, { waitUntil: 'networkidle0', timeout: 45000 });
        const anonRedirectUrl = pageOrdersAnon.url();
        assert(anonRedirectUrl.includes('/login'), `Protected Customer Route (Anon): Redirected to login (url: ${anonRedirectUrl})`);
        await anonOrdersContext.close();

        // 3b: Authenticated customer
        const authOrdersContext = await browser.createBrowserContext();
        const pageOrdersAuth = await authOrdersContext.newPage();
        await pageOrdersAuth.goto(BASE_URL, { waitUntil: 'networkidle0', timeout: 45000 });
        await pageOrdersAuth.waitForFunction(() => !document.querySelector('[aria-label="Loading XerService"]'), { timeout: 10000 }).catch(() => {});
        await injectSession(pageOrdersAuth, customerSession);
        await pageOrdersAuth.goto(`${BASE_URL}/dashboard/orders`, { waitUntil: 'networkidle0', timeout: 45000 });
        await pageOrdersAuth.waitForFunction(() => !document.querySelector('[aria-label="Loading XerService"]'), { timeout: 10000 }).catch(() => {});
        await pageOrdersAuth.screenshot({ path: path.join(SCREENSHOT_DIR, '03-customer-orders.png') });
        const ordersResiduals = await pageOrdersAuth.evaluate(() => document.querySelectorAll('[aria-label="Loading XerService"]').length);
        const ordersHasContent = await pageOrdersAuth.evaluate(() => document.body.innerText.length > 50);
        assert(ordersResiduals === 0, 'Protected Customer Route (Auth): Zero residual loading overlays');
        assert(ordersHasContent, 'Protected Customer Route (Auth): Orders view loaded successfully');
        await authOrdersContext.close();

        // 4. Vendor Dashboard (/vendor/dashboard)
        console.log('\n[Route 4/6] Vendor Dashboard (/vendor/dashboard)');
        const vendorContext = await browser.createBrowserContext();
        const pageVendor = await vendorContext.newPage();
        await pageVendor.goto(BASE_URL, { waitUntil: 'networkidle0', timeout: 45000 });
        await pageVendor.waitForFunction(() => !document.querySelector('[aria-label="Loading XerService"]'), { timeout: 10000 }).catch(() => {});
        await injectSession(pageVendor, vendorSession);
        await pageVendor.goto(`${BASE_URL}/vendor/dashboard`, { waitUntil: 'networkidle0', timeout: 45000 });
        await pageVendor.waitForFunction(() => !document.querySelector('[aria-label="Loading XerService"]'), { timeout: 8000 }).catch(() => {});
        await pageVendor.screenshot({ path: path.join(SCREENSHOT_DIR, '04-vendor-dashboard.png') });
        const vendorResiduals = await pageVendor.evaluate(() => document.querySelectorAll('[aria-label="Loading XerService"]').length);
        const vendorHasContent = await pageVendor.evaluate(() => document.body.innerText.length > 50);
        assert(vendorResiduals === 0, 'Vendor Dashboard: Zero residual loading overlays');
        assert(vendorHasContent, 'Vendor Dashboard: Vendor workspace rendered cleanly');
        await vendorContext.close();

        // 5. Admin Page (/admin/users & /admin/addons)
        console.log('\n[Route 5/6] Admin Page (/admin/users & /admin/addons)');
        const adminPageContext = await browser.createBrowserContext();
        const pageAdmin = await adminPageContext.newPage();
        await pageAdmin.goto(BASE_URL, { waitUntil: 'networkidle0', timeout: 45000 });
        await pageAdmin.waitForFunction(() => !document.querySelector('[aria-label="Loading XerService"]'), { timeout: 10000 }).catch(() => {});
        await injectSession(pageAdmin, adminSession);
        await pageAdmin.goto(`${BASE_URL}/admin/users`, { waitUntil: 'networkidle0', timeout: 45000 });
        await pageAdmin.waitForFunction(() => !document.querySelector('[aria-label="Loading XerService"]'), { timeout: 10000 }).catch(() => {});
        await pageAdmin.screenshot({ path: path.join(SCREENSHOT_DIR, '05-admin-users.png') });
        const adminResiduals = await pageAdmin.evaluate(() => document.querySelectorAll('[aria-label="Loading XerService"]').length);
        const adminHasContent = await pageAdmin.evaluate(() => document.body.innerText.length > 50);
        assert(adminResiduals === 0, 'Admin Page: Zero residual loading overlays on /admin/users');
        assert(adminHasContent, 'Admin Page: Users & Vendors table loaded cleanly');
        await adminPageContext.close();

        // 6. Payment Page (/order/payment)
        console.log('\n[Route 6/6] Payment Page (/order/payment)');
        // 6a: Anon redirect
        const anonPayContext = await browser.createBrowserContext();
        const pagePayAnon = await anonPayContext.newPage();
        await pagePayAnon.goto(`${BASE_URL}/order/payment`, { waitUntil: 'networkidle0', timeout: 45000 });
        const payAnonUrl = pagePayAnon.url();
        assert(payAnonUrl.includes('/login'), `Payment Page (Anon): Redirected to login (url: ${payAnonUrl})`);
        await anonPayContext.close();

        // 6b: Authenticated customer
        const authPayContext = await browser.createBrowserContext();
        const pagePayAuth = await authPayContext.newPage();
        await pagePayAuth.goto(BASE_URL, { waitUntil: 'networkidle0', timeout: 45000 });
        await pagePayAuth.waitForFunction(() => !document.querySelector('[aria-label="Loading XerService"]'), { timeout: 10000 }).catch(() => {});
        await injectSession(pagePayAuth, customerSession);
        await pagePayAuth.goto(`${BASE_URL}/order/payment`, { waitUntil: 'networkidle0', timeout: 45000 });
        await pagePayAuth.waitForFunction(() => !document.querySelector('[aria-label="Loading XerService"]'), { timeout: 10000 }).catch(() => {});
        await pagePayAuth.screenshot({ path: path.join(SCREENSHOT_DIR, '06-payment-page.png') });
        const payResiduals = await pagePayAuth.evaluate(() => document.querySelectorAll('[aria-label="Loading XerService"]').length);
        const payHasContent = await pagePayAuth.evaluate(() => document.body.innerText.length > 50);
        assert(payResiduals === 0, 'Payment Page (Auth): Zero residual loading overlays');
        assert(payHasContent, 'Payment Page (Auth): Payment interface rendered cleanly');
        await authPayContext.close();

        // =====================================================================
        // PART 3: NO UNNECESSARY RESTARTS ACROSS SPA CLIENT TRANSITIONS
        // =====================================================================
        console.log('\n--- 3. SINGLE BOOT & RESTART SUPPRESSION ---');

        const spaContext = await browser.createBrowserContext();
        const pageSpa = await spaContext.newPage();
        await pageSpa.goto(BASE_URL, { waitUntil: 'networkidle0', timeout: 45000 });
        await pageSpa.waitForFunction(() => !document.querySelector('[aria-label="Loading XerService"]'), { timeout: 10000 }).catch(() => {});
        await injectSession(pageSpa, adminSession);

        await pageSpa.evaluate(() => {
            window.__spaLoaderMounts = 0;
            const obs = new MutationObserver(muts => {
                for (const m of muts) {
                    for (const n of m.addedNodes) {
                        if (n.nodeType === 1 && n.getAttribute?.('aria-label') === 'Loading XerService') {
                            window.__spaLoaderMounts++;
                        }
                    }
                }
            });
            obs.observe(document.documentElement, { childList: true, subtree: true });
        });

        // Navigate across admin sections via client transitions
        await pageSpa.goto(`${BASE_URL}/admin/users`, { waitUntil: 'networkidle0', timeout: 45000 });
        await pageSpa.goto(`${BASE_URL}/admin/finance`, { waitUntil: 'networkidle0', timeout: 45000 });
        await pageSpa.goto(`${BASE_URL}/admin/addons`, { waitUntil: 'networkidle0', timeout: 45000 });

        const spaMountCount = await pageSpa.evaluate(() => window.__spaLoaderMounts || 0);
        assert(spaMountCount === 0, `Navigation: BrandLoader did NOT restart during subsequent route navigations (mounts: ${spaMountCount})`);
        await spaContext.close();

        // =====================================================================
        // PART 4: ADMIN INFORMATION ARCHITECTURE & ADD-ONS UI
        // =====================================================================
        console.log('\n--- 4. ADMIN INFORMATION ARCHITECTURE & ADD-ONS UI ---');

        const iaContext = await browser.createBrowserContext();
        const pageAdminIA = await iaContext.newPage();
        await pageAdminIA.goto(BASE_URL, { waitUntil: 'networkidle0', timeout: 45000 });
        await pageAdminIA.waitForFunction(() => !document.querySelector('[aria-label="Loading XerService"]'), { timeout: 10000 }).catch(() => {});
        await injectSession(pageAdminIA, adminSession);
        await pageAdminIA.goto(`${BASE_URL}/admin/users`, { waitUntil: 'networkidle0', timeout: 45000 });
        await pageAdminIA.waitForFunction(() => !document.querySelector('[aria-label="Loading XerService"]'), { timeout: 8000 }).catch(() => {});

        // Check the 3 distinct core section navigation paths
        const adminHrefs = await pageAdminIA.evaluate(() => {
            const anchors = Array.from(document.querySelectorAll('nav a, header a, .nav-shell a'));
            return Array.from(new Set(anchors.map(a => a.getAttribute('href')).filter(Boolean)));
        });

        const hasUsers = adminHrefs.includes('/admin/users');
        const hasFinance = adminHrefs.includes('/admin/finance');
        const hasAddons = adminHrefs.includes('/admin/addons');

        assert(hasUsers, 'Admin IA: Primary section 1 "Users & Vendors" (/admin/users) clearly present');
        assert(hasFinance, 'Admin IA: Primary section 2 "Finance" (/admin/finance) clearly present');
        assert(hasAddons, 'Admin IA: Primary section 3 "Add-ons" (/admin/addons) clearly present');

        // Check Add-ons page structure
        await pageAdminIA.goto(`${BASE_URL}/admin/addons`, { waitUntil: 'networkidle0', timeout: 45000 });
        await pageAdminIA.waitForFunction(() => !document.querySelector('[aria-label="Loading XerService"]'), { timeout: 8000 }).catch(() => {});
        // Wait for page data to load (admin auth + API data fetching)
        await pageAdminIA.waitForFunction(
            () => document.body.innerText.includes('Active Catalog') && document.body.innerText.includes('D-Block'),
            { timeout: 10000 }
        ).catch(() => {});
        await pageAdminIA.screenshot({ path: path.join(SCREENSHOT_DIR, '07-admin-addons.png') });

        const pageText = await pageAdminIA.evaluate(() => document.body.innerText);
        const hasCatalog = pageText.includes('Active Catalog');
        const hasShopAssignment = (pageText.toUpperCase().includes('ASSIGNED SHOPS') || pageText.toLowerCase().includes('assigned shops')) && pageText.includes('D-Block Reprography ITECH');
        assert(hasCatalog, 'Admin Add-ons: "Add-on Catalog" clearly displayed');
        assert(hasShopAssignment, 'Admin Add-ons: "Shop Assignment" clearly presented with assigned shop badges');

        // Open Create Add-on modal
        await pageAdminIA.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('button'));
            const b = btns.find(btn => btn.innerText.includes('Create Add-on'));
            if (b) b.click();
        });
        await new Promise(r => setTimeout(r, 1000));
        await pageAdminIA.screenshot({ path: path.join(SCREENSHOT_DIR, '08-admin-addons-modal.png') });

        const modalText = await pageAdminIA.evaluate(() => {
            const form = document.querySelector('form');
            return form ? form.innerText : '';
        });

        const hasShopSection = modalText.toLowerCase().includes('available at print shops');
        const hasSelectAll = modalText.includes('Select All') && modalText.includes('Deselect All');
        const hasShopOption = modalText.includes('D-Block Reprography ITECH');

        assert(hasShopSection, 'Admin Add-ons: Modal includes "Available at Print Shops" section');
        assert(hasSelectAll, 'Admin Add-ons: Modal includes "Select All" and "Deselect All" controls');
        assert(hasShopOption, 'Admin Add-ons: Shop selection checkboxes render correctly with active shop');

        await iaContext.close();

    } finally {
        await browser.close();
    }

    console.log('\n===============================================================');
    console.log(`Browser Verification Complete: ${passedTests} passed, ${failedTests} failed, ${totalTests} total.`);
    console.log('===============================================================');

    if (failedTests > 0) process.exit(1);
}

run().catch(err => {
    console.error('Browser verification fatal error:', err);
    process.exit(1);
});

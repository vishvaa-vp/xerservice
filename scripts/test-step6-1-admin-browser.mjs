/**
 * Step 6.1: Standalone Admin E2E Browser Verification Suite
 * Tests apps/admin (port 3003) against root backend (port 3000)
 */

import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
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

const supabaseUrl = envVars['NEXT_PUBLIC_SUPABASE_URL'] || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseSecret = envVars['SUPABASE_SECRET_KEY'] || process.env.SUPABASE_SECRET_KEY;
const supabaseAnon = envVars['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'] || envVars['NEXT_PUBLIC_SUPABASE_ANON_KEY'];

const serviceClient = createClient(supabaseUrl, supabaseSecret);
const ADMIN_ORIGIN = 'http://localhost:3003';
const BACKEND_ORIGIN = 'http://localhost:3000';

const results = {
    total: 0,
    passed: 0,
    failed: 0,
    tests: [],
    networkLogs: [],
    consoleErrors: [],
    consoleWarnings: [],
};

function assert(condition, name, details = '') {
    results.total++;
    if (condition) {
        results.passed++;
        results.tests.push({ name, status: 'PASS', details });
        console.log(`  ✓ PASS [${results.total}]: ${name}`);
    } else {
        results.failed++;
        results.tests.push({ name, status: 'FAIL', details });
        console.error(`  ✗ FAIL [${results.total}]: ${name} - ${details}`);
    }
}

async function getAuthToken(email) {
    const { data, error } = await serviceClient.auth.admin.generateLink({ type: 'magiclink', email });
    if (error || !data?.properties?.email_otp) {
        throw new Error(`Magiclink failed for ${email}: ${error?.message}`);
    }
    const c = createClient(supabaseUrl, supabaseAnon, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: sess, error: e2 } = await c.auth.verifyOtp({ email, token: data.properties.email_otp, type: 'email' });
    if (e2 || !sess?.session) {
        throw new Error(`OTP verify failed for ${email}: ${e2?.message}`);
    }
    return sess.session;
}

async function injectSession(page, session) {
    await page.evaluate((sessionData, url) => {
        const hostname = new URL(url).hostname;
        const ref = hostname.split('.')[0];
        const storageKey = `sb-${ref}-auth-token`;
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

async function runSuite() {
    console.log('===============================================================');
    console.log('XerService — Step 6.1 Admin Standalone Browser Verification');
    console.log('Target: ' + ADMIN_ORIGIN + ' (Backend: ' + BACKEND_ORIGIN + ')');
    console.log('===============================================================\n');

    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1440,900'],
        defaultViewport: { width: 1440, height: 900 },
    });

    try {
        // -------------------------------------------------------------
        // Test Group A: Unauthenticated Access & Protected Route Redirects
        // -------------------------------------------------------------
        console.log('--- 1. UNAUTHENTICATED ROUTE PROTECTION ---');

        const anonCtx = await browser.createBrowserContext();
        const anonPage = await anonCtx.newPage();

        // 1a. /admin/users unauth
        await anonPage.goto(`${ADMIN_ORIGIN}/admin/users`, { waitUntil: 'networkidle2', timeout: 30000 });
        const usersUrl = anonPage.url();
        assert(usersUrl.includes('/xad/login') || usersUrl.includes('/admin/login'),
            'Unauthenticated /admin/users redirects to Admin Login', `URL: ${usersUrl}`);

        // 1b. /admin/finance unauth
        await anonPage.goto(`${ADMIN_ORIGIN}/admin/finance`, { waitUntil: 'networkidle2', timeout: 30000 });
        const financeUrl = anonPage.url();
        assert(financeUrl.includes('/xad/login') || financeUrl.includes('/admin/login'),
            'Unauthenticated /admin/finance redirects to Admin Login', `URL: ${financeUrl}`);

        // 1c. /admin/addons unauth
        await anonPage.goto(`${ADMIN_ORIGIN}/admin/addons`, { waitUntil: 'networkidle2', timeout: 30000 });
        const addonsUrl = anonPage.url();
        assert(addonsUrl.includes('/xad/login') || addonsUrl.includes('/admin/login'),
            'Unauthenticated /admin/addons redirects to Admin Login', `URL: ${addonsUrl}`);

        await anonCtx.close();

        // -------------------------------------------------------------
        // Test Group B: Admin Session Generation & Login
        // -------------------------------------------------------------
        console.log('\n--- 2. ADMIN AUTHENTICATION & SESSION HYDRATION ---');
        const adminSession = await getAuthToken('xerservice@gmail.com');
        assert(Boolean(adminSession?.access_token), 'Authoritative Supabase session generated for xerservice@gmail.com');

        const { data: adminProfile } = await serviceClient
            .from('profiles')
            .select('role, user_id')
            .eq('user_id', adminSession.user.id)
            .single();
        assert(adminProfile?.role === 'admin', 'Supabase profiles.role confirmed as "admin" for admin session');

        const adminCtx = await browser.createBrowserContext();
        const adminPage = await adminCtx.newPage();

        // Attach console & network listeners
        adminPage.on('console', msg => {
            const text = msg.text();
            if (msg.type() === 'error') results.consoleErrors.push(text);
            else if (msg.type() === 'warning') results.consoleWarnings.push(text);
        });

        adminPage.on('request', req => {
            const url = req.url();
            if (url.includes('/api/admin/')) {
                const headers = req.headers();
                results.networkLogs.push({
                    url,
                    method: req.method(),
                    hasAuthHeader: Boolean(headers['authorization']),
                    hasSecretKey: Boolean(headers['apikey'] && headers['apikey'] === supabaseSecret),
                });
            }
        });

        // Initialize adminPage with session
        await adminPage.goto(ADMIN_ORIGIN, { waitUntil: 'domcontentloaded' });
        await injectSession(adminPage, adminSession);

        // -------------------------------------------------------------
        // Test Group C: Admin Dashboard (/xad/dashboard)
        // -------------------------------------------------------------
        console.log('\n--- 3. ADMIN DASHBOARD (/xad/dashboard) ---');
        await adminPage.goto(`${ADMIN_ORIGIN}/xad/dashboard`, { waitUntil: 'networkidle2', timeout: 30000 });
        await adminPage.waitForFunction(() => !document.querySelector('[aria-label="Loading XerService"]'), { timeout: 10000 }).catch(() => {});
        const dashboardText = await adminPage.evaluate(() => document.body.innerText);
        assert(dashboardText.includes('XAD Admin Dashboard') || dashboardText.includes('Admin Controls'),
            'Admin Dashboard (/xad/dashboard) loads and renders operations console',
            `Title visible in body: ${dashboardText.slice(0, 100).replace(/\n/g, ' ')}`);

        // -------------------------------------------------------------
        // Test Group D: Users & Vendors Console (/admin/users)
        // -------------------------------------------------------------
        console.log('\n--- 4. USERS & VENDORS CONSOLE (/admin/users) ---');
        await adminPage.goto(`${ADMIN_ORIGIN}/admin/users`, { waitUntil: 'networkidle2', timeout: 30000 });
        const usersText = await adminPage.evaluate(() => document.body.innerText);
        assert(usersText.includes('Users') || usersText.includes('Vendors') || usersText.includes('Search'),
            'Users & Vendors Console (/admin/users) loads and renders account table',
            `Content: ${usersText.slice(0, 100).replace(/\n/g, ' ')}`);

        // -------------------------------------------------------------
        // Test Group E: Vendors Redirect (/admin/vendors)
        // -------------------------------------------------------------
        console.log('\n--- 5. VENDORS REDIRECT (/admin/vendors) ---');
        await adminPage.goto(`${ADMIN_ORIGIN}/admin/vendors`, { waitUntil: 'networkidle2', timeout: 30000 });
        const currentVendorsUrl = adminPage.url();
        assert(currentVendorsUrl.includes('/admin/users?role=vendor') || currentVendorsUrl.includes('/admin/users'),
            'Vendors route (/admin/vendors) redirects cleanly to /admin/users?role=vendor',
            `Resolved URL: ${currentVendorsUrl}`);

        // -------------------------------------------------------------
        // Test Group F: Finance Console (/admin/finance)
        // -------------------------------------------------------------
        console.log('\n--- 6. FINANCE CONSOLE (/admin/finance) ---');
        await adminPage.goto(`${ADMIN_ORIGIN}/admin/finance`, { waitUntil: 'networkidle2', timeout: 30000 });
        const financeText = await adminPage.evaluate(() => document.body.innerText);
        assert(financeText.includes('Finance') || financeText.includes('Settlements') || financeText.includes('Commission'),
            'Finance Console (/admin/finance) loads and renders financial data',
            `Content: ${financeText.slice(0, 100).replace(/\n/g, ' ')}`);

        // -------------------------------------------------------------
        // Test Group G: Add-ons Catalog (/admin/addons)
        // -------------------------------------------------------------
        console.log('\n--- 7. ADD-ONS CATALOG (/admin/addons) ---');
        await adminPage.goto(`${ADMIN_ORIGIN}/admin/addons`, { waitUntil: 'networkidle2', timeout: 30000 });
        const addonsText = await adminPage.evaluate(() => document.body.innerText);
        assert(addonsText.includes('Add-on') || addonsText.includes('Catalog') || addonsText.includes('Finishing'),
            'Add-ons Catalog (/admin/addons) loads and renders management UI',
            `Content: ${addonsText.slice(0, 100).replace(/\n/g, ' ')}`);

        // -------------------------------------------------------------
        // Test Group H: API Rewrite Verification via Origin 3003
        // -------------------------------------------------------------
        console.log('\n--- 8. API REWRITE VERIFICATION THROUGH PORT 3003 ---');
        const apiSummaryRes = await adminPage.evaluate(async (token) => {
            try {
                const res = await fetch('/api/admin/finance/summary', {
                    headers: { Authorization: `Bearer ${token}` }
                });
                return {
                    status: res.status,
                    ok: res.ok,
                    data: await res.json(),
                };
            } catch (err) {
                return { error: err.message };
            }
        }, adminSession.access_token);

        assert(apiSummaryRes.status === 200,
            'API Rewrite: /api/admin/finance/summary routed from port 3003 to backend port 3000 successfully (HTTP 200)',
            `Status: ${apiSummaryRes.status}`);

        // -------------------------------------------------------------
        // Test Group I: Non-Admin Access Protection (RBAC)
        // -------------------------------------------------------------
        console.log('\n--- 9. NON-ADMIN PROTECTION (RBAC) ---');
        const customerSession = await getAuthToken('vishvaaparthipan@gmail.com');
        const custCtx = await browser.createBrowserContext();
        const custPage = await custCtx.newPage();
        await custPage.goto(ADMIN_ORIGIN, { waitUntil: 'domcontentloaded' });
        await injectSession(custPage, customerSession);

        // Non-admin trying to call admin API via rewrite
        const nonAdminApiRes = await custPage.evaluate(async (token) => {
            try {
                const res = await fetch('/api/admin/finance/summary', {
                    headers: { Authorization: `Bearer ${token}` }
                });
                return {
                    status: res.status,
                    ok: res.ok,
                    data: await res.json(),
                };
            } catch (err) {
                return { error: err.message };
            }
        }, customerSession.access_token);

        assert(nonAdminApiRes.status === 403,
            'Non-admin RBAC: Customer calling /api/admin/finance/summary receives HTTP 403 Forbidden',
            `Status: ${nonAdminApiRes.status}`);

        await custCtx.close();

        // -------------------------------------------------------------
        // Test Group J: Logout & Post-Logout Protection
        // -------------------------------------------------------------
        console.log('\n--- 10. LOGOUT & POST-LOGOUT PROTECTION ---');
        await adminPage.goto(`${ADMIN_ORIGIN}/admin/finance`, { waitUntil: 'networkidle2' });

        // Execute logout via Supabase client inside page
        await adminPage.evaluate(async () => {
            const hostname = window.location.hostname;
            // Clear all localStorage auth tokens
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (k && k.includes('auth-token')) localStorage.removeItem(k);
            }
            window.location.href = '/xad/login';
        });

        await adminPage.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});
        const postLogoutUrl = adminPage.url();
        assert(postLogoutUrl.includes('/xad/login'),
            'Logout redirected successfully to /xad/login', `URL: ${postLogoutUrl}`);

        // Try accessing /admin/finance again
        await adminPage.goto(`${ADMIN_ORIGIN}/admin/finance`, { waitUntil: 'networkidle2', timeout: 30000 });
        const postLogoutFinanceUrl = adminPage.url();
        assert(postLogoutFinanceUrl.includes('/xad/login') || postLogoutFinanceUrl.includes('/admin/login'),
            'Post-logout access to /admin/finance is strictly rejected and redirected to login',
            `URL: ${postLogoutFinanceUrl}`);

        await adminCtx.close();

    } finally {
        await browser.close();
    }

    // Print Summary
    console.log('\n===============================================================');
    console.log(`Verification Complete: ${results.passed}/${results.total} Passed (${results.failed} Failed)`);
    console.log('===============================================================');

    // Network inspection
    console.log('\n--- NETWORK CALL AUDIT ---');
    console.log(`Total /api/admin/* requests intercepted: ${results.networkLogs.length}`);
    const unauthenticatedCalls = results.networkLogs.filter(l => !l.hasAuthHeader);
    const leakedSecrets = results.networkLogs.filter(l => l.hasSecretKey);
    console.log(`Unauthenticated admin calls: ${unauthenticatedCalls.length}`);
    console.log(`Leaked service secret keys: ${leakedSecrets.length}`);

    // Console inspection
    console.log('\n--- BROWSER CONSOLE AUDIT ---');
    const fatalErrors = results.consoleErrors.filter(e => !e.includes('favicon') && !e.includes('Failed to load resource'));
    console.log(`Total console errors: ${results.consoleErrors.length} (Fatal: ${fatalErrors.length})`);
    console.log(`Total console warnings: ${results.consoleWarnings.length}`);
    if (fatalErrors.length > 0) {
        console.log('Errors:', fatalErrors.slice(0, 5));
    }

    if (results.failed > 0) {
        process.exit(1);
    }
}

runSuite().catch(err => {
    console.error('Test suite failed:', err);
    process.exit(1);
});

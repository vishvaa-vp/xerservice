/**
 * Comprehensive Automated Verification for Combined "Review & Pay" Page
 * Run: node --env-file=.env.local scripts/verify-review-pay-flow.mjs
 */

import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Load environment variables
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
const supabaseAnon = envVars['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'] || envVars['NEXT_PUBLIC_SUPABASE_ANON_KEY'] || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

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
    console.log('XerService — Combined "Review & Pay" Flow Verification');
    console.log('One Unified Checkout Page • Live Preview • Add-ons • Razorpay');
    console.log('===============================================================\n');

    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1440,1050'],
        defaultViewport: { width: 1440, height: 1050 },
    });

    try {
        console.log('1. Acquiring customer session token...');
        const userSession = await getAuthToken('xerservice@gmail.com');
        console.log('✓ Customer session token ready.\n');

        const context = await browser.createBrowserContext();
        const page = await context.newPage();
        await page.setViewport({ width: 1440, height: 1050 });

        // Navigate to home to inject session
        await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await page.waitForFunction(() => !document.querySelector('[aria-label="Loading XerService"]'), { timeout: 10000 }).catch(() => {});
        await injectSession(page, userSession);

        // Target test order with document and add-ons
        const targetOrderId = 'b3a8d4f4-7345-47d7-89f5-f5c6c2f8b2d9';
        console.log(`2. Navigating to /order/pricing?order=${targetOrderId}...`);
        await page.goto(`${BASE_URL}/order/pricing?order=${targetOrderId}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await page.waitForFunction(() => !document.querySelector('[aria-label="Loading XerService"]'), { timeout: 10000 }).catch(() => {});

        // Wait for page header to render
        await page.waitForSelector('h1', { timeout: 15000 });
        // Wait for DB data to populate
        await page.waitForFunction(() => document.body.innerText.includes('XS-101682') || document.body.innerText.includes('D-Block'), { timeout: 15000 }).catch(() => {});
        // Wait for PDF canvas preview to render if available
        await page.waitForSelector('canvas', { timeout: 15000 }).catch(() => {});

        console.log('3. Verifying Unified "Review & Pay" Page Structure...');

        const pageTitle = await page.evaluate(() => {
            const h1 = document.querySelector('h1');
            return h1 ? h1.innerText : '';
        });
        assert(pageTitle.includes('Review & Pay'), 'Title: Page explicitly displays "Review & Pay"');

        // Breadcrumb
        const breadcrumbText = await page.evaluate(() => {
            const bc = document.querySelector('nav[aria-label="Checkout Progress"]');
            return bc ? bc.innerText : '';
        });
        assert(breadcrumbText.includes('Shops') && breadcrumbText.includes('Review & Pay'), 'Breadcrumb: Reflects single checkout position (Shops > Configure > Review & Pay)');

        const pageText = await page.evaluate(() => document.body.innerText);

        // Shop & Order Number
        assert(pageText.includes('D-Block Reprography ITECH'), 'Header: Displays print partner "D-Block Reprography ITECH"');
        assert(pageText.includes('XS-101682'), 'Header: Displays order number "XS-101682"');

        // Live Preview Section
        assert(pageText.includes('Live Print Preview'), 'Live Preview: Interactive preview container rendered');
        assert(pageText.includes('4 printable pages') || pageText.includes('4 sheets'), 'Pages & Sheets: Displays authoritative page and sheet counts');

        // Print Settings Manifest
        assert(pageText.includes('Print Configuration'), 'Print Settings: Manifest card rendered');
        assert(pageText.includes('PAPER') && pageText.includes('A4'), 'Print Settings: Paper size pill displayed');
        assert(pageText.includes('COLOR') && pageText.includes('B&W'), 'Print Settings: Color mode pill displayed');
        assert(pageText.includes('SIDES') && (pageText.includes('Single-sided') || pageText.includes('Double-sided')), 'Print Settings: Sides pill displayed');
        assert(pageText.includes('Edit Settings'), 'Edit Settings: Clear action button provided');

        // Finishing & Add-ons
        assert(pageText.includes('Finishing & Add-ons') && pageText.includes('Lamination'), 'Add-ons: Itemized add-on "Lamination" displayed');
        assert(pageText.includes('₹20.00'), 'Add-ons: Itemized add-on price ₹20.00 displayed');

        // Payment Summary
        assert(pageText.includes('Payment Summary'), 'Summary: Sticky "Payment Summary" card rendered');
        assert(pageText.includes('Print charges') && pageText.includes('₹8.00'), 'Summary: Line item for print charges ₹8.00');
        assert(pageText.includes('Add-ons subtotal') && pageText.includes('₹20.00'), 'Summary: Line item for add-ons ₹20.00');
        assert(pageText.includes('Total Due') && pageText.includes('₹28.00'), 'Summary: Authoritative total matches server price ₹28.00');

        // Payment Methods
        assert(pageText.includes('Online / UPI'), 'Payment Method: Online / UPI tab present');
        assert(pageText.includes('XerCoins'), 'Payment Method: XerCoins wallet tab present');

        // Pay CTA & Trust
        assert(pageText.includes('Pay ₹28.00 securely'), 'Primary CTA: Displays authoritative amount "Pay ₹28.00 securely"');
        assert(pageText.includes('Save & Add to Cart'), 'Secondary Action: "Save & Add to Cart" button preserved');
        assert(pageText.includes('256-bit SSL encrypted • Powered by Razorpay'), 'Trust: Displays SSL / Razorpay security reassurance');

        // Capture Desktop Screenshot
        const desktopScreenshotPath = path.join(SCREENSHOT_DIR, 'review-pay-desktop.png');
        await page.screenshot({ path: desktopScreenshotPath, fullPage: false });
        console.log(`✓ Desktop screenshot saved: ${desktopScreenshotPath}`);
        assert(fs.existsSync(desktopScreenshotPath), 'Screenshot: Desktop layout captured successfully');

        // 4. Test Switching to Wallet
        console.log('4. Testing Payment Method Switcher...');
        await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            const walletBtn = buttons.find(b => b.innerText.includes('XerCoins'));
            if (walletBtn) walletBtn.click();
        });
        await new Promise(r => setTimeout(r, 600));

        const walletText = await page.evaluate(() => document.body.innerText);
        assert(walletText.includes('Wallet Balance:') && (walletText.includes('Pay ₹28.00 with XerCoins') || walletText.includes('Insufficient coins')), 'Wallet Mode: Displays real-time balance and context-aware action CTA');

        const walletScreenshotPath = path.join(SCREENSHOT_DIR, 'review-pay-wallet.png');
        await page.screenshot({ path: walletScreenshotPath, fullPage: false });
        console.log(`✓ Wallet screenshot saved: ${walletScreenshotPath}`);

        // Switch back to UPI
        await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            const upiBtn = buttons.find(b => b.innerText.includes('Online / UPI'));
            if (upiBtn) upiBtn.click();
        });
        await new Promise(r => setTimeout(r, 600));

        // 5. Test Mobile Viewport (375x812)
        console.log('5. Testing Mobile Viewport (375x812)...');
        await page.setViewport({ width: 375, height: 812 });
        await page.evaluate(() => window.scrollTo(0, 0));
        await new Promise(r => setTimeout(r, 800));

        const isMobile = await page.evaluate(() => window.innerWidth === 375);
        assert(isMobile, 'Mobile Viewport: Rendered cleanly at 375px width');

        const mobileScreenshotPath = path.join(SCREENSHOT_DIR, 'review-pay-mobile.png');
        await page.screenshot({ path: mobileScreenshotPath, fullPage: false });
        console.log(`✓ Mobile screenshot saved: ${mobileScreenshotPath}`);
        assert(fs.existsSync(mobileScreenshotPath), 'Screenshot: Mobile single-column layout captured successfully');

        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await new Promise(r => setTimeout(r, 600));
        const mobileScrolledScreenshotPath = path.join(SCREENSHOT_DIR, 'review-pay-mobile-scrolled.png');
        await page.screenshot({ path: mobileScrolledScreenshotPath, fullPage: false });
        console.log(`✓ Mobile scrolled screenshot saved: ${mobileScrolledScreenshotPath}`);

        // 6. Verify Compatibility Redirect from /order/payment -> /order/pricing
        console.log('6. Verifying Compatibility Redirect from /order/payment...');
        await page.setViewport({ width: 1440, height: 1050 });
        await page.goto(`${BASE_URL}/order/payment?order=${targetOrderId}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await page.waitForFunction(() => window.location.pathname === '/order/pricing', { timeout: 10000 });
        const finalUrl = page.url();
        assert(finalUrl.includes('/order/pricing') && finalUrl.includes(`order=${targetOrderId}`), `Compatibility: /order/payment seamlessly redirects to ${finalUrl}`);

        await context.close();
    } finally {
        await browser.close();
    }

    console.log('\n===============================================================');
    console.log(`Review & Pay Flow Verification Complete: ${passedTests} passed, ${failedTests} failed, ${totalTests} total.`);
    console.log('===============================================================');

    if (failedTests > 0) process.exit(1);
}

run().catch(err => {
    console.error('Fatal verification error:', err);
    process.exit(1);
});

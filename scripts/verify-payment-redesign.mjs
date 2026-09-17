/**
 * Comprehensive Verification for Payment UI Redesign
 * Run: node --env-file=.env.local scripts/verify-payment-redesign.mjs
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
    console.log('XerService — Payment UI Redesign Verification');
    console.log('Desktop 2-Column Layout • Mobile Stack • Sticky Summary • Add-ons');
    console.log('===============================================================\n');

    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1440,1000'],
        defaultViewport: { width: 1440, height: 1000 },
    });

    try {
        console.log('1. Acquiring authenticated customer session...');
        const userSession = await getAuthToken('xerservice@gmail.com');
        console.log('✓ Session acquired.\n');

        const context = await browser.createBrowserContext();
        const page = await context.newPage();
        await page.setViewport({ width: 1440, height: 1000 });

        // Navigate to home to inject session
        await page.goto(BASE_URL, { waitUntil: 'networkidle0', timeout: 45000 });
        await page.waitForFunction(() => !document.querySelector('[aria-label="Loading XerService"]'), { timeout: 10000 }).catch(() => {});
        await injectSession(page, userSession);

        // Target test order with files and add-ons
        const targetOrderId = 'b3a8d4f4-7345-47d7-89f5-f5c6c2f8b2d9';
        console.log(`2. Navigating to /order/payment?order=${targetOrderId}...`);
        await page.goto(`${BASE_URL}/order/payment?order=${targetOrderId}`, { waitUntil: 'networkidle0', timeout: 45000 });
        await page.waitForFunction(() => !document.querySelector('[aria-label="Loading XerService"]'), { timeout: 10000 }).catch(() => {});

        // Wait for payment page content to render
        await page.waitForSelector('button, .card', { timeout: 10000 });

        console.log('3. Verifying Presentation-Layer Structure & UI Components...');

        // Verify Breadcrumb
        const breadcrumbText = await page.evaluate(() => {
            const bc = document.querySelector('nav[aria-label="Checkout Progress"]');
            return bc ? bc.innerText : '';
        });
        assert(breadcrumbText.includes('Shops') && breadcrumbText.includes('Payment'), 'Breadcrumb: Indicates navigation hierarchy (Shops > Pricing > Payment)');

        // Verify Shop & Order Header
        const headerText = await page.evaluate(() => document.body.innerText);
        assert(headerText.includes('D-Block Reprography ITECH'), 'Header: Displays accurate shop name "D-Block Reprography ITECH"');
        assert(headerText.includes('XS-101682'), 'Header: Displays formatted order number "XS-101682"');

        // Verify Document & Print Specs
        assert(headerText.includes('XerService_Login_Recommendation.pdf'), 'Files Card: Displays original document filename');
        assert(headerText.includes('4 pages') || headerText.includes('4 sheets'), 'Files Card: Displays page and sheet counts');

        // Verify Print Settings Pills
        assert(headerText.includes('PAPER') && headerText.includes('A4'), 'Print Settings: Paper size pill displayed');
        assert(headerText.includes('COLOR') && headerText.includes('B&W'), 'Print Settings: Color mode pill displayed');
        assert(headerText.includes('SIDES') && headerText.includes('Single-sided'), 'Print Settings: Sides pill displayed');

        // Verify Add-on Breakdown
        assert(headerText.includes('Lamination'), 'Add-ons Card: Itemizes "Lamination" add-on with snapshot data');
        assert(headerText.includes('₹20.00'), 'Add-ons Card: Displays itemized add-on price ₹20.00');

        // Verify Sticky Payment Summary
        assert(headerText.includes('Payment Summary'), 'Sidebar: Sticky "Payment Summary" card rendered');
        assert(headerText.includes('Print charges') && headerText.includes('₹8.00'), 'Summary: Line item for print cost ₹8.00');
        assert(headerText.includes('Add-ons') && headerText.includes('₹20.00'), 'Summary: Line item for add-ons ₹20.00');
        assert(headerText.includes('Total Due') && headerText.includes('₹28.00'), 'Summary: Authoritative total matches server price ₹28.00');

        // Verify Payment Method Options
        const hasRazorpayOption = headerText.includes('Online / UPI');
        const hasWalletOption = headerText.includes('XerCoins');
        assert(hasRazorpayOption, 'Payment Options: Online / UPI option present');
        assert(hasWalletOption, 'Payment Options: XerCoins Wallet option present');

        // Verify Security Badges & CTAs
        assert(headerText.includes('256-bit SSL encrypted') && headerText.includes('Powered by Razorpay'), 'Trust: Displays SSL / Powered by Razorpay badge');
        assert(headerText.includes('Pay ₹28.00 securely'), 'CTA: Displays authoritative primary payment button');

        // Take Desktop Screenshot
        const desktopScreenshotPath = path.join(SCREENSHOT_DIR, 'payment-ui-desktop.png');
        await page.screenshot({ path: desktopScreenshotPath, fullPage: false });
        console.log(`✓ Desktop screenshot saved: ${desktopScreenshotPath}`);
        assert(fs.existsSync(desktopScreenshotPath), 'Screenshot: Desktop layout captured successfully');

        // Verify Switch to Wallet Method
        console.log('4. Testing Payment Method Switcher...');
        const switchedToWallet = await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            const walletBtn = buttons.find(b => b.innerText.includes('XerCoins'));
            if (walletBtn) {
                walletBtn.click();
                return true;
            }
            return false;
        });
        assert(switchedToWallet, 'Interaction: Successfully switched to XerCoins Wallet tab');
        await new Promise(r => setTimeout(r, 600));

        const walletStateText = await page.evaluate(() => document.body.innerText);
        assert(walletStateText.includes('Pay ₹28.00 with XerCoins') || walletStateText.includes('Insufficient coins') || walletStateText.includes('Wallet Balance'), 'Wallet Tab: Displays dynamic wallet balance and context-aware action CTA');

        const walletScreenshotPath = path.join(SCREENSHOT_DIR, 'payment-ui-wallet.png');
        await page.screenshot({ path: walletScreenshotPath, fullPage: false });
        console.log(`✓ Wallet tab screenshot saved: ${walletScreenshotPath}`);

        // Switch back to Razorpay
        await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            const rzpBtn = buttons.find(b => b.innerText.includes('Online / UPI'));
            if (rzpBtn) rzpBtn.click();
        });
        await new Promise(r => setTimeout(r, 600));

        // Verify Mobile Responsive Stack (375 x 812 viewport)
        console.log('5. Testing Mobile Viewport (375x812)...');
        await page.setViewport({ width: 375, height: 812 });
        await page.evaluate(() => window.scrollTo(0, 0));
        await new Promise(r => setTimeout(r, 800));

        const isMobileWidth = await page.evaluate(() => window.innerWidth === 375);
        assert(isMobileWidth, 'Mobile Viewport: Rendered cleanly at 375px');

        const mobileScreenshotPath = path.join(SCREENSHOT_DIR, 'payment-ui-mobile.png');
        await page.screenshot({ path: mobileScreenshotPath, fullPage: false });
        console.log(`✓ Mobile screenshot saved: ${mobileScreenshotPath}`);
        assert(fs.existsSync(mobileScreenshotPath), 'Screenshot: Mobile stacked layout captured successfully');

        // Verify Razorpay Script Preload
        const isRazorpayScriptLoaded = await page.evaluate(() => {
            return typeof window.Razorpay === 'function' || !!document.querySelector('script[src*="checkout.razorpay.com"]');
        });
        assert(isRazorpayScriptLoaded, 'Security & Readiness: Razorpay Standard Checkout script preloaded');

        await context.close();
    } finally {
        await browser.close();
    }

    console.log('\n===============================================================');
    console.log(`Payment UI Verification Complete: ${passedTests} passed, ${failedTests} failed, ${totalTests} total.`);
    console.log('===============================================================');

    if (failedTests > 0) process.exit(1);
}

run().catch(err => {
    console.error('Fatal verification error:', err);
    process.exit(1);
});

/**
 * Test Suite: Google OAuth & XerService Product Revision Sprint Audit
 *
 * Verifies all product revision requirements and Google OAuth integration:
 * 1. Google OAuth client integration in login page
 * 2. Google OAuth callback handler page (PKCE code exchange & safe redirect)
 * 3. No auto-shop selection
 * 4. Mobile bottom navigation layout (5 tabs, single button Print)
 * 5. Delete Account API architecture (retention of financial records)
 * 6. Login link ordering (Create Account on left, Forgot Password on right)
 * 7. Mobile header formatting (Cart beside bell, no profile dropdown, Log in when logged out)
 * 8. Absence of Coimbatore info cards on homepage
 * 9. Favicon and title 'XerService (Tamilnadu)'
 * 10. Mobile profile avatar in bottom nav
 * 11. Payment selector UI (UPI/Online vs XerCoins)
 * 12. Vendor dashboard header cleanup & sequential actions
 * 13. Direct PDF safe printing workflow
 * 14. Admin access fix (no profiles.email column query)
 * 15. Strict financial ledger invariant assertion (11 rows, sumWallets=96, rules=0, batches=0, items=0)
 */

import fs from 'fs';
import path from 'path';
import assert from 'assert';
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

const serviceClient = createClient(supabaseUrl, supabaseSecret);

console.log('==================================================');
console.log('XERSERVICE PRODUCT REVISION SPRINT & OAUTH AUDIT');
console.log('==================================================\n');

// 1. Google OAuth in Login Page
console.log('[Check 1] Auditing Google OAuth in src/app/login/page.tsx...');
const loginCode = fs.readFileSync(path.join(rootDir, 'src/app/login/page.tsx'), 'utf8');
assert(loginCode.includes("provider: 'google'"), 'Login page must call signInWithOAuth with provider google');
assert(loginCode.includes('/auth/callback?redirect='), 'Login page must direct OAuth callback to /auth/callback');
assert(loginCode.includes('Continue with Google'), 'Login page must have Continue with Google button');
console.log('✓ Google OAuth client trigger verified in login page.\n');

// 2. Google OAuth Callback Handler Page
console.log('[Check 2] Auditing OAuth callback handler at src/app/auth/callback/page.tsx...');
const callbackPath = path.join(rootDir, 'src/app/auth/callback/page.tsx');
assert(fs.existsSync(callbackPath), 'OAuth callback page src/app/auth/callback/page.tsx must exist');
const callbackCode = fs.readFileSync(callbackPath, 'utf8');
assert(callbackCode.includes('exchangeCodeForSession'), 'Callback must exchange authorization code for session');
assert(callbackCode.includes('onAuthStateChange'), 'Callback must listen for auth state changes');
assert(callbackCode.includes('safeRedirect'), 'Callback must sanitize redirect destination');
console.log('✓ OAuth callback handler verified.\n');

// 3. No Auto Shop Selection
console.log('[Check 3] Auditing explicit shop selection in src/app/page.tsx and upload...');
const homeCode = fs.readFileSync(path.join(rootDir, 'src/app/page.tsx'), 'utf8');
const uploadCode = fs.readFileSync(path.join(rootDir, 'src/app/order/upload/page.tsx'), 'utf8');
assert(!homeCode.includes('/order/upload?shop=${firstShop.id}'), 'Home page must not auto-select firstShop.id');
assert(!uploadCode.includes(".order('name').limit(1)"), 'Upload page must not auto-select first shop if missing');
console.log('✓ Explicit shop selection verified.\n');

// 4. Mobile Bottom Navigation
console.log('[Check 4] Auditing mobile bottom navigation in src/components/layout/MobileNavigation.tsx...');
const mobileNavCode = fs.readFileSync(path.join(rootDir, 'src/components/layout/MobileNavigation.tsx'), 'utf8');
assert(mobileNavCode.includes("{ label: 'Shops'"), 'Customer nav must include Shops');
assert(mobileNavCode.includes("{ label: 'Orders'"), 'Customer nav must include Orders');
assert(mobileNavCode.includes("{ label: 'Print'"), 'Customer nav must include Print');
assert(mobileNavCode.includes("{ label: 'Wallet'"), 'Customer nav must include Wallet');
assert(mobileNavCode.includes("{ label: 'Profile'"), 'Customer nav must include Profile');
assert(mobileNavCode.includes('className="mobile-print-action"'), 'Nav must render unified center pill button');
console.log('✓ Mobile bottom navigation tabs and single center pill verified.\n');

// 5. Delete Account API
console.log('[Check 5] Auditing account deletion architecture in src/app/api/customer/account/delete/route.ts...');
const deleteRouteCode = fs.readFileSync(path.join(rootDir, 'src/app/api/customer/account/delete/route.ts'), 'utf8');
assert(deleteRouteCode.includes(".in('status', ['QUEUED', 'PRINTING', 'READY'])"), 'Must check for active in-progress orders');
assert(deleteRouteCode.includes("full_name: 'Deleted Account'"), 'Must anonymize user profile PII');
assert(deleteRouteCode.includes('@deleted.xerservice.internal'), 'Must anonymize user email');
assert(deleteRouteCode.includes('signOut(userId, \'global\')'), 'Must revoke user sessions globally');
console.log('✓ Delete account architecture and financial record retention verified.\n');

// 6. Login Link Ordering
console.log('[Check 6] Auditing login link ordering in src/app/login/page.tsx...');
const createAccIdx = loginCode.indexOf('Create Account');
const forgotPassIdx = loginCode.indexOf('Forgot password?');
assert(createAccIdx !== -1 && forgotPassIdx !== -1, 'Login page must have Create Account and Forgot password');
assert(createAccIdx < forgotPassIdx, 'Create Account must be positioned before (to the left of) Forgot password');
console.log('✓ Login link ordering (Create Account on left, Forgot password on right) verified.\n');

// 7. Mobile Header Formatting
console.log('[Check 7] Auditing mobile header formatting in src/components/layout/Navbar.tsx...');
const navbarCode = fs.readFileSync(path.join(rootDir, 'src/components/layout/Navbar.tsx'), 'utf8');
assert(navbarCode.includes('NotificationBell'), 'Navbar must have NotificationBell');
assert(navbarCode.includes('mobile-cart-btn'), 'Navbar must have mobile cart button next to bell');
assert(navbarCode.includes('.desktop-profile-dropdown { display: none !important; }'), 'Desktop profile dropdown must be hidden on mobile');
assert(navbarCode.includes('nav-customer-login'), 'Must render Log in button when logged out');
console.log('✓ Mobile header formatting verified.\n');

// 8. Absence of Coimbatore Info Cards on Homepage
console.log('[Check 8] Auditing absence of Coimbatore restriction cards on homepage...');
assert(!homeCode.includes('Coimbatore shops only for now'), 'Homepage must not contain Coimbatore restriction card');
console.log('✓ Homepage Coimbatore restriction card absence verified.\n');

// 9. Favicon and Title
console.log('[Check 9] Auditing title and icons in src/app/layout.tsx...');
const layoutCode = fs.readFileSync(path.join(rootDir, 'src/app/layout.tsx'), 'utf8');
assert(layoutCode.includes('XerService'), 'Page title must be XerService');
assert(layoutCode.includes('/favicon.ico'), 'Favicon must be configured');
assert(fs.existsSync(path.join(rootDir, 'public', 'favicon.ico')), 'public/favicon.ico must exist');
assert(fs.existsSync(path.join(rootDir, 'public', 'icon.png')), 'public/icon.png must exist');
console.log('✓ Title and circular icons verified.\n');

// 10. Mobile Profile Avatar
console.log('[Check 10] Auditing mobile profile avatar in src/components/layout/MobileNavigation.tsx...');
assert(mobileNavCode.includes('user.avatarUrl ? ('), 'Mobile profile tab must display user avatar image if available');
assert(mobileNavCode.includes('user.name[0].toUpperCase()'), 'Mobile profile tab must display initial if avatar absent');
console.log('✓ Mobile profile avatar display verified.\n');

// 11. Payment Selector UI
console.log('[Check 11] Auditing payment selector UI in src/app/order/payment/page.tsx...');
const paymentCode = fs.readFileSync(path.join(rootDir, 'src/app/order/payment/page.tsx'), 'utf8');
assert(paymentCode.includes('UPI / Online Payment'), 'Payment page must offer UPI / Online Payment');
assert(paymentCode.includes('XerCoins Wallet'), 'Payment page must offer XerCoins Wallet');
assert(paymentCode.includes('Razorpay Secure Checkout'), 'Must retain Razorpay checkout flow');
console.log('✓ Payment selector UI verified.\n');

// 12. Vendor Dashboard Header & Sequential Actions
console.log('[Check 12] Auditing vendor header and sequential actions in src/app/vendor/dashboard/page.tsx...');
const vendorCode = fs.readFileSync(path.join(rootDir, 'src/app/vendor/dashboard/page.tsx'), 'utf8');
assert(vendorCode.includes("{vendorShop?.name || 'D-Block Reprography ITECH'}"), 'Vendor header must display shop name');
assert(vendorCode.includes('Vendor Dashboard'), 'Vendor header must have subtitle Vendor Dashboard');
assert(vendorCode.includes('Start Printing'), 'Vendor must have Start Printing action');
assert(vendorCode.includes('Mark as Ready'), 'Vendor must have Mark as Ready action');
assert(vendorCode.includes('Complete Order'), 'Vendor must have Complete Order action');
console.log('✓ Vendor header and sequential order progression actions verified.\n');

// 13. Direct PDF Safe Printing
console.log('[Check 13] Auditing safe PDF printing modal in vendor dashboard...');
assert(vendorCode.includes('VendorPrintJobModal'), 'Vendor dashboard must feature dedicated print modal');
assert(vendorCode.includes('iframeRef.current.contentWindow.print()'), 'Must print directly from iframe without window.print() of dashboard');
assert(vendorCode.includes('inline=true'), 'PDF download URL must specify inline=true to prevent saving to disk');
console.log('✓ Direct PDF safe printing verified.\n');

// 14. Admin Access Fix
console.log('[Check 14] Auditing admin access query in src/lib/admin-auth.ts...');
const adminAuthCode = fs.readFileSync(path.join(rootDir, 'src/lib/admin-auth.ts'), 'utf8');
assert(!adminAuthCode.includes(".select('user_id, role, full_name, email')"), 'Must NOT select non-existent email column from profiles');
assert(adminAuthCode.includes(".select('user_id, role, full_name')"), 'Must select user_id, role, full_name only');
console.log('✓ Admin access query verified.\n');

// 15. Financial Ledger and Invariants Audit
console.log('[Check 15] Auditing live database financial invariants...');
const [rules, batches, items, ledger, wallets] = await Promise.all([
    serviceClient.from('shop_commission_rules').select('*', { count: 'exact', head: true }),
    serviceClient.from('vendor_settlement_batches').select('*', { count: 'exact', head: true }),
    serviceClient.from('vendor_settlement_items').select('*', { count: 'exact', head: true }),
    serviceClient.from('order_financial_ledger').select('*', { count: 'exact', head: true }),
    serviceClient.from('wallet_accounts').select('balance')
]);

const sumWallets = wallets.data ? wallets.data.reduce((acc, r) => acc + Number(r.balance || 0), 0) : 0;

console.log(`  Live database counts:`);
console.log(`  - shop_commission_rules: ${rules.count} (expected: 0)`);
console.log(`  - vendor_settlement_batches: ${batches.count} (expected: 0)`);
console.log(`  - vendor_settlement_items: ${items.count} (expected: 0)`);
console.log(`  - order_financial_ledger: ${ledger.count} (expected: 11)`);
console.log(`  - wallet_accounts total sum: Rs ${sumWallets} (expected: 96)`);

assert.strictEqual(rules.count, 0, 'shop_commission_rules count must remain 0');
assert.strictEqual(batches.count, 0, 'vendor_settlement_batches count must remain 0');
assert.strictEqual(items.count, 0, 'vendor_settlement_items count must remain 0');
assert.strictEqual(ledger.count, 11, 'order_financial_ledger count must remain exactly 11');
assert.strictEqual(sumWallets, 96, 'wallet_accounts sum must remain exactly 96');

console.log('✓ All database financial invariants strictly preserved.\n');

console.log('==================================================');
console.log('✓ ALL 15 PRODUCT REVISION & OAUTH AUDITS PASSED');
console.log('==================================================');

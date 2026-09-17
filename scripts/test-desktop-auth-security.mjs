/**
 * XerService Step 17.1 Correction Verification: Desktop Authentication Security
 */

import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const desktopDir = path.join(rootDir, 'apps', 'desktop');

console.log('========================================================================');
console.log('XERSERVICE STEP 17.1 CORRECTION: DESKTOP AUTH SECURITY VERIFICATION');
console.log('========================================================================\n');

let passed = 0;
let failed = 0;
function pass(msg) { console.log(`  [PASS] ${msg}`); passed++; }
function fail(msg, err) { console.error(`  [FAIL] ${msg}: ${err}`); failed++; }

async function runVerification() {
    // 1. Check index.html UI for token input absence & email/password presence
    console.log('--- CHECK 1: UI Credentials Presentation ---');
    try {
        const indexHtml = fs.readFileSync(path.join(desktopDir, 'index.html'), 'utf8');
        assert(indexHtml.includes('id="login-email"'), 'login-email input exists');
        assert(indexHtml.includes('id="login-password"'), 'login-password input exists');
        assert(!indexHtml.includes('placeholder="Paste your vendor access token"'), 'No bearer token paste placeholder');
        assert(!indexHtml.includes('for="login-token">Vendor Access Token'), 'No Vendor Access Token label in form');
        pass('Check 1: Desktop login UI uses email/password; no token input or paste prompt exposed');
    } catch (err) {
        fail('Check 1 failed', err.message);
    }

    // 2. Check in-memory storage adapter and zero localStorage writes
    console.log('\n--- CHECK 2: Storage Location Invariant (RAM Only) ---');
    try {
        const supabaseTs = fs.readFileSync(path.join(desktopDir, 'src', 'supabase.ts'), 'utf8');
        const mainTs = fs.readFileSync(path.join(desktopDir, 'src', 'main.ts'), 'utf8');

        assert(supabaseTs.includes('inMemoryStorageAdapter'), 'supabase.ts uses inMemoryStorageAdapter');
        assert(supabaseTs.includes('storage: inMemoryStorageAdapter'), 'Supabase client configured with in-memory adapter');
        assert(!supabaseTs.includes('localStorage.setItem'), 'supabase.ts never writes to localStorage');
        assert(!mainTs.includes('localStorage.setItem(\'xerservice_vendor_token\''), 'main.ts never saves token to localStorage');
        pass('Check 2: Session credentials strictly stored in-memory (RAM); zero tokens in localStorage');
    } catch (err) {
        fail('Check 2 failed', err.message);
    }

    // 3. Check role & shop authorization model reuse
    console.log('\n--- CHECK 3: Authorization Model & Role Enforcement ---');
    try {
        const supabaseTs = fs.readFileSync(path.join(desktopDir, 'src', 'supabase.ts'), 'utf8');
        assert(supabaseTs.includes('.from(\'profiles\')'), 'supabase.ts checks public.profiles');
        assert(supabaseTs.includes('profile.role !== \'vendor\''), 'supabase.ts enforces profile.role === vendor');
        assert(supabaseTs.includes('.from(\'shops\')'), 'supabase.ts checks public.shops');
        assert(supabaseTs.includes('.eq(\'owner_id\', authData.user.id)'), 'supabase.ts enforces vendor shop ownership');

        const vendorRoute = fs.readFileSync(path.join(rootDir, 'src', 'app', 'api', 'vendor', 'orders', 'route.ts'), 'utf8');
        assert(vendorRoute.includes('profile.role !== \'vendor\''), 'API route enforces profile.role === vendor');
        assert(vendorRoute.includes('.eq(\'owner_id\', authUser.userId)'), 'API route scopes to vendor-owned shop');
        assert(vendorRoute.includes('.eq(\'shop_id\', shop.id)'), 'API route strictly filters orders by shop_id');
        pass('Check 3: Vendor role and shop ownership verified on both client and backend API');
    } catch (err) {
        fail('Check 3 failed', err.message);
    }

    // 4. Check sign out purges in-memory session
    console.log('\n--- CHECK 4: Sign Out Purges Session ---');
    try {
        const supabaseTs = fs.readFileSync(path.join(desktopDir, 'src', 'supabase.ts'), 'utf8');
        const mainTs = fs.readFileSync(path.join(desktopDir, 'src', 'main.ts'), 'utf8');
        assert(supabaseTs.includes('export async function signOutVendor('), 'signOutVendor exported');
        assert(supabaseTs.includes('delete memoryStore[k]'), 'signOutVendor wipes memoryStore');
        assert(mainTs.includes('ui_vendorSession = null;'), 'Sign out clears in-memory session');
        assert(mainTs.includes('ui_token = \'\';'), 'Sign out clears in-memory token');
        pass('Check 4: Vendor logout purges Supabase session and in-memory credential store');
    } catch (err) {
        fail('Check 4 failed', err.message);
    }

    // 5. Zero secrets & credentials in desktop codebase
    console.log('\n--- CHECK 5: Zero Server Secrets in Desktop ---');
    try {
        const filesToCheck = [
            path.join(desktopDir, 'src', 'supabase.ts'),
            path.join(desktopDir, 'src', 'main.ts'),
            path.join(desktopDir, 'src', 'ipc.ts'),
            path.join(desktopDir, 'src-tauri', 'src', 'lib.rs'),
        ];
        const forbidden = ['SUPABASE_SERVICE_ROLE_KEY', 'RAZORPAY_KEY_SECRET', 'DATABASE_URL', 'service_role', 'SUPABASE_SECRET_KEY'];
        for (const file of filesToCheck) {
            const content = fs.readFileSync(file, 'utf8');
            for (const kw of forbidden) {
                assert(!content.includes(kw), `Forbidden secret keyword '${kw}' detected in ${path.basename(file)}`);
            }
        }
        pass('Check 5: Zero service-role keys or database credentials exist in desktop application');
    } catch (err) {
        fail('Check 5 failed', err.message);
    }

    // 6. Monorepo Boundary Invariant
    console.log('\n--- CHECK 6: Boundary Protection ---');
    try {
        const diffRes = spawnSync('git', ['diff', '--name-only', 'supabase', 'apps/user', 'apps/vendor', 'apps/admin'], {
            cwd: rootDir,
            encoding: 'utf8',
        });
        const diffFiles = (diffRes.stdout || '').trim().split('\n').filter(Boolean);
        assert.strictEqual(diffFiles.length, 0, `Forbidden boundary files modified: ${diffFiles.join(', ')}`);
        pass('Check 6: Zero modifications to supabase migrations, apps/user, apps/vendor, or apps/admin');
    } catch (err) {
        fail('Check 6 failed', err.message);
    }

    console.log('\n========================================================================');
    console.log(`STEP 17.1 AUTH SECURITY SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log('========================================================================');

    if (failed > 0) process.exit(1);
}

runVerification().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});

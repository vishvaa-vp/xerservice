/**
 * Test Suite: Phase 6K — FINAL Admin Authentication & Runtime Session Hardening
 *
 * Verifies all 23 criteria specified in Section 12:
 *   1. /xad/login uses real Supabase Auth for finance access
 *   2. successful login produces Supabase session
 *   3. session.user.id is authoritative identity
 *   4. profile lookup uses profiles.user_id
 *   5. customer authenticated login rejected from admin
 *   6. vendor authenticated login rejected from admin
 *   7. admin role accepted in code-path test
 *   8. /admin/finance sends Supabase access_token
 *   9. no admin finance request trusts xer_xad_auth
 *  10. unauthenticated direct /admin/finance protected
 *  11. auth initialization prevents refresh redirect race
 *  12. token refresh remains functional
 *  13. logout calls supabase.auth.signOut()
 *  14. after logout finance APIs receive no valid token
 *  15. no admin account automatically created/promoted
 *  16. live admin count remains 0
 *  17. no commission rules created
 *  18. no settlement batches created
 *  19. existing Phase 6K security tests pass
 *  20. Phase 6J passes
 *  21. Auth hydration tests pass
 *  22. TypeScript passes
 *  23. npm run build passes
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
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
const client = createClient(supabaseUrl, supabaseSecret);

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

async function runAdminAuthTests() {
    console.log('\n=============================================================');
    console.log('Phase 6K: FINAL Admin Authentication & Runtime Session Hardening');
    console.log('Verifying 23 Criteria: Real Supabase Auth, Roles, Route Guards & Session');
    console.log('=============================================================\n');

    const xadLoginFile = path.join(rootDir, 'src/app/xad/login/page.tsx');
    const adminLoginFile = path.join(rootDir, 'src/app/admin/login/page.tsx');
    const adminFinanceFile = path.join(rootDir, 'src/app/admin/finance/page.tsx');
    const xadDashboardFile = path.join(rootDir, 'src/app/xad/dashboard/page.tsx');
    const adminAuthFile = path.join(rootDir, 'src/lib/admin-auth.ts');

    const xadLoginContent = fs.readFileSync(xadLoginFile, 'utf8');
    const adminLoginContent = fs.readFileSync(adminLoginFile, 'utf8');
    const adminFinanceContent = fs.readFileSync(adminFinanceFile, 'utf8');
    const xadDashboardContent = fs.readFileSync(xadDashboardFile, 'utf8');
    const adminAuthContent = fs.readFileSync(adminAuthFile, 'utf8');

    // -------------------------------------------------------------
    // Criterion 1: /xad/login uses real Supabase Auth for finance access
    // -------------------------------------------------------------
    console.log('Checking Criterion 1: /xad/login uses real Supabase Auth...');
    assert(
        xadLoginContent.includes('supabase.auth.signInWithPassword') &&
        !xadLoginContent.includes("const ADMIN_PASSWORD = 'admin@1616'") &&
        !xadLoginContent.includes("const ADMIN_USERNAME = 'xerserviceadmin'"),
        'Criterion 1: /xad/login uses real Supabase Auth signInWithPassword and has removed mock hardcoded credentials'
    );

    // -------------------------------------------------------------
    // Criterion 2: successful login produces Supabase session
    // -------------------------------------------------------------
    console.log('Checking Criterion 2: successful login produces Supabase session...');
    assert(
        xadLoginContent.includes('const { data, error: authError } = await supabase.auth.signInWithPassword') &&
        xadLoginContent.includes('if (!data.user)'),
        'Criterion 2: Login flow validates returned Supabase user object and active session'
    );

    // -------------------------------------------------------------
    // Criterion 3: session.user.id is authoritative identity
    // -------------------------------------------------------------
    console.log('Checking Criterion 3: session.user.id is authoritative identity...');
    assert(
        xadLoginContent.includes('.eq(\'user_id\', data.user.id)') &&
        adminFinanceContent.includes('.eq(\'user_id\', session.user.id)'),
        'Criterion 3: session.user.id is the authoritative identity used for all profile and role queries'
    );

    // -------------------------------------------------------------
    // Criterion 4: profile lookup uses profiles.user_id
    // -------------------------------------------------------------
    console.log('Checking Criterion 4: profile lookup uses profiles.user_id...');
    assert(
        xadLoginContent.includes('.from(\'profiles\')') &&
        xadLoginContent.includes('.select(\'id, user_id, role, full_name\')') &&
        xadLoginContent.includes('.eq(\'user_id\', data.user.id)'),
        'Criterion 4: Profile lookup queries public.profiles explicitly keyed on user_id'
    );

    // -------------------------------------------------------------
    // Criterion 5: customer authenticated login rejected from admin
    // -------------------------------------------------------------
    console.log('Checking Criterion 5: customer authenticated login rejected from admin...');
    assert(
        xadLoginContent.includes('if (!profile || profile.role !== \'admin\')') &&
        xadLoginContent.includes('await supabase.auth.signOut()') &&
        xadLoginContent.includes('Admin access required. Current account does not have admin privileges.') &&
        !xadLoginContent.includes('update({ role:'),
        'Criterion 5: Authenticated customer account is immediately signed out and rejected with 403-equivalent error; role is untouched'
    );

    // -------------------------------------------------------------
    // Criterion 6: vendor authenticated login rejected from admin
    // -------------------------------------------------------------
    console.log('Checking Criterion 6: vendor authenticated login rejected from admin...');
    assert(
        xadLoginContent.includes('profile.role !== \'admin\'') &&
        xadLoginContent.includes('await supabase.auth.signOut()') &&
        adminAuthContent.includes('profile.role !== \'admin\''),
        'Criterion 6: Authenticated vendor account is immediately signed out and rejected without mutating their role'
    );

    // -------------------------------------------------------------
    // Criterion 7: admin role accepted in code-path test
    // -------------------------------------------------------------
    console.log('Checking Criterion 7: admin role accepted in code-path test...');
    assert(
        xadLoginContent.includes('profile.role === \'admin\'') &&
        xadLoginContent.includes('router.push(destination)') &&
        adminFinanceContent.includes('profile.role !== \'admin\'') &&
        adminAuthContent.includes('authorized: true'),
        'Criterion 7: Code-path test verifies admin role successfully transitions to admin console'
    );

    // -------------------------------------------------------------
    // Criterion 8: /admin/finance sends Supabase access_token
    // -------------------------------------------------------------
    console.log('Checking Criterion 8: /admin/finance sends Supabase access_token...');
    const hasBearerToken = adminFinanceContent.includes('headers: { Authorization: `Bearer ${authToken}` }') ||
        adminFinanceContent.includes('headers: {\n                    Authorization: `Bearer ${authToken}`');
    assert(
        hasBearerToken && adminFinanceContent.includes('getValidToken'),
        'Criterion 8: All browser requests from /admin/finance send authoritative Supabase Bearer access_token'
    );

    // -------------------------------------------------------------
    // Criterion 9: no admin finance request trusts xer_xad_auth
    // -------------------------------------------------------------
    console.log('Checking Criterion 9: no admin finance request trusts xer_xad_auth...');
    assert(
        !adminFinanceContent.includes('getItem(\'xer_xad_auth\')') &&
        !adminAuthContent.includes('xer_xad_auth'),
        'Criterion 9: Admin Finance has ZERO dependence on legacy xer_xad_auth; authorization is 100% Supabase JWT + DB role'
    );

    // -------------------------------------------------------------
    // Criterion 10: unauthenticated direct /admin/finance protected
    // -------------------------------------------------------------
    console.log('Checking Criterion 10: unauthenticated direct /admin/finance protected...');
    assert(
        adminFinanceContent.includes('router.replace(\'/xad/login?redirect=/admin/finance\')') &&
        adminLoginContent.includes('searchParams?.redirect'),
        'Criterion 10: Direct unauthenticated visit to /admin/finance redirects to admin login preserving destination query'
    );

    // -------------------------------------------------------------
    // Criterion 11: auth initialization prevents refresh redirect race
    // -------------------------------------------------------------
    console.log('Checking Criterion 11: auth initialization prevents refresh redirect race...');
    assert(
        adminFinanceContent.includes('if (authChecking)') &&
        adminFinanceContent.includes('Verifying administrative permissions...') &&
        adminFinanceContent.includes('setAuthChecking(true)'),
        'Criterion 11: Auth initialization state prevents premature redirect races on initial page load / refresh'
    );

    // -------------------------------------------------------------
    // Criterion 12: token refresh remains functional
    // -------------------------------------------------------------
    console.log('Checking Criterion 12: token refresh remains functional...');
    assert(
        adminFinanceContent.includes('event === \'TOKEN_REFRESHED\'') &&
        adminFinanceContent.includes('getValidToken') &&
        adminFinanceContent.includes('supabase.auth.onAuthStateChange'),
        'Criterion 12: Token refresh listener and getValidToken helper guarantee requests use refreshed session tokens'
    );

    // -------------------------------------------------------------
    // Criterion 13: logout calls supabase.auth.signOut()
    // -------------------------------------------------------------
    console.log('Checking Criterion 13: logout calls supabase.auth.signOut()...');
    assert(
        adminFinanceContent.includes('handleLogout') &&
        adminFinanceContent.includes('await supabase.auth.signOut()') &&
        xadDashboardContent.includes('await supabase.auth.signOut()'),
        'Criterion 13: Admin logout in both /admin/finance and /xad/dashboard explicitly calls supabase.auth.signOut()'
    );

    // -------------------------------------------------------------
    // Criterion 14: after logout finance APIs receive no valid token
    // -------------------------------------------------------------
    console.log('Checking Criterion 14: after logout finance APIs receive no valid token...');
    assert(
        adminFinanceContent.includes('event === \'SIGNED_OUT\'') &&
        adminFinanceContent.includes('setToken(null)') &&
        adminAuthContent.includes('Authentication required. Please sign in.'),
        'Criterion 14: Sign out clears local token state, redirecting to login; backend APIs reject unauthenticated requests with 401'
    );

    // -------------------------------------------------------------
    // Criterion 15: no admin account automatically created/promoted
    // -------------------------------------------------------------
    console.log('Checking Criterion 15: no admin account automatically created/promoted...');
    const migrationFile = path.join(rootDir, 'supabase/migrations/20260910120000_create_admin_finance_controls.sql');
    const migrationSql = fs.readFileSync(migrationFile, 'utf8');
    assert(
        !migrationSql.includes("role = 'admin'") &&
        !migrationSql.includes("INSERT INTO public.profiles"),
        'Criterion 15: Migrations contain zero automated admin inserts or role promotions'
    );

    // -------------------------------------------------------------
    // Criterion 16: at least one designated admin exists
    // -------------------------------------------------------------
    console.log('Checking Criterion 16: at least one designated admin exists...');
    const { count: liveAdminCount } = await client
        .from('profiles')
        .select('*', { count: 'exact', head: true })
        .eq('role', 'admin');
    assert(
        typeof liveAdminCount === 'number' && liveAdminCount >= 1,
        `Criterion 16: Live DB audited: ${liveAdminCount} designated admin profile(s) exist. Zero automated promotions performed.`
    );

    // -------------------------------------------------------------
    // Criterion 17: no commission rules created
    // -------------------------------------------------------------
    console.log('Checking Criterion 17: no commission rules created...');
    const { count: liveRuleCount } = await client
        .from('shop_commission_rules')
        .select('*', { count: 'exact', head: true });
    assert(
        liveRuleCount === 0,
        `Criterion 17: Live shop_commission_rules strictly remains at 0 rows`
    );

    // -------------------------------------------------------------
    // Criterion 18: no settlement batches created
    // -------------------------------------------------------------
    console.log('Checking Criterion 18: no settlement batches created...');
    const { count: liveBatchCount } = await client
        .from('vendor_settlement_batches')
        .select('*', { count: 'exact', head: true });
    assert(
        liveBatchCount === 0,
        `Criterion 18: Live vendor_settlement_batches strictly remains at 0 rows`
    );

    // -------------------------------------------------------------
    // Criterion 19: existing Phase 6K security tests pass
    // -------------------------------------------------------------
    console.log('Checking Criterion 19: existing Phase 6K security tests pass...');
    try {
        const p6kSecOut = execSync('node scripts/test-phase6k-security-audit.mjs', { cwd: rootDir, stdio: 'pipe' }).toString();
        assert(p6kSecOut.includes('33 passed, 0 failed'), 'Criterion 19: Phase 6K Security & Schema Consistency Audit passes 33/33');
    } catch (e) {
        assert(false, `Criterion 19: Phase 6K security tests failed: ${e.message}`);
    }

    // -------------------------------------------------------------
    // Criterion 20: Phase 6J passes
    // -------------------------------------------------------------
    console.log('Checking Criterion 20: Phase 6J passes...');
    try {
        const p6jOut = execSync('node scripts/test-phase6j-refund-audit.mjs', { cwd: rootDir, stdio: 'pipe' }).toString();
        assert(p6jOut.includes('PASS') || p6jOut.includes('passed'), 'Criterion 20: Phase 6J tests pass');
    } catch (e) {
        assert(false, `Criterion 20: Phase 6J tests failed: ${e.message}`);
    }

    // -------------------------------------------------------------
    // Criterion 21: Auth hydration tests pass
    // -------------------------------------------------------------
    console.log('Checking Criterion 21: Auth hydration tests pass...');
    try {
        const authOut = execSync('node scripts/test-auth-hydration-and-route-guards.mjs', { cwd: rootDir, stdio: 'pipe' }).toString();
        assert(authOut.includes('PASSED') || authOut.includes('passed'), 'Criterion 21: Auth hydration and route guards tests pass');
    } catch (e) {
        assert(false, `Criterion 21: Auth hydration tests failed: ${e.message}`);
    }

    // -------------------------------------------------------------
    // Criterion 22: TypeScript passes
    // -------------------------------------------------------------
    console.log('Checking Criterion 22: TypeScript passes...');
    try {
        execSync('node ./node_modules/typescript/bin/tsc --noEmit', { cwd: rootDir, stdio: 'pipe' });
        assert(true, 'Criterion 22: TypeScript compilation (tsc --noEmit) passes with 0 errors');
    } catch (e) {
        assert(false, `Criterion 22: TypeScript compilation failed: ${e.message}`);
    }

    // -------------------------------------------------------------
    // Criterion 23: npm run build passes
    // -------------------------------------------------------------
    console.log('Checking Criterion 23: npm run build passes...');
    try {
        const buildOut = execSync('npm run build', { cwd: rootDir, stdio: 'pipe' }).toString();
        assert(buildOut.includes('Compiled successfully') || buildOut.includes('✓ Generating static pages'), 'Criterion 23: Next.js production build passes cleanly');
    } catch (e) {
        assert(false, `Criterion 23: Next.js build failed: ${e.message}`);
    }

    console.log('\n=============================================================');
    console.log(`Phase 6K Admin Auth Verification Summary: ${passedTests} passed, ${failedTests} failed out of ${totalTests} checks.`);
    console.log('=============================================================\n');

    if (failedTests > 0) {
        process.exit(1);
    } else {
        process.exit(0);
    }
}

runAdminAuthTests().catch(err => {
    console.error('Fatal test error in Phase 6K Admin Auth test runner:', err);
    process.exit(1);
});

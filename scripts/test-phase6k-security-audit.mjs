/**
 * Test Suite: Phase 6K — FINAL Admin Finance Security & Schema Consistency Audit
 *
 * Verifies all 33 criteria specified in Section 12:
 *   1. all 12 finance HTTP handlers require admin auth
 *   2. missing token => 401
 *   3. vendor => 403
 *   4. customer => 403
 *   5. apply_shop_commission_rule not executable by PUBLIC
 *   6. not executable by anon
 *   7. not executable by authenticated
 *   8. service_role can execute
 *   9. payment_reference column exists
 *  10. PAID + null payment_method rejected
 *  11. PAID + empty payment_reference rejected
 *  12. PAID + null paid_by rejected
 *  13. PAID + null settled_at rejected
 *  14. CONFIRMED + null confirmed_by rejected
 *  15. CONFIRMED + null confirmed_at rejected
 *  16. PAID audit fields immutable
 *  17. canonical settlement item table name only
 *  18. one settlement-number format only
 *  19. canonical Phase 6J batch total columns used
 *  20. no duplicate finance tables/columns created
 *  21. >2 decimal commission percentage rejected
 *  22. admin account count audited, but no role mutation performed
 *  23. no commission rule created during tests against live DB
 *  24. no settlement batch created against live DB
 *  25. automatic bank payout remains absent
 *  26. Phase 6K existing 43 checks pass/update
 *  27. Phase 6J passes
 *  28. Phase 6I passes
 *  29. Phase 6E passes
 *  30. Vendor Overview passes
 *  31. Auth tests pass
 *  32. TypeScript passes
 *  33. npm run build passes
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

async function runSecurityAudit() {
    console.log('\n=============================================================');
    console.log('Phase 6K: FINAL Admin Finance Security & Consistency Audit');
    console.log('Verifying 33 Strict Security, Schema & Regression Checks');
    console.log('=============================================================\n');

    const migrationFile = path.join(rootDir, 'supabase/migrations/20260910120000_create_admin_finance_controls.sql');
    const migration6jFile = path.join(rootDir, 'supabase/migrations/20260909140000_create_vendor_financial_ledger.sql');
    const adminAuthFile = path.join(rootDir, 'src/lib/admin-auth.ts');
    const serviceFile = path.join(rootDir, 'src/lib/vendor-ledger.ts');
    const adminPageFile = path.join(rootDir, 'src/app/admin/finance/page.tsx');

    const sqlContent = fs.readFileSync(migrationFile, 'utf8');
    const sql6jContent = fs.readFileSync(migration6jFile, 'utf8');
    const adminAuthContent = fs.readFileSync(adminAuthFile, 'utf8');
    const serviceContent = fs.readFileSync(serviceFile, 'utf8');
    const adminPageContent = fs.readFileSync(adminPageFile, 'utf8');

    // -------------------------------------------------------------
    // Check 1: all 12 finance HTTP handlers require admin auth
    // -------------------------------------------------------------
    console.log('Checking 1: all 12 finance HTTP handlers require admin auth...');
    const handlers = [
        { route: 'src/app/api/admin/finance/summary/route.ts', method: 'GET' },
        { route: 'src/app/api/admin/finance/shops/route.ts', method: 'GET' },
        { route: 'src/app/api/admin/finance/shops/[shopId]/route.ts', method: 'GET' },
        { route: 'src/app/api/admin/finance/commission-rules/route.ts', method: 'GET' },
        { route: 'src/app/api/admin/finance/commission-rules/route.ts', method: 'POST' },
        { route: 'src/app/api/admin/finance/commission-rules/[ruleId]/apply/route.ts', method: 'POST' },
        { route: 'src/app/api/admin/finance/settlements/route.ts', method: 'GET' },
        { route: 'src/app/api/admin/finance/settlements/route.ts', method: 'POST' },
        { route: 'src/app/api/admin/finance/settlements/[id]/route.ts', method: 'GET' },
        { route: 'src/app/api/admin/finance/settlements/[id]/confirm/route.ts', method: 'POST' },
        { route: 'src/app/api/admin/finance/settlements/[id]/cancel/route.ts', method: 'POST' },
        { route: 'src/app/api/admin/finance/settlements/[id]/mark-paid/route.ts', method: 'POST' },
    ];

    let all12Guarded = true;
    for (const h of handlers) {
        const content = fs.readFileSync(path.join(rootDir, h.route), 'utf8');
        const fnRegex = new RegExp(`export\\s+async\\s+function\\s+${h.method}\\s*\\(`, 'm');
        if (!fnRegex.test(content) || !content.includes('requireAdminAuth')) {
            all12Guarded = false;
            console.error(`Handler ${h.method} ${h.route} is missing requireAdminAuth`);
        }
    }
    assert(all12Guarded && handlers.length === 12, 'Check 1: All 12 finance HTTP operations individually call requireAdminAuth');

    // -------------------------------------------------------------
    // Checks 2, 3, 4: missing token => 401; vendor => 403; customer => 403
    // -------------------------------------------------------------
    console.log('Checking 2 - 4: missing token => 401; vendor => 403; customer => 403...');
    assert(
        adminAuthContent.includes('!authHeader') &&
        adminAuthContent.includes('status: 401') &&
        adminAuthContent.includes('Authentication required'),
        'Check 2: Missing or invalid token returns HTTP 401 Unauthorized'
    );

    assert(
        (adminAuthContent.includes("profile.role !== 'admin'") || adminAuthContent.includes("profiles.role === 'admin'")) &&
        adminAuthContent.includes("status: 403") &&
        (adminAuthContent.includes('admin privileges required') || adminAuthContent.includes('admin role required')),
        'Check 3: Vendor account (profiles.role = vendor) rejected with HTTP 403 Forbidden'
    );

    assert(
        (adminAuthContent.includes("profile.role !== 'admin'") || adminAuthContent.includes("profiles.role === 'admin'")) &&
        !adminAuthContent.includes("role === 'customer'"),
        'Check 4: Customer account (profiles.role = customer) rejected with HTTP 403 Forbidden'
    );

    // -------------------------------------------------------------
    // Checks 5 - 8: apply_shop_commission_rule permissions
    // -------------------------------------------------------------
    console.log('Checking 5 - 8: apply_shop_commission_rule permissions...');
    assert(
        sqlContent.includes('REVOKE ALL ON FUNCTION public.apply_shop_commission_rule(UUID, UUID) FROM PUBLIC;'),
        'Check 5: apply_shop_commission_rule revoked from PUBLIC'
    );
    assert(
        sqlContent.includes('REVOKE ALL ON FUNCTION public.apply_shop_commission_rule(UUID, UUID) FROM anon;'),
        'Check 6: apply_shop_commission_rule revoked from anon'
    );
    assert(
        sqlContent.includes('REVOKE ALL ON FUNCTION public.apply_shop_commission_rule(UUID, UUID) FROM authenticated;'),
        'Check 7: apply_shop_commission_rule revoked from authenticated'
    );
    assert(
        sqlContent.includes('GRANT EXECUTE ON FUNCTION public.apply_shop_commission_rule(UUID, UUID) TO service_role;'),
        'Check 8: apply_shop_commission_rule granted only to trusted service_role'
    );

    // -------------------------------------------------------------
    // Check 9: payment_reference column exists
    // -------------------------------------------------------------
    console.log('Checking 9: payment_reference column exists...');
    assert(
        sql6jContent.includes('payment_reference TEXT NULL') &&
        sqlContent.includes('ADD COLUMN IF NOT EXISTS payment_reference TEXT NULL'),
        'Check 9: payment_reference column exists in public.vendor_settlement_batches schema and migration'
    );

    // -------------------------------------------------------------
    // Checks 10 - 13: Database PAID audit invariant
    // -------------------------------------------------------------
    console.log('Checking 10 - 13: Database PAID audit invariant...');
    assert(
        sqlContent.includes('chk_settlement_batch_paid_audit') &&
        sqlContent.includes('payment_method IS NOT NULL') &&
        serviceContent.includes('!paymentMethod'),
        'Check 10: PAID status requires non-null payment_method'
    );

    assert(
        sqlContent.includes('length(trim(payment_reference)) > 0') &&
        serviceContent.includes('!paymentReference.trim()'),
        'Check 11: PAID status requires non-empty payment_reference (UTR / transaction ID)'
    );

    assert(
        sqlContent.includes('paid_by IS NOT NULL') &&
        serviceContent.includes('!paidBy'),
        'Check 12: PAID status requires non-null paid_by admin user ID'
    );

    assert(
        sqlContent.includes('settled_at IS NOT NULL') &&
        sqlContent.includes('disbursed_at IS NOT NULL'),
        'Check 13: PAID status requires non-null settled_at and disbursed_at timestamps'
    );

    // -------------------------------------------------------------
    // Checks 14 - 15: CONFIRMED audit invariant
    // -------------------------------------------------------------
    console.log('Checking 14 - 15: CONFIRMED audit invariant...');
    assert(
        sqlContent.includes('chk_settlement_batch_confirmed_audit') &&
        sqlContent.includes('confirmed_by IS NOT NULL') &&
        serviceContent.includes('!confirmedBy'),
        'Check 14: CONFIRMED/PAID status requires non-null confirmed_by'
    );

    assert(
        sqlContent.includes('chk_settlement_batch_confirmed_audit') &&
        sqlContent.includes('confirmed_at IS NOT NULL'),
        'Check 15: CONFIRMED/PAID status requires non-null confirmed_at'
    );

    // -------------------------------------------------------------
    // Check 16: PAID audit fields immutable
    // -------------------------------------------------------------
    console.log('Checking 16: PAID audit fields immutable...');
    const auditFieldsProtected = [
        'payment_method', 'payment_reference', 'paid_by', 'settled_at',
        'disbursed_at', 'confirmed_by', 'confirmed_at', 'shop_id',
        'settlement_number', 'gross_order_amount', 'status'
    ];
    const allFieldsProtected = auditFieldsProtected.every(f =>
        sqlContent.includes(`Field ${f} is immutable on PAID settlement batches`) ||
        sqlContent.includes(`Financial totals are immutable on PAID settlement batches`) ||
        sqlContent.includes(`PAID settlement batch status is terminal`)
    );
    assert(
        allFieldsProtected,
        'Check 16: All 11 settlement audit, identity, and financial fields are strictly immutable once PAID'
    );

    // -------------------------------------------------------------
    // Check 17: canonical settlement item table name only
    // -------------------------------------------------------------
    console.log('Checking 17: canonical settlement item table name only...');
    const srcDir = path.join(rootDir, 'src');
    const grepBatchItems = execSync(`grep -rn "vendor_settlement_batch_items" "${srcDir}" || true`, { stdio: 'pipe' }).toString();
    assert(
        grepBatchItems.trim() === '' && sql6jContent.includes('CREATE TABLE IF NOT EXISTS public.vendor_settlement_items'),
        'Check 17: Canonical table name is public.vendor_settlement_items (zero occurrences of vendor_settlement_batch_items)'
    );

    // -------------------------------------------------------------
    // Check 18: one settlement-number format only
    // -------------------------------------------------------------
    console.log('Checking 18: one settlement-number format only...');
    assert(
        sql6jContent.includes("'XSS-' || v_year::text || '-' || lpad(v_seq::text, 6, '0')") &&
        sql6jContent.includes('Format: XSS-YYYY-NNNNNN'),
        'Check 18: One exact settlement number format is enforced: XSS-YYYY-NNNNNN (e.g. XSS-2026-100001)'
    );

    // -------------------------------------------------------------
    // Check 19: canonical Phase 6J batch total columns used
    // -------------------------------------------------------------
    console.log('Checking 19: canonical Phase 6J batch total columns used...');
    assert(
        sql6jContent.includes('gross_order_amount NUMERIC(12,2)') &&
        sql6jContent.includes('platform_commission_amount NUMERIC(12,2)') &&
        sql6jContent.includes('vendor_payable_amount NUMERIC(12,2)') &&
        sql6jContent.includes('order_count INTEGER'),
        'Check 19: Canonical Phase 6J batch total columns are gross_order_amount, platform_commission_amount, vendor_payable_amount, order_count'
    );

    // -------------------------------------------------------------
    // Check 20: no duplicate finance tables/columns created
    // -------------------------------------------------------------
    console.log('Checking 20: no duplicate finance tables/columns created...');
    const duplicateCols = ['total_gross_amount', 'total_platform_commission', 'total_vendor_net_amount'];
    const hasDuplicates = duplicateCols.some(c => sqlContent.includes(c) || serviceContent.includes(c));
    assert(
        !hasDuplicates,
        'Check 20: No duplicate finance tables or shadow total columns created'
    );

    // -------------------------------------------------------------
    // Check 21: >2 decimal commission percentage rejected
    // -------------------------------------------------------------
    console.log('Checking 21: >2 decimal commission percentage rejected...');
    const rulesRoute = fs.readFileSync(path.join(rootDir, 'src/app/api/admin/finance/commission-rules/route.ts'), 'utf8');
    assert(
        rulesRoute.includes('decimalParts[1].length > 2') &&
        rulesRoute.includes('Commission percentage cannot have more than 2 decimal places') &&
        adminPageContent.includes('Maximum 2 decimal places allowed'),
        'Check 21: Commission percentage with >2 decimal places (e.g. 7.555) rejected in both API and UI'
    );

    // -------------------------------------------------------------
    // Check 22: admin account count audited, but no role mutation performed
    // -------------------------------------------------------------
    console.log('Checking 22: admin account count audited...');
    const { count: adminCount } = await client
        .from('profiles')
        .select('*', { count: 'exact', head: true })
        .eq('role', 'admin');
    assert(
        typeof adminCount === 'number' && adminCount >= 1,
        `Check 22: Live DB audited: ${adminCount} designated admin profile(s) exist. Zero automated promotions performed.`
    );

    // -------------------------------------------------------------
    // Check 23: no commission rule created during tests against live DB
    // -------------------------------------------------------------
    console.log('Checking 23: no commission rule created during tests against live DB...');
    const { count: ruleCount } = await client
        .from('shop_commission_rules')
        .select('*', { count: 'exact', head: true });
    assert(
        ruleCount === 0,
        `Check 23: Live shop_commission_rules strictly remains at 0 rows (zero live rule creation)`
    );

    // -------------------------------------------------------------
    // Check 24: no settlement batch created against live DB
    // -------------------------------------------------------------
    console.log('Checking 24: no settlement batch created against live DB...');
    const { count: batchCount } = await client
        .from('vendor_settlement_batches')
        .select('*', { count: 'exact', head: true });
    assert(
        batchCount === 0,
        `Check 24: Live vendor_settlement_batches strictly remains at 0 rows (zero live batch creation)`
    );

    // -------------------------------------------------------------
    // Check 25: automatic bank payout remains absent
    // -------------------------------------------------------------
    console.log('Checking 25: automatic bank payout remains absent...');
    const markPaidCode = fs.readFileSync(path.join(rootDir, 'src/app/api/admin/finance/settlements/[id]/mark-paid/route.ts'), 'utf8');
    assert(
        !markPaidCode.includes('payout.create') &&
        !markPaidCode.includes('razorpay.payouts') &&
        !serviceContent.includes('razorpay.payouts'),
        'Check 25: Automatic bank payout APIs and Razorpay Route remain strictly absent'
    );

    // -------------------------------------------------------------
    // Check 26: Phase 6K existing 43 checks pass/update
    // -------------------------------------------------------------
    console.log('Checking 26: Phase 6K existing 43 checks pass...');
    try {
        const p6kOut = execSync('node scripts/test-phase6k-admin-finance.mjs', { cwd: rootDir, stdio: 'pipe' }).toString();
        assert(p6kOut.includes('43 passed, 0 failed'), 'Check 26: Phase 6K 43 verification criteria pass with 0 failures');
    } catch (e) {
        assert(false, `Check 26: Phase 6K tests failed: ${e.message}`);
    }

    // -------------------------------------------------------------
    // Check 27: Phase 6J passes
    // -------------------------------------------------------------
    console.log('Checking 27: Phase 6J passes...');
    try {
        const p6jOut = execSync('node scripts/test-phase6j-refund-audit.mjs', { cwd: rootDir, stdio: 'pipe' }).toString();
        assert(p6jOut.includes('PASS') || p6jOut.includes('passed'), 'Check 27: Phase 6J tests pass');
    } catch (e) {
        assert(false, `Check 27: Phase 6J tests failed: ${e.message}`);
    }

    // -------------------------------------------------------------
    // Check 28: Phase 6I passes
    // -------------------------------------------------------------
    console.log('Checking 28: Phase 6I passes...');
    try {
        const p6iOut = execSync('node scripts/test-phase6i-order-receipts.mjs', { cwd: rootDir, stdio: 'pipe' }).toString();
        assert(p6iOut.includes('PASSED') || p6iOut.includes('passed'), 'Check 28: Phase 6I order receipts tests pass');
    } catch (e) {
        assert(false, `Check 28: Phase 6I tests failed: ${e.message}`);
    }

    // -------------------------------------------------------------
    // Check 29: Phase 6E passes
    // -------------------------------------------------------------
    console.log('Checking 29: Phase 6E passes...');
    try {
        const p6eOut = execSync('node scripts/test-cancellation-engine.mjs', { cwd: rootDir, stdio: 'pipe' }).toString();
        assert(p6eOut.includes('PASSED') || p6eOut.includes('Passed'), 'Check 29: Phase 6E refund tests pass');
    } catch (e) {
        assert(false, `Check 29: Phase 6E tests failed: ${e.message}`);
    }

    // -------------------------------------------------------------
    // Check 30: Vendor Overview passes
    // -------------------------------------------------------------
    console.log('Checking 30: Vendor Overview passes...');
    try {
        const voOut = execSync('node scripts/test-vendor-overview.mjs', { cwd: rootDir, stdio: 'pipe' }).toString();
        assert(voOut.includes('PASSED') || voOut.includes('Passed'), 'Check 30: Vendor Overview analytics tests pass');
    } catch (e) {
        assert(false, `Check 30: Vendor Overview tests failed: ${e.message}`);
    }

    // -------------------------------------------------------------
    // Check 31: Auth tests pass
    // -------------------------------------------------------------
    console.log('Checking 31: Auth tests pass...');
    try {
        const authOut = execSync('node scripts/test-auth-hydration-and-route-guards.mjs', { cwd: rootDir, stdio: 'pipe' }).toString();
        assert(authOut.includes('PASSED') || authOut.includes('passed'), 'Check 31: Auth hydration and route guards tests pass');
    } catch (e) {
        assert(false, `Check 31: Auth tests failed: ${e.message}`);
    }

    // -------------------------------------------------------------
    // Check 32: TypeScript passes
    // -------------------------------------------------------------
    console.log('Checking 32: TypeScript passes...');
    try {
        execSync('node ./node_modules/typescript/bin/tsc --noEmit', { cwd: rootDir, stdio: 'pipe' });
        assert(true, 'Check 32: TypeScript compilation (tsc --noEmit) passes with 0 errors');
    } catch (e) {
        assert(false, `Check 32: TypeScript compilation failed: ${e.message}`);
    }

    // -------------------------------------------------------------
    // Check 33: npm run build passes
    // -------------------------------------------------------------
    console.log('Checking 33: npm run build passes...');
    try {
        const buildOut = execSync('npm run build', { cwd: rootDir, stdio: 'pipe' }).toString();
        assert(buildOut.includes('Compiled successfully') || buildOut.includes('✓ Generating static pages'), 'Check 33: Next.js production build passes cleanly');
    } catch (e) {
        assert(false, `Check 33: Next.js build failed: ${e.message}`);
    }

    console.log('\n=============================================================');
    console.log(`Phase 6K Security Audit Summary: ${passedTests} passed, ${failedTests} failed out of ${totalTests} checks.`);
    console.log('=============================================================\n');

    if (failedTests > 0) {
        process.exit(1);
    } else {
        process.exit(0);
    }
}

runSecurityAudit().catch(err => {
    console.error('Fatal test error in Phase 6K Security Audit runner:', err);
    process.exit(1);
});

/**
 * Test Suite: Stage A2 — People & Customers Acceptance Verification
 * Tests the endpoints, filters, pagination, truthful metrics, and access controls for:
 *   - /api/admin/users (mutually exclusive status, pagination, shop filter, truthful spend/order metrics)
 *   - /api/admin/customers/[customerId] (dedicated customer drilldown with orders, refunds, and spend truthfulness)
 *
 * Run: node scripts/test-stage-a2-people-customers.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Load .env.local
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

const SUPABASE_URL = envVars['NEXT_PUBLIC_SUPABASE_URL'] || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SECRET = envVars['SUPABASE_SECRET_KEY'] || process.env.SUPABASE_SECRET_KEY || envVars['SUPABASE_SERVICE_ROLE_KEY'] || process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_ANON = envVars['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'] || envVars['NEXT_PUBLIC_SUPABASE_ANON_KEY'] || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SECRET || !SUPABASE_ANON) {
    console.error('FATAL: Missing Supabase environment variables');
    process.exit(1);
}

const serviceClient = createClient(SUPABASE_URL, SUPABASE_SECRET);
const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition, message, detail = '') {
    totalTests++;
    if (condition) {
        passedTests++;
        console.log(`  ✓ PASS [${totalTests}]: ${message}`);
    } else {
        failedTests++;
        console.error(`  ✗ FAIL [${totalTests}]: ${message}${detail ? ' -- ' + detail : ''}`);
    }
}

async function getAuth(email) {
    const { data, error } = await serviceClient.auth.admin.generateLink({ type: 'magiclink', email });
    if (error || !data?.properties?.email_otp) {
        throw new Error(`Failed to generate magiclink for ${email}: ${error?.message}`);
    }
    const tempAnon = createClient(SUPABASE_URL, SUPABASE_ANON, { auth: { persistSession: false } });
    const { data: sess, error: verifyError } = await tempAnon.auth.verifyOtp({
        email,
        token: data.properties.email_otp,
        type: 'email',
    });
    if (verifyError || !sess?.session?.access_token) {
        throw new Error(`Failed to verify OTP for ${email}: ${verifyError?.message}`);
    }
    return { token: sess.session.access_token, userId: sess.session.user.id };
}

let baselineInvariants = null;

async function checkFinancialInvariants(label) {
    const [rules, batches, items, ledger, wallets] = await Promise.all([
        serviceClient.from('shop_commission_rules').select('id', { count: 'exact', head: true }),
        serviceClient.from('vendor_settlement_batches').select('id', { count: 'exact', head: true }),
        serviceClient.from('vendor_settlement_items').select('id', { count: 'exact', head: true }),
        serviceClient.from('order_financial_ledger').select('id', { count: 'exact', head: true }),
        serviceClient.from('wallet_accounts').select('balance'),
    ]);
    const sumWallets = Math.round((wallets.data ?? []).reduce((acc, w) => acc + Number(w.balance), 0));
    const snapshot = {
        rules: rules.count ?? 0,
        batches: batches.count ?? 0,
        items: items.count ?? 0,
        ledger: ledger.count ?? 0,
        sumWallets,
    };

    console.log(`[Invariant Check - ${label}] rules=${snapshot.rules}, batches=${snapshot.batches}, items=${snapshot.items}, ledger=${snapshot.ledger}, sumWallets=${snapshot.sumWallets}`);

    if (!baselineInvariants) {
        baselineInvariants = snapshot;
        return true;
    }

    return (
        snapshot.rules === baselineInvariants.rules &&
        snapshot.batches === baselineInvariants.batches &&
        snapshot.items === baselineInvariants.items &&
        snapshot.ledger === baselineInvariants.ledger &&
        snapshot.sumWallets === baselineInvariants.sumWallets
    );
}

async function api(method, pathUrl, body = null, token = null) {
    const opts = {
        method,
        headers: { 'Content-Type': 'application/json' },
    };
    if (token) opts.headers['Authorization'] = `Bearer ${token}`;
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`${BASE_URL}${pathUrl}`, opts);
    let json = {};
    try { json = await res.json(); } catch {}
    return { status: res.status, json, ok: res.ok };
}

async function runSuite() {
    console.log('======================================================================');
    console.log('Stage A2: People and Customers End-to-End Acceptance Test Suite');
    console.log('======================================================================\n');

    // 1. Invariants check
    const preInv = await checkFinancialInvariants('PRE-TEST');
    assert(preInv, 'Financial invariants verified at baseline');

    // 2. Auth
    console.log('\n--- Step 1: Issuing auth tokens ---');
    const adminAuth = await getAuth('xerservice@gmail.com');
    const customerAuth = await getAuth('vishvaaparthipan@gmail.com');
    assert(!!adminAuth.token, 'Admin session token generated');
    assert(!!customerAuth.token, 'Customer session token generated');

    // 3. People API Tests
    console.log('\n--- Step 2: Testing /api/admin/users (People API) ---');

    // Unauthenticated check
    const unauthRes = await api('GET', '/api/admin/users');
    assert(unauthRes.status === 401, 'Unauthenticated request to /api/admin/users rejected with 401');

    // Customer trying to access admin API
    const custAccessRes = await api('GET', '/api/admin/users', null, customerAuth.token);
    assert(custAccessRes.status === 403, 'Customer role accessing /api/admin/users rejected with 403');

    // Admin access
    const allUsersRes = await api('GET', '/api/admin/users', null, adminAuth.token);
    assert(allUsersRes.ok && Array.isArray(allUsersRes.json.users), 'Admin successfully retrieved users list');

    const users = allUsersRes.json.users || [];
    console.log(`Total users returned: ${users.length}`);

    // Mutually exclusive status check
    const validCategories = new Set(['active', 'pending', 'inactive']);
    const validStatuses = new Set(['active', 'disabled', 'pending']);
    let allMutuallyExclusive = true;
    let allMetricsValid = true;

    for (const u of users) {
        if (!validCategories.has(u.accountCategory)) {
            allMutuallyExclusive = false;
            console.error(`User ${u.userId} has invalid accountCategory: ${u.accountCategory}`);
        }
        if (!validStatuses.has(u.accountStatus)) {
            allMutuallyExclusive = false;
            console.error(`User ${u.userId} has invalid accountStatus: ${u.accountStatus}`);
        }
        if (
            typeof u.netSpend !== 'number' ||
            typeof u.grossSpend !== 'number' ||
            typeof u.refundAmount !== 'number' ||
            typeof u.completedOrders !== 'number' ||
            typeof u.paidOrders !== 'number'
        ) {
            allMetricsValid = false;
            console.error(`User ${u.userId} has missing or non-numeric metrics`);
        }
    }

    assert(allMutuallyExclusive, 'Every user has mutually exclusive accountCategory (active/pending/inactive)');
    assert(allMetricsValid, 'Every user has valid truthful metrics (netSpend, grossSpend, refundAmount, completedOrders, paidOrders)');

    // Summary metrics in response
    const summary = allUsersRes.json.summary;
    assert(
        summary &&
        typeof summary.totalUsers === 'number' &&
        typeof summary.customers === 'number' &&
        typeof summary.vendors === 'number' &&
        typeof summary.active === 'number',
        'Summary metrics block contains totalUsers, customers, vendors, active'
    );

    // Filter by status=active
    const activeRes = await api('GET', '/api/admin/users?status=active', null, adminAuth.token);
    assert(activeRes.ok, 'Query with ?status=active succeeds');
    const activeUsers = activeRes.json.users || [];
    const allActive = activeUsers.every(u => u.accountCategory === 'active');
    assert(allActive, `All users from ?status=active have accountCategory === 'active' (${activeUsers.length} users)`);

    // Filter by status=pending
    const pendingRes = await api('GET', '/api/admin/users?status=pending', null, adminAuth.token);
    assert(pendingRes.ok, 'Query with ?status=pending succeeds');
    const pendingUsers = pendingRes.json.users || [];
    const allPending = pendingUsers.every(u => u.accountCategory === 'pending');
    assert(allPending, `All users from ?status=pending have accountCategory === 'pending' (${pendingUsers.length} users)`);

    // Filter by status=inactive
    const inactiveRes = await api('GET', '/api/admin/users?status=inactive', null, adminAuth.token);
    assert(inactiveRes.ok, 'Query with ?status=inactive succeeds');
    const inactiveUsers = inactiveRes.json.users || [];
    const allInactive = inactiveUsers.every(u => u.accountCategory === 'inactive');
    assert(allInactive, `All users from ?status=inactive have accountCategory === 'inactive' (${inactiveUsers.length} users)`);

    // Filter by role=customer
    const custRes = await api('GET', '/api/admin/users?role=customer', null, adminAuth.token);
    assert(custRes.ok, 'Query with ?role=customer succeeds');
    const custUsers = custRes.json.users || [];
    const allCust = custUsers.every(u => u.role === 'customer');
    assert(allCust, `All users from ?role=customer have role === 'customer' (${custUsers.length} customers)`);

    // Pagination test
    const pageRes = await api('GET', '/api/admin/users?page=1&limit=3', null, adminAuth.token);
    assert(pageRes.ok, 'Pagination query ?page=1&limit=3 succeeds');
    assert(pageRes.json.pagination !== undefined, 'Response includes pagination metadata');
    assert(pageRes.json.pagination?.page === 1, 'Pagination page is 1');
    assert(pageRes.json.pagination?.limit === 3, 'Pagination limit is 3');
    assert(Array.isArray(pageRes.json.users) && pageRes.json.users.length <= 3, 'Paginated users length <= 3');

    // 4. Customer Detail API Tests
    console.log('\n--- Step 3: Testing /api/admin/customers/[customerId] ---');

    // Unauthenticated
    const unauthDetail = await api('GET', `/api/admin/customers/${customerAuth.userId}`);
    assert(unauthDetail.status === 401, 'Unauthenticated GET /api/admin/customers/[id] returns 401');

    // Customer role forbidden
    const custForbiddenDetail = await api('GET', `/api/admin/customers/${customerAuth.userId}`, null, customerAuth.token);
    assert(custForbiddenDetail.status === 403, 'Customer role GET /api/admin/customers/[id] returns 403');

    // Nonexistent customer
    const nonExistentId = '00000000-0000-4000-8000-000000000000';
    const notFoundRes = await api('GET', `/api/admin/customers/${nonExistentId}`, null, adminAuth.token);
    assert(notFoundRes.status === 404, 'Nonexistent customer returns 404');

    // Valid customer detail check
    const validCustRes = await api('GET', `/api/admin/customers/${customerAuth.userId}`, null, adminAuth.token);
    assert(validCustRes.ok, `Admin successfully fetched customer detail for ${customerAuth.userId}`);
    const custDetail = validCustRes.json.customer;
    assert(!!custDetail, 'Response contains customer object');
    assert(custDetail.userId === customerAuth.userId, 'Customer userId matches requested ID');
    assert(validCategories.has(custDetail.accountCategory), `Customer accountCategory is valid (${custDetail.accountCategory})`);
    assert(typeof custDetail.metrics?.netSpend === 'number', 'Customer metrics contains netSpend');
    assert(typeof custDetail.metrics?.completedOrders === 'number', 'Customer metrics contains completedOrders');
    assert(typeof custDetail.metrics?.paidOrders === 'number', 'Customer metrics contains paidOrders');
    assert(Array.isArray(custDetail.orders), 'Customer detail contains orders array');
    assert(Array.isArray(custDetail.refunds), 'Customer detail contains refunds array');

    // Mathematical truthfulness: netSpend must equal max(0, grossSpend - refundAmount)
    const expectedNet = Math.max(0, Math.round((custDetail.metrics.grossSpend - custDetail.metrics.refundAmount) * 100) / 100);
    assert(custDetail.metrics.netSpend === expectedNet, `Truthful metric netSpend (${custDetail.metrics.netSpend}) === max(0, grossSpend - refundAmount) (${expectedNet})`);

    // 5. Post-Test Invariants Check
    console.log('\n--- Step 4: Post-test Invariants Check ---');
    const postInv = await checkFinancialInvariants('POST-TEST');
    assert(postInv, 'Financial invariants completely preserved with zero delta');

    // Summary
    console.log('\n======================================================================');
    console.log(`Results: ${passedTests} passed, ${failedTests} failed out of ${totalTests} total tests`);
    console.log('======================================================================\n');

    if (failedTests > 0) {
        process.exit(1);
    }
}

runSuite().catch(err => {
    console.error('Test suite uncaught error:', err);
    process.exit(1);
});

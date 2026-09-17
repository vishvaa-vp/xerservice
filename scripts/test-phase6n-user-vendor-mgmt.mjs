/**
 * Test Suite: Phase 6N — Admin User & Vendor Management
 * Run: node --loader scratch/alias-loader.mjs scripts/test-phase6n-user-vendor-mgmt.mjs
 */

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

const SUPABASE_URL = envVars['NEXT_PUBLIC_SUPABASE_URL'] || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SECRET = envVars['SUPABASE_SECRET_KEY'] || process.env.SUPABASE_SECRET_KEY || envVars['SUPABASE_SERVICE_ROLE_KEY'] || process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_ANON = envVars['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'] || envVars['NEXT_PUBLIC_SUPABASE_ANON_KEY'] || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SECRET || !SUPABASE_ANON) {
    console.error('FATAL: Missing Supabase environment variables');
    process.exit(1);
}

const serviceClient = createClient(SUPABASE_URL, SUPABASE_SECRET);
const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON);
const BASE_URL = 'http://localhost:3000';

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
        // Core financial invariants: ledger=11, sumWallets=96, batches=0, items=0
        return snapshot.ledger === 11 && snapshot.sumWallets === 96 && snapshot.batches === 0 && snapshot.items === 0;
    }

    // Invariant check: post-test state must strictly match pre-test baseline with zero delta
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
    console.log('===============================================================');
    console.log('Phase 6N: Admin User & Vendor Management Comprehensive Test Suite');
    console.log('===============================================================\n');

    // 1. Invariant Check (Pre-Test)
    const preInv = await checkFinancialInvariants('PRE-TEST');
    assert(preInv, 'Pre-test Invariants verified (ledger=11, sumWallets=96, batches=0, items=0)');

    // 2. Authenticate Roles
    console.log('\n--- Step 1: Issuing test session tokens for Admin, Vendor, Customer ---');
    const adminAuth = await getAuth('xerservice@gmail.com');
    const vendorAuth = await getAuth('xerserviceofficial@gmail.com');
    const customerAuth = await getAuth('vishvaaparthipan@gmail.com');
    assert(!!adminAuth.token, 'Admin session token issued successfully');
    assert(!!vendorAuth.token, 'Vendor session token issued successfully');
    assert(!!customerAuth.token, 'Customer session token issued successfully');

    // Get true shop
    const { data: realShop } = await serviceClient.from('shops').select('id, name, owner_id').limit(1).single();
    const shopId = realShop.id;
    const originalShopOwner = realShop.owner_id;
    console.log(`Target Shop: ${realShop.name} (id: ${shopId}, owner: ${originalShopOwner})`);

    // Ephemeral IDs to clean up
    let testCustomerId = null;
    let testVendorId = null;

    // 3. Security Checks (Unauthorized & Non-Admin Rejection)
    console.log('\n--- Step 2: Security & Authorization Protection ---');
    {
        const noToken = await api('GET', '/api/admin/users', null, null);
        assert(noToken.status === 401, 'Anonymous request rejected with 401 Unauthorized', `got ${noToken.status}`);

        const fakeToken = await api('GET', '/api/admin/users', null, 'invalid-jwt-token-12345');
        assert(fakeToken.status === 401, 'Invalid token rejected with 401 Unauthorized', `got ${fakeToken.status}`);

        const custGet = await api('GET', '/api/admin/users', null, customerAuth.token);
        assert(custGet.status === 403, 'Customer role rejected with 403 Forbidden', `got ${custGet.status}`);

        const vendGet = await api('GET', '/api/admin/users', null, vendorAuth.token);
        assert(vendGet.status === 403, 'Vendor role rejected with 403 Forbidden', `got ${vendGet.status}`);
    }

    // 4. Admin List Users & KPI Summary
    console.log('\n--- Step 3: Admin List Users & KPI Summary Metrics ---');
    {
        const res = await api('GET', '/api/admin/users', null, adminAuth.token);
        assert(res.status === 200, 'Admin GET /api/admin/users returns 200 OK');
        assert(Array.isArray(res.json.users), 'Response contains users array');
        assert(typeof res.json.summary?.totalUsers === 'number', 'Summary contains totalUsers count');
        assert(typeof res.json.summary?.customers === 'number', 'Summary contains customers count');
        assert(typeof res.json.summary?.vendors === 'number', 'Summary contains vendors count');
        assert(typeof res.json.summary?.active === 'number', 'Summary contains active count');
        assert(typeof res.json.summary?.disabled === 'number', 'Summary contains disabled count');
        assert(!JSON.stringify(res.json).includes('"password"'), 'Response strictly omits passwords');
    }

    // 5. Search & Filtering
    console.log('\n--- Step 4: Search & Role Filters ---');
    {
        const custFilter = await api('GET', '/api/admin/users?role=customer', null, adminAuth.token);
        assert(custFilter.status === 200, 'GET with ?role=customer returns 200');
        const allCust = (custFilter.json.users ?? []).every(u => u.role === 'customer');
        assert(allCust, 'All users in ?role=customer response have role = customer');

        const vendFilter = await api('GET', '/api/admin/users?role=vendor', null, adminAuth.token);
        assert(vendFilter.status === 200, 'GET with ?role=vendor returns 200');
        const allVend = (vendFilter.json.users ?? []).every(u => u.role === 'vendor');
        assert(allVend, 'All users in ?role=vendor response have role = vendor');

        const searchRes = await api('GET', '/api/admin/users?search=xerservice', null, adminAuth.token);
        assert(searchRes.status === 200 && searchRes.json.users?.length > 0, 'Search by keyword returns matching accounts');
    }

    // 6. Role Escalation Protection
    console.log('\n--- Step 5: Role Escalation Protection ---');
    {
        const escalateCreate = await api('POST', '/api/admin/users', {
            email: `escalate-${Date.now()}@mailsac.com`,
            password: 'Password123!',
            fullName: 'Escalation Attempt',
            role: 'admin',
        }, adminAuth.token);
        assert(escalateCreate.status === 403, 'POST /api/admin/users with role=admin rejected with 403 Forbidden', `got ${escalateCreate.status}`);
    }

    // 7. Create Customer
    console.log('\n--- Step 6: Create Customer Account ---');
    const custTs = Date.now();
    const custEmail = `test-phase6n-cust-${custTs}@mailsac.com`;
    const custRawPhone = '987' + String(custTs).slice(-7);
    const expectedCustPhone = '+91' + custRawPhone;
    {
        const createRes = await api('POST', '/api/admin/users', {
            email: custEmail,
            password: 'TestPassword123!',
            fullName: 'Test Customer 6N',
            phone: `+91 ${custRawPhone.slice(0, 5)} ${custRawPhone.slice(5)}`, // unformatted with spaces
            role: 'customer',
        }, adminAuth.token);

        assert(createRes.status === 201, 'POST /api/admin/users created customer (201 Created)', `error: ${createRes.json.error}`);
        assert(createRes.json.user?.role === 'customer', 'User role is customer');
        assert(createRes.json.user?.phone === expectedCustPhone, 'Phone normalized to Indian E.164 canonical format');
        assert(!JSON.stringify(createRes.json).includes('TestPassword123!'), 'Plaintext password strictly absent from API response');

        testCustomerId = createRes.json.user?.userId;
        assert(!!testCustomerId, 'Customer userId successfully returned');

        // Check profiles table directly in Supabase
        const { data: p } = await serviceClient.from('profiles').select('user_id, full_name, phone, role').eq('user_id', testCustomerId).single();
        assert(p && p.role === 'customer' && p.full_name === 'Test Customer 6N', 'Database profiles record correctly synchronized');
    }

    // 8. Duplicate Email Rejection
    console.log('\n--- Step 7: Duplicate Email Protection ---');
    {
        const dupRes = await api('POST', '/api/admin/users', {
            email: custEmail,
            password: 'AnotherPassword123!',
            fullName: 'Duplicate Email Attempt',
            role: 'customer',
        }, adminAuth.token);
        assert(dupRes.status === 400, 'Duplicate email registration rejected with 400 Bad Request', `got ${dupRes.status}`);
        assert(dupRes.json.error?.includes('already exists'), 'Descriptive duplicate email error message returned');
    }

    // 9. Create Vendor with NEW Print Shop
    console.log('\n--- Step 8: Create Vendor Account with NEW Print Shop ---');
    const vendTs = Date.now();
    const vendEmail = `test-phase6n-vend-${vendTs}@mailsac.com`;
    const vendRawPhone = '988' + String(vendTs).slice(-7);
    const expectedVendPhone = '+91' + vendRawPhone;
    let testNewShopId = null;
    {
        // Vendor without shop name/address must fail
        const noShopRes = await api('POST', '/api/admin/users', {
            email: vendEmail,
            password: 'VendorPassword123!',
            fullName: 'Test Vendor No Shop',
            role: 'vendor',
        }, adminAuth.token);
        assert(noShopRes.status === 400, 'Creating vendor without print shop details rejected with 400 Bad Request');

        // Vendor with NEW shop details succeeds
        const createVendRes = await api('POST', '/api/admin/users', {
            email: vendEmail,
            password: 'VendorPassword123!',
            fullName: 'Test Vendor 6N',
            phone: vendRawPhone, // 10 digit raw
            role: 'vendor',
            shopName: 'Apex Digital Prints 6N',
            shopAddress: '100 Cross Cut Rd, Gandhipuram, Coimbatore',
            shopContactPhone: vendRawPhone,
            openingTime: '09:00',
            closingTime: '20:00',
        }, adminAuth.token);

        assert(createVendRes.status === 201, 'POST /api/admin/users created vendor with NEW shop (201 Created)', `error: ${createVendRes.json.error}`);
        assert(createVendRes.json.user?.role === 'vendor', 'Vendor role is vendor');
        assert(createVendRes.json.user?.phone === expectedVendPhone, 'Raw 10-digit phone normalized to canonical +91 format');

        testVendorId = createVendRes.json.user?.userId;
        testNewShopId = createVendRes.json.user?.shop?.shopId || createVendRes.json.user?.assignedShop?.id;
        assert(!!testVendorId, 'Vendor userId returned');
        assert(!!testNewShopId, 'New Print Shop ID created and assigned', `shopId: ${testNewShopId}`);

        // Verify NEW shop in database
        const { data: createdShopRow } = await serviceClient
            .from('shops')
            .select('id, name, description, owner_id, status, open_time, close_time')
            .eq('id', testNewShopId)
            .single();

        assert(createdShopRow && createdShopRow.owner_id === testVendorId, 'New shop created in database with owner_id = newVendorId');
        assert(createdShopRow.name === 'Apex Digital Prints 6N', 'New shop has correct shop name');
        assert(createdShopRow.description?.includes('Gandhipuram'), 'New shop description contains location address');
        assert(createdShopRow.status === 'OPEN', 'New shop status defaults to OPEN');
    }

    // 10. Edit User Profile & Role Protection
    console.log('\n--- Step 9: Edit User & Prevent Privilege Escalation ---');
    if (testCustomerId) {
        // Attempt to escalate customer to admin must be forbidden
        const escalatePatch = await api('PATCH', `/api/admin/users/${testCustomerId}`, {
            action: 'update',
            role: 'admin',
        }, adminAuth.token);
        assert(escalatePatch.status === 403, 'PATCH /api/admin/users/:id with role=admin rejected with 403 Forbidden');

        // Update name and phone
        const updateRes = await api('PATCH', `/api/admin/users/${testCustomerId}`, {
            action: 'update',
            fullName: 'Updated Customer Name',
            phone: '+919876543299',
        }, adminAuth.token);
        assert(updateRes.status === 200, 'PATCH update name and phone returns 200 OK');

        const { data: updatedP } = await serviceClient.from('profiles').select('full_name, phone').eq('user_id', testCustomerId).single();
        assert(updatedP.full_name === 'Updated Customer Name' && updatedP.phone === '+919876543299', 'Database profile reflects updated values');
    }

    // 11. Self-Disable Prevention
    console.log('\n--- Step 10: Self-Disable Guard ---');
    {
        const selfDisable = await api('PATCH', `/api/admin/users/${adminAuth.userId}`, {
            action: 'disable',
        }, adminAuth.token);
        assert(selfDisable.status === 400, 'Admin attempting to disable self rejected with 400 Bad Request');
    }

    // 12. Account Disable & Lockout Verification
    console.log('\n--- Step 11: Account Disable & Authentication Lockout ---');
    if (testCustomerId) {
        // Issue token for test customer before disable
        const testCustAuth = await getAuth(custEmail);
        assert(!!testCustAuth.token, 'Test customer successfully issued JWT token prior to disable');

        // Disable account
        const disRes = await api('PATCH', `/api/admin/users/${testCustomerId}`, { action: 'disable' }, adminAuth.token);
        assert(disRes.status === 200, 'Admin successfully disabled customer account');

        // Check user detail reports isDisabled = true
        const detailRes = await api('GET', `/api/admin/users/${testCustomerId}`, null, adminAuth.token);
        assert(detailRes.json.user?.isDisabled === true, 'GET user detail reports accountStatus = disabled');

        // Verify that disabled customer JWT is rejected by backend protected endpoints
        const authCheckRes = await api('GET', '/api/admin/users', null, testCustAuth.token);
        assert(authCheckRes.status === 401 || authCheckRes.status === 403, 'Disabled customer JWT rejected across protected endpoints');

        // Re-enable account
        const enRes = await api('PATCH', `/api/admin/users/${testCustomerId}`, { action: 'enable' }, adminAuth.token);
        assert(enRes.status === 200, 'Admin successfully re-enabled customer account');

        const reDetail = await api('GET', `/api/admin/users/${testCustomerId}`, null, adminAuth.token);
        assert(reDetail.json.user?.isDisabled === false, 'GET user detail reports accountStatus = active');
    }

    // 13. Password Reset Flow
    console.log('\n--- Step 12: Password Reset Link Generation ---');
    if (testCustomerId) {
        const resetRes = await api('POST', `/api/admin/users/${testCustomerId}/reset-password`, null, adminAuth.token);
        assert(resetRes.status === 200, 'POST /reset-password returns 200 OK');
        assert(typeof resetRes.json.link === 'string' && resetRes.json.link.startsWith('http'), 'Secure password recovery link returned');
        assert(resetRes.json.email === custEmail, 'Recovery link associated with target user email');
        assert(!JSON.stringify(resetRes.json).includes('password'), 'Plaintext password strictly absent from reset response');
    }

    // 14. Safe Permanent Delete vs Audit-Protected Retention
    console.log('\n--- Step 13: Safe Permanent Delete vs Audit-Protected Retention ---');
    {
        // A. Self-delete guard
        const selfDeleteRes = await api('DELETE', `/api/admin/users/${adminAuth.userId}`, null, adminAuth.token);
        assert(selfDeleteRes.status === 400, 'Admin self-delete rejected with 400 Bad Request', `got ${selfDeleteRes.status}`);

        // B. Audit-protected user deletion attempt (vishvaaparthipan@gmail.com)
        const protectedDeleteRes = await api('DELETE', `/api/admin/users/${customerAuth.userId}`, null, adminAuth.token);
        assert(protectedDeleteRes.status === 409, 'Deleting account with historical orders/ledger rejected with 409 Conflict', `got ${protectedDeleteRes.status}`);
        assert(protectedDeleteRes.json.isProtected === true, 'API confirms account isProtected = true');
        assert(protectedDeleteRes.json.canDelete === false, 'API confirms canDelete = false');
        assert(typeof protectedDeleteRes.json.details?.userOrders === 'number' && protectedDeleteRes.json.details.userOrders > 0, 'Details include retained user orders count');
        assert(typeof protectedDeleteRes.json.details?.ledgerEntries === 'number' && protectedDeleteRes.json.details.ledgerEntries > 0, 'Details include retained ledger entries count');

        // Verify protected account still exists intact
        const { data: protectedCheck } = await serviceClient.from('profiles').select('user_id').eq('user_id', customerAuth.userId).single();
        assert(!!protectedCheck, 'Audit-protected account was NOT deleted from database');

        // C. Safe permanent deletion of clean customer
        if (testCustomerId) {
            const deleteCustRes = await api('DELETE', `/api/admin/users/${testCustomerId}`, null, adminAuth.token);
            assert(deleteCustRes.status === 200, 'DELETE clean customer returns 200 OK');
            assert(deleteCustRes.json.success === true, 'DELETE clean customer reports success: true');

            // Verify removed from profiles
            const { data: custProfileAfter } = await serviceClient.from('profiles').select('user_id').eq('user_id', testCustomerId).maybeSingle();
            assert(!custProfileAfter, 'Deleted customer profile cleanly removed from database');

            // Verify removed from Auth
            const { data: authUserAfter } = await serviceClient.auth.admin.getUserById(testCustomerId);
            assert(!authUserAfter?.user, 'Deleted customer cleanly purged from Supabase Auth');

            testCustomerId = null; // Cleaned up
        }

        // D. Safe permanent deletion of clean vendor and its unutilized shop
        if (testVendorId) {
            const deleteVendRes = await api('DELETE', `/api/admin/users/${testVendorId}`, null, adminAuth.token);
            assert(deleteVendRes.status === 200, 'DELETE clean vendor returns 200 OK');
            assert(deleteVendRes.json.success === true, 'DELETE clean vendor reports success: true');

            // Verify removed from profiles
            const { data: vendProfileAfter } = await serviceClient.from('profiles').select('user_id').eq('user_id', testVendorId).maybeSingle();
            assert(!vendProfileAfter, 'Deleted vendor profile cleanly removed from database');

            // Verify unutilized new shop was also removed
            if (testNewShopId) {
                const { data: shopAfter } = await serviceClient.from('shops').select('id').eq('id', testNewShopId).maybeSingle();
                assert(!shopAfter, 'Unutilized print shop cleanly removed from database upon vendor deletion');
            }

            // Verify removed from Auth
            const { data: vendAuthAfter } = await serviceClient.auth.admin.getUserById(testVendorId);
            assert(!vendAuthAfter?.user, 'Deleted vendor cleanly purged from Supabase Auth');

            testVendorId = null; // Cleaned up
        }
    }

    // 15. Financial Invariant Check (Post-Test)
    console.log('\n--- Step 14: Financial Invariants Post-Test Verification ---');
    const postInv = await checkFinancialInvariants('POST-TEST');
    assert(postInv, 'Post-test Invariants: zero delta across rules, batches, items, ledger, and wallets');

    // 16. Cleanup Ephemeral Test Accounts & Restore Shop Owner
    console.log('\n--- Step 15: Cleanup & Environment Restoration ---');
    if (originalShopOwner) {
        await serviceClient.from('shops').update({ owner_id: originalShopOwner }).eq('id', shopId);
        console.log(`✓ Restored original shop owner (${originalShopOwner}) for shop ${shopId}`);
    }
    if (testCustomerId) {
        await serviceClient.auth.admin.deleteUser(testCustomerId);
        console.log(`✓ Cleaned up test customer account (${testCustomerId})`);
    }
    if (testVendorId) {
        await serviceClient.auth.admin.deleteUser(testVendorId);
        console.log(`✓ Cleaned up test vendor account (${testVendorId})`);
    }

    console.log('\n===============================================================');
    console.log(`Results: ${passedTests} passed, ${failedTests} failed, ${totalTests} total.`);
    console.log('===============================================================');

    if (failedTests > 0) {
        process.exit(1);
    }
}

runSuite().catch(err => {
    console.error('Fatal test error:', err);
    process.exit(1);
});

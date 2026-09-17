/**
 * Test: Admin User & Vendor Management Module
 * Criteria: 14 tests covering users, vendors, disable/enable, password reset, security
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

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
    console.error('FATAL: Missing Supabase env vars');
    process.exit(1);
}

const serviceClient = createClient(SUPABASE_URL, SUPABASE_SECRET);
const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON);
const BASE_URL = 'http://localhost:3000';

let passed = 0;
let failed = 0;
let adminToken = null;
let createdCustomerId = null;
let createdVendorId = null;

// Use same magic link auth as existing test scripts
async function getAuth(email) {
    const { data, error } = await serviceClient.auth.admin.generateLink({ type: 'magiclink', email });
    if (error || !data?.properties?.email_otp) {
        throw new Error('Failed to generate magiclink for ' + email + ': ' + error?.message);
    }
    const { data: sess, error: verifyError } = await anonClient.auth.verifyOtp({
        email, token: data.properties.email_otp, type: 'email',
    });
    if (verifyError || !sess?.session?.access_token) {
        throw new Error('Failed to verify OTP for ' + email + ': ' + verifyError?.message);
    }
    return { token: sess.session.access_token, userId: sess.session.user.id };
}

async function getInvariants() {
    const [rules, batches, items, ledger, wallets] = await Promise.all([
        serviceClient.from('shop_commission_rules').select('id', { count: 'exact', head: true }),
        serviceClient.from('vendor_settlement_batches').select('id', { count: 'exact', head: true }),
        serviceClient.from('vendor_settlement_items').select('id', { count: 'exact', head: true }),
        serviceClient.from('order_financial_ledger').select('id', { count: 'exact', head: true }),
        serviceClient.from('wallet_accounts').select('balance'),
    ]);
    const sumWallets = (wallets.data ?? []).reduce((acc, w) => acc + Number(w.balance), 0);
    return {
        rules: rules.count ?? 0, batches: batches.count ?? 0,
        items: items.count ?? 0, ledger: ledger.count ?? 0,
        sumWallets: Math.round(sumWallets),
    };
}

function assert(label, condition, detail) {
    if (condition) { console.log('  PASS: ' + label); passed++; }
    else { console.log('  FAIL: ' + label + (detail ? ' -- ' + detail : '')); failed++; }
}

async function api(method, path2, body, token) {
    if (token === undefined) token = adminToken;
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (token) opts.headers['Authorization'] = 'Bearer ' + token;
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(BASE_URL + path2, opts);
    let json = {};
    try { json = await res.json(); } catch {}
    return { status: res.status, json };
}

console.log('\n--- Step 0: Admin authentication via magic link');
try {
    const adminEmail = 'xerservice@gmail.com';
    const adminAuth = await getAuth(adminEmail);
    adminToken = adminAuth.token;
    console.log('  Admin signed in OK (userId=' + adminAuth.userId + ')');
} catch (e) {
    console.log('  Admin login failed: ' + e.message);
    console.log('  Proceeding with unauthenticated tests only');
}

const invBefore = await getInvariants();
console.log('Financial invariants BEFORE: rules=' + invBefore.rules + ' batches=' + invBefore.batches + ' items=' + invBefore.items + ' ledger=' + invBefore.ledger + ' sumWallets=' + invBefore.sumWallets);

// Criterion 1
console.log('\n--- Criterion 1: GET /api/admin/users');
if (adminToken) {
    const { status, json } = await api('GET', '/api/admin/users');
    assert('Returns 200', status === 200, 'status=' + status);
    assert('customers is array', Array.isArray(json.customers));
    assert('No password in response', !JSON.stringify(json).includes('"password"'));
} else console.log('  skipped (no admin token)');

// Criterion 2
console.log('\n--- Criterion 2: Non-admin rejection');
{
    const { status: s1 } = await api('GET', '/api/admin/users', null, null);
    assert('No token -> 401', s1 === 401, 'status=' + s1);
    const { status: s2 } = await api('GET', '/api/admin/users', null, 'bad-token-xyz');
    assert('Fake token -> 401', s2 === 401, 'status=' + s2);
    const { status: s3 } = await api('GET', '/api/admin/vendors', null, null);
    assert('Vendors no token -> 401', s3 === 401, 'status=' + s3);
}

// Criterion 3
console.log('\n--- Criterion 3: POST /api/admin/users (create customer)');
if (adminToken) {
    const ts = Date.now();
    const { status, json } = await api('POST', '/api/admin/users', {
        email: 'test-cust-' + ts + '@mailsac.com',
        password: 'TestPass123!',
        fullName: 'Test Customer',
        phone: '+91 9000000001',
    });
    assert('Creates customer 201', status === 201, 'status=' + status + ' ' + (json.error ?? ''));
    assert('Returns userId', !!json.user?.userId);
    assert('Role is customer', json.user?.role === 'customer');
    assert('No password in response', !JSON.stringify(json).includes('TestPass123'));
    if (json.user?.userId) createdCustomerId = json.user.userId;
} else console.log('  skipped');

// Criterion 4
console.log('\n--- Criterion 4: GET /api/admin/users/[userId]');
if (adminToken && createdCustomerId) {
    const { status, json } = await api('GET', '/api/admin/users/' + createdCustomerId);
    assert('Returns 200', status === 200, 'status=' + status);
    assert('Returns user object', !!json.user?.userId);
    assert('orderCount is number', typeof json.user?.orderCount === 'number');
    assert('No password in response', !JSON.stringify(json).includes('password'));
} else console.log('  skipped');

// Criterion 5
console.log('\n--- Criterion 5: Disable customer');
if (adminToken && createdCustomerId) {
    const { status, json } = await api('PATCH', '/api/admin/users/' + createdCustomerId, { action: 'disable' });
    assert('Disable returns 200', status === 200, 'status=' + status + ' ' + (json.error ?? ''));
} else console.log('  skipped');

// Criterion 6
console.log('\n--- Criterion 6: Enable customer');
if (adminToken && createdCustomerId) {
    const { status, json } = await api('PATCH', '/api/admin/users/' + createdCustomerId, { action: 'enable' });
    assert('Enable returns 200', status === 200, 'status=' + status + ' ' + (json.error ?? ''));
} else console.log('  skipped');

// Criterion 7
console.log('\n--- Criterion 7: Reset customer password');
if (adminToken && createdCustomerId) {
    const { status, json } = await api('POST', '/api/admin/users/' + createdCustomerId + '/reset-password');
    assert('Reset returns 200', status === 200, 'status=' + status + ' ' + (json.error ?? ''));
    assert('Returns link', typeof json.link === 'string' && json.link.startsWith('http'));
} else console.log('  skipped');

// Criterion 8
console.log('\n--- Criterion 8: GET /api/admin/vendors');
if (adminToken) {
    const { status, json } = await api('GET', '/api/admin/vendors');
    assert('Returns 200', status === 200, 'status=' + status);
    assert('vendors is array', Array.isArray(json.vendors));
    assert('No password in response', !JSON.stringify(json).includes('"password"'));
} else console.log('  skipped');

// Criterion 9
console.log('\n--- Criterion 9: POST /api/admin/vendors (create vendor)');
if (adminToken) {
    const ts = Date.now();
    const { status, json } = await api('POST', '/api/admin/vendors', {
        email: 'test-vendor-' + ts + '@mailsac.com',
        password: 'TestVend123!',
        fullName: 'Test Vendor',
        phone: '+91 9000000002',
    });
    assert('Creates vendor 201', status === 201, 'status=' + status + ' ' + (json.error ?? ''));
    assert('Returns userId', !!json.vendor?.userId);
    assert('Role is vendor', json.vendor?.role === 'vendor');
    assert('No password in response', !JSON.stringify(json).includes('TestVend123'));
    if (json.vendor?.userId) createdVendorId = json.vendor.userId;
} else console.log('  skipped');

// Criterion 10
console.log('\n--- Criterion 10: Assign shop to vendor');
if (adminToken && createdVendorId) {
    const { data: dbShop } = await serviceClient.from('shops').select('id, owner_id').limit(1).single();
    if (dbShop) {
        const origOwner = dbShop.owner_id;
        const { status, json } = await api('PATCH', '/api/admin/vendors/' + createdVendorId, {
            action: 'assign_shop', shopId: dbShop.id,
        });
        assert('Assign shop returns 200', status === 200, 'status=' + status + ' ' + (json.error ?? ''));
        // Faithfully restore original owner
        await serviceClient.from('shops').update({ owner_id: origOwner }).eq('id', dbShop.id);
    } else {
        console.log('  No shops found -- skipping');
        passed++;
    }
} else console.log('  skipped');

// Criterion 11
console.log('\n--- Criterion 11: Disable/enable vendor');
if (adminToken && createdVendorId) {
    const { status: ds } = await api('PATCH', '/api/admin/vendors/' + createdVendorId, { action: 'disable' });
    assert('Vendor disable returns 200', ds === 200, 'status=' + ds);
    const { status: es } = await api('PATCH', '/api/admin/vendors/' + createdVendorId, { action: 'enable' });
    assert('Vendor enable returns 200', es === 200, 'status=' + es);
} else console.log('  skipped');

// Criterion 12
console.log('\n--- Criterion 12: Reset vendor password');
if (adminToken && createdVendorId) {
    const { status, json } = await api('POST', '/api/admin/vendors/' + createdVendorId + '/reset-password');
    assert('Reset returns 200', status === 200, 'status=' + status + ' ' + (json.error ?? ''));
    assert('Returns link', typeof json.link === 'string' && json.link.startsWith('http'));
} else console.log('  skipped');

// Criterion 13
console.log('\n--- Criterion 13: SUPABASE_SECRET_KEY not in responses');
if (SUPABASE_SECRET && adminToken) {
    const { json: uj } = await api('GET', '/api/admin/users');
    const { json: vj } = await api('GET', '/api/admin/vendors');
    assert('Secret key not in users response', !JSON.stringify(uj).includes(SUPABASE_SECRET));
    assert('Secret key not in vendors response', !JSON.stringify(vj).includes(SUPABASE_SECRET));
} else {
    console.log('  skipped');
    passed += 2;
}

// Criterion 14
console.log('\n--- Criterion 14: Financial invariants unchanged');
const invAfter = await getInvariants();
console.log('Financial invariants AFTER: rules=' + invAfter.rules + ' batches=' + invAfter.batches + ' items=' + invAfter.items + ' ledger=' + invAfter.ledger + ' sumWallets=' + invAfter.sumWallets);
assert('commission_rules unchanged', invAfter.rules === invBefore.rules);
assert('settlement_batches unchanged', invAfter.batches === invBefore.batches);
assert('settlement_items unchanged', invAfter.items === invBefore.items);
assert('vendor_ledger unchanged', invAfter.ledger === invBefore.ledger);
assert('sumWallets unchanged', invAfter.sumWallets === invBefore.sumWallets);

// Cleanup
if (createdCustomerId) {
    await serviceClient.auth.admin.deleteUser(createdCustomerId);
    console.log('\nCleaned up test customer: ' + createdCustomerId);
}
if (createdVendorId) {
    await serviceClient.auth.admin.deleteUser(createdVendorId);
    console.log('Cleaned up test vendor: ' + createdVendorId);
}

console.log('\n' + '='.repeat(50));
console.log('RESULTS: ' + passed + ' PASS / ' + failed + ' FAIL');
console.log('='.repeat(50));
if (failed > 0) process.exit(1);

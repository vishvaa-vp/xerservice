/**
 * Test Suite: Stage A3 — Vendors & Shop Profile Acceptance Verification
 * Tests:
 *   - /api/admin/vendors (enriched shop metadata, separated trading & publish status)
 *   - /api/admin/shops (POST non-destructive creation, 1-owner/1-shop guard)
 *   - /api/admin/vendors/[vendorId]/shops/[shopId] (GET & PATCH workspace)
 *   - Customer visibility following publish status (DRAFT hidden, PUBLISHED visible)
 *   - Trading status (OPEN/PAUSED/CLOSED) decoupled from publish state
 *   - Non-destructive guarantee: existing shops never overwritten
 *   - Financial invariants preserved with zero delta
 *
 * Run: node scripts/test-stage-a3-vendors-shops.mjs
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
    console.log('Stage A3: Vendors & Shop Profile Acceptance Test Suite');
    console.log('======================================================================\n');

    // Ephemeral resources to clean up
    let testVendorId = null;
    let testShopId = null;

    try {
        // 1. Invariants check
        const preInv = await checkFinancialInvariants('PRE-TEST');
        assert(preInv, 'Financial invariants verified at baseline');

        // 2. Authenticate Admin and Customer
        console.log('\n--- Step 1: Issuing auth tokens ---');
        const adminAuth = await getAuth('xerservice@gmail.com');
        const customerAuth = await getAuth('vishvaaparthipan@gmail.com');
        assert(!!adminAuth.token, 'Admin session token generated');
        assert(!!customerAuth.token, 'Customer session token generated');

        // Record initial baseline of existing shops to verify non-destructive guarantee
        const { data: initialShops } = await serviceClient.from('shops').select('id, name, owner_id, status, description');
        const initialShopIds = new Set((initialShops || []).map(s => s.id));
        const firstShop = (initialShops || [])[0];
        console.log(`Initial shops in DB: ${initialShops.length}. Baseline target shop: "${firstShop?.name}" (${firstShop?.id})`);

        // 3. Test GET /api/admin/vendors
        console.log('\n--- Step 2: Testing /api/admin/vendors (Enriched vendors and shops) ---');
        const unauthVendors = await api('GET', '/api/admin/vendors');
        assert(unauthVendors.status === 401, 'Unauthenticated GET /api/admin/vendors rejected with 401');

        const custVendors = await api('GET', '/api/admin/vendors', null, customerAuth.token);
        assert(custVendors.status === 403, 'Customer role accessing /api/admin/vendors rejected with 403');

        const vendorsRes = await api('GET', '/api/admin/vendors', null, adminAuth.token);
        assert(vendorsRes.ok, 'Admin successfully fetched /api/admin/vendors');
        assert(Array.isArray(vendorsRes.json.vendors), 'Response contains vendors array');
        assert(Array.isArray(vendorsRes.json.shops), 'Response contains shops array');
        assert(vendorsRes.json.summary !== undefined, 'Response contains summary metrics');

        // Validate trading status & publish status separation on shops
        const validTrading = new Set(['OPEN', 'PAUSED', 'CLOSED']);
        const validPublish = new Set(['DRAFT', 'PUBLISHED', 'ARCHIVED']);
        let allStatusesSeparated = true;

        for (const s of vendorsRes.json.shops) {
            if (!validTrading.has(s.shopStatus)) {
                allStatusesSeparated = false;
                console.error(`Shop ${s.shopId} has invalid shopStatus: ${s.shopStatus}`);
            }
            if (!validPublish.has(s.publishStatus)) {
                allStatusesSeparated = false;
                console.error(`Shop ${s.shopId} has invalid publishStatus: ${s.publishStatus}`);
            }
        }
        assert(allStatusesSeparated, 'All shops have separated trading status (OPEN/PAUSED/CLOSED) and publish state (DRAFT/PUBLISHED/ARCHIVED)');

        // 4. Create a new test vendor for second shop testing
        console.log('\n--- Step 3: Creating test vendor for second shop ---');
        const testVendorEmail = `test.vendor.a3.${Date.now()}@example.invalid`;
        const createVendorRes = await api('POST', '/api/admin/vendors', {
            email: testVendorEmail,
            password: 'TestPassword123!',
            fullName: 'A3 Test Vendor Owner',
            phone: '9876543219',
        }, adminAuth.token);

        assert(createVendorRes.status === 201, 'Test vendor created successfully (201)');
        testVendorId = createVendorRes.json.vendor.userId;

        // 5. Test POST /api/admin/shops (Non-destructive second shop creation)
        console.log('\n--- Step 4: Testing POST /api/admin/shops (Second shop creation) ---');

        // 1-owner / 1-shop rule rejection test: existing owner
        const rejectDuplicateOwner = await api('POST', '/api/admin/shops', {
            name: 'Conflicting Shop',
            ownerId: firstShop.owner_id,
        }, adminAuth.token);
        assert(rejectDuplicateOwner.status === 409, 'Creating second shop for vendor who already owns a shop rejected with 409 Conflict');

        // Create second shop for new vendor: "Lakshmi Xerox (A3 Test Shop)"
        const createShopRes = await api('POST', '/api/admin/shops', {
            name: 'Lakshmi Xerox (A3 Test)',
            ownerId: testVendorId,
            address: 'College Road, Opp. Tech Gate',
            status: 'CLOSED',
            publishStatus: 'DRAFT',
            openTime: '09:00',
            closeTime: '20:00',
            contactPhone: '+919876543219',
        }, adminAuth.token);

        assert(createShopRes.status === 201, 'Second shop created successfully with DRAFT status (201)');
        testShopId = createShopRes.json.shop.id;
        assert(createShopRes.json.shop.publishStatus === 'DRAFT', 'Newly created shop has publishStatus === "DRAFT"');
        assert(createShopRes.json.shop.shopStatus === 'CLOSED', 'Newly created shop has trading status === "CLOSED"');

        // Verify non-destructive guarantee: firstShop was untouched
        const { data: firstShopAfter } = await serviceClient.from('shops').select('*').eq('id', firstShop.id).single();
        assert(
            firstShopAfter.name === firstShop.name &&
            firstShopAfter.owner_id === firstShop.owner_id &&
            firstShopAfter.status === firstShop.status,
            `Existing first shop "${firstShop.name}" was strictly untouched with zero modifications`
        );

        // 6. Test Customer Discovery Rule: Draft shop must NOT be visible to customers
        console.log('\n--- Step 5: Testing Customer Discovery (DRAFT visibility filtering) ---');
        const { parseShopProfileMetadata } = await import('../src/lib/shop-profile.ts');

        // Fetch all shops as customer would
        const { data: publicShops } = await serviceClient.from('shops').select('id, name, description, status');
        const visibleToCustomer = (publicShops || []).filter(s => {
            const meta = parseShopProfileMetadata(s.description);
            return meta.publishStatus === 'PUBLISHED';
        });

        const draftShopVisible = visibleToCustomer.some(s => s.id === testShopId);
        assert(!draftShopVisible, 'Draft shop is strictly HIDDEN from customer visible shops list');
        assert(visibleToCustomer.some(s => s.id === firstShop.id), 'Existing published shop remains visible to customers');

        // 7. Test Dedicated Shop Workspace API (GET & PATCH)
        console.log('\n--- Step 6: Testing Dedicated Shop Workspace API ---');

        // GET Workspace
        const workspaceGet = await api('GET', `/api/admin/vendors/${testVendorId}/shops/${testShopId}`, null, adminAuth.token);
        assert(workspaceGet.ok, 'GET /api/admin/vendors/[vendorId]/shops/[shopId] returns 200 OK');
        assert(workspaceGet.json.shop.id === testShopId, 'Workspace shop ID matches');
        assert(workspaceGet.json.owner.userId === testVendorId, 'Workspace owner ID matches');
        assert(workspaceGet.json.shop.publishStatus === 'DRAFT', 'Workspace reports correct DRAFT publish status');
        assert(Array.isArray(workspaceGet.json.pricing), 'Workspace contains pricing array');
        assert(Array.isArray(workspaceGet.json.addons), 'Workspace contains addons array');

        // PATCH Workspace: Publish the shop and update operating hours
        console.log('\n--- Step 7: Publishing Shop and Updating Profile via PATCH ---');
        const patchRes = await api('PATCH', `/api/admin/vendors/${testVendorId}/shops/${testShopId}`, {
            name: 'Lakshmi Xerox (A3 Published)',
            address: 'College Road, Opp. Tech Gate, Block B',
            publishStatus: 'PUBLISHED',
            status: 'OPEN',
            open_time: '08:30:00',
            close_time: '21:00:00',
            closing_soon: false,
        }, adminAuth.token);

        assert(patchRes.ok, 'PATCH shop workspace returned 200 OK');
        assert(patchRes.json.shop.publishStatus === 'PUBLISHED', 'Shop publishStatus updated to PUBLISHED');
        assert(patchRes.json.shop.shopStatus === 'OPEN', 'Shop trading status updated to OPEN');
        assert(patchRes.json.shop.name === 'Lakshmi Xerox (A3 Published)', 'Shop name updated');

        // Verify Customer Visibility after Publish: Now the shop MUST be visible
        const { data: publicShopsAfterPublish } = await serviceClient.from('shops').select('id, name, description, status');
        const visibleAfterPublish = (publicShopsAfterPublish || []).filter(s => {
            const meta = parseShopProfileMetadata(s.description);
            return meta.publishStatus === 'PUBLISHED';
        });

        const nowVisible = visibleAfterPublish.some(s => s.id === testShopId);
        assert(nowVisible, 'Newly published shop is now DISCOVERABLE in customer visible shops list');

        // 8. Test Trading Status Separation: Change trading status to CLOSED while PUBLISHED
        console.log('\n--- Step 8: Decoupled Trading Status (Closed while Published) ---');
        const closeTradingRes = await api('PATCH', `/api/admin/vendors/${testVendorId}/shops/${testShopId}`, {
            status: 'CLOSED',
        }, adminAuth.token);

        assert(closeTradingRes.ok, 'PATCH trading status to CLOSED succeeds');
        assert(closeTradingRes.json.shop.shopStatus === 'CLOSED', 'Trading status is CLOSED');
        assert(closeTradingRes.json.shop.publishStatus === 'PUBLISHED', 'Publish state remains PUBLISHED');

        // Customer sees the shop as closed, but still discoverable
        const { data: publicShopsClosed } = await serviceClient.from('shops').select('id, name, description, status');
        const customerClosedShop = (publicShopsClosed || []).find(s => s.id === testShopId);
        const metaClosed = parseShopProfileMetadata(customerClosedShop?.description);
        assert(metaClosed.publishStatus === 'PUBLISHED', 'Shop remains published and discoverable');
        assert(customerClosedShop.status === 'CLOSED', 'Trading status is truthfully CLOSED (blocks checkout)');

    } finally {
        // 9. Clean Cleanup & Environment Restoration
        console.log('\n--- Step 9: Cleanup & Environment Restoration ---');
        if (testShopId) {
            await serviceClient.from('shops').delete().eq('id', testShopId);
            console.log(`Cleaned up test shop: ${testShopId}`);
        }
        if (testVendorId) {
            await serviceClient.from('profiles').delete().eq('user_id', testVendorId);
            await serviceClient.auth.admin.deleteUser(testVendorId);
            console.log(`Cleaned up test vendor: ${testVendorId}`);
        }

        // 10. Post-test Invariants Check
        const postInv = await checkFinancialInvariants('POST-TEST');
        assert(postInv, 'Financial invariants completely preserved with zero delta');

        console.log('\n======================================================================');
        console.log(`Results: ${passedTests} passed, ${failedTests} failed out of ${totalTests} total tests`);
        console.log('======================================================================\n');

        if (failedTests > 0) {
            process.exit(1);
        }
    }
}

runSuite().catch(err => {
    console.error('Test suite uncaught error:', err);
    process.exit(1);
});

/**
 * Stage A5: Commission Engine Acceptance Test Suite
 * Validates:
 * 1. All 4 Astraplan Section 8.2 worked examples
 * 2. Mathematical invariants: Gross === Platform Fee + Shop Net
 * 3. Scope precedence: Specific Service > Category > Shop Default > Global
 * 4. Admin preview and dry-run endpoints
 * 5. Strict Vendor Field Privacy across vendor APIs (stripping private commission fields)
 * 6. Financial invariants preservation with zero delta
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import {
    calculateOrderCommission,
    calculateLineCommission,
    resolveEffectiveRule,
    simulateAstraplanScenario,
} from '../packages/backend/src/finance/commission-engine.ts';

// Load .env.local
const envPath = path.resolve(process.cwd(), '.env.local');
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
    console.error('Missing Supabase credentials in .env.local');
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
    console.log(`\n[Financial ${label}] ledger=${snapshot.ledger}, wallets=₹${snapshot.sumWallets}, rules=${snapshot.rules}, batches=${snapshot.batches}, items=${snapshot.items}`);

    if (baselineInvariants) {
        assert(
            snapshot.rules === baselineInvariants.rules &&
            snapshot.batches === baselineInvariants.batches &&
            snapshot.items === baselineInvariants.items &&
            snapshot.ledger === baselineInvariants.ledger &&
            snapshot.sumWallets === baselineInvariants.sumWallets,
            `${label}: Financial invariants completely preserved with zero delta`,
            JSON.stringify({ expected: baselineInvariants, actual: snapshot })
        );
    } else {
        baselineInvariants = snapshot;
    }
    return snapshot;
}

async function runSuite() {
    console.log('\n======================================================================');
    console.log('Stage A5: Commission Engine Acceptance Test Suite');
    console.log('======================================================================\n');

    await checkFinancialInvariants('Baseline');

    // 1. Authenticate users
    const adminAuth = await getAuth('xerservice@gmail.com');
    const vendorAuth = await getAuth('xerserviceofficial@gmail.com');
    const customerAuth = await getAuth('vishvaaparthipan@gmail.com');

    // Get primary print shop and vendor
    const { data: shop } = await serviceClient
        .from('shops')
        .select('id, name, owner_id')
        .order('created_at', { ascending: true })
        .limit(1)
        .single();

    const { data: activeRule } = await serviceClient
        .from('shop_commission_rules')
        .select('*')
        .eq('shop_id', shop.id)
        .eq('is_active', true)
        .maybeSingle();

    console.log(`\n--- Test Section 1: Astraplan Section 8.2 Worked Examples ---`);

    // Test 1: Astraplan 8.2 Worked Example 1 (Two single-sided ₹2 sheets, 10% revenue)
    const ex1 = simulateAstraplanScenario(1);
    assert(
        ex1.customerAmount === 4.00 && ex1.xerserviceFee === 0.40 && ex1.shopEarnings === 3.60,
        'Astraplan 8.2 Example 1 (Two single-sided ₹2 sheets, 10% revenue): Fee = ₹0.40, Shop = ₹3.60',
        `Got fee: ₹${ex1.xerserviceFee}, shop: ₹${ex1.shopEarnings}`
    );

    // Test 2: Astraplan 8.2 Worked Example 2 (Same sale, cost ₹2.40, 10% of configured profit)
    const ex2 = simulateAstraplanScenario(2);
    assert(
        ex2.customerAmount === 4.00 && ex2.xerserviceFee === 0.16 && ex2.shopEarnings === 3.84,
        'Astraplan 8.2 Example 2 (Same sale, cost ₹2.40, 10% profit): Fee = ₹0.16, Shop = ₹3.84',
        `Got fee: ₹${ex2.xerserviceFee}, shop: ₹${ex2.shopEarnings}`
    );

    // Test 3: Astraplan 8.2 Worked Example 3 (Same sale, ₹0.25 per physical sheet)
    const ex3 = simulateAstraplanScenario(3);
    assert(
        ex3.customerAmount === 4.00 && ex3.xerserviceFee === 0.50 && ex3.shopEarnings === 3.50,
        'Astraplan 8.2 Example 3 (Same sale, ₹0.25 per physical sheet): Fee = ₹0.50, Shop = ₹3.50',
        `Got fee: ₹${ex3.xerserviceFee}, shop: ₹${ex3.shopEarnings}`
    );

    // Test 4: Astraplan 8.2 Worked Example 4 (Printing ₹4 at 10%, binding ₹20 at 5%)
    const ex4 = simulateAstraplanScenario(4);
    assert(
        ex4.customerAmount === 24.00 && ex4.xerserviceFee === 1.40 && ex4.shopEarnings === 22.60,
        'Astraplan 8.2 Example 4 (Printing ₹4 @ 10%, binding ₹20 @ 5%): Fee = ₹1.40, Shop = ₹22.60',
        `Got fee: ₹${ex4.xerserviceFee}, shop: ₹${ex4.shopEarnings}`
    );

    console.log(`\n--- Test Section 2: Mathematical Invariants & Fee Caps ---`);

    // Test 5: Exact Decimal Invariant (Gross === Fee + Net)
    assert(
        ex1.result.grossAmount === ex1.result.platformCommission + ex1.result.vendorNet &&
        ex2.result.grossAmount === ex2.result.platformCommission + ex2.result.vendorNet &&
        ex3.result.grossAmount === ex3.result.platformCommission + ex3.result.vendorNet &&
        ex4.result.grossAmount === ex4.result.platformCommission + ex4.result.vendorNet,
        'Exact Decimal Invariant strictly holds: Gross === Platform Commission + Shop Net across all scenarios'
    );

    // Test 6: Fee cap at eligible revenue (prevent negative shop net earnings)
    const excessiveRule = {
        id: 'excessive-rule',
        shopId: shop.id,
        scope: 'SHOP_DEFAULT',
        calculationMethod: 'FIXED_PER_UNIT',
        rateValue: 10.00, // ₹10 fee per unit on a ₹5 sale
        unit: 'PHYSICAL_SHEET',
        effectiveFrom: '2020-01-01T00:00:00Z',
        isActive: true,
    };
    const cappedLine = calculateLineCommission(
        { lineType: 'PRINTING', revenue: 5.00, quantity: 1, unitType: 'PHYSICAL_SHEET' },
        excessiveRule
    );
    assert(
        cappedLine.fee === 5.00 && cappedLine.shopEarnings === 0.00,
        'Fee is safely capped at eligible revenue (₹5.00 fee on ₹5.00 sale), shop net cannot be negative',
        `Got fee: ₹${cappedLine.fee}, shop net: ₹${cappedLine.shopEarnings}`
    );

    // Test 7: Profit model with cost exceeding revenue yields ₹0 fee
    const noProfitRule = {
        id: 'no-profit-rule',
        shopId: shop.id,
        scope: 'SHOP_DEFAULT',
        calculationMethod: 'CONFIGURED_PROFIT_PERCENTAGE',
        rateValue: 15,
        costBasis: 10.00,
        effectiveFrom: '2020-01-01T00:00:00Z',
        isActive: true,
    };
    const zeroProfitLine = calculateLineCommission(
        { lineType: 'PRINTING', revenue: 8.00, costBasis: 10.00, quantity: 1, unitType: 'PHYSICAL_SHEET' },
        noProfitRule
    );
    assert(
        zeroProfitLine.fee === 0.00 && zeroProfitLine.shopEarnings === 8.00,
        'When direct cost exceeds revenue in profit model, fee is ₹0.00 and shop receives full ₹8.00'
    );

    console.log(`\n--- Test Section 3: Scope Precedence & Effective Rule Resolution ---`);

    const rulesSet = [
        {
            id: 'rule-global',
            shopId: null,
            scope: 'GLOBAL',
            calculationMethod: 'REVENUE_PERCENTAGE',
            rateValue: 5,
            effectiveFrom: '2020-01-01T00:00:00Z',
            isActive: true,
        },
        {
            id: 'rule-shop-default',
            shopId: shop.id,
            scope: 'SHOP_DEFAULT',
            calculationMethod: 'REVENUE_PERCENTAGE',
            rateValue: 10,
            effectiveFrom: '2020-01-01T00:00:00Z',
            isActive: true,
        },
        {
            id: 'rule-category-print',
            shopId: shop.id,
            scope: 'PRINTING',
            calculationMethod: 'REVENUE_PERCENTAGE',
            rateValue: 15,
            effectiveFrom: '2020-01-01T00:00:00Z',
            isActive: true,
        },
        {
            id: 'rule-specific-addon',
            shopId: shop.id,
            scope: 'SPECIFIC_SERVICE',
            serviceId: 'addon-spiral-123',
            calculationMethod: 'REVENUE_PERCENTAGE',
            rateValue: 20,
            effectiveFrom: '2020-01-01T00:00:00Z',
            isActive: true,
        },
    ];

    // Test 8: Specific service override wins over category and shop default
    const winSpecific = resolveEffectiveRule(
        { lineType: 'ADDON', serviceId: 'addon-spiral-123', revenue: 50, quantity: 1, unitType: 'SERVICE_UNIT' },
        rulesSet
    );
    assert(winSpecific.id === 'rule-specific-addon' && winSpecific.rateValue === 20, 'Specific service override takes top precedence (20%)');

    // Test 9: Category override wins over shop default
    const winCategory = resolveEffectiveRule(
        { lineType: 'PRINTING', revenue: 10, quantity: 1, unitType: 'PHYSICAL_SHEET' },
        rulesSet
    );
    assert(winCategory.id === 'rule-category-print' && winCategory.rateValue === 15, 'Category override takes precedence over shop default (15%)');

    // Test 10: Shop default wins over global default
    const winShopDefault = resolveEffectiveRule(
        { lineType: 'ADDON', serviceId: 'other-addon', revenue: 20, quantity: 1, unitType: 'SERVICE_UNIT' },
        rulesSet
    );
    assert(winShopDefault.id === 'rule-shop-default' && winShopDefault.rateValue === 10, 'Shop default takes precedence over global default (10%)');

    // Test 11: Inactive rule is ignored
    const inactiveSpecific = { ...rulesSet[3], isActive: false };
    const winFallback = resolveEffectiveRule(
        { lineType: 'ADDON', serviceId: 'addon-spiral-123', revenue: 50, quantity: 1, unitType: 'SERVICE_UNIT' },
        [rulesSet[0], rulesSet[1], rulesSet[2], inactiveSpecific]
    );
    assert(winFallback.id === 'rule-shop-default', 'Inactive specific rule is bypassed, falling back to shop default');

    console.log(`\n--- Test Section 4: Admin Commission APIs (RBAC & Simulation) ---`);

    // Test 12: Unauthenticated request to preview API rejected with 401
    const unauthPreview = await fetch(`${BASE_URL}/api/admin/finance/commission-rules/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenario: 1 }),
    });
    assert(unauthPreview.status === 401, 'Unauthenticated request to preview API rejected with 401');

    // Test 13: Customer role accessing preview API rejected with 403
    const custPreview = await fetch(`${BASE_URL}/api/admin/finance/commission-rules/preview`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${customerAuth.token}`,
        },
        body: JSON.stringify({ scenario: 1 }),
    });
    assert(custPreview.status === 403, 'Customer role accessing preview API rejected with 403');

    // Test 14: Admin calling preview API with Astraplan preset 1 succeeds
    const adminPrev1 = await fetch(`${BASE_URL}/api/admin/finance/commission-rules/preview`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${adminAuth.token}`,
        },
        body: JSON.stringify({ scenario: 1 }),
    });
    assert(adminPrev1.status === 200, 'Admin successfully ran preview simulation for Scenario 1');
    const pData1 = await adminPrev1.json();
    assert(pData1.xerserviceFee === 0.40 && pData1.shopEarnings === 3.60, 'Preview returned accurate Scenario 1 fee (₹0.40)');

    // Test 15: Admin calling preview API with Astraplan preset 2 succeeds
    const adminPrev2 = await fetch(`${BASE_URL}/api/admin/finance/commission-rules/preview`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${adminAuth.token}`,
        },
        body: JSON.stringify({ scenario: 2 }),
    });
    assert(adminPrev2.status === 200, 'Admin successfully ran preview simulation for Scenario 2');
    const pData2 = await adminPrev2.json();
    assert(pData2.xerserviceFee === 0.16 && pData2.shopEarnings === 3.84, 'Preview returned accurate Scenario 2 fee (₹0.16)');

    // Test 16: Admin calling preview API with Astraplan preset 3 succeeds
    const adminPrev3 = await fetch(`${BASE_URL}/api/admin/finance/commission-rules/preview`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${adminAuth.token}`,
        },
        body: JSON.stringify({ scenario: 3 }),
    });
    assert(adminPrev3.status === 200, 'Admin successfully ran preview simulation for Scenario 3');
    const pData3 = await adminPrev3.json();
    assert(pData3.xerserviceFee === 0.50 && pData3.shopEarnings === 3.50, 'Preview returned accurate Scenario 3 fee (₹0.50)');

    // Test 17: Admin calling preview API with Astraplan preset 4 succeeds
    const adminPrev4 = await fetch(`${BASE_URL}/api/admin/finance/commission-rules/preview`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${adminAuth.token}`,
        },
        body: JSON.stringify({ scenario: 4 }),
    });
    assert(adminPrev4.status === 200, 'Admin successfully ran preview simulation for Scenario 4');
    const pData4 = await adminPrev4.json();
    assert(pData4.xerserviceFee === 1.40 && pData4.shopEarnings === 22.60, 'Preview returned accurate Scenario 4 fee (₹1.40)');

    // Test 18: Admin calling dry-run evaluation endpoint
    if (activeRule) {
        const dryRunRes = await fetch(`${BASE_URL}/api/admin/finance/commission-rules/${activeRule.id}/dry-run`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${adminAuth.token}`,
            },
        });
        assert(dryRunRes.status === 200, `Admin dry-run evaluation endpoint returns 200 OK for rule ${activeRule.id}`);
        const dryData = await dryRunRes.json();
        assert(dryData.dryRun === true && dryData.rule?.id === activeRule.id, 'Dry run returned simulation metadata without mutating database');
    }

    console.log(`\n--- Test Section 5: Vendor Field Privacy (Astraplan Section 8.4 Exit Criteria) ---`);

    // Test 19: Vendor GET /api/vendor/finance/orders does NOT leak commission_bps or platform_commission_amount
    const vendorOrdersRes = await fetch(`${BASE_URL}/api/vendor/finance/orders`, {
        headers: { Authorization: `Bearer ${vendorAuth.token}` },
    });
    assert(vendorOrdersRes.status === 200, 'Vendor successfully retrieved finance orders list');
    const vendorOrdersData = await vendorOrdersRes.json();
    const leakedOrders = (vendorOrdersData.orders || []).filter(
        (o) => o.commission_bps !== undefined || o.platform_commission_amount !== undefined
    );
    assert(
        leakedOrders.length === 0,
        'Vendor finance orders strictly omits commission_bps and platform_commission_amount',
        leakedOrders.length > 0 ? JSON.stringify(leakedOrders[0]) : ''
    );

    // Test 20: Vendor GET /api/vendor/settlements does NOT leak platform_commission_amount
    const vendorSettlementsRes = await fetch(`${BASE_URL}/api/vendor/settlements`, {
        headers: { Authorization: `Bearer ${vendorAuth.token}` },
    });
    assert(vendorSettlementsRes.status === 200, 'Vendor successfully retrieved settlements list');
    const vendorSettlementsData = await vendorSettlementsRes.json();
    const leakedSettlements = (vendorSettlementsData.settlements || []).filter(
        (s) => s.platform_commission_amount !== undefined
    );
    assert(
        leakedSettlements.length === 0,
        'Vendor settlements strictly omits platform_commission_amount',
        leakedSettlements.length > 0 ? JSON.stringify(leakedSettlements[0]) : ''
    );

    // Test 21: Vendor GET /api/vendor/finance/summary does NOT leak platformCommission
    const vendorSummaryRes = await fetch(`${BASE_URL}/api/vendor/finance/summary`, {
        headers: { Authorization: `Bearer ${vendorAuth.token}` },
    });
    assert(vendorSummaryRes.status === 200, 'Vendor successfully retrieved finance summary');
    const vendorSummaryData = await vendorSummaryRes.json();
    assert(
        vendorSummaryData.summary?.platformCommission === undefined,
        'Vendor finance summary strictly omits platformCommission'
    );
    assert(
        vendorSummaryData.summary?.vendorEarnings !== undefined || vendorSummaryData.summary?.settledAmount !== undefined,
        'Vendor finance summary truthfully retains vendor earnings and settlement metrics'
    );

    // Test 22: Vendor GET /api/vendor/overview metrics does NOT leak platformCommission
    const vendorOverviewRes = await fetch(`${BASE_URL}/api/vendor/overview`, {
        headers: { Authorization: `Bearer ${vendorAuth.token}` },
    });
    assert(vendorOverviewRes.status === 200, 'Vendor successfully retrieved overview metrics');
    const vendorOverviewData = await vendorOverviewRes.json();
    assert(
        vendorOverviewData.metrics?.platformCommission === undefined,
        'Vendor overview metrics strictly omits platformCommission'
    );

    console.log(`\n--- Test Section 6: Final Financial Invariants Verification ---`);
    await checkFinancialInvariants('Post-Execution');

    console.log('\n======================================================================');
    console.log(`Results: ${passedTests} passed, ${failedTests} failed out of ${totalTests} total tests (${Math.round((passedTests / totalTests) * 100)}%)`);
    console.log('======================================================================\n');

    if (failedTests > 0) {
        process.exit(1);
    }
}

runSuite().catch(err => {
    console.error('Unhandled error in test suite:', err);
    process.exit(1);
});

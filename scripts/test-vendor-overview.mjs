import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

const envContent = fs.readFileSync('.env.local', 'utf8');
const getEnv = (key) => {
    const match = envContent.match(new RegExp('^' + key + '=(.*)$', 'm'));
    return match ? match[1].trim() : undefined;
};

const supabaseUrl = getEnv('NEXT_PUBLIC_SUPABASE_URL');
const supabaseSecret = getEnv('SUPABASE_SECRET_KEY');
const supabaseAnon = getEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');

const adminClient = createClient(supabaseUrl, supabaseSecret);
const anonClient = createClient(supabaseUrl, supabaseAnon);

const BASE_URL = 'http://localhost:3000';

async function getAccessToken(email) {
    const { data, error } = await adminClient.auth.admin.generateLink({ type: 'magiclink', email });
    if (error || !data?.properties?.email_otp) {
        throw new Error(`Failed to generate magiclink for ${email}: ${error?.message}`);
    }

    const { data: sess, error: verifyError } = await anonClient.auth.verifyOtp({
        email,
        token: data.properties.email_otp,
        type: 'email',
    });

    if (verifyError || !sess?.session?.access_token) {
        throw new Error(`Failed to verify OTP for ${email}: ${verifyError?.message}`);
    }

    return sess.session.access_token;
}

async function runTests() {
    console.log('--- XerService Backend — Phase 6B: Real Vendor Overview Analytics Tests ---\n');

    // 1. Generate Auth Tokens
    const vendor1Token = await getAccessToken('xerserviceofficial@gmail.com');
    const vendor2Token = await getAccessToken('xerservicevendor@gmail.com');
    const customerToken = await getAccessToken('vishvaaparthipan@gmail.com');

    console.log('✓ Tokens generated for Vendor 1 (D-Block), Vendor 2 (No shop), and Customer.\n');

    // Test 1: Unauthenticated request must return 401
    console.log('Test 1: Unauthenticated request...');
    const resNoAuth = await fetch(`${BASE_URL}/api/vendor/overview`);
    if (resNoAuth.status !== 401) {
        throw new Error(`Test 1 Failed: Expected 401 Unauthorized, got ${resNoAuth.status}`);
    }
    console.log('✓ Test 1 Passed: Unauthenticated request rejected with HTTP 401.\n');

    // Test 2: Customer token must return 403 Forbidden
    console.log('Test 2: Customer token role restriction...');
    const resCustomer = await fetch(`${BASE_URL}/api/vendor/overview`, {
        headers: { Authorization: `Bearer ${customerToken}` },
    });
    if (resCustomer.status !== 403) {
        throw new Error(`Test 2 Failed: Expected 403 Forbidden for customer, got ${resCustomer.status}`);
    }
    const customerErr = await resCustomer.json();
    if (!customerErr.error?.includes('vendor privileges required')) {
        throw new Error(`Test 2 Failed: Expected vendor role error message, got: ${JSON.stringify(customerErr)}`);
    }
    console.log('✓ Test 2 Passed: Customer account rejected with HTTP 403 Forbidden.\n');

    // Test 3: Vendor without assigned shop returns 404
    console.log('Test 3: Vendor without assigned shop...');
    const resVendor2 = await fetch(`${BASE_URL}/api/vendor/overview`, {
        headers: { Authorization: `Bearer ${vendor2Token}` },
    });
    if (resVendor2.status !== 404) {
        throw new Error(`Test 3 Failed: Expected 404 No shop assigned, got ${resVendor2.status}`);
    }
    console.log('✓ Test 3 Passed: Vendor without shop correctly returns HTTP 404.\n');

    // Test 4: Authorized Vendor Overview for D-Block Reprography ITECH
    console.log('Test 4: Authorized Vendor Overview retrieval for D-Block Reprography ITECH...');
    const resVendor1 = await fetch(`${BASE_URL}/api/vendor/overview?range=today`, {
        headers: { Authorization: `Bearer ${vendor1Token}` },
    });
    if (!resVendor1.ok) {
        throw new Error(`Test 4 Failed: Expected 200 OK, got ${resVendor1.status}: ${await resVendor1.text()}`);
    }
    const overview = await resVendor1.json();

    if (overview.shop.name !== 'D-Block Reprography ITECH') {
        throw new Error(`Test 4 Failed: Expected shop name 'D-Block Reprography ITECH', got '${overview.shop.name}'`);
    }
    if (overview.metrics.commissionConfigured === false) {
        if (overview.metrics.totalRevenue !== null) {
            throw new Error(`Test 4 Failed: Expected totalRevenue to be null when commissionConfigured is false, got ${overview.metrics.totalRevenue}`);
        }
        console.log('  Metrics received (Commission Unconfigured / Setup Pending):');
        console.log(`    Total Revenue: ${overview.metrics.totalRevenue} (— Commission setup pending)`);
        console.log(`    Gross Sales: Rs ${overview.metrics.grossSales?.toFixed(2)}`);
    } else {
        if (typeof overview.metrics.totalRevenue !== 'number' || overview.metrics.totalRevenue < 0) {
            throw new Error(`Test 4 Failed: Invalid totalRevenue: ${overview.metrics.totalRevenue}`);
        }
        console.log('  Metrics received:');
        console.log(`    Total Revenue: Rs ${overview.metrics.totalRevenue.toFixed(2)}`);
    }

    if (typeof overview.metrics.totalOrders !== 'number' || overview.metrics.totalOrders < 1) {
        throw new Error(`Test 4 Failed: Expected at least 1 total order (XS-100002), got ${overview.metrics.totalOrders}`);
    }
    if (typeof overview.metrics.todayCompletedOrders !== 'number' || overview.metrics.todayCompletedOrders < 0) {
        throw new Error(`Test 4 Failed: Invalid todayCompletedOrders: ${overview.metrics.todayCompletedOrders}`);
    }

    console.log(`    Total Orders: ${overview.metrics.totalOrders}`);
    console.log(`    Today Completed Orders: ${overview.metrics.todayCompletedOrders}`);
    console.log('✓ Test 4 Passed: Overview metrics verified.\n');

    // Test 5: Reconcile with direct database query
    console.log('Test 5: Authoritative database reconciliation...');
    const { data: dbOrders, error: dbErr } = await adminClient
        .from('orders')
        .select('total_amount, status, payment_status, created_at, paid_at')
        .eq('shop_id', overview.shop.id)
        .eq('payment_status', 'PAID');

    if (dbErr) {
        throw new Error(`Test 5 Failed: DB query error: ${dbErr.message}`);
    }

    const expectedTotalGross = Math.round(dbOrders.reduce((sum, o) => sum + Number(o.total_amount || 0), 0) * 100) / 100;
    const expectedTotalOrders = dbOrders.length;

    if (overview.metrics.grossSales !== expectedTotalGross) {
        throw new Error(`Test 5 Failed: API grossSales (${overview.metrics.grossSales}) !== DB gross (${expectedTotalGross})`);
    }
    if (overview.metrics.totalOrders !== expectedTotalOrders) {
        throw new Error(`Test 5 Failed: API totalOrders (${overview.metrics.totalOrders}) !== DB totalOrders (${expectedTotalOrders})`);
    }
    console.log(`✓ Test 5 Passed: Metrics exactly match direct PostgreSQL database calculations (Gross: Rs ${expectedTotalGross}, ${expectedTotalOrders} orders).\n`);

    // Test 6: Chart Range Bucketing
    console.log('Test 6: Chart Range Bucketing...');
    // 6a: Today range
    if (!Array.isArray(overview.chartData) || overview.chartData.length !== 9) {
        throw new Error(`Test 6a Failed: Expected 9 hourly buckets for 'today', got ${overview.chartData?.length}`);
    }
    const expectedHours = ['9am', '10am', '11am', '12pm', '1pm', '2pm', '3pm', '4pm', '5pm'];
    for (let i = 0; i < 9; i++) {
        if (overview.chartData[i].label !== expectedHours[i]) {
            throw new Error(`Test 6a Failed: Bucket ${i} label expected '${expectedHours[i]}', got '${overview.chartData[i].label}'`);
        }
    }
    console.log('  ✓ 6a: Today range returns 9 continuous hourly buckets (9am-5pm).');

    // 6b: Week range
    const resWeek = await fetch(`${BASE_URL}/api/vendor/overview?range=week`, {
        headers: { Authorization: `Bearer ${vendor1Token}` },
    });
    const weekData = await resWeek.json();
    if (!Array.isArray(weekData.chartData) || weekData.chartData.length !== 7) {
        throw new Error(`Test 6b Failed: Expected 7 daily buckets for 'week', got ${weekData.chartData?.length}`);
    }
    const expectedDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    for (let i = 0; i < 7; i++) {
        if (weekData.chartData[i].label !== expectedDays[i]) {
            throw new Error(`Test 6b Failed: Bucket ${i} label expected '${expectedDays[i]}', got '${weekData.chartData[i].label}'`);
        }
    }
    console.log('  ✓ 6b: Week range returns 7 continuous daily buckets (Mon-Sun).');

    // 6c: Month range (Week 1 to Week 5 covering full month in IST)
    const resMonth = await fetch(`${BASE_URL}/api/vendor/overview?range=month`, {
        headers: { Authorization: `Bearer ${vendor1Token}` },
    });
    const monthData = await resMonth.json();
    if (!Array.isArray(monthData.chartData) || monthData.chartData.length !== 5) {
        throw new Error(`Test 6c Failed: Expected 5 weekly buckets for 'month', got ${monthData.chartData?.length}`);
    }
    const expectedWeeks = ['Week 1', 'Week 2', 'Week 3', 'Week 4', 'Week 5'];
    for (let i = 0; i < 5; i++) {
        if (monthData.chartData[i].label !== expectedWeeks[i]) {
            throw new Error(`Test 6c Failed: Bucket ${i} label expected '${expectedWeeks[i]}', got '${monthData.chartData[i].label}'`);
        }
    }

    const sumMonthBuckets = Math.round(monthData.chartData.reduce((s, b) => s + b.amount, 0) * 100) / 100;
    console.log('  This Month chart buckets:');
    for (const b of monthData.chartData) {
        console.log(`    ${b.label}: Rs ${b.amount.toFixed(2)}`);
    }
    console.log(`  Sum of Month Buckets: Rs ${sumMonthBuckets.toFixed(2)}`);

    // Verify against DB for current month
    const now = new Date();
    const dtf = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit' });
    const curYearMonth = dtf.format(now); // "YYYY-MM"
    const monthStartIso = new Date(`${curYearMonth}-01T00:00:00.000+05:30`).toISOString();
    // Compute last day of month
    const lastDayDate = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const monthEndIso = new Date(`${curYearMonth}-${String(lastDayDate).padStart(2, '0')}T23:59:59.999+05:30`).toISOString();

    const { data: monthOrders } = await adminClient
        .from('orders')
        .select('total_amount')
        .eq('shop_id', overview.shop.id)
        .eq('payment_status', 'PAID')
        .gte('paid_at', monthStartIso)
        .lte('paid_at', monthEndIso);

    const expectedMonthRevenue = Math.round((monthOrders || []).reduce((s, o) => s + Number(o.total_amount || 0), 0) * 100) / 100;
    if (sumMonthBuckets !== expectedMonthRevenue) {
        throw new Error(`Test 6c Failed: sum(month buckets) [${sumMonthBuckets}] !== month paid revenue [${expectedMonthRevenue}]`);
    }
    console.log(`  ✓ 6c: Month range returns 5 continuous weekly buckets (Week 1-5). sum(month) = Rs ${sumMonthBuckets.toFixed(2)} perfectly matches month paid revenue.`);

    // 6d: Custom range
    const resCustom = await fetch(`${BASE_URL}/api/vendor/overview?range=custom&from=2026-09-01&to=2026-09-08`, {
        headers: { Authorization: `Bearer ${vendor1Token}` },
    });
    const customData = await resCustom.json();
    if (!Array.isArray(customData.chartData) || customData.chartData.length !== 8) {
        throw new Error(`Test 6d Failed: Expected 8 daily buckets for custom range 01-08 Sep, got ${customData.chartData?.length}`);
    }
    console.log('  ✓ 6d: Custom range returns 8 continuous date buckets.');
    console.log('✓ Test 6 Passed: All time-series ranges produce correct continuous zero-filled buckets.\n');

    // Test 7: Order Types Classification
    console.log('Test 7: Order Types Classification...');
    const orderTypes = overview.orderTypes;
    if (orderTypes.totalPaidOrders !== overview.metrics.totalOrders) {
        throw new Error(`Test 7 Failed: orderTypes total (${orderTypes.totalPaidOrders}) does not match totalOrders (${overview.metrics.totalOrders})`);
    }
    if (!Array.isArray(orderTypes.items) || orderTypes.items.length !== 4) {
        throw new Error(`Test 7 Failed: Expected 4 legend items in orderTypes, got ${orderTypes.items?.length}`);
    }
    const totalPercent = orderTypes.items.reduce((s, it) => s + it.percentage, 0);
    if (orderTypes.totalPaidOrders > 0 && totalPercent !== 100) {
        throw new Error(`Test 7 Failed: Order types percentages must sum to 100, got ${totalPercent}`);
    }
    console.log('  Order Types breakdown:');
    for (const item of orderTypes.items) {
        console.log(`    ${item.label}: ${item.count} orders (${item.percentage}%) [color: ${item.color}]`);
    }
    console.log('✓ Test 7 Passed: Order types correctly classified and sum to 100%.\n');

    // Test 8: Payment Summary Verification
    console.log('Test 8: Payment Summary Verification...');
    const paymentSummary = overview.paymentSummary;
    if (typeof paymentSummary.successfulPayments !== 'number') {
        throw new Error('Test 8 Failed: successfulPayments is not a number');
    }
    if (typeof paymentSummary.upiPayments !== 'number') {
        throw new Error('Test 8 Failed: upiPayments is not a number');
    }
    if (typeof paymentSummary.refundedPayments !== 'number') {
        throw new Error('Test 8 Failed: refundedPayments is not a number');
    }
    if (paymentSummary.successfulPayments !== overview.metrics.grossSales) {
        throw new Error(`Test 8 Failed: successfulPayments (${paymentSummary.successfulPayments}) !== grossSales (${overview.metrics.grossSales})`);
    }
    if (paymentSummary.upiPayments !== 0) {
        throw new Error(`Test 8 Failed: upiPayments expected 0 (neutral due to schema gap), got ${paymentSummary.upiPayments}`);
    }
    console.log(`  Successful Payments: Rs ${paymentSummary.successfulPayments.toFixed(2)}`);
    console.log(`  UPI Payments: Rs ${paymentSummary.upiPayments.toFixed(2)} (neutral 0.00: payment_method not persisted)`);
    console.log(`  Refunded Payments: Rs ${paymentSummary.refundedPayments.toFixed(2)}`);
    console.log('✓ Test 8 Passed: Payment summary is consistent and accurate.\n');

    console.log('================================================================');
    console.log('ALL PHASE 6B VENDOR OVERVIEW ANALYTICS TESTS PASSED SUCCESSFULLY');
    console.log('================================================================');
}

runTests().catch(err => {
    console.error('\n❌ Test Suite Failed:', err);
    process.exit(1);
});

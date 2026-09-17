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
    console.log('Testing Phase 6C Final Cleanup: Customer Orders Correctness...\n');

    // 1. Static Audit: AppContext contains no mock order authority
    console.log('Test 1: AppContext mock authority audit...');
    const appContextContent = fs.readFileSync('src/context/AppContext.tsx', 'utf8');
    if (appContextContent.includes('mockOrders')) {
        throw new Error('Test 1 Failed: AppContext still imports or references mockOrders!');
    }
    const fetchFunc = appContextContent.match(/fetchCustomerOrders[\s\S]*?setOrders\(mapped\)/)?.[0];
    if (fetchFunc && fetchFunc.includes('paymentMethod:')) {
        throw new Error("Test 1 Failed: fetchCustomerOrders still fabricates paymentMethod on customer orders!");
    }
    console.log('✓ PASS: AppContext has zero mockOrders authority and does not fabricate paymentMethod on customer orders.\n');

    // 2. Unauthenticated request must fail with 401
    console.log('Test 2: Unauthenticated request rejection...');
    const unauthRes = await fetch(`${BASE_URL}/api/customer/orders`);
    if (unauthRes.status !== 401) {
        throw new Error(`Test 2 Failed: Expected 401, got ${unauthRes.status}`);
    }
    console.log('✓ PASS: Unauthenticated request rejected with 401.\n');

    // 3. Obtain Customer Token for vishvaaparthipan@gmail.com
    console.log('Test 3: Authenticated customer query for vishvaaparthipan@gmail.com...');
    const customerToken = await getAccessToken('vishvaaparthipan@gmail.com');
    const { data: { user: customerAuthUser } } = await adminClient.auth.admin.getUserById(
        (await anonClient.auth.getUser(customerToken)).data.user.id
    );

    const res = await fetch(`${BASE_URL}/api/customer/orders`, {
        headers: { Authorization: `Bearer ${customerToken}` },
    });
    if (!res.ok) {
        throw new Error(`Test 3 Failed: Expected 200, got ${res.status}: ${await res.text()}`);
    }
    const { orders } = await res.json();
    console.log(`✓ Received ${orders.length} orders for vishvaaparthipan@gmail.com`);

    // 4. Verify PAID / COMPLETED orders still appear
    console.log('Test 4: Verify PAID / COMPLETED orders appear...');
    const order100002 = orders.find(o => o.order_number === 'XS-100002');
    if (!order100002) {
        throw new Error(`Test 4 Failed: XS-100002 not found in customer orders list.`);
    }
    if (order100002.status !== 'COMPLETED' || order100002.payment_status !== 'PAID') {
        throw new Error(`Test 4 Failed: XS-100002 status is not COMPLETED/PAID: ${JSON.stringify(order100002)}`);
    }

    const order100003 = orders.find(o => o.order_number === 'XS-100003');
    if (!order100003 || order100003.status !== 'COMPLETED' || order100003.payment_status !== 'PAID') {
        throw new Error(`Test 4 Failed: XS-100003 not found or not COMPLETED/PAID.`);
    }
    console.log('✓ PASS: XS-100002 and XS-100003 verified (COMPLETED, PAID).\n');

    // 5. Verify AWAITING_PAYMENT appears correctly
    console.log('Test 5: Verify AWAITING_PAYMENT order appears...');
    const order100001 = orders.find(o => o.order_number === 'XS-100001');
    if (!order100001) {
        throw new Error('Test 5 Failed: XS-100001 not found.');
    }
    if (order100001.status !== 'AWAITING_PAYMENT' || order100001.payment_status !== 'UNPAID') {
        throw new Error(`Test 5 Failed: XS-100001 expected AWAITING_PAYMENT/UNPAID, got: ${order100001.status}/${order100001.payment_status}`);
    }
    console.log('✓ PASS: XS-100001 verified (AWAITING_PAYMENT, UNPAID).\n');

    // 6. Verify Wallet / Payment Method Isolation
    console.log('Test 6: Verify paymentMethod is NOT fabricated...');
    for (const ord of orders) {
        if (ord.paymentMethod !== undefined) {
            throw new Error(`Test 6 Failed: paymentMethod was fabricated on order ${ord.order_number}: ${ord.paymentMethod}`);
        }
    }
    console.log('✓ PASS: No fabricated paymentMethod present on customer orders.\n');

    // 7. Verify Active Unexpired DRAFT vs Expired DRAFT filtering
    console.log('Test 7: Active vs Expired DRAFT filtering...');
    const { data: shop } = await adminClient.from('shops').select('id').limit(1).single();

    // 7a. Insert active unexpired draft (expires in +2 hours)
    const { data: activeDraft, error: activeDraftErr } = await adminClient
        .from('orders')
        .insert({
            user_id: customerAuthUser.id,
            shop_id: shop.id,
            status: 'DRAFT',
            payment_status: 'UNPAID',
            expires_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
        })
        .select('id, order_number, status, expires_at')
        .single();

    if (activeDraftErr || !activeDraft) {
        throw new Error(`Failed to insert active draft: ${activeDraftErr?.message}`);
    }

    // 7b. Insert expired draft and update expires_at into the past (since trigger sets it to now() + 12h on INSERT)
    const { data: expiredDraft, error: expiredDraftErr } = await adminClient
        .from('orders')
        .insert({
            user_id: customerAuthUser.id,
            shop_id: shop.id,
            status: 'DRAFT',
            payment_status: 'UNPAID',
        })
        .select('id, order_number, status, expires_at')
        .single();

    if (expiredDraftErr || !expiredDraft) {
        throw new Error(`Failed to insert expired draft: ${expiredDraftErr?.message}`);
    }

    const { error: updateExpErr } = await adminClient
        .from('orders')
        .update({ expires_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() })
        .eq('id', expiredDraft.id);

    if (updateExpErr) {
        throw new Error(`Failed to set expired_at in past: ${updateExpErr.message}`);
    }

    try {
        const draftRes = await fetch(`${BASE_URL}/api/customer/orders`, {
            headers: { Authorization: `Bearer ${customerToken}` },
        });
        const { orders: updatedOrders } = await draftRes.json();

        const foundActive = updatedOrders.find(o => o.id === activeDraft.id);
        const foundExpired = updatedOrders.find(o => o.id === expiredDraft.id);

        if (!foundActive) {
            throw new Error('Test 7 Failed: Active unexpired DRAFT was NOT returned by /api/customer/orders!');
        }
        if (foundExpired) {
            throw new Error('Test 7 Failed: Expired DRAFT leaked into /api/customer/orders!');
        }
        console.log('✓ PASS: Active DRAFT appears, expired DRAFT is strictly excluded.\n');
    } finally {
        // Clean up test draft orders
        await adminClient.from('orders').delete().in('id', [activeDraft.id, expiredDraft.id]);
    }

    // 8. Test Customer Secure Document Download
    console.log('Test 8: Customer secure document download...');
    const fileId = order100002.order_files[0].id;
    const downloadRes = await fetch(`${BASE_URL}/api/customer/orders/${order100002.id}/files/${fileId}/download`, {
        headers: { Authorization: `Bearer ${customerToken}` },
    });
    if (!downloadRes.ok) {
        throw new Error(`Test 8 Failed: Download URL generation failed: ${downloadRes.status} ${await downloadRes.text()}`);
    }
    const downloadData = await downloadRes.json();
    if (!downloadData.downloadUrl || !downloadData.downloadUrl.includes('order-documents')) {
        throw new Error(`Test 8 Failed: Invalid download URL: ${JSON.stringify(downloadData)}`);
    }
    console.log('✓ PASS: Generated signed download URL successfully without downloading file contents in list payload.\n');

    // 9. Test Customer Isolation (Another customer cannot view or download XS-100002)
    console.log('Test 9: Cross-customer isolation...');
    const otherCustomerToken = await getAccessToken('xerservicestudent5329@gmail.com');
    const otherRes = await fetch(`${BASE_URL}/api/customer/orders`, {
        headers: { Authorization: `Bearer ${otherCustomerToken}` },
    });
    const otherData = await otherRes.json();
    const leakedOrder = otherData.orders?.find(o => o.order_number === 'XS-100002');
    if (leakedOrder) {
        throw new Error('Test 9 Failed: Data leakage! XS-100002 appeared in other customer orders.');
    }

    const unauthorizedDownload = await fetch(`${BASE_URL}/api/customer/orders/${order100002.id}/files/${fileId}/download`, {
        headers: { Authorization: `Bearer ${otherCustomerToken}` },
    });
    if (unauthorizedDownload.status !== 404 && unauthorizedDownload.status !== 403) {
        throw new Error(`Test 9 Failed: Unauthorized user was not rejected: status ${unauthorizedDownload.status}`);
    }
    console.log('✓ PASS: Cross-customer isolation strictly verified. Unauthorized user cannot access other customer orders.\n');

    console.log('All Phase 6C final cleanup tests PASSED successfully!');
}

runTests().catch(err => {
    console.error('Test script error:', err);
    process.exit(1);
});

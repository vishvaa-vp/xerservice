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
    console.log('Testing Phase 6A: Real Vendor Queue + Order Status Control...\n');

    // 1. Obtain Tokens
    const vendor1Token = await getAccessToken('xerserviceofficial@gmail.com');
    const vendor2Token = await getAccessToken('xerservicevendor@gmail.com');
    const customerToken = await getAccessToken('vishvaaparthipan@gmail.com');

    console.log('✓ Generated test JWT tokens for Vendor 1 (D-Block), Vendor 2 (No shop), and Customer.\n');

    // Test 1: XS-100002 appears in D-Block vendor queue
    const res1 = await fetch(`${BASE_URL}/api/vendor/orders`, {
        headers: { Authorization: `Bearer ${vendor1Token}` },
    });
    if (!res1.ok) {
        throw new Error(`Test 1 Failed: Expected 200, got ${res1.status}: ${await res1.text()}`);
    }
    const data1 = await res1.json();
    const targetOrder = data1.orders?.find(o => o.order_number === 'XS-100002');
    if (!targetOrder) {
        throw new Error(`Test 1 Failed: XS-100002 not found in active queue: ${JSON.stringify(data1)}`);
    }
    if (targetOrder.status !== 'QUEUED') {
        throw new Error(`Test 1 Failed: XS-100002 expected status QUEUED, got ${targetOrder.status}`);
    }
    if (targetOrder.payment_status !== 'PAID') {
        throw new Error(`Test 1 Failed: XS-100002 expected payment_status PAID, got ${targetOrder.payment_status}`);
    }
    if (!targetOrder.order_files || targetOrder.order_files.length === 0) {
        throw new Error(`Test 1 Failed: XS-100002 has no attached order_files`);
    }
    console.log(`✓ Test 1 Passed: Order ${targetOrder.order_number} appears in D-Block queue with status ${targetOrder.status} and customer "${targetOrder.customerName}"`);

    // Test 2: Another shop vendor cannot see it
    const res2 = await fetch(`${BASE_URL}/api/vendor/orders`, {
        headers: { Authorization: `Bearer ${vendor2Token}` },
    });
    // Vendor 2 has no shop assigned or different shop, should be 404 or not contain XS-100002
    if (res2.ok) {
        const data2 = await res2.json();
        const hasOrder = data2.orders?.some(o => o.order_number === 'XS-100002');
        if (hasOrder) {
            throw new Error(`Test 2 Failed: Unrelated vendor can see XS-100002!`);
        }
    } else if (res2.status !== 404 && res2.status !== 403) {
        throw new Error(`Test 2 Failed: Unexpected status ${res2.status}`);
    }
    console.log('✓ Test 2 Passed: Unrelated vendor cannot see XS-100002');

    // Test 3: Customer cannot access vendor queue API
    const res3 = await fetch(`${BASE_URL}/api/vendor/orders`, {
        headers: { Authorization: `Bearer ${customerToken}` },
    });
    if (res3.status !== 403) {
        throw new Error(`Test 3 Failed: Customer should receive 403 Forbidden, got ${res3.status}`);
    }
    console.log('✓ Test 3 Passed: Customer strictly forbidden from vendor queue API (HTTP 403)');

    // Test 4: Vendor can securely access its document
    const fileId = targetOrder.order_files[0].id;
    const res4 = await fetch(`${BASE_URL}/api/vendor/orders/${targetOrder.id}/files/${fileId}/download`, {
        headers: { Authorization: `Bearer ${vendor1Token}` },
    });
    if (!res4.ok) {
        throw new Error(`Test 4 Failed: Expected 200, got ${res4.status}: ${await res4.text()}`);
    }
    const data4 = await res4.json();
    if (!data4.signedUrl || !data4.signedUrl.includes('token=')) {
        throw new Error(`Test 4 Failed: Invalid signedUrl returned: ${JSON.stringify(data4)}`);
    }
    console.log('✓ Test 4 Passed: Vendor successfully generated temporary signed download URL for document');

    // Test 5: Other vendor and customer cannot access document
    const res5a = await fetch(`${BASE_URL}/api/vendor/orders/${targetOrder.id}/files/${fileId}/download`, {
        headers: { Authorization: `Bearer ${vendor2Token}` },
    });
    if (res5a.status !== 403 && res5a.status !== 404) {
        throw new Error(`Test 5a Failed: Unrelated vendor received status ${res5a.status} instead of 403/404`);
    }

    const res5b = await fetch(`${BASE_URL}/api/vendor/orders/${targetOrder.id}/files/${fileId}/download`, {
        headers: { Authorization: `Bearer ${customerToken}` },
    });
    if (res5b.status !== 403) {
        throw new Error(`Test 5b Failed: Customer received status ${res5b.status} instead of 403`);
    }
    console.log('✓ Test 5 Passed: Other vendor and customer strictly blocked from document download');

    // Test 6: Invalid status jumps are rejected
    const res6a = await fetch(`${BASE_URL}/api/vendor/orders/${targetOrder.id}/status`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${vendor1Token}`,
        },
        body: JSON.stringify({ expectedStatus: 'QUEUED', newStatus: 'COMPLETED' }),
    });
    if (res6a.status !== 400) {
        throw new Error(`Test 6a Failed: Illegal transition QUEUED -> COMPLETED was not rejected (status: ${res6a.status})`);
    }

    const res6b = await fetch(`${BASE_URL}/api/vendor/orders/${targetOrder.id}/status`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${vendor1Token}`,
        },
        body: JSON.stringify({ expectedStatus: 'QUEUED', newStatus: 'READY' }),
    });
    if (res6b.status !== 400) {
        throw new Error(`Test 6b Failed: Illegal transition QUEUED -> READY was not rejected (status: ${res6b.status})`);
    }
    console.log('✓ Test 6 Passed: Illegal status jumps (QUEUED -> COMPLETED, QUEUED -> READY) strictly rejected');

    // Test 7: QUEUED -> PRINTING works
    const res7 = await fetch(`${BASE_URL}/api/vendor/orders/${targetOrder.id}/status`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${vendor1Token}`,
        },
        body: JSON.stringify({ expectedStatus: 'QUEUED', newStatus: 'PRINTING' }),
    });
    if (!res7.ok) {
        throw new Error(`Test 7 Failed: QUEUED -> PRINTING failed: ${await res7.text()}`);
    }
    const data7 = await res7.json();
    if (data7.order.status !== 'PRINTING') {
        throw new Error(`Test 7 Failed: Expected status PRINTING, got ${data7.order.status}`);
    }

    // Verify in database: status and printing_started_at
    const { data: dbOrder7 } = await adminClient.from('orders').select('*').eq('id', targetOrder.id).single();
    if (dbOrder7.status !== 'PRINTING' || !dbOrder7.printing_started_at) {
        throw new Error(`Test 7 Failed: Database order status or printing_started_at not set: ${JSON.stringify(dbOrder7)}`);
    }
    console.log(`✓ Test 7 Passed: QUEUED -> PRINTING transition successful (printing_started_at: ${dbOrder7.printing_started_at})`);

    // Test 8: Status history recorded QUEUED -> PRINTING
    const { data: hist8 } = await adminClient.from('order_status_history').select('*').eq('order_id', targetOrder.id).order('created_at', { ascending: true });
    const printingHist = hist8.find(h => h.from_status === 'QUEUED' && h.to_status === 'PRINTING');
    if (!printingHist) {
        throw new Error(`Test 8 Failed: order_status_history missing QUEUED -> PRINTING row`);
    }
    console.log('✓ Test 8 Passed: order_status_history automatically recorded QUEUED -> PRINTING');

    // Test 9: Invalid jump PRINTING -> COMPLETED is rejected
    const res9 = await fetch(`${BASE_URL}/api/vendor/orders/${targetOrder.id}/status`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${vendor1Token}`,
        },
        body: JSON.stringify({ expectedStatus: 'PRINTING', newStatus: 'COMPLETED' }),
    });
    if (res9.status !== 400) {
        throw new Error(`Test 9 Failed: PRINTING -> COMPLETED was not rejected (status: ${res9.status})`);
    }
    console.log('✓ Test 9 Passed: Invalid status jump PRINTING -> COMPLETED strictly rejected');

    // Test 10: PRINTING -> READY works
    const res10 = await fetch(`${BASE_URL}/api/vendor/orders/${targetOrder.id}/status`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${vendor1Token}`,
        },
        body: JSON.stringify({ expectedStatus: 'PRINTING', newStatus: 'READY' }),
    });
    if (!res10.ok) {
        throw new Error(`Test 10 Failed: PRINTING -> READY failed: ${await res10.text()}`);
    }
    const { data: dbOrder10 } = await adminClient.from('orders').select('*').eq('id', targetOrder.id).single();
    if (dbOrder10.status !== 'READY' || !dbOrder10.ready_at) {
        throw new Error(`Test 10 Failed: Database order status or ready_at not set: ${JSON.stringify(dbOrder10)}`);
    }
    console.log(`✓ Test 10 Passed: PRINTING -> READY transition successful (ready_at: ${dbOrder10.ready_at})`);

    // Test 11: READY -> COMPLETED works
    const res11 = await fetch(`${BASE_URL}/api/vendor/orders/${targetOrder.id}/status`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${vendor1Token}`,
        },
        body: JSON.stringify({ expectedStatus: 'READY', newStatus: 'COMPLETED' }),
    });
    if (!res11.ok) {
        throw new Error(`Test 11 Failed: READY -> COMPLETED failed: ${await res11.text()}`);
    }
    const { data: dbOrder11 } = await adminClient.from('orders').select('*').eq('id', targetOrder.id).single();
    if (dbOrder11.status !== 'COMPLETED' || !dbOrder11.completed_at) {
        throw new Error(`Test 11 Failed: Database order status or completed_at not set: ${JSON.stringify(dbOrder11)}`);
    }
    console.log(`✓ Test 11 Passed: READY -> COMPLETED transition successful (completed_at: ${dbOrder11.completed_at})`);

    // Test 12: COMPLETED order disappears from active queue
    const res12 = await fetch(`${BASE_URL}/api/vendor/orders`, {
        headers: { Authorization: `Bearer ${vendor1Token}` },
    });
    const data12 = await res12.json();
    const orderStillInQueue = data12.orders?.some(o => o.id === targetOrder.id);
    if (orderStillInQueue) {
        throw new Error(`Test 12 Failed: COMPLETED order still present in active queue!`);
    }
    console.log('✓ Test 12 Passed: COMPLETED order automatically filtered out from active vendor queue');

    // Test 13: Full order status history audit trail verified
    const { data: finalHistory } = await adminClient
        .from('order_status_history')
        .select('*')
        .eq('order_id', targetOrder.id)
        .order('created_at', { ascending: true });

    console.log('\nFinal Order Status History Audit Trail:');
    for (const h of finalHistory) {
        console.log(`  - ${h.from_status || 'NULL'} -> ${h.to_status} at ${h.created_at}`);
    }

    const hasAllSteps =
        finalHistory.some(h => h.to_status === 'QUEUED') &&
        finalHistory.some(h => h.from_status === 'QUEUED' && h.to_status === 'PRINTING') &&
        finalHistory.some(h => h.from_status === 'PRINTING' && h.to_status === 'READY') &&
        finalHistory.some(h => h.from_status === 'READY' && h.to_status === 'COMPLETED');

    if (!hasAllSteps) {
        throw new Error(`Test 13 Failed: Status history missing one or more steps`);
    }
    console.log('✓ Test 13 Passed: Complete unbroken status audit history recorded in public.order_status_history');

    console.log('\nAll 13 vendor queue and status transition tests passed successfully!');
}

runTests().catch(err => {
    console.error('\nTest Suite Failed:', err);
    process.exit(1);
});

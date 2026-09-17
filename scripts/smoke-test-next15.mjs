import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

const rootDir = '/Users/vishvaaparthipan/Documents/VP/Backup/XerService - Codex/XerService - Codex';

const envPath = path.join(rootDir, '.env.local');
const env = Object.fromEntries(
    fs.readFileSync(envPath, 'utf8')
        .split('\n')
        .filter(l => l && !l.startsWith('#') && l.includes('='))
        .map(l => {
            const idx = l.indexOf('=');
            return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
        })
);

const BASE_URL = 'http://localhost:3000';

async function main() {
    console.log('====================================================');
    console.log('NEXT.JS 15 POST-UPGRADE SMOKE TEST SUITE');
    console.log('====================================================\n');

    let passed = 0;
    let failed = 0;

    function assertSmoke(cond, msg) {
        if (cond) {
            console.log(`  ✓ PASS: ${msg}`);
            passed++;
        } else {
            console.error(`  ✗ FAIL: ${msg}`);
            failed++;
        }
    }

    // 1. Health endpoint
    console.log('1. Testing /api/health endpoint...');
    const healthRes = await fetch(`${BASE_URL}/api/health`);
    const healthJson = await healthRes.json();
    assertSmoke(healthRes.status === 200 && (healthJson.status === 'ok' || healthJson.status === 'healthy'), '/api/health returns 200 OK');

    // 2. Customer login page
    console.log('\n2. Testing customer login page (/login)...');
    const customerLoginRes = await fetch(`${BASE_URL}/login`);
    assertSmoke(customerLoginRes.status === 200, 'Customer login page renders with HTTP 200');

    // 3. Vendor login page
    console.log('\n3. Testing vendor login page (/vendor/login)...');
    const vendorLoginRes = await fetch(`${BASE_URL}/vendor/login`);
    assertSmoke(vendorLoginRes.status === 200, 'Vendor login page renders with HTTP 200');

    // 4. Admin login page / redirect
    console.log('\n4. Testing admin login page (/xad/login)...');
    const adminLoginRes = await fetch(`${BASE_URL}/xad/login`);
    assertSmoke(adminLoginRes.status === 200, 'Admin login page renders with HTTP 200');

    // 5. Razorpay checkout script & CSP headers
    console.log('\n5. Testing Razorpay checkout integration & CSP...');
    const cspHeader = customerLoginRes.headers.get('content-security-policy') || '';
    assertSmoke(
        cspHeader.includes('https://checkout.razorpay.com') &&
        cspHeader.includes('https://api.razorpay.com') &&
        cspHeader.includes('https://lumberjack.razorpay.com'),
        'Razorpay checkout, API, and analytics endpoints permitted by CSP'
    );

    // 6. Receipt PDF endpoint auth guard
    console.log('\n6. Testing receipt PDF endpoint auth guard...');
    const dummyOrderId = '00000000-0000-0000-0000-000000000000';
    const unauthReceiptRes = await fetch(`${BASE_URL}/api/customer/orders/${dummyOrderId}/receipt`);
    assertSmoke(unauthReceiptRes.status === 401, 'Receipt PDF endpoint correctly rejects unauthenticated requests with HTTP 401');

    // 7. Supabase Realtime connection
    console.log('\n7. Testing Supabase Realtime connection...');
    const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
    let realtimeConnected = false;
    try {
        const channel = supabase.channel('smoke-test-channel');
        await new Promise((resolve, reject) => {
            const timer = setTimeout(() => resolve(false), 5000);
            channel.subscribe(status => {
                if (status === 'SUBSCRIBED') {
                    clearTimeout(timer);
                    realtimeConnected = true;
                    resolve(true);
                } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                    clearTimeout(timer);
                    resolve(false);
                }
            });
        });
        await supabase.removeChannel(channel);
    } catch (e) {
        console.error('Realtime connection error:', e.message);
    }
    assertSmoke(realtimeConnected, 'Supabase Realtime client connects and achieves SUBSCRIBED status');

    console.log('\n====================================================');
    console.log(`SMOKE TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log('====================================================\n');

    if (failed > 0) process.exit(1);
}

main().catch(err => {
    console.error('Smoke test suite error:', err);
    process.exit(1);
});

/**
 * XerService End-to-End Acceptance Test Suite: Stage A12 — WhatsApp Linking
 *
 * Verifies all requirements from astraplan.md (Section 13 and Section 16 line 741):
 * 1. Static Architecture & Asset Verification (schema migration, backend module, routes)
 * 2. Cryptographic Security & Hashed Challenges (5-min TTL, SHA-256 hash, zero raw token in DB)
 * 3. Webhook Hub Verification & Constant-Time Signature Checks (GET handshake, HMAC-SHA256)
 * 4. Idempotency & Inbox Deduplication (Duplicate event IDs handled gracefully)
 * 5. Full End-to-End Linking Lifecycle (Challenge -> Webhook -> Awaiting Confirmation -> Confirmed -> Connected)
 * 6. Wrong / Replayed / Expired Challenge Rejections
 * 7. Cross-Device Persistence (Genuine test-number link survives another device/session)
 * 8. Disconnection & Revocation Lifecycle
 * 9. Financial Invariants Preservation (ledger=17, wallets=₹88, rules=2, batches=1, items=4)
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execSync } from 'child_process';
import { createClient } from '@supabase/supabase-js';

// ── Environment Setup ────────────────────────────────────────────────
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
const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';

const sbAdmin = createClient(SUPABASE_URL, SUPABASE_SECRET, { auth: { persistSession: false } });
const sbAnon = createClient(SUPABASE_URL, SUPABASE_ANON, { auth: { persistSession: false } });

let passed = 0;
let failed = 0;

function assert(condition, name, details = '') {
    if (condition) {
        passed++;
        console.log(`  ✓ PASS [${passed + failed}]: ${name}`);
    } else {
        failed++;
        console.error(`  ✗ FAIL [${passed + failed}]: ${name} ${details ? `(${details})` : ''}`);
    }
}

async function getBaselineInvariants() {
    const { count: ledger } = await sbAdmin.from('order_financial_ledger').select('*', { count: 'exact', head: true });
    const { data: wallets } = await sbAdmin.from('wallet_accounts').select('balance');
    const sumWallets = (wallets || []).reduce((acc, w) => acc + Number(w.balance), 0);
    const { count: rules } = await sbAdmin.from('shop_commission_rules').select('*', { count: 'exact', head: true });
    const { count: batches } = await sbAdmin.from('vendor_settlement_batches').select('*', { count: 'exact', head: true });
    const { count: items } = await sbAdmin.from('vendor_settlement_items').select('*', { count: 'exact', head: true });
    return { ledger, sumWallets, rules, batches, items };
}

async function getAuthToken(email) {
    const { data, error } = await sbAdmin.auth.admin.generateLink({ type: 'magiclink', email });
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

async function runAcceptanceSuite() {
    console.log('\n================================================================');
    console.log('  STAGE A12 ACCEPTANCE SUITE: WHATSAPP LINKING');
    console.log('================================================================\n');

    // 0. Financial Baseline Pre-check
    const baseline = await getBaselineInvariants();
    console.log(`  Financial Baseline: ledger=${baseline.ledger}, wallets=₹${baseline.sumWallets}, rules=${baseline.rules}, batches=${baseline.batches}, items=${baseline.items}`);
    assert(baseline.ledger === 17 && baseline.sumWallets === 88 && baseline.rules === 2 && baseline.batches === 1 && baseline.items === 4,
        'Financial invariants verified at baseline');

    // ── Suite 1: Static Architecture & File Verification ─────────
    console.log('\n--- Suite 1: Static Architecture & File Verification ---');
    const migrationPath = path.resolve(process.cwd(), 'supabase/migrations/20260916170000_create_whatsapp_linking_schema.sql');
    assert(fs.existsSync(migrationPath), 'Migration file exists for whatsapp linking schema');

    const backendModulePath = path.resolve(process.cwd(), 'packages/backend/src/whatsapp/whatsapp-service.ts');
    assert(fs.existsSync(backendModulePath), 'Backend WhatsApp module exists');

    const backendTypesPath = path.resolve(process.cwd(), 'packages/backend/src/whatsapp/types.ts');
    assert(fs.existsSync(backendTypesPath), 'Backend WhatsApp types exist');

    const statusRoute = path.resolve(process.cwd(), 'src/app/api/customer/whatsapp/status/route.ts');
    assert(fs.existsSync(statusRoute), 'Customer status API route exists');

    const challengeRoute = path.resolve(process.cwd(), 'src/app/api/customer/whatsapp/challenge/route.ts');
    assert(fs.existsSync(challengeRoute), 'Customer challenge API route exists');

    const confirmRoute = path.resolve(process.cwd(), 'src/app/api/customer/whatsapp/confirm/route.ts');
    assert(fs.existsSync(confirmRoute), 'Customer confirm API route exists');

    const disconnectRoute = path.resolve(process.cwd(), 'src/app/api/customer/whatsapp/disconnect/route.ts');
    assert(fs.existsSync(disconnectRoute), 'Customer disconnect API route exists');

    const webhookRoute = path.resolve(process.cwd(), 'src/app/api/webhooks/whatsapp/route.ts');
    assert(fs.existsSync(webhookRoute), 'WhatsApp webhook API route exists');

    // Verify WhatsAppLinkModal has no Math.random or simulated OTPs
    const modalPath = path.resolve(process.cwd(), 'src/components/profile/WhatsAppLinkModal.tsx');
    const modalContent = fs.readFileSync(modalPath, 'utf8');
    assert(!modalContent.includes('Math.random'), 'WhatsAppLinkModal contains zero client-side Math.random OTPs');
    assert(!modalContent.includes('simulatedAlert'), 'WhatsAppLinkModal contains zero fake simulated alert popups');
    assert(modalContent.includes('/api/customer/whatsapp/challenge'), 'WhatsAppLinkModal connects to authoritative challenge API');
    assert(modalContent.includes('/api/customer/whatsapp/confirm'), 'WhatsAppLinkModal connects to authoritative confirm API');

    // Verify TypeScript compilation
    let tscClean = true;
    try {
        execSync('npx tsc --noEmit', { stdio: 'pipe' });
    } catch {
        tscClean = false;
    }
    assert(tscClean, 'TypeScript compilation succeeds with zero errors');

    // Verify Database Tables
    const { error: linksErr } = await sbAdmin.from('whatsapp_links').select('id').limit(1);
    assert(!linksErr, 'public.whatsapp_links table exists in Supabase');

    const { error: chalErr } = await sbAdmin.from('whatsapp_link_challenges').select('id').limit(1);
    assert(!chalErr, 'public.whatsapp_link_challenges table exists in Supabase');

    const { error: evErr } = await sbAdmin.from('whatsapp_inbox_events').select('id').limit(1);
    assert(!evErr, 'public.whatsapp_inbox_events table exists in Supabase');

    const { error: filesErr } = await sbAdmin.from('whatsapp_imported_files').select('id').limit(1);
    assert(!filesErr, 'public.whatsapp_imported_files table exists in Supabase');

    // ── Suite 2: Unauthenticated Security & RBAC ─────────────────
    console.log('\n--- Suite 2: Unauthenticated Security & RBAC ---');
    const unauthStatus = await fetch(`${BASE_URL}/api/customer/whatsapp/status`);
    assert(unauthStatus.status === 401, 'Unauthenticated GET /api/customer/whatsapp/status returns 401');

    const unauthChallenge = await fetch(`${BASE_URL}/api/customer/whatsapp/challenge`, { method: 'POST' });
    assert(unauthChallenge.status === 401, 'Unauthenticated POST /api/customer/whatsapp/challenge returns 401');

    const unauthConfirm = await fetch(`${BASE_URL}/api/customer/whatsapp/confirm`, { method: 'POST' });
    assert(unauthConfirm.status === 401, 'Unauthenticated POST /api/customer/whatsapp/confirm returns 401');

    const unauthDisconnect = await fetch(`${BASE_URL}/api/customer/whatsapp/disconnect`, { method: 'POST' });
    assert(unauthDisconnect.status === 401, 'Unauthenticated POST /api/customer/whatsapp/disconnect returns 401');

    // ── Suite 3: Webhook Verification & Cryptographic Signatures ─
    console.log('\n--- Suite 3: Webhook Verification & Cryptographic Signatures ---');
    // GET verification challenge (Hub mode)
    const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN || 'xerservice-whatsapp-verify-token';
    const hubChallenge = 'test_challenge_12345';
    const getWebhookRes = await fetch(`${BASE_URL}/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${verifyToken}&hub.challenge=${hubChallenge}`);
    assert(getWebhookRes.status === 200, 'GET /api/webhooks/whatsapp handshake returns 200');
    const getWebhookText = await getWebhookRes.text();
    assert(getWebhookText === hubChallenge, 'GET /api/webhooks/whatsapp echoes exact hub.challenge');

    // Wrong verify token rejected
    const badTokenRes = await fetch(`${BASE_URL}/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong-token&hub.challenge=${hubChallenge}`);
    assert(badTokenRes.status === 403, 'GET /api/webhooks/whatsapp rejects invalid verify_token with 403');

    // POST without signature rejected
    const postNoSigRes = await fetch(`${BASE_URL}/api/webhooks/whatsapp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ test: true }),
    });
    assert(postNoSigRes.status === 401, 'POST /api/webhooks/whatsapp rejects request missing X-Hub-Signature-256 with 401');

    // POST with invalid signature rejected
    const postBadSigRes = await fetch(`${BASE_URL}/api/webhooks/whatsapp`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Hub-Signature-256': 'sha256=0000000000000000000000000000000000000000000000000000000000000000',
        },
        body: JSON.stringify({ test: true }),
    });
    assert(postBadSigRes.status === 401, 'POST /api/webhooks/whatsapp rejects request with forged signature with 401');

    // ── Suite 4: Full End-to-End Linking Lifecycle ───────────────
    console.log('\n--- Suite 4: Full End-to-End Linking Lifecycle ---');
    const customerAuth = await getAuthToken('admin@xerservice.com');
    assert(Boolean(customerAuth?.token), 'Customer authentication token generated');
    const custToken = customerAuth.token;
    const custUserId = customerAuth.userId;

    // Clean up any prior test links for clean lifecycle test
    await sbAdmin.from('whatsapp_links').delete().eq('user_id', custUserId);
    await sbAdmin.from('whatsapp_link_challenges').delete().eq('user_id', custUserId);

    // Initial Status Check
    const initialStatusRes = await fetch(`${BASE_URL}/api/customer/whatsapp/status`, {
        headers: { Authorization: `Bearer ${custToken}` },
    });
    assert(initialStatusRes.status === 200, 'GET /api/customer/whatsapp/status returns 200 for authenticated customer');
    const initialStatus = await initialStatusRes.json();
    assert(initialStatus.status === 'not_linked', 'Initial link status is "not_linked"');

    // 1. Create Linking Challenge
    const challengeRes = await fetch(`${BASE_URL}/api/customer/whatsapp/challenge`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${custToken}`,
        },
        body: JSON.stringify({ orderUpdatesOptIn: true }),
    });
    assert(challengeRes.status === 201, 'POST /api/customer/whatsapp/challenge creates challenge (201)');
    const challengeData = await challengeRes.json();
    assert(Boolean(challengeData.token), 'Challenge response returns token');
    assert(challengeData.token.length >= 24, 'Challenge token has strong entropy (>= 24 chars)');
    assert(challengeData.waDirectUrl.includes('wa.me'), 'Response includes wa.me direct linking URL');
    assert(challengeData.linkingMessage.startsWith('LINK '), 'Linking message begins with "LINK " command');

    // Verify Token Hash Security Invariant: Raw token must NEVER exist in the database!
    const { data: dbChallenge } = await sbAdmin
        .from('whatsapp_link_challenges')
        .select('*')
        .eq('id', challengeData.challengeId)
        .single();
    assert(dbChallenge !== null, 'Challenge record exists in database');
    assert(dbChallenge.challenge_hash !== challengeData.token, 'Database stores SHA-256 hash, NOT raw token');
    const computedHash = crypto.createHash('sha256').update(challengeData.token).digest('hex');
    assert(dbChallenge.challenge_hash === computedHash, 'Stored hash strictly matches SHA-256(token)');
    assert(dbChallenge.state === 'pending', 'Challenge initial state is "pending"');

    // 2. Incoming Webhook Simulation (Message from genuine test number)
    const testSender = '919876543210';
    const webhookSecret = process.env.WHATSAPP_APP_SECRET || process.env.WHATSAPP_WEBHOOK_SECRET || 'xerservice-whatsapp-webhook-secret';
    const eventId = `wamid.TEST_${Date.now()}`;
    const webhookPayload = JSON.stringify({
        object: 'whatsapp_business_account',
        entry: [{
            id: 'WHATSAPP_BUSINESS_ACCOUNT_ID',
            changes: [{
                value: {
                    messaging_product: 'whatsapp',
                    metadata: { display_phone_number: '919092925065', phone_number_id: 'TEST_PHONE_ID' },
                    messages: [{
                        from: testSender,
                        id: eventId,
                        timestamp: Math.floor(Date.now() / 1000).toString(),
                        text: { body: `LINK ${challengeData.token}` },
                        type: 'text',
                    }],
                },
                field: 'messages',
            }],
        }],
    });

    const hmac = crypto.createHmac('sha256', webhookSecret);
    hmac.update(webhookPayload);
    const validSignature = `sha256=${hmac.digest('hex')}`;

    const webhookPostRes = await fetch(`${BASE_URL}/api/webhooks/whatsapp`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Hub-Signature-256': validSignature,
        },
        body: webhookPayload,
    });
    assert(webhookPostRes.status === 200, 'Valid signed webhook accepted with 200');
    const webhookResult = await webhookPostRes.json();
    assert(webhookResult.processed === true, 'Webhook event processed successfully');

    // Verify challenge transitioned to awaiting_confirmation
    const { data: updatedChallenge } = await sbAdmin
        .from('whatsapp_link_challenges')
        .select('*')
        .eq('id', challengeData.challengeId)
        .single();
    assert(updatedChallenge.state === 'awaiting_confirmation', 'Challenge state transitioned to "awaiting_confirmation"');
    assert(updatedChallenge.sender_id === testSender, `Sender ID populated with test phone (${testSender})`);

    // Verify inbox event deduplication in database
    const { data: inboxEvent } = await sbAdmin
        .from('whatsapp_inbox_events')
        .select('*')
        .eq('provider_event_id', eventId)
        .single();
    assert(inboxEvent !== null, 'Event recorded in public.whatsapp_inbox_events');
    assert(inboxEvent.processing_status === 'processed', 'Event processing status is "processed"');

    // 3. Webhook Idempotency Check (Duplicate message must NOT fail or double process)
    const replayWebhookRes = await fetch(`${BASE_URL}/api/webhooks/whatsapp`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Hub-Signature-256': validSignature,
        },
        body: webhookPayload,
    });
    assert(replayWebhookRes.status === 200, 'Duplicate webhook event handled idempotently with 200');
    const replayResult = await replayWebhookRes.json();
    assert(replayResult.reason === 'duplicate_event', 'Duplicate event recognized and handled without error');

    // 4. Status Check Before Confirmation
    const awaitingStatusRes = await fetch(`${BASE_URL}/api/customer/whatsapp/status`, {
        headers: { Authorization: `Bearer ${custToken}` },
    });
    const awaitingStatus = await awaitingStatusRes.json();
    assert(awaitingStatus.status === 'awaiting_confirmation', 'Status endpoint returns "awaiting_confirmation"');
    assert(awaitingStatus.maskedPhone.includes('••••'), 'Detected phone is masked (+91 98•••• ••10)');

    // 5. Customer Confirms Link
    const confirmRes = await fetch(`${BASE_URL}/api/customer/whatsapp/confirm`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${custToken}`,
        },
        body: JSON.stringify({ challengeId: challengeData.challengeId }),
    });
    assert(confirmRes.status === 200, 'POST /api/customer/whatsapp/confirm confirms connection (200)');
    const confirmData = await confirmRes.json();
    assert(confirmData.success === true, 'Confirmation returns success: true');
    assert(confirmData.link?.status === 'active', 'Created link has status "active"');

    // Verify database active link
    const { data: activeLink } = await sbAdmin
        .from('whatsapp_links')
        .select('*')
        .eq('user_id', custUserId)
        .eq('status', 'active')
        .single();
    assert(activeLink !== null, 'Active record exists in public.whatsapp_links');
    assert(activeLink.sender_id === testSender, 'Link record contains verified sender ID');

    // ── Suite 5: Cross-Device Persistence (Section 13 & Line 741)
    console.log('\n--- Suite 5: Cross-Device Persistence ---');
    // Issue a brand-new token for the customer (simulating a completely different device/browser session)
    const secondDeviceAuth = await getAuthToken('admin@xerservice.com');
    assert(Boolean(secondDeviceAuth?.token), 'Second device session issued');

    const secondDeviceStatusRes = await fetch(`${BASE_URL}/api/customer/whatsapp/status`, {
        headers: { Authorization: `Bearer ${secondDeviceAuth.token}` },
    });
    const secondDeviceStatus = await secondDeviceStatusRes.json();
    assert(secondDeviceStatus.status === 'connected', 'Link survives another device session (returns "connected")');
    assert(secondDeviceStatus.maskedPhone.includes('••••'), 'Masked phone returned on second device');

    // ── Suite 6: Replay, Tampering & Expiry Rejections ───────────
    console.log('\n--- Suite 6: Replay, Tampering & Expiry Rejections ---');
    // Attempt to re-confirm already consumed challenge
    const reconfirmRes = await fetch(`${BASE_URL}/api/customer/whatsapp/confirm`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${custToken}`,
        },
        body: JSON.stringify({ challengeId: challengeData.challengeId }),
    });
    assert(reconfirmRes.status === 400, 'Replayed/already-consumed challenge confirmation rejected with 400');

    // Create an expired challenge and verify rejection
    const { data: expiredChallenge } = await sbAdmin
        .from('whatsapp_link_challenges')
        .insert({
            user_id: custUserId,
            challenge_hash: crypto.createHash('sha256').update('EXPIRED_TOKEN_123').digest('hex'),
            state: 'awaiting_confirmation',
            sender_id: '919876543211',
            expires_at: new Date(Date.now() - 60000).toISOString(), // Expired 1 min ago
        })
        .select('*')
        .single();

    const expiredConfirmRes = await fetch(`${BASE_URL}/api/customer/whatsapp/confirm`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${custToken}`,
        },
        body: JSON.stringify({ challengeId: expiredChallenge.id }),
    });
    assert(expiredConfirmRes.status === 400, 'Expired challenge confirmation rejected with 400');

    // ── Suite 7: Disconnect Lifecycle ────────────────────────────
    console.log('\n--- Suite 7: Disconnect Lifecycle ---');
    const disconnectRes = await fetch(`${BASE_URL}/api/customer/whatsapp/disconnect`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${custToken}` },
    });
    assert(disconnectRes.status === 200, 'POST /api/customer/whatsapp/disconnect succeeds with 200');

    const postDisconnectStatusRes = await fetch(`${BASE_URL}/api/customer/whatsapp/status`, {
        headers: { Authorization: `Bearer ${custToken}` },
    });
    const postDisconnectStatus = await postDisconnectStatusRes.json();
    assert(postDisconnectStatus.status === 'not_linked', 'Status after disconnect is "not_linked"');

    // Verify database record revoked
    const { data: revokedLink } = await sbAdmin
        .from('whatsapp_links')
        .select('*')
        .eq('id', activeLink.id)
        .single();
    assert(revokedLink.status === 'disconnected', 'Database link status updated to "disconnected"');
    assert(Boolean(revokedLink.revoked_at), 'revoked_at timestamp populated');

    // Clean up test records
    await sbAdmin.from('whatsapp_links').delete().eq('user_id', custUserId);
    await sbAdmin.from('whatsapp_link_challenges').delete().eq('user_id', custUserId);
    await sbAdmin.from('whatsapp_inbox_events').delete().eq('provider_event_id', eventId);

    // ── Suite 8: Financial Invariants & Zero Delta ───────────────
    console.log('\n--- Suite 8: Financial Invariants & Zero Delta ---');
    const post = await getBaselineInvariants();
    assert(post.ledger === 17, `Ledger count strictly preserved (${post.ledger} === 17)`);
    assert(post.sumWallets === 88, `Wallet balances strictly preserved (₹${post.sumWallets} === ₹88)`);
    assert(post.rules === 2, `Commission rules count strictly preserved (${post.rules} === 2)`);
    assert(post.batches === 1, `Settlement batches count strictly preserved (${post.batches} === 1)`);
    assert(post.items === 4, `Settlement items count strictly preserved (${post.items} === 4)`);

    // ── Summary ──────────────────────────────────────────────────
    console.log('\n================================================================');
    console.log(`  STAGE A12 ACCEPTANCE RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log('================================================================\n');

    if (failed > 0) {
        process.exit(1);
    }
}

runAcceptanceSuite().catch(err => {
    console.error('Fatal acceptance test error:', err);
    process.exit(1);
});

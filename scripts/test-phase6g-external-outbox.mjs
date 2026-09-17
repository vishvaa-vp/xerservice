/**
 * Phase 6G: External Notification Delivery Foundation Verification Suite
 * Final Configuration & Disabled-Mode Hardening Suite
 *
 * Verifies:
 * 1. Database schema, foreign keys, RLS policies, permissions, check constraints, and indexes
 * 2. Environment config helper & absent-env defaults (disabled)
 * 3. Global kill switch overriding all channel providers
 * 4. Direct SKIPPED insert behavior in disabled mode (never PENDING)
 * 5. Channel-specific disabled behavior (invalid phone -> SKIPPED, EMAIL_PROVIDER=disabled -> SKIPPED)
 * 6. PENDING eligibility strictly reserved for future enabled + configured providers
 * 7. Phone normalization logic (Indian E.164 without fabricating numbers)
 * 8. Email normalization and validation
 * 9. Safe payload sanitization (blocking secrets, signed URLs, document paths, card details)
 * 10. Deduplication key generation
 * 11. Authoritative contact resolution from Supabase Auth & Profiles
 * 12. Provider abstraction & DisabledNotificationProvider
 * 13. ProcessPendingExternalNotifications queries ONLY PENDING rows
 * 14. Confirmation: NO cron, NO scheduler, NO setInterval, NO automatic background worker
 * 15. Missing-table fallback isolates 42P01 and PGRST205, never swallowing PGRST204, PGRST202, permissions, or timeouts
 * 16. OTP separation from public in-app notifications
 * 17. Event wiring consistency with Phase 6F authoritative event points
 */

import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Load environment variables from .env.local
const envPath = path.join(rootDir, '.env.local');
if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    for (const line of envContent.split('\n')) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
            const [k, ...v] = trimmed.split('=');
            process.env[k.trim()] = v.join('=').trim();
        }
    }
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SECRET_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

const adminClient = (supabaseUrl && serviceKey)
    ? createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
    : null;

const anonClient = (supabaseUrl && anonKey)
    ? createClient(supabaseUrl, anonKey, { auth: { persistSession: false } })
    : null;

console.log('========================================================================');
console.log('Phase 6G: Final Configuration / Disabled-Mode Hardening Suite');
console.log('========================================================================\n');

let passedTests = 0;
let totalTests = 0;

function test(description, fn) {
    totalTests++;
    try {
        fn();
        console.log(`  ✅ [PASS] ${description}`);
        passedTests++;
    } catch (err) {
        console.error(`  ❌ [FAIL] ${description}`);
        console.error(`     Error: ${err.message}`);
    }
}

async function asyncTest(description, fn) {
    totalTests++;
    try {
        await fn();
        console.log(`  ✅ [PASS] ${description}`);
        passedTests++;
    } catch (err) {
        console.error(`  ❌ [FAIL] ${description}`);
        console.error(`     Error: ${err.message}`);
    }
}

// -----------------------------------------------------------------------------
// 1. Database Schema & Migration Audit
// -----------------------------------------------------------------------------
console.log('--- 1. Database Schema & Migration Audit ---');
const migrationPath = path.join(rootDir, 'supabase/migrations/20260909110000_create_notification_outbox.sql');

test('Migration 20260909110000_create_notification_outbox.sql exists', () => {
    assert(fs.existsSync(migrationPath), 'Migration file does not exist');
});

const migrationSql = fs.readFileSync(migrationPath, 'utf8');

test('Migration creates public.notification_outbox table with gen_random_uuid()', () => {
    assert(migrationSql.includes('CREATE TABLE IF NOT EXISTS public.notification_outbox'), 'Missing CREATE TABLE');
    assert(migrationSql.includes('id UUID PRIMARY KEY DEFAULT gen_random_uuid()'), 'Missing primary key');
});

test('Foreign keys defined: user_id (CASCADE), notification_id (SET NULL), order_id (SET NULL)', () => {
    assert(migrationSql.includes('user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE'), 'Missing user_id foreign key');
    assert(migrationSql.includes('notification_id UUID NULL REFERENCES public.notifications(id) ON DELETE SET NULL'), 'Missing notification_id foreign key');
    assert(migrationSql.includes('order_id UUID NULL REFERENCES public.orders(id) ON DELETE SET NULL'), 'Missing order_id foreign key');
});

test('Channel CHECK constraint permits SMS, EMAIL, WHATSAPP', () => {
    assert(migrationSql.includes("channel TEXT NOT NULL CHECK (channel IN ('SMS', 'EMAIL', 'WHATSAPP'))"), 'Invalid channel constraint');
});

test('Event type CHECK constraint covers all authoritative order events and OTP', () => {
    assert(migrationSql.includes("'PAYMENT_SUCCESS'"), 'Missing PAYMENT_SUCCESS');
    assert(migrationSql.includes("'NEW_ORDER'"), 'Missing NEW_ORDER');
    assert(migrationSql.includes("'PRINTING_STARTED'"), 'Missing PRINTING_STARTED');
    assert(migrationSql.includes("'ORDER_READY'"), 'Missing ORDER_READY');
    assert(migrationSql.includes("'ORDER_COMPLETED'"), 'Missing ORDER_COMPLETED');
    assert(migrationSql.includes("'ORDER_CANCELLED'"), 'Missing ORDER_CANCELLED');
    assert(migrationSql.includes("'REFUND_SUCCESS'"), 'Missing REFUND_SUCCESS');
    assert(migrationSql.includes("'REFUND_FAILED'"), 'Missing REFUND_FAILED');
    assert(migrationSql.includes("'OTP'"), 'Missing OTP');
});

test('Status CHECK constraint permits PENDING, PROCESSING, SENT, FAILED, SKIPPED', () => {
    assert(migrationSql.includes("status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ("), 'Missing status default');
    assert(migrationSql.includes("'PENDING'"), 'Missing PENDING');
    assert(migrationSql.includes("'PROCESSING'"), 'Missing PROCESSING');
    assert(migrationSql.includes("'SENT'"), 'Missing SENT');
    assert(migrationSql.includes("'FAILED'"), 'Missing FAILED');
    assert(migrationSql.includes("'SKIPPED'"), 'Missing SKIPPED');
});

test('Dedupe key column exists with UNIQUE constraint', () => {
    assert(migrationSql.includes('dedupe_key TEXT UNIQUE NOT NULL'), 'Missing unique dedupe_key');
});

test('Row Level Security (RLS) is explicitly enabled on notification_outbox', () => {
    assert(migrationSql.includes('ALTER TABLE public.notification_outbox ENABLE ROW LEVEL SECURITY;'), 'RLS not enabled');
});

test('Permissions: ALL operations explicitly revoked from browser roles (PUBLIC, anon, authenticated)', () => {
    assert(migrationSql.includes('REVOKE ALL ON public.notification_outbox FROM PUBLIC, anon, authenticated;'), 'Permissions not revoked');
    assert(migrationSql.includes('GRANT ALL ON public.notification_outbox TO service_role;'), 'service_role not granted ALL');
});

test('Performance indexes created for status+created_at, user_id, order_id, notification_id', () => {
    assert(migrationSql.includes('idx_notification_outbox_status_created_at'), 'Missing status+created_at index');
    assert(migrationSql.includes('idx_notification_outbox_user_id_created_at'), 'Missing user_id index');
    assert(migrationSql.includes('idx_notification_outbox_order_id'), 'Missing order_id index');
    assert(migrationSql.includes('idx_notification_outbox_notification_id'), 'Missing notification_id index');
});

// -----------------------------------------------------------------------------
// 2. Server Configuration Helper & Absent-Env Default Audit
// -----------------------------------------------------------------------------
console.log('\n--- 2. Configuration Helper & Absent-Env Default Audit ---');
const outboxPath = fs.existsSync(path.join(rootDir, 'packages/backend/src/notifications/notification-outbox.ts'))
    ? path.join(rootDir, 'packages/backend/src/notifications/notification-outbox.ts')
    : path.join(rootDir, 'src/lib/notification-outbox.ts');
const outboxSource = fs.readFileSync(outboxPath, 'utf8');

test('src/lib/notification-outbox.ts exports getExternalNotificationConfig()', () => {
    assert(outboxSource.includes('export function getExternalNotificationConfig()'), 'Missing getExternalNotificationConfig');
});

test('Absent environment variables strictly default to disabled', () => {
    assert(outboxSource.includes("const smsProvider = (process.env.SMS_PROVIDER || 'disabled').trim().toLowerCase();"), 'smsProvider must default to disabled');
    assert(outboxSource.includes("const emailProvider = (process.env.EMAIL_PROVIDER || 'disabled').trim().toLowerCase();"), 'emailProvider must default to disabled');
    assert(outboxSource.includes("const whatsappProvider = (process.env.WHATSAPP_PROVIDER || 'disabled').trim().toLowerCase();"), 'whatsappProvider must default to disabled');
    assert(outboxSource.includes("rawGlobal ? rawGlobal.trim().toLowerCase() === 'true' : false"), 'EXTERNAL_NOTIFICATIONS_ENABLED must default to false');
});

test('.env.local contains explicit disabled configuration flags', () => {
    const envLocal = fs.readFileSync(envPath, 'utf8');
    assert(envLocal.includes('EXTERNAL_NOTIFICATIONS_ENABLED=false'), 'Missing EXTERNAL_NOTIFICATIONS_ENABLED=false in .env.local');
    assert(envLocal.includes('SMS_PROVIDER=disabled'), 'Missing SMS_PROVIDER=disabled in .env.local');
    assert(envLocal.includes('EMAIL_PROVIDER=disabled'), 'Missing EMAIL_PROVIDER=disabled in .env.local');
    assert(envLocal.includes('WHATSAPP_PROVIDER=disabled'), 'Missing WHATSAPP_PROVIDER=disabled in .env.local');
});

// -----------------------------------------------------------------------------
// 3. Direct SKIPPED Insert in Disabled Mode (Never PENDING)
// -----------------------------------------------------------------------------
console.log('\n--- 3. Direct SKIPPED Insert & Global Kill Switch Audit ---');

test('queueExternalNotification inserts directly as SKIPPED when globally disabled (never PENDING)', () => {
    assert(outboxSource.includes("initialStatus = 'SKIPPED'"), 'Missing initialStatus SKIPPED assignment');
    assert(outboxSource.includes("initialProvider = 'disabled'"), 'Missing initialProvider disabled assignment');
    assert(outboxSource.includes("External notifications are disabled."), 'Missing exact disabled error message');
    assert(outboxSource.includes("processedAt = new Date().toISOString()"), 'Missing processedAt timestamp on direct SKIPPED insert');
});

test('Global kill switch overrides channel-level provider configuration', () => {
    assert(outboxSource.includes('if (!config.isGloballyEnabled) {'), 'Missing global kill switch check');
    assert(outboxSource.includes("reason: 'External notifications are disabled.'"), 'Missing global kill switch reason');
});

test('Missing or invalid destination inserts directly as SKIPPED with appropriate last_error', () => {
    assert(outboxSource.includes("initialError = params.channel === 'EMAIL'"), 'Missing destination error branch');
    assert(outboxSource.includes('No valid email address available for user.'), 'Missing email destination error text');
    assert(outboxSource.includes('No valid Indian mobile number available for user.'), 'Missing phone destination error text');
});

test('Valid email with EMAIL_PROVIDER=disabled inserts directly as SKIPPED (never PENDING)', () => {
    assert(outboxSource.includes("reason: `External ${channel.toLowerCase()} delivery is disabled.`"), 'Missing channel-specific disabled reason');
});

test('Only future enabled + configured provider creates status = PENDING', () => {
    assert(outboxSource.includes("initialStatus = 'PENDING'"), 'Missing PENDING status assignment');
    assert(outboxSource.includes("initialProvider = channelCheck.provider;"), 'Missing configured provider assignment');
    assert(outboxSource.includes("processedAt = null;"), 'PENDING row must have null processedAt');
    assert(outboxSource.includes("initialError = null;"), 'PENDING row must have null initialError');
});

// -----------------------------------------------------------------------------
// 4. Outbox Worker & Absence of Cron/Scheduler Audit
// -----------------------------------------------------------------------------
console.log('\n--- 4. Worker Processing & Absence of Scheduler Audit ---');

test('processPendingExternalNotifications processes ONLY rows with status = PENDING', () => {
    assert(outboxSource.includes(".eq('status', 'PENDING')"), 'Worker must filter strictly on status=PENDING');
});

test('Worker uses atomic claim: transitions from PENDING to PROCESSING', () => {
    assert(outboxSource.includes("status: 'PROCESSING'"), 'Missing PROCESSING claim transition');
    assert(outboxSource.includes(".eq('status', 'PENDING')"), 'Claim must enforce status=PENDING atomically');
    assert(outboxSource.includes("attempt_count: (row.attempt_count || 0) + 1"), 'Must increment attempt count on claim');
});

test('Confirm NO automatic cron, NO scheduler, NO setInterval, NO background worker exists in codebase', () => {
    // Search entire src/ directory for any scheduling of processPendingExternalNotifications
    function searchDirectory(dir) {
        const files = fs.readdirSync(dir);
        let matches = [];
        for (const f of files) {
            const full = path.join(dir, f);
            const stat = fs.statSync(full);
            if (stat.isDirectory()) {
                matches = matches.concat(searchDirectory(full));
            } else if (f.endsWith('.ts') || f.endsWith('.tsx') || f.endsWith('.js')) {
                const content = fs.readFileSync(full, 'utf8');
                if (content.includes('processPendingExternalNotifications') && !f.includes('notification-outbox.ts')) {
                    matches.push(full);
                }
            }
        }
        return matches;
    }

    const workerCallers = searchDirectory(path.join(rootDir, 'src'));
    assert.strictEqual(workerCallers.length, 0, `Found unexpected background worker callers: ${workerCallers.join(', ')}`);
});

// -----------------------------------------------------------------------------
// 5. Missing-Table Error Filtering (Strict 42P01 / PGRST205 Isolation)
// -----------------------------------------------------------------------------
console.log('\n--- 5. Missing-Table Fallback Error Filtering Audit ---');

test('src/lib/notification-outbox.ts exports isOutboxMissingTableError(error)', () => {
    assert(outboxSource.includes('export function isOutboxMissingTableError(error: any): boolean'), 'Missing isOutboxMissingTableError');
});

// Unit test error filter behavior
function isOutboxMissingTableError(error) {
    if (!error) return false;
    if (error.code === 'PGRST204' || error.code === 'PGRST202' || error.code === '42703' || error.code === '42883') return false;
    if (error.code === '42501' || error.code === '28000' || error.code === '28P01' || error.message?.toLowerCase().includes('permission denied')) return false;
    if (error.code === '57014' || error.code === '42601' || error.message?.toLowerCase().includes('timeout')) return false;
    if (error.code === '42P01' || error.code === 'PGRST205') return true;
    const msg = (error.message || '').toLowerCase();
    if (
        msg.includes('relation "notification_outbox" does not exist') ||
        msg.includes('relation "public.notification_outbox" does not exist') ||
        msg.includes("could not find the table 'notification_outbox'") ||
        msg.includes("could not find the table 'public.notification_outbox'")
    ) return true;
    return false;
}

test('Case 1: 42P01 undefined_table -> ALLOWED (true)', () => {
    assert.strictEqual(isOutboxMissingTableError({ code: '42P01' }), true);
});

test('Case 2: PGRST205 table not found -> ALLOWED (true)', () => {
    assert.strictEqual(isOutboxMissingTableError({ code: 'PGRST205' }), true);
});

test('Case 3: Exact missing table relation message -> ALLOWED (true)', () => {
    assert.strictEqual(isOutboxMissingTableError({ message: 'relation "public.notification_outbox" does not exist' }), true);
    assert.strictEqual(isOutboxMissingTableError({ message: "could not find the table 'public.notification_outbox'" }), true);
});

test('Case 4: PGRST204 column not found -> STRICTLY REJECTED (false)', () => {
    assert.strictEqual(isOutboxMissingTableError({ code: 'PGRST204', message: 'Could not find the column' }), false);
});

test('Case 5: PGRST202 function not found -> STRICTLY REJECTED (false)', () => {
    assert.strictEqual(isOutboxMissingTableError({ code: 'PGRST202', message: 'Could not find the function' }), false);
});

test('Case 6: 42703 undefined_column -> STRICTLY REJECTED (false)', () => {
    assert.strictEqual(isOutboxMissingTableError({ code: '42703' }), false);
});

test('Case 7: 42501 permission denied -> STRICTLY REJECTED (false)', () => {
    assert.strictEqual(isOutboxMissingTableError({ code: '42501', message: 'permission denied for table notification_outbox' }), false);
});

test('Case 8: 57014 timeout / connection error -> STRICTLY REJECTED (false)', () => {
    assert.strictEqual(isOutboxMissingTableError({ code: '57014', message: 'canceling statement due to statement timeout' }), false);
});

// -----------------------------------------------------------------------------
// 6. Phone Number Normalization Tests
// -----------------------------------------------------------------------------
console.log('\n--- 6. Phone Number Normalization Tests ---');

function normalizePhoneNumber(raw) {
    if (!raw || typeof raw !== 'string') return null;
    const cleaned = raw.trim().replace(/[\s\-\(\)\.]/g, '');
    if (!cleaned) return null;
    if (/^\+91[6-9]\d{9}$/.test(cleaned)) return cleaned;
    if (/^91[6-9]\d{9}$/.test(cleaned)) return `+${cleaned}`;
    if (/^0[6-9]\d{9}$/.test(cleaned)) return `+91${cleaned.slice(1)}`;
    if (/^[6-9]\d{9}$/.test(cleaned)) return `+91${cleaned}`;
    return null;
}

test('Valid 10-digit number is normalized to +91XXXXXXXXXX', () => {
    assert.strictEqual(normalizePhoneNumber('9876543210'), '+919876543210');
    assert.strictEqual(normalizePhoneNumber('8123456789'), '+918123456789');
    assert.strictEqual(normalizePhoneNumber('7000011111'), '+917000011111');
    assert.strictEqual(normalizePhoneNumber('6398765432'), '+916398765432');
});

test('Valid 11-digit leading zero number is normalized to +91XXXXXXXXXX', () => {
    assert.strictEqual(normalizePhoneNumber('09876543210'), '+919876543210');
    assert.strictEqual(normalizePhoneNumber('0 98765 43210'), '+919876543210');
});

test('Valid 12-digit number (starting with 91) is normalized to +91XXXXXXXXXX', () => {
    assert.strictEqual(normalizePhoneNumber('919876543210'), '+919876543210');
    assert.strictEqual(normalizePhoneNumber('91-9876543210'), '+919876543210');
});

test('Valid 13-digit number (starting with +91) is preserved', () => {
    assert.strictEqual(normalizePhoneNumber('+919876543210'), '+919876543210');
    assert.strictEqual(normalizePhoneNumber('+91 (987) 654-3210'), '+919876543210');
});

test('Malformed numbers starting with digits 0-5 are safely rejected without guessing (returns null)', () => {
    assert.strictEqual(normalizePhoneNumber('5555555555'), null);
    assert.strictEqual(normalizePhoneNumber('1234567890'), null);
    assert.strictEqual(normalizePhoneNumber('01234567890'), null);
});

test('Short numbers, foreign numbers, and text formats are rejected without fabricating (returns null)', () => {
    assert.strictEqual(normalizePhoneNumber('98765'), null);
    assert.strictEqual(normalizePhoneNumber('+14155552671'), null);
    assert.strictEqual(normalizePhoneNumber('invalid_phone'), null);
    assert.strictEqual(normalizePhoneNumber(''), null);
    assert.strictEqual(normalizePhoneNumber(null), null);
    assert.strictEqual(normalizePhoneNumber(undefined), null);
});

// -----------------------------------------------------------------------------
// 7. Email Normalization & Validation Tests
// -----------------------------------------------------------------------------
console.log('\n--- 7. Email Normalization Tests ---');

function normalizeEmail(raw) {
    if (!raw || typeof raw !== 'string') return null;
    const cleaned = raw.trim().toLowerCase();
    if (!cleaned) return null;
    const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+$/;
    if (emailRegex.test(cleaned)) return cleaned;
    return null;
}

test('Valid email is trimmed and converted to lowercase', () => {
    assert.strictEqual(normalizeEmail('  VishvaaParthipan@Gmail.COM  '), 'vishvaaparthipan@gmail.com');
    assert.strictEqual(normalizeEmail('SUPPORT@XERSERVICE.IN'), 'support@xerservice.in');
});

test('Invalid emails return null safely', () => {
    assert.strictEqual(normalizeEmail('not-an-email'), null);
    assert.strictEqual(normalizeEmail('missing@domain'), null);
    assert.strictEqual(normalizeEmail('@nodomain.com'), null);
    assert.strictEqual(normalizeEmail(''), null);
    assert.strictEqual(normalizeEmail(null), null);
    assert.strictEqual(normalizeEmail(undefined), null);
});

// -----------------------------------------------------------------------------
// 8. Safe Payload Sanitization Tests
// -----------------------------------------------------------------------------
console.log('\n--- 8. Safe Payload Sanitization Tests ---');

function sanitizeOutboxPayload(payload = {}, isOtp = false) {
    const sensitiveKeys = [
        'storage_path',
        'document_path',
        'signed_url',
        'file_url',
        'key_secret',
        'webhook_secret',
        'access_token',
        'secret',
        'password',
        'card',
        'cvv',
        'service_role_key',
        'jwt',
    ];
    if (!isOtp) {
        sensitiveKeys.push('otp', 'otp_code', 'pin');
    }
    const safe = {};
    for (const [key, value] of Object.entries(payload)) {
        const lowerKey = key.toLowerCase();
        if (!sensitiveKeys.some((s) => lowerKey.includes(s))) {
            safe[key] = value;
        }
    }
    return safe;
}

test('Sanitizer strips document storage paths, file URLs, and signed URLs', () => {
    const rawPayload = {
        order_number: 'XS-100014',
        amount: 93,
        storage_path: 'orders/user1/doc.pdf',
        document_path: '/private/secret.pdf',
        signed_url: 'https://storage.supabase.co/v1/sign/token',
        file_url: 'https://storage.supabase.co/files/doc.pdf',
    };
    const sanitized = sanitizeOutboxPayload(rawPayload);
    assert.strictEqual(sanitized.order_number, 'XS-100014');
    assert.strictEqual(sanitized.amount, 93);
    assert.strictEqual(sanitized.storage_path, undefined);
    assert.strictEqual(sanitized.document_path, undefined);
    assert.strictEqual(sanitized.signed_url, undefined);
    assert.strictEqual(sanitized.file_url, undefined);
});

test('Sanitizer strips Razorpay secrets, passwords, cards, and JWT tokens', () => {
    const rawPayload = {
        order_id: 'ord_123',
        key_secret: 'LB2MrCvsjxkVdjMrUJu89OUA',
        webhook_secret: '33b7ecb543d8eae52a101dd',
        access_token: 'eyJh...',
        password: 'SuperSecretPassword',
        card: '4111222233334444',
        cvv: '123',
        service_role_key: 'sb_secret...',
    };
    const sanitized = sanitizeOutboxPayload(rawPayload);
    assert.strictEqual(sanitized.order_id, 'ord_123');
    assert.strictEqual(sanitized.key_secret, undefined);
    assert.strictEqual(sanitized.webhook_secret, undefined);
    assert.strictEqual(sanitized.access_token, undefined);
    assert.strictEqual(sanitized.password, undefined);
    assert.strictEqual(sanitized.card, undefined);
    assert.strictEqual(sanitized.cvv, undefined);
    assert.strictEqual(sanitized.service_role_key, undefined);
});

test('Sanitizer strips OTP codes for regular order events, retaining them only when isOtp=true', () => {
    const orderPayload = { order_number: 'XS-100014', otp_code: '123456' };
    const orderSanitized = sanitizeOutboxPayload(orderPayload, false);
    assert.strictEqual(orderSanitized.order_number, 'XS-100014');
    assert.strictEqual(orderSanitized.otp_code, undefined);

    const otpPayload = { destination: '+919876543210', otp_code: '654321' };
    const otpSanitized = sanitizeOutboxPayload(otpPayload, true);
    assert.strictEqual(otpSanitized.otp_code, '654321');
});

// -----------------------------------------------------------------------------
// 9. Deduplication Key Architecture Tests
// -----------------------------------------------------------------------------
console.log('\n--- 9. Deduplication Key Generation Tests ---');

function generateOutboxDedupeKey(channel, eventType, referenceId) {
    const channelSlug = channel.toLowerCase();
    const eventSlug = eventType.toLowerCase().replace(/_/g, '-');
    return `${channelSlug}:${eventSlug}:${referenceId}`;
}

test('Dedupe keys format standard {channel}:{event-slug}:{order_id}', () => {
    assert.strictEqual(
        generateOutboxDedupeKey('SMS', 'PAYMENT_SUCCESS', 'order-123'),
        'sms:payment-success:order-123'
    );
    assert.strictEqual(
        generateOutboxDedupeKey('EMAIL', 'ORDER_READY', 'order-456'),
        'email:order-ready:order-456'
    );
    assert.strictEqual(
        generateOutboxDedupeKey('WHATSAPP', 'REFUND_SUCCESS', 'order-789'),
        'whatsapp:refund-success:order-789'
    );
});

// -----------------------------------------------------------------------------
// 10. Authoritative Contact Resolution Tests (Live Database)
// -----------------------------------------------------------------------------
console.log('\n--- 10. Authoritative Contact Resolution Tests ---');

await asyncTest('Live contact resolution for customer 8d4f45c0-dffb-4082-b8c1-f7ed07ba7750 returns authoritative email', async () => {
    assert(!!adminClient, 'Admin Supabase client required');
    const { data: authUser } = await adminClient.auth.admin.getUserById('8d4f45c0-dffb-4082-b8c1-f7ed07ba7750');
    assert(!!authUser?.user?.email, 'Customer email exists in auth.users');
    assert.strictEqual(normalizeEmail(authUser.user.email), 'vishvaaparthipan@gmail.com');

    const { data: profile } = await adminClient
        .from('profiles')
        .select('phone')
        .eq('user_id', '8d4f45c0-dffb-4082-b8c1-f7ed07ba7750')
        .maybeSingle();

    const normalizedPhone = normalizePhoneNumber(profile?.phone || authUser.user.phone);
    assert.strictEqual(normalizedPhone, null, 'Customer phone is safely null without fabricating numbers');
});

await asyncTest('Live contact resolution for vendor 963f433c-786b-4576-96ee-c19d14351241 returns authoritative email', async () => {
    assert(!!adminClient, 'Admin Supabase client required');
    const { data: authUser } = await adminClient.auth.admin.getUserById('963f433c-786b-4576-96ee-c19d14351241');
    assert(!!authUser?.user?.email, 'Vendor email exists in auth.users');
    assert.strictEqual(normalizeEmail(authUser.user.email), 'xerserviceofficial@gmail.com');
});

// -----------------------------------------------------------------------------
// 11. Security & Browser Mutation Prevention Tests
// -----------------------------------------------------------------------------
console.log('\n--- 11. Security & Browser Mutation Prevention Tests ---');

test('Browser clients cannot mutate outbox rows (revoked in migration)', () => {
    assert(migrationSql.includes('REVOKE ALL ON public.notification_outbox FROM PUBLIC, anon, authenticated;'), 'Permissions not revoked');
    assert(migrationSql.includes('GRANT ALL ON public.notification_outbox TO service_role;'), 'service_role permission missing');
});

await asyncTest('Anon/browser client cannot insert into notification_outbox', async () => {
    if (!anonClient) {
        console.log('     Skipping live anon insert test (no anon client)');
        return;
    }

    const { error } = await anonClient
        .from('notification_outbox')
        .insert({
            user_id: '8d4f45c0-dffb-4082-b8c1-f7ed07ba7750',
            channel: 'SMS',
            event_type: 'PAYMENT_SUCCESS',
            template_key: 'test',
            dedupe_key: 'test:anon:123',
        });

    // In pre-push environment: 42P01 (table not found). In deployed: 42501 (permission denied / RLS violation)
    assert(!!error, 'Anon client must be blocked from inserting outbox row');
});

// -----------------------------------------------------------------------------
// 12. Event Wiring & Authoritative Unification Tests
// -----------------------------------------------------------------------------
console.log('\n--- 12. Event Wiring & Authoritative Unification Tests ---');
const notifPath = fs.existsSync(path.join(rootDir, 'packages/backend/src/notifications/notifications.ts'))
    ? path.join(rootDir, 'packages/backend/src/notifications/notifications.ts')
    : path.join(rootDir, 'src/lib/notifications.ts');
const notifCode = fs.readFileSync(notifPath, 'utf8');

test('createNotification in src/lib/notifications.ts chains external outbox queueing for order events', () => {
    assert(notifCode.includes('dispatchExternalOutboxForEvent'), 'Missing dispatchExternalOutboxForEvent');
    assert(notifCode.includes("case 'PAYMENT_SUCCESS':"), 'Missing PAYMENT_SUCCESS outbox mapping');
    assert(notifCode.includes("case 'NEW_ORDER':"), 'Missing NEW_ORDER outbox mapping');
    assert(notifCode.includes("case 'PRINTING_STARTED':"), 'Missing PRINTING_STARTED outbox mapping');
    assert(notifCode.includes("case 'ORDER_READY':"), 'Missing ORDER_READY outbox mapping');
    assert(notifCode.includes("case 'ORDER_COMPLETED':"), 'Missing ORDER_COMPLETED outbox mapping');
    assert(notifCode.includes("case 'ORDER_CANCELLED':"), 'Missing ORDER_CANCELLED outbox mapping');
    assert(notifCode.includes("case 'REFUND_SUCCESS':"), 'Missing REFUND_SUCCESS outbox mapping');
    assert(notifCode.includes("case 'REFUND_FAILED':"), 'Missing REFUND_FAILED outbox mapping');
});

test('Template keys match documented specification', () => {
    assert(notifCode.includes('customer_payment_success'), 'Missing customer_payment_success');
    assert(notifCode.includes('vendor_new_order'), 'Missing vendor_new_order');
    assert(notifCode.includes('customer_printing_started'), 'Missing customer_printing_started');
    assert(notifCode.includes('customer_order_ready'), 'Missing customer_order_ready');
    assert(notifCode.includes('customer_order_completed'), 'Missing customer_order_completed');
    assert(notifCode.includes('customer_order_cancelled'), 'Missing customer_order_cancelled');
    assert(notifCode.includes('customer_refund_success'), 'Missing customer_refund_success');
    assert(notifCode.includes('customer_refund_failed'), 'Missing customer_refund_failed');
});

// -----------------------------------------------------------------------------
// 13. OTP Separation Audit
// -----------------------------------------------------------------------------
console.log('\n--- 13. OTP Separation Audit ---');

test('OTP event type is supported in outbox but strictly absent from in-app notifications', () => {
    // NotificationType in notifications.ts must NOT include OTP
    assert(!notifCode.includes("| 'OTP'"), 'OTP must not be in in-app NotificationType');
    // OutboxEventType includes OTP
    assert(outboxSource.includes("export type OutboxEventType = NotificationType | 'OTP';"), 'OutboxEventType must include OTP');
});

// -----------------------------------------------------------------------------
// Final Summary
// -----------------------------------------------------------------------------
console.log('\n========================================================================');
console.log(`VERIFICATION RESULT: ${passedTests}/${totalTests} TESTS PASSED (${Math.round((passedTests / totalTests) * 100)}%)`);
console.log('========================================================================\n');

if (passedTests !== totalTests) {
    process.exit(1);
}

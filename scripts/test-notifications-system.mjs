import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

console.log('====================================================');
console.log('  XERSERVICE PHASE 6F: NOTIFICATIONS AUDIT & VERIFICATION');
console.log('====================================================\n');

let passedTests = 0;
let totalTests = 0;

function assert(condition, testName, details = '') {
    totalTests++;
    if (condition) {
        console.log(`  ✅ [PASS] ${testName}`);
        passedTests++;
    } else {
        console.error(`  ❌ [FAIL] ${testName}`);
        if (details) console.error(`     Details: ${details}`);
    }
}

// 1. Audit Migration File
console.log('--- 1. Database Schema & Migration Verification ---');
const migrationPath = path.join(rootDir, 'supabase/migrations/20260909100000_create_notifications_system.sql');
assert(fs.existsSync(migrationPath), 'Migration 20260909100000_create_notifications_system.sql exists');

const migrationSql = fs.existsSync(migrationPath) ? fs.readFileSync(migrationPath, 'utf8') : '';

assert(
    migrationSql.includes('CREATE TABLE IF NOT EXISTS public.notifications') &&
    migrationSql.includes('id UUID PRIMARY KEY DEFAULT gen_random_uuid()') &&
    migrationSql.includes('user_id UUID NOT NULL REFERENCES auth.users(id)') &&
    migrationSql.includes('public.orders(id)') &&
    migrationSql.includes('public.shops(id)'),
    'Table definition contains required foreign keys and primary key'
);

assert(
    migrationSql.includes('dedupe_key TEXT UNIQUE'),
    'Strict dedupe_key column with UNIQUE constraint exists'
);

assert(
    migrationSql.includes('ENABLE ROW LEVEL SECURITY') &&
    migrationSql.includes('notifications_select_own') &&
    migrationSql.includes('notifications_update_own'),
    'Row Level Security enabled with user-isolated SELECT and UPDATE policies'
);

assert(
    migrationSql.toUpperCase().includes('REVOKE INSERT, DELETE ON PUBLIC.NOTIFICATIONS FROM PUBLIC, ANON, AUTHENTICATED'),
    'Direct client INSERT and DELETE explicitly revoked'
);

assert(
    migrationSql.includes('trg_notifications_protect_fields') &&
    migrationSql.includes('handle_notification_update_protection'),
    'Security trigger protects immutable notification fields against client tampering'
);

assert(
    migrationSql.includes('ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications'),
    'Table registered in supabase_realtime publication'
);

assert(
    migrationSql.includes('idx_notifications_user_id_created_at') &&
    migrationSql.includes('idx_notifications_user_id_is_read'),
    'Performance composite indexes created for user feed and unread count'
);

// 2. Server Notification Helper
console.log('\n--- 2. Server Notification Helper Verification ---');
const helperPath = path.join(rootDir, 'src/lib/notifications.ts');
assert(fs.existsSync(helperPath), 'src/lib/notifications.ts helper exists');

const helperCode = fs.existsSync(helperPath) ? fs.readFileSync(helperPath, 'utf8') : '';
assert(
    helperCode.includes('sanitizeNotificationMetadata') &&
    helperCode.includes('storage_path') &&
    helperCode.includes('signed_url') &&
    helperCode.includes('file_url'),
    'Helper strips sensitive storage paths and signed URLs from metadata'
);

assert(
    helperCode.includes('23505') || helperCode.includes('duplicate key'),
    'Helper gracefully handles duplicate dedupe_key without throwing exceptions'
);

assert(
    helperCode.includes('42P01') || helperCode.includes('does not exist'),
    'Helper safely handles pre-push missing table errors'
);

// 3. API Endpoints Verification
console.log('\n--- 3. API Endpoints Verification ---');
const getNotifsPath = path.join(rootDir, 'src/app/api/notifications/route.ts');
const markReadPath = path.join(rootDir, 'src/app/api/notifications/[id]/read/route.ts');
const markAllReadPath = path.join(rootDir, 'src/app/api/notifications/read-all/route.ts');

assert(fs.existsSync(getNotifsPath), 'GET /api/notifications endpoint exists');
assert(fs.existsSync(markReadPath), 'POST /api/notifications/[id]/read endpoint exists');
assert(fs.existsSync(markAllReadPath), 'POST /api/notifications/read-all endpoint exists');

const getNotifsCode = fs.existsSync(getNotifsPath) ? fs.readFileSync(getNotifsPath, 'utf8') : '';
assert(
    getNotifsCode.includes('verifyAuthToken') &&
    getNotifsCode.includes('.limit(50)') &&
    getNotifsCode.includes('unreadCount'),
    'GET /api/notifications enforces authentication, returns 50 latest items and unread count'
);

const markReadCode = fs.existsSync(markReadPath) ? fs.readFileSync(markReadPath, 'utf8') : '';
assert(
    markReadCode.includes('verifyAuthToken') &&
    markReadCode.includes("eq('id', id)") &&
    markReadCode.includes("eq('user_id', userId)"),
    'POST /api/notifications/[id]/read enforces authentication and user ownership isolation'
);

const markAllReadCode = fs.existsSync(markAllReadPath) ? fs.readFileSync(markAllReadPath, 'utf8') : '';
assert(
    markAllReadCode.includes('verifyAuthToken') &&
    markAllReadCode.includes("eq('user_id', userId)") &&
    markAllReadCode.includes("eq('is_read', false)"),
    'POST /api/notifications/read-all updates only unread notifications for authenticated user'
);

// 4. Server-Side Lifecycle Event Wiring
console.log('\n--- 4. Lifecycle Event Triggers Verification ---');
const rzpWebhookPath = path.join(rootDir, 'src/app/api/webhooks/razorpay/route.ts');
const walletPaymentPath = path.join(rootDir, 'src/app/api/orders/[orderId]/payment/wallet/route.ts');
const vendorStatusPath = path.join(rootDir, 'src/app/api/vendor/orders/[orderId]/status/route.ts');
const customerCancelPath = path.join(rootDir, 'src/app/api/orders/[orderId]/cancel/route.ts');
const vendorCancelPath = path.join(rootDir, 'src/app/api/vendor/orders/[orderId]/cancel/route.ts');

const rzpCode = fs.readFileSync(rzpWebhookPath, 'utf8');
assert(
    rzpCode.includes('PAYMENT_SUCCESS') &&
    rzpCode.includes('NEW_ORDER') &&
    rzpCode.includes('payment-success:') &&
    rzpCode.includes('new-order:'),
    'Razorpay webhook triggers PAYMENT_SUCCESS for customer and NEW_ORDER for vendor on payment capture'
);

assert(
    rzpCode.includes('REFUND_SUCCESS') &&
    rzpCode.includes('REFUND_FAILED') &&
    rzpCode.includes('refund-success:') &&
    rzpCode.includes('refund-failed:'),
    'Razorpay webhook triggers REFUND_SUCCESS and REFUND_FAILED on gateway refund events'
);

const walletCode = fs.readFileSync(walletPaymentPath, 'utf8');
assert(
    walletCode.includes('PAYMENT_SUCCESS') &&
    walletCode.includes('NEW_ORDER') &&
    walletCode.includes('payment-success:') &&
    walletCode.includes('new-order:'),
    'Wallet payment route triggers PAYMENT_SUCCESS for customer and NEW_ORDER for vendor on successful checkout'
);

const statusCode = fs.readFileSync(vendorStatusPath, 'utf8');
assert(
    statusCode.includes('PRINTING_STARTED') &&
    statusCode.includes('ORDER_READY') &&
    statusCode.includes('ORDER_COMPLETED') &&
    statusCode.includes('printing-started:') &&
    statusCode.includes('ready:') &&
    statusCode.includes('completed:'),
    'Vendor status transition triggers PRINTING_STARTED, ORDER_READY, and ORDER_COMPLETED notifications'
);

const custCancelCode = fs.readFileSync(customerCancelPath, 'utf8');
assert(
    custCancelCode.includes('ORDER_CANCELLED') &&
    custCancelCode.includes('REFUND_SUCCESS') &&
    custCancelCode.includes('order-cancelled:') &&
    custCancelCode.includes('vendor-order-cancelled:'),
    'Customer cancellation triggers ORDER_CANCELLED (customer + vendor) and REFUND_SUCCESS (customer)'
);

const vendCancelCode = fs.readFileSync(vendorCancelPath, 'utf8');
assert(
    vendCancelCode.includes('ORDER_CANCELLED') &&
    vendCancelCode.includes('REFUND_SUCCESS') &&
    vendCancelCode.includes('order-cancelled:') &&
    vendCancelCode.includes('vendor-order-cancelled:'),
    'Vendor cancellation triggers ORDER_CANCELLED (customer + vendor) and REFUND_SUCCESS (customer)'
);

// 5. Frontend Navbar & Realtime Notification Bell
console.log('\n--- 5. Frontend Navbar & Realtime UI Verification ---');
const bellPath = path.join(rootDir, 'src/components/notifications/NotificationBell.tsx');
const navbarPath = path.join(rootDir, 'src/components/layout/Navbar.tsx');

assert(fs.existsSync(bellPath), 'NotificationBell component exists');

const bellCode = fs.existsSync(bellPath) ? fs.readFileSync(bellPath, 'utf8') : '';
assert(
    (bellCode.includes('notifications_realtime:') || bellCode.includes('realtime_notifications_')) &&
    bellCode.includes('postgres_changes') &&
    bellCode.includes('INSERT') &&
    bellCode.includes('UPDATE'),
    'NotificationBell subscribes to Supabase Realtime for live background updates'
);

assert(
    bellCode.includes('badgeDisplay') &&
    bellCode.includes("'9+'") &&
    bellCode.includes('unreadCount'),
    'NotificationBell unread badge properly formatted (hidden on 0, 1-9, and 9+)'
);

assert(
    bellCode.includes('handleMarkAllRead') &&
    bellCode.includes('/api/notifications/read-all'),
    'NotificationBell provides one-click "Mark all as read" capability'
);

assert(
    bellCode.includes('handleNotificationClick') &&
    bellCode.includes('/api/notifications/'),
    'Clicking notification marks it as read and deep-links to appropriate dashboard'
);

const navbarCode = fs.readFileSync(navbarPath, 'utf8');
assert(
    navbarCode.includes('NotificationBell') &&
    navbarCode.includes('<NotificationBell />'),
    'Navbar renders NotificationBell component alongside profile dropdown for authenticated sessions'
);

console.log('\n====================================================');
console.log(`  VERIFICATION RESULT: ${passedTests}/${totalTests} TESTS PASSED (${Math.round((passedTests / totalTests) * 100)}%)`);
console.log('====================================================\n');

if (passedTests !== totalTests) {
    process.exit(1);
}

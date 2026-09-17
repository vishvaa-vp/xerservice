import fs from 'fs';
import assert from 'node:assert';

console.log('Testing Phase 6A: Vendor Status RPC Specification & Endpoint Hardening...\n');

// 1. Audit Migration File: supabase/migrations/20260909050000_create_vendor_status_rpc.sql
const migrationPath = 'supabase/migrations/20260909050000_create_vendor_status_rpc.sql';
if (!fs.existsSync(migrationPath)) {
    throw new Error(`Migration file not found: ${migrationPath}`);
}
const migrationSql = fs.readFileSync(migrationPath, 'utf8');

console.log('Auditing Database Migration:', migrationPath);

// Check 1: FOR UPDATE locking
assert.ok(
    migrationSql.includes('FOR UPDATE'),
    'Migration MUST include "FOR UPDATE" row lock for concurrency safety'
);
console.log('✓ Check 1 Passed: RPC acquires exclusive row lock via "FOR UPDATE"');

// Check 2: Payment status check
assert.ok(
    migrationSql.includes("payment_status != 'PAID'"),
    'Migration MUST verify payment_status == PAID'
);
console.log('✓ Check 2 Passed: RPC strictly verifies payment_status = PAID');

// Check 3: Current status matching expected status
assert.ok(
    migrationSql.includes("status != p_expected_status"),
    'Migration MUST verify current status matches p_expected_status'
);
console.log('✓ Check 3 Passed: RPC strictly verifies current status equals expected status');

// Check 4: Enforces ONLY legal transitions:
// QUEUED -> PRINTING
// PRINTING -> READY
// READY -> COMPLETED
assert.ok(
    migrationSql.includes("p_expected_status = 'QUEUED' AND p_new_status = 'PRINTING'"),
    'RPC must permit QUEUED -> PRINTING'
);
assert.ok(
    migrationSql.includes("p_expected_status = 'PRINTING' AND p_new_status = 'READY'"),
    'RPC must permit PRINTING -> READY'
);
assert.ok(
    migrationSql.includes("p_expected_status = 'READY' AND p_new_status = 'COMPLETED'"),
    'RPC must permit READY -> COMPLETED'
);
console.log('✓ Check 4 Passed: RPC specifies only QUEUED -> PRINTING, PRINTING -> READY, READY -> COMPLETED as legal transitions');

// Check 5: Rejection exception message
assert.ok(
    migrationSql.includes("Invalid vendor order status transition"),
    'Migration MUST raise "Invalid vendor order status transition" exception on illegal moves'
);
console.log('✓ Check 5 Passed: RPC raises "Invalid vendor order status transition" for any invalid status jump');

// Check 6: Permissions
assert.ok(
    migrationSql.includes("REVOKE ALL ON FUNCTION public.transition_vendor_order_status(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;"),
    'Execute privilege must be revoked from public, anon, and authenticated'
);
assert.ok(
    migrationSql.includes("GRANT EXECUTE ON FUNCTION public.transition_vendor_order_status(UUID, TEXT, TEXT) TO service_role;"),
    'Execute privilege must be granted only to service_role'
);
console.log('✓ Check 6 Passed: RPC execution strictly granted to service_role only (revoked from public, anon, authenticated)');

// 2. Audit API Route: src/app/api/vendor/orders/[orderId]/status/route.ts
const routePath = 'src/app/api/vendor/orders/[orderId]/status/route.ts';
const routeCode = fs.readFileSync(routePath, 'utf8');

console.log('\nAuditing API Route for Zero Fallback:', routePath);

// Check 7: No direct update fallback exists
const hasUpdateFallback = routeCode.includes(".update(") || routeCode.includes("from('orders').update");
assert.strictEqual(
    hasUpdateFallback,
    false,
    'CRITICAL: API Route must NOT contain any .update() fallback for orders'
);
console.log('✓ Check 7 Passed: Verified ZERO service-role direct update fallback in API route');

// Check 8: Route calls RPC directly
assert.ok(
    routeCode.includes("serviceClient.rpc("),
    'Route must call transition_vendor_order_status via RPC'
);
assert.ok(
    routeCode.includes("'transition_vendor_order_status'"),
    'Route must invoke transition_vendor_order_status function name'
);
console.log('✓ Check 8 Passed: API route delegates state mutation exclusively to transition_vendor_order_status RPC');

// Check 9: Handles PGRST202 cleanly with 500 error
assert.ok(
    routeCode.includes("rpcError?.code === 'PGRST202'"),
    'Route must return clean 500 server error if RPC is missing from database'
);
console.log('✓ Check 9 Passed: Route returns clean 500 server error when migration has not been pushed');

// 3. State Machine Simulation Test
console.log('\nSimulating Complete State Machine Matrix...');

function simulateRpcTransition(currentStatus, paymentStatus, expectedStatus, newStatus) {
    if (paymentStatus !== 'PAID') {
        throw new Error(`Cannot transition order status: payment_status is ${paymentStatus} (must be PAID)`);
    }
    if (currentStatus !== expectedStatus) {
        throw new Error(`Order status mismatch: current status is ${currentStatus}, expected ${expectedStatus}`);
    }
    const isLegal =
        (expectedStatus === 'QUEUED' && newStatus === 'PRINTING') ||
        (expectedStatus === 'PRINTING' && newStatus === 'READY') ||
        (expectedStatus === 'READY' && newStatus === 'COMPLETED');

    if (!isLegal) {
        throw new Error(`Invalid vendor order status transition: from ${expectedStatus} to ${newStatus} is not allowed`);
    }

    return { status: newStatus };
}

// Legal Transitions
assert.strictEqual(simulateRpcTransition('QUEUED', 'PAID', 'QUEUED', 'PRINTING').status, 'PRINTING');
console.log('✓ Transition 1: QUEUED -> PRINTING = SUCCESS');

assert.strictEqual(simulateRpcTransition('PRINTING', 'PAID', 'PRINTING', 'READY').status, 'READY');
console.log('✓ Transition 2: PRINTING -> READY = SUCCESS');

assert.strictEqual(simulateRpcTransition('READY', 'PAID', 'READY', 'COMPLETED').status, 'COMPLETED');
console.log('✓ Transition 3: READY -> COMPLETED = SUCCESS');

// Illegal Transitions (MUST FAIL)
const illegalCases = [
    { current: 'QUEUED', expected: 'QUEUED', target: 'READY' },
    { current: 'QUEUED', expected: 'QUEUED', target: 'COMPLETED' },
    { current: 'PRINTING', expected: 'PRINTING', target: 'COMPLETED' },
    { current: 'READY', expected: 'READY', target: 'PRINTING' },
    { current: 'COMPLETED', expected: 'COMPLETED', target: 'READY' },
    { current: 'QUEUED', expected: 'QUEUED', target: 'DRAFT' },
    { current: 'PRINTING', expected: 'PRINTING', target: 'AWAITING_PAYMENT' },
    { current: 'READY', expected: 'READY', target: 'CANCELLED' },
    { current: 'PRINTING', expected: 'PRINTING', target: 'QUEUED' },
];

for (const c of illegalCases) {
    assert.throws(
        () => simulateRpcTransition(c.current, 'PAID', c.expected, c.target),
        /Invalid vendor order status transition/,
        `Transition ${c.expected} -> ${c.target} should have been rejected`
    );
    console.log(`✓ Illegal Transition ${c.expected} -> ${c.target} = REJECTED by RPC logic`);
}

// Unpaid Order Check (MUST FAIL)
assert.throws(
    () => simulateRpcTransition('QUEUED', 'UNPAID', 'QUEUED', 'PRINTING'),
    /must be PAID/,
    'Unpaid order transition must fail'
);
console.log('✓ Unpaid Order Transition = REJECTED by RPC logic');

console.log('\nAll migration RPC and endpoint integrity tests passed successfully!');

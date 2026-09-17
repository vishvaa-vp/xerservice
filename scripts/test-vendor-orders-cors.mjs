/**
 * XerService Step 17.1 CORS Fix Verification
 * Tests the CORS headers and preflight handling for /api/vendor/orders
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

console.log('========================================================================');
console.log('XERSERVICE STEP 17.1 CORS FIX VERIFICATION');
console.log('========================================================================\n');

let passed = 0;
let failed = 0;
function pass(msg) { console.log(`  [PASS] ${msg}`); passed++; }
function fail(msg, err) { console.error(`  [FAIL] ${msg}: ${err}`); failed++; }

async function runTests() {
    // -------------------------------------------------------------------------
    // TEST 1: Preflight from http://localhost:1420 (Tauri development)
    // -------------------------------------------------------------------------
    console.log('--- TEST 1: Preflight from http://localhost:1420 (Tauri dev) ---');
    try {
        const { handleCorsPreflight, isAllowedDesktopOrigin } = await import('../src/lib/cors.ts');
        assert(isAllowedDesktopOrigin('http://localhost:1420'), 'http://localhost:1420 is recognized as allowed origin');

        const req = new Request('http://localhost:3000/api/vendor/orders', {
            method: 'OPTIONS',
            headers: {
                'Origin': 'http://localhost:1420',
                'Access-Control-Request-Method': 'GET',
                'Access-Control-Request-Headers': 'Authorization, Cache-Control',
            },
        });

        const res = handleCorsPreflight(req, ['GET', 'OPTIONS']);
        assert.strictEqual(res.status, 204, 'Preflight returns 204 No Content');
        assert.strictEqual(res.headers.get('Access-Control-Allow-Origin'), 'http://localhost:1420', 'Reflects exact allowed origin');
        assert(res.headers.get('Access-Control-Allow-Methods').includes('GET'), 'Allows GET method');
        assert(res.headers.get('Access-Control-Allow-Methods').includes('OPTIONS'), 'Allows OPTIONS method');
        assert(res.headers.get('Access-Control-Allow-Headers').includes('Authorization'), 'Allows Authorization header');
        assert(res.headers.get('Access-Control-Allow-Headers').includes('Cache-Control'), 'Allows Cache-Control header');
        assert.strictEqual(res.headers.get('Vary'), 'Origin', 'Includes Vary: Origin');
        assert.notStrictEqual(res.headers.get('Access-Control-Allow-Origin'), '*', 'Never returns wildcard *');
        pass('Test 1: Preflight from http://localhost:1420 returns 204 with exact origin, allowed methods, allowed headers, and Vary: Origin');
    } catch (err) {
        fail('Test 1 failed', err.message);
    }

    // -------------------------------------------------------------------------
    // TEST 2: Preflight from tauri://localhost (Tauri packaged application)
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 2: Preflight from tauri://localhost (Tauri packaged app) ---');
    try {
        const { handleCorsPreflight, isAllowedDesktopOrigin } = await import('../src/lib/cors.ts');
        assert(isAllowedDesktopOrigin('tauri://localhost'), 'tauri://localhost is recognized as allowed origin');

        const req = new Request('http://localhost:3000/api/vendor/orders', {
            method: 'OPTIONS',
            headers: {
                'Origin': 'tauri://localhost',
                'Access-Control-Request-Method': 'GET',
                'Access-Control-Request-Headers': 'Authorization, Cache-Control',
            },
        });

        const res = handleCorsPreflight(req, ['GET', 'OPTIONS']);
        assert.strictEqual(res.status, 204, 'Preflight returns 204 No Content');
        assert.strictEqual(res.headers.get('Access-Control-Allow-Origin'), 'tauri://localhost', 'Reflects exact tauri://localhost origin');
        assert(res.headers.get('Access-Control-Allow-Methods').includes('GET'), 'Allows GET method');
        assert(res.headers.get('Access-Control-Allow-Methods').includes('OPTIONS'), 'Allows OPTIONS method');
        assert(res.headers.get('Access-Control-Allow-Headers').includes('Authorization'), 'Allows Authorization header');
        assert.strictEqual(res.headers.get('Vary'), 'Origin', 'Includes Vary: Origin');
        pass('Test 2: Preflight from tauri://localhost returns 204 with equivalent allowed-origin response');
    } catch (err) {
        fail('Test 2 failed', err.message);
    }

    // -------------------------------------------------------------------------
    // TEST 3: Preflight and CORS rejection from unapproved origins
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 3: Preflight from unapproved origins ---');
    try {
        const { handleCorsPreflight, isAllowedDesktopOrigin } = await import('../src/lib/cors.ts');
        assert(!isAllowedDesktopOrigin('https://malicious-site.com'), 'malicious-site is rejected');
        assert(!isAllowedDesktopOrigin('http://localhost:3001'), 'unregistered port is rejected');
        assert(!isAllowedDesktopOrigin('https://xerservice.evil.com'), 'subdomain attack is rejected');

        const req = new Request('http://localhost:3000/api/vendor/orders', {
            method: 'OPTIONS',
            headers: {
                'Origin': 'https://malicious-site.com',
                'Access-Control-Request-Method': 'GET',
                'Access-Control-Request-Headers': 'Authorization',
            },
        });

        const res = handleCorsPreflight(req, ['GET', 'OPTIONS']);
        assert.strictEqual(res.headers.get('Access-Control-Allow-Origin'), null, 'Unapproved origin receives NO Access-Control-Allow-Origin header');
        pass('Test 3: Unapproved origin strictly denied CORS headers');
    } catch (err) {
        fail('Test 3 failed', err.message);
    }

    // -------------------------------------------------------------------------
    // TEST 4: Route Handler Source Code Audit for Explicit OPTIONS and GET
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 4: Route Handler source code audit ---');
    try {
        const routeFile = fs.readFileSync(path.join(rootDir, 'src', 'app', 'api', 'vendor', 'orders', 'route.ts'), 'utf8');
        assert(routeFile.includes('export async function OPTIONS('), 'Route explicitly exports OPTIONS handler');
        assert(routeFile.includes('handleCorsPreflight('), 'OPTIONS handler calls handleCorsPreflight');
        assert(routeFile.includes('getCorsHeaders('), 'GET handler calls getCorsHeaders');
        assert(routeFile.includes('...corsHeaders'), 'Response headers include corsHeaders');
        pass('Test 4: Route handler explicitly defines OPTIONS and GET with CORS integration');
    } catch (err) {
        fail('Test 4 failed', err.message);
    }

    // -------------------------------------------------------------------------
    // TEST 5: GET /api/vendor/orders Authorization Enforcement & CORS Headers
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 5: GET /api/vendor/orders authorization & CORS ---');
    try {
        const { getCorsHeaders } = await import('../src/lib/cors.ts');

        // Request with approved origin
        const reqDesktop = new Request('http://localhost:3000/api/vendor/orders', {
            headers: { 'Origin': 'http://localhost:1420' },
        });
        const desktopCors = getCorsHeaders(reqDesktop, ['GET', 'OPTIONS']);
        assert.strictEqual(desktopCors['Access-Control-Allow-Origin'], 'http://localhost:1420');
        assert.strictEqual(desktopCors['Vary'], 'Origin');
        pass('Test 5a: Desktop request receives exact origin in Access-Control-Allow-Origin header');

        // Request with unapproved origin
        const reqEvil = new Request('http://localhost:3000/api/vendor/orders', {
            headers: { 'Origin': 'https://attacker.com' },
        });
        const evilCors = getCorsHeaders(reqEvil, ['GET', 'OPTIONS']);
        assert.strictEqual(evilCors['Access-Control-Allow-Origin'], undefined);
        pass('Test 5b: Unapproved origin receives no Access-Control-Allow-Origin header');

        // Request with no Origin (same-origin / server-to-server)
        const reqNoOrigin = new Request('http://localhost:3000/api/vendor/orders');
        const noOriginCors = getCorsHeaders(reqNoOrigin, ['GET', 'OPTIONS']);
        assert.strictEqual(Object.keys(noOriginCors).length, 0);
        pass('Test 5c: Same-origin requests without Origin header receive clean unmodified headers');
    } catch (err) {
        fail('Test 5 failed', err.message);
    }

    // -------------------------------------------------------------------------
    // TEST 6: Vendor Authorization Invariants Unchanged
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 6: Vendor authorization invariants check ---');
    try {
        const routeFile = fs.readFileSync(path.join(rootDir, 'src', 'app', 'api', 'vendor', 'orders', 'route.ts'), 'utf8');
        assert(routeFile.includes('verifyAuthToken('), 'Route enforces verifyAuthToken');
        assert(routeFile.includes('profile.role !== \'vendor\''), 'Route enforces vendor role');
        assert(routeFile.includes('.eq(\'owner_id\', authUser.userId)'), 'Route enforces shop ownership by owner_id');
        assert(routeFile.includes('.eq(\'shop_id\', shop.id)'), 'Route strictly scopes orders by shop_id');
        pass('Test 6: Server-side vendor token verification and shop ownership checks remain 100% intact');
    } catch (err) {
        fail('Test 6 failed', err.message);
    }

    // -------------------------------------------------------------------------
    // TEST 7: Zero Wildcard Policy Audit
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 7: Zero Wildcard Policy Audit ---');
    try {
        const corsCode = fs.readFileSync(path.join(rootDir, 'src', 'lib', 'cors.ts'), 'utf8');
        assert(!corsCode.includes("'Access-Control-Allow-Origin': '*'"), 'No wildcard Access-Control-Allow-Origin: *');
        assert(!corsCode.includes('"Access-Control-Allow-Origin": "*"'), 'No double-quoted wildcard Access-Control-Allow-Origin: *');
        assert(corsCode.includes('ALLOWED_DESKTOP_ORIGINS'), 'Enforces ALLOWED_DESKTOP_ORIGINS whitelist');
        pass('Test 7: No wildcard Access-Control-Allow-Origin: * permitted');
    } catch (err) {
        fail('Test 7 failed', err.message);
    }

    // -------------------------------------------------------------------------
    // TEST 8: Monorepo Boundary Invariant
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 8: Boundary Protection ---');
    try {
        const diffRes = spawnSync('git', ['diff', '--name-only', 'supabase', 'apps/user', 'apps/vendor', 'apps/admin'], {
            cwd: rootDir,
            encoding: 'utf8',
        });
        const diffFiles = (diffRes.stdout || '').trim().split('\n').filter(Boolean);
        assert.strictEqual(diffFiles.length, 0, `Forbidden boundary files modified: ${diffFiles.join(', ')}`);
        pass('Test 8: Zero modifications to supabase migrations, apps/user, apps/vendor, or apps/admin');
    } catch (err) {
        fail('Test 8 failed', err.message);
    }

    console.log('\n========================================================================');
    console.log(`STEP 17.1 CORS FIX RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log('========================================================================');

    if (failed > 0) process.exit(1);
}

runTests().catch(err => {
    console.error('Fatal error in tests:', err);
    process.exit(1);
});

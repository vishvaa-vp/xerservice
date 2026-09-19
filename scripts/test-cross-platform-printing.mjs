#!/usr/bin/env node
/**
 * scripts/test-cross-platform-printing.mjs
 * 
 * Comprehensive Automated Acceptance Test Suite for:
 * Step 4: Cross-Platform Spooler Support (Windows, Linux, and macOS)
 * 
 * Verifies:
 * 1. Cross-Platform Rust Spooler Architecture & Target Gates
 * 2. Windows Spooler Handlers (PowerShell / Win32 safe execution)
 * 3. Linux & macOS CUPS Handlers (Dynamic binary resolution & safe args)
 * 4. Platform Capabilities Contract (Status polling, Cancellation, Readiness)
 * 5. Multi-Platform Application Icon Assets (.icns, .ico, .png)
 * 6. Native Rust Unit Test Suite Integrity (33/33 tests)
 * 7. Remote Supabase Financial Invariant Certification (Zero Delta)
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

const rootDir = resolve(process.cwd());
let passCount = 0;
let failCount = 0;

function assert(condition, message) {
    if (condition) {
        passCount++;
        console.log(`  ✓ PASS [${passCount}]: ${message}`);
    } else {
        failCount++;
        console.error(`  ✗ FAIL [${passCount + failCount}]: ${message}`);
    }
}

// Load .env.local for remote invariant checks
function loadEnv() {
    const envPath = join(rootDir, '.env.local');
    if (!existsSync(envPath)) return {};
    const content = readFileSync(envPath, 'utf8');
    const lines = content.split('\n');
    const env = {};
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx !== -1) {
            const key = trimmed.slice(0, eqIdx).trim();
            const val = trimmed.slice(eqIdx + 1).trim();
            env[key] = val;
        }
    }
    return env;
}

const env = loadEnv();
const supabaseUrl = env['NEXT_PUBLIC_SUPABASE_URL'] || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = env['SUPABASE_SECRET_KEY'] || env['SUPABASE_SERVICE_ROLE_KEY'] || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

console.log('\n========================================================================');
console.log('  TEST SUITE: Cross-Platform Spooler Support (Windows & Linux Parity)');
console.log('========================================================================\n');

// -----------------------------------------------------------------------------
// SECTION 1: Rust Spooler Architecture & Target Gates
// -----------------------------------------------------------------------------
console.log('--- SECTION 1: Cross-Platform Rust Spooler Target Gates ---');

const printingDir = join(rootDir, 'apps/desktop/src-tauri/src/printing');

const discoveryCode = readFileSync(join(printingDir, 'discovery.rs'), 'utf8');
assert(
    discoveryCode.includes('target_os = "windows"') &&
    discoveryCode.includes('any(target_os = "macos", target_os = "linux")'),
    'discovery.rs declares explicit target gates for Windows, Linux, and macOS'
);
assert(
    discoveryCode.includes('discover_windows_printers') &&
    discoveryCode.includes('discover_cups_printers'),
    'discovery.rs contains dedicated discovery handlers for both Windows Spooler and CUPS'
);
assert(
    discoveryCode.includes('Get-CimInstance Win32_Printer'),
    'discovery.rs queries Win32_Printer via safe PowerShell CIM cmdlets'
);

const capabilitiesCode = readFileSync(join(printingDir, 'capabilities.rs'), 'utf8');
assert(
    capabilitiesCode.includes('target_os = "windows"') &&
    capabilitiesCode.includes('any(target_os = "macos", target_os = "linux")'),
    'capabilities.rs declares explicit target gates for Windows, Linux, and macOS'
);
assert(
    capabilitiesCode.includes('CapabilityDescriptions') &&
    capabilitiesCode.includes('Color') &&
    capabilitiesCode.includes('Duplex'),
    'capabilities.rs inspects Windows printer capabilities (paper sizes, duplex, color)'
);

const submissionCode = readFileSync(join(printingDir, 'submission.rs'), 'utf8');
assert(
    submissionCode.includes('target_os = "windows"') &&
    submissionCode.includes('any(target_os = "macos", target_os = "linux")'),
    'submission.rs declares explicit target gates for Windows, Linux, and macOS'
);
assert(
    submissionCode.includes('Out-Printer') &&
    submissionCode.includes('Start-Process -FilePath'),
    'submission.rs implements native Windows Spooler dispatch for both text and documents'
);
assert(
    submissionCode.includes('Get-PrintJob') &&
    submissionCode.includes('WIN-'),
    'submission.rs extracts native Windows Spooler job IDs with deterministic fallback'
);

const statusCode = readFileSync(join(printingDir, 'status.rs'), 'utf8');
assert(
    statusCode.includes('target_os = "windows"') &&
    statusCode.includes('any(target_os = "macos", target_os = "linux")'),
    'status.rs declares explicit target gates for Windows, Linux, and macOS'
);
assert(
    statusCode.includes('Get-PrintJob') &&
    statusCode.includes('JobStatus'),
    'status.rs queries Windows Print Spooler active jobs via Get-PrintJob'
);

const controlCode = readFileSync(join(printingDir, 'control.rs'), 'utf8');
assert(
    controlCode.includes('target_os = "windows"') &&
    controlCode.includes('any(target_os = "macos", target_os = "linux")'),
    'control.rs declares explicit target gates for Windows, Linux, and macOS'
);
assert(
    controlCode.includes('Remove-PrintJob'),
    'control.rs implements Windows job cancellation via Remove-PrintJob'
);

const queueCode = readFileSync(join(printingDir, 'queue.rs'), 'utf8');
assert(
    queueCode.includes('target_os = "windows"') &&
    queueCode.includes('any(target_os = "macos", target_os = "linux")'),
    'queue.rs declares explicit target gates for Windows, Linux, and macOS'
);
assert(
    queueCode.includes('Get-PrintJob') &&
    queueCode.includes('PrintQueueItem'),
    'queue.rs maps Windows Spooler queue jobs into normalized PrintQueueItem instances'
);

const modCode = readFileSync(join(printingDir, 'mod.rs'), 'utf8');
assert(
    modCode.includes('platform == "linux"') &&
    modCode.includes('platform == "windows"') &&
    modCode.includes('platform == "macos"'),
    'mod.rs get_platform_capabilities recognizes macOS, Linux, and Windows'
);
assert(
    modCode.includes('DISCOVERY_AND_CAPABILITIES_READY'),
    'mod.rs reports active readiness state across supported desktop platforms'
);

// -----------------------------------------------------------------------------
// SECTION 2: Dynamic Binary Resolution & Unix Parity
// -----------------------------------------------------------------------------
console.log('\n--- SECTION 2: Dynamic Binary Resolution & Unix CUPS Parity ---');

assert(
    discoveryCode.includes('lpstat_bin') &&
    discoveryCode.includes('std::path::Path::new("/usr/bin/lpstat").exists()'),
    'discovery.rs dynamically resolves lpstat binary path across Unix environments'
);

assert(
    capabilitiesCode.includes('lpoptions_bin') &&
    capabilitiesCode.includes('std::path::Path::new("/usr/bin/lpoptions").exists()'),
    'capabilities.rs dynamically resolves lpoptions binary path across Unix environments'
);

assert(
    submissionCode.includes('lp_bin') &&
    submissionCode.includes('std::path::Path::new("/usr/bin/lp").exists()'),
    'submission.rs dynamically resolves lp binary path across Unix environments'
);

assert(
    statusCode.includes('lpstat_bin') &&
    statusCode.includes('std::path::Path::new("/usr/bin/lpstat").exists()'),
    'status.rs dynamically resolves lpstat binary path across Unix environments'
);

assert(
    controlCode.includes('cancel_bin') &&
    controlCode.includes('std::path::Path::new("/usr/bin/cancel").exists()'),
    'control.rs dynamically resolves cancel binary path across Unix environments'
);

assert(
    queueCode.includes('lpstat_bin') &&
    queueCode.includes('std::path::Path::new("/usr/bin/lpstat").exists()'),
    'queue.rs dynamically resolves lpstat binary path across Unix environments'
);

// -----------------------------------------------------------------------------
// SECTION 3: Multi-Platform Application Icon Assets
// -----------------------------------------------------------------------------
console.log('\n--- SECTION 3: Multi-Platform Application Icon Assets ---');

const iconsDir = join(rootDir, 'apps/desktop/src-tauri/icons');
assert(existsSync(join(iconsDir, 'icon.icns')), 'macOS icon bundle (icon.icns) exists');
assert(existsSync(join(iconsDir, 'icon.ico')), 'Windows icon resource (icon.ico) exists');
assert(existsSync(join(iconsDir, 'icon.png')), 'Linux standard desktop icon (icon.png) exists');
assert(existsSync(join(iconsDir, '128x128.png')), 'Standard 128x128 PNG icon exists');
assert(existsSync(join(iconsDir, '32x32.png')), 'Standard 32x32 PNG icon exists');

// -----------------------------------------------------------------------------
// SECTION 4: Native Rust Verification & CLI Self-Test
// -----------------------------------------------------------------------------
console.log('\n--- SECTION 4: Native Rust Verification & CLI Self-Test ---');

try {
    const cargoCheckOut = execSync('cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml', {
        cwd: rootDir,
        encoding: 'utf8',
    });
    assert(true, 'cargo check passes cleanly on native toolchain with 0 errors');
} catch (e) {
    assert(false, `cargo check failed: ${e.message}`);
}

try {
    const cargoTestOut = execSync('cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml', {
        cwd: rootDir,
        encoding: 'utf8',
    });
    const match = cargoTestOut.match(/test result: ok\. (\d+) passed/);
    const passedTests = match ? parseInt(match[1], 10) : 0;
    assert(passedTests >= 33, `cargo test runs native test suite cleanly (${passedTests} passed, 0 failures)`);
} catch (e) {
    assert(false, `cargo test failed: ${e.message}`);
}

const releaseBinary = join(rootDir, 'apps/desktop/src-tauri/target/release/xerservice-desktop');
if (existsSync(releaseBinary)) {
    try {
        const out = execSync(`"${releaseBinary}" --invoke get_printing_capabilities`, { encoding: 'utf8' });
        const json = JSON.parse(out.trim());
        assert(json.nativeAdapterStatus === 'DISCOVERY_AND_CAPABILITIES_READY', 'Release binary returns DISCOVERY_AND_CAPABILITIES_READY');
        assert(json.supportsStatusPolling === true, 'Release binary declares status polling support');
        assert(json.supportsJobCancellation === true, 'Release binary declares job cancellation support');
        assert(['macos', 'linux', 'windows'].includes(json.platform), `Release binary identifies platform '${json.platform}'`);
    } catch (e) {
        assert(false, `CLI invocation failed: ${e.message}`);
    }
} else {
    console.log('  ℹ Notice: Release binary target path will be compiled in bundle step');
}

// -----------------------------------------------------------------------------
// SECTION 5: Remote Supabase Database Financial Invariants (Zero Delta)
// -----------------------------------------------------------------------------
console.log('\n--- SECTION 5: Remote Supabase Financial Invariants (Zero Delta) ---');

async function verifyFinancialInvariants() {
    if (!supabaseUrl || !supabaseKey) {
        console.log('  ⚠ Warning: Supabase credentials not found. Skipping remote DB assertions.');
        return;
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // 1. Check order_financial_ledger count (Target: 17)
    const { count: ledgerCount, error: err1 } = await supabase
        .from('order_financial_ledger')
        .select('*', { count: 'exact', head: true });
    assert(!err1 && ledgerCount === 17, `Remote ledger invariant preserved (17 === ${ledgerCount})`);

    // 2. Check wallet_accounts balance sum (Target: ₹88)
    const { data: wallets, error: err2 } = await supabase
        .from('wallet_accounts')
        .select('balance');
    const walletSum = (wallets || []).reduce((acc, w) => acc + Number(w.balance || 0), 0);
    assert(!err2 && walletSum === 88.00, `Remote wallet balances invariant preserved (₹88.00 === ₹${walletSum.toFixed(2)})`);

    // 3. Check shop_commission_rules count (Target: 2)
    const { count: ruleCount, error: err3 } = await supabase
        .from('shop_commission_rules')
        .select('*', { count: 'exact', head: true });
    assert(!err3 && ruleCount === 2, `Remote commission rules invariant preserved (2 === ${ruleCount})`);

    // 4. Check vendor_settlement_batches count (Target: 1)
    const { count: batchCount, error: err4 } = await supabase
        .from('vendor_settlement_batches')
        .select('*', { count: 'exact', head: true });
    assert(!err4 && batchCount === 1, `Remote settlement batches invariant preserved (1 === ${batchCount})`);

    // 5. Check vendor_settlement_items count (Target: 4)
    const { count: itemCount, error: err5 } = await supabase
        .from('vendor_settlement_items')
        .select('*', { count: 'exact', head: true });
    assert(!err5 && itemCount === 4, `Remote settlement items invariant preserved (4 === ${itemCount})`);
}

await verifyFinancialInvariants();

console.log('\n========================================================================');
console.log(`  FINAL RESULT: ${passCount} Passed, ${failCount} Failed`);
console.log('========================================================================\n');

if (failCount > 0) {
    process.exit(1);
} else {
    process.exit(0);
}

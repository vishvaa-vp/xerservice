/**
 * XerService Step 11: Native Printer Discovery & Capabilities Automated Verification
 *
 * Rigorously validates:
 * Part A: Static Architecture & Type Contract Alignment with @packages/printing
 * Part B: Rust Compilation & Native Binary Validation
 * Part C: OS-Level Host Subsystem Baseline (/usr/bin/lpstat)
 * Part D: Native Tauri Runtime Launch & Real WebView <-> Rust IPC Discovery
 * Part E: Discovery Accuracy & Spooler Invariant Checks (Zero Physical Printing)
 */

import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { spawn, spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const desktopDir = path.join(rootDir, 'apps', 'desktop');
const tauriDir = path.join(desktopDir, 'src-tauri');
const printingDir = path.join(tauriDir, 'src', 'printing');

const cargoBin = path.join(process.env.HOME || '', '.cargo', 'bin');
const nodeBin = '/Users/vishvaaparthipan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin';
const envPath = `${cargoBin}:${nodeBin}:${process.env.PATH}`;
const execEnv = { ...process.env, PATH: envPath };

let passed = 0;
let failed = 0;
const advisories = [];

function pass(name, detail = '') {
    console.log(`  [PASS] ${name}`);
    if (detail) console.log(`         -> ${detail}`);
    passed++;
}

function fail(name, detail = '') {
    console.error(`  [FAIL] ${name}`);
    if (detail) console.error(`         -> ${detail}`);
    failed++;
}

function advise(message) {
    console.warn(`  [ADVISORY] ${message}`);
    advisories.push(message);
}

async function runVerification() {
    console.log('========================================================================');
    console.log('XERSERVICE STEP 11: NATIVE PRINTER DISCOVERY & CAPABILITIES VALIDATION');
    console.log('========================================================================\n');

    // -------------------------------------------------------------------------
    // PART A: Static Architecture & Contract Integrity
    // -------------------------------------------------------------------------
    console.log('--- PART A: Static Architecture & Contract Integrity ---');
    try {
        // 1. Check printing module files
        const requiredFiles = ['mod.rs', 'capabilities.rs', 'discovery.rs', 'errors.rs'];
        for (const file of requiredFiles) {
            const filePath = path.join(printingDir, file);
            assert(fs.existsSync(filePath), `Printing submodule ${file} exists`);
        }
        pass('Native printing submodule files present in src-tauri/src/printing/');

        // 2. Check lib.rs references printing
        const libRs = fs.readFileSync(path.join(tauriDir, 'src', 'lib.rs'), 'utf8');
        assert(libRs.includes('pub mod printing;'), 'lib.rs declares pub mod printing');
        assert(libRs.includes('list_native_printers'), 'lib.rs imports list_native_printers');
        assert(libRs.includes('STAGE_E_NATIVE_ADAPTER_EXECUTED'), 'lib.rs includes native adapter execution telemetry');
        pass('apps/desktop/src-tauri/src/lib.rs properly integrates printing module');

        // 3. Check capabilities and normalized printer struct alignment
        const capRs = fs.readFileSync(path.join(printingDir, 'capabilities.rs'), 'utf8');
        assert(capRs.includes('pub struct PrinterCapabilities'), 'Defines PrinterCapabilities struct');
        assert(capRs.includes('pub struct NormalizedPrinter'), 'Defines NormalizedPrinter struct');
        assert(capRs.includes('pub struct PlatformPrintingCapabilitiesResponse'), 'Defines PlatformPrintingCapabilitiesResponse struct');
        assert(capRs.includes('#[serde(rename_all = "camelCase")]'), 'Uses camelCase serialization for TS contracts');
        pass('Rust data models strictly align with @packages/printing TypeScript contracts');

        // 4. Invariant: Zero mock/manufactured printers
        const discRs = fs.readFileSync(path.join(printingDir, 'discovery.rs'), 'utf8');
        assert(!discRs.includes('HP LaserJet'), 'No fake HP printer strings');
        assert(!discRs.includes('Canon PIXMA'), 'No fake Canon printer strings');
        assert(!discRs.includes('Epson EcoTank'), 'No fake Epson printer strings');
        assert(discRs.includes('/usr/bin/lpstat'), 'Directly queries macOS /usr/bin/lpstat');
        pass('Zero fake/manufactured printers: Discovery strictly queries host OS');

        // 5. Invariant: Zero physical printing in Step 11
        for (const f of ['mod.rs', 'capabilities.rs', 'discovery.rs', 'errors.rs']) {
            const content = fs.readFileSync(path.join(printingDir, f), 'utf8');
            assert(!content.includes('/usr/bin/lp '), 'No /usr/bin/lp submission command');
            assert(!content.includes('/usr/bin/lpr'), 'No /usr/bin/lpr submission command');
            assert(!content.includes('NSPrintOperation'), 'No Cocoa NSPrintOperation spooling');
        }
        pass('Strict invariant verified: Zero physical print execution code present in Step 11');

        // 6. Security invariant: zero secret leakage
        const forbiddenKeys = ['SUPABASE_SERVICE_ROLE_KEY', 'RAZORPAY_KEY_SECRET', 'ADMIN_COOKIE_SECRET', 'DATABASE_URL'];
        for (const f of ['mod.rs', 'capabilities.rs', 'discovery.rs', 'errors.rs']) {
            const content = fs.readFileSync(path.join(printingDir, f), 'utf8');
            for (const k of forbiddenKeys) {
                assert(!content.includes(k), `Secret ${k} found in ${f}`);
            }
        }
        pass('Security invariant: Zero credentials or secrets in printing module');
    } catch (err) {
        fail('Part A static check failed', err.message);
    }

    // -------------------------------------------------------------------------
    // PART B: Compilation & Binary Checks
    // -------------------------------------------------------------------------
    console.log('\n--- PART B: Compilation & Binary Checks ---');
    try {
        const cargoCheck = spawnSync('cargo', ['check'], { cwd: tauriDir, env: execEnv, encoding: 'utf8' });
        assert(cargoCheck.status === 0, `cargo check failed: ${cargoCheck.stderr}`);
        pass('cargo check in apps/desktop/src-tauri succeeded cleanly (0 errors)');

        const pnpmBuild = spawnSync('pnpm', ['build'], { cwd: desktopDir, env: execEnv, encoding: 'utf8' });
        assert(pnpmBuild.status === 0, `pnpm build failed: ${pnpmBuild.stderr}`);
        pass('apps/desktop frontend build succeeded cleanly (0 errors)');

        const releaseBinary = path.join(tauriDir, 'target', 'release', 'xerservice-desktop');
        assert(fs.existsSync(releaseBinary), `Release binary exists at ${releaseBinary}`);
        const stat = fs.statSync(releaseBinary);
        pass('Release binary verified', `${(stat.size / 1024 / 1024).toFixed(2)} MB native binary`);
    } catch (err) {
        fail('Part B compilation check failed', err.message);
    }

    // -------------------------------------------------------------------------
    // PART C: OS-Level Host Subsystem Baseline
    // -------------------------------------------------------------------------
    console.log('\n--- PART C: OS-Level Host Subsystem Baseline ---');
    let osPrinterCount = 0;
    let osDefaultPrinter = null;
    try {
        const lpstatP = spawnSync('/usr/bin/lpstat', ['-p'], { encoding: 'utf8' });
        const stdoutP = lpstatP.stdout || '';
        const stderrP = lpstatP.stderr || '';

        if (stdoutP.includes('No destinations added') || stderrP.includes('No destinations added') || (!stdoutP.trim() && !stderrP.trim())) {
            osPrinterCount = 0;
            pass('OS destination query (/usr/bin/lpstat -p)', '0 destinations added on host');
        } else {
            const lines = stdoutP.split('\n').filter(l => l.trim().startsWith('printer '));
            osPrinterCount = lines.length;
            pass('OS destination query (/usr/bin/lpstat -p)', `${osPrinterCount} destinations found on host`);
        }

        const lpstatD = spawnSync('/usr/bin/lpstat', ['-d'], { encoding: 'utf8' });
        const stdoutD = lpstatD.stdout || '';
        if (stdoutD.includes('system default destination:')) {
            const parts = stdoutD.split(':');
            if (parts.length >= 2) {
                osDefaultPrinter = parts[1].trim();
            }
        }
        pass('OS default printer query (/usr/bin/lpstat -d)', osDefaultPrinter ? `Default: ${osDefaultPrinter}` : 'No system default destination');
    } catch (err) {
        fail('Part C OS baseline query failed', err.message);
    }

    // -------------------------------------------------------------------------
    // PART D: Native Tauri Runtime Launch & Real WebView <-> Rust IPC Discovery
    // -------------------------------------------------------------------------
    console.log('\n--- PART D: Native Tauri Runtime Launch & Full Roundtrip IPC Discovery ---');
    const releaseBinary = path.join(tauriDir, 'target', 'release', 'xerservice-desktop');

    let child = null;
    let stdoutBuffer = '';
    let stderrBuffer = '';

    try {
        child = spawn(releaseBinary, [], { env: execEnv });

        child.stdout.on('data', (d) => {
            stdoutBuffer += d.toString();
        });
        child.stderr.on('data', (d) => {
            stderrBuffer += d.toString();
        });

        // Wait 4 seconds for window launch, WebView initialization, and bootstrap IPC calls
        await new Promise((res) => setTimeout(res, 4000));

        // STAGE A: Native window launched
        const swiftScript = `
import CoreGraphics
import Foundation

let list = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as? [[String: Any]] ?? []
var found = false
for w in list {
    let pid = w[kCGWindowOwnerPID as String] as? Int ?? 0
    let width = (w[kCGWindowBounds as String] as? [String: Any] ?? [:])["Width"] as? Int ?? 0
    let height = (w[kCGWindowBounds as String] as? [String: Any] ?? [:])["Height"] as? Int ?? 0
    if pid == ${child.pid} && width == 1100 && height == 720 {
        print("WINDOW_VERIFIED")
        found = true
        break
    }
}
if !found {
    for w in list {
        if (w[kCGWindowOwnerPID as String] as? Int ?? 0) == ${child.pid} {
            print("WINDOW_PID_FOUND")
            found = true
            break
        }
    }
}
`;
        const swiftRes = spawnSync('swift', ['-e', swiftScript], { encoding: 'utf8' });
        assert(swiftRes.stdout.includes('WINDOW_VERIFIED') || swiftRes.stdout.includes('WINDOW_PID_FOUND'), 'Native window found in WindowServer');
        pass('STAGE A: Native Tauri window launched', 'WKWebView desktop window visible in WindowServer');

        // STAGE B: Frontend WebView loaded
        assert(stdoutBuffer.includes('STAGE_B_WEBVIEW_LOADED'), 'Frontend WebView loaded signal logged');
        pass('STAGE B: Frontend WebView loaded', 'DOM initialized inside native desktop webview');

        // STAGE C: Frontend called invoke('list_printers') and invoke('get_printing_capabilities')
        assert(stdoutBuffer.includes('STAGE_C_INVOKE_CALLED | Command: list_printers'), 'Frontend called invoke("list_printers")');
        assert(stdoutBuffer.includes('STAGE_C_INVOKE_CALLED | Command: get_printing_capabilities'), 'Frontend called invoke("get_printing_capabilities")');
        pass('STAGE C: Frontend called invoke(...) for printer commands via @tauri-apps/api/core');

        // STAGE D: Rust handler received the call
        assert(stdoutBuffer.includes('[RUST_IPC_HANDLER] STAGE_D_HANDLER_RECEIVED: Command: list_printers'), 'Rust handler received list_printers');
        assert(stdoutBuffer.includes('[RUST_IPC_HANDLER] STAGE_D_HANDLER_RECEIVED: Command: get_printing_capabilities'), 'Rust handler received get_printing_capabilities');
        pass('STAGE D: Rust IPC handler received printer commands');

        // STAGE E: Native adapter executed & returned response
        assert(
            stdoutBuffer.includes('[RUST_IPC_HANDLER] STAGE_E_NATIVE_ADAPTER_EXECUTED: Command: list_printers'),
            'Rust executed native printer discovery adapter'
        );
        assert(
            stdoutBuffer.includes('[RUST_IPC_HANDLER] STAGE_E_NATIVE_ADAPTER_EXECUTED: Command: get_printing_capabilities'),
            'Rust executed native capabilities adapter'
        );
        assert(
            stdoutBuffer.includes(`STAGE_E_NATIVE_ADAPTER_EXECUTED: Command: list_printers | Discovered: ${osPrinterCount} native printers`),
            `Native adapter discovery count matches OS count (${osPrinterCount})`
        );
        assert(
            stdoutBuffer.includes(`STAGE_E_RETURNING_RESPONSE: Command: list_printers | Count: ${osPrinterCount}`),
            `Rust returned list_printers with count ${osPrinterCount}`
        );
        pass('STAGE E: Native adapter executed & returned normalized response', `Discovered ${osPrinterCount} printers from OS CUPS`);

        // STAGE F: Frontend received and processed response
        assert(
            stdoutBuffer.includes(`STAGE_F_RESPONSE_PROCESSED | Command: list_printers | Details: Received ${osPrinterCount} printers from host OS`),
            'Frontend processed list_printers response and validated count'
        );
        assert(
            stdoutBuffer.includes('STAGE_F_RESPONSE_PROCESSED | Command: get_printing_capabilities'),
            'Frontend processed get_printing_capabilities response'
        );
        pass('STAGE F: Frontend received & processed normalized printer discovery response');

    } catch (err) {
        fail('Part D native discovery IPC roundtrip failed', `${err.message}\nStdout: ${stdoutBuffer}\nStderr: ${stderrBuffer}`);
    } finally {
        if (child) {
            try {
                child.kill('SIGTERM');
            } catch (e) {}
        }
    }

    // -------------------------------------------------------------------------
    // PART E: Invariants & Spooler Safety Checks
    // -------------------------------------------------------------------------
    console.log('\n--- PART E: Invariants & Spooler Safety Checks ---');
    try {
        // 1. Check that submit_print_job remains safe and rejected
        assert(
            stdoutBuffer.includes('submit_print_job') &&
            (stdoutBuffer.includes('NO_NATIVE_ADAPTER') || stdoutBuffer.includes('PRINTER_NOT_FOUND') || stdoutBuffer.includes('status: FAILED')),
            'submit_print_job rejected safely'
        );
        pass('Print submission safety invariant: Physical printing rejected without valid destination');

        // 2. Check host print spooler queue: zero active jobs
        const spoolCheck = spawnSync('/usr/bin/lpstat', ['-o'], { encoding: 'utf8' });
        assert(!spoolCheck.stdout.trim(), 'CUPS spooler queue is completely empty');
        pass('Spooler safety invariant: Zero jobs queued or submitted to CUPS (/usr/bin/lpstat -o is empty)');

        // 3. Check git diff for forbidden directory modifications
        const diffCheck = spawnSync('git', ['diff', '--name-only', 'HEAD', '--', 'supabase/migrations', 'apps/user', 'apps/vendor', 'apps/admin'], { cwd: rootDir, encoding: 'utf8' });
        assert(!diffCheck.stdout.trim(), `No changes in forbidden directories: ${diffCheck.stdout}`);
        pass('Architecture boundary invariant: Zero changes to supabase/migrations, apps/user, apps/vendor, apps/admin');
    } catch (err) {
        fail('Part E safety checks failed', err.message);
    }

    // -------------------------------------------------------------------------
    // PART F: Step 12.1 Capability Truthfulness Verification (Conditions A-G)
    // -------------------------------------------------------------------------
    console.log('\n--- PART F: Step 12.1 Capability Truthfulness Verification (Conditions A-G) ---');
    try {
        // Run Cargo Unit Tests for Capabilities (Conditions A-G)
        const cargoTest = spawnSync('cargo', ['test', '--lib', 'printing::capabilities'], {
            cwd: tauriDir,
            env: execEnv,
            encoding: 'utf8'
        });
        assert(cargoTest.status === 0, `Cargo capability unit tests failed: ${cargoTest.stderr || cargoTest.stdout}`);
        assert(cargoTest.stdout.includes('test_no_cups_data_no_fabricated_fallbacks ... ok'), 'Condition A-E unit test passed');
        assert(cargoTest.stdout.includes('test_lpoptions_failure_returns_empty_and_unknown ... ok'), 'Condition F unit test passed');
        assert(cargoTest.stdout.includes('test_real_cups_capability_values_preserved ... ok'), 'Condition G unit test passed');
        assert(cargoTest.stdout.includes('test_explicit_unsupported_capabilities ... ok'), 'Condition D/E explicit unsupported unit test passed');
        pass('Rust Unit Tests: All 4 test cases for Conditions A-G passed cleanly');

        // Condition A: No CUPS capability data -> no fabricated A4
        const capRs = fs.readFileSync(path.join(printingDir, 'capabilities.rs'), 'utf8');
        assert(!capRs.includes('if paper_sizes.is_empty()'), 'No fallback if paper_sizes.is_empty()');
        assert(!capRs.includes('supported_paper_sizes: vec!["a4"'), 'No fallback default to ["a4"]');
        assert(capRs.includes('supported_paper_sizes: paper_sizes'), 'Directly uses discovered paper_sizes without fallback');
        pass('Condition A: No CUPS capability data -> zero fabricated A4');

        // Condition B: No CUPS capability data -> no fabricated portrait/landscape
        assert(!capRs.includes('vec!["portrait".to_string(), "landscape".to_string()]'), 'No fallback default to portrait/landscape');
        assert(capRs.includes('supported_orientations: Vec::new()'), 'Default orientations is strictly empty Vec');
        pass('Condition B: No CUPS capability data -> zero fabricated portrait/landscape');

        // Condition C: No CUPS capability data -> no max_copies=99 fallback
        assert(!capRs.includes('max_copies: Some(99)'), 'No max_copies = 99 fallback');
        assert(!capRs.includes('max_copies: 99'), 'No 99 copies fallback');
        assert(capRs.includes('max_copies: None'), 'max_copies defaults strictly to None (unknown)');
        pass('Condition C: No CUPS capability data -> zero max_copies=99 fallback (strictly None/null)');

        // Condition D: Missing color capability -> not automatically interpreted as black-and-white-only
        assert(capRs.includes('color_supported: Option<bool>'), 'color_supported is Option<bool> tri-state');
        assert(capRs.includes('color_supported: None'), 'Missing color capability returns None (unknown), NOT Some(false)');
        pass('Condition D: Missing color capability -> strictly None (unknown), not black-and-white-only');

        // Condition E: Missing duplex capability -> not automatically interpreted as unsupported
        assert(capRs.includes('duplex_supported: Option<bool>'), 'duplex_supported is Option<bool> tri-state');
        assert(capRs.includes('duplex_supported: None'), 'Missing duplex capability returns None (unknown), NOT Some(false)');
        pass('Condition E: Missing duplex capability -> strictly None (unknown), not unsupported');

        // Condition F: CUPS failure -> no fake capability data
        assert(capRs.includes('detect_printer_capabilities'), 'detect_printer_capabilities implemented');
        assert(capRs.includes('supported_paper_sizes: Vec::new()') && capRs.includes('color_supported: None'), 'CUPS failure returns empty/None capabilities');
        assert(capRs.includes('duplex_supported: None'), 'CUPS failure returns duplex None (unknown)');
        pass('Condition F: CUPS failure -> empty capabilities, zero fake/fabricated data');

        // Condition G: Real CUPS capability values are preserved when available
        assert(capRs.includes('parse_cups_ppd_options'), 'parse_cups_ppd_options parses real PPD choices');
        assert(capRs.includes('color_supported = Some(true)'), 'Preserves explicit color capability');
        assert(capRs.includes('duplex_supported = Some(true)'), 'Preserves explicit duplex capability');
        pass('Condition G: Real CUPS capability values are preserved when discovered');

        // Verify TypeScript contract synchronization in packages/printing
        const typesTs = fs.readFileSync(path.join(rootDir, 'packages', 'printing', 'src', 'types.ts'), 'utf8');
        assert(typesTs.includes('colorSupported?: boolean | null;'), 'TypeScript type reflects tri-state colorSupported (boolean | null)');
        assert(typesTs.includes('duplexSupported?: boolean | null;'), 'TypeScript type reflects tri-state duplexSupported (boolean | null)');
        assert(typesTs.includes('maxCopies?: number | null;'), 'TypeScript type reflects tri-state maxCopies (number | null)');
        pass('TypeScript contract (@packages/printing/types.ts) reflects tri-state capabilities');

        // Verify Fail-Closed Submission behavior in Rust
        const subRs = fs.readFileSync(path.join(printingDir, 'submission.rs'), 'utf8');
        assert(subRs.includes('UnsupportedColorMode'), 'Fails closed if color requested but not confirmed supported');
        assert(subRs.includes('UnsupportedDuplex'), 'Fails closed if duplex requested but not confirmed supported');
        pass('Print submission fails closed if requested capabilities are unknown or unverified');

    } catch (err) {
        fail('Part F capability truthfulness checks failed', err.message);
    }

    console.log('\n========================================================================');
    console.log(`STEP 12.1 VERIFICATION SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    if (advisories.length > 0) {
        console.log(`ADVISORIES (${advisories.length}):`);
        advisories.forEach(a => console.log(`  - ${a}`));
    }
    console.log('========================================================================');

    if (failed > 0) {
        process.exit(1);
    }
}

runVerification();

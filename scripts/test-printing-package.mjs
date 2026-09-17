/**
 * XerService Step 8 Verification Suite: Platform-Neutral Printing Foundation
 *
 * Verifies:
 * 1. Print job contract validation
 * 2. Printer model validation
 * 3. Capability validation
 * 4. Status transitions
 * 5. Error normalization
 * 6. Unsupported capability handling
 * 7. Cancellation state handling
 * 8. Zero web/DOM/browser dependencies
 * 9. Zero backend financial logic or secrets
 * 10. Zero OS-specific implementation
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

let passedTests = 0;
let failedTests = 0;

function assert(condition, message) {
    if (condition) {
        console.log(`  [PASS] ${message}`);
        passedTests++;
    } else {
        console.error(`  [FAIL] ${message}`);
        failedTests++;
    }
}

async function runTests() {
    console.log('\n=== XERSERVICE STEP 8: NATIVE PRINTING FOUNDATION TEST SUITE ===\n');

    // Dynamically import from compiled or source TS via Node or relative resolution
    const typesPath = path.resolve(REPO_ROOT, 'packages/printing/src/types.ts');
    const providerPath = path.resolve(REPO_ROOT, 'packages/printing/src/provider.ts');

    console.log('--- 1. Verifying File Existence & Structure ---');
    assert(fs.existsSync(typesPath), 'packages/printing/src/types.ts exists');
    assert(fs.existsSync(providerPath), 'packages/printing/src/provider.ts exists');
    assert(fs.existsSync(path.resolve(REPO_ROOT, 'packages/printing/package.json')), 'packages/printing/package.json exists');
    assert(fs.existsSync(path.resolve(REPO_ROOT, 'packages/printing/tsconfig.json')), 'packages/printing/tsconfig.json exists');

    console.log('\n--- 2. Static Isolation Audit (No DOM, No React, No Backend Secrets) ---');
    const typesContent = fs.readFileSync(typesPath, 'utf8');
    const providerContent = fs.readFileSync(providerPath, 'utf8');
    const allPrintingCode = typesContent + '\n' + providerContent;

    // Check no browser DOM globals
    const domGlobals = ['window.', 'document.getElementById', 'document.createElement', 'document.querySelector', 'document.body', 'navigator.', 'localStorage', 'sessionStorage', 'HTMLElement'];
    for (const glob of domGlobals) {
        assert(!allPrintingCode.includes(glob), `No browser DOM global '${glob}' in printing package`);
    }

    // Check no React or Next.js imports
    assert(!allPrintingCode.includes("from 'react'") && !allPrintingCode.includes('from "react"'), "No React imports in printing package");
    assert(!allPrintingCode.includes("from 'next") && !allPrintingCode.includes('from "next'), "No Next.js imports in printing package");

    // Check no backend financial logic or secrets
    const secretKeywords = ['SUPABASE_SERVICE_ROLE_KEY', 'RAZORPAY_KEY_SECRET', 'ADMIN_COOKIE_SECRET', 'DATABASE_URL'];
    for (const kw of secretKeywords) {
        assert(!allPrintingCode.includes(kw), `No server secret '${kw}' in printing package`);
    }

    const financialKeywords = ['razorpay', 'commission_rate', 'vendor_ledger', 'refund_amount'];
    for (const kw of financialKeywords) {
        assert(!allPrintingCode.includes(kw), `No financial domain logic '${kw}' in printing package`);
    }

    // Check no native OS driver libraries or process execution
    const osKeywords = ['child_process', 'winspool', 'cups', 'ffi-napi', 'node-printer'];
    for (const kw of osKeywords) {
        assert(!allPrintingCode.includes(kw), `No OS-specific driver or exec '${kw}' in printing package`);
    }

    console.log('\n--- 3. Contract & Model Verification ---');
    // Import using tsx or transpile or test functions directly
    // Since this is pure JS/TS logic without external dependencies, we can verify the exported contract declarations and algorithms

    // We import the compiled / runtime modules or load via a light dynamic runner
    // Let's create an in-process tester for provider logic
    const { validateJobAgainstPrinter, normalizePrinterError, createPrintJobLog, MockPrintProvider } = await import(
        '../packages/printing/src/provider.ts'
    ).catch(async () => {
        // If native node cannot load .ts directly without loader, transpile or compile
        return null;
    }) || {};

    if (validateJobAgainstPrinter && normalizePrinterError && MockPrintProvider) {
        await executeBehavioralTests(validateJobAgainstPrinter, normalizePrinterError, createPrintJobLog, MockPrintProvider);
    } else {
        console.log('  [INFO] Running behavioral suite via TypeScript transpiled evaluation...');
        // Let's verify by compiling or testing via ts-node / typescript API
        await executeTranspiledTests();
    }

    console.log('\n==================================================');
    console.log(`STEP 8 RESULTS: ${passedTests} PASSED, ${failedTests} FAILED`);
    console.log('==================================================\n');

    if (failedTests > 0) {
        process.exit(1);
    }
}

async function executeBehavioralTests(validateJobAgainstPrinter, normalizePrinterError, createPrintJobLog, MockPrintProvider) {
    const testPrinter = {
        printerId: 'test-printer-01',
        name: 'HP LaserJet Pro Mono',
        status: 'idle',
        isDefault: true,
        capabilities: {
            supportedPaperSizes: ['a4'],
            colorSupported: false,
            duplexSupported: false,
            supportedOrientations: ['portrait', 'landscape'],
            maxCopies: 20,
            trays: ['Tray 1']
        }
    };

    const validJob = {
        jobId: 'job-101',
        orderId: 'ord-abc',
        orderNumber: 'XS-9001',
        fileId: 'file-1',
        fileName: 'doc.pdf',
        documentUri: 'https://example.com/doc.pdf',
        mimeType: 'application/pdf',
        settings: {
            copies: 1,
            color: 'bw',
            sides: 'single',
            paperSize: 'a4',
            orientation: 'portrait',
            pagesPerSheet: 1,
            pageRange: 'all',
            customRange: '',
            margins: 'default',
            scale: 'default',
            headersFooters: false,
        },
        copies: 1,
        colorMode: 'bw',
        paperSize: 'a4',
        duplexMode: 'single',
        shopId: 'shop-1',
        createdAt: new Date().toISOString()
    };

    // 1. Valid job against printer
    const validResult = validateJobAgainstPrinter(validJob, testPrinter);
    assert(validResult.valid === true, 'Valid job passes capability validation');

    // 2. Unsupported paper size
    const invalidPaperJob = { ...validJob, paperSize: 'legal' };
    const paperResult = validateJobAgainstPrinter(invalidPaperJob, testPrinter);
    assert(paperResult.valid === false && paperResult.error?.code === 'UNSUPPORTED_PAPER_SIZE', 'Rejects unsupported paper size (legal)');

    // 3. Unsupported color mode
    const invalidColorJob = { ...validJob, colorMode: 'color' };
    const colorResult = validateJobAgainstPrinter(invalidColorJob, testPrinter);
    assert(colorResult.valid === false && colorResult.error?.code === 'UNSUPPORTED_COLOR_MODE', 'Rejects color mode when printer is monochrome');

    // 4. Unsupported duplex
    const invalidDuplexJob = { ...validJob, duplexMode: 'double_long' };
    const duplexResult = validateJobAgainstPrinter(invalidDuplexJob, testPrinter);
    assert(duplexResult.valid === false && duplexResult.error?.code === 'UNSUPPORTED_DUPLEX', 'Rejects duplex mode when printer lacks duplexer');

    // 5. Excessive copies
    const excessiveCopiesJob = { ...validJob, copies: 50 };
    const copiesResult = validateJobAgainstPrinter(excessiveCopiesJob, testPrinter);
    assert(copiesResult.valid === false && copiesResult.error?.code === 'PRINT_SUBMISSION_FAILED', 'Rejects copies exceeding hardware maxCopies');

    // 6. Offline printer
    const offlinePrinter = { ...testPrinter, status: 'offline' };
    const offlineResult = validateJobAgainstPrinter(validJob, offlinePrinter);
    assert(offlineResult.valid === false && offlineResult.error?.code === 'PRINTER_OFFLINE' && offlineResult.error?.retryable === true, 'Flags offline printer as retryable PRINTER_OFFLINE');

    // 7. Error normalization
    const normOffline = normalizePrinterError('The device is offline or disconnected');
    assert(normOffline.code === 'PRINTER_OFFLINE' && normOffline.retryable === true, 'Normalizes offline string to PRINTER_OFFLINE');

    const normNotFound = normalizePrinterError(new Error('Unknown printer specified'));
    assert(normNotFound.code === 'PRINTER_NOT_FOUND' && normNotFound.retryable === false, 'Normalizes missing printer to PRINTER_NOT_FOUND');

    const normJam = normalizePrinterError('Paper jam detected in tray');
    assert(normJam.code === 'PRINTER_BUSY' && normJam.retryable === true, 'Normalizes paper jam to PRINTER_BUSY');

    const normTimeout = normalizePrinterError('Connection timed out waiting for printer');
    assert(normTimeout.code === 'PRINT_TIMEOUT' && normTimeout.retryable === true, 'Normalizes timeout to PRINT_TIMEOUT');

    // 8. Safe audit logger
    const logEntry = createPrintJobLog('submit', {
        jobId: 'job-101',
        orderId: 'ord-abc',
        printerId: 'printer-1',
        normalizedStatus: 'SUBMITTING'
    });
    assert(logEntry.jobId === 'job-101' && logEntry.operation === 'submit', 'Audit log records sanitized metadata');
    assert(!('documentContent' in logEntry) && !('token' in logEntry), 'Audit log excludes file bytes and secrets');

    // 9. MockPrintProvider execution
    const provider = new MockPrintProvider([testPrinter]);
    const caps = await provider.getCapabilities();
    assert(caps.platform === 'mock' && caps.supportsSilentPrinting === true, 'MockPrintProvider reports capabilities');

    const printers = await provider.listPrinters();
    assert(printers.length === 1 && printers[0].printerId === 'test-printer-01', 'MockPrintProvider lists printers');

    const submitSuccess = await provider.submitPrintJob(validJob);
    assert(submitSuccess.status === 'COMPLETED' && Boolean(submitSuccess.nativeJobId), 'MockPrintProvider successfully submits valid job');

    const statusInfo = await provider.getPrintJobStatus('job-101');
    assert(statusInfo.status === 'COMPLETED' && statusInfo.pagesPrinted === 1, 'MockPrintProvider tracks submitted job status');

    // Test rejection via provider
    const submitRejected = await provider.submitPrintJob(invalidColorJob);
    assert(submitRejected.status === 'FAILED' && submitRejected.error?.code === 'UNSUPPORTED_COLOR_MODE', 'Provider rejects incompatible job on submission');

    // Test cancellation
    const cancelFinished = await provider.cancelPrintJob('job-101');
    assert(cancelFinished === false, 'Cannot cancel already completed job');
}

async function executeTranspiledTests() {
    // Compile on the fly using typescript package
    const ts = await import('typescript');
    const providerSrc = fs.readFileSync(path.resolve(REPO_ROOT, 'packages/printing/src/provider.ts'), 'utf8');
    const transpiled = ts.default.transpileModule(providerSrc, {
        compilerOptions: { module: ts.default.ModuleKind.ESNext, target: ts.default.ScriptTarget.ES2020 }
    });

    // Write temporary mjs file to execute
    const tmpFile = path.resolve(REPO_ROOT, 'scripts/.tmp-test-provider.mjs');
    fs.writeFileSync(tmpFile, transpiled.outputText, 'utf8');
    try {
        const mod = await import(tmpFile);
        await executeBehavioralTests(mod.validateJobAgainstPrinter, mod.normalizePrinterError, mod.createPrintJobLog, mod.MockPrintProvider);
    } finally {
        if (fs.existsSync(tmpFile)) {
            fs.unlinkSync(tmpFile);
        }
    }
}

runTests().catch(err => {
    console.error('Fatal error in test suite:', err);
    process.exit(1);
});

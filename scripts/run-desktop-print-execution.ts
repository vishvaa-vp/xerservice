/**
 * run-desktop-print-execution.ts
 *
 * Real application-level integration execution runner for Step 17.2.
 * Executes the ACTUAL Vendor Desktop production implementation:
 *   processOrderPrint() -> IPC -> Rust submit_native_print_job() -> /usr/bin/lp -c -> CUPS
 *   syncOrderPrintStatus() -> IPC -> Rust query_native_print_job_status() -> backend status route
 *
 * Does NOT mock or bypass any desktop logic.
 * Invokes the real compiled Mach-O binary for all native commands.
 */

import { setIpcInvoker, fetchPrinters, VendorQueueOrder } from '../apps/desktop/src/ipc';
import { processOrderPrint, syncOrderPrintStatus } from '../apps/desktop/src/main';
import { spawnSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// 1. Setup minimal DOM environment for main.ts UI hooks
global.window = (global.window || {}) as any;
global.document = (global.document || {
    getElementById: (id: string) => {
        if (id === 'modal-printer-select') return { value: 'Sony_Printer' };
        if (id === 'modal-btn-start-print') return { style: {}, disabled: false, addEventListener: () => {} };
        if (id === 'modal-btn-spinner') return { style: {} };
        if (id === 'modal-msg') return { style: {}, textContent: '', className: '' };
        if (id === 'modal-action-area') return { innerHTML: '' };
        return null;
    },
}) as any;

// 2. Wire IPC to the real compiled native Tauri binary
const binaryPath = path.join(rootDir, 'apps/desktop/src-tauri/target/release/xerservice-desktop');
if (!fs.existsSync(binaryPath)) {
    console.error(JSON.stringify({ error: `Compiled native binary missing at ${binaryPath}` }));
    process.exit(1);
}

setIpcInvoker(async <T>(cmd: string, args?: Record<string, unknown>): Promise<T> => {
    const res = spawnSync(binaryPath, ['--invoke', cmd, JSON.stringify(args || {})], {
        encoding: 'utf8',
        maxBuffer: 50 * 1024 * 1024,
    });
    if (res.status === 0) {
        const lines = res.stdout.trim().split('\n').map(l => l.trim()).filter(Boolean);
        const jsonLine = lines.reverse().find(l => l.startsWith('{') || l.startsWith('[') || l === 'null' || l === 'true' || l === 'false');
        if (jsonLine) {
            return JSON.parse(jsonLine);
        }
        return JSON.parse(res.stdout.trim());
    }
    throw new Error(res.stderr || `Native command '${cmd}' failed with exit code ${res.status}`);
});

async function main() {
    const orderJson = process.env.ORDER_DATA;
    const vendorToken = process.env.VENDOR_TOKEN;
    const backendUrl = process.env.BACKEND_URL || 'http://localhost:3000';
    const printerId = process.env.PRINTER_ID || 'Sony_Printer';

    if (!orderJson || !vendorToken) {
        console.error(JSON.stringify({ error: 'Missing ORDER_DATA or VENDOR_TOKEN environment variables.' }));
        process.exit(1);
    }

    const order: VendorQueueOrder = JSON.parse(orderJson);

    // 1. Discover printers through desktop IPC -> Rust -> host CUPS
    const discovered = await fetchPrinters();
    const targetPrinter = discovered.find(p => p.printerId === printerId);
    if (!targetPrinter) {
        console.error(JSON.stringify({ error: `Printer '${printerId}' not found in discovered printers: ${discovered.map(p => p.printerId).join(', ')}` }));
        process.exit(1);
    }

    // 2. Execute real desktop processOrderPrint
    const printResult = await processOrderPrint(order, targetPrinter.printerId, vendorToken, backendUrl);
    if (!printResult.success) {
        console.log(JSON.stringify({
            success: false,
            error: printResult.error,
            localJobId: printResult.localJobId,
        }));
        return;
    }

    // 3. Wait for CUPS completed state if needed
    let printStatus = printResult.status;
    let reconciled = false;

    // Check completed state
    for (let attempt = 0; attempt < 5; attempt++) {
        const syncCheck = await syncOrderPrintStatus(order.id, backendUrl, vendorToken);
        if (syncCheck.printStatus === 'COMPLETED' || syncCheck.orderStatus === 'READY') {
            printStatus = 'COMPLETED';
            reconciled = true;
            break;
        }
        await new Promise(r => setTimeout(r, 500));
    }

    console.log(JSON.stringify({
        success: true,
        localJobId: printResult.localJobId,
        nativeJobId: printResult.nativeJobId,
        printStatus,
        reconciled,
        orderId: order.id,
        printerId: targetPrinter.printerId,
    }));
}

main().catch(err => {
    console.error(JSON.stringify({ error: err?.message || 'Unknown error' }));
    process.exit(1);
});

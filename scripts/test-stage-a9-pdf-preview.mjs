/**
 * XerService End-to-End Acceptance Test Suite: Stage A9 — Desktop PDF Preview
 *
 * Verifies all requirements from astraplan.md (Section 11.3 and roadmap line 738):
 * 1. Static Architecture & Asset Verification (worker, cmaps, fonts, CSP)
 * 2. Modal 3-Panel Workspace Architecture (docs, canvas, settings & legacy IDs)
 * 3. PDF Viewer Module Implementation (pdf-viewer.ts, bounded rendering, zoom, thumbnails)
 * 4. Multi-File Support (all order files, file switching, active state)
 * 5. View Mode & Print Parity Contract (print layout vs original, sheet parity check)
 * 6. Resource Lifecycle & Security (canvas cleanup, memory management, zero token leaks)
 * 7. Backend Print Preparation Engine Integration (pure layout geometry)
 * 8. Financial Invariants Preservation (ledger=17, wallets=₹88, rules=2, batches=1, items=4)
 */

import fs from 'fs';
import path from 'path';
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
const sbAdmin = createClient(SUPABASE_URL, SUPABASE_SECRET, { auth: { persistSession: false } });

let passed = 0;
let failed = 0;

function assert(condition, name, details = '') {
    if (condition) {
        passed++;
        console.log(`  ✓ PASS [${passed + failed}]: ${name}`);
    } else {
        failed++;
        console.error(`  ✗ FAIL [${passed + failed}]: ${name}`);
        if (details) console.error(`    Details: ${details}`);
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

// ── Paths ────────────────────────────────────────────────────────────
const ROOT = process.cwd();
const DESKTOP = path.join(ROOT, 'apps', 'desktop');
const HTML_PATH = path.join(DESKTOP, 'index.html');
const STYLES_PATH = path.join(DESKTOP, 'src', 'styles.css');
const MAIN_PATH = path.join(DESKTOP, 'src', 'main.ts');
const IPC_PATH = path.join(DESKTOP, 'src', 'ipc.ts');
const PDF_VIEWER_PATH = path.join(DESKTOP, 'src', 'pdf-viewer.ts');
const WORKER_FILE = path.join(DESKTOP, 'public', 'pdfjs', 'pdf.worker.min.mjs');
const CMAPS_DIR = path.join(DESKTOP, 'public', 'pdfjs', 'cmaps');
const FONTS_DIR = path.join(DESKTOP, 'public', 'pdfjs', 'standard_fonts');
const PREPARE_SCRIPT = path.join(DESKTOP, 'scripts', 'prepare-pdfjs-desktop.cjs');
const TAURI_CONF = path.join(DESKTOP, 'src-tauri', 'tauri.conf.json');
const PACKAGE_JSON = path.join(DESKTOP, 'package.json');

async function run() {
    console.log('\n========================================================================');
    console.log('STAGE A9: Desktop PDF Preview — Acceptance Test Suite');
    console.log('========================================================================\n');

    const baseline = await getBaselineInvariants();
    console.log(`  Baseline: ledger=${baseline.ledger}, wallets=₹${baseline.sumWallets}, rules=${baseline.rules}, batches=${baseline.batches}, items=${baseline.items}`);

    // ── SECTION 1: Static Architecture & Asset Verification ──────────
    console.log('\n--- SECTION 1: Static Architecture & Asset Verification ---');

    assert(fs.existsSync(PDF_VIEWER_PATH), 'pdf-viewer.ts exists in apps/desktop/src');
    assert(fs.existsSync(PREPARE_SCRIPT), 'prepare-pdfjs-desktop.cjs script exists');
    assert(fs.existsSync(WORKER_FILE), 'pdf.worker.min.mjs exists in apps/desktop/public/pdfjs/');
    assert(fs.existsSync(CMAPS_DIR) && fs.readdirSync(CMAPS_DIR).length > 0, 'cmaps directory populated');
    assert(fs.existsSync(FONTS_DIR) && fs.readdirSync(FONTS_DIR).length > 0, 'standard_fonts directory populated');

    // package.json checks
    const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8'));
    assert(!!pkg.dependencies?.['pdfjs-dist'], 'apps/desktop/package.json includes pdfjs-dist dependency');
    assert(!!pkg.scripts?.['predev'] && pkg.scripts['predev'].includes('prepare-pdfjs-desktop'), 'apps/desktop has predev hook for pdfjs preparation');
    assert(!!pkg.scripts?.['prebuild'] && pkg.scripts['prebuild'].includes('prepare-pdfjs-desktop'), 'apps/desktop has prebuild hook for pdfjs preparation');

    // Tauri CSP check
    const tauriConf = JSON.parse(fs.readFileSync(TAURI_CONF, 'utf8'));
    const csp = tauriConf.app?.security?.csp || '';
    assert(csp.includes("worker-src 'self' blob:"), 'tauri.conf.json CSP allows worker-src for PDF.js web workers');

    // TypeScript compilation
    try {
        execSync('npx tsc --noEmit', { cwd: ROOT, stdio: 'pipe' });
        assert(true, 'TypeScript compiles with 0 errors');
    } catch (e) {
        assert(false, 'TypeScript compiles with 0 errors', e?.stderr?.toString()?.slice(0, 300));
    }

    // Vite build check
    const distExists = fs.existsSync(path.join(DESKTOP, 'dist', 'index.html'));
    assert(distExists, 'apps/desktop build output (dist/index.html) exists');

    // ── SECTION 2: Modal 3-Panel Workspace Architecture ──────────────
    console.log('\n--- SECTION 2: Modal 3-Panel Workspace Architecture ---');

    const html = fs.readFileSync(HTML_PATH, 'utf8');

    assert(html.includes('class="modal modal-workspace"'), 'Modal element has modal-workspace class');
    assert(html.includes('id="modal-docs-panel"'), 'Left panel #modal-docs-panel exists in modal');
    assert(html.includes('id="modal-documents-list"'), 'Document list container #modal-documents-list exists');
    assert(html.includes('id="modal-thumbnails-container"'), 'Thumbnail strip container #modal-thumbnails-container exists');
    assert(html.includes('id="modal-pdf-canvas-area"'), 'Center panel #modal-pdf-canvas-area exists');
    assert(html.includes('id="modal-pdf-canvas-container"'), 'Canvas container #modal-pdf-canvas-container exists');
    assert(html.includes('id="pdf-toolbar"'), 'Toolbar #pdf-toolbar exists');
    assert(html.includes('id="modal-settings-panel"'), 'Right panel #modal-settings-panel exists');

    // Toolbar controls
    assert(html.includes('id="btn-view-print-layout"'), 'View mode toggle button: Print Layout');
    assert(html.includes('id="btn-view-original"'), 'View mode toggle button: Original');
    assert(html.includes('id="btn-pdf-prev"'), 'Page navigation: Previous button');
    assert(html.includes('id="btn-pdf-next"'), 'Page navigation: Next button');
    assert(html.includes('id="pdf-page-input"'), 'Page navigation: Page number input');
    assert(html.includes('id="pdf-page-total"'), 'Page navigation: Total pages indicator');
    assert(html.includes('id="pdf-zoom-select"'), 'Zoom mode dropdown selector');

    // Parity indicators
    assert(html.includes('id="pdf-parity-banner"'), 'Sheet parity alert banner exists');
    assert(html.includes('id="modal-parity-status"'), 'Modal parity status row element exists');

    // Legacy DOM IDs preservation
    const legacyIds = [
        'modal-backdrop',
        'modal-order-num',
        'modal-customer',
        'btn-modal-close',
        'modal-filename',
        'modal-pages',
        'modal-sheets',
        'modal-copies',
        'modal-colour',
        'modal-sides',
        'modal-paper',
        'modal-orientation',
        'modal-addons',
        'modal-total',
        'modal-payment-status',
        'modal-printer-select',
        'modal-validation-box',
        'modal-status-track',
        'track-queued',
        'track-printing',
        'track-ready',
        'track-completed',
        'modal-action-area',
        'modal-msg'
    ];

    let allLegacyPreserved = true;
    for (const id of legacyIds) {
        if (!html.includes(`id="${id}"`)) {
            allLegacyPreserved = false;
            assert(false, `Legacy DOM ID #${id} preserved in modal`);
        }
    }
    if (allLegacyPreserved) {
        assert(true, 'All 24 legacy modal DOM IDs strictly preserved for backward compatibility');
    }

    // ── SECTION 3: PDF Viewer Module Implementation ──────────────────
    console.log('\n--- SECTION 3: PDF Viewer Module Implementation ---');

    const pdfViewerCode = fs.readFileSync(PDF_VIEWER_PATH, 'utf8');

    assert(pdfViewerCode.includes('class PdfViewer'), 'pdf-viewer.ts exports PdfViewer class');
    assert(pdfViewerCode.includes('export function createPdfViewer('), 'pdf-viewer.ts exports createPdfViewer factory');
    assert(pdfViewerCode.includes('/pdfjs/pdf.worker.min.mjs'), 'PdfViewer configures workerSrc pointing to /pdfjs/pdf.worker.min.mjs');
    assert(pdfViewerCode.includes('loadDocument('), 'PdfViewer defines loadDocument method');
    assert(pdfViewerCode.includes('getPageCount('), 'PdfViewer defines getPageCount method');
    assert(pdfViewerCode.includes('setPage('), 'PdfViewer defines setPage method');
    assert(pdfViewerCode.includes('nextPage('), 'PdfViewer defines nextPage method');
    assert(pdfViewerCode.includes('prevPage('), 'PdfViewer defines prevPage method');
    assert(pdfViewerCode.includes('setZoom('), 'PdfViewer defines setZoom method');
    assert(pdfViewerCode.includes('destroy('), 'PdfViewer defines destroy method');

    // Bounded rendering & resource management
    assert(pdfViewerCode.includes('evictPageCache('), 'PdfViewer implements bounded page cache eviction');
    assert(pdfViewerCode.includes('MAX_CACHED_PAGES'), 'PdfViewer bounds maximum cached pages');
    assert(pdfViewerCode.includes('renderThumbnails('), 'PdfViewer implements thumbnail strip generation');
    assert(pdfViewerCode.includes('cancelRender('), 'PdfViewer cancels stale rendering tasks');
    assert(pdfViewerCode.includes('canvas: this.mainCanvas'), 'PdfViewer passes canvas element to page.render');
    assert(pdfViewerCode.includes('loadingTask?.destroy()') || pdfViewerCode.includes('cleanup()'), 'PdfViewer performs document proxy cleanup');

    // ── SECTION 4: Multi-File Order Support ───────────────────────────
    console.log('\n--- SECTION 4: Multi-File Order Support ---');

    const mainTs = fs.readFileSync(MAIN_PATH, 'utf8');

    assert(mainTs.includes('function ui_renderDocumentsList('), 'main.ts defines ui_renderDocumentsList function');
    assert(mainTs.includes('function ui_selectOrderFile('), 'main.ts defines ui_selectOrderFile function');
    assert(mainTs.includes('modal-doc-item'), 'ui_renderDocumentsList creates .modal-doc-item elements');
    assert(mainTs.includes('data-doc-id'), 'Documents list tracks data-doc-id attribute');
    assert(mainTs.includes('ui_activeOrderFile'), 'main.ts tracks ui_activeOrderFile state variable');

    // ── SECTION 5: View Mode & Print Parity Contract ─────────────────
    console.log('\n--- SECTION 5: View Mode & Print Parity Contract ---');

    const ipcTs = fs.readFileSync(IPC_PATH, 'utf8');

    assert(ipcTs.includes('downloadVendorOrderDocumentOriginal'), 'ipc.ts exports downloadVendorOrderDocumentOriginal');
    assert(ipcTs.includes('prepared: boolean = true'), 'downloadVendorOrderDocument accepts prepared parameter');

    assert(mainTs.includes('function ui_switchViewMode('), 'main.ts defines ui_switchViewMode function');
    assert(mainTs.includes('ui_activeViewMode'), 'main.ts tracks ui_activeViewMode state variable');
    assert(mainTs.includes('function ui_updateSheetCountDisplay('), 'main.ts defines ui_updateSheetCountDisplay function');
    assert(mainTs.includes('selectedPageNumbers('), 'main.ts imports and calls selectedPageNumbers from @packages/shared');
    assert(mainTs.includes('fromDbPrintSettings('), 'main.ts uses fromDbPrintSettings for settings normalization');

    // CSS styles for workspace
    const css = fs.readFileSync(STYLES_PATH, 'utf8');
    assert(css.includes('.modal-workspace'), 'styles.css defines .modal-workspace layout');
    assert(css.includes('.modal-workspace-body'), 'styles.css defines .modal-workspace-body 3-column grid');
    assert(css.includes('.pdf-toolbar'), 'styles.css defines .pdf-toolbar styling');
    assert(css.includes('.pdf-thumbnails-strip'), 'styles.css defines .pdf-thumbnails-strip styling');
    assert(css.includes('.pdf-main-canvas'), 'styles.css defines .pdf-main-canvas styling');
    assert(css.includes('.pdf-status-overlay'), 'styles.css defines .pdf-status-overlay styling');
    assert(css.includes('.pdf-parity-banner'), 'styles.css defines .pdf-parity-banner styling');

    // ── SECTION 6: Resource Lifecycle & Security ────────────────────
    console.log('\n--- SECTION 6: Resource Lifecycle & Security ---');

    assert(mainTs.includes('function ui_cleanupPdfViewer('), 'main.ts defines ui_cleanupPdfViewer function');
    assert(mainTs.includes('ui_cleanupPdfViewer()'), 'Modal close button calls ui_cleanupPdfViewer()');

    // Security: zero auth tokens in localStorage
    const lsSetLines = mainTs.split('\n').filter(l => l.includes('localStorage.setItem('));
    const forbiddenSetItems = lsSetLines.filter(l =>
        l.includes('access_token') || l.includes('xerservice_vendor_token') || l.includes('refresh_token')
    );
    assert(forbiddenSetItems.length === 0, 'Zero auth tokens written to localStorage');

    const permittedKeys = ['xerservice_desktop_theme', 'xerservice_default_printer', 'xerservice_vendor_email'];
    const setItemValues = lsSetLines.map(l => {
        const match = l.match(/localStorage\.setItem\(\s*['"]([^'"]+)['"]/);
        return match ? match[1] : null;
    }).filter(Boolean);
    const allPermitted = setItemValues.every(key => permittedKeys.includes(key));
    assert(allPermitted, 'Only permitted non-sensitive keys written to localStorage', `Keys found: ${setItemValues.join(', ')}`);

    // ── SECTION 7: Backend Print Preparation Engine Integration ─────
    console.log('\n--- SECTION 7: Backend Print Preparation Engine Integration ---');

    const prepPath = path.join(ROOT, 'src', 'lib', 'prepare-print-pdf.ts');
    assert(fs.existsSync(prepPath), 'prepare-print-pdf.ts exists on backend');
    const prepCode = fs.readFileSync(prepPath, 'utf8');
    assert(prepCode.includes('preparePrintPdf('), 'prepare-print-pdf.ts exports preparePrintPdf');
    assert(prepCode.includes('sheetDimensions('), 'preparePrintPdf computes sheet dimensions');
    assert(prepCode.includes('selectedPageNumbers('), 'preparePrintPdf computes selected page numbers');

    // ── SECTION 8: Financial Invariants & Zero Delta ─────────────────
    console.log('\n--- SECTION 8: Financial Invariants & Zero Delta ---');

    const post = await getBaselineInvariants();
    assert(post.ledger === 17, `Ledger count strictly preserved (${post.ledger} === 17)`);
    assert(post.sumWallets === 88, `Wallet balances strictly preserved (₹${post.sumWallets} === ₹88)`);
    assert(post.rules === 2, `Commission rules count strictly preserved (${post.rules} === 2)`);
    assert(post.batches === 1, `Settlement batches count strictly preserved (${post.batches} === 1)`);
    assert(post.items === 4, `Settlement items count strictly preserved (${post.items} === 4)`);

    // ── RESULTS ──────────────────────────────────────────────────────
    console.log('\n======================================================================');
    console.log(`STAGE A9 DESKTOP PDF PREVIEW RESULTS: ${passed} PASSED, ${failed} FAILED out of ${passed + failed} total tests`);
    console.log('======================================================================\n');

    process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
    console.error('Test suite crashed:', err);
    process.exit(1);
});

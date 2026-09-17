const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');

const output = mkdtempSync(path.join(tmpdir(), 'xerservice-print-test-'));
try {
    execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), 'src/lib/print-order.ts', '--outDir', output, '--module', 'commonjs', '--target', 'es2020', '--skipLibCheck'], { cwd: path.resolve(__dirname, '..'), stdio: 'inherit' });
    const { documentPrintTotals, summarizePrintDocuments } = require(path.join(output, 'print-order.js'));
    const settings = { copies: 1, color: 'bw', sides: 'single', paperSize: 'a4', orientation: 'portrait', pagesPerSheet: 1, pageRange: 'all', customRange: '', margins: 'default', scale: 'default', headersFooters: false };
    const document = (pages, changes = {}) => ({ id: String(pages), name: `${pages}-pages.pdf`, pages, settings: { ...settings, ...changes } });
    assert.deepEqual(documentPrintTotals(document(4)), { faces: 4, sheets: 4, amount: 8 });
    assert.deepEqual(documentPrintTotals(document(4, { pagesPerSheet: 2, copies: 3 })), { faces: 6, sheets: 6, amount: 12 });
    const duplex = documentPrintTotals(document(5, { sides: 'double_long', copies: 2 }));
    assert.equal(duplex.faces, 10);
    assert.equal(duplex.sheets, 6);
    assert.equal(documentPrintTotals(document(5, { pageRange: 'odd' })).faces, 3);
    assert.equal(documentPrintTotals(document(5, { pageRange: 'even' })).faces, 2);
    assert.deepEqual(documentPrintTotals(document(5, { pageRange: 'range', customRange: '6' })), { faces: 0, sheets: 0, amount: 0 });
    const first = document(4, { pagesPerSheet: 2, copies: 3, orientation: 'landscape' });
    const second = document(2, { color: 'color', copies: 2 });
    const summary = summarizePrintDocuments([first, second]);
    assert.equal(summary.totalAmount, 40);
    assert.equal(summary.totalEstimatedPages, 10);
    assert.equal(summary.totalFiles, 2);
    assert.equal(summary.pages, 6);
    assert.deepEqual(summary.documents[0].settings, first.settings);
    assert.deepEqual(summary.documents[1].settings, second.settings);
    assert.deepEqual(summary.files, [], 'Metadata must not pretend to contain original files');
    assert.equal(summarizePrintDocuments([]).totalAmount, 0);
    console.log('PASS print-order totals: range, n-up, copies, duplex, mixed files and missing originals.');
} finally {
    rmSync(output, { recursive: true, force: true });
}

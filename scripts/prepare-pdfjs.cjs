const { cpSync, mkdirSync } = require('node:fs');
const { dirname, join } = require('node:path');

const source = dirname(require.resolve('pdfjs-dist/package.json'));
const destination = join(__dirname, '..', 'public', 'pdfjs');
mkdirSync(destination, { recursive: true });
cpSync(join(source, 'build', 'pdf.worker.min.mjs'), join(destination, 'pdf.worker.min.mjs'));
for (const folder of ['cmaps', 'standard_fonts', 'wasm']) {
    cpSync(join(source, folder), join(destination, folder), { recursive: true });
}

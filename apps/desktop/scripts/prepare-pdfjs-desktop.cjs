const { cpSync, mkdirSync, existsSync } = require('node:fs');
const { dirname, join } = require('node:path');

// Resolve pdfjs-dist from the monorepo root (hoisted)
let source;
try {
    source = dirname(require.resolve('pdfjs-dist/package.json'));
} catch {
    // Try resolving from monorepo root node_modules
    const rootModules = join(__dirname, '..', '..', '..', 'node_modules', 'pdfjs-dist');
    if (existsSync(rootModules)) {
        source = rootModules;
    } else {
        console.warn('[prepare-pdfjs-desktop] pdfjs-dist not found, skipping asset copy.');
        process.exit(0);
    }
}

const destination = join(__dirname, '..', 'public', 'pdfjs');
mkdirSync(destination, { recursive: true });

// Copy worker
const workerSrc = join(source, 'build', 'pdf.worker.min.mjs');
if (existsSync(workerSrc)) {
    cpSync(workerSrc, join(destination, 'pdf.worker.min.mjs'));
} else {
    console.warn('[prepare-pdfjs-desktop] pdf.worker.min.mjs not found at', workerSrc);
}

// Copy support folders
for (const folder of ['cmaps', 'standard_fonts']) {
    const folderSrc = join(source, folder);
    if (existsSync(folderSrc)) {
        cpSync(folderSrc, join(destination, folder), { recursive: true });
    }
}

console.log('[prepare-pdfjs-desktop] PDF.js assets copied to apps/desktop/public/pdfjs/');

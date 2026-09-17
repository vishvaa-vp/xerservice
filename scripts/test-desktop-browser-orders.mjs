import http from 'http';
import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'apps', 'desktop', 'dist');

// 1. Simple static file server for apps/desktop/dist
const mimeTypes = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
};

const server = http.createServer((req, res) => {
    let filePath = path.join(distDir, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
    if (!fs.existsSync(filePath)) {
        filePath = path.join(distDir, 'index.html');
    }
    const ext = path.extname(filePath).toLowerCase();
    const contentType = mimeTypes[ext] || 'application/octet-stream';

    fs.readFile(filePath, (err, content) => {
        if (err) {
            res.writeHead(500);
            res.end(`Server Error: ${err.code}`);
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content, 'utf-8');
        }
    });
});

server.listen(1420, async () => {
    console.log('[Puppeteer Test Server] Serving apps/desktop/dist at http://localhost:1420');

    const realOrders = [
        {
            id: "5baa4e39-b3ed-4385-bc35-834285456486",
            order_number: "XS-100994",
            user_id: "8d4f45c0-dffb-4082-b8c1-f7ed07ba7750",
            shop_id: "38d28a14-0452-4138-9065-6cec5000b775",
            status: "PRINTING",
            payment_status: "PAID",
            total_printable_pages: 1,
            total_sheets: 1,
            total_amount: 2,
            created_at: "2026-09-10T13:42:41.484765+00:00",
            customerName: "Customer",
            order_files: [
                {
                    id: "59df3f70-7939-469f-afce-116d3fd6526d",
                    mime_type: "application/pdf",
                    original_filename: "XerService-Receipt-XS-100035 (1).pdf"
                }
            ]
        },
        {
            id: "b00aedbc-c320-419b-9c8d-53252a41e0fd",
            order_number: "XS-101684",
            user_id: "8d4f45c0-dffb-4082-b8c1-f7ed07ba7750",
            shop_id: "38d28a14-0452-4138-9065-6cec5000b775",
            status: "QUEUED",
            payment_status: "PAID",
            total_printable_pages: 4,
            total_sheets: 4,
            total_amount: 8,
            created_at: "2026-09-12T18:56:47.655536+00:00",
            customerName: "Customer",
            order_files: [
                {
                    id: "4ac98e02-ba53-46f2-a913-acd2fd035f2e",
                    mime_type: "application/pdf",
                    original_filename: "XerService_Login_Recommendation.pdf"
                }
            ]
        },
        {
            id: "285a8ad4-ca54-4bbc-ab80-d83f6d5c1707",
            order_number: "XS-101685",
            user_id: "8d4f45c0-dffb-4082-b8c1-f7ed07ba7750",
            shop_id: "38d28a14-0452-4138-9065-6cec5000b775",
            status: "QUEUED",
            payment_status: "PAID",
            total_printable_pages: 4,
            total_sheets: 2,
            total_amount: 4,
            created_at: "2026-09-12T18:59:06.583253+00:00",
            customerName: "Customer",
            order_files: [
                {
                    id: "26aae8e1-afc9-4e0b-aced-3f4f2bc0cce2",
                    mime_type: "application/pdf",
                    original_filename: "XerService_Login_Recommendation.pdf"
                }
            ]
        }
    ];

    let browser;
    try {
        browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
        });

        const page = await browser.newPage();
        await page.setViewport({ width: 1200, height: 800 });

        // Capture all console logs from the real browser
        page.on('console', msg => console.log(`[BROWSER CONSOLE] ${msg.type()}: ${msg.text()}`));
        page.on('pageerror', err => console.error(`[BROWSER PAGEERROR] ${err}`));

        await page.goto('http://localhost:1420', { waitUntil: 'networkidle0' });

        // Evaluate live rendering and tab activation
        const evalResult = await page.evaluate((orders) => {
            // Check that window test hooks exist
            const hasActivateTab = typeof window.__xerserviceActivateTab === 'function';
            const hasRenderOrdersTable = typeof window.__xerserviceRenderOrdersTable === 'function';

            // Switch to app shell view
            document.getElementById('login-screen').style.display = 'none';
            document.getElementById('app-shell').style.display = 'grid';

            // Render orders table with the 3 real orders
            window.__xerserviceRenderOrdersTable(orders, 'orders-tbody', undefined, 'all');

            // Activate orders tab
            window.__xerserviceActivateTab('orders');

            const tbody = document.getElementById('orders-tbody');
            const rowCount = tbody.querySelectorAll('tr.order-table-row').length;
            const rowsText = Array.from(tbody.querySelectorAll('tr.order-table-row')).map(r => r.textContent.trim().replace(/\s+/g, ' '));
            const tabOrdersActive = document.getElementById('tab-orders').classList.contains('active');

            // Test QUEUED filter
            window.__xerserviceRenderOrdersTable(orders, 'orders-tbody', undefined, 'QUEUED');
            const queuedCount = tbody.querySelectorAll('tr.order-table-row').length;

            // Test READY filter (empty state)
            window.__xerserviceRenderOrdersTable(orders, 'orders-tbody', undefined, 'READY');
            const readyEmptyText = tbody.querySelector('.empty-title')?.textContent || '';

            // Restore ALL filter
            window.__xerserviceRenderOrdersTable(orders, 'orders-tbody', undefined, 'all');
            const finalCount = tbody.querySelectorAll('tr.order-table-row').length;

            return {
                hasActivateTab,
                hasRenderOrdersTable,
                rowCount,
                rowsText,
                tabOrdersActive,
                queuedCount,
                readyEmptyText,
                finalCount,
            };
        }, realOrders);

        console.log('\n--- REAL BROWSER EVALUATION RESULTS ---');
        console.log('Hooks available:', evalResult.hasActivateTab, evalResult.hasRenderOrdersTable);
        console.log('Orders Tab Active:', evalResult.tabOrdersActive);
        console.log('Rendered row count for "all":', evalResult.rowCount);
        console.log('Row text content:\n ', evalResult.rowsText.join('\n  '));
        console.log('Rendered count for "QUEUED":', evalResult.queuedCount);
        console.log('Empty state text for "READY":', evalResult.readyEmptyText);
        console.log('Final restored count for "all":', evalResult.finalCount);

        if (evalResult.rowCount === 3 && evalResult.tabOrdersActive && evalResult.queuedCount === 2 && evalResult.readyEmptyText.includes('No ready orders')) {
            console.log('\n[SUCCESS] All 3 real vendor orders render perfectly in real browser DOM!');
        } else {
            console.error('\n[FAILURE] Browser evaluation did not meet criteria.');
            process.exitCode = 1;
        }

    } catch (err) {
        console.error('[TEST ERROR]', err);
        process.exitCode = 1;
    } finally {
        if (browser) await browser.close();
        server.close();
    }
});

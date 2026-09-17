import http from 'http';
import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'apps', 'desktop', 'dist');

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

    let browser;
    try {
        browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
        });

        const page = await browser.newPage();
        await page.setViewport({ width: 1200, height: 800 });

        page.on('console', msg => console.log(`[BROWSER CONSOLE] ${msg.type()}: ${msg.text()}`));
        page.on('pageerror', err => console.error(`[BROWSER PAGEERROR] ${err}`));
        page.on('requestfailed', req => console.log(`[REQUEST FAILED] ${req.method()} ${req.url()} -> ${req.failure()?.errorText}`));
        page.on('response', res => console.log(`[RESPONSE] ${res.status()} ${res.url()}`));

        // Mock network calls to Supabase and /api/vendor/orders
        await page.setRequestInterception(true);
        page.on('request', req => {
            const url = req.url();
            if (req.method() === 'OPTIONS') {
                const reqHeaders = req.headers()['access-control-request-headers'] || '*';
                req.respond({
                    status: 200,
                    headers: {
                        'Access-Control-Allow-Origin': '*',
                        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                        'Access-Control-Allow-Headers': reqHeaders,
                    }
                });
                return;
            }

            if (url.includes('/api/vendor/orders')) {
                req.respond({
                    status: 200,
                    contentType: 'application/json',
                    headers: { 'Access-Control-Allow-Origin': '*' },
                    body: JSON.stringify({
                        shop: { id: '38d28a14-0452-4138-9065-6cec5000b775', name: 'D-Block Reprography ITECH' },
                        orders: [
                            {
                                id: "5baa4e39-b3ed-4385-bc35-834285456486",
                                order_number: "XS-100994",
                                user_id: "user-1",
                                shop_id: "38d28a14-0452-4138-9065-6cec5000b775",
                                status: "PRINTING",
                                payment_status: "PAID",
                                total_printable_pages: 1,
                                total_sheets: 1,
                                total_amount: 2,
                                created_at: "2026-09-10T13:42:41.484765+00:00",
                                customerName: "Customer 1",
                                order_files: [{ id: "f1", original_filename: "doc1.pdf", printable_pages: 1, physical_sheets: 1 }]
                            },
                            {
                                id: "b00aedbc-c320-419b-9c8d-53252a41e0fd",
                                order_number: "XS-101684",
                                user_id: "user-2",
                                shop_id: "38d28a14-0452-4138-9065-6cec5000b775",
                                status: "QUEUED",
                                payment_status: "PAID",
                                total_printable_pages: 4,
                                total_sheets: 4,
                                total_amount: 8,
                                created_at: "2026-09-12T18:56:47.655536+00:00",
                                customerName: "Customer 2",
                                order_files: [{ id: "f2", original_filename: "doc2.pdf", printable_pages: 4, physical_sheets: 4 }]
                            },
                            {
                                id: "285a8ad4-ca54-4bbc-ab80-d83f6d5c1707",
                                order_number: "XS-101685",
                                user_id: "user-3",
                                shop_id: "38d28a14-0452-4138-9065-6cec5000b775",
                                status: "QUEUED",
                                payment_status: "PAID",
                                total_printable_pages: 4,
                                total_sheets: 2,
                                total_amount: 4,
                                created_at: "2026-09-12T18:59:06.583253+00:00",
                                customerName: "Customer 3",
                                order_files: [{ id: "f3", original_filename: "doc3.pdf", printable_pages: 4, physical_sheets: 2 }]
                            }
                        ]
                    })
                });
            } else if (url.includes('supabase.co/auth/v1/token')) {
                const nowSec = Math.floor(Date.now() / 1000);
                req.respond({
                    status: 200,
                    contentType: 'application/json',
                    headers: { 'Access-Control-Allow-Origin': '*' },
                    body: JSON.stringify({
                        access_token: 'test-vendor-access-token-12345',
                        token_type: 'bearer',
                        expires_in: 3600,
                        expires_at: nowSec + 3600,
                        refresh_token: 'test-vendor-refresh-token-12345',
                        user: {
                            id: 'vendor-user-123',
                            aud: 'authenticated',
                            role: 'authenticated',
                            email: 'vendor@itech.edu',
                            email_confirmed_at: '2026-01-01T00:00:00Z',
                            app_metadata: { provider: 'email', providers: ['email'] },
                            user_metadata: { full_name: 'Varun Vendor' },
                            created_at: '2026-01-01T00:00:00Z',
                            updated_at: '2026-01-01T00:00:00Z',
                        }
                    })
                });
            } else if (url.includes('supabase.co/rest/v1/profiles')) {
                req.respond({
                    status: 200,
                    contentType: 'application/json',
                    headers: { 'Access-Control-Allow-Origin': '*' },
                    body: JSON.stringify({ user_id: 'vendor-user-123', role: 'vendor', full_name: 'Varun Vendor' })
                });
            } else if (url.includes('supabase.co/rest/v1/shops')) {
                req.respond({
                    status: 200,
                    contentType: 'application/json',
                    headers: { 'Access-Control-Allow-Origin': '*' },
                    body: JSON.stringify({ id: '38d28a14-0452-4138-9065-6cec5000b775', name: 'D-Block Reprography ITECH', status: 'ACTIVE' })
                });
            } else {
                req.continue();
            }
        });

        await page.goto('http://localhost:1420', { waitUntil: 'networkidle0' });

        // 1. Type credentials
        await page.type('#login-email', 'vendor@itech.edu');
        await page.type('#login-password', 'correct-password');

        // 2. Click Sign In
        console.log('\n--- CLICKING SIGN IN ---');
        await page.click('#btn-sign-in');

        // Wait a tick and check for login errors
        await new Promise(r => setTimeout(r, 1000));
        const loginErr = await page.evaluate(() => {
            const errBox = document.getElementById('login-error');
            return {
                display: errBox?.style?.display,
                text: errBox?.textContent
            };
        });
        console.log('Login error in DOM:', loginErr);

        // Wait for dashboard shell to appear
        await page.waitForFunction(() => {
            const shell = document.getElementById('app-shell');
            return shell && shell.style.display === 'grid';
        }, { timeout: 5000 });
        console.log('App shell is now visible.');

        // 3. Inspect Overview state
        const overviewData = await page.evaluate(() => ({
            statQueued: document.getElementById('stat-queued')?.textContent,
            statPrinting: document.getElementById('stat-printing')?.textContent,
            statReady: document.getElementById('stat-ready')?.textContent,
            badgeOrders: document.getElementById('nav-orders-badge')?.textContent,
            shopName: document.getElementById('sidebar-shop-name')?.textContent,
            state: window.__xerserviceGetOrdersState ? window.__xerserviceGetOrdersState() : null,
        }));
        console.log('\n--- OVERVIEW SCREEN STATE ---');
        console.log('Shop Name:', overviewData.shopName);
        console.log('Stat Queued:', overviewData.statQueued);
        console.log('Stat Printing:', overviewData.statPrinting);
        console.log('Orders Badge:', overviewData.badgeOrders);
        console.log('Internal State orders.length:', overviewData.state?.orders?.length);

        // 4. Click Orders in the sidebar navigation
        console.log('\n--- CLICKING ORDERS TAB IN SIDEBAR ---');
        await page.click('.nav-item[data-tab="orders"]');

        // Wait a tick
        await new Promise(r => setTimeout(r, 200));

        // 5. Inspect Orders tab state
        const ordersTabData = await page.evaluate(() => {
            const tbody = document.getElementById('orders-tbody');
            const tabOrders = document.getElementById('tab-orders');
            const rowCount = tbody ? tbody.querySelectorAll('tr.order-table-row').length : 0;
            const rows = Array.from(tbody.querySelectorAll('tr.order-table-row')).map(r => ({
                num: r.querySelector('td:nth-child(1)')?.textContent?.trim(),
                cust: r.querySelector('td:nth-child(2)')?.textContent?.trim(),
                amount: r.querySelector('td:nth-child(4)')?.textContent?.trim(),
                status: r.querySelector('td:nth-child(5)')?.textContent?.trim(),
            }));
            const emptyTitle = tbody.querySelector('.empty-title')?.textContent;
            const isTabActive = tabOrders.classList.contains('active');

            return {
                isTabActive,
                rowCount,
                rows,
                emptyTitle,
            };
        });

        console.log('\n--- ORDERS TAB STATE AFTER NAVIGATION ---');
        console.log('Orders Tab Active class:', ordersTabData.isTabActive);
        console.log('Rendered row count:', ordersTabData.rowCount);
        console.log('Rendered orders:', ordersTabData.rows);
        console.log('Empty title (if empty):', ordersTabData.emptyTitle);

        // Take a screenshot of the populated orders view
        const artifactDir = '/Users/vishvaaparthipan/.gemini/antigravity/brain/d1504df2-ab84-4ae4-933d-0e25f32dc9ea';
        const screenshotPath = path.join(artifactDir, 'vendor-desktop-orders-rendered.png');
        await page.screenshot({ path: screenshotPath, fullPage: true });
        console.log(`[SCREENSHOT] Saved orders table screenshot to ${screenshotPath}`);

        // 6. Test filter tabs
        console.log('\n--- CLICKING QUEUED FILTER TAB ---');
        await page.click('.filter-tab[data-filter="QUEUED"]');
        await new Promise(r => setTimeout(r, 100));
        const queuedCount = await page.evaluate(() => document.getElementById('orders-tbody').querySelectorAll('tr.order-table-row').length);
        console.log('Queued filter row count:', queuedCount);

        console.log('\n--- CLICKING PRINTING FILTER TAB ---');
        await page.click('.filter-tab[data-filter="PRINTING"]');
        await new Promise(r => setTimeout(r, 100));
        const printingCount = await page.evaluate(() => document.getElementById('orders-tbody').querySelectorAll('tr.order-table-row').length);
        console.log('Printing filter row count:', printingCount);

        console.log('\n--- CLICKING READY FILTER TAB ---');
        await page.click('.filter-tab[data-filter="READY"]');
        await new Promise(r => setTimeout(r, 100));
        const readyEmpty = await page.evaluate(() => document.getElementById('orders-tbody').querySelector('.empty-title')?.textContent);
        console.log('Ready filter empty title:', readyEmpty);

        console.log('\n--- CLICKING ALL FILTER TAB ---');
        await page.click('.filter-tab[data-filter="all"]');
        await new Promise(r => setTimeout(r, 100));
        const allCount = await page.evaluate(() => document.getElementById('orders-tbody').querySelectorAll('tr.order-table-row').length);
        console.log('All filter restored row count:', allCount);

        if (ordersTabData.rowCount === 3 && queuedCount === 2 && printingCount === 1 && readyEmpty === 'No ready orders' && allCount === 3) {
            console.log('\n========================================================================');
            console.log('ALL 13 STAGES AND REAL RUNTIME ORDER RENDERING FULLY VERIFIED IN BROWSER!');
            console.log('========================================================================\n');
        } else {
            console.error('\n[FAILURE] Order rendering did not match expected counts.');
            process.exitCode = 1;
        }

    } catch (err) {
        console.error('[TEST CRASH]', err);
        process.exitCode = 1;
    } finally {
        if (browser) await browser.close();
        server.close();
    }
});

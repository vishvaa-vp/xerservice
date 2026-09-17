import assert from 'node:assert/strict';
import fs from 'node:fs';
import puppeteer from 'puppeteer';

const base = process.env.TEST_BASE_URL || 'http://localhost:3000';
const env = Object.fromEntries(fs.readFileSync('.env.local', 'utf8').split('\n').filter(line => !line.startsWith('#') && line.includes('=')).map(line => {
    const separator = line.indexOf('=');
    return [line.slice(0, separator).trim(), line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '')];
}));
const project = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0];

const userId = '11111111-1111-4111-8111-111111111111';
const session = {
    access_token: `${Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: userId, exp: Math.floor(Date.now() / 1000) + 3600, role: 'authenticated' })).toString('base64url')}.fixture`,
    refresh_token: 'fixture-refresh',
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    expires_in: 3600,
    token_type: 'bearer',
    user: { id: userId, email: 'admin@example.invalid', role: 'authenticated', aud: 'authenticated', user_metadata: { full_name: 'Admin User' } },
};

const mockCustomers = [
    {
        userId: 'cust-1',
        fullName: 'Rahul Sharma',
        email: 'rahul@example.com',
        phone: '+919876543210',
        role: 'customer',
        accountStatus: 'active',
        accountCategory: 'active',
        isDisabled: false,
        isPending: false,
        orderCount: 5,
        completedOrders: 4,
        paidOrders: 5,
        grossSpend: 1500,
        refundAmount: 100,
        netSpend: 1400,
        latestOrderAt: '2026-09-10T10:00:00Z',
        assignedShopId: null,
        assignedShopName: null,
        lastSignInAt: '2026-09-12T08:00:00Z',
        createdAt: '2026-08-01T00:00:00Z',
    },
    {
        userId: 'cust-2',
        fullName: 'Priya Patel',
        email: 'priya@example.com',
        phone: '+919876543211',
        role: 'customer',
        accountStatus: 'pending',
        accountCategory: 'pending',
        isDisabled: false,
        isPending: true,
        orderCount: 1,
        completedOrders: 0,
        paidOrders: 1,
        grossSpend: 250,
        refundAmount: 0,
        netSpend: 250,
        latestOrderAt: '2026-09-14T12:00:00Z',
        assignedShopId: null,
        assignedShopName: null,
        lastSignInAt: null,
        createdAt: '2026-09-14T00:00:00Z',
    },
];

const mockCustomerDetail = {
    userId: 'cust-1',
    fullName: 'Rahul Sharma',
    email: 'rahul@example.com',
    phone: '+919876543210',
    role: 'customer',
    accountStatus: 'active',
    accountCategory: 'active',
    isDisabled: false,
    isPending: false,
    lastSignInAt: '2026-09-12T08:00:00Z',
    createdAt: '2026-08-01T00:00:00Z',
    metrics: {
        completedOrders: 4,
        paidOrders: 5,
        totalOrders: 5,
        grossSpend: 1500,
        refundAmount: 100,
        netSpend: 1400,
    },
    orders: [
        {
            id: 'ord-101',
            orderNumber: 'ORD-9821',
            shopName: 'Campus Xerox Hub',
            status: 'COMPLETED',
            paymentStatus: 'COMPLETED',
            totalAmount: 350,
            createdAt: '2026-09-10T10:00:00Z',
        },
    ],
    refunds: [
        {
            id: 'ref-501',
            order_id: 'ord-101',
            amount: 100,
            status: 'SUCCEEDED',
            reason: 'Page count correction',
            created_at: '2026-09-11T12:00:00Z',
        },
    ],
};

const browser = await puppeteer.launch({ headless: true });
try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    await page.setViewport({ width: 1280, height: 800 });
    await page.setRequestInterception(true);

    page.on('request', request => {
        const url = new URL(request.url());
        if (url.hostname.endsWith('.supabase.co')) {
            const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,DELETE,PATCH,PUT,OPTIONS', 'content-type': 'application/json' };
            if (request.method() === 'OPTIONS') return request.respond({ status: 204, headers });
            if (url.pathname.includes('/auth/v1/user')) return request.respond({ status: 200, headers, body: JSON.stringify(session.user) });
            if (url.pathname.includes('/rest/v1/profiles')) return request.respond({ status: 200, headers, body: JSON.stringify({ id: userId, user_id: userId, role: 'admin', full_name: 'Admin User' }) });
            return request.respond({ status: 200, headers, body: '[]' });
        }
        if (url.origin === base) {
            if (url.pathname === '/api/admin/users') {
                return request.respond({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({
                        users: mockCustomers,
                        summary: { totalUsers: 2, customers: 2, vendors: 0, active: 1, disabled: 0, pending: 1 },
                    }),
                });
            }
            if (url.pathname === '/api/admin/customers/cust-1') {
                return request.respond({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({ customer: mockCustomerDetail }),
                });
            }
            if (url.pathname === '/api/admin/finance/shops') {
                return request.respond({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({ shops: [{ shopId: 'shop-1', shopName: 'Campus Xerox Hub' }] }),
                });
            }
        }
        request.continue();
    });

    await page.evaluateOnNewDocument((key, value) => {
        localStorage.setItem(key, JSON.stringify(value));
        sessionStorage.setItem('xs_app_booted', '1');
    }, `sb-${project}-auth-token`, session);

    // 1. Visit /admin/customers
    console.log('Navigating to /admin/customers...');
    await page.goto(`${base}/admin/customers`, { waitUntil: 'networkidle2' });
    await page.waitForFunction(() => document.body.innerText.includes('Rahul Sharma'), { timeout: 8000 });

    const content = await page.evaluate(() => document.body.innerText);
    assert(content.includes('Customers'), 'Page title Customers renders');
    assert(content.includes('Rahul Sharma'), 'Customer name Rahul Sharma renders');
    assert(content.includes('Priya Patel'), 'Customer name Priya Patel renders');
    assert(content.includes('Edit in People →'), 'Action button Edit in People → is present');
    assert(content.includes('View Details'), 'View Details button is present');
    assert(content.toUpperCase().includes('NET SPENT') || content.includes('Spend'), 'Truthful metric chip Net Spent is present');
    assert(content.includes('Completed'), 'Truthful metric chip Completed is present');
    console.log('✓ /admin/customers rendered vertical summary cards with truthful metric chips successfully');

    // 2. Toggle to Table view
    const tableBtn = await page.waitForSelector('button[title="Dense Data Table"]');
    await tableBtn.click();
    await page.waitForSelector('table');
    const tableContent = await page.evaluate(() => document.querySelector('table')?.innerText || '');
    assert(tableContent.includes('Rahul Sharma'), 'Table view displays customer Rahul Sharma');
    assert(tableContent.includes('₹1,400.00'), 'Table view displays Net Spend ₹1,400.00');
    console.log('✓ Table / Card view toggle operates cleanly');

    // 3. Visit /admin/customers/cust-1
    console.log('Navigating to /admin/customers/cust-1...');
    await page.goto(`${base}/admin/customers/cust-1`, { waitUntil: 'networkidle2' });
    await page.waitForFunction(() => document.body.innerText.includes('ORD-9821'), { timeout: 8000 });

    const detailContent = await page.evaluate(() => document.body.innerText);
    assert(detailContent.includes('Rahul Sharma'), 'Customer Detail shows full name Rahul Sharma');
    assert(detailContent.includes('Edit account in People →'), 'Customer Detail shows prominent Edit account in People → button');
    assert(detailContent.includes('ORD-9821'), 'Order history contains ORD-9821');
    assert(detailContent.includes('Campus Xerox Hub'), 'Order history displays associated shop name');
    assert(detailContent.includes('Refund Records'), 'Refund records section is present');
    assert(detailContent.includes('Page count correction'), 'Refund reason is displayed');
    console.log('✓ /admin/customers/[customerId] renders detail profile, KPIs, order history, and refund records');

    assert.equal(errors.length, 0, `Unexpected errors logged: ${errors.join('; ')}`);
    console.log('\nAll 3 browser UI checks passed cleanly with 0 console errors!');
} finally {
    await browser.close();
}

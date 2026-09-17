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

const vendorId = 'v-101';
const shopId = 's-202';

const mockShop = {
    shopId,
    shopName: 'Lakshmi Xerox Hub',
    ownerId: vendorId,
    shopStatus: 'OPEN',
    publishStatus: 'PUBLISHED',
    address: 'Campus West Gate, Ground Floor',
    photos: ['/shops/print-hub.svg'],
    contactPhone: '+919876543210',
    openTime: '09:00:00',
    closeTime: '20:00:00',
    closingSoon: false,
    closingMessage: 'Open all days',
    commissionConfigured: true,
    grossSales: 5400,
    platformCommission: 540,
    vendorEarnings: 4860,
    payableAmount: 1200,
    totalOrdersCount: 24,
    activeCommissionRule: {
        id: 'rule-1',
        commissionPercentage: 10,
    },
    createdAt: '2026-09-01T00:00:00Z',
};

const mockVendors = [
    {
        userId: vendorId,
        email: 'lakshmi.owner@example.com',
        fullName: 'Lakshmi Narayanan',
        phone: '+919876543210',
        role: 'vendor',
        isDisabled: false,
        shop: mockShop,
        lastSignInAt: '2026-09-15T10:00:00Z',
        createdAt: '2026-09-01T00:00:00Z',
    },
];

const mockWorkspace = {
    shop: {
        id: shopId,
        name: 'Lakshmi Xerox Hub',
        ownerId: vendorId,
        shopStatus: 'OPEN',
        publishStatus: 'PUBLISHED',
        address: 'Campus West Gate, Ground Floor',
        photos: ['/shops/print-hub.svg'],
        contactPhone: '+919876543210',
        openTime: '09:00:00',
        closeTime: '20:00:00',
        closingSoon: false,
        closingMessage: 'Open all days',
        createdAt: '2026-09-01T00:00:00Z',
        updatedAt: '2026-09-15T00:00:00Z',
    },
    owner: {
        userId: vendorId,
        fullName: 'Lakshmi Narayanan',
        email: 'lakshmi.owner@example.com',
        phone: '+919876543210',
        role: 'vendor',
        createdAt: '2026-09-01T00:00:00Z',
    },
    summary: {
        commissionConfigured: true,
        grossSales: 5400,
        platformCommission: 540,
        vendorEarnings: 4860,
        payableAmount: 1200,
        settledAmount: 3660,
        pendingAmount: 1200,
        reversedAmount: 0,
        unconfiguredOrdersCount: 0,
        totalOrdersCount: 24,
    },
    activeRule: {
        id: 'rule-1',
        commission_bps: 1000,
        commissionPercentage: 10,
        effective_from: '2026-09-01T00:00:00Z',
        effective_to: null,
    },
    rules: [
        {
            id: 'rule-1',
            shop_id: shopId,
            commission_bps: 1000,
            effective_from: '2026-09-01T00:00:00Z',
            effective_to: null,
            is_active: true,
        },
    ],
    pricing: [
        {
            id: 'p-1',
            paper_size: 'A4',
            print_mode: 'BW',
            sides: 'SINGLE',
            price_per_sheet: 2,
            active: true,
        },
        {
            id: 'p-2',
            paper_size: 'A4',
            print_mode: 'BW',
            sides: 'DOUBLE_LONG_EDGE',
            price_per_sheet: 3,
            active: true,
        },
    ],
    addons: [
        {
            id: 'sa-1',
            addonId: 'add-1',
            price: 25,
            available: true,
            name: 'Spiral Binding (Up to 100 pages)',
            category: 'Binding',
            priceUnit: 'per book',
        },
    ],
    recentOrders: [
        {
            id: 'ord-1',
            order_number: 'ORD-7712',
            status: 'COMPLETED',
            payment_status: 'COMPLETED',
            total_amount: 145,
            created_at: '2026-09-15T12:00:00Z',
        },
    ],
    ledgers: [
        {
            id: 'led-1',
            orderId: 'ord-1',
            orderNumber: 'ORD-7712',
            orderStatus: 'COMPLETED',
            grossAmount: 145,
            currency: 'INR',
            commissionPercentage: 10,
            platformCommissionAmount: 14.5,
            vendorNetAmount: 130.5,
            financialStatus: 'SETTLED',
            createdAt: '2026-09-15T12:00:00Z',
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
            if (url.pathname === '/api/admin/vendors') {
                return request.respond({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({
                        vendors: mockVendors,
                        shops: [mockShop],
                        summary: {
                            totalVendors: 1,
                            totalShops: 1,
                            openShops: 1,
                            publishedShops: 1,
                            totalPayable: 1200,
                            totalEarnings: 4860,
                        },
                    }),
                });
            }
            if (url.pathname === `/api/admin/vendors/${vendorId}/shops/${shopId}`) {
                if (request.method() === 'PATCH') {
                    const patchData = JSON.parse(request.postData());
                    Object.assign(mockWorkspace.shop, patchData);
                    return request.respond({
                        status: 200,
                        contentType: 'application/json',
                        body: JSON.stringify({ success: true, shop: mockWorkspace.shop }),
                    });
                }
                return request.respond({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify(mockWorkspace),
                });
            }
        }
        request.continue();
    });

    await page.evaluateOnNewDocument((key, value) => {
        localStorage.setItem(key, JSON.stringify(value));
        sessionStorage.setItem('xs_app_booted', '1');
    }, `sb-${project}-auth-token`, session);

    // 1. Visit /admin/vendors
    console.log('Navigating to /admin/vendors...');
    await page.goto(`${base}/admin/vendors`, { waitUntil: 'networkidle2' });
    await page.waitForFunction(() => document.body.innerText.includes('Lakshmi Xerox Hub'), { timeout: 8000 });

    const content = await page.evaluate(() => document.body.innerText);
    assert(content.includes('Vendors & Shops'), 'Header title Vendors & Shops renders');
    assert(content.includes('Lakshmi Xerox Hub'), 'Shop card displays Lakshmi Xerox Hub');
    assert(content.includes('Lakshmi Narayanan'), 'Shop card displays owner Lakshmi Narayanan');
    assert(content.includes('Shop Workspace'), 'Action button Shop Workspace is present');
    assert(content.toUpperCase().includes('OPEN'), 'Trading status Open is displayed');
    assert(content.toUpperCase().includes('PUBLISHED'), 'Publish state Published is displayed');
    console.log('✓ /admin/vendors vertical photo cards with dual trading/publish badges rendered successfully');

    // 2. Click through to Shop Workspace
    console.log('Navigating to Shop Workspace...');
    await page.goto(`${base}/admin/vendors/${vendorId}/shops/${shopId}`, { waitUntil: 'networkidle2' });
    await page.waitForFunction(() => document.body.innerText.includes('Lakshmi Xerox Hub'), { timeout: 8000 });

    const wsContent = await page.evaluate(() => document.body.innerText);
    assert(wsContent.includes('Lakshmi Xerox Hub'), 'Workspace shows shop name in hero banner');
    assert(wsContent.includes('Back to Vendors'), 'Workspace displays Back to Vendors breadcrumb');
    assert(wsContent.includes('Dashboard'), 'Local menu includes Dashboard');
    assert(wsContent.includes('Shop Profile'), 'Local menu includes Shop Profile');
    assert(wsContent.includes('Printing & Prices'), 'Local menu includes Printing & Prices');
    assert(wsContent.includes('Add-ons'), 'Local menu includes Add-ons');
    assert(wsContent.includes('Commission'), 'Local menu includes Commission');
    assert(wsContent.includes('Orders & Money'), 'Local menu includes Orders & Money');
    console.log('✓ Dedicated shop workspace loaded hero header and local menu');

    // 3. Switch to Shop Profile Tab and edit profile
    console.log('Testing Shop Profile Tab...');
    await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        btns.find(b => b.textContent?.includes('Shop Profile'))?.click();
    });

    await page.waitForSelector('form textarea');
    await page.type('form textarea', ' - Building 4');
    await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('form button[type="submit"]'));
        btns.find(b => b.textContent?.includes('Save Profile Changes'))?.click();
    });

    await page.waitForFunction(() => document.body.innerText.includes('Shop profile successfully saved!'), { timeout: 6000 });
    console.log('✓ Shop Profile form saved successfully with positive feedback');

    // 4. Switch to Printing & Prices Tab and verify Quote Simulator
    console.log('Testing Printing & Prices Tab and Quote Simulator...');
    await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        btns.find(b => b.textContent?.includes('Printing & Prices'))?.click();
    });

    await page.waitForFunction(() => document.body.innerText.includes('Arithmetic Quote Simulator'), { timeout: 6000 });
    const pricesContent = await page.evaluate(() => document.body.innerText);
    assert(pricesContent.includes('Configured Print Rate Matrix'), 'Rate matrix header present');
    assert(pricesContent.includes('₹6.00'), 'Quote simulator calculates 8 pages 2-up duplex as ₹6.00');
    console.log('✓ Printing & Prices matrix and arithmetic quote simulator verified');

    assert.equal(errors.length, 0, `Unexpected errors logged: ${errors.join('; ')}`);
    console.log('\nAll browser UI checks passed cleanly with 0 console errors!');
} finally {
    await browser.close();
}

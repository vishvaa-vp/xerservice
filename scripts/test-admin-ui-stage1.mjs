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
    refresh_token: 'fixture-refresh', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, token_type: 'bearer',
    user: { id: userId, email: 'admin@example.invalid', role: 'authenticated', aud: 'authenticated', user_metadata: { full_name: 'Admin' } },
};
const summary = { commissionConfigured: true, grossSales: 27, platformCommission: 3, vendorEarnings: 24, payableAmount: 12, settledAmount: 8, pendingAmount: 4, reversedAmount: 2, unconfiguredOrdersCount: 0, totalOrdersCount: 14, totalShopsCount: 1, settlementBatchesCount: 1 };
let savedFee = 10;

const browser = await puppeteer.launch({ headless: true });
try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await page.setRequestInterception(true);
    page.on('request', request => {
        const url = new URL(request.url());
        if (url.hostname.endsWith('.supabase.co')) {
            const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,DELETE,PATCH,PUT,OPTIONS', 'content-type': 'application/json' };
            if (request.method() === 'OPTIONS') return request.respond({ status: 204, headers });
            if (url.pathname.includes('/auth/v1/user')) return request.respond({ status: 200, headers, body: JSON.stringify(session.user) });
            if (url.pathname.includes('/rest/v1/profiles')) return request.respond({ status: 200, headers, body: JSON.stringify({ id: userId, user_id: userId, role: 'admin', full_name: 'Admin' }) });
            return request.respond({ status: 200, headers, body: '[]' });
        }
        if (url.origin === base && url.pathname.startsWith('/api/admin/finance/')) {
            let body = summary;
            if (url.pathname.endsWith('/shops')) body = { shops: [{ shopId: 'shop-1', shopName: 'Campus Prints', shopStatus: 'OPEN', commissionConfigured: true, grossSales: 27, platformCommission: 3, vendorEarnings: 24, payableAmount: 12, settledAmount: 8, pendingAmount: 4, reversedAmount: 2, unconfiguredOrdersCount: 0, totalOrdersCount: 14, activeCommissionRule: { id: 'rule-1', commission_bps: savedFee * 100, commissionPercentage: savedFee, effective_from: '2026-09-01T00:00:00Z', effective_to: null } }] };
            if (url.pathname.endsWith('/commission-rules')) {
                if (request.method() === 'POST') {
                    savedFee = JSON.parse(request.postData()).commission_percentage;
                    body = { message: 'Shop fee saved.' };
                } else {
                    body = { rules: [{ id: 'rule-1', shopId: 'shop-1', shopName: 'Campus Prints', commissionBps: savedFee * 100, commissionPercentage: savedFee, effectiveFrom: '2026-09-01T00:00:00Z', effectiveTo: null, isActive: true, createdAt: '2026-09-01T00:00:00Z' }] };
                }
            }
            if (url.pathname.endsWith('/settlements')) body = { settlements: [] };
            return request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
        }
        return request.continue();
    });
    await page.evaluateOnNewDocument((key, value) => { localStorage.setItem(key, JSON.stringify(value)); sessionStorage.setItem('xs_app_booted', '1'); }, `sb-${project}-auth-token`, session);

    await page.goto(`${base}/admin/finance?view=summary`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('[aria-label="Admin navigation"]');
    assert.equal(await page.$$eval('[aria-label="Admin navigation"]', items => items.length), 1);
    await page.waitForFunction(() => document.body.innerText.includes('Ready to pay shops'));
    await page.click('a[href="/admin/finance?view=shops"]');
    await page.waitForFunction(() => new URLSearchParams(location.search).get('view') === 'shops' && document.body.innerText.includes('XerService fee settings'));
    assert.equal(await page.$eval('[role="tab"][aria-selected="true"]', element => element.textContent?.trim()), 'Shops & fees');
    await page.evaluate(() => Array.from(document.querySelectorAll('button')).find(element => element.textContent?.includes('Set shop fee'))?.click());
    await page.waitForSelector('form select');
    await page.select('form select', 'shop-1');
    await page.type('form input[type="number"]', '12.5');
    await page.evaluate(() => Array.from(document.querySelectorAll('form button[type="submit"]')).find(element => element.textContent?.includes('Save fee'))?.click());
    await page.waitForFunction(() => document.body.innerText.includes('Shop fee saved.') && document.body.innerText.includes('12.5%'));
    await page.reload({ waitUntil: 'networkidle2' });
    await page.waitForFunction(() => document.body.innerText.includes('12.5%'));
    await page.evaluate(() => Array.from(document.querySelectorAll('[role="tab"]')).find(element => element.textContent?.includes('Payments to shops'))?.click());
    await page.waitForFunction(() => new URLSearchParams(location.search).get('view') === 'payouts');
    await page.reload({ waitUntil: 'networkidle2' });
    assert.equal(await page.$eval('[role="tab"][aria-selected="true"]', element => element.textContent?.trim()), 'Payments to shops');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(errors, []);
    console.log('9 admin UI checks passed: navigation, plain wording, responsive layout, fee save/reload, and refresh-persistent views.');
} finally {
    await browser.close();
}

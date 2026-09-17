import assert from 'node:assert/strict';
import fs from 'node:fs';
import puppeteer from 'puppeteer';

const base = process.env.TEST_BASE_URL || 'http://localhost:3000';
const env = Object.fromEntries(fs.readFileSync('.env.local', 'utf8').split('\n').filter(line => !line.startsWith('#') && line.includes('=')).map(line => {
    const separator = line.indexOf('=');
    return [line.slice(0, separator).trim(), line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '')];
}));
const userId = '11111111-1111-4111-8111-111111111111';
const phone = '+919876543210';
const session = {
    access_token: `${Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: userId, exp: Math.floor(Date.now() / 1000) + 3600, role: 'authenticated' })).toString('base64url')}.fixture`,
    refresh_token: 'fixture-refresh', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, token_type: 'bearer',
    user: { id: userId, phone, role: 'authenticated', aud: 'authenticated', user_metadata: {} },
};

const browser = await puppeteer.launch({ headless: true });
try {
    const page = await browser.newPage();
    const authRequests = [];
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', request => {
        const url = new URL(request.url());
        if (url.hostname.endsWith('.supabase.co')) {
            const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,DELETE,PATCH,PUT,OPTIONS', 'content-type': 'application/json' };
            if (request.method() === 'OPTIONS') return request.respond({ status: 204, headers });
            if (url.pathname.endsWith('/auth/v1/otp')) {
                authRequests.push(JSON.parse(request.postData() || '{}'));
                return request.respond({ status: 200, headers, body: '{}' });
            }
            if (url.pathname.endsWith('/auth/v1/verify')) {
                authRequests.push(JSON.parse(request.postData() || '{}'));
                return request.respond({ status: 200, headers, body: JSON.stringify(session) });
            }
            if (url.pathname.includes('/auth/v1/user')) return request.respond({ status: 200, headers, body: JSON.stringify(session.user) });
            if (url.pathname.includes('/rest/v1/profiles')) return request.respond({ status: 200, headers, body: JSON.stringify({ id: userId, user_id: userId, role: 'customer', full_name: 'Phone customer', phone }) });
            return request.respond({ status: 200, headers, body: '[]' });
        }
        if (url.origin === base && url.pathname.startsWith('/api/customer/')) return request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ orders: [], balance: 0 }) });
        return request.continue();
    });

    await page.goto(`${base}/login`, { waitUntil: 'networkidle2' });
    await page.evaluate(() => Array.from(document.querySelectorAll('button')).find(button => button.textContent?.trim() === 'Mobile OTP Login')?.click());
    await page.waitForSelector('input[type="tel"]');
    await page.type('input[type="tel"]', '9876543210');
    await page.click('form button[type="submit"]');
    await page.waitForFunction(() => document.body.innerText.includes('Enter OTP'));
    const inputs = await page.$$('.otp-input');
    for (let index = 0; index < inputs.length; index += 1) await inputs[index].type(String(index + 1));
    await page.click('form button[type="submit"]');
    await page.waitForFunction(() => location.pathname === '/');

    assert.equal(authRequests[0].phone, phone);
    assert.equal(authRequests[0].create_user, true);
    assert.equal(authRequests[0].channel, 'sms');
    assert.equal(authRequests[1].phone, phone);
    assert.equal(authRequests[1].token, '123456');
    assert.equal(authRequests[1].type, 'sms');
    assert.deepEqual(errors, []);
    console.log('5 browser OTP checks passed with an isolated Supabase test-number fixture; no SMS was sent.');
} finally {
    await browser.close();
}

// UI-only checks: every Supabase/API request is intercepted; no real accounts or writes.
// Start the local fixture app with:
// NEXT_PUBLIC_SUPABASE_URL=https://mobile-ui-test.supabase.co NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_mobile_test NEXT_PUBLIC_PHONE_AUTH_ENABLED=true pnpm dev --port 3100
// Before visual changes: node scripts/test-customer-mobile-ui.mjs --baseline
// After changes: node scripts/test-customer-mobile-ui.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const base = process.env.TEST_BASE_URL || 'http://localhost:3100';
const output = path.resolve('reports/customer-mobile-ui');
fs.mkdirSync(output, { recursive: true });
const baseline = process.argv.includes('--baseline');
const id = '11111111-1111-4111-8111-111111111111';
const shopId = '22222222-2222-4222-8222-222222222222';
const authUser = { id, email: 'customer@example.invalid', role: 'authenticated', aud: 'authenticated', user_metadata: { full_name: 'Test Customer' } };
const tokenPart = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const session = {
    access_token: `${tokenPart({ alg: 'HS256', typ: 'JWT' })}.${tokenPart({ sub: id, exp: Math.floor(Date.now() / 1000) + 3600, role: 'authenticated' })}.fixture`,
    refresh_token: 'fixture-only', expires_at: Math.floor(Date.now() / 1000) + 3600,
    expires_in: 3600, token_type: 'bearer', user: authUser,
};
const shops = [
    { id: shopId, name: 'Campus Print Studio', status: 'OPEN', description: 'Library Road, Campus', open_time: '09:00', close_time: '18:00' },
    { id: '22222222-2222-4222-8222-222222222223', name: 'North Campus Reprography and Document Centre', status: 'CLOSED', description: 'North Campus Library Building', open_time: '09:00', close_time: '17:00' },
];
const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
});
let checks = 0;
const check = (condition, message) => { assert.ok(condition, message); checks++; console.log(`PASS ${message}`); };

async function fixture(signedIn = false) {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', async request => {
        const url = new URL(request.url());
        if (url.hostname.endsWith('.supabase.co') || (url.origin === base && url.pathname.startsWith('/api/'))) {
            const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'content-type': 'application/json' };
            if (request.method() === 'OPTIONS') return request.respond({ status: 204, headers });
            let data = [];
            if (url.pathname.endsWith('/auth/v1/user')) data = authUser;
            else if (url.pathname.endsWith('/profiles')) data = { id, user_id: id, full_name: 'Test Customer', role: 'customer', phone: null };
            else if (url.pathname.endsWith('/shops')) data = url.searchParams.has('id') ? shops[0] : shops;
            else if (url.pathname.endsWith('/shop_pricing')) data = shops.flatMap(shop => ['BW', 'COLOUR'].map(mode => ({ shop_id: shop.id, print_mode: mode, colour_mode: mode, paper_size: 'A4', sides: 'SINGLE', price_per_sheet: mode === 'BW' ? 2 : 7, active: true })));
            else if (url.pathname.endsWith('/orders')) data = url.pathname.startsWith('/api/') ? { orders: [] } : [];
            else if (url.pathname.endsWith('/wallet')) data = { balance: 25, transactions: [] };
            else if (url.pathname.endsWith('/notifications')) data = { notifications: [], unreadCount: 0 };
            else if (url.pathname.endsWith('/whatsapp/status')) data = { status: 'not_linked', maskedPhone: null };
            else if (url.pathname.endsWith('/whatsapp/files')) data = { files: [] };
            else if (url.pathname.endsWith('/addons')) data = { addons: [] };
            else if (url.pathname.endsWith('/linked-emails')) data = { emails: [] };
            else if (url.pathname.endsWith('/logout')) data = {};
            return request.respond({ status: 200, headers, body: JSON.stringify(data) });
        }
        if (url.origin !== base && !['data:', 'blob:'].includes(url.protocol)) return request.abort();
        return request.continue();
    });
    await page.evaluateOnNewDocument((value, origin) => {
        if (window !== window.top || location.origin !== origin) return;
        sessionStorage.setItem('xs_app_booted', '1');
        localStorage.setItem('xer_theme', 'light');
        if (value) localStorage.setItem('sb-mobile-ui-test-auth-token', JSON.stringify(value));
    }, signedIn ? session : null, base);
    return { context, page, errors };
}

async function visit(page, route) {
    await page.goto(base + route, { waitUntil: 'networkidle2' });
    await page.waitForFunction(() => !document.querySelector('[aria-label="Loading XerService"]'));
    await page.evaluate(() => document.fonts.ready);
    await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
}

async function desktopSnapshot(page, route, width) {
    await page.setViewport({ width, height: 960 });
    await visit(page, route);
    await page.addStyleTag({ content: 'nextjs-portal { display: none !important; } *, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }' });
    const key = `${route === '/' ? 'home' : 'login'}-${width}`;
    const image = await page.screenshot({ fullPage: true });
    const filename = path.join(output, `${key}-baseline.png`);
    if (baseline) fs.writeFileSync(filename, image);
    else if (fs.existsSync(filename)) {
        fs.writeFileSync(path.join(output, `${key}-after.png`), image);
        const identical = await page.evaluate(async images => {
            const pixels = await Promise.all(images.map(async data => {
                const blob = new Blob([Uint8Array.from(atob(data), char => char.charCodeAt(0))], { type: 'image/png' });
                const bitmap = await createImageBitmap(blob);
                const canvas = document.createElement('canvas');
                canvas.width = bitmap.width; canvas.height = bitmap.height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(bitmap, 0, 0);
                const result = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
                bitmap.close();
                return result;
            }));
            return pixels[0].length === pixels[1].length && pixels[0].every((value, i) => value === pixels[1][i]);
        }, [Buffer.from(image).toString('base64'), fs.readFileSync(filename).toString('base64')]);
        check(identical, `desktop ${key} pixel-identical to baseline`);
    }
    check(await page.$eval('.mobile-bottom-nav', el => getComputedStyle(el).display === 'none').catch(() => true), `desktop ${key} has no mobile dock`);
}

try {
    const guest = await fixture();
    for (const width of [1024, 1440]) for (const route of ['/', '/login']) await desktopSnapshot(guest.page, route, width);
    if (!baseline) {
        for (const width of [320, 390, 430, 768]) {
            await guest.page.setViewport({ width, height: 844, isMobile: true, hasTouch: true });
            for (const route of ['/', '/login']) {
                await visit(guest.page, route);
                check(await guest.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${route} fits ${width}px`);
                if (route === '/') {
                    check(await guest.page.$$eval('.mobile-bottom-nav a', links => links.length === 5 && links.every(el => el.getBoundingClientRect().height >= 44)), `${width}px all five navigation targets are touch-sized`);
                    check(await guest.page.$eval('.shop-card-vertical', el => el.getBoundingClientRect().width <= innerWidth - 20), `${width}px shop cards fit`);
                } else {
                    await guest.page.type('[aria-label="Password"]', 'fixture-only');
                    await guest.page.click('[aria-label="Show password"]');
                    check(await guest.page.$eval('[aria-label="Password"]', el => el.type === 'text' && el.value === 'fixture-only'), `${width}px password visibility preserved`);
                    await guest.page.click('[aria-label="Hide password"]');
                    check(await guest.page.$eval('[aria-label="Show password"]', el => { const r = el.getBoundingClientRect(); return r.width >= 44 && r.height >= 44; }), `${width}px password toggle touch target`);
                }
                if (width === 390) await guest.page.screenshot({ path: path.join(output, `${route === '/' ? 'home' : 'login'}-mobile.png`), fullPage: true });
                if (route === '/login') {
                    await guest.page.evaluate(() => [...document.querySelectorAll('button')].find(el => el.textContent.includes('Mobile OTP Login')).click());
                    await guest.page.waitForSelector('input[type="tel"]');
                    await guest.page.type('input[type="tel"]', '9876543210');
                    await guest.page.click('form button[type="submit"]');
                    await guest.page.waitForSelector('.otp-grid');
                    check(await guest.page.$$eval('.otp-input', inputs => inputs.length === 6 && inputs.every(input => { const r = input.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; })), `${width}px six OTP boxes fit without clipping`);
                }
            }
        }
        await guest.page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
        await visit(guest.page, '/');
        await guest.page.type('[aria-label="Search print shops"]', 'North');
        check(await guest.page.$$eval('.shop-name', names => names.length === 1 && names[0].textContent.includes('North')), 'shop search preserved');
        await guest.page.click('[aria-label="Clear search"]');
        await guest.page.select('[aria-label="Filter shops"]', 'OPEN');
        check(await guest.page.$$eval('.shop-name', names => names.length === 1 && names[0].textContent === 'Campus Print Studio'), 'shop filters preserved');
        await guest.page.select('[aria-label="Filter shops"]', 'ALL');
        await guest.page.select('[aria-label="Sort shops"]', 'NAME_ASC');
        check(await guest.page.$$eval('.shop-name', names => names[0].textContent === 'Campus Print Studio'), 'shop sorting preserved');
        await guest.page.click('[aria-label="Toggle theme"]');
        await guest.page.waitForFunction(() => document.documentElement.classList.contains('dark'));
        check(await guest.page.$eval('html', el => el.classList.contains('dark')), 'mobile theme control preserved');
        await guest.page.screenshot({ path: path.join(output, 'home-mobile-dark.png'), fullPage: true });
        await guest.page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
        check(await guest.page.$eval('.mobile-print-action', el => getComputedStyle(el).transitionDuration === '0s'), 'reduced motion disables dock animation');
        check(guest.errors.length === 0, `guest runtime errors: ${guest.errors.join('; ')}`);

        const customer = await fixture(true);
        for (const width of [320, 390]) {
            await customer.page.setViewport({ width, height: 844, isMobile: true, hasTouch: true });
            for (const route of ['/dashboard/orders', '/dashboard/wallet', '/dashboard/profile', '/dashboard/whatsapp', '/cart', `/order/upload?shop=${shopId}`]) {
                await visit(customer.page, route);
                check(new URL(customer.page.url()).pathname === route.split('?')[0], `${route} customer session preserved`);
                check(await customer.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${route} fits ${width}px`);
                if (route === '/dashboard/wallet') check(await customer.page.$eval('input[placeholder="Custom amount"]', el => el.getBoundingClientRect().width >= 180), `${width}px wallet amount field is readable`);
                if (width === 390) await customer.page.screenshot({ path: path.join(output, `${route.split('?')[0].replaceAll('/', '-')}-mobile.png`), fullPage: true });
            }
        }
        check(customer.errors.length === 0, `customer runtime errors: ${customer.errors.join('; ')}`);
        await visit(customer.page, '/dashboard/profile');
        await customer.page.evaluate(() => [...document.querySelectorAll('button')].find(el => el.textContent.includes('Sign Out from Session')).click());
        await customer.page.waitForSelector('.confirm-card');
        await customer.page.waitForFunction(() => document.querySelector('.confirm-card').getBoundingClientRect().bottom <= innerHeight + 1);
        check(await customer.page.$eval('.confirm-card', el => el.getBoundingClientRect().bottom <= innerHeight + 1), 'sign-out confirmation fits mobile screen');
        await customer.page.evaluate(() => [...document.querySelectorAll('.confirm-actions button')].find(el => el.textContent === 'Cancel').click());
        check(await customer.page.$('.confirm-card') === null, 'cancel sign-out preserves the session');
        await customer.context.close();
    }
    await guest.context.close();
    console.log(`${checks} UI checks passed. External requests were mocked; no live integration claims.`);
} finally {
    await browser.close();
}

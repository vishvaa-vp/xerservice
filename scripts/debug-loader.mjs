/**
 * Debug: Why is BrandLoader not dismissing?
 */
import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE_URL = 'http://localhost:3000';

async function run() {
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1440,900'],
        defaultViewport: { width: 1440, height: 900 },
    });

    const page = await browser.newPage();

    // Capture console logs from the page
    page.on('console', msg => console.log(`[PAGE] ${msg.type()}: ${msg.text()}`));

    console.log('Navigating to homepage...');
    const start = Date.now();

    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    console.log(`domcontentloaded at ${Date.now() - start}ms`);

    // Check loader state every 500ms for 15 seconds
    for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 500));
        const elapsed = Date.now() - start;
        const loaderInfo = await page.evaluate(() => {
            const el = document.querySelector('[aria-label="Loading XerService"]');
            if (!el) return { present: false };
            const styles = window.getComputedStyle(el);
            return {
                present: true,
                opacity: styles.opacity,
                display: styles.display,
                visibility: styles.visibility,
                classes: el.className,
                hasLeavingClass: el.className.includes('leaving'),
                sessionBooted: sessionStorage.getItem('xs_app_booted'),
            };
        });
        console.log(`${elapsed}ms: ${JSON.stringify(loaderInfo)}`);
        if (!loaderInfo.present) {
            console.log(`Loader dismissed at ${elapsed}ms`);
            break;
        }
    }

    await browser.close();
}

run().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
});

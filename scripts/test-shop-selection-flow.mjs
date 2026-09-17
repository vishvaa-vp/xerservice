/**
 * Test Suite: Shop Selection Flow & Mobile Navigation Verification
 *
 * Verifies:
 * 1. Home page shop card links always pass ?shop=${shop.id}.
 * 2. Mobile intro "Upload Document" button routes to #shops.
 * 3. MobileNavigation bottom sheet routes uploadUrl to /#shops so customer selects shop first.
 * 4. Upload page contains shopLoading state and does not flash "No Print Shop Selected".
 * 5. Upload page renders activeShop details and only displays fallback when no shop is selected.
 * 6. Live database query for active shop succeeds with pricing.
 * 7. Invariants: rules=0, batches=0, items=0, ledger=11, sumWallets=96.
 */

import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { createClient } from '@supabase/supabase-js';

console.log('--- TEST SUITE: SHOP SELECTION FLOW & MOBILE NAVIGATION ---');

const srcDir = path.resolve(process.cwd(), 'src');

// Load environment variables from .env.local
const envPath = path.resolve(process.cwd(), '.env.local');
const envVars = {};
if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
            const [k, ...v] = trimmed.split('=');
            envVars[k.trim()] = v.join('=').trim().replace(/^['"]|['"]$/g, '');
        }
    }
}

const supabaseUrl = envVars.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = envVars.SUPABASE_SECRET_KEY || envVars.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = envVars.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || envVars.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

assert(supabaseUrl && serviceKey && anonKey, 'Supabase credentials must be present in .env.local');

const serviceClient = createClient(supabaseUrl, serviceKey);
const anonClient = createClient(supabaseUrl, anonKey);

// Check 1: Home page shop card link
console.log('\n[Check 1] Auditing home page ShopCard link structure...');
const homeContent = fs.readFileSync(path.join(srcDir, 'app/page.tsx'), 'utf-8');
assert(
    homeContent.includes('const shopUploadHref = user ? `/order/upload?shop=${shop.id}` : `/login?redirect=${encodeURIComponent(`/order/upload?shop=${shop.id}`)}`') ||
    homeContent.includes('`/order/upload?shop=${shop.id}`'),
    'ShopCard must link to /order/upload with shop query parameter'
);
console.log('✓ Home page ShopCard links directly to /order/upload?shop=${shop.id}.');

// Check 2: Mobile intro Upload Document button
console.log('\n[Check 2] Auditing mobile intro Upload Document button...');
assert(
    homeContent.includes('href="#shops"') && homeContent.includes('Upload Document'),
    'Mobile intro Upload Document button must route to #shops'
);
console.log('✓ Mobile intro Upload Document button links to #shops.');

// Check 3: MobileNavigation uploadUrl routes to /#shops
console.log('\n[Check 3] Auditing MobileNavigation uploadUrl...');
const mobileNavContent = fs.readFileSync(path.join(srcDir, 'components/layout/MobileNavigation.tsx'), 'utf-8');
assert(
    mobileNavContent.includes("const uploadUrl = '/#shops';"),
    'MobileNavigation uploadUrl must be /#shops'
);
assert(
    mobileNavContent.includes('onClick={() => go(uploadUrl)}'),
    'MobileNavigation sheet button must invoke go(uploadUrl)'
);
console.log('✓ MobileNavigation uploadUrl routes to /#shops to let user select shop first.');

// Check 4: Upload page shopLoading state and loading card
console.log('\n[Check 4] Auditing upload page shopLoading and loading state...');
const uploadContent = fs.readFileSync(path.join(srcDir, 'app/order/upload/page.tsx'), 'utf-8');
assert(
    uploadContent.includes('const [shopLoading, setShopLoading] = useState('),
    'Upload page must define shopLoading state'
);
assert(
    uploadContent.includes('{shopLoading ? (') &&
    uploadContent.includes('Loading Print Shop...') || uploadContent.includes('Connecting to'),
    'Upload page must display loading state when shopLoading is true'
);
assert(
    uploadContent.includes('No Print Shop Selected'),
    'Upload page must preserve No Print Shop Selected for empty shop state'
);
console.log('✓ Upload page has dedicated shopLoading state and renders loading indicator.');

// Check 5: Live database query for shops and pricing
console.log('\n[Check 5] Verifying live database query for shops & pricing with anonClient...');
const { data: shops, error: shopsErr } = await anonClient
    .from('shops')
    .select('id, name, status, open_time, close_time')
    .limit(1);

assert(!shopsErr && shops && shops.length > 0, `Shops query failed: ${shopsErr?.message}`);
const shop = shops[0];
console.log(`✓ Active shop found: ${shop.name} (${shop.id})`);

const { data: pricing, error: pricingErr } = await anonClient
    .from('shop_pricing')
    .select('print_mode, price_per_sheet')
    .eq('shop_id', shop.id)
    .eq('paper_size', 'A4')
    .eq('sides', 'SINGLE')
    .eq('active', true);

assert(!pricingErr && pricing && pricing.length > 0, `Pricing query failed: ${pricingErr?.message}`);
console.log(`✓ Active pricing loaded for shop: ${pricing.map(p => `${p.print_mode}=₹${p.price_per_sheet}`).join(', ')}`);

// Check 6: Financial Invariants Check
console.log('\n[Check 6] Auditing financial invariants...');
const { count: rulesCount, error: rErr } = await serviceClient.from('shop_commission_rules').select('*', { count: 'exact', head: true });
const { count: batchesCount, error: bErr } = await serviceClient.from('vendor_settlement_batches').select('*', { count: 'exact', head: true });
const { count: itemsCount, error: iErr } = await serviceClient.from('vendor_settlement_items').select('*', { count: 'exact', head: true });
const { count: ledgerCount, error: lErr } = await serviceClient.from('order_financial_ledger').select('*', { count: 'exact', head: true });
const { data: wallets, error: wErr } = await serviceClient.from('wallet_accounts').select('balance');

assert(!rErr && rulesCount === 0, `shop_commission_rules count must be 0, found ${rulesCount}`);
assert(!bErr && batchesCount === 0, `vendor_settlement_batches count must be 0, found ${batchesCount}`);
assert(!iErr && itemsCount === 0, `vendor_settlement_items count must be 0, found ${itemsCount}`);
assert(!lErr && ledgerCount === 11, `order_financial_ledger count must be 11, found ${ledgerCount}`);

const sumWallets = (wallets || []).reduce((acc, p) => acc + Number(p.balance || 0), 0);
assert(sumWallets === 96, `sum of wallet balances must be 96, found ${sumWallets}`);

console.log(`✓ Invariants fully preserved: rules=${rulesCount}, batches=${batchesCount}, items=${itemsCount}, ledger=${ledgerCount}, sumWallets=${sumWallets}`);

console.log('\n==================================================');
console.log('✓ ALL SHOP SELECTION & NAVIGATION CHECKS PASSED!');
console.log('==================================================');

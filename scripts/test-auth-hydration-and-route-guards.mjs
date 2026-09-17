import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

console.log('========================================================================');
console.log('XerService — Auth Refresh / Protected Route Stability Verification Suite');
console.log('========================================================================\n');

let passedTests = 0;
let totalTests = 0;

function assert(condition, testName, details = '') {
    totalTests++;
    if (condition) {
        console.log(`  ✅ [PASS] ${testName}`);
        passedTests++;
    } else {
        console.error(`  ❌ [FAIL] ${testName}`);
        if (details) console.error(`     Details: ${details}`);
    }
}

// -----------------------------------------------------------------------------
// 1. Audit AppContext Auth State & Architecture
// -----------------------------------------------------------------------------
console.log('--- 1. AppContext Auth Initialization & Lifecycle Audit ---');
const appContextPath = path.join(rootDir, 'src/context/AppContext.tsx');
const appContextCode = fs.readFileSync(appContextPath, 'utf8');

assert(
    appContextCode.includes('authInitialized: boolean;') &&
    appContextCode.includes('isAuthLoading: boolean;') &&
    appContextCode.includes('const [authInitialized, setAuthInitialized] = useState(false);'),
    'AppContext defines and exports explicit authInitialized and isAuthLoading states'
);

assert(
    !appContextCode.includes('setTimeout(() => setIsLoading(false), 2000)'),
    'Removed artificial 2-second timeout that raced ahead of auth initialization'
);

assert(
    appContextCode.includes('isLoggedIn: authInitialized && !!user'),
    'isLoggedIn strictly requires authInitialized to be true'
);

assert(
    appContextCode.includes('id: string;') &&
    !appContextCode.includes('id?: string;'),
    'User domain model strictly defines id as required string'
);

assert(
    appContextCode.includes('const { data: { session }, error } = await supabase.auth.getSession();') &&
    appContextCode.includes('setAuthInitialized(true);') &&
    appContextCode.includes('setIsLoading(false);'),
    'Authoritative session restore initializes from supabase.auth.getSession()'
);

assert(
    appContextCode.includes('supabase.auth.onAuthStateChange') &&
    appContextCode.includes("event === 'SIGNED_OUT'") &&
    appContextCode.includes("event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED'"),
    'onAuthStateChange handles session state changes across tabs and token refreshes'
);

// -----------------------------------------------------------------------------
// 2. Audit RootClient Hydration Gating
// -----------------------------------------------------------------------------
console.log('\n--- 2. RootClient Hydration Gating ---');
const rootClientPath = path.join(rootDir, 'src/app/RootClient.tsx');
const rootClientCode = fs.readFileSync(rootClientPath, 'utf8');

assert(
    rootClientCode.includes('const { isLoading, authInitialized } = useApp();') &&
    rootClientCode.includes('const isReady = authInitialized && !isLoading;') &&
    rootClientCode.includes('<BrandLoader ready={isReady} />') &&
    rootClientCode.includes('{isReady && ('),
    'RootClient gates rendering of children and navbar until auth is fully initialized'
);

// -----------------------------------------------------------------------------
// 3. Audit All Customer Protected Route Guards
// -----------------------------------------------------------------------------
console.log('\n--- 3. Customer Protected Route Guards Audit ---');
const customerProtectedPages = [
    { file: 'src/app/dashboard/page.tsx', redirect: '/login?redirect=/dashboard' },
    { file: 'src/app/dashboard/orders/page.tsx', redirect: '/login?redirect=/dashboard/orders' },
    { file: 'src/app/dashboard/wallet/page.tsx', redirect: '/login?redirect=/dashboard/wallet' },
    { file: 'src/app/dashboard/profile/page.tsx', redirect: '/login?redirect=/dashboard/profile' },
    { file: 'src/app/cart/page.tsx', redirect: '/login?redirect=/cart' },
    { file: 'src/app/order/upload/page.tsx', redirect: '/login?redirect=' },
    { file: 'src/app/order/pricing/page.tsx', redirect: '/login?redirect=' },
    { file: 'src/app/order/payment/page.tsx', redirect: '/login?redirect=' },
    { file: 'src/app/order/method/page.tsx', redirect: '/login?redirect=' },
];

for (const { file, redirect } of customerProtectedPages) {
    const code = fs.readFileSync(path.join(rootDir, file), 'utf8');
    const baseName = path.basename(path.dirname(file)) + '/' + path.basename(file);

    assert(
        code.includes('authInitialized') &&
        (code.includes('if (!authInitialized || isLoading) return;') || code.includes('!authInitialized || isLoading')),
        `${baseName}: Route guard never redirects while auth is initializing`
    );

    assert(
        code.includes(redirect),
        `${baseName}: Redirect preserves original destination URL`
    );

    if (file !== 'src/app/order/method/page.tsx') {
        assert(
            code.includes('!authInitialized || (isLoading &&') || code.includes('!authInitialized || isLoading'),
            `${baseName}: Contains render loading guard to prevent sign-in flash during hydration`
        );
    }
}

// -----------------------------------------------------------------------------
// 4. Payment Page State & URL Preservation Audit
// -----------------------------------------------------------------------------
console.log('\n--- 4. Payment Page State & URL Preservation Audit ---');
const paymentPagePath = path.join(rootDir, 'src/app/order/payment/page.tsx');
const paymentCode = fs.readFileSync(paymentPagePath, 'utf8');

assert(
    paymentCode.includes("url.searchParams.set('order', currentOrder.orderId);") &&
    paymentCode.includes("window.history.replaceState({}, '', url.toString());"),
    'PaymentPage preserves ?order= parameter in URL so hard refresh can rehydrate order details'
);

assert(
    paymentCode.includes('loadOrderFromDb') &&
    paymentCode.includes("from('orders')"),
    'PaymentPage rehydrates order directly from Supabase DB on refresh'
);

// -----------------------------------------------------------------------------
// 5. Vendor Dashboard Route Guard & Role Verification Audit
// -----------------------------------------------------------------------------
console.log('\n--- 5. Vendor Dashboard & Login Route Guard Audit ---');
const vendorDashPath = path.join(rootDir, 'src/app/vendor/dashboard/page.tsx');
const vendorDashCode = fs.readFileSync(vendorDashPath, 'utf8');

assert(
    vendorDashCode.includes('const { data: { session }, error: sessionError } = await supabase.auth.getSession();') &&
    vendorDashCode.includes("from('profiles')") &&
    vendorDashCode.includes("profile.role !== 'vendor'"),
    'Vendor dashboard strictly checks session and verifies vendor role in public.profiles'
);

assert(
    vendorDashCode.includes('if (loadingAuth) {') &&
    vendorDashCode.includes('Loading Vendor HQ'),
    'Vendor dashboard displays loading screen during auth check and does not prematurely redirect'
);

const vendorLoginPath = path.join(rootDir, 'src/app/vendor/login/page.tsx');
const vendorLoginCode = fs.readFileSync(vendorLoginPath, 'utf8');

assert(
    vendorLoginCode.includes("router.replace('/vendor/dashboard')") &&
    vendorLoginCode.includes("user?.type === 'vendor'"),
    'Vendor login page immediately redirects already-authenticated vendors to /vendor/dashboard'
);

const customerLoginPath = path.join(rootDir, 'src/app/login/page.tsx');
const customerLoginCode = fs.readFileSync(customerLoginPath, 'utf8');

assert(
    customerLoginCode.includes('router.replace(redirectTo);') &&
    customerLoginCode.includes('authInitialized && !isLoading && isLoggedIn'),
    'Customer login page immediately redirects already-authenticated users to redirectTo'
);

// -----------------------------------------------------------------------------
// 6. Live Supabase Session & API Connectivity Verification
// -----------------------------------------------------------------------------
console.log('\n--- 6. Live Supabase Session & Endpoint Verification ---');
const envContent = fs.readFileSync(path.join(rootDir, '.env.local'), 'utf8');
const getEnv = (key) => {
    const match = envContent.match(new RegExp('^' + key + '=(.*)$', 'm'));
    return match ? match[1].trim() : undefined;
};

const supabaseUrl = getEnv('NEXT_PUBLIC_SUPABASE_URL');
const supabaseSecret = getEnv('SUPABASE_SECRET_KEY');
const supabaseAnon = getEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');

const adminClient = createClient(supabaseUrl, supabaseSecret);
const anonClient = createClient(supabaseUrl, supabaseAnon);

const BASE_URL = 'http://localhost:3000';
const customerEmail = 'vishvaaparthipan@gmail.com';

async function runLiveTests() {
    try {
        // Generate magiclink OTP for live customer
        const { data: linkData, error: linkErr } = await adminClient.auth.admin.generateLink({
            type: 'magiclink',
            email: customerEmail,
        });

        if (linkErr || !linkData?.properties?.email_otp) {
            throw new Error(`Magiclink failed: ${linkErr?.message}`);
        }

        // Verify OTP to get real customer session
        const { data: sess, error: verifyErr } = await anonClient.auth.verifyOtp({
            email: customerEmail,
            token: linkData.properties.email_otp,
            type: 'email',
        });

        if (verifyErr || !sess?.session?.access_token) {
            throw new Error(`OTP verification failed: ${verifyErr?.message}`);
        }

        const session = sess.session;
        assert(!!session.user?.id, 'Supabase session returns real authenticated user.id');

        // Check profiles table for user
        const { data: profile, error: profErr } = await adminClient
            .from('profiles')
            .select('id, user_id, role, full_name')
            .eq('user_id', session.user.id)
            .maybeSingle();

        assert(!profErr && !!profile, `Profile exists in public.profiles with role: ${profile?.role}`);
        assert(profile?.user_id === session.user.id, 'Profile user_id exactly matches auth session user.id');

        // Verify customer endpoints respond HTTP 200 with session token
        const headers = { Authorization: `Bearer ${session.access_token}` };

        const walletRes = await fetch(`${BASE_URL}/api/customer/wallet`, { headers });
        assert(walletRes.status === 200, `GET /api/customer/wallet returns HTTP 200 (actual: ${walletRes.status})`);

        const ordersRes = await fetch(`${BASE_URL}/api/customer/orders`, { headers });
        assert(ordersRes.status === 200, `GET /api/customer/orders returns HTTP 200 (actual: ${ordersRes.status})`);

        const notifsRes = await fetch(`${BASE_URL}/api/notifications`, { headers });
        assert(notifsRes.status === 200, `GET /api/notifications returns HTTP 200 (actual: ${notifsRes.status})`);

    } catch (err) {
        assert(false, 'Live test execution error', err.message);
    }

    console.log('\n========================================================================');
    console.log(`VERIFICATION RESULT: ${passedTests}/${totalTests} TESTS PASSED (${Math.round((passedTests / totalTests) * 100)}%)`);
    console.log('========================================================================\n');

    if (passedTests !== totalTests) {
        process.exit(1);
    }
}

runLiveTests().catch(err => {
    console.error('Fatal test error:', err);
    process.exit(1);
});

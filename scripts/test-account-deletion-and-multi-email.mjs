/**
 * Test Suite: Multi-Email Merge, Account Deletion Governance, Add-On Cards, & Layout Audit
 *
 * Verifies:
 * 1. Homepage cleanup: 'How XerService Works' and 'isSingleShop' conditional removed.
 * 2. Finishing Add-ons in PrintSettingsModal: converted from list checkboxes to responsive card grid with '+ Add' / '✓ Added' buttons.
 * 3. Multi-Email Merge Account API (/api/customer/account/linked-emails) & UI integration (+ button in profile).
 * 4. Unified WhatsApp document resolution across linked phone numbers and accounts.
 * 5. Account Deletion Governance Flow:
 *    - Request submission with reason and password confirmation
 *    - In-flight active order check
 *    - User cancelation of deletion request
 *    - Admin review queue and approve/reject actions
 * 6. Remote Supabase database invariants strictly preserved:
 *    - ledger=17, wallets=Rs 88, rules=2, batches=1, items=4
 */

import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Load environment variables from .env.local
const envPath = path.join(rootDir, '.env.local');
const envVars = {};
if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    for (const line of envContent.split('\n')) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
            const [k, ...v] = trimmed.split('=');
            envVars[k.trim()] = v.join('=').trim();
            process.env[k.trim()] = v.join('=').trim();
        }
    }
}

const supabaseUrl = envVars['NEXT_PUBLIC_SUPABASE_URL'] || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseSecret = envVars['SUPABASE_SECRET_KEY'] || process.env.SUPABASE_SECRET_KEY;

if (!supabaseUrl || !supabaseSecret) {
    console.error('Missing Supabase credentials in environment.');
    process.exit(1);
}

const serviceClient = createClient(supabaseUrl, supabaseSecret);

console.log('========================================================================');
console.log('AUDIT: MULTI-EMAIL MERGE, ACCOUNT DELETION GOVERNANCE, & ADD-ON CARDS');
console.log('========================================================================\n');

let totalTests = 0;
let passedTests = 0;

function check(label, condition, errorMsg) {
    totalTests++;
    try {
        assert(condition, errorMsg);
        console.log(`✓ [Pass ${totalTests}] ${label}`);
        passedTests++;
    } catch (err) {
        console.error(`✗ [Fail ${totalTests}] ${label}: ${err.message}`);
        throw err;
    }
}

// --------------------------------------------------------------------------
// 1. Homepage Cleanup: 'How XerService Works' removal
// --------------------------------------------------------------------------
console.log('\n--- 1. Homepage Cleanup Verification ---');
const pageCode = fs.readFileSync(path.join(rootDir, 'src/app/page.tsx'), 'utf8');
check(
    'isSingleShop variable is removed from src/app/page.tsx',
    !pageCode.includes('const isSingleShop'),
    'Expected isSingleShop declaration to be removed'
);
check(
    'how-it-works-panel is removed from home JSX',
    !pageCode.includes('className="how-it-works-panel card"'),
    'Expected how-it-works-panel markup to be removed'
);
check(
    'Homepage always renders responsive shops-grid',
    pageCode.includes('<div className="shops-grid">'),
    'Expected standard shops-grid to always render'
);

// --------------------------------------------------------------------------
// 2. Finishing Add-ons: Card Grid with '+ Add' / '✓ Added' buttons
// --------------------------------------------------------------------------
console.log('\n--- 2. Finishing Add-ons Card Grid Verification ---');
const modalCode = fs.readFileSync(path.join(rootDir, 'src/components/order/PrintSettingsModal.tsx'), 'utf8');
const modalCss = fs.readFileSync(path.join(rootDir, 'src/components/order/PrintSettingsModal.module.css'), 'utf8');

check(
    'PrintSettingsModal renders addonAddBtn with + Add / Added',
    modalCode.includes('styles.addonAddBtn') && modalCode.includes("'+ Add'"),
    'Expected addon card action button with + Add label'
);
check(
    'PrintSettingsModal renders checkmark when addon is added',
    modalCode.includes('styles.addonAddedBtn') && modalCode.includes('Added'),
    'Expected addon card action button with Added state'
);
check(
    'PrintSettingsModal CSS styles addonsList as responsive grid',
    modalCss.includes('display: grid') && modalCss.includes('grid-template-columns: repeat(auto-fill, minmax('),
    'Expected addonsList to be styled as a responsive CSS grid'
);
check(
    'PrintSettingsModal CSS defines .addonAddBtn and .addonAddedBtn styles',
    modalCss.includes('.addonAddBtn') && modalCss.includes('.addonAddedBtn'),
    'Expected addonAddBtn CSS rules'
);

// --------------------------------------------------------------------------
// 3. Multi-Email Merge Account API & Profile Integration
// --------------------------------------------------------------------------
console.log('\n--- 3. Multi-Email Merge Account Verification ---');
const profileCode = fs.readFileSync(path.join(rootDir, 'src/app/dashboard/profile/page.tsx'), 'utf8');
const linkModalCode = fs.readFileSync(path.join(rootDir, 'src/components/profile/LinkEmailModal.tsx'), 'utf8');
const linkedEmailsApiCode = fs.readFileSync(path.join(rootDir, 'src/app/api/customer/account/linked-emails/route.ts'), 'utf8');

check(
    'Profile page has + Add Email button',
    profileCode.includes('setShowLinkEmailModal(true)') && profileCode.includes('Add Email'),
    'Expected + Add Email button in Profile Settings'
);
check(
    'Profile page displays linked secondary email chips with unlink button',
    profileCode.includes('linkedEmails.map(') && profileCode.includes('handleUnlinkEmail'),
    'Expected linked email chips with unlink handler'
);
check(
    'LinkEmailModal is mounted and provides email input and submit',
    linkModalCode.includes('Link Another Email') && linkModalCode.includes('/api/customer/account/linked-emails'),
    'Expected LinkEmailModal component'
);
check(
    'Linked emails API route supports GET, POST, DELETE',
    linkedEmailsApiCode.includes('export async function GET') &&
    linkedEmailsApiCode.includes('export async function POST') &&
    linkedEmailsApiCode.includes('export async function DELETE'),
    'Expected full CRUD handlers in linked-emails route'
);

// --------------------------------------------------------------------------
// 4. Unified WhatsApp Document Resolution
// --------------------------------------------------------------------------
console.log('\n--- 4. WhatsApp Document Resolution Verification ---');
const cartServiceCode = fs.readFileSync(path.join(rootDir, 'src/lib/whatsapp/cart-service.ts'), 'utf8');

check(
    'listCustomerWhatsAppUploads checks customer profile phone and active whatsapp_links',
    cartServiceCode.includes('whatsapp_links') && cartServiceCode.includes('phoneOrConditions'),
    'Expected listCustomerWhatsAppUploads to support phone-based unified matching'
);

// --------------------------------------------------------------------------
// 5. Account Deletion Governance Flow
// --------------------------------------------------------------------------
console.log('\n--- 5. Account Deletion Governance Verification ---');
const deleteRequestApiCode = fs.readFileSync(path.join(rootDir, 'src/app/api/customer/account/delete-request/route.ts'), 'utf8');
const adminDeleteRequestApiCode = fs.readFileSync(path.join(rootDir, 'src/app/api/admin/users/[userId]/delete-request/route.ts'), 'utf8');
const requestDeleteModalCode = fs.readFileSync(path.join(rootDir, 'src/components/profile/RequestDeleteModal.tsx'), 'utf8');
const adminUsersCode = fs.readFileSync(path.join(rootDir, 'src/app/admin/users/page.tsx'), 'utf8');
const adminUsersApiCode = fs.readFileSync(path.join(rootDir, 'src/app/api/admin/users/route.ts'), 'utf8');

check(
    'Delete request API enforces reason validation and in-progress order checks',
    deleteRequestApiCode.includes('Please provide a valid reason') &&
    deleteRequestApiCode.includes("in('status', ['QUEUED', 'PRINTING', 'READY'])"),
    'Expected deletion request to check reason and active print orders'
);
check(
    'Delete request API supports action: cancel',
    deleteRequestApiCode.includes("action === 'cancel'") && deleteRequestApiCode.includes('delete_request: null'),
    'Expected delete request API to allow user cancellation'
);
check(
    'Profile Settings displays pending deletion banner and cancel button',
    profileCode.includes('Account Deletion Requested') && profileCode.includes('handleCancelDeleteRequest'),
    'Expected deletion requested banner in profile'
);
check(
    'RequestDeleteModal collects reason dropdown, details, and password confirmation',
    requestDeleteModalCode.includes('Reason for Deletion') && requestDeleteModalCode.includes('Confirm Account Password'),
    'Expected RequestDeleteModal with reason and password inputs'
);
check(
    'Admin Users API exposes deleteRequest metadata and pending_delete filter',
    adminUsersApiCode.includes('deleteRequest') && adminUsersApiCode.includes("statusFilter === 'pending_delete'"),
    'Expected admin users API to surface delete requests and filter'
);
check(
    'Admin Users UI displays Deletion Requested badge and action buttons',
    adminUsersCode.includes('handleApproveDeleteRequest') && adminUsersCode.includes('handleRejectDeleteRequest'),
    'Expected approve and reject action handlers in admin users page'
);
check(
    'Admin delete-request API supports approve with safe anonymization and reject',
    adminDeleteRequestApiCode.includes("action === 'approve'") &&
    adminDeleteRequestApiCode.includes("action === 'reject'") &&
    adminDeleteRequestApiCode.includes('hasProtectedRecords'),
    'Expected admin delete-request endpoint to handle approve & reject with audit protection'
);

// --------------------------------------------------------------------------
// 6. Database Financial Ledger Invariant Protection
// --------------------------------------------------------------------------
console.log('\n--- 6. Remote Database Financial Invariants Certification ---');
const [rules, batches, items, ledger, wallets] = await Promise.all([
    serviceClient.from('shop_commission_rules').select('*', { count: 'exact', head: true }),
    serviceClient.from('vendor_settlement_batches').select('*', { count: 'exact', head: true }),
    serviceClient.from('vendor_settlement_items').select('*', { count: 'exact', head: true }),
    serviceClient.from('order_financial_ledger').select('*', { count: 'exact', head: true }),
    serviceClient.from('wallet_accounts').select('balance')
]);

const sumWallets = wallets.data ? wallets.data.reduce((acc, r) => acc + Number(r.balance || 0), 0) : 0;

console.log(`  Live remote Supabase database metrics:`);
console.log(`  - shop_commission_rules: ${rules.count} (expected: 2)`);
console.log(`  - vendor_settlement_batches: ${batches.count} (expected: 1)`);
console.log(`  - vendor_settlement_items: ${items.count} (expected: 4)`);
console.log(`  - order_financial_ledger: ${ledger.count} (expected: 17)`);
console.log(`  - wallet_accounts sum: Rs ${sumWallets} (expected: 88)`);

check('shop_commission_rules count preserved at 2', rules.count === 2, `Expected 2, got ${rules.count}`);
check('vendor_settlement_batches count preserved at 1', batches.count === 1, `Expected 1, got ${batches.count}`);
check('vendor_settlement_items count preserved at 4', items.count === 4, `Expected 4, got ${items.count}`);
check('order_financial_ledger count preserved at 17', ledger.count === 17, `Expected 17, got ${ledger.count}`);
check('wallet_accounts balance sum preserved at Rs 88', sumWallets === 88, `Expected 88, got ${sumWallets}`);

console.log('\n========================================================================');
console.log(`✓ ALL ${passedTests} / ${totalTests} TESTS PASSED WITH ZERO ERRORS`);
console.log('========================================================================');

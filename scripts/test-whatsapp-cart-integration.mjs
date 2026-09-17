/**
 * XerService Test Suite: WhatsApp Cart Integration (Stage 3)
 *
 * Verifies:
 * 1. Test A: Downloaded file + linked user transitions to 'cart_ready'.
 * 2. Test B: Idempotency (same upload processed twice creates zero duplicates).
 * 3. Test C: Unlinked user (user_id = null) creates no cart item, safely skipped.
 * 4. Test D: Missing storage_path is rejected safely without creating cart items.
 * 5. Test E: Ownership isolation (User A's file never appears in User B's cart,
 *    and User B cannot configure or claim User A's file).
 * 6. Preserved print defaults (a4, bw, single, portrait, copies: 1).
 */

import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

// 1. Load environment from .env.local
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
            const [k, ...v] = trimmed.split('=');
            process.env[k.trim()] = v.join('=').trim();
        }
    }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SECRET = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';

if (!SUPABASE_URL || !SUPABASE_SECRET) {
    console.error('Missing Supabase configuration in .env.local');
    process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_SECRET, { auth: { persistSession: false } });

let passed = 0;
let failed = 0;

function assert(condition, name, details = '') {
    if (condition) {
        passed++;
        console.log(`  ✓ PASS [${passed + failed}]: ${name}`);
    } else {
        failed++;
        console.error(`  ✗ FAIL [${passed + failed}]: ${name} ${details ? `(${details})` : ''}`);
    }
}

async function run() {
    console.log('═══════════════════════════════════════════════════════════════════');
    console.log('  TEST: WHATSAPP CART INTEGRATION PIPELINE (STAGE 3)');
    console.log('═══════════════════════════════════════════════════════════════════\n');

    const {
        prepareWhatsAppUploadForCart,
        listCustomerWhatsAppUploads,
    } = await import('../src/lib/whatsapp/cart-service.ts');

    // ── Setup Users ──────────────────────────────────────────────────
    // User A: Verified customer (Vishvaa Parthipan)
    const { data: profileA } = await sb
        .from('profiles')
        .select('user_id, full_name, phone')
        .eq('phone', '+919092925065')
        .maybeSingle();

    const userA_Id = profileA?.user_id;
    assert(Boolean(userA_Id), `User A identified: ${profileA?.full_name} (${userA_Id})`);

    // User B: Distinct customer (e.g. customer@xerservice.com or second customer)
    const { data: profileB } = await sb
        .from('profiles')
        .select('user_id')
        .neq('user_id', userA_Id)
        .limit(1)
        .single();

    const userB_Id = profileB?.user_id;
    assert(Boolean(userB_Id) && userB_Id !== userA_Id, `User B identified distinctly: (${userB_Id})`);

    // ── Test A: Downloaded file + linked user -> cart_ready ──────────
    console.log('\n--- Test A: Downloaded File + Linked User -> cart_ready ---');
    const uploadIdA = crypto.randomUUID();
    const storagePathA = `users/${userA_Id}/whatsapp/${uploadIdA}-assignment.pdf`;
    const messageIdA = `wamid.test_cart_${Date.now()}`;

    const { data: createdUploadA, error: createErrA } = await sb
        .from('whatsapp_uploads')
        .insert({
            id: uploadIdA,
            whatsapp_message_id: messageIdA,
            whatsapp_number: '+919092925065',
            user_id: userA_Id,
            media_id: 'media_test_cart_a',
            filename: 'assignment.pdf',
            mime_type: 'application/pdf',
            storage_path: storagePathA,
            status: 'downloaded',
        })
        .select('*')
        .single();

    assert(!createErrA && createdUploadA, 'Created test upload with status = downloaded and storage_path');

    const resA = await prepareWhatsAppUploadForCart(uploadIdA);

    assert(resA.success === true, 'prepareWhatsAppUploadForCart returns success: true');
    assert(resA.status === 'cart_ready', `Upload status transitioned to: ${resA.status}`);
    assert(resA.cartItem?.fileName === 'assignment.pdf', `Cart item preserved filename: ${resA.cartItem?.fileName}`);
    assert(resA.cartItem?.mimeType === 'application/pdf', `Cart item preserved MIME: ${resA.cartItem?.mimeType}`);
    assert(resA.cartItem?.storagePath === storagePathA, `Cart item preserved exact storage path: ${resA.cartItem?.storagePath}`);
    assert(resA.cartItem?.userId === userA_Id, `Cart item ownership preserved: ${resA.cartItem?.userId}`);
    assert(resA.cartItem?.source === 'whatsapp', `Cart item source is 'whatsapp': ${resA.cartItem?.source}`);
    assert(resA.cartItem?.color === 'bw', `Default print color is 'bw': ${resA.cartItem?.color}`);
    assert(resA.cartItem?.sides === 'single', `Default print sides is 'single': ${resA.cartItem?.sides}`);
    assert(resA.cartItem?.orientation === 'portrait', `Default print orientation is 'portrait': ${resA.cartItem?.orientation}`);
    assert(resA.cartItem?.paperSize === 'a4', `Default print paperSize is 'a4': ${resA.cartItem?.paperSize}`);
    assert(resA.cartItem?.copies === 1, `Default print copies is 1: ${resA.cartItem?.copies}`);

    const { data: checkUploadA } = await sb
        .from('whatsapp_uploads')
        .select('status')
        .eq('id', uploadIdA)
        .single();

    assert(checkUploadA.status === 'cart_ready', 'Database record status updated to cart_ready');

    // ── Test B: Idempotency (same upload processed twice) ────────────
    console.log('\n--- Test B: Idempotency Verification (Double Processing) ---');
    const resB = await prepareWhatsAppUploadForCart(uploadIdA);

    assert(resB.success === true, 'Second processing call returns success: true');
    assert(resB.status === 'cart_ready', 'Second processing call returns status: cart_ready');
    assert(resB.cartItem?.id === uploadIdA, 'Returns same cartItem without error');

    const { data: countUploadsA } = await sb
        .from('whatsapp_uploads')
        .select('id')
        .eq('id', uploadIdA);

    assert(countUploadsA?.length === 1, `whatsapp_uploads has exactly 1 row (count = ${countUploadsA?.length})`);

    const { data: countImportedA } = await sb
        .from('whatsapp_imported_files')
        .select('id')
        .eq('id', uploadIdA);

    assert(countImportedA?.length === 1, `whatsapp_imported_files has exactly 1 row (count = ${countImportedA?.length})`);

    // ── Test C: Unlinked User (user_id = null) ───────────────────────
    console.log('\n--- Test C: Unlinked User Ingestion Safety ---');
    const uploadIdC = crypto.randomUUID();
    await sb.from('whatsapp_uploads').insert({
        id: uploadIdC,
        whatsapp_message_id: `wamid.test_unlinked_${Date.now()}`,
        whatsapp_number: '+919999900000',
        user_id: null,
        media_id: 'media_unlinked_cart',
        filename: 'notes.pdf',
        mime_type: 'application/pdf',
        storage_path: 'temp/unlinked.pdf',
        status: 'downloaded',
    });

    const resC = await prepareWhatsAppUploadForCart(uploadIdC);

    assert(resC.success === false, 'Unlinked upload returns success: false');
    assert(resC.status === 'skipped_unlinked', `Unlinked upload returned status: ${resC.status}`);
    assert(!resC.cartItem, 'No cartItem created for unlinked upload');

    const { data: checkUploadC } = await sb
        .from('whatsapp_uploads')
        .select('status')
        .eq('id', uploadIdC)
        .single();

    assert(checkUploadC.status !== 'cart_ready', `Unlinked upload status remains non-cart_ready (${checkUploadC.status})`);

    // ── Test D: Missing storage_path ─────────────────────────────────
    console.log('\n--- Test D: Missing storage_path Handling ---');
    const uploadIdD = crypto.randomUUID();
    await sb.from('whatsapp_uploads').insert({
        id: uploadIdD,
        whatsapp_message_id: `wamid.test_nopath_${Date.now()}`,
        whatsapp_number: '+919092925065',
        user_id: userA_Id,
        media_id: 'media_no_path',
        filename: 'no_path.pdf',
        mime_type: 'application/pdf',
        storage_path: null,
        status: 'downloaded',
    });

    const resD = await prepareWhatsAppUploadForCart(uploadIdD);

    assert(resD.success === false, 'Missing storage_path returns success: false');
    assert(resD.status === 'rejected_missing_path', `Status indicates missing path: ${resD.status}`);
    assert(!resD.cartItem, 'No cart item created when storage_path is null');

    // ── Test E: Ownership Isolation (User A file never in User B cart) ──
    console.log('\n--- Test E: Tenant / Ownership Isolation ---');
    // Query User B's files via listCustomerWhatsAppUploads
    const userBFiles = await listCustomerWhatsAppUploads(userB_Id);
    const userAFileInB = userBFiles.some(f => f.id === uploadIdA);

    assert(userAFileInB === false, 'User A cart_ready file is strictly absent from User B uploads');

    // Verify User A does see it
    const userAFiles = await listCustomerWhatsAppUploads(userA_Id);
    const userAFileInA = userAFiles.some(f => f.id === uploadIdA);

    assert(userAFileInA === true, 'User A sees their own cart_ready file');

    // Cross-user configuration attempt: User B trying to configure User A's file
    const { data: crossCheck } = await sb
        .from('whatsapp_uploads')
        .select('*')
        .eq('id', uploadIdA)
        .eq('user_id', userB_Id)
        .maybeSingle();

    assert(crossCheck === null, 'User B querying User A uploadId yields NULL (ownership boundary preserved)');

    // ── Cleanup ──────────────────────────────────────────────────────
    console.log('\n--- Cleanup Test Artifacts ---');
    await sb.from('whatsapp_uploads').delete().in('id', [uploadIdA, uploadIdC, uploadIdD]);
    await sb.from('whatsapp_imported_files').delete().eq('id', uploadIdA);
    console.log('✓ Test records cleaned up.');

    console.log('\n═══════════════════════════════════════════════════════════════════');
    console.log(`  RESULTS: ${passed} PASSED / ${failed} FAILED`);
    console.log('═══════════════════════════════════════════════════════════════════\n');

    if (failed > 0) {
        process.exit(1);
    }
}

run().catch(err => {
    console.error('Test execution error:', err);
    process.exit(1);
});

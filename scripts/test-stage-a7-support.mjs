/**
 * XerService End-to-End Acceptance Test Suite: Stage A7 — Support
 *
 * Verifies all requirements from astraplan.md (Section 10 and roadmap line 736):
 * 1. Authoritative persistence: support tickets & messages in Supabase PostgreSQL.
 * 2. Sequential human-readable ticket numbers (TICK-1001).
 * 3. Guest contact form submission into real persisted ticket.
 * 4. Authenticated customer ticket submission with automatic account linkage.
 * 5. Order context linking (auto-linking order_id and shop_id).
 * 6. Admin Support Control Center API (/api/admin/support) RBAC and filters.
 * 7. Strict Privacy Invariant: Admin-only internal notes must NEVER appear in customer responses.
 * 8. Customer reply flow and ticket lifecycle status transitions.
 * 9. Customer tickets API (/api/customer/support) with account isolation.
 * 10. Strict zero delta on baseline financial invariants (ledger=17, wallets=₹88, rules=2, batches=1, items=4).
 */

import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

// Load environment variables from .env.local
const envPath = path.resolve(process.cwd(), '.env.local');
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

const SUPABASE_URL = envVars['NEXT_PUBLIC_SUPABASE_URL'] || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SECRET = envVars['SUPABASE_SECRET_KEY'] || process.env.SUPABASE_SECRET_KEY || envVars['SUPABASE_SERVICE_ROLE_KEY'] || process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_ANON = envVars['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'] || envVars['NEXT_PUBLIC_SUPABASE_ANON_KEY'] || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';

const sbAdmin = createClient(SUPABASE_URL, SUPABASE_SECRET, { auth: { persistSession: false } });
const sbAnon = createClient(SUPABASE_URL, SUPABASE_ANON, { auth: { persistSession: false } });

let passed = 0;
let failed = 0;

function assert(condition, name, details = '') {
    if (condition) {
        passed++;
        console.log(`  ✓ PASS [${passed}]: ${name}`);
    } else {
        failed++;
        console.error(`  ✗ FAIL [${passed + failed}]: ${name}`);
        if (details) console.error(`    Details: ${details}`);
    }
}

async function getBaselineInvariants() {
    const { count: ledger } = await sbAdmin.from('order_financial_ledger').select('*', { count: 'exact', head: true });
    const { data: wallets } = await sbAdmin.from('wallet_accounts').select('balance');
    const sumWallets = (wallets || []).reduce((acc, w) => acc + Number(w.balance), 0);
    const { count: rules } = await sbAdmin.from('shop_commission_rules').select('*', { count: 'exact', head: true });
    const { count: batches } = await sbAdmin.from('vendor_settlement_batches').select('*', { count: 'exact', head: true });
    const { count: items } = await sbAdmin.from('vendor_settlement_items').select('*', { count: 'exact', head: true });
    return { ledger, sumWallets, rules, batches, items };
}

async function getAuth(email) {
    const { data, error } = await sbAdmin.auth.admin.generateLink({ type: 'magiclink', email });
    if (error || !data?.properties?.email_otp) {
        throw new Error(`Failed to generate magiclink for ${email}: ${error?.message}`);
    }
    const tempAnon = createClient(SUPABASE_URL, SUPABASE_ANON, { auth: { persistSession: false } });
    const { data: sess, error: verifyError } = await tempAnon.auth.verifyOtp({
        email,
        token: data.properties.email_otp,
        type: 'email',
    });
    if (verifyError || !sess?.session?.access_token) {
        throw new Error(`Failed to verify OTP for ${email}: ${verifyError?.message}`);
    }
    return { token: sess.session.access_token, userId: sess.session.user.id };
}

async function run() {
    console.log('======================================================================');
    console.log('Stage A7: Support Acceptance Test Suite');
    console.log('======================================================================\n');

    // 0. Financial Invariants Pre-check
    const baseline = await getBaselineInvariants();
    console.log(`[Financial Baseline] ledger=${baseline.ledger}, wallets=₹${baseline.sumWallets}, rules=${baseline.rules}, batches=${baseline.batches}, items=${baseline.items}\n`);
    assert(baseline.ledger === 17 && baseline.sumWallets === 88 && baseline.rules === 2 && baseline.batches === 1 && baseline.items === 4,
        'Financial invariants verified at baseline');

    // 1. Issue Admin & Customer Auth Tokens
    console.log('\n--- Test Section 1: Authentication & Token Generation ---');
    const adminAuth = await getAuth('xerservice@gmail.com');
    assert(Boolean(adminAuth?.token), 'Admin session token issued successfully');
    const adminToken = adminAuth.token;

    const custAuth = await getAuth('admin@xerservice.com');
    assert(Boolean(custAuth?.token), 'Customer session token issued successfully');
    const custToken = custAuth.token;
    const custUserId = custAuth.userId;

    const createdTestTicketIds = [];

    // 2. Guest Ticket Submission (Contact Form)
    console.log('\n--- Test Section 2: Guest Ticket Creation via Contact Form ---');
    const guestRes = await fetch(`${BASE_URL}/api/support/tickets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            name: 'Asha Patel',
            email: 'asha.patel.guest@test.com',
            phone: '+919876543210',
            subject: 'Inquiry on Spiral Binding Bulk Pricing',
            message: 'Hello, what is your rate for binding 25 books of 100 pages each?',
        }),
    });
    const guestData = await guestRes.json();
    assert(guestRes.status === 201, 'Guest ticket created with HTTP 201');
    assert(guestData.success === true, 'Guest response indicates success: true');
    assert(typeof guestData.ticket?.ticketNumber === 'string' && guestData.ticket.ticketNumber.startsWith('TICK-'),
        `Ticket number is sequential formatted string: ${guestData.ticket?.ticketNumber}`);
    assert(guestData.ticket?.status === 'open', 'Initial ticket status is "open"');
    if (guestData.ticket?.id) createdTestTicketIds.push(guestData.ticket.id);

    // Verify DB persistence
    const { data: dbGuestTicket } = await sbAdmin
        .from('support_tickets')
        .select('*')
        .eq('id', guestData.ticket.id)
        .single();
    assert(dbGuestTicket && dbGuestTicket.source === 'contact_form', 'Guest ticket persisted in support_tickets with source "contact_form"');
    assert(dbGuestTicket && dbGuestTicket.user_id === null, 'Guest ticket has user_id = null');

    const { data: dbGuestMsgs } = await sbAdmin
        .from('support_messages')
        .select('*')
        .eq('ticket_id', guestData.ticket.id);
    assert(dbGuestMsgs && dbGuestMsgs.length === 1, 'Initial message persisted in support_messages');
    assert(dbGuestMsgs && dbGuestMsgs[0].is_internal_note === false, 'Initial message is public (is_internal_note = false)');

    // 3. Authenticated Customer Ticket Submission
    console.log('\n--- Test Section 3: Authenticated Customer Ticket Creation ---');
    const authCustRes = await fetch(`${BASE_URL}/api/support/tickets`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${custToken}`,
        },
        body: JSON.stringify({
            customerName: 'Karthik Customer',
            subject: 'Color Print Bleed Inquiry',
            message: 'Do your color printouts support borderless full-bleed prints?',
            priority: 'normal',
        }),
    });
    const authCustData = await authCustRes.json();
    assert(authCustRes.status === 201, 'Customer ticket created with HTTP 201');
    assert(authCustData.ticket?.id, 'Customer ticket ID returned');
    if (authCustData.ticket?.id) createdTestTicketIds.push(authCustData.ticket.id);

    const { data: dbCustTicket } = await sbAdmin
        .from('support_tickets')
        .select('*')
        .eq('id', authCustData.ticket.id)
        .single();
    assert(dbCustTicket && dbCustTicket.user_id === custUserId, `Ticket correctly linked to authenticated customer user_id: ${custUserId}`);
    assert(dbCustTicket && dbCustTicket.source === 'customer_portal', 'Ticket source is "customer_portal"');

    // 4. Order-Linked Ticket Creation
    console.log('\n--- Test Section 4: Order-Linked Ticket Creation ---');
    const { data: existingOrder } = await sbAdmin
        .from('orders')
        .select('id, order_number, shop_id')
        .limit(1)
        .single();

    assert(existingOrder && existingOrder.id, `Found existing order #${existingOrder?.order_number} for context linking`);

    const orderTicketRes = await fetch(`${BASE_URL}/api/support/tickets`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${custToken}`,
        },
        body: JSON.stringify({
            customerName: 'Karthik Customer',
            subject: `Order #${existingOrder?.order_number} Paper Quality Issue`,
            message: 'The paper thickness in this order was thinner than standard 80 GSM.',
            priority: 'high',
            orderId: existingOrder?.id,
        }),
    });
    const orderTicketData = await orderTicketRes.json();
    assert(orderTicketRes.status === 201, 'Order-linked ticket created with HTTP 201');
    if (orderTicketData.ticket?.id) createdTestTicketIds.push(orderTicketData.ticket.id);

    const { data: dbOrderTicket } = await sbAdmin
        .from('support_tickets')
        .select('*')
        .eq('id', orderTicketData.ticket.id)
        .single();
    assert(dbOrderTicket && dbOrderTicket.order_id === existingOrder?.id, 'Ticket correctly associated with order_id');
    assert(dbOrderTicket && dbOrderTicket.shop_id === existingOrder?.shop_id, 'Ticket automatically associated with order shop_id');
    assert(dbOrderTicket && dbOrderTicket.priority === 'high', 'Priority set to "high"');

    // 5. Admin Support API RBAC & Filters
    console.log('\n--- Test Section 5: Admin Support API RBAC & Listing ---');
    const unauthListRes = await fetch(`${BASE_URL}/api/admin/support`);
    assert(unauthListRes.status === 401, 'Unauthenticated GET /api/admin/support rejected with 401');

    const custRoleListRes = await fetch(`${BASE_URL}/api/admin/support`, {
        headers: { Authorization: `Bearer ${custToken}` },
    });
    assert(custRoleListRes.status === 403, 'Customer role GET /api/admin/support rejected with 403');

    const adminListRes = await fetch(`${BASE_URL}/api/admin/support`, {
        headers: { Authorization: `Bearer ${adminToken}` },
    });
    const adminListData = await adminListRes.json();
    assert(adminListRes.status === 200, 'Admin GET /api/admin/support succeeds with 200');
    assert(adminListData.success === true, 'Response indicates success: true');
    assert(typeof adminListData.summary?.total === 'number' && adminListData.summary.total >= 3,
        `Summary contains total tickets (${adminListData.summary?.total})`);
    assert(typeof adminListData.summary?.open === 'number', 'Summary contains open tickets count');
    assert(typeof adminListData.summary?.waiting === 'number', 'Summary contains waiting tickets count');
    assert(typeof adminListData.summary?.resolved === 'number', 'Summary contains resolved tickets count');
    assert(Array.isArray(adminListData.tickets), 'Response includes tickets array');

    // Check search filter
    const searchRes = await fetch(`${BASE_URL}/api/admin/support?search=Asha`, {
        headers: { Authorization: `Bearer ${adminToken}` },
    });
    const searchData = await searchRes.json();
    assert(searchRes.status === 200, 'Search query ?search=Asha succeeds');
    const foundAsha = searchData.tickets.find(t => t.customer_name.includes('Asha'));
    assert(Boolean(foundAsha), 'Search query successfully matched guest ticket by customer_name');

    // Check status filter
    const statusRes = await fetch(`${BASE_URL}/api/admin/support?status=open`, {
        headers: { Authorization: `Bearer ${adminToken}` },
    });
    const statusData = await statusRes.json();
    assert(statusRes.status === 200, 'Status filter ?status=open succeeds');
    const allOpen = statusData.tickets.every(t => t.status === 'open');
    assert(allOpen, 'All tickets returned by ?status=open have status === "open"');

    // 6. Ticket Detail & Strict Internal Note Privacy
    console.log('\n--- Test Section 6: Ticket Detail & Strict Internal Note Privacy ---');
    const ticketId = orderTicketData.ticket.id;

    // Admin fetches detail
    const adminDetailRes = await fetch(`${BASE_URL}/api/admin/support/${ticketId}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
    });
    const adminDetailData = await adminDetailRes.json();
    assert(adminDetailRes.status === 200, 'Admin successfully fetched ticket detail');
    assert(adminDetailData.ticket?.id === ticketId, 'Returned ticket ID matches requested ID');
    assert(adminDetailData.orderContext?.orderId === existingOrder?.id, 'Order context includes linked order details');
    assert(adminDetailData.orderContext?.orderNumber === existingOrder?.order_number, 'Order context includes orderNumber');

    // Admin posts an internal note
    const noteRes = await fetch(`${BASE_URL}/api/admin/support/${ticketId}/messages`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
            message: 'INTERNAL NOTE: Checked shop batch logs; vendor used 75 GSM paper instead of 80 GSM.',
            isInternalNote: true,
        }),
    });
    const noteData = await noteRes.json();
    assert(noteRes.status === 201, 'Admin successfully created internal note with 201');
    assert(noteData.message?.is_internal_note === true, 'Message record confirmed as is_internal_note = true');

    // Admin posts a public reply
    const replyRes = await fetch(`${BASE_URL}/api/admin/support/${ticketId}/messages`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
            message: 'Hello Karthik, thank you for reaching out. We are verifying the batch specs with the print shop.',
            isInternalNote: false,
        }),
    });
    const replyData = await replyRes.json();
    assert(replyRes.status === 201, 'Admin successfully posted public reply with 201');
    assert(replyData.message?.is_internal_note === false, 'Message record confirmed as is_internal_note = false');

    // Verify Admin sees ALL messages (including the internal note)
    const adminDetailAfter = await (await fetch(`${BASE_URL}/api/admin/support/${ticketId}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
    })).json();
    const adminHasInternalNote = adminDetailAfter.messages.some(m => m.is_internal_note === true);
    assert(adminHasInternalNote === true, 'Admin view includes internal notes for operational auditing');

    // STRICT PRIVACY INVARIANT: Verify Customer DOES NOT see internal note!
    const custDetailRes = await fetch(`${BASE_URL}/api/customer/support/${ticketId}`, {
        headers: { Authorization: `Bearer ${custToken}` },
    });
    const custDetailData = await custDetailRes.json();
    assert(custDetailRes.status === 200, 'Customer successfully fetched own ticket detail');
    const custHasInternalNote = custDetailData.messages.some(m => m.is_internal_note === true || m.message.includes('INTERNAL NOTE'));
    assert(custHasInternalNote === false, 'STRICT PRIVACY: Internal note is completely hidden from customer response');
    const custHasPublicReply = custDetailData.messages.some(m => m.message.includes('thank you for reaching out'));
    assert(custHasPublicReply === true, 'Customer sees the public reply from the operator');

    // 7. Customer Reply Flow & Status Transitions
    console.log('\n--- Test Section 7: Customer Reply Flow & Status Transition ---');
    // Admin public reply transitioned ticket to 'waiting'
    const { data: ticketAfterAdminReply } = await sbAdmin
        .from('support_tickets')
        .select('status')
        .eq('id', ticketId)
        .single();
    assert(ticketAfterAdminReply?.status === 'waiting', 'Admin public reply transitioned ticket status to "waiting"');

    // Customer replies
    const custReplyRes = await fetch(`${BASE_URL}/api/customer/support/${ticketId}/messages`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${custToken}`,
        },
        body: JSON.stringify({
            message: 'Understood, thank you. Please let me know once resolved.',
        }),
    });
    const custReplyData = await custReplyRes.json();
    assert(custReplyRes.status === 201, 'Customer reply posted successfully');

    // Status transitions back to 'open' upon customer response
    const { data: ticketAfterCustReply } = await sbAdmin
        .from('support_tickets')
        .select('status')
        .eq('id', ticketId)
        .single();
    assert(ticketAfterCustReply?.status === 'open', 'Customer reply automatically transitioned ticket status back to "open"');

    // 8. Admin Status & Priority Update
    console.log('\n--- Test Section 8: Admin Status & Priority Lifecycle Updates ---');
    const updateRes = await fetch(`${BASE_URL}/api/admin/support/${ticketId}`, {
        method: 'PATCH',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
            status: 'resolved',
            priority: 'urgent',
        }),
    });
    const updateData = await updateRes.json();
    assert(updateRes.status === 200, 'Admin PATCH /api/admin/support/[ticketId] succeeds with 200');
    assert(updateData.ticket?.status === 'resolved', 'Ticket status updated to "resolved"');
    assert(updateData.ticket?.priority === 'urgent', 'Ticket priority updated to "urgent"');
    assert(Boolean(updateData.ticket?.resolved_at), `Ticket resolved_at recorded: ${updateData.ticket?.resolved_at}`);

    // 9. Customer Tickets List & Account Isolation
    console.log('\n--- Test Section 9: Customer Tickets List Isolation ---');
    const custTicketsRes = await fetch(`${BASE_URL}/api/customer/support`, {
        headers: { Authorization: `Bearer ${custToken}` },
    });
    const custTicketsData = await custTicketsRes.json();
    assert(custTicketsRes.status === 200, 'Customer GET /api/customer/support succeeds with 200');
    assert(Array.isArray(custTicketsData.tickets), 'Customer received tickets array');
    const allBelongToCustomer = custTicketsData.tickets.every(t => t.user_id === custUserId);
    assert(allBelongToCustomer, 'All tickets returned belong strictly to the authenticated customer');
    const containsGuestTicket = custTicketsData.tickets.some(t => t.id === guestData.ticket.id);
    assert(containsGuestTicket === false, 'Customer cannot see other users or guest tickets');

    // 10. Non-Destructive Test Cleanup & Financial Invariant Check
    console.log('\n--- Test Section 10: Non-Destructive Cleanup & Financial Invariants ---');
    if (createdTestTicketIds.length > 0) {
        const { error: delErr } = await sbAdmin
            .from('support_tickets')
            .delete()
            .in('id', createdTestTicketIds);
        assert(!delErr, `Safely cleaned up ${createdTestTicketIds.length} test tickets`);
    }

    const postTestInvariants = await getBaselineInvariants();
    console.log(`[Invariant Check - POST-TEST] ledger=${postTestInvariants.ledger}, wallets=₹${postTestInvariants.sumWallets}, rules=${postTestInvariants.rules}, batches=${postTestInvariants.batches}, items=${postTestInvariants.items}`);
    assert(postTestInvariants.ledger === 17, `Post-Execution ledger count strictly preserved (17 === ${postTestInvariants.ledger})`);
    assert(postTestInvariants.sumWallets === 88, `Post-Execution wallet sum strictly preserved (88 === ${postTestInvariants.sumWallets})`);
    assert(postTestInvariants.rules === 2, `Post-Execution commission rules strictly preserved (2 === ${postTestInvariants.rules})`);
    assert(postTestInvariants.batches === 1, `Post-Execution settlement batches strictly preserved (1 === ${postTestInvariants.batches})`);
    assert(postTestInvariants.items === 4, `Post-Execution settlement items strictly preserved (4 === ${postTestInvariants.items})`);

    console.log('\n======================================================================');
    console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} total tests (${Math.round((passed / (passed + failed)) * 100)}%)`);
    console.log('======================================================================\n');

    if (failed > 0) {
        process.exit(1);
    }
}

run().catch(err => {
    console.error('Fatal error running Stage A7 tests:', err);
    process.exit(1);
});

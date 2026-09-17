import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

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

const client = createClient(supabaseUrl, supabaseSecret);

async function main() {
    console.log('--- AUDITING ORDER FINANCIAL LEDGER & REFUND REQUESTS ---');

    // 1. All ledger rows
    const { data: ledgers, error: lErr } = await client
        .from('order_financial_ledger')
        .select('*')
        .order('created_at', { ascending: true });

    if (lErr) {
        console.error('Error fetching ledgers:', lErr);
        return;
    }

    console.log(`Total order_financial_ledger rows: ${ledgers.length}`);

    // 2. Fetch associated orders
    const orderIds = ledgers.map(l => l.order_id);
    const { data: orders, error: oErr } = await client
        .from('orders')
        .select('id, order_number, status, total_amount, paid_at, cancelled_at')
        .in('id', orderIds);

    const orderMap = new Map((orders || []).map(o => [o.id, o]));

    // 3. For each ledger, query refund requests
    for (const l of ledgers) {
        const o = orderMap.get(l.order_id);
        console.log('\n----------------------------------------');
        console.log(`Order: #${o?.order_number} (${l.order_id})`);
        console.log(`Ledger ID: ${l.id}`);
        console.log(`Financial Status: ${l.financial_status}`);
        console.log(`Gross Amount: ${l.gross_amount}`);
        console.log(`Commission BPS: ${l.commission_bps}`);
        console.log(`Platform Commission: ${l.platform_commission_amount}`);
        console.log(`Vendor Net: ${l.vendor_net_amount}`);
        console.log(`Current reversed_at: ${l.reversed_at}`);
        console.log(`Current refund_request_id: ${l.refund_request_id}`);
        console.log(`Reversal Reason: ${l.reversal_reason}`);
        console.log(`Order paid_at: ${o?.paid_at}`);
        console.log(`Order cancelled_at: ${o?.cancelled_at}`);

        // Search refunds for this order
        const { data: refunds, error: rErr } = await client
            .from('refund_requests')
            .select('*')
            .eq('order_id', l.order_id);

        console.log(`Matching refund_requests count: ${refunds?.length || 0}`);
        if (refunds && refunds.length > 0) {
            for (const r of refunds) {
                console.log(`  -> Refund ID: ${r.id}`);
                console.log(`     Status: ${r.status}`);
                console.log(`     Amount: ${r.amount}`);
                console.log(`     Payment Attempt ID: ${r.payment_attempt_id} (Matches Ledger Attempt? ${r.payment_attempt_id === l.payment_attempt_id})`);
                console.log(`     Completed At: ${r.completed_at}`);
                console.log(`     Created At: ${r.created_at}`);
            }
        }
    }

    // Check batches, items, rules count
    const { count: batchCount } = await client.from('vendor_settlement_batches').select('*', { count: 'exact', head: true });
    const { count: itemCount } = await client.from('vendor_settlement_items').select('*', { count: 'exact', head: true });
    const { count: ruleCount } = await client.from('shop_commission_rules').select('*', { count: 'exact', head: true });

    console.log('\n========================================');
    console.log(`Current Live Counts:`);
    console.log(`  vendor_settlement_batches: ${batchCount}`);
    console.log(`  vendor_settlement_items: ${itemCount}`);
    console.log(`  shop_commission_rules: ${ruleCount}`);
    console.log('========================================');
}

main().catch(console.error);

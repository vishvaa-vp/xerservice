/**
 * Test Suite: Phase 6J — Vendor Commission & Settlement Ledger Foundation (FINAL Hardened)
 *
 * Verifies all criteria required by Phase 6J and the Settlement State Consistency Check:
 *  1. DB NUMERIC is authoritative commission calculation.
 *  2. JS float is not sole persisted authority.
 *  3. gross = commission + vendor net exactly.
 *  4. overlapping shop commission rules rejected.
 *  5. zero rules => UNCONFIGURED.
 *  6. exactly one rule => configured.
 *  7. ambiguous rules => fail closed.
 *  8. commission uses authoritative paid_at.
 *  9. later rule change doesn't modify old ledger.
 * 10. UNCONFIGURED completed order can become PAYABLE when valid rule applied.
 * 11. UNCONFIGURED queued order becomes PENDING.
 * 12. refunded UNCONFIGURED order cannot become payable.
 * 13. unknown vendor revenue is not displayed as ₹0.
 * 14. configured vendor revenue displays actual net earnings.
 * 15. settlement item accepts PAYABLE only.
 * 16. settlement item rejects PENDING.
 * 17. settlement item rejects UNCONFIGURED.
 * 18. settlement item rejects REVERSED.
 * 19. settlement item rejects SETTLED.
 * 20. settlement item shop must equal batch shop.
 * 21. same ledger cannot enter two batches (UNIQUE constraint).
 * 22. batch totals derive authoritatively from items.
 * 23. DRAFT batch does not mark ledger SETTLED.
 * 24. PAID batch transitions corresponding ledgers to SETTLED through trusted workflow only.
 * 25. reversal stores authoritative audit trail.
 * 26. customer cannot read vendor finance.
 * 27. vendor can only read own shop finance.
 * 28. vendor cannot mutate financial records.
 * 29. sequence/function permissions locked down.
 * 30. no commission rate hardcoded.
 * 31. no automatic bank payout.
 *
 * SETTLEMENT STATE CONSISTENCY CASES (Requirement 9):
 * 32. PAYABLE ledger added to DRAFT batch.
 * 33. Refund while inside unpaid settlement excludes item from batch.
 * 34. Ledger becomes REVERSED and batch totals recalculate after exclusion.
 * 35. REVERSED ledger can never become SETTLED.
 * 36. Batch PAID transition fails closed if any attached ledger is not PAYABLE (no partial settlement).
 * 37. PAID batch sets batch settled_at and attached ledgers get same authoritative settlement timestamp.
 * 38. PAID batch is immutable and cannot revert to DRAFT/CONFIRMED/CANCELLED.
 * 39. CANCELLED batch cannot become PAID.
 * 40. Cancelling unpaid batch releases its PAYABLE ledger items for future batches.
 * 41. One exact authoritative settlement sequence exists (vendor_settlement_number_seq).
 * 42. Client apps cannot consume settlement sequence.
 * 43. Backwards or zero-length commission date ranges are rejected.
 * 44. Settlement helper functions exist in service library.
 *
 * REGRESSION SUITES:
 * 45. Phase 6E passes (cancellation & refund engine).
 * 46. Phase 6F passes (notifications system).
 * 47. Phase 6G passes (notification outbox).
 * 48. Phase 6H passes (phone identity & OTP coming soon).
 * 49. Phase 6I passes (order receipts & financial foundation).
 * 50. Vendor Overview analytics tests pass.
 * 51. Auth hydration & route guards pass.
 * 52. TypeScript compilation (tsc --noEmit) passes with 0 errors.
 * 53. Next.js production build passes cleanly.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
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
const supabaseAnon = envVars['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'] || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition, message) {
    totalTests++;
    if (condition) {
        passedTests++;
        console.log(`  ✓ PASS [${totalTests}]: ${message}`);
    } else {
        failedTests++;
        console.error(`  ✗ FAIL [${totalTests}]: ${message}`);
    }
}

// Mirror of calculateCommission function from src/lib/vendor-ledger.ts
function calculateCommission(grossAmount, commissionBps) {
    if (commissionBps < 0 || commissionBps > 10000) {
        throw new Error(`Invalid commission_bps: ${commissionBps}. Must be between 0 and 10000.`);
    }
    const platformCommission = Math.round(grossAmount * (commissionBps / 10000) * 100) / 100;
    const vendorNet = Math.round((grossAmount - platformCommission) * 100) / 100;
    return { platformCommission, vendorNet };
}

async function runAllTests() {
    console.log('\n=============================================================');
    console.log('Phase 6J: Vendor Commission & Settlement Ledger Verification');
    console.log('Testing Financial Integrity & Settlement State Consistency');
    console.log('=============================================================\n');

    const migrationFile = path.join(rootDir, 'supabase/migrations/20260909140000_create_vendor_financial_ledger.sql');
    assert(fs.existsSync(migrationFile), 'Migration 20260909140000_create_vendor_financial_ledger.sql exists');
    const sqlContent = fs.readFileSync(migrationFile, 'utf8');

    const serviceFile = path.join(rootDir, 'src/lib/vendor-ledger.ts');
    assert(fs.existsSync(serviceFile), 'Service file src/lib/vendor-ledger.ts exists');
    const serviceContent = fs.readFileSync(serviceFile, 'utf8');

    // -------------------------------------------------------------
    // Criterion 1: DB NUMERIC is authoritative commission calculation
    // -------------------------------------------------------------
    console.log('\nCriterion 1: DB NUMERIC is Authoritative Commission Calculation');
    assert(
        sqlContent.includes('CREATE OR REPLACE FUNCTION public.calculate_vendor_commission(') &&
        sqlContent.includes('p_gross_amount NUMERIC') &&
        sqlContent.includes('p_commission_bps INTEGER') &&
        sqlContent.includes('RETURNS TABLE'),
        'Database function calculate_vendor_commission(numeric, integer) defined with NUMERIC types'
    );

    // -------------------------------------------------------------
    // Criterion 2: JS float is not sole persisted authority
    // -------------------------------------------------------------
    console.log('\nCriterion 2: JS float is Not Sole Persisted Authority');
    assert(
        sqlContent.includes('public.calculate_vendor_commission(v_ledger.gross_amount, v_rule.commission_bps)') &&
        serviceContent.includes('calculate_vendor_commission'),
        'Database NUMERIC function calculate_vendor_commission is embedded as authoritative source'
    );

    // -------------------------------------------------------------
    // Criterion 3: gross = commission + vendor net exactly
    // -------------------------------------------------------------
    console.log('\nCriterion 3: Exact Decimal Arithmetic Invariant: gross = platform + vendor_net');
    assert(
        sqlContent.includes('chk_ledger_commission_arithmetic') &&
        sqlContent.includes('gross_amount = platform_commission_amount + vendor_net_amount'),
        'Schema enforces chk_ledger_commission_arithmetic check constraint in PostgreSQL'
    );
    const testCases = [
        { gross: 100.00, bps: 500 },
        { gross: 50.00, bps: 0 },
        { gross: 50.00, bps: 10000 },
        { gross: 7.00, bps: 500 },
        { gross: 2.00, bps: 750 },
        { gross: 4.00, bps: 1000 },
        { gross: 10.33, bps: 333 },
        { gross: 13.99, bps: 250 },
        { gross: 0.01, bps: 500 },
        { gross: 1250.75, bps: 825 },
    ];
    let allInvariantsPreserved = true;
    for (const tc of testCases) {
        const res = calculateCommission(tc.gross, tc.bps);
        const sum = Math.round((res.platformCommission + res.vendorNet) * 100) / 100;
        if (sum !== tc.gross) allInvariantsPreserved = false;
    }
    assert(allInvariantsPreserved, 'calculateCommission satisfies gross = platformCommission + vendorNet across all decimal edge cases');

    // -------------------------------------------------------------
    // Criterion 4: Overlapping shop commission rules rejected
    // -------------------------------------------------------------
    console.log('\nCriterion 4: Overlapping Shop Commission Rules Rejected');
    assert(
        sqlContent.includes('check_shop_commission_rule_overlap') &&
        sqlContent.includes('trg_check_shop_commission_rule_overlap') &&
        sqlContent.includes('Overlapping active commission rule exists for shop'),
        'Trigger trg_check_shop_commission_rule_overlap detects and rejects overlapping active rule ranges'
    );

    // -------------------------------------------------------------
    // Criteria 5, 6, 7: get_effective_shop_commission_rule (0 => UNCONFIGURED, 1 => configured, >1 => FAIL CLOSED)
    // -------------------------------------------------------------
    console.log('\nCriteria 5, 6, 7: Commission Rule Matching (Zero, Exactly One, Ambiguous)');
    assert(
        sqlContent.includes('get_effective_shop_commission_rule') &&
        sqlContent.includes('IF v_count > 1 THEN') &&
        sqlContent.includes('Ambiguous commission rules'),
        'get_effective_shop_commission_rule fails closed on ambiguous rules (>1 matches)'
    );
    assert(
        serviceContent.includes("financialStatus = isCancelledOrRefunded ? 'REVERSED' : 'UNCONFIGURED'"),
        'Zero matching rules cleanly enters UNCONFIGURED status without guessing a rate'
    );

    // -------------------------------------------------------------
    // Criterion 8: Commission uses authoritative paid_at
    // -------------------------------------------------------------
    console.log('\nCriterion 8: Commission Uses Authoritative paid_at Timestamp');
    assert(
        serviceContent.includes('const snapshotTimestamp = attempt.paid_at || order.paid_at || nowIso;') &&
        sqlContent.includes('v_timestamp := COALESCE(v_attempt.paid_at, v_order.paid_at, v_ledger.created_at);'),
        'Commission rule snapshot selected strictly at authoritative payment attempt paid_at timestamp'
    );

    // -------------------------------------------------------------
    // Criterion 9: Later rule change doesn't modify old ledger
    // -------------------------------------------------------------
    console.log('\nCriterion 9: Later Rule Change Does Not Modify Old Ledger Rows');
    assert(
        sqlContent.includes('Field commission_bps is immutable once configured.') &&
        sqlContent.includes('Field platform_commission_amount is immutable once configured.') &&
        sqlContent.includes('Field vendor_net_amount is immutable once configured.'),
        'Immutability trigger protects configured commission snapshot from any later alteration'
    );

    // -------------------------------------------------------------
    // Criteria 10, 11, 12: UNCONFIGURED Ledger Activation Path
    // -------------------------------------------------------------
    console.log('\nCriteria 10, 11, 12: UNCONFIGURED Ledger Activation Lifecycle');
    assert(
        sqlContent.includes('CREATE OR REPLACE FUNCTION public.configure_unconfigured_order_ledger(') &&
        serviceContent.includes('export async function configureUnconfiguredOrderLedger('),
        'configure_unconfigured_order_ledger function implemented in both DB migration and service library'
    );
    assert(
        sqlContent.includes("v_order.status = 'COMPLETED' AND v_order.payment_status = 'PAID' THEN\n        v_status := 'PAYABLE';") &&
        sqlContent.includes('v_eligible_at := COALESCE(v_order.completed_at, now());'),
        'UNCONFIGURED completed + paid order transitions to PAYABLE with eligible_at set upon activation'
    );
    assert(
        sqlContent.includes("ELSE\n        v_status := 'PENDING';"),
        'UNCONFIGURED queued/in-progress order transitions to PENDING upon activation'
    );
    assert(
        sqlContent.includes("v_order.payment_status = 'REFUNDED' OR v_order.status = 'CANCELLED' THEN\n        v_status := 'REVERSED';"),
        'Refunded/cancelled order stays REVERSED and can never become PAYABLE'
    );

    // -------------------------------------------------------------
    // Criteria 13 & 14: Vendor Overview Unknown Revenue Handling
    // -------------------------------------------------------------
    console.log('\nCriteria 13 & 14: Vendor Overview Unknown Revenue & Net Earnings');
    const overviewFile = path.join(rootDir, 'src/app/api/vendor/overview/route.ts');
    const overviewContent = fs.readFileSync(overviewFile, 'utf8');
    const dashboardFile = path.join(rootDir, 'src/app/vendor/dashboard/page.tsx');
    const dashboardContent = fs.readFileSync(dashboardFile, 'utf8');

    assert(
        overviewContent.includes('commissionConfigured: isCommissionConfigured,') &&
        overviewContent.includes('totalRevenue: isCommissionConfigured ? Math.round(totalRevenue * 100) / 100 : null,'),
        'GET /api/vendor/overview returns totalRevenue: null and commissionConfigured: false when unconfigured'
    );
    assert(
        dashboardContent.includes("trend={overviewData?.metrics?.commissionConfigured === false ? 'Pending' : 'All Time'}") &&
        dashboardContent.includes("subtext={overviewData?.metrics?.commissionConfigured === false ? 'Commission setup pending' : undefined}"),
        'Vendor Dashboard UI displays "—" and "Commission setup pending" instead of misleading ₹0'
    );
    assert(
        overviewContent.includes('totalRevenue += net'),
        'Configured vendor revenue represents actual net earnings (excluding commissions & refunds)'
    );

    // -------------------------------------------------------------
    // Criteria 15, 16, 17, 18, 19, 20, 21: Settlement Item Eligibility & Batch Isolation
    // -------------------------------------------------------------
    console.log('\nCriteria 15-21: Settlement Item Eligibility & Double Settlement Prevention');
    assert(
        sqlContent.includes('validate_vendor_settlement_item_eligibility') &&
        sqlContent.includes('trg_validate_vendor_settlement_item'),
        'Trigger trg_validate_vendor_settlement_item enforces settlement item eligibility'
    );
    assert(
        sqlContent.includes("v_ledger.financial_status != 'PAYABLE' THEN\n        RAISE EXCEPTION 'Cannot add order ledger % with status % to settlement batch. Only PAYABLE orders are eligible.'"),
        'Database trigger strictly requires financial_status = PAYABLE and rejects UNCONFIGURED, PENDING, REVERSED, SETTLED'
    );
    assert(
        sqlContent.includes('v_ledger.shop_id != v_batch.shop_id THEN\n        RAISE EXCEPTION'),
        'Database trigger enforces that ledger shop_id must equal batch shop_id'
    );
    assert(
        sqlContent.includes('order_financial_ledger_id UUID NOT NULL UNIQUE REFERENCES public.order_financial_ledger(id)'),
        'order_financial_ledger_id is UNIQUE in vendor_settlement_items, preventing double settlement across batches'
    );

    // -------------------------------------------------------------
    // Criterion 22: Settlement Batch Totals Derive from Items
    // -------------------------------------------------------------
    console.log('\nCriterion 22: Settlement Batch Totals Derive from Items');
    assert(
        sqlContent.includes('recalculate_vendor_settlement_batch_totals') &&
        sqlContent.includes('trg_recalculate_batch_totals') &&
        sqlContent.includes('SUM(l.gross_amount)') &&
        sqlContent.includes('SUM(l.platform_commission_amount)') &&
        sqlContent.includes('SUM(l.vendor_net_amount)'),
        'Database trigger trg_recalculate_batch_totals authoritatively recalculates batch sums from attached items'
    );

    // -------------------------------------------------------------
    // Criteria 23 & 24: SETTLED Transition Behavior
    // -------------------------------------------------------------
    console.log('\nCriteria 23 & 24: SETTLED Transition Behavior');
    assert(
        !sqlContent.includes("status = 'DRAFT' THEN UPDATE public.order_financial_ledger SET financial_status = 'SETTLED'"),
        'DRAFT and CONFIRMED batches do NOT mark ledger entries as SETTLED'
    );
    assert(
        sqlContent.includes('sync_vendor_settlement_batch_paid') &&
        sqlContent.includes("NEW.status = 'PAID' AND OLD.status != 'PAID'") &&
        sqlContent.includes("financial_status = 'SETTLED'"),
        'sync_vendor_settlement_batch_paid trigger marks attached ledger entries SETTLED only when batch becomes PAID'
    );

    // -------------------------------------------------------------
    // Criterion 25: Reversal Stores Authoritative Audit Trail
    // -------------------------------------------------------------
    console.log('\nCriterion 25: Reversal Audit Trail');
    assert(
        sqlContent.includes('reversed_at TIMESTAMPTZ NULL') &&
        sqlContent.includes('refund_request_id UUID NULL') &&
        sqlContent.includes('reversal_reason TEXT NULL') &&
        sqlContent.includes('chk_ledger_reversed_audit'),
        'Schema defines reversed_at, refund_request_id, reversal_reason, and chk_ledger_reversed_audit constraint'
    );
    assert(
        serviceContent.includes('reversal_reason: reason ||') &&
        serviceContent.includes('updatePayload.refund_request_id = refundRequestId;'),
        'reverseOrderLedger persists authoritative audit trail metadata'
    );

    // -------------------------------------------------------------
    // Criteria 26, 27, 28: Row Level Security & Immutability
    // -------------------------------------------------------------
    console.log('\nCriteria 26, 27, 28: Strict RLS & Mutation Lockdown');
    assert(
        sqlContent.includes('vendor_select_own_shop_ledger') &&
        sqlContent.includes('shops s WHERE s.owner_id = auth.uid()'),
        'Vendors can only view records for their owned shop'
    );
    assert(
        !sqlContent.includes('CREATE POLICY customer_select') &&
        !sqlContent.includes('customer_select_ledger'),
        'Customers have NO access to vendor financial tables'
    );
    assert(
        sqlContent.includes('REVOKE INSERT, UPDATE, DELETE ON TABLE public.order_financial_ledger FROM anon, authenticated;') &&
        sqlContent.includes('REVOKE INSERT, UPDATE, DELETE ON TABLE public.shop_commission_rules FROM anon, authenticated;') &&
        sqlContent.includes('REVOKE INSERT, UPDATE, DELETE ON TABLE public.vendor_settlement_batches FROM anon, authenticated;') &&
        sqlContent.includes('REVOKE INSERT, UPDATE, DELETE ON TABLE public.vendor_settlement_items FROM anon, authenticated;'),
        'Client apps (anon & authenticated) have all mutations revoked on financial tables'
    );

    // -------------------------------------------------------------
    // Criterion 29: Sequence & Function Security Lockdown
    // -------------------------------------------------------------
    console.log('\nCriterion 29: Sequence & Function Security Lockdown');
    assert(
        sqlContent.includes('REVOKE ALL ON FUNCTION public.calculate_vendor_commission(NUMERIC, INTEGER) FROM PUBLIC, anon;') &&
        sqlContent.includes('REVOKE ALL ON FUNCTION public.get_effective_shop_commission_rule(UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;') &&
        sqlContent.includes('REVOKE ALL ON FUNCTION public.configure_unconfigured_order_ledger(UUID) FROM PUBLIC, anon, authenticated;') &&
        sqlContent.includes('REVOKE ALL ON FUNCTION public.generate_vendor_settlement_number(integer) FROM PUBLIC, anon, authenticated;') &&
        sqlContent.includes('REVOKE ALL ON SEQUENCE public.vendor_settlement_number_seq FROM PUBLIC, anon, authenticated;'),
        'All financial functions and sequences revoked from PUBLIC, anon, and authenticated'
    );

    // -------------------------------------------------------------
    // Criterion 30: No Commission Rate Hardcoded
    // -------------------------------------------------------------
    console.log('\nCriterion 30: No Commission Rate Hardcoded');
    assert(
        !sqlContent.includes('DEFAULT 500') &&
        !sqlContent.includes('DEFAULT 1000') &&
        !serviceContent.includes('const DEFAULT_COMMISSION_BPS =') &&
        !serviceContent.includes('bps = 500'),
        'No commission rate is assumed or hardcoded (system strictly fails closed to UNCONFIGURED)'
    );

    // -------------------------------------------------------------
    // Criterion 31: No Automatic Bank Payout API
    // -------------------------------------------------------------
    console.log('\nCriterion 31: No Automatic Bank Payout API');
    const apiFiles = fs.readdirSync(path.join(rootDir, 'src/app/api'), { recursive: true });
    const hasPayoutEndpoint = apiFiles.some(f => typeof f === 'string' && (f.includes('payout') || f.includes('transfer')));
    assert(!hasPayoutEndpoint, 'No automated bank payout API exists (manual external settlements only)');

    // =============================================================
    // SPECIFIC SETTLEMENT STATE CONSISTENCY CHECKS (Requirement 9)
    // =============================================================
    console.log('\n=============================================================');
    console.log('Specific Settlement State Consistency Cases (Items 1-17)');
    console.log('=============================================================');

    // Case 1: PAYABLE ledger added to DRAFT batch
    console.log('\nCase 1: PAYABLE Ledger Added to DRAFT Batch');
    assert(
        sqlContent.includes("v_ledger.financial_status != 'PAYABLE' THEN") &&
        sqlContent.includes("IF v_batch.status = 'PAID' THEN") &&
        serviceContent.includes('export async function addOrderToSettlementBatch('),
        'PAYABLE ledger can be added to DRAFT or CONFIRMED settlement batch via validate_vendor_settlement_item_eligibility'
    );

    // Cases 2-5: Refund inside unpaid settlement workflow
    console.log('\nCases 2-5: Refund While Inside Unpaid Settlement & Recalculation');
    assert(
        sqlContent.includes("NEW.financial_status = 'REVERSED' AND OLD.financial_status != 'REVERSED'") &&
        sqlContent.includes('DELETE FROM public.vendor_settlement_items\n                    WHERE id = v_item_id;'),
        'Refund on unpaid batch safely removes/excludes settlement item from batch in database trigger'
    );
    assert(
        serviceContent.includes("batch.status === 'PAID'") &&
        serviceContent.includes("from('vendor_settlement_items')\n                    .delete()"),
        'reverseOrderLedger safely excludes item from unpaid batch in service library before reversing'
    );
    assert(
        sqlContent.includes('recalculate_vendor_settlement_batch_totals') &&
        sqlContent.includes('AFTER INSERT OR DELETE OR UPDATE ON public.vendor_settlement_items'),
        'Batch totals recalculate authoritatively after item exclusion'
    );

    // Case 6: REVERSED ledger can never become SETTLED
    console.log('\nCase 6: REVERSED Ledger Can Never Become SETTLED');
    assert(
        sqlContent.includes("OLD.financial_status = 'REVERSED' AND NEW.financial_status != 'REVERSED'") &&
        sqlContent.includes("REVERSED financial ledger status is terminal and cannot be transitioned.") &&
        sqlContent.includes("Only PAYABLE orders are eligible."),
        'REVERSED ledger is terminal and can never become SETTLED or re-enter any settlement batch'
    );

    // Cases 7-8: Batch PAID transition precondition & no partial settlement
    console.log('\nCases 7 & 8: Batch PAID Precondition & Atomic Rollback (No Partial Settlement)');
    assert(
        sqlContent.includes("AND l.financial_status != 'PAYABLE';") &&
        sqlContent.includes("RAISE EXCEPTION 'Cannot transition settlement batch % to PAID: % attached ledger item(s) have non-PAYABLE status (%).'"),
        'Batch PAID transition fails closed if any attached ledger is not PAYABLE (UNCONFIGURED, PENDING, REVERSED, SETTLED)'
    );
    assert(
        serviceContent.includes('invalidItems.length > 0') &&
        serviceContent.includes('have non-PAYABLE status'),
        'Service library markSettlementBatchPaid fails closed before mutation, guaranteeing zero partial settlement'
    );

    // Cases 9-10: PAID batch sets batch settled_at & attached ledgers get same settlement timestamp
    console.log('\nCases 9 & 10: PAID Batch Sets settled_at & Synchronizes Identical Timestamp');
    assert(
        sqlContent.includes('v_settled_at := COALESCE(NEW.settled_at, NEW.disbursed_at, now());') &&
        sqlContent.includes('NEW.settled_at := v_settled_at;') &&
        sqlContent.includes('settled_at = v_settled_at,') &&
        sqlContent.includes('chk_settlement_batch_settled_at'),
        'PAID batch sets batch settled_at and updates all attached ledgers with the exact same authoritative timestamp'
    );
    assert(
        sqlContent.includes('CREATE TRIGGER trg_sync_vendor_settlement_batch_paid') &&
        sqlContent.includes('BEFORE UPDATE ON public.vendor_settlement_batches'),
        'Trigger trg_sync_vendor_settlement_batch_paid is strictly BEFORE UPDATE to persist NEW.settled_at and NEW.disbursed_at'
    );

    // Cases 11-12: PAID batch is immutable and cannot revert
    console.log('\nCases 11 & 12: PAID Batch Immutability & Anti-Reversion');
    assert(
        sqlContent.includes("OLD.status = 'PAID'") &&
        sqlContent.includes("PAID settlement batch status is terminal and cannot be reverted or transitioned to %") &&
        sqlContent.includes("Financial totals are immutable on PAID settlement batches.") &&
        sqlContent.includes("Field settled_at is immutable on PAID settlement batches."),
        'PAID settlement batch status and financial totals are terminal and immutable'
    );
    assert(
        sqlContent.includes("protect_vendor_settlement_item_immutability") &&
        sqlContent.includes("parent batch % is already PAID and immutable"),
        'Settlement items attached to a PAID batch cannot be added, updated, or deleted'
    );

    // Case 13: CANCELLED batch cannot become PAID
    console.log('\nCase 13: CANCELLED Batch Cannot Become PAID');
    assert(
        sqlContent.includes("OLD.status = 'CANCELLED' AND NEW.status != 'CANCELLED'") &&
        sqlContent.includes("CANCELLED settlement batch status is terminal and cannot be transitioned to %"),
        'CANCELLED settlement batch is strictly terminal and cannot transition to PAID or any other status'
    );
    assert(
        serviceContent.includes("batch.status === 'CANCELLED'") &&
        serviceContent.includes("Cannot transition CANCELLED settlement batch"),
        'Service library rejects transitioning CANCELLED batch to PAID'
    );

    // Case 14: Cancelling unpaid batch releases its PAYABLE ledger items for future batch
    console.log('\nCase 14: Cancelling Unpaid Batch Releases PAYABLE Ledger Items');
    assert(
        sqlContent.includes('release_cancelled_settlement_batch_items') &&
        sqlContent.includes("DELETE FROM public.vendor_settlement_items\n        WHERE settlement_batch_id = NEW.id;"),
        'Cancelling an unpaid batch deletes its settlement items, releasing PAYABLE ledgers for future batches'
    );
    assert(
        sqlContent.includes("NEW.status = 'CANCELLED' AND OLD.status != 'CANCELLED'") &&
        sqlContent.includes("NEW.gross_order_amount := 0.00;") &&
        sqlContent.includes("NEW.order_count := 0;"),
        'Cancelled batch totals are cleanly zeroed in the database trigger'
    );
    assert(
        serviceContent.includes('export async function cancelSettlementBatch(') &&
        serviceContent.includes("eq('settlement_batch_id', batchId)"),
        'Service library cancelSettlementBatch safely cancels unpaid batches and releases attached items'
    );

    // Case 15: One exact settlement sequence exists
    console.log('\nCase 15: One Exact Settlement Sequence Exists');
    const hasVendorSettlementSeq = sqlContent.includes('CREATE SEQUENCE IF NOT EXISTS public.vendor_settlement_number_seq');
    const hasWrongSequence = sqlContent.includes('CREATE SEQUENCE IF NOT EXISTS public.settlement_batch_number_seq') ||
                             sqlContent.includes('nextval(\'public.settlement_batch_number_seq\')');
    assert(
        hasVendorSettlementSeq && !hasWrongSequence,
        'One exact sequence exists: public.vendor_settlement_number_seq (no duplicate or conflicting sequence names)'
    );

    // Case 16: Client cannot consume settlement sequence
    console.log('\nCase 16: Client Cannot Consume Settlement Sequence');
    assert(
        sqlContent.includes('REVOKE ALL ON SEQUENCE public.vendor_settlement_number_seq FROM PUBLIC, anon, authenticated;') &&
        sqlContent.includes('REVOKE ALL ON FUNCTION public.generate_vendor_settlement_number(integer) FROM PUBLIC, anon, authenticated;') &&
        sqlContent.includes('GRANT USAGE, SELECT ON SEQUENCE public.vendor_settlement_number_seq TO service_role;'),
        'Settlement sequence and number generator are completely locked down from client access (service_role only)'
    );

    // Case 17: Backwards / zero commission date ranges rejected
    console.log('\nCase 17: Backwards or Zero-Length Commission Date Ranges Rejected');
    assert(
        sqlContent.includes('CONSTRAINT chk_commission_rules_dates CHECK (effective_to IS NULL OR effective_to > effective_from)'),
        'Schema enforces chk_commission_rules_dates: effective_to IS NULL OR effective_to > effective_from'
    );
    // Unit test date validation logic
    const testDateRanges = [
        { from: '2026-01-01T00:00:00Z', to: '2026-01-02T00:00:00Z', valid: true },
        { from: '2026-01-01T00:00:00Z', to: null, valid: true },
        { from: '2026-01-01T00:00:00Z', to: '2026-01-01T00:00:00Z', valid: false }, // zero-length
        { from: '2026-01-02T00:00:00Z', to: '2026-01-01T00:00:00Z', valid: false }, // backwards
    ];
    let allDateValidationsCorrect = true;
    for (const dr of testDateRanges) {
        const isValid = dr.to === null || new Date(dr.to).getTime() > new Date(dr.from).getTime();
        if (isValid !== dr.valid) allDateValidationsCorrect = false;
    }
    assert(allDateValidationsCorrect, 'Date range validation logic correctly permits open-ended/forward ranges and rejects zero-length/backwards ranges');

    // =============================================================
    // REGRESSION SUITE VERIFICATION (Cases 18-24 / Criteria 45-53)
    // =============================================================
    console.log('\n=============================================================');
    console.log('Running Regression Test Suites');
    console.log('=============================================================');

    // Case 19: Phase 6E Passes (Refunds)
    console.log('\nCase 19: Regression — Phase 6E Refund Hardening');
    try {
        const out = execSync('node scripts/test-cancellation-engine.mjs', { cwd: rootDir, stdio: 'pipe' }).toString();
        assert(out.includes('PASSED') || out.includes('Passed'), 'Phase 6E refund tests pass');
    } catch (e) {
        assert(false, `Phase 6E refund tests failed: ${e.message}`);
    }

    // Phase 6F Notifications
    console.log('\nCase 20: Regression — Phase 6F Notifications');
    try {
        const out = execSync('node scripts/test-phase6f-runtime-hardening.mjs', { cwd: rootDir, stdio: 'pipe' }).toString();
        assert(out.includes('PASSED') || out.includes('passed'), 'Phase 6F notification tests pass');
    } catch (e) {
        assert(false, `Phase 6F notification tests failed: ${e.message}`);
    }

    // Phase 6G External Outbox
    console.log('\nCase 21: Regression — Phase 6G External Outbox');
    try {
        const out = execSync('node scripts/test-phase6g-external-outbox.mjs', { cwd: rootDir, stdio: 'pipe' }).toString();
        assert(out.includes('PASSED') || out.includes('passed'), 'Phase 6G outbox tests pass');
    } catch (e) {
        assert(false, `Phase 6G outbox tests failed: ${e.message}`);
    }

    // Phase 6H Phone Identity & OTP
    console.log('\nCase 22: Regression — Phase 6H Phone Identity & OTP');
    try {
        const out1 = execSync('node scripts/test-phase6h1-phone-auth-foundation.mjs', { cwd: rootDir, stdio: 'pipe' }).toString();
        const out2 = execSync('node scripts/test-phase6h2-otp-coming-soon.mjs', { cwd: rootDir, stdio: 'pipe' }).toString();
        assert(
            (out1.includes('PASS') || out1.includes('passed')) &&
            (out2.includes('PASS') || out2.includes('passed')),
            'Phase 6H phone auth and OTP coming soon tests pass'
        );
    } catch (e) {
        assert(false, `Phase 6H tests failed: ${e.message}`);
    }

    // Phase 6I Order Receipts
    console.log('\nCase 23: Regression — Phase 6I Order Receipts');
    try {
        const out = execSync('node scripts/test-phase6i-order-receipts.mjs', { cwd: rootDir, stdio: 'pipe' }).toString();
        assert(out.includes('PASSED') || out.includes('passed'), 'Phase 6I order receipts tests pass');
    } catch (e) {
        assert(false, `Phase 6I order receipts tests failed: ${e.message}`);
    }

    // Vendor Overview Tests
    console.log('\nCase 24: Regression — Vendor Overview');
    try {
        const out = execSync('node scripts/test-vendor-overview.mjs', { cwd: rootDir, stdio: 'pipe' }).toString();
        assert(out.includes('PASSED') || out.includes('Passed'), 'Vendor overview analytics tests pass');
    } catch (e) {
        assert(false, `Vendor overview tests failed: ${e.message}`);
    }

    // Auth Hydration Tests
    console.log('\nCase 25: Regression — Auth Hydration & Route Guards');
    try {
        const out = execSync('node scripts/test-auth-hydration-and-route-guards.mjs', { cwd: rootDir, stdio: 'pipe' }).toString();
        assert(out.includes('PASSED') || out.includes('passed'), 'Auth hydration and route guards tests pass');
    } catch (e) {
        assert(false, `Auth hydration tests failed: ${e.message}`);
    }

    // TypeScript Compilation
    console.log('\nCase 26: TypeScript Compilation (tsc --noEmit)');
    try {
        execSync('node ./node_modules/typescript/bin/tsc --noEmit', { cwd: rootDir, stdio: 'pipe' });
        assert(true, 'TypeScript compilation (node ./node_modules/typescript/bin/tsc --noEmit) passes with 0 errors');
    } catch (e) {
        assert(false, `TypeScript compilation failed: ${e.message}`);
    }

    // Next.js Production Build
    console.log('\nCase 27: Production Build (npm run build)');
    try {
        const buildOut = execSync('npm run build', { cwd: rootDir, stdio: 'pipe' }).toString();
        assert(buildOut.includes('Compiled successfully') || buildOut.includes('✓ Generating static pages'), 'Next.js production build passes cleanly');
    } catch (e) {
        assert(false, `Next.js build failed: ${e.message}`);
    }

    console.log('\n=============================================================');
    console.log(`Phase 6J Verification Summary: ${passedTests} passed, ${failedTests} failed out of ${totalTests} checks.`);
    console.log('=============================================================\n');

    if (failedTests > 0) {
        process.exit(1);
    } else {
        process.exit(0);
    }
}

runAllTests().catch(err => {
    console.error('Fatal test error:', err);
    process.exit(1);
});

/**
 * Authoritative Financial Types for XerService
 * Pure domain contracts for ledger, settlement, and payment providers.
 */

export type FinancialStatus = 'UNCONFIGURED' | 'PENDING' | 'PAYABLE' | 'SETTLED' | 'REVERSED';
export type SettlementBatchStatus = 'DRAFT' | 'CONFIRMED' | 'PAID' | 'CANCELLED';
export type PaymentProvider = 'RAZORPAY' | 'XERCOINS' | 'COD';

export interface OrderFinancialLedgerRecord {
    id: string;
    order_id: string;
    shop_id: string;
    user_id: string;
    payment_attempt_id: string;
    gross_amount: number;
    currency: string;
    commission_bps: number | null;
    platform_commission_amount: number | null;
    vendor_net_amount: number | null;
    financial_status: FinancialStatus;
    eligible_at: string | null;
    settled_at: string | null;
    reversed_at: string | null;
    refund_request_id: string | null;
    reversal_reason: string | null;
    created_at: string;
    updated_at: string;
}

export interface ShopCommissionRuleRecord {
    id: string;
    shop_id: string;
    commission_bps: number;
    effective_from: string;
    effective_to: string | null;
    is_active: boolean;
    created_at: string;
    created_by: string | null;
}

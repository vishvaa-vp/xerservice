/**
 * Authoritative Customer Order Types for XerService
 * Pure domain models decoupled from database clients or runtime side-effects.
 */

export type CustomerOrderStatus =
    | 'DRAFT'
    | 'AWAITING_PAYMENT'
    | 'QUEUED'
    | 'PRINTING'
    | 'READY'
    | 'COMPLETED'
    | 'CANCELLED';

export type CustomerPaymentStatus =
    | 'UNPAID'
    | 'PAID'
    | 'FAILED'
    | 'REFUNDED';

export interface CustomerOrderPrintSettings {
    colour_mode: 'BW' | 'COLOUR' | string;
    sides: 'SINGLE' | 'DOUBLE_LONG_EDGE' | 'DOUBLE_SHORT_EDGE' | string;
    orientation: 'PORTRAIT' | 'LANDSCAPE' | string;
    copies: number;
    pages_per_sheet: number;
    paper_size: string;
    margin: string;
    page_selection: string;
    page_range: string | null;
    scale: string;
    include_filename_page_numbers: boolean;
}

export interface CustomerOrderFile {
    id: string;
    order_id?: string;
    original_filename: string;
    mime_type: string;
    file_size_bytes: number;
    original_pages: number;
    printable_pages: number;
    physical_sheets: number;
    unit_price: number;
    line_total: number;
    created_at?: string;
    print_settings?: CustomerOrderPrintSettings;
}

export interface CustomerOrderStatusHistory {
    id: string;
    order_id?: string;
    from_status: CustomerOrderStatus | string | null;
    to_status: CustomerOrderStatus | string;
    changed_by?: string | null;
    created_at: string;
}

export interface CustomerOrderShop {
    id: string;
    name: string;
    status: string;
    closing_soon?: boolean;
}

export interface CustomerOrder {
    id: string;
    order_number: string;
    user_id: string;
    shop_id: string;
    status: CustomerOrderStatus | string;
    payment_status: CustomerPaymentStatus | string;
    total_original_pages: number;
    total_printable_pages: number;
    total_sheets: number;
    total_amount: number;
    expires_at: string;
    created_at: string;
    updated_at: string;
    paid_at: string | null;
    printing_started_at: string | null;
    ready_at: string | null;
    completed_at: string | null;
    cancelled_at: string | null;
    cancelled_by?: string | null;
    cancellation_reason?: string | null;
    shop?: CustomerOrderShop | null;
    order_files: CustomerOrderFile[];
    order_status_history: CustomerOrderStatusHistory[];
    refund_requests?: RefundRequest[];
}

export type RefundStatus = 'PENDING' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED';

export interface RefundRequest {
    id: string;
    order_id: string;
    user_id: string;
    payment_attempt_id?: string | null;
    provider: 'RAZORPAY' | 'XERCOINS' | string;
    amount: number;
    status: RefundStatus;
    reason?: string | null;
    requested_by?: string | null;
    requested_by_role?: 'CUSTOMER' | 'VENDOR' | 'ADMIN' | 'SYSTEM' | string | null;
    provider_refund_id?: string | null;
    failure_reason?: string | null;
    idempotency_key: string;
    created_at: string;
    updated_at: string;
    completed_at?: string | null;
}

/**
 * Backward-compatible AppOrder type for UI consumers
 * Note: paymentMethod is strictly optional and NOT fabricated on real orders.
 */
export interface AppOrder {
    id: string;
    orderNumber?: string;
    shopId: string;
    shopName: string;
    fileName: string;
    files?: { name: string; pages: number; color: boolean }[];
    pages: number;
    color: boolean;
    sides: 'single' | 'double' | 'double_long' | 'double_short';
    orientation: 'portrait' | 'landscape';
    copies: number;
    method: 'instant' | 'scheduled';
    scheduledTime?: string;
    paymentMethod?: 'upi' | 'card' | 'wallet';
    paymentStatus?: string;
    totalAmount: number;
    status: string;
    createdAt: string;
    customerMobile: string;
    rawOrder?: CustomerOrder;
}

// Alias Order to AppOrder for legacy compatibility across the codebase
export type Order = AppOrder;

import crypto from 'crypto';

/**
 * Server-only Razorpay configuration & utilities.
 * NEVER import this file in client-side code!
 */

export function getRazorpayCredentials() {
    if (typeof window !== 'undefined') {
        throw new Error('[Security] Razorpay credentials cannot be accessed from the browser.');
    }

    const keyId = process.env.RAZORPAY_KEY_ID || process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;

    if (!keyId || !keySecret) {
        throw new Error(
            '[Configuration] RAZORPAY_KEY_ID (or NEXT_PUBLIC_RAZORPAY_KEY_ID) or RAZORPAY_KEY_SECRET is missing from server environment.'
        );
    }

    return { keyId, keySecret };
}

export function getRazorpayWebhookSecret(): string {
    if (typeof window !== 'undefined') {
        throw new Error('[Security] Razorpay webhook secret cannot be accessed from the browser.');
    }

    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!webhookSecret) {
        throw new Error(
            '[Configuration] RAZORPAY_WEBHOOK_SECRET is missing from server environment. ' +
            'Please add it to your .env.local file.'
        );
    }

    return webhookSecret;
}

export interface CreateOrderParams {
    amountPaise: number;
    currency?: string;
    receipt: string;
    notes?: Record<string, string>;
}

export interface RazorpayOrderResponse {
    id: string;
    entity: string;
    amount: number;
    amount_paid: number;
    amount_due: number;
    currency: string;
    receipt: string;
    status: string;
    attempts: number;
    notes: Record<string, string>;
    created_at: number;
}

/**
 * Creates a Razorpay Order via the official REST API.
 */
export async function createRazorpayOrder(params: CreateOrderParams): Promise<RazorpayOrderResponse> {
    const { keyId, keySecret } = getRazorpayCredentials();

    const authHeader = `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`;

    const response = await fetch('https://api.razorpay.com/v1/orders', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': authHeader,
        },
        body: JSON.stringify({
            amount: params.amountPaise,
            currency: params.currency || 'INR',
            receipt: params.receipt,
            notes: params.notes || {},
        }),
    });

    const json = await response.json();

    if (!response.ok) {
        const errorDescription = json.error?.description || json.error?.message || 'Failed to create Razorpay Order';
        throw new Error(`Razorpay Order creation failed: ${errorDescription}`);
    }

    return json as RazorpayOrderResponse;
}

/**
 * Verifies standard checkout signature using HMAC SHA256.
 * Expected message format: `${razorpay_order_id}|${razorpay_payment_id}`
 */
export function verifyPaymentSignature(params: {
    orderId: string;
    paymentId: string;
    signature: string;
}): boolean {
    const { keySecret } = getRazorpayCredentials();
    const payload = `${params.orderId}|${params.paymentId}`;

    const expectedSignature = crypto
        .createHmac('sha256', keySecret)
        .update(payload)
        .digest('hex');

    try {
        const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
        const receivedBuffer = Buffer.from(params.signature, 'utf8');

        if (expectedBuffer.length !== receivedBuffer.length) {
            return false;
        }

        return crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
    } catch {
        return false;
    }
}

/**
 * Verifies incoming Razorpay webhook signature against raw request body using HMAC SHA256.
 */
export function verifyWebhookSignature(rawBody: string, signature: string): boolean {
    const webhookSecret = getRazorpayWebhookSecret();

    const expectedSignature = crypto
        .createHmac('sha256', webhookSecret)
        .update(rawBody)
        .digest('hex');

    try {
        const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
        const receivedBuffer = Buffer.from(signature, 'utf8');

        if (expectedBuffer.length !== receivedBuffer.length) {
            return false;
        }

        return crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
    } catch {
        return false;
    }
}

export type PaymentMethodType = 'UPI' | 'CARD' | 'NETBANKING' | 'WALLET' | 'OTHER';

/**
 * Safely maps raw Razorpay payment method strings to authoritative enum values.
 * upi        -> UPI
 * card       -> CARD
 * netbanking -> NETBANKING
 * wallet     -> WALLET
 * Anything else -> OTHER
 * null/undefined -> null
 */
export function mapRazorpayPaymentMethod(rawMethod?: string | null): PaymentMethodType | null {
    if (!rawMethod || typeof rawMethod !== 'string') return null;
    const normalized = rawMethod.trim().toLowerCase();
    if (!normalized) return null;

    switch (normalized) {
        case 'upi':
            return 'UPI';
        case 'card':
            return 'CARD';
        case 'netbanking':
            return 'NETBANKING';
        case 'wallet':
            return 'WALLET';
        default:
            return 'OTHER';
    }
}

/**
 * Fetches verified payment details directly from the authoritative Razorpay server API.
 */
export async function fetchRazorpayPayment(paymentId: string): Promise<{ id: string; method?: string; amount?: number; status?: string } | null> {
    try {
        const { keyId, keySecret } = getRazorpayCredentials();
        const authHeader = `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`;
        const response = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}`, {
            method: 'GET',
            headers: {
                Authorization: authHeader,
            },
        });
        if (!response.ok) return null;
        return await response.json();
    } catch (err) {
        console.error('[Razorpay] Failed to fetch payment entity server-side:', err);
        return null;
    }
}

export interface RazorpayRefundResponse {
    id: string;
    entity: string;
    amount: number;
    currency: string;
    payment_id: string;
    notes?: Record<string, string>;
    receipt?: string;
    status: string;
    speed_processed?: string;
    speed_requested?: string;
    created_at: number;
}

/**
 * Initiates an authoritative refund on a captured Razorpay payment.
 */
export async function createRazorpayRefund(
    paymentId: string,
    params?: {
        amountPaise?: number;
        notes?: Record<string, string>;
        receipt?: string;
    }
): Promise<RazorpayRefundResponse> {
    const { keyId, keySecret } = getRazorpayCredentials();
    const authHeader = `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`;

    const body: Record<string, any> = {};
    if (params?.amountPaise && params.amountPaise > 0) {
        body.amount = params.amountPaise;
    }
    if (params?.notes) {
        body.notes = params.notes;
    }
    if (params?.receipt) {
        body.receipt = params.receipt;
    }

    const response = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}/refund`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': authHeader,
        },
        body: JSON.stringify(body),
    });

    const json = await response.json();

    if (!response.ok) {
        const errorDesc = json.error?.description || json.error?.message || 'Failed to process Razorpay refund';
        throw new Error(`Razorpay refund failed: ${errorDesc}`);
    }

    return json as RazorpayRefundResponse;
}

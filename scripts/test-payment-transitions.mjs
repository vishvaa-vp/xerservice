import assert from 'node:assert';
import crypto from 'crypto';

console.log('Testing Payment State Transitions & Webhook Idempotency...\n');

// Mock state machine representing the hardened transition rules in the webhook & verify routes
class PaymentStateManager {
    constructor() {
        this.attempt = {
            id: 'attempt-1',
            status: 'CREATED',
            amount: 2.00,
            currency: 'INR',
            razorpay_order_id: 'order_test_123',
            razorpay_payment_id: null,
            paid_at: null,
        };
        this.order = {
            id: 'order-1',
            status: 'AWAITING_PAYMENT',
            payment_status: 'UNPAID',
            paid_at: null,
        };
        this.processedWebhookEvents = new Set();
    }

    // Emulates /api/payments/razorpay/verify
    clientVerify(paymentId) {
        // Rule: NEVER regress PAID to AUTHORIZED
        if (this.attempt.status !== 'PAID') {
            this.attempt.status = 'AUTHORIZED';
            this.attempt.razorpay_payment_id = paymentId;
        } else if (!this.attempt.razorpay_payment_id) {
            this.attempt.razorpay_payment_id = paymentId;
        }
        return { verified: true, paymentStatus: this.attempt.status };
    }

    // Emulates /api/webhooks/razorpay
    processWebhook(eventId, eventType, payload) {
        // Idempotency check
        if (this.processedWebhookEvents.has(eventId)) {
            return { status: 'ok', message: 'Event already processed' };
        }
        this.processedWebhookEvents.add(eventId);

        const rzpOrderId = payload.payment?.order_id || payload.order?.id;
        const rzpPaymentId = payload.payment?.id;
        const amountPaise = payload.payment?.amount || payload.order?.amount;
        const currency = payload.payment?.currency || payload.order?.currency;

        if (eventType === 'payment.captured' || eventType === 'order.paid') {
            if (currency !== 'INR') {
                throw new Error(`Currency ${currency} not supported`);
            }
            const expectedPaise = Math.round(this.attempt.amount * 100);
            if (amountPaise !== expectedPaise) {
                throw new Error('Amount mismatch');
            }

            // Transition attempt -> PAID
            this.attempt.status = 'PAID';
            this.attempt.razorpay_payment_id = rzpPaymentId || this.attempt.razorpay_payment_id;
            this.attempt.paid_at = this.attempt.paid_at || new Date().toISOString();

            // Transition order -> QUEUED & payment_status -> PAID
            if (this.order.status === 'AWAITING_PAYMENT') {
                this.order.status = 'QUEUED';
            }
            this.order.payment_status = 'PAID';
            this.order.paid_at = this.order.paid_at || this.attempt.paid_at;
            return { status: 'ok' };
        }

        if (eventType === 'payment.authorized') {
            // Protect against regressing PAID
            if (this.attempt.status === 'PAID') {
                return { status: 'ok', note: 'Preserved PAID' };
            }
            if (this.attempt.status === 'CREATED') {
                this.attempt.status = 'AUTHORIZED';
                this.attempt.razorpay_payment_id = rzpPaymentId || this.attempt.razorpay_payment_id;
            }
            return { status: 'ok' };
        }

        if (eventType === 'payment.failed') {
            // Protect against regressing PAID
            if (this.attempt.status === 'PAID') {
                return { status: 'ok', note: 'Ignored stale failure' };
            }
            this.attempt.status = 'FAILED';
            return { status: 'ok' };
        }

        return { status: 'ok' };
    }
}

// TEST 1: CREATED -> AUTHORIZED via client verify
const sm1 = new PaymentStateManager();
assert.strictEqual(sm1.attempt.status, 'CREATED');
sm1.clientVerify('pay_123');
assert.strictEqual(sm1.attempt.status, 'AUTHORIZED');
assert.strictEqual(sm1.attempt.razorpay_payment_id, 'pay_123');
console.log('✓ Test 1 Passed: CREATED -> AUTHORIZED on client checkout verify');

// TEST 2: AUTHORIZED -> PAID on payment.captured
sm1.processWebhook('evt_captured_1', 'payment.captured', {
    payment: { id: 'pay_123', order_id: 'order_test_123', amount: 200, currency: 'INR' },
});
assert.strictEqual(sm1.attempt.status, 'PAID');
assert.strictEqual(sm1.order.payment_status, 'PAID');
assert.strictEqual(sm1.order.status, 'QUEUED');
assert.ok(sm1.attempt.paid_at);
console.log('✓ Test 2 Passed: AUTHORIZED -> PAID on payment.captured webhook');

// TEST 3: PAID + duplicate payment.captured -> remains PAID (Idempotency)
sm1.processWebhook('evt_captured_1', 'payment.captured', {
    payment: { id: 'pay_123', order_id: 'order_test_123', amount: 200, currency: 'INR' },
});
assert.strictEqual(sm1.attempt.status, 'PAID');
assert.strictEqual(sm1.order.status, 'QUEUED');
console.log('✓ Test 3 Passed: PAID + duplicate payment.captured remains PAID');

// TEST 4: PAID + later payment.authorized (e.g. from client verify or out-of-order webhook) -> remains PAID
sm1.clientVerify('pay_123');
assert.strictEqual(sm1.attempt.status, 'PAID', 'Client verify must NOT regress PAID to AUTHORIZED');
sm1.processWebhook('evt_auth_1', 'payment.authorized', {
    payment: { id: 'pay_123', order_id: 'order_test_123', amount: 200, currency: 'INR' },
});
assert.strictEqual(sm1.attempt.status, 'PAID', 'payment.authorized webhook must NOT regress PAID to AUTHORIZED');
console.log('✓ Test 4 Passed: PAID + later payment.authorized/verify remains PAID');

// TEST 5: PAID + later payment.failed -> remains PAID
sm1.processWebhook('evt_fail_1', 'payment.failed', {
    payment: { id: 'pay_123', order_id: 'order_test_123' },
});
assert.strictEqual(sm1.attempt.status, 'PAID');
assert.strictEqual(sm1.order.status, 'QUEUED');
console.log('✓ Test 5 Passed: PAID + later payment.failed remains PAID');

// TEST 6: order.paid after payment.captured -> idempotent convergence
const sm2 = new PaymentStateManager();
sm2.processWebhook('evt_captured_2', 'payment.captured', {
    payment: { id: 'pay_456', order_id: 'order_test_123', amount: 200, currency: 'INR' },
});
assert.strictEqual(sm2.attempt.status, 'PAID');
assert.strictEqual(sm2.order.status, 'QUEUED');
sm2.processWebhook('evt_orderpaid_2', 'order.paid', {
    order: { id: 'order_test_123', amount: 200, currency: 'INR' },
    payment: { id: 'pay_456', amount: 200, currency: 'INR' },
});
assert.strictEqual(sm2.attempt.status, 'PAID');
assert.strictEqual(sm2.order.status, 'QUEUED');
console.log('✓ Test 6 Passed: order.paid after payment.captured is idempotent');

// TEST 7: payment.captured after order.paid -> idempotent convergence
const sm3 = new PaymentStateManager();
sm3.processWebhook('evt_orderpaid_3', 'order.paid', {
    order: { id: 'order_test_123', amount: 200, currency: 'INR' },
    payment: { id: 'pay_789', amount: 200, currency: 'INR' },
});
assert.strictEqual(sm3.attempt.status, 'PAID');
assert.strictEqual(sm3.order.status, 'QUEUED');
sm3.processWebhook('evt_captured_3', 'payment.captured', {
    payment: { id: 'pay_789', order_id: 'order_test_123', amount: 200, currency: 'INR' },
});
assert.strictEqual(sm3.attempt.status, 'PAID');
assert.strictEqual(sm3.order.status, 'QUEUED');
console.log('✓ Test 7 Passed: payment.captured after order.paid is idempotent');

// TEST 8: Wrong amount rejected
const sm4 = new PaymentStateManager();
assert.throws(() => {
    sm4.processWebhook('evt_wrong_amount', 'payment.captured', {
        payment: { id: 'pay_999', order_id: 'order_test_123', amount: 500, currency: 'INR' },
    });
}, /Amount mismatch/);
console.log('✓ Test 8 Passed: Wrong amount strictly rejected');

// TEST 9: Wrong currency rejected
const sm5 = new PaymentStateManager();
assert.throws(() => {
    sm5.processWebhook('evt_wrong_currency', 'payment.captured', {
        payment: { id: 'pay_999', order_id: 'order_test_123', amount: 200, currency: 'USD' },
    });
}, /Currency USD not supported/);
console.log('✓ Test 9 Passed: Wrong currency strictly rejected');

// TEST 10: Invalid webhook signature rejected
function verifyWebhookSig(raw, sig, secret) {
    const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex');
    const b1 = Buffer.from(expected, 'utf8');
    const b2 = Buffer.from(sig, 'utf8');
    return b1.length === b2.length && crypto.timingSafeEqual(b1, b2);
}
const secret = 'sec_123';
const raw = '{"event":"payment.captured"}';
const goodSig = crypto.createHmac('sha256', secret).update(raw).digest('hex');
assert.strictEqual(verifyWebhookSig(raw, goodSig, secret), true);
assert.strictEqual(verifyWebhookSig(raw, 'bad_signature', secret), false);
assert.strictEqual(verifyWebhookSig(raw + 'tampered', goodSig, secret), false);
console.log('✓ Test 10 Passed: Invalid webhook signature strictly rejected');

console.log('\nAll 10 payment transition and idempotency tests passed successfully!');

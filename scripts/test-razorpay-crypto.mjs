import crypto from 'crypto';
import assert from 'node:assert';

console.log('Testing Razorpay Cryptographic Signatures & Verification...');

const TEST_KEY_SECRET = 'test_secret_key_12345';
const TEST_WEBHOOK_SECRET = 'test_webhook_secret_67890';

// 1. Checkout Signature Verification
function verifyPaymentSignature(params) {
    const payload = `${params.orderId}|${params.paymentId}`;
    const expectedSignature = crypto
        .createHmac('sha256', params.keySecret)
        .update(payload)
        .digest('hex');

    const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
    const receivedBuffer = Buffer.from(params.signature, 'utf8');
    if (expectedBuffer.length !== receivedBuffer.length) return false;
    return crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
}

const orderId = 'order_DA1234567890';
const paymentId = 'pay_XY9876543210';
const validSignature = crypto
    .createHmac('sha256', TEST_KEY_SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');

const isSigValid = verifyPaymentSignature({
    orderId,
    paymentId,
    signature: validSignature,
    keySecret: TEST_KEY_SECRET,
});
assert.strictEqual(isSigValid, true, 'Valid checkout signature must pass');
console.log('✓ Valid checkout signature passed');

// 2. Tampered Payment ID Signature Verification
const isTamperedPaymentValid = verifyPaymentSignature({
    orderId,
    paymentId: 'pay_tampered_id',
    signature: validSignature,
    keySecret: TEST_KEY_SECRET,
});
assert.strictEqual(isTamperedPaymentValid, false, 'Tampered payment ID must be rejected');
console.log('✓ Tampered payment ID rejection passed');

// 3. Tampered Order ID Signature Verification
const isTamperedOrderValid = verifyPaymentSignature({
    orderId: 'order_tampered_order',
    paymentId,
    signature: validSignature,
    keySecret: TEST_KEY_SECRET,
});
assert.strictEqual(isTamperedOrderValid, false, 'Tampered order ID must be rejected');
console.log('✓ Tampered order ID rejection passed');

// 4. Webhook Signature Verification
function verifyWebhookSignature(rawBody, signature, secret) {
    const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(rawBody)
        .digest('hex');

    const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
    const receivedBuffer = Buffer.from(signature, 'utf8');
    if (expectedBuffer.length !== receivedBuffer.length) return false;
    return crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
}

const rawWebhookBody = JSON.stringify({
    event: 'payment.captured',
    payload: {
        payment: {
            entity: {
                id: paymentId,
                order_id: orderId,
                amount: 600,
                currency: 'INR',
                status: 'captured',
            },
        },
    },
});

const validWebhookSig = crypto
    .createHmac('sha256', TEST_WEBHOOK_SECRET)
    .update(rawWebhookBody)
    .digest('hex');

const isWebhookValid = verifyWebhookSignature(rawWebhookBody, validWebhookSig, TEST_WEBHOOK_SECRET);
assert.strictEqual(isWebhookValid, true, 'Valid webhook signature must pass');
console.log('✓ Valid webhook signature passed');

// 5. Tampered Webhook Body
const tamperedWebhookBody = rawWebhookBody.replace('600', '100');
const isTamperedWebhookValid = verifyWebhookSignature(tamperedWebhookBody, validWebhookSig, TEST_WEBHOOK_SECRET);
assert.strictEqual(isTamperedWebhookValid, false, 'Tampered webhook payload must be rejected');
console.log('✓ Tampered webhook payload rejection passed');

console.log('\nAll Razorpay cryptographic signature tests passed successfully!');

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { verifyWhatsAppWebhookSignature } from '../packages/backend/src/whatsapp/webhook-security.ts';

const payload = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });
const testSecret = 'offline-test-secret-with-sufficient-entropy';
const signature = `sha256=${crypto.createHmac('sha256', testSecret).update(payload).digest('hex')}`;

assert.equal(verifyWhatsAppWebhookSignature(payload, signature, testSecret), true);
assert.equal(verifyWhatsAppWebhookSignature(`${payload} `, signature, testSecret), false);
assert.equal(verifyWhatsAppWebhookSignature(payload, 'sha1=invalid', testSecret), false);
assert.equal(verifyWhatsAppWebhookSignature(payload, null, testSecret), false);

const previousSecrets = {
    meta: process.env.META_APP_SECRET,
    app: process.env.WHATSAPP_APP_SECRET,
    webhook: process.env.WHATSAPP_WEBHOOK_SECRET,
};
delete process.env.META_APP_SECRET;
delete process.env.WHATSAPP_APP_SECRET;
delete process.env.WHATSAPP_WEBHOOK_SECRET;
assert.equal(verifyWhatsAppWebhookSignature(payload, signature), false, 'webhook verification must fail closed');

const serviceSource = readFileSync(new URL('../packages/backend/src/whatsapp/whatsapp-service.ts', import.meta.url), 'utf8');
const mediaSource = readFileSync(new URL('../packages/backend/src/whatsapp/media-service.ts', import.meta.url), 'utf8');
assert.equal(serviceSource.includes('xerservice-whatsapp-webhook-secret'), false);
assert.equal(serviceSource.includes("'919092925065'"), false);
assert.equal(mediaSource.includes("WHATSAPP_MEDIA_DOWNLOAD_ENABLED === 'true'"), true);
assert.equal(mediaSource.includes('isAllowedMetaMediaUrl'), true);

if (previousSecrets.meta === undefined) delete process.env.META_APP_SECRET;
else process.env.META_APP_SECRET = previousSecrets.meta;
if (previousSecrets.app === undefined) delete process.env.WHATSAPP_APP_SECRET;
else process.env.WHATSAPP_APP_SECRET = previousSecrets.app;
if (previousSecrets.webhook === undefined) delete process.env.WHATSAPP_WEBHOOK_SECRET;
else process.env.WHATSAPP_WEBHOOK_SECRET = previousSecrets.webhook;
console.log('WhatsApp security unit tests passed.');

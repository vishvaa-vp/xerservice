import crypto from 'node:crypto';

export function hashChallengeToken(token: string): string {
    return crypto.createHash('sha256').update(token.trim()).digest('hex');
}

/** Verifies Meta's HMAC-SHA256 signature without accepting fallback secrets. */
export function verifyWhatsAppWebhookSignature(
    rawBody: string,
    signatureHeader: string | null,
    secretOverride?: string
): boolean {
    const secret = secretOverride ||
        process.env.META_APP_SECRET ||
        process.env.WHATSAPP_APP_SECRET ||
        process.env.WHATSAPP_WEBHOOK_SECRET;

    if (!secret) {
        console.warn('[WhatsAppWebhook] Signature verification failed: app secret is missing.');
        return false;
    }

    if (!signatureHeader) {
        console.warn('[WhatsAppWebhook] Signature verification failed: x-hub-signature-256 header is missing.');
        return false;
    }

    const parts = signatureHeader.split('=');
    if (parts.length > 1 && parts[0] !== 'sha256') {
        console.warn('[WhatsAppWebhook] Signature verification failed: unexpected signature scheme.');
        return false;
    }

    const signatureHash = parts.length === 2 ? parts[1] : signatureHeader;
    if (!/^[a-f\d]{64}$/i.test(signatureHash)) {
        console.warn('[WhatsAppWebhook] Signature verification failed: signature format is invalid.');
        return false;
    }

    try {
        const expectedHash = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
        const signature = Buffer.from(signatureHash, 'hex');
        const expected = Buffer.from(expectedHash, 'hex');
        const matches = signature.length === expected.length && crypto.timingSafeEqual(signature, expected);

        if (!matches) {
            console.warn('[WhatsAppWebhook] Signature verification failed: signature does not match the configured app secret.');
        }

        return matches;
    } catch (error) {
        console.warn('[WhatsAppWebhook] Signature verification failed: verification error.', error);
        return false;
    }
}

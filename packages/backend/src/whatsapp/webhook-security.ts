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

    if (!secret || !signatureHeader) return false;

    const parts = signatureHeader.split('=');
    if (parts.length > 1 && parts[0] !== 'sha256') return false;
    const signatureHash = parts.length === 2 ? parts[1] : signatureHeader;
    if (!/^[a-f\d]{64}$/i.test(signatureHash)) return false;

    try {
        const expectedHash = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
        const signature = Buffer.from(signatureHash, 'hex');
        const expected = Buffer.from(expectedHash, 'hex');
        return signature.length === expected.length && crypto.timingSafeEqual(signature, expected);
    } catch {
        return false;
    }
}

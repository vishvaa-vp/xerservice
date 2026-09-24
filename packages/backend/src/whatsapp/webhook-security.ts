import crypto from 'node:crypto';

export function hashChallengeToken(token: string): string {
    return crypto.createHash('sha256').update(token.trim()).digest('hex');
}

/** Verifies Meta's HMAC-SHA256 signature against configured candidate app secrets. */
export function verifyWhatsAppWebhookSignature(
    rawBody: string,
    signatureHeader: string | null,
    secretOverride?: string
): boolean {
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

    const rawCandidates: (string | undefined)[] = secretOverride
        ? [secretOverride]
        : [
            process.env.META_APP_SECRET,
            process.env.WHATSAPP_APP_SECRET,
            process.env.WHATSAPP_WEBHOOK_SECRET,
            process.env.META_APP_SECRET_FALLBACK,
            process.env.OLD_META_APP_SECRET,
        ];

    const secrets = rawCandidates
        .filter((s): s is string => Boolean(s && s.trim()))
        .flatMap((s) => s.split(',').map((x) => x.trim()))
        .filter((s) => s.length > 0);

    if (secrets.length === 0) {
        console.warn('[WhatsAppWebhook] Signature verification failed: app secret is missing.');
        return false;
    }

    const signature = Buffer.from(signatureHash, 'hex');

    for (const secret of secrets) {
        try {
            const expectedHash = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
            const expected = Buffer.from(expectedHash, 'hex');
            if (signature.length === expected.length && crypto.timingSafeEqual(signature, expected)) {
                return true;
            }
        } catch (error) {
            console.warn('[WhatsAppWebhook] Candidate signature verification error.', error);
        }
    }

    console.warn('[WhatsAppWebhook] Signature verification failed: signature does not match configured app secret(s).');
    return false;
}

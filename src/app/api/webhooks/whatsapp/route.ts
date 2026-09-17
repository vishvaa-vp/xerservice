import { NextRequest, NextResponse } from 'next/server';
import { processIncomingWebhook, WhatsAppServiceError } from '@packages/backend/whatsapp';

export const runtime = 'nodejs';

/**
 * Meta Webhook Verification (GET)
 * Handles WhatsApp Cloud API subscription handshake.
 */
export async function GET(req: NextRequest) {
    const url = new URL(req.url);
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');

    const expectedToken = process.env.WHATSAPP_VERIFY_TOKEN;

    if (mode === 'subscribe' && expectedToken && token === expectedToken) {
        return new NextResponse(challenge || '', {
            status: 200,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
    }

    return NextResponse.json({ error: 'Webhook verification token mismatch.' }, { status: 403 });
}

/**
 * Meta Webhook Event Ingestion (POST)
 * Receives signed WhatsApp messages and processes linking challenges or media imports.
 */
export async function POST(req: NextRequest) {
    const headers = { 'Cache-Control': 'no-store' };

    try {
        const rawBody = await req.text();
        const signatureHeader = req.headers.get('x-hub-signature-256');

        const result = await processIncomingWebhook(rawBody, signatureHeader);

        return NextResponse.json({ status: 'ok', ...result }, { status: 200, headers });
    } catch (err: unknown) {
        if (err instanceof WhatsAppServiceError) {
            return NextResponse.json({ error: err.message }, { status: err.statusCode, headers });
        }
        console.error('[POST /api/webhooks/whatsapp] Error:', err);
        return NextResponse.json(
            { error: 'Internal webhook processing error.' },
            { status: 500, headers }
        );
    }
}

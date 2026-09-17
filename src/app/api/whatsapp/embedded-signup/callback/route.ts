import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAuth } from '@/lib/admin-auth';
import { validateMutationOrigin } from '@/lib/origin-check';

export const runtime = 'nodejs';

interface EmbeddedSignupCallbackPayload {
    code?: string;
    wabaId?: string | null;
    phoneNumberId?: string | null;
    eventType?: string | null;
}

function graphApiVersion(): string {
    const configured = process.env.WHATSAPP_GRAPH_API_VERSION?.trim();
    return configured && /^v\d+\.\d+$/.test(configured) ? configured : 'v26.0';
}

function validProviderId(value: unknown): value is string {
    return typeof value === 'string' && /^\d{5,32}$/.test(value);
}

/**
 * Exchanges a short-lived Embedded Signup authorization code on the server.
 * Access tokens and the Meta app secret are never returned to the browser,
 * written to application logs, or persisted in the product database.
 */
export async function POST(req: NextRequest) {
    const headers = { 'Cache-Control': 'no-store' };

    if (process.env.WHATSAPP_EMBEDDED_SIGNUP_ENABLED !== 'true') {
        return NextResponse.json({ error: 'Embedded Signup is disabled.' }, { status: 404, headers });
    }

    const origin = validateMutationOrigin(req);
    if (!origin.isValid) return origin.response!;

    const auth = await requireAdminAuth(req);
    if (!auth.authorized) {
        return NextResponse.json({ error: auth.error }, { status: auth.status, headers });
    }

    const metaAppId = process.env.META_APP_ID || process.env.NEXT_PUBLIC_META_APP_ID;
    const metaAppSecret = process.env.META_APP_SECRET;
    if (!metaAppId || !metaAppSecret) {
        return NextResponse.json(
            { error: 'Meta Embedded Signup is not configured on the server.' },
            { status: 503, headers }
        );
    }

    try {
        const body = (await req.json().catch(() => ({}))) as EmbeddedSignupCallbackPayload;
        const code = typeof body.code === 'string' ? body.code.trim() : '';
        if (!code || code.length > 4096) {
            return NextResponse.json({ error: 'A valid authorization code is required.' }, { status: 400, headers });
        }

        const params = new URLSearchParams({
            client_id: metaAppId,
            client_secret: metaAppSecret,
            code,
        });
        const redirectUri = process.env.META_EMBEDDED_SIGNUP_REDIRECT_URI?.trim();
        if (redirectUri) params.set('redirect_uri', redirectUri);

        const response = await fetch(
            `https://graph.facebook.com/${graphApiVersion()}/oauth/access_token`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: params,
                cache: 'no-store',
                redirect: 'error',
                signal: AbortSignal.timeout(10_000),
            }
        );

        const providerResult = await response.json().catch(() => ({})) as {
            access_token?: string;
            token_type?: string;
        };
        if (!response.ok || !providerResult.access_token) {
            console.error('[Embedded Signup] Meta code exchange failed.', { status: response.status });
            return NextResponse.json(
                { error: 'Meta could not complete the authorization code exchange.' },
                { status: 502, headers }
            );
        }

        // This endpoint deliberately does not return or persist the exchanged token.
        // Production API calls continue to use WHATSAPP_ACCESS_TOKEN from the
        // deployment secret store until encrypted per-business storage is added.
        return NextResponse.json({
            success: true,
            status: 'TOKEN_EXCHANGED',
            wabaId: validProviderId(body.wabaId) ? body.wabaId : null,
            phoneNumberId: validProviderId(body.phoneNumberId) ? body.phoneNumberId : null,
            eventType: typeof body.eventType === 'string' ? body.eventType.slice(0, 100) : null,
        }, { status: 200, headers });
    } catch (error) {
        const isTimeout = error instanceof Error && error.name === 'TimeoutError';
        console.error('[Embedded Signup] Server exchange failed.', {
            reason: isTimeout ? 'timeout' : 'unexpected_error',
        });
        return NextResponse.json(
            { error: isTimeout ? 'Meta did not respond in time.' : 'Embedded Signup could not be completed.' },
            { status: 502, headers }
        );
    }
}

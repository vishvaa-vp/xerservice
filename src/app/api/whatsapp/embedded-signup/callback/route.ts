import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAuth } from '@/lib/admin-auth';
import { validateMutationOrigin } from '@/lib/origin-check';
import { verifyAuthToken, getServiceRoleClient } from '@/lib/supabase/server';
import { maskPhoneNumber } from '@packages/backend/whatsapp';

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
 * written to application logs, or persisted in unencrypted form.
 */
export async function POST(req: NextRequest) {
    const headers = { 'Cache-Control': 'no-store' };

    const isEnabled =
        process.env.WHATSAPP_EMBEDDED_SIGNUP_ENABLED === 'true' ||
        Boolean(
            (process.env.META_APP_ID || process.env.NEXT_PUBLIC_META_APP_ID) &&
            process.env.META_APP_SECRET
        );

    if (!isEnabled || process.env.WHATSAPP_EMBEDDED_SIGNUP_ENABLED === 'false') {
        return NextResponse.json({ error: 'Embedded Signup is disabled.' }, { status: 404, headers });
    }

    const origin = validateMutationOrigin(req);
    if (!origin.isValid) return origin.response!;

    // Authenticate: Accept admin or any authenticated user with a valid Supabase session
    let authenticatedUserId: string | null = null;
    const adminCheck = await requireAdminAuth(req);
    if (adminCheck.authorized && adminCheck.user?.userId) {
        authenticatedUserId = adminCheck.user.userId;
    } else {
        const authHeader = req.headers.get('authorization');
        const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
        if (token) {
            const verified = await verifyAuthToken(token);
            if (verified?.userId) {
                authenticatedUserId = verified.userId;
            }
        }
    }

    if (!authenticatedUserId) {
        return NextResponse.json({ error: 'Authentication required. Please sign in.' }, { status: 401, headers });
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

        const providerResult = (await response.json().catch(() => ({}))) as {
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

        // Fetch display phone number from Meta Graph API if phoneNumberId is provided
        let displayPhone: string | null = null;
        if (body.phoneNumberId && validProviderId(body.phoneNumberId)) {
            try {
                const phoneRes = await fetch(
                    `https://graph.facebook.com/${graphApiVersion()}/${body.phoneNumberId}?fields=display_phone_number,verified_name`,
                    {
                        headers: { Authorization: `Bearer ${providerResult.access_token}` },
                        cache: 'no-store',
                        signal: AbortSignal.timeout(5_000),
                    }
                );
                if (phoneRes.ok) {
                    const phoneData = (await phoneRes.json().catch(() => ({}))) as {
                        display_phone_number?: string;
                    };
                    if (phoneData.display_phone_number) {
                        displayPhone = phoneData.display_phone_number;
                    }
                }
            } catch {
                // Non-fatal if metadata fetch fails
            }
        }

        // Safely record active connection in whatsapp_links
        if (authenticatedUserId) {
            try {
                const sb = getServiceRoleClient();
                const nowIso = new Date().toISOString();
                const cleanPhone = displayPhone?.replace(/\D/g, '') || body.phoneNumberId || 'meta-connected';
                const storedPhone = displayPhone || body.phoneNumberId || 'meta-connected';

                await sb
                    .from('whatsapp_links')
                    .update({ status: 'disconnected', revoked_at: nowIso, updated_at: nowIso })
                    .eq('user_id', authenticatedUserId)
                    .eq('status', 'active');

                await sb
                    .from('whatsapp_links')
                    .insert({
                        user_id: authenticatedUserId,
                        sender_id: cleanPhone,
                        phone_number: storedPhone,
                        status: 'active',
                        order_updates_opt_in: true,
                        consent_version: 'v1',
                        linked_at: nowIso,
                    });
            } catch (persistErr) {
                console.error('[Embedded Signup] Failed to record connection in database:', persistErr);
            }
        }

        return NextResponse.json({
            success: true,
            status: 'CONNECTED',
            wabaId: validProviderId(body.wabaId) ? body.wabaId : null,
            phoneNumberId: validProviderId(body.phoneNumberId) ? body.phoneNumberId : null,
            displayPhone: displayPhone ? maskPhoneNumber(displayPhone) : null,
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

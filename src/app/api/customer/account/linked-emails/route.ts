import { NextRequest, NextResponse } from 'next/server';
import { getServiceRoleClient, verifyCustomerToken } from '@/lib/supabase/server';

export const runtime = 'nodejs';

/**
 * GET /api/customer/account/linked-emails
 * List all linked email addresses for the authenticated customer.
 */
export async function GET(req: NextRequest) {
    const headers = { 'Cache-Control': 'no-store' };
    const authHeader = req.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return NextResponse.json({ error: 'Authentication required.' }, { status: 401, headers });
    }

    try {
        const token = authHeader.slice(7).trim();
        const verified = await verifyCustomerToken(token);
        if (!verified || !verified.userId) {
            return NextResponse.json({ error: 'Session invalid or expired.' }, { status: 401, headers });
        }

        const sb = getServiceRoleClient();
        const { data: authData, error: authErr } = await sb.auth.admin.getUserById(verified.userId);
        if (authErr || !authData.user) {
            return NextResponse.json({ error: 'Failed to retrieve account details.' }, { status: 404, headers });
        }

        const primaryEmail = authData.user.email || '';
        const linkedEmails: string[] = Array.isArray(authData.user.user_metadata?.linked_emails)
            ? authData.user.user_metadata.linked_emails
            : [];

        return NextResponse.json({
            primaryEmail,
            linkedEmails,
        }, { headers });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return NextResponse.json({ error: msg }, { status: 500, headers });
    }
}

/**
 * POST /api/customer/account/linked-emails
 * Add/merge a secondary Gmail or email address into this customer account.
 */
export async function POST(req: NextRequest) {
    const headers = { 'Cache-Control': 'no-store' };
    const authHeader = req.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return NextResponse.json({ error: 'Authentication required.' }, { status: 401, headers });
    }

    try {
        const token = authHeader.slice(7).trim();
        const verified = await verifyCustomerToken(token);
        if (!verified || !verified.userId) {
            return NextResponse.json({ error: 'Session invalid or expired.' }, { status: 401, headers });
        }

        const body = await req.json().catch(() => ({}));
        const rawEmail = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!rawEmail || !emailRegex.test(rawEmail)) {
            return NextResponse.json({ error: 'Please enter a valid email address.' }, { status: 400, headers });
        }

        const sb = getServiceRoleClient();
        const { data: authData, error: authErr } = await sb.auth.admin.getUserById(verified.userId);
        if (authErr || !authData.user) {
            return NextResponse.json({ error: 'Customer account not found.' }, { status: 404, headers });
        }

        const primaryEmail = (authData.user.email || '').toLowerCase();
        if (rawEmail === primaryEmail) {
            return NextResponse.json({ error: 'This is already your primary email address.' }, { status: 400, headers });
        }

        const currentLinked: string[] = Array.isArray(authData.user.user_metadata?.linked_emails)
            ? authData.user.user_metadata.linked_emails
            : [];

        if (currentLinked.map(e => e.toLowerCase()).includes(rawEmail)) {
            return NextResponse.json({ error: 'This email is already linked to your account.' }, { status: 400, headers });
        }

        const updatedLinked = [...currentLinked, rawEmail];
        const newMetadata = {
            ...(authData.user.user_metadata || {}),
            linked_emails: updatedLinked,
        };

        const { error: updateErr } = await sb.auth.admin.updateUserById(verified.userId, {
            user_metadata: newMetadata,
        });

        if (updateErr) {
            return NextResponse.json({ error: `Failed to link email: ${updateErr.message}` }, { status: 500, headers });
        }

        // If another auth user exists with that email, link its uploads/documents
        try {
            const { data: existingUsers } = await sb.auth.admin.listUsers({ perPage: 1000 });
            const matching = existingUsers?.users?.find(u => u.email?.toLowerCase() === rawEmail);
            if (matching && matching.id !== verified.userId) {
                // Link whatsapp_uploads from that secondary user ID to this primary user ID
                await sb
                    .from('whatsapp_uploads')
                    .update({ user_id: verified.userId })
                    .eq('user_id', matching.id);
            }
        } catch {
            // Non-fatal background sync
        }

        return NextResponse.json({
            success: true,
            message: `Successfully linked ${rawEmail}.`,
            linkedEmails: updatedLinked,
        }, { headers });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return NextResponse.json({ error: msg }, { status: 500, headers });
    }
}

/**
 * DELETE /api/customer/account/linked-emails
 * Remove a secondary email address from this customer account.
 */
export async function DELETE(req: NextRequest) {
    const headers = { 'Cache-Control': 'no-store' };
    const authHeader = req.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return NextResponse.json({ error: 'Authentication required.' }, { status: 401, headers });
    }

    try {
        const token = authHeader.slice(7).trim();
        const verified = await verifyCustomerToken(token);
        if (!verified || !verified.userId) {
            return NextResponse.json({ error: 'Session invalid or expired.' }, { status: 401, headers });
        }

        const body = await req.json().catch(() => ({}));
        const rawEmail = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';

        if (!rawEmail) {
            return NextResponse.json({ error: 'Email address is required.' }, { status: 400, headers });
        }

        const sb = getServiceRoleClient();
        const { data: authData, error: authErr } = await sb.auth.admin.getUserById(verified.userId);
        if (authErr || !authData.user) {
            return NextResponse.json({ error: 'Customer account not found.' }, { status: 404, headers });
        }

        const currentLinked: string[] = Array.isArray(authData.user.user_metadata?.linked_emails)
            ? authData.user.user_metadata.linked_emails
            : [];

        const updatedLinked = currentLinked.filter(e => e.toLowerCase() !== rawEmail);
        const newMetadata = {
            ...(authData.user.user_metadata || {}),
            linked_emails: updatedLinked,
        };

        const { error: updateErr } = await sb.auth.admin.updateUserById(verified.userId, {
            user_metadata: newMetadata,
        });

        if (updateErr) {
            return NextResponse.json({ error: `Failed to unlink email: ${updateErr.message}` }, { status: 500, headers });
        }

        return NextResponse.json({
            success: true,
            message: `Removed ${rawEmail}.`,
            linkedEmails: updatedLinked,
        }, { headers });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return NextResponse.json({ error: msg }, { status: 500, headers });
    }
}

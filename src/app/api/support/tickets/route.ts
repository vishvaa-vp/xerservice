import { NextRequest, NextResponse } from 'next/server';
import { verifyCustomerToken } from '@/lib/supabase/server';
import { createTicket, SupportServiceError } from '@packages/backend/support';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
    const headers = { 'Cache-Control': 'no-store' };

    try {
        const body = await req.json().catch(() => ({}));
        let authenticatedUserId: string | null = null;
        let authenticatedEmail: string | null = null;

        // Check optional auth header
        const authHeader = req.headers.get('authorization');
        if (authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.slice(7).trim();
            try {
                const verified = await verifyCustomerToken(token);
                if (verified && verified.userId) {
                    authenticatedUserId = verified.userId;
                    authenticatedEmail = verified.email || null;
                }
            } catch {
                // Non-fatal for public ticket creation; fallback to guest
            }
        }

        const source = body.source || (authenticatedUserId ? 'customer_portal' : 'contact_form');
        const customerName = body.customerName || body.name;
        const customerEmail = body.customerEmail || body.email || authenticatedEmail;
        const customerPhone = body.customerPhone || body.phone;
        const subject = body.subject;
        const message = body.message;
        const priority = body.priority || 'normal';
        const shopId = body.shopId || null;
        const orderId = body.orderId || null;

        if (!customerName || !subject || !message) {
            return NextResponse.json(
                { error: 'Name, subject, and message are required.' },
                { status: 400, headers }
            );
        }

        const result = await createTicket({
            source,
            userId: authenticatedUserId,
            customerName,
            customerEmail,
            customerPhone,
            subject,
            message,
            priority,
            shopId,
            orderId,
            attachments: body.attachments || [],
        });

        return NextResponse.json(
            {
                success: true,
                ticket: {
                    id: result.ticket.id,
                    ticketNumber: result.ticket.ticket_number,
                    status: result.ticket.status,
                    createdAt: result.ticket.created_at,
                },
                message: 'Support ticket registered successfully.',
            },
            { status: 201, headers }
        );
    } catch (err: unknown) {
        if (err instanceof SupportServiceError) {
            return NextResponse.json({ error: err.message }, { status: err.statusCode, headers });
        }
        console.error('[POST /api/support/tickets] Error:', err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : 'Failed to create support ticket.' },
            { status: 500, headers }
        );
    }
}

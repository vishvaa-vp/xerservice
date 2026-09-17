import { NextRequest, NextResponse } from 'next/server';
import { getServiceRoleClient, verifyAuthToken } from '../supabase/client';

export interface AdminAuthResult {
    authorized: boolean;
    status: number;
    error: string | null;
    user: {
        userId: string;
        email?: string;
        role: 'admin';
        fullName?: string;
    } | null;
}

/**
 * Server-authoritative admin authentication guard.
 * Validates the JWT Bearer token and verifies profiles.role === 'admin'.
 * Rejects customers and vendors with 403 Forbidden.
 * Rejects missing/expired tokens with 401 Unauthorized.
 */
export async function requireAdminAuth(req: NextRequest): Promise<AdminAuthResult> {
    const authHeader = req.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return {
            authorized: false,
            status: 401,
            error: 'Authentication required. Please sign in.',
            user: null,
        };
    }

    const token = authHeader.slice(7).trim();
    if (!token) {
        return {
            authorized: false,
            status: 401,
            error: 'Authentication token is empty.',
            user: null,
        };
    }

    let authUser: { userId: string; email?: string } | null = null;
    try {
        authUser = await verifyAuthToken(token);
    } catch {
        return {
            authorized: false,
            status: 401,
            error: 'Authentication failed. Please sign in again.',
            user: null,
        };
    }

    if (!authUser || !authUser.userId) {
        return {
            authorized: false,
            status: 401,
            error: 'Session invalid or expired. Please sign in again.',
            user: null,
        };
    }

    const serviceClient = getServiceRoleClient();

    // Authoritatively check profiles.role
    const { data: profile, error: profileErr } = await serviceClient
        .from('profiles')
        .select('user_id, role, full_name')
        .eq('user_id', authUser.userId)
        .maybeSingle();

    if (profileErr || !profile) {
        return {
            authorized: false,
            status: 403,
            error: 'Forbidden: profile not found or role unassigned.',
            user: null,
        };
    }

    if (profile.role !== 'admin') {
        return {
            authorized: false,
            status: 403,
            error: 'Forbidden: admin privileges required.',
            user: null,
        };
    }

    return {
        authorized: true,
        status: 200,
        error: null,
        user: {
            userId: authUser.userId,
            email: authUser.email || '',
            role: 'admin',
            fullName: profile.full_name,
        },
    };
}

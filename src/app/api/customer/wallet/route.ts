import { NextRequest, NextResponse } from 'next/server';
import { getServiceRoleClient, verifyCustomerToken } from '@/lib/supabase/server';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
    const headers = { 'Cache-Control': 'no-store, no-cache, must-revalidate' };
    const fail = (error: string, status = 400) =>
        NextResponse.json({ error }, { status, headers });

    // 1. Authenticate Request
    const authHeader = req.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return fail('Authentication required. Please sign in.', 401);
    }
    const token = authHeader.slice(7).trim();
    let authUser: { userId: string; email?: string } | null = null;
    try {
        authUser = await verifyCustomerToken(token);
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return fail(`Authentication failed: ${msg}`, 401);
    }

    if (!authUser || !authUser.userId) {
        return fail('Session invalid or expired. Please sign in again.', 401);
    }

    const userId = authUser.userId;

    // 2. Load Server-Side Service Role Client
    let serviceClient;
    try {
        serviceClient = getServiceRoleClient();
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return fail(msg, 503);
    }

    // 3. Retrieve or Lazily Provision Customer Wallet Account
    const { data: walletData, error: walletError } = await serviceClient
        .rpc('get_or_create_wallet_account', { p_user_id: userId });

    if (walletError) {
        return fail(`Failed to load wallet account: ${walletError.message}`, 500);
    }

    const wallet = Array.isArray(walletData) ? walletData[0] : walletData;
    const balance = wallet ? Number(wallet.balance) : 0.00;

    // 4. Load Recent Ledger Transactions
    const { data: transactions, error: txError } = await serviceClient
        .from('wallet_transactions')
        .select(`
            id,
            order_id,
            type,
            source,
            amount,
            balance_before,
            balance_after,
            reference,
            created_at
        `)
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(50);

    if (txError) {
        return fail(`Failed to load wallet transactions: ${txError.message}`, 500);
    }

    return NextResponse.json({
        balance: Number.isFinite(balance) ? balance : 0.00,
        walletId: wallet?.id || null,
        transactions: transactions || [],
    }, { status: 200, headers });
}

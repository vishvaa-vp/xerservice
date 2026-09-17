import { createClient, SupabaseClient } from '@supabase/supabase-js';

let serviceClientInstance: SupabaseClient | null = null;

/**
 * Returns a server-only Supabase client initialized with the SUPABASE_SECRET_KEY (service role).
 * This client bypasses RLS and executes with service_role privileges.
 * NEVER expose this client or the secret key to the browser!
 */
export function getServiceRoleClient(): SupabaseClient {
    if (typeof window !== 'undefined') {
        throw new Error('[Security] getServiceRoleClient cannot be invoked on the client/browser.');
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl) {
        throw new Error('[Configuration] NEXT_PUBLIC_SUPABASE_URL is not set.');
    }

    if (!serviceKey) {
        throw new Error(
            '[Configuration] SUPABASE_SECRET_KEY is not configured in server environment. ' +
            'Please add SUPABASE_SECRET_KEY=<service_role_secret> to your environment (.env.local).'
        );
    }

    if (!serviceClientInstance) {
        serviceClientInstance = createClient(supabaseUrl, serviceKey, {
            auth: {
                persistSession: false,
                autoRefreshToken: false,
            },
        });
    }

    return serviceClientInstance;
}

/**
 * Verifies a Supabase access token (JWT) server-side and returns the authenticated user ID.
 * Returns null if token is missing, invalid, or expired.
 */
export async function verifyAuthToken(token: string): Promise<{ userId: string; email?: string } | null> {
    if (!token) return null;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

    if (!supabaseUrl || !anonKey) {
        throw new Error('[Configuration] Supabase URL or Anon key is missing for auth verification.');
    }

    // Use anon client with the user's JWT to verify authenticity
    const authClient = createClient(supabaseUrl, anonKey, {
        auth: { persistSession: false },
        global: {
            headers: {
                Authorization: `Bearer ${token}`,
            },
        },
    });

    const { data: { user }, error } = await authClient.auth.getUser(token);
    if (error || !user) {
        return null;
    }

    return {
        userId: user.id,
        email: user.email,
    };
}

/** Customer APIs must not treat any valid vendor/admin token as a customer session. */
export async function verifyCustomerToken(token: string): Promise<{ userId: string; email?: string } | null> {
    const identity = await verifyAuthToken(token);
    if (!identity) return null;
    const { data, error } = await getServiceRoleClient().from('profiles')
        .select('role').eq('user_id', identity.userId).maybeSingle();
    return !error && data?.role === 'customer' ? identity : null;
}

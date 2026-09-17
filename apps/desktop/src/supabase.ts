/**
 * XerService Desktop Supabase Client
 *
 * Reuses the existing Supabase Auth authority with strictly in-memory session persistence.
 * Zero tokens or session keys are stored in localStorage or persisted to disk.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

const viteEnv = (import.meta as ImportMeta & {
    env: { VITE_SUPABASE_URL?: string; VITE_SUPABASE_PUBLISHABLE_KEY?: string };
}).env;
const SUPABASE_URL = viteEnv.VITE_SUPABASE_URL || 'https://example.supabase.co';
const SUPABASE_ANON_KEY = viteEnv.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_placeholder';

// Custom in-memory storage: tokens are stored ONLY in application RAM.
// Nothing is ever written to localStorage or unencrypted persistent storage.
const memoryStore: Record<string, string> = {};

const inMemoryStorageAdapter = {
    getItem: (key: string): string | null => {
        return memoryStore[key] || null;
    },
    setItem: (key: string, value: string): void => {
        memoryStore[key] = value;
    },
    removeItem: (key: string): void => {
        delete memoryStore[key];
    },
};

export const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
        persistSession: true,
        storage: inMemoryStorageAdapter,
        autoRefreshToken: true,
        detectSessionInUrl: false,
    },
});

export interface AuthenticatedVendorSession {
    userId: string;
    email: string;
    accessToken: string;
    role: string;
    fullName: string;
    shopId: string;
    shopName: string;
    shopStatus: string;
}

/**
 * Authenticates vendor credentials against Supabase Auth authority,
 * verifies vendor role in public.profiles, and confirms owned shop in public.shops.
 */
export async function authenticateVendor(email: string, password: string): Promise<AuthenticatedVendorSession> {
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail) {
        throw new Error('Please enter your vendor email address.');
    }
    if (!password) {
        throw new Error('Please enter your password.');
    }

    // 1. Supabase Auth credential verification
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email: trimmedEmail,
        password,
    });

    if (authError || !authData?.user || !authData?.session) {
        const msg = authError?.message || 'Authentication failed.';
        if (msg.toLowerCase().includes('invalid login credentials')) {
            throw new Error('Invalid email or password. Please check your credentials.');
        } else if (msg.toLowerCase().includes('email not confirmed')) {
            throw new Error('Please confirm your email address before logging in.');
        }
        throw new Error(msg);
    }

    // 2. Authorization check: public.profiles.role === 'vendor'
    const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('role, full_name')
        .eq('user_id', authData.user.id)
        .maybeSingle();

    if (profileError) {
        console.error('[DesktopAuth] Profile lookup failed.');
    }

    if (!profile || profile.role !== 'vendor') {
        // Customer account or unauthorized role: terminate session immediately
        await supabase.auth.signOut();
        throw new Error('Access denied. This account does not have vendor privileges.');
    }

    // 3. Shop ownership check: public.shops.owner_id === user.id
    const { data: shop, error: shopError } = await supabase
        .from('shops')
        .select('id, name, status')
        .eq('owner_id', authData.user.id)
        .maybeSingle();

    if (shopError) {
        console.error('[DesktopAuth] Shop lookup failed.');
    }

    if (!shop) {
        await supabase.auth.signOut();
        throw new Error('No shop assigned to this vendor account.');
    }

    return {
        userId: authData.user.id,
        email: authData.user.email || trimmedEmail,
        accessToken: authData.session.access_token,
        role: profile.role,
        fullName: profile.full_name || 'Vendor',
        shopId: shop.id,
        shopName: shop.name || 'Your Shop',
        shopStatus: shop.status || 'OPEN',
    };
}

/**
 * Signs out from Supabase Auth and purges all in-memory session records.
 */
export async function signOutVendor(): Promise<void> {
    try {
        await supabase.auth.signOut();
    } catch {
        // Ignore network errors during signout
    }
    // Wipe in-memory store
    for (const k of Object.keys(memoryStore)) {
        delete memoryStore[k];
    }
}

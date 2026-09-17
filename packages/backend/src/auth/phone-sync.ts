import { getServiceRoleClient } from '../supabase/client';
import { normalizePhoneNumber, isValidIndianMobile } from '@packages/shared';

export interface PhoneSyncResult {
    success: boolean;
    userId: string;
    phone: string | null;
    error?: string;
}

/**
 * Trusted server helper to synchronize verified phone from auth.users to public.profiles.
 * Strictly reads auth.users.phone and NEVER accepts arbitrary phone input from client.
 */
export async function syncVerifiedPhoneToProfile(userId: string): Promise<PhoneSyncResult> {
    if (!userId) {
        return { success: false, userId: '', phone: null, error: 'User ID is required' };
    }

    const serviceClient = getServiceRoleClient();

    // 1. Fetch authoritative phone from auth.users
    const { data: authData, error: authError } = await serviceClient.auth.admin.getUserById(userId);
    if (authError || !authData?.user) {
        return {
            success: false,
            userId,
            phone: null,
            error: authError?.message || 'Failed to retrieve auth user',
        };
    }

    const authPhone = authData.user.phone;
    if (!authPhone || typeof authPhone !== 'string' || !authPhone.trim()) {
        return {
            success: false,
            userId,
            phone: null,
            error: 'No verified phone number found on authenticated account',
        };
    }

    // 2. Validate & normalize canonical E.164
    const normalized = normalizePhoneNumber(authPhone);
    if (!normalized || !isValidIndianMobile(normalized)) {
        return {
            success: false,
            userId,
            phone: null,
            error: `Authoritative phone (${authPhone}) is not a valid Indian mobile number`,
        };
    }

    // 3. Create or update profile row where user_id = userId
    const { data: existingProfile, error: fetchProfileError } = await serviceClient
        .from('profiles')
        .select('id, user_id, phone, role')
        .eq('user_id', userId)
        .maybeSingle();

    if (fetchProfileError) {
        return {
            success: false,
            userId,
            phone: null,
            error: fetchProfileError.message || 'Failed to check existing profile',
        };
    }

    if (existingProfile) {
        const { error: profileError } = await serviceClient
            .from('profiles')
            .update({
                phone: normalized,
                updated_at: new Date().toISOString(),
            })
            .eq('user_id', userId);

        if (profileError) {
            if (profileError.code === '23505' || profileError.message.includes('unique')) {
                return {
                    success: false,
                    userId,
                    phone: null,
                    error: 'This mobile number is already linked to another account.',
                };
            }
            return {
                success: false,
                userId,
                phone: null,
                error: profileError.message || 'Failed to update profile',
            };
        }
    } else {
        const fullName = authData.user.user_metadata?.full_name ||
            authData.user.user_metadata?.name ||
            `Customer (${normalized.slice(-4)})`;
        const avatarUrl = authData.user.user_metadata?.avatar_url || null;

        const { error: insertError } = await serviceClient
            .from('profiles')
            .insert({
                user_id: userId,
                phone: normalized,
                full_name: fullName,
                avatar_url: avatarUrl,
                role: 'customer',
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            });

        if (insertError) {
            if (insertError.code === '23505' || insertError.message.includes('unique')) {
                return {
                    success: false,
                    userId,
                    phone: null,
                    error: 'This mobile number is already linked to another account.',
                };
            }
            return {
                success: false,
                userId,
                phone: null,
                error: insertError.message || 'Failed to create customer profile',
            };
        }
    }

    // 4. Lazily ensure wallet account is provisioned
    try {
        await serviceClient.rpc('get_or_create_wallet_account', { p_user_id: userId });
    } catch {
        // Wallet initialization is non-fatal on login sync
    }

    return {
        success: true,
        userId,
        phone: normalized,
    };
}

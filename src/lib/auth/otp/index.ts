/**
 * Optional app-managed phone OTP provider registry.
 *
 * ============================================================================
 * ACTIVE AUTHENTICATION ARCHITECTURE
 * ============================================================================
 *
 * Customer enters phone in login/linking UI
 *        ↓
 * Supabase Auth client: supabase.auth.signInWithOtp({ phone, options: { shouldCreateUser: false } })
 *        ↓
 * Supabase Auth Server (GoTrue) generates cryptographic 6-digit random token
 *        ↓
 * Supabase sends the SMS through its configured Vonage provider
 *        ↓
 * SMS delivered to customer's mobile device via telecom network
 *        ↓
 * Customer enters 6-digit OTP in UI
 *        ↓
 * Supabase Auth client: supabase.auth.verifyOtp({ phone, token, type: 'sms' })
 *        ↓
 * Supabase validates token authoritatively against challenge and issues user JWT session
 *
 * KEY SECURITY & ARCHITECTURAL INVARIANTS:
 * 1. Supabase Auth generates and verifies all OTP tokens. We NEVER build our own OTP generator.
 * 2. OTP tokens are NEVER stored in localStorage, NEVER logged, and NEVER written to notification_outbox.
 * 3. OTP_PROVIDER remains disabled while delivery is managed by Supabase. This
 *    registry is retained only for a future custom Send SMS Hook.
 */

import { OtpSmsProvider, OtpProviderConfig } from './types';
import { DisabledOtpProvider } from './providers/disabled';
import { Msg91OtpProvider } from './providers/msg91';

export * from './types';
export * from './providers/disabled';
export * from './providers/msg91';

/**
 * Returns current server-side OTP SMS provider configuration.
 * Missing or empty environment variables strictly default to disabled.
 */
export function getOtpProviderConfig(): OtpProviderConfig {
    const rawProvider = (process.env.OTP_PROVIDER || 'disabled').toLowerCase().trim();
    const phoneAuthEnabled = process.env.PHONE_AUTH_ENABLED === 'true';

    if (rawProvider === 'msg91') {
        const msg91 = new Msg91OtpProvider();
        return {
            provider: 'msg91',
            isConfigured: msg91.isConfigured(),
            phoneAuthEnabled,
        };
    }

    return {
        provider: 'disabled',
        isConfigured: false,
        phoneAuthEnabled,
    };
}

/**
 * Resolves the authoritative OTP SMS provider.
 * Always defaults to DisabledOtpProvider unless PHONE_AUTH_ENABLED is true
 * and valid credentials have been configured.
 */
export function getOtpSmsProvider(): OtpSmsProvider {
    const config = getOtpProviderConfig();

    if (config.phoneAuthEnabled && config.provider === 'msg91' && config.isConfigured) {
        return new Msg91OtpProvider();
    }

    return new DisabledOtpProvider();
}

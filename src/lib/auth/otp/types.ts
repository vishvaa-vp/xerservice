/**
 * Phase 6H.2: Phone OTP SMS Provider Abstraction Types
 *
 * Defines the contract for future SMS provider integrations (e.g. MSG91)
 * while ensuring complete separation from Supabase Auth.
 *
 * IMPORTANT ARCHITECTURAL INVARIANT:
 * - Supabase Auth is SOLELY responsible for:
 *     1. OTP generation (cryptographic random tokens)
 *     2. OTP verification (matching token against auth challenge)
 *     3. Session creation & JWT issuance
 * - The provider abstraction is SOLELY responsible for:
 *     1. SMS message delivery via Supabase Auth Send SMS Hook or future provider adapter
 * - We NEVER create our own OTP generator.
 */

export interface OtpSmsPayload {
    /** Canonical Indian E.164 phone number (+91[6-9]XXXXXXXXX) */
    phone: string;
    /** The OTP token generated authoritatively by Supabase Auth */
    otp: string;
    /** Optional DLT/vendor template identifier */
    templateId?: string;
}

export interface OtpSmsResult {
    success: boolean;
    provider: string;
    messageId?: string;
    error?: string;
    skipped?: boolean;
}

export interface OtpSmsProvider {
    readonly name: string;
    sendOtpSms(payload: OtpSmsPayload): Promise<OtpSmsResult>;
}

export interface OtpProviderConfig {
    provider: 'disabled' | 'msg91';
    isConfigured: boolean;
    phoneAuthEnabled: boolean;
}

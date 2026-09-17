import { OtpSmsProvider, OtpSmsPayload, OtpSmsResult } from '../types';

/**
 * DisabledOtpProvider
 *
 * Default OTP SMS provider implementation for Phase 6H.2 Coming Soon mode.
 * Strictly performs ZERO network calls, sends ZERO real SMS, incurs ZERO costs,
 * and never logs or exposes the OTP token.
 */
export class DisabledOtpProvider implements OtpSmsProvider {
    readonly name = 'disabled';

    async sendOtpSms(payload: OtpSmsPayload): Promise<OtpSmsResult> {
        // Zero network operations; safe disabled response
        return {
            success: false,
            skipped: true,
            provider: 'disabled',
            error: 'OTP SMS provider is disabled.',
        };
    }
}

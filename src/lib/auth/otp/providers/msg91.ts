import { OtpSmsProvider, OtpSmsPayload, OtpSmsResult } from '../types';

/**
 * Msg91OtpProvider (Future Placeholder for Phase 6H.3 Live Activation)
 *
 * In this Phase 6H.2 preparation phase, this class provides the architectural
 * skeleton for integrating MSG91 Indian SMS delivery WITHOUT activating live requests.
 *
 * REQUIREMENTS FOR FUTURE ACTIVATION:
 * 1. MSG91 Enterprise Account:
 *    - Active MSG91 account with SMS credit balance.
 * 2. Indian Telecom Regulatory Authority (TRAI) DLT Compliance:
 *    - Principal Entity (PE) registration on DLT portal (e.g. Jio / Airtel / Vil / BSNL).
 *    - Approved Header / Sender ID (6 characters, e.g. 'XERSRV').
 *    - Approved Service-Implicit / Transactional Content Template for OTP (e.g. "Your XerService OTP is ##OTP##. Valid for 10 minutes.").
 * 3. Server Configuration:
 *    - MSG91_AUTH_KEY: Secret API AuthKey from MSG91 dashboard (stored in server env only).
 *    - MSG91_TEMPLATE_ID: DLT-mapped template ID in MSG91.
 *    - MSG91_SENDER_ID: Approved 6-character sender ID.
 * 4. Supabase Send SMS Hook Integration:
 *    - Configured in Supabase Dashboard (Authentication -> Hooks -> Send SMS).
 *    - Supabase Auth invokes our HTTPS webhook with { user: { phone }, otp: "..." }.
 *    - This provider dispatches the SMS via MSG91 OTP API (POST https://control.msg91.com/api/v5/otp).
 */
export class Msg91OtpProvider implements OtpSmsProvider {
    readonly name = 'msg91';

    private authKey: string;
    private templateId: string;
    private senderId: string;

    constructor() {
        this.authKey = process.env.MSG91_AUTH_KEY || '';
        this.templateId = process.env.MSG91_TEMPLATE_ID || '';
        this.senderId = process.env.MSG91_SENDER_ID || '';
    }

    /**
     * Checks whether all mandatory MSG91 credentials are provided.
     */
    isConfigured(): boolean {
        return Boolean(this.authKey && this.templateId && this.senderId);
    }

    /**
     * Dispatches OTP SMS via MSG91 API.
     * In Phase 6H.2 (Preparation Only), this method safely rejects unconfigured calls
     * without making ANY real HTTP requests to external MSG91 servers.
     */
    async sendOtpSms(payload: OtpSmsPayload): Promise<OtpSmsResult> {
        if (!this.isConfigured()) {
            return {
                success: false,
                provider: this.name,
                error: 'MSG91 credentials not configured (MSG91_AUTH_KEY, MSG91_TEMPLATE_ID, MSG91_SENDER_ID required). Provider remains in disabled preparation mode.',
            };
        }

        // Live delivery execution reserved for future activation phase when credentials are provided.
        // DO NOT perform live network calls in Phase 6H.2.
        return {
            success: false,
            provider: this.name,
            error: 'MSG91 provider is not activated in this environment (Phase 6H.2 Coming Soon mode active).',
        };
    }
}

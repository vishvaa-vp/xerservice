/**
 * Production Environment Configuration Validator
 * Validates that all required server environment variables are present and non-empty.
 * Fails fast in production while respecting feature flags for disabled providers.
 */

export interface EnvValidationResult {
    isValid: boolean;
    missingVars: string[];
    warnings: string[];
}

export function validateServerEnv(): EnvValidationResult {
    const isProduction = process.env.NODE_ENV === "production";
    const missingVars: string[] = [];
    const warnings: string[] = [];

    // Core Supabase Configuration
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
        missingVars.push("NEXT_PUBLIC_SUPABASE_URL");
    }
    if (!process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
        missingVars.push("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
    }
    if (!process.env.SUPABASE_SECRET_KEY && !process.env.SUPABASE_SERVICE_ROLE_KEY) {
        missingVars.push("SUPABASE_SECRET_KEY");
    }

    // Core Razorpay Configuration
    const razorpayKeyId = process.env.RAZORPAY_KEY_ID || process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;
    if (!razorpayKeyId) {
        missingVars.push("RAZORPAY_KEY_ID (or NEXT_PUBLIC_RAZORPAY_KEY_ID)");
    }
    if (!process.env.RAZORPAY_KEY_SECRET) {
        missingVars.push("RAZORPAY_KEY_SECRET");
    }
    if (!process.env.RAZORPAY_WEBHOOK_SECRET) {
        missingVars.push("RAZORPAY_WEBHOOK_SECRET");
    }

    // Feature-Flagged Provider Configuration
    const phoneAuthEnabled = process.env.PHONE_AUTH_ENABLED === "true";
    const otpProvider = (process.env.OTP_PROVIDER || "disabled").trim().toLowerCase();

    if (phoneAuthEnabled && otpProvider === "msg91") {
        if (!process.env.MSG91_AUTH_KEY) {
            missingVars.push("MSG91_AUTH_KEY");
        }
    }

    // WhatsApp Cloud API Validation (when enabled)
    const whatsappProvider = (process.env.WHATSAPP_PROVIDER || "disabled").trim().toLowerCase();
    if (whatsappProvider === "cloud_api") {
        if (!process.env.WHATSAPP_ACCESS_TOKEN) {
            missingVars.push("WHATSAPP_ACCESS_TOKEN");
        }
        if (!process.env.WHATSAPP_VERIFY_TOKEN) {
            missingVars.push("WHATSAPP_VERIFY_TOKEN");
        }
    }

    // Critical Production Safety: Test media fixtures must NEVER be enabled in production
    if (isProduction && process.env.WHATSAPP_TEST_MEDIA_PAYLOADS_ENABLED === "true") {
        missingVars.push("SECURITY: WHATSAPP_TEST_MEDIA_PAYLOADS_ENABLED must be false in production");
    }

    // Production security warnings
    if (isProduction && process.env.ENABLE_HSTS !== "true") {
        warnings.push("ENABLE_HSTS is not enabled. Recommended 'true' for production HTTPS deployments.");
    }

    const isValid = missingVars.length === 0;

    if (!isValid && isProduction) {
        throw new Error(
            `[Security/Configuration] Missing required production environment variables: ${missingVars.join(", ")}`
        );
    }

    return { isValid, missingVars, warnings };
}

// Fail fast in production server context: never swallow or suppress missing variable errors
if (typeof window === "undefined" && process.env.NODE_ENV === "production") {
    validateServerEnv();
}

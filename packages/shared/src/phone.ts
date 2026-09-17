/**
 * Authoritative Indian Mobile Phone Normalization & Validation Utility (E.164)
 * Canonical format: +91[6-9]XXXXXXXXX (10 digits starting 6-9 with +91 country prefix)
 */

/**
 * Normalizes phone numbers to Indian E.164 (+91XXXXXXXXXX).
 * Strips whitespace, hyphens, parentheses, and dots.
 * Rejects malformed numbers cleanly without guessing or fabricating.
 * Returns null if invalid.
 */
export function normalizePhoneNumber(raw?: string | null): string | null {
    if (!raw || typeof raw !== 'string') return null;

    // Remove all whitespace, dashes, parentheses, dots
    const cleaned = raw.trim().replace(/[\s\-\(\)\.]/g, '');
    if (!cleaned) return null;

    // Format: +91XXXXXXXXXX (13 chars)
    if (/^\+91[6-9]\d{9}$/.test(cleaned)) {
        return cleaned;
    }

    // Format: 91XXXXXXXXXX (12 chars)
    if (/^91[6-9]\d{9}$/.test(cleaned)) {
        return `+${cleaned}`;
    }

    // Format: 0XXXXXXXXXX (11 chars)
    if (/^0[6-9]\d{9}$/.test(cleaned)) {
        return `+91${cleaned.slice(1)}`;
    }

    // Format: XXXXXXXXXX (10 chars)
    if (/^[6-9]\d{9}$/.test(cleaned)) {
        return `+91${cleaned}`;
    }

    // Unrecognized or invalid format
    return null;
}

/**
 * Validates if the given string represents a valid Indian mobile number.
 */
export function isValidIndianMobile(raw?: string | null): boolean {
    return normalizePhoneNumber(raw) !== null;
}

/**
 * Formats a normalized or raw phone string for user-friendly display (+91 XXXXX XXXXX).
 */
export function formatPhoneDisplay(phone?: string | null): string {
    const normalized = normalizePhoneNumber(phone);
    if (!normalized) return phone || '';
    // Formatted: +91 98765 43210
    return `${normalized.slice(0, 3)} ${normalized.slice(3, 8)} ${normalized.slice(8)}`;
}

/**
 * Normalizes phone numbers to digits only without '+' or spaces (e.g., "919092925065").
 * Matches the format sent by Meta WhatsApp Cloud API webhooks.
 */
export function normalizePhoneDigits(raw?: string | null): string | null {
    const e164 = normalizePhoneNumber(raw);
    return e164 ? e164.replace(/\D/g, '') : null;
}

/**
 * Extracts 10-digit national mobile number without country code (e.g., "9092925065").
 */
export function getNational10DigitPhone(raw?: string | null): string | null {
    const e164 = normalizePhoneNumber(raw);
    return e164 ? e164.slice(-10) : null;
}

/**
 * Compares two raw or formatted phone numbers to determine if they refer to the same number.
 * Example: '9092925065', '+91 90929 25065', and '919092925065' all evaluate as equal.
 */
export function arePhoneNumbersEqual(phoneA?: string | null, phoneB?: string | null): boolean {
    const normA = normalizePhoneNumber(phoneA);
    const normB = normalizePhoneNumber(phoneB);
    return normA !== null && normA === normB;
}

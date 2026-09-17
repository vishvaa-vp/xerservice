import { NextRequest, NextResponse } from "next/server";

const ALLOWED_ORIGINS = new Set([
    "https://xerservice.in",
    "https://www.xerservice.in",
]);

/**
 * Validates request origin/referer for sensitive state mutations.
 * Allows same-origin requests, authorized production origins,
 * localhost in development, and non-browser server-to-server calls.
 */
export function validateMutationOrigin(req: NextRequest): { isValid: boolean; response?: NextResponse } {
    const origin = req.headers.get("origin");
    const referer = req.headers.get("referer");

    // If neither origin nor referer is provided (e.g. server-to-server or webhook), allow through
    if (!origin && !referer) {
        return { isValid: true };
    }

    const checkUrl = (urlStr: string): boolean => {
        try {
            const parsed = new URL(urlStr);
            const hostOrigin = `${parsed.protocol}//${parsed.host}`.toLowerCase();

            // Local development and explicitly supported tunnel hosts.
            if (process.env.NODE_ENV !== "production") {
                const hostname = parsed.hostname.toLowerCase();
                const isLocal = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
                const isNgrok = hostname.endsWith(".ngrok.app") ||
                    hostname.endsWith(".ngrok.io") ||
                    hostname.endsWith(".ngrok-free.app") ||
                    hostname.endsWith(".ngrok-free.dev");

                if (isLocal || isNgrok) {
                    return true;
                }
            }

            return ALLOWED_ORIGINS.has(hostOrigin);
        } catch {
            return false;
        }
    };

    if (origin && !checkUrl(origin)) {
        return {
            isValid: false,
            response: NextResponse.json(
                { error: "Forbidden: Cross-origin request not permitted." },
                { status: 403 }
            ),
        };
    }

    if (!origin && referer && !checkUrl(referer)) {
        return {
            isValid: false,
            response: NextResponse.json(
                { error: "Forbidden: Cross-origin request not permitted." },
                { status: 403 }
            ),
        };
    }

    return { isValid: true };
}

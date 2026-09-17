import { NextRequest, NextResponse } from "next/server";

/**
 * Rate Limiter Store Interface
 * Allows seamless switching between in-memory store (single-process Node.js runtime)
 * and distributed shared stores (e.g. Redis / Upstash) for multi-instance clusters.
 *
 * ARCHITECTURAL CLARIFICATION:
 * The default `InMemoryRateLimitStore` maintains counters in process memory.
 * - Suitable for single-instance Node.js deployments (e.g., VPS / single container).
 * - For multi-instance horizontal scaling, a distributed `RateLimitStore` implementation
 *   (e.g., Redis or Upstash) MUST be configured before rate limits can be considered
 *   globally authoritative across instances.
 */
export interface RateLimitStore {
    check(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult>;
}

export interface RateLimitResult {
    success: boolean;
    limit: number;
    remaining: number;
    reset: number;       // Unix timestamp in seconds when the window resets
    retryAfter: number;  // Seconds until the client may retry
}

export interface RateLimitOptions {
    limit: number;
    windowSeconds: number;
    prefix?: string;
    identifier?: string; // Optional custom identifier (e.g., composite userId:ip)
}

interface WindowRecord {
    count: number;
    expiresAt: number;
}

/**
 * In-Memory Sliding Window Store with memory-bounded capacity protection.
 * Note: Process-local storage; suitable for single-instance deployments.
 */
export class InMemoryRateLimitStore implements RateLimitStore {
    private cache = new Map<string, WindowRecord>();
    private maxEntries = 10000; // Prevent memory exhaustion
    private lastCleanup = Date.now();

    private cleanup() {
        const now = Date.now();
        if (now - this.lastCleanup < 30000) return; // Clean every 30s
        this.lastCleanup = now;

        this.cache.forEach((record, key) => {
            if (record.expiresAt <= now) {
                this.cache.delete(key);
            }
        });
    }

    public async check(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
        this.cleanup();

        const now = Date.now();
        const windowMs = windowSeconds * 1000;
        let record = this.cache.get(key);

        if (!record || record.expiresAt <= now) {
            // New window
            if (this.cache.size >= this.maxEntries) {
                // Drop oldest entry if cache exceeds capacity
                const keys = Array.from(this.cache.keys());
            if (keys.length > 0) this.cache.delete(keys[0]);
            }

            record = {
                count: 1,
                expiresAt: now + windowMs,
            };
            this.cache.set(key, record);

            return {
                success: true,
                limit,
                remaining: limit - 1,
                reset: Math.ceil(record.expiresAt / 1000),
                retryAfter: 0,
            };
        }

        // Increment count in existing window
        record.count += 1;
        const remaining = Math.max(0, limit - record.count);
        const retryAfter = Math.max(1, Math.ceil((record.expiresAt - now) / 1000));

        return {
            success: record.count <= limit,
            limit,
            remaining,
            reset: Math.ceil(record.expiresAt / 1000),
            retryAfter: record.count <= limit ? 0 : retryAfter,
        };
    }
}

// Global store instance
const memoryStore = new InMemoryRateLimitStore();

/**
 * Extracts client IP identifier from request headers
 */
export function getClientIp(req: NextRequest): string {
    const xForwardedFor = req.headers.get("x-forwarded-for");
    if (xForwardedFor) {
        const firstIp = xForwardedFor.split(",")[0].trim();
        if (firstIp) return firstIp;
    }

    const cfIp = req.headers.get("cf-connecting-ip");
    if (cfIp) return cfIp.trim();

    const xRealIp = req.headers.get("x-real-ip");
    if (xRealIp) return xRealIp.trim();

    return "127.0.0.1";
}

/**
 * Checks rate limit for a given identifier
 */
export async function checkRateLimit(
    identifier: string,
    options: RateLimitOptions
): Promise<RateLimitResult> {
    const prefix = options.prefix || "rl";
    const key = `${prefix}:${identifier}`;
    return memoryStore.check(key, options.limit, options.windowSeconds);
}

/**
 * Applies rate limiting to a Next.js API route.
 * If exceeded, returns HTTP 429 Too Many Requests with standard headers.
 */
export async function applyRateLimit(
    req: NextRequest,
    options: RateLimitOptions
): Promise<{ isLimited: boolean; response?: NextResponse; headers: Record<string, string> }> {
    const id = options.identifier || getClientIp(req);
    const result = await checkRateLimit(id, options);

    const headers: Record<string, string> = {
        "X-RateLimit-Limit": String(result.limit),
        "X-RateLimit-Remaining": String(result.remaining),
        "X-RateLimit-Reset": String(result.reset),
    };

    if (!result.success) {
        headers["Retry-After"] = String(result.retryAfter);

        const response = NextResponse.json(
            {
                error: "Too many requests. Please try again later.",
                retryAfter: result.retryAfter,
            },
            {
                status: 429,
                headers,
            }
        );

        return { isLimited: true, response, headers };
    }

    return { isLimited: false, headers };
}

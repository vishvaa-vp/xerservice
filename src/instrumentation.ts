/**
 * Next.js Instrumentation Hook
 * Executes at server startup before any request is handled.
 * Guarantees fail-fast environment validation in production.
 */
export async function register() {
    if (process.env.NEXT_RUNTIME === 'nodejs') {
        const { validateServerEnv } = await import('@/lib/env-validator');
        validateServerEnv();
    }
}

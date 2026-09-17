import { NextRequest, NextResponse } from 'next/server';

/**
 * Approved origins for the XerService Native Desktop application:
 * - http://localhost:1420 (Tauri Vite development server)
 * - tauri://localhost (Tauri macOS & Linux packaged application)
 * - http://tauri.localhost (Tauri Windows packaged application)
 * - https://tauri.localhost (Tauri Windows secure scheme)
 */
export const ALLOWED_DESKTOP_ORIGINS = new Set([
    'http://localhost:1420',
    'tauri://localhost',
    'http://tauri.localhost',
    'https://tauri.localhost',
]);

/**
 * Checks whether a given origin string is in the approved desktop origins set.
 */
export function isAllowedDesktopOrigin(origin: string | null): boolean {
    if (!origin) return false;
    return ALLOWED_DESKTOP_ORIGINS.has(origin.trim().toLowerCase());
}

/**
 * Generates CORS headers for desktop API responses.
 * - If request origin is an approved desktop origin, reflects that exact origin (NEVER wildcard '*').
 * - Returns Vary: Origin to ensure intermediate caches separate responses by origin.
 * - If request origin is unapproved or missing, returns an empty header object.
 */
export function getCorsHeaders(
    req: NextRequest,
    allowedMethods: string[] = ['GET', 'OPTIONS']
): Record<string, string> {
    const origin = req.headers.get('origin');
    if (!origin || !isAllowedDesktopOrigin(origin)) {
        return {};
    }

    return {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': allowedMethods.join(', '),
        'Access-Control-Allow-Headers': 'Authorization, Content-Type, Cache-Control',
        'Access-Control-Max-Age': '86400',
        'Vary': 'Origin',
    };
}

/**
 * Handles CORS preflight (OPTIONS) requests explicitly for desktop-accessible routes.
 * - If the origin is approved, responds with 204 No Content and appropriate CORS headers.
 * - If the origin is unapproved, responds with 204 No Content with only Vary: Origin (no Access-Control-Allow-Origin).
 */
export function handleCorsPreflight(
    req: NextRequest,
    allowedMethods: string[] = ['GET', 'OPTIONS']
): NextResponse {
    const corsHeaders = getCorsHeaders(req, allowedMethods);
    return new NextResponse(null, {
        status: 204,
        headers: {
            'Cache-Control': 'no-store',
            'Vary': 'Origin',
            ...corsHeaders,
        },
    });
}

/** @type {import('next').NextConfig} */
const isProd = process.env.NODE_ENV === 'production';
const scriptSrc = `script-src 'self' 'unsafe-inline'${isProd ? '' : " 'unsafe-eval'"}`;
const securityHeaders = [
    {
        key: 'X-Content-Type-Options',
        value: 'nosniff',
    },
    {
        key: 'Referrer-Policy',
        value: 'strict-origin-when-cross-origin',
    },
    {
        key: 'X-Frame-Options',
        value: 'DENY',
    },
    {
        key: 'Permissions-Policy',
        value: 'camera=(), microphone=(), geolocation=(), browsing-topics=()',
    },
    {
        key: 'Content-Security-Policy',
        value: [
            "default-src 'self'",
            scriptSrc,
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: blob: https://*.supabase.co",
            "font-src 'self' data:",
            "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://xerservice.in https://www.xerservice.in",
            "frame-src 'self'",
            "frame-ancestors 'none'",
            "object-src 'none'",
            "base-uri 'self'",
            "form-action 'self'",
        ].join('; '),
    },
];

const nextConfig = {
    images: {
        unoptimized: true,
        remotePatterns: [],
    },
    allowedDevOrigins: ['*.ngrok-free.app', '*.ngrok.io', '*.ngrok-free.dev', 'localhost:3000', 'localhost:3002'],
    async headers() {
        return [
            {
                source: '/(.*)',
                headers: securityHeaders,
            },
        ];
    },
    async rewrites() {
        const backendUrl = process.env.BACKEND_API_URL || (isProd ? 'https://api.xerservice.in' : 'http://localhost:3000');
        return [
            {
                source: '/api/:path*',
                destination: `${backendUrl}/api/:path*`,
            },
        ];
    },
};

module.exports = nextConfig;

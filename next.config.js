/** @type {import('next').NextConfig} */
const isProd = process.env.NODE_ENV === 'production';
const scriptSrc = `script-src 'self' 'unsafe-inline'${isProd ? '' : " 'unsafe-eval'"} https://checkout.razorpay.com https://connect.facebook.net`;

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
            "img-src 'self' data: blob: https://*.supabase.co https://*.razorpay.com",
            "font-src 'self' data:",
            "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.razorpay.com https://lumberjack.razorpay.com https://xerservice.in https://www.xerservice.in https://www.facebook.com https://graph.facebook.com https://connect.facebook.net",
            "frame-src 'self' https://api.razorpay.com https://checkout.razorpay.com https://www.facebook.com https://connect.facebook.net",
            "worker-src 'self' blob:",
            "frame-ancestors 'none'",
            "object-src 'none'",
            "base-uri 'self'",
            "form-action 'self' https://api.razorpay.com",
        ].join('; '),
    },
];

// Conservative HSTS: production HTTPS only (never emitted in local/development)
const enableHsts = process.env.NODE_ENV === 'production' && process.env.ENABLE_HSTS === 'true';
if (enableHsts) {
    securityHeaders.push({
        key: 'Strict-Transport-Security',
        value: 'max-age=31536000',
    });
}

const nextConfig = {
    images: {
        unoptimized: true,
        remotePatterns: [],
    },
    allowedDevOrigins: ['*.ngrok-free.app', '*.ngrok.io', '*.ngrok-free.dev', 'localhost:3000'],
    async headers() {
        return [
            {
                source: '/(.*)',
                headers: securityHeaders,
            },
        ];
    },
};

module.exports = nextConfig;

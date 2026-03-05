import Link from 'next/link';

export default function NotFound() {
    return (
        <div style={{ minHeight: '80vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '40px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '40px' }}>
                <img src="/logo-black.png" alt="XerService Logo" style={{ width: '48px', height: '48px', objectFit: 'contain' }} />
                <span style={{ fontSize: '24px', fontWeight: '800', letterSpacing: '-0.04em' }}>XerService</span>
            </div>
            <div style={{ fontSize: 'clamp(80px, 15vw, 140px)', fontWeight: '900', letterSpacing: '-0.06em', lineHeight: '1', background: 'linear-gradient(135deg, var(--border) 0%, var(--accent-muted) 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text', marginBottom: '24px', userSelect: 'none' }}>404</div>
            <h1 style={{ fontSize: '28px', fontWeight: '800', letterSpacing: '-0.03em', marginBottom: '12px' }}>Page not found</h1>
            <p style={{ fontSize: '16px', color: 'var(--fg-muted)', marginBottom: '40px', maxWidth: '360px' }}>The page you're looking for doesn't exist or has been moved.</p>
            <div style={{ display: 'flex', gap: '12px' }}>
                <Link href="/" className="btn btn-accent">Go Home</Link>
                <Link href="/shops" className="btn btn-outline">Find Shops</Link>
            </div>
        </div>
    );
}

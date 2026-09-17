import Link from 'next/link';

export default function NotFound() {
    return (
        <div style={{ minHeight: '60vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '40px 20px' }}>
            <h1 style={{ fontSize: '32px', fontWeight: '900', marginBottom: '12px' }}>Admin Page Not Found</h1>
            <p style={{ color: 'var(--fg-muted)', marginBottom: '24px' }}>The requested admin route does not exist.</p>
            <Link href="/admin/finance" className="btn btn-primary">
                Return to Admin Console
            </Link>
        </div>
    );
}

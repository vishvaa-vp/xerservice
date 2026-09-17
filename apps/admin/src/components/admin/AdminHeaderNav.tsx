'use client';

import React from 'react';

export type AdminSection = 'users' | 'finance' | 'addons';

interface AdminHeaderNavProps {
    activeSection: AdminSection;
    title: string;
    description: string;
    badge?: string;
    actions?: React.ReactNode;
}

export default function AdminHeaderNav({
    title,
    description,
    badge,
    actions,
}: AdminHeaderNavProps) {
    return (
        <div style={{ marginBottom: '28px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
                <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <h1 style={{ fontSize: '24px', fontWeight: '900', letterSpacing: '-0.02em', margin: 0 }}>
                            {title}
                        </h1>
                        {badge && (
                            <span
                                style={{
                                    fontSize: '11px',
                                    fontWeight: '800',
                                    padding: '3px 8px',
                                    borderRadius: '12px',
                                    background: 'var(--accent-muted)',
                                    color: 'var(--accent)',
                                }}
                            >
                                {badge}
                            </span>
                        )}
                    </div>
                    <p style={{ color: 'var(--fg-muted)', fontSize: '13.5px', marginTop: '4px', marginBottom: 0 }}>
                        {description}
                    </p>
                </div>

                {actions && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                        {actions}
                    </div>
                )}
            </div>
        </div>
    );
}

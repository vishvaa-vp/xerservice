'use client';

import React from 'react';

export type AdminSection =
    | 'users'
    | 'finance'
    | 'addons'
    | 'earnings'
    | 'settlements'
    | 'vendors'
    | 'customers'
    | 'people'
    | 'support'
    | 'dashboard'
    | string;

interface AdminHeaderNavProps {
    activeSection?: AdminSection;
    title?: string;
    description?: string;
    badge?: string;
    actions?: React.ReactNode;
}

export default function AdminHeaderNav({
    title,
    badge,
    actions,
}: AdminHeaderNavProps) {
    if (!title && !actions && !badge) {
        return null;
    }
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

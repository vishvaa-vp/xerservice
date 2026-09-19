import React from 'react';
import AdminSidebar from '@/components/admin/AdminSidebar';

export const metadata = {
    title: 'Admin Console | XerService',
    description: 'XerService Administrator Management and Operations Console',
};

export default function AdminLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <div
            className="admin-shell-layout"
            style={{
                display: 'flex',
                width: '100%',
                minHeight: 'calc(100vh - 65px)',
                background: 'var(--bg)',
            }}
        >
            <AdminSidebar />
            <div
                className="admin-main-viewport"
                style={{
                    flex: 1,
                    minWidth: 0,
                    overflowX: 'hidden',
                }}
            >
                {children}
            </div>
        </div>
    );
}

'use client';

import type React from 'react';
import { X } from 'lucide-react';

interface ConfirmDialogProps {
    open: boolean;
    title: string;
    message: string;
    children?: React.ReactNode;
    confirmLabel?: string;
    cancelLabel?: string;
    destructive?: boolean;
    onConfirm: () => void;
    onCancel: () => void;
}

export default function ConfirmDialog({
    open,
    title,
    message,
    children,
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    destructive = false,
    onConfirm,
    onCancel,
}: ConfirmDialogProps) {
    if (!open) return null;

    return (
        <div className="confirm-overlay" role="dialog" aria-modal="true" aria-labelledby="confirm-dialog-title">
            <div className="confirm-card scale-in">
                <button className="confirm-close" onClick={onCancel} aria-label="Close">
                    <X size={18} />
                </button>
                <h2 id="confirm-dialog-title">{title}</h2>
                <p>{message}</p>
                {children}
                <div className="confirm-actions">
                    <button className="btn btn-outline" onClick={onCancel}>{cancelLabel}</button>
                    <button className={destructive ? 'btn btn-accent' : 'btn btn-primary'} onClick={onConfirm}>{confirmLabel}</button>
                </div>
            </div>
        </div>
    );
}

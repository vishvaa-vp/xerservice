'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { Trash2, AlertCircle, X, Lock } from 'lucide-react';

interface RequestDeleteModalProps {
    open: boolean;
    onClose: () => void;
    onSuccess: (request: { status: string; reason: string; requested_at: string }) => void;
    userEmail?: string;
}

export default function RequestDeleteModal({
    open,
    onClose,
    onSuccess,
    userEmail,
}: RequestDeleteModalProps) {
    const [reasonPreset, setReasonPreset] = useState('NO_LONGER_NEEDED');
    const [customReason, setCustomReason] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    if (!open) return null;

    const presetLabels: Record<string, string> = {
        NO_LONGER_NEEDED: 'No longer need printing services',
        ALTERNATIVE_FOUND: 'Found an alternative service or solution',
        PRIVACY_CONCERNS: 'Privacy or personal data concerns',
        MULTIPLE_ACCOUNTS: 'Merging or consolidating multiple accounts',
        OTHER: 'Other reason (specified below)',
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const baseReason = presetLabels[reasonPreset] || reasonPreset;
        const fullReason = customReason.trim()
            ? `${baseReason}: ${customReason.trim()}`
            : baseReason;

        setLoading(true);
        setError(null);

        try {
            const { data: sessionData } = await supabase.auth.getSession();
            const token = sessionData?.session?.access_token;
            if (!token) throw new Error('Not authenticated. Please sign in again.');

            const res = await fetch('/api/customer/account/delete-request', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    action: 'request',
                    reason: fullReason,
                    password: password || undefined,
                }),
            });

            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || 'Failed to submit deletion request.');
            }

            onSuccess(data.deleteRequest);
            onClose();
        } catch (err: any) {
            setError(err?.message || 'Failed to submit deletion request.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div
            className="profile-modal-overlay"
            style={{
                position: 'fixed',
                inset: 0,
                backgroundColor: 'rgba(0, 0, 0, 0.55)',
                backdropFilter: 'blur(4px)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 9999,
                padding: '16px',
            }}
            onClick={onClose}
        >
            <div
                className="profile-modal-card"
                style={{
                    backgroundColor: 'var(--bg)',
                    borderRadius: '16px',
                    width: '100%',
                    maxWidth: '480px',
                    boxShadow: 'var(--shadow-lg, 0 20px 25px -5px rgba(0, 0, 0, 0.2))',
                    border: '1px solid var(--border)',
                    overflow: 'hidden',
                }}
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div
                    style={{
                        padding: '20px 24px',
                        borderBottom: '1px solid var(--border)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                    }}
                >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div
                            style={{
                                width: '36px',
                                height: '36px',
                                borderRadius: '10px',
                                background: 'rgba(239, 68, 68, 0.1)',
                                color: '#ef4444',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                            }}
                        >
                            <Trash2 size={18} />
                        </div>
                        <div>
                            <h3 style={{ fontSize: '16px', fontWeight: '800', margin: 0 }}>
                                Request Account Deletion
                            </h3>
                            <p style={{ fontSize: '12px', color: 'var(--fg-muted)', margin: 0 }}>
                                Formal deletion request with admin review
                            </p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        style={{
                            background: 'transparent',
                            border: 'none',
                            color: 'var(--fg-muted)',
                            cursor: 'pointer',
                            padding: '4px',
                        }}
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* Form */}
                <form onSubmit={handleSubmit} style={{ padding: '24px' }}>
                    <p style={{ fontSize: '13px', color: 'var(--fg-muted)', lineHeight: '1.5', marginTop: 0, marginBottom: '16px' }}>
                        Submitting this request will schedule your account for administrative deletion. Active print orders must be fulfilled or cancelled first. You can cancel this request at any time prior to approval.
                    </p>

                    {error && (
                        <div
                            style={{
                                padding: '10px 14px',
                                borderRadius: '8px',
                                background: 'rgba(239, 68, 68, 0.1)',
                                border: '1px solid rgba(239, 68, 68, 0.25)',
                                color: '#ef4444',
                                fontSize: '12px',
                                fontWeight: '600',
                                marginBottom: '16px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                            }}
                        >
                            <AlertCircle size={15} style={{ flexShrink: 0 }} />
                            <span>{error}</span>
                        </div>
                    )}

                    {/* Reason Selection */}
                    <div style={{ marginBottom: '16px' }}>
                        <label
                            htmlFor="delete-reason-preset"
                            style={{ display: 'block', fontSize: '13px', fontWeight: '700', marginBottom: '6px' }}
                        >
                            Reason for Deletion <span style={{ color: '#ef4444' }}>*</span>
                        </label>
                        <select
                            id="delete-reason-preset"
                            className="input"
                            value={reasonPreset}
                            onChange={(e) => setReasonPreset(e.target.value)}
                            disabled={loading}
                            style={{ width: '100%' }}
                        >
                            <option value="NO_LONGER_NEEDED">No longer need printing services</option>
                            <option value="ALTERNATIVE_FOUND">Found an alternative service</option>
                            <option value="PRIVACY_CONCERNS">Privacy / data concerns</option>
                            <option value="MULTIPLE_ACCOUNTS">Consolidating / multiple accounts</option>
                            <option value="OTHER">Other reason</option>
                        </select>
                    </div>

                    {/* Additional Details */}
                    <div style={{ marginBottom: '16px' }}>
                        <label
                            htmlFor="delete-reason-custom"
                            style={{ display: 'block', fontSize: '13px', fontWeight: '700', marginBottom: '6px' }}
                        >
                            Additional Details <span style={{ fontSize: '11px', color: 'var(--fg-muted)' }}>(Optional)</span>
                        </label>
                        <textarea
                            id="delete-reason-custom"
                            className="input"
                            rows={3}
                            placeholder="Help us understand how we can improve..."
                            value={customReason}
                            onChange={(e) => setCustomReason(e.target.value)}
                            disabled={loading}
                            style={{ width: '100%', resize: 'vertical' }}
                        />
                    </div>

                    {/* Password Confirmation */}
                    <div style={{ marginBottom: '22px' }}>
                        <label
                            htmlFor="delete-password-input"
                            style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: '700', marginBottom: '6px' }}
                        >
                            <Lock size={13} color="var(--fg-muted)" /> Confirm Account Password
                        </label>
                        <input
                            id="delete-password-input"
                            type="password"
                            className="input"
                            placeholder="Enter password to confirm identity"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            disabled={loading}
                            style={{ width: '100%' }}
                        />
                    </div>

                    {/* Actions */}
                    <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                        <button
                            type="button"
                            onClick={onClose}
                            className="btn btn-outline btn-sm"
                            disabled={loading}
                        >
                            Keep Account
                        </button>
                        <button
                            type="submit"
                            className="btn btn-sm"
                            disabled={loading}
                            style={{
                                background: '#ef4444',
                                color: '#ffffff',
                                border: 'none',
                                fontWeight: '700',
                            }}
                        >
                            {loading ? 'Submitting...' : 'Submit Deletion Request'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

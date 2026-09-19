'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { Mail, Plus, X, AlertCircle } from 'lucide-react';

interface LinkEmailModalProps {
    open: boolean;
    onClose: () => void;
    onSuccess: (newLinked: string[]) => void;
    primaryEmail: string;
    currentEmails: string[];
}

export default function LinkEmailModal({
    open,
    onClose,
    onSuccess,
    primaryEmail,
    currentEmails,
}: LinkEmailModalProps) {
    const [email, setEmail] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    if (!open) return null;

    const handleLink = async (e: React.FormEvent) => {
        e.preventDefault();
        const trimmed = email.trim().toLowerCase();
        if (!trimmed) {
            setError('Please enter an email address.');
            return;
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(trimmed)) {
            setError('Please enter a valid email address.');
            return;
        }

        if (trimmed === primaryEmail.toLowerCase()) {
            setError('This is already your primary account email.');
            return;
        }

        if (currentEmails.map(em => em.toLowerCase()).includes(trimmed)) {
            setError('This email is already linked to your account.');
            return;
        }

        setLoading(true);
        setError(null);

        try {
            const { data: sessionData } = await supabase.auth.getSession();
            const token = sessionData?.session?.access_token;
            if (!token) throw new Error('Not authenticated. Please sign in again.');

            const res = await fetch('/api/customer/account/linked-emails', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ email: trimmed }),
            });

            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || 'Failed to link email address.');
            }

            setEmail('');
            onSuccess(data.linkedEmails || [...currentEmails, trimmed]);
            onClose();
        } catch (err: any) {
            setError(err?.message || 'Failed to link email address.');
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
                    maxWidth: '460px',
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
                                background: 'rgba(234, 88, 12, 0.1)',
                                color: 'var(--accent)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                            }}
                        >
                            <Mail size={18} />
                        </div>
                        <div>
                            <h3 style={{ fontSize: '16px', fontWeight: '800', margin: 0 }}>
                                Link Another Email / Merge Account
                            </h3>
                            <p style={{ fontSize: '12px', color: 'var(--fg-muted)', margin: 0 }}>
                                Connect multiple Gmail accounts to one mobile number
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
                <form onSubmit={handleLink} style={{ padding: '24px' }}>
                    <p style={{ fontSize: '13px', color: 'var(--fg-muted)', lineHeight: '1.5', marginTop: 0, marginBottom: '16px' }}>
                        By linking another Gmail or email address, you can sign in with either account and seamlessly access documents sent to your WhatsApp number.
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

                    <div style={{ marginBottom: '20px' }}>
                        <label
                            htmlFor="link-email-input"
                            style={{ display: 'block', fontSize: '13px', fontWeight: '700', marginBottom: '6px' }}
                        >
                            Additional Email Address
                        </label>
                        <input
                            id="link-email-input"
                            type="email"
                            className="input"
                            placeholder="e.g. yourname@gmail.com"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            autoFocus
                            disabled={loading}
                            style={{ width: '100%' }}
                        />
                    </div>

                    <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                        <button
                            type="button"
                            onClick={onClose}
                            className="btn btn-outline btn-sm"
                            disabled={loading}
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            className="btn btn-accent btn-sm"
                            disabled={loading}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                        >
                            {loading ? (
                                'Linking...'
                            ) : (
                                <>
                                    <Plus size={14} /> Link Email
                                </>
                            )}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

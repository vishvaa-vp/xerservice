'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
    X,
    MessageCircle,
    CheckCircle2,
    AlertCircle,
    ArrowRight,
    ExternalLink,
    ShieldCheck,
    Clock,
    Copy,
    Check,
    RotateCw,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';

interface WhatsAppLinkModalProps {
    open: boolean;
    onClose: () => void;
    onSuccess: () => void;
}

export default function WhatsAppLinkModal({
    open,
    onClose,
    onSuccess,
}: WhatsAppLinkModalProps) {
    const [step, setStep] = useState<'loading' | 'send_message' | 'confirm' | 'success'>('loading');
    const [token, setToken] = useState('');
    const [waDirectUrl, setWaDirectUrl] = useState('');
    const [linkingMessage, setLinkingMessage] = useState('');
    const [businessPhone, setBusinessPhone] = useState('');
    const [maskedPhone, setMaskedPhone] = useState('');
    const [challengeId, setChallengeId] = useState('');
    const [orderUpdatesOptIn, setOrderUpdatesOptIn] = useState(true);
    const [secondsLeft, setSecondsLeft] = useState(300);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);

    const stopPolling = useCallback(() => {
        if (pollingIntervalRef.current) {
            clearInterval(pollingIntervalRef.current);
            pollingIntervalRef.current = null;
        }
    }, []);

    // 1. Initiate linking challenge from server
    const initiateChallenge = useCallback(async () => {
        setLoading(true);
        setError(null);
        setStep('loading');
        stopPolling();

        try {
            const { data: sessionData } = await supabase.auth.getSession();
            const authToken = sessionData?.session?.access_token;
            if (!authToken) {
                throw new Error('Please log in to link WhatsApp.');
            }

            const res = await fetch('/api/customer/whatsapp/challenge', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${authToken}`,
                },
                body: JSON.stringify({ orderUpdatesOptIn }),
            });

            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || 'Failed to create WhatsApp linking code.');
            }

            setToken(data.token);
            setWaDirectUrl(data.waDirectUrl);
            setLinkingMessage(data.linkingMessage);
            setBusinessPhone(data.businessPhone);
            setChallengeId(data.challengeId);
            setSecondsLeft(300);
            setStep('send_message');
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Error starting WhatsApp linking.';
            setError(msg);
        } finally {
            setLoading(false);
        }
    }, [orderUpdatesOptIn, stopPolling]);

    // Check link status periodically when in 'send_message' step
    const checkStatus = useCallback(async () => {
        try {
            const { data: sessionData } = await supabase.auth.getSession();
            const authToken = sessionData?.session?.access_token;
            if (!authToken) return;

            const res = await fetch('/api/customer/whatsapp/status', {
                headers: { Authorization: `Bearer ${authToken}` },
            });
            if (!res.ok) return;

            const data = await res.json();
            if (data.status === 'awaiting_confirmation') {
                stopPolling();
                setMaskedPhone(data.maskedPhone || data.awaitingConfirmationPhone || '');
                if (data.pendingChallengeId) setChallengeId(data.pendingChallengeId);
                setStep('confirm');
            } else if (data.status === 'connected') {
                stopPolling();
                setStep('success');
            }
        } catch {
            // Non-fatal polling error
        }
    }, [stopPolling]);

    useEffect(() => {
        if (open) {
            initiateChallenge();
        } else {
            stopPolling();
        }
        return () => stopPolling();
    }, [open, initiateChallenge, stopPolling]);

    // Countdown timer for 5-minute TTL
    useEffect(() => {
        if (step !== 'send_message' && step !== 'confirm') return;
        if (secondsLeft <= 0) return;

        const timer = setInterval(() => {
            setSecondsLeft(prev => {
                if (prev <= 1) {
                    stopPolling();
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);

        return () => clearInterval(timer);
    }, [step, secondsLeft, stopPolling]);

    // Start polling once send_message step is active
    useEffect(() => {
        if (step === 'send_message' && secondsLeft > 0) {
            pollingIntervalRef.current = setInterval(checkStatus, 2500);
        }
        return () => stopPolling();
    }, [step, secondsLeft, checkStatus, stopPolling]);

    // Confirm connection
    const handleConfirm = async () => {
        setLoading(true);
        setError(null);
        try {
            const { data: sessionData } = await supabase.auth.getSession();
            const authToken = sessionData?.session?.access_token;
            if (!authToken) throw new Error('Not authenticated.');

            const res = await fetch('/api/customer/whatsapp/confirm', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${authToken}`,
                },
                body: JSON.stringify({ challengeId }),
            });

            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || 'Failed to confirm connection.');
            }

            setStep('success');
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Confirmation failed.';
            setError(msg);
        } finally {
            setLoading(false);
        }
    };

    const handleCopy = () => {
        if (!linkingMessage) return;
        navigator.clipboard.writeText(linkingMessage);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const formatCountdown = (totalSeconds: number) => {
        const m = Math.floor(totalSeconds / 60);
        const s = totalSeconds % 60;
        return `${m}:${s.toString().padStart(2, '0')}`;
    };

    if (!open) return null;

    return (
        <div
            className="modal-overlay"
            style={{
                position: 'fixed',
                inset: 0,
                backgroundColor: 'rgba(0, 0, 0, 0.65)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 1000,
                padding: '16px',
            }}
            onClick={e => {
                if (e.target === e.currentTarget) onClose();
            }}
        >
            <div
                className="modal-content card"
                style={{
                    width: '100%',
                    maxWidth: '460px',
                    borderRadius: '16px',
                    overflow: 'hidden',
                    background: 'var(--bg)',
                    border: '1px solid var(--border)',
                    boxShadow: '0 20px 40px rgba(0, 0, 0, 0.2)',
                    display: 'flex',
                    flexDirection: 'column',
                }}
            >
                {/* Header */}
                <div
                    style={{
                        padding: '18px 22px',
                        borderBottom: '1px solid var(--border)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                    }}
                >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div
                            style={{
                                width: '32px',
                                height: '32px',
                                borderRadius: '8px',
                                background: 'rgba(22, 163, 74, 0.1)',
                                color: '#16a34a',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                            }}
                        >
                            <MessageCircle size={18} />
                        </div>
                        <h3 style={{ fontSize: '16px', fontWeight: '800', margin: 0 }}>
                            {step === 'success' ? 'Connected!' : 'Connect WhatsApp'}
                        </h3>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="btn-ghost"
                        style={{ padding: '6px', borderRadius: '8px', border: 'none', background: 'none', cursor: 'pointer', color: 'var(--fg-muted)' }}
                        aria-label="Close"
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* Body */}
                <div style={{ padding: '22px' }}>
                    {error && (
                        <div
                            style={{
                                padding: '12px 14px',
                                borderRadius: '8px',
                                background: 'rgba(239, 68, 68, 0.1)',
                                border: '1px solid rgba(239, 68, 68, 0.25)',
                                color: '#ef4444',
                                fontSize: '13px',
                                display: 'flex',
                                alignItems: 'flex-start',
                                gap: '8px',
                                marginBottom: '16px',
                            }}
                        >
                            <AlertCircle size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
                            <span>{error}</span>
                        </div>
                    )}

                    {step === 'loading' && (
                        <div style={{ padding: '36px 0', textAlign: 'center' }}>
                            <div className="spinner" style={{ width: '28px', height: '28px', margin: '0 auto 14px auto' }} />
                            <p style={{ fontSize: '14px', color: 'var(--fg-muted)', margin: 0 }}>
                                Generating secure WhatsApp challenge...
                            </p>
                        </div>
                    )}

                    {step === 'send_message' && (
                        <div>
                            <p style={{ fontSize: '14px', color: 'var(--fg-muted)', lineHeight: '1.5', margin: '0 0 16px 0' }}>
                                Send a prepared message from your WhatsApp to XerService’s verified business assistant to associate your chat for 1-tap document printing.
                            </p>

                            {/* Challenge Code Display */}
                            <div
                                style={{
                                    padding: '14px',
                                    borderRadius: '10px',
                                    background: 'var(--bg-secondary)',
                                    border: '1px solid var(--border)',
                                    marginBottom: '16px',
                                }}
                            >
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                                    <span style={{ fontSize: '11px', fontWeight: '700', color: 'var(--fg-muted)', textTransform: 'uppercase' }}>
                                        Verification Message
                                    </span>
                                    <span style={{ fontSize: '12px', fontWeight: '700', color: secondsLeft < 60 ? '#ef4444' : 'var(--fg-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                        <Clock size={12} /> {formatCountdown(secondsLeft)}
                                    </span>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
                                    <code style={{ fontSize: '16px', fontWeight: '900', letterSpacing: '0.05em', color: 'var(--accent)' }}>
                                        {linkingMessage}
                                    </code>
                                    <button
                                        type="button"
                                        onClick={handleCopy}
                                        className="btn btn-outline btn-sm"
                                        style={{ fontSize: '11px', padding: '4px 10px', display: 'flex', alignItems: 'center', gap: '4px' }}
                                    >
                                        {copied ? <Check size={12} color="#16a34a" /> : <Copy size={12} />}
                                        <span>{copied ? 'Copied' : 'Copy'}</span>
                                    </button>
                                </div>
                            </div>

                            {/* Notification Consent Checkbox */}
                            <label
                                style={{
                                    display: 'flex',
                                    alignItems: 'flex-start',
                                    gap: '10px',
                                    fontSize: '13px',
                                    color: 'var(--fg)',
                                    marginBottom: '18px',
                                    cursor: 'pointer',
                                }}
                            >
                                <input
                                    type="checkbox"
                                    checked={orderUpdatesOptIn}
                                    onChange={e => setOrderUpdatesOptIn(e.target.checked)}
                                    style={{ marginTop: '2px' }}
                                />
                                <span>Receive order status notifications and print receipts via WhatsApp</span>
                            </label>

                            {/* Action Button */}
                            {secondsLeft > 0 ? (
                                <a
                                    href={waDirectUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="btn btn-accent"
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        gap: '8px',
                                        width: '100%',
                                        padding: '12px',
                                        borderRadius: '10px',
                                        textDecoration: 'none',
                                        background: '#16a34a',
                                        borderColor: '#16a34a',
                                        color: '#ffffff',
                                        fontWeight: '800',
                                        fontSize: '14px',
                                    }}
                                >
                                    <MessageCircle size={18} />
                                    <span>Send WhatsApp Message</span>
                                    <ExternalLink size={14} />
                                </a>
                            ) : (
                                <button
                                    type="button"
                                    onClick={initiateChallenge}
                                    className="btn btn-outline"
                                    style={{ width: '100%', padding: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                                >
                                    <RotateCw size={16} />
                                    <span>Code Expired — Generate New Code</span>
                                </button>
                            )}

                            {/* Polling Indicator */}
                            <div
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: '8px',
                                    marginTop: '16px',
                                    fontSize: '12px',
                                    color: 'var(--fg-muted)',
                                }}
                            >
                                <span
                                    style={{
                                        width: '8px',
                                        height: '8px',
                                        borderRadius: '50%',
                                        background: secondsLeft > 0 ? '#16a34a' : 'var(--border)',
                                        animation: secondsLeft > 0 ? 'pulse 1.5s infinite' : 'none',
                                    }}
                                />
                                <span>
                                    {secondsLeft > 0
                                        ? 'Listening for incoming WhatsApp verification message...'
                                        : 'Session expired.'}
                                </span>
                            </div>
                        </div>
                    )}

                    {step === 'confirm' && (
                        <div>
                            <div
                                style={{
                                    padding: '16px',
                                    borderRadius: '10px',
                                    background: 'rgba(22, 163, 74, 0.08)',
                                    border: '1px solid rgba(22, 163, 74, 0.25)',
                                    marginBottom: '16px',
                                }}
                            >
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                                    <ShieldCheck size={18} color="#16a34a" />
                                    <span style={{ fontWeight: '800', fontSize: '13px', color: '#16a34a' }}>
                                        Message Received
                                    </span>
                                </div>
                                <p style={{ fontSize: '13px', color: 'var(--fg)', margin: 0 }}>
                                    A verification message was received from <strong>{maskedPhone}</strong>. Confirm below to complete linking.
                                </p>
                            </div>

                            <div style={{ display: 'flex', gap: '10px' }}>
                                <button
                                    type="button"
                                    onClick={handleConfirm}
                                    disabled={loading}
                                    className="btn btn-accent"
                                    style={{
                                        flex: 1,
                                        padding: '12px',
                                        fontWeight: '800',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        gap: '6px',
                                    }}
                                >
                                    {loading ? 'Confirming...' : 'Confirm & Link WhatsApp'}
                                    <ArrowRight size={16} />
                                </button>
                                <button
                                    type="button"
                                    onClick={onClose}
                                    className="btn btn-outline"
                                    style={{ padding: '12px 18px' }}
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    )}

                    {step === 'success' && (
                        <div style={{ textAlign: 'center', padding: '16px 0' }}>
                            <div
                                style={{
                                    width: '54px',
                                    height: '54px',
                                    borderRadius: '50%',
                                    background: 'rgba(22, 163, 74, 0.1)',
                                    color: '#16a34a',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    margin: '0 auto 16px auto',
                                }}
                            >
                                <CheckCircle2 size={32} />
                            </div>
                            <h4 style={{ fontSize: '18px', fontWeight: '900', margin: '0 0 6px 0', color: 'var(--fg)' }}>
                                WhatsApp Connected!
                            </h4>
                            <p style={{ fontSize: '13px', color: 'var(--fg-muted)', margin: '0 0 20px 0', lineHeight: '1.5' }}>
                                Your WhatsApp number is securely linked to your XerService account. Documents you share with XerService will now automatically appear in your cart.
                            </p>
                            <button
                                type="button"
                                onClick={() => {
                                    onSuccess();
                                    onClose();
                                }}
                                className="btn btn-accent"
                                style={{ width: '100%', padding: '12px', fontWeight: '800' }}
                            >
                                Done
                            </button>
                        </div>
                    )}
                </div>
            </div>

            <style>{`
                @keyframes pulse {
                    0% { opacity: 0.4; }
                    50% { opacity: 1; }
                    100% { opacity: 0.4; }
                }
            `}</style>
        </div>
    );
}

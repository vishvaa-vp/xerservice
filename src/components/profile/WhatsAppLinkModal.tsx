'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    AlertCircle,
    ArrowRight,
    Check,
    CheckCircle2,
    Clock,
    Copy,
    ExternalLink,
    MessageCircle,
    RotateCw,
    ShieldCheck,
    X,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';

interface WhatsAppLinkModalProps {
    open: boolean;
    onClose: () => void;
    onSuccess: () => void;
}

type LinkStep = 'start' | 'loading' | 'send_message' | 'confirm' | 'success' | 'error';

export default function WhatsAppLinkModal({
    open,
    onClose,
    onSuccess,
}: WhatsAppLinkModalProps) {
    const [step, setStep] = useState<LinkStep>('start');
    const [waDirectUrl, setWaDirectUrl] = useState('');
    const [linkingMessage, setLinkingMessage] = useState('');
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

    useEffect(() => {
        if (!open) {
            stopPolling();
            return;
        }

        setStep('start');
        setWaDirectUrl('');
        setLinkingMessage('');
        setMaskedPhone('');
        setChallengeId('');
        setSecondsLeft(300);
        setError(null);
        setCopied(false);

        return () => stopPolling();
    }, [open, stopPolling]);

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

            setWaDirectUrl(data.waDirectUrl || '');
            setLinkingMessage(data.linkingMessage || '');
            setChallengeId(data.challengeId || '');
            setSecondsLeft(300);
            setStep('send_message');
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Unable to start WhatsApp linking.');
            setStep('error');
        } finally {
            setLoading(false);
        }
    }, [orderUpdatesOptIn, stopPolling]);

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
                onSuccess();
            }
        } catch {
            // Polling errors are non-fatal. The next poll will retry.
        }
    }, [onSuccess, stopPolling]);

    useEffect(() => {
        if (step !== 'send_message') return;

        // Check immediately, then poll every 2.5 seconds. Do not depend on
        // secondsLeft here: it changes every second and would clear the
        // interval before the first poll can run.
        void checkStatus();
        pollingIntervalRef.current = setInterval(checkStatus, 2500);
        return () => stopPolling();
    }, [step, checkStatus, stopPolling]);

    useEffect(() => {
        if (secondsLeft <= 0) {
            stopPolling();
        }
    }, [secondsLeft, stopPolling]);

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

    const handleConfirm = async () => {
        setLoading(true);
        setError(null);

        try {
            const { data: sessionData } = await supabase.auth.getSession();
            const authToken = sessionData?.session?.access_token;

            if (!authToken) {
                throw new Error('Please log in again.');
            }

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
                throw new Error(data.error || 'Failed to confirm WhatsApp connection.');
            }

            stopPolling();
            setStep('success');
            onSuccess();
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'WhatsApp confirmation failed.');
        } finally {
            setLoading(false);
        }
    };

    const handleCopy = async () => {
        if (!linkingMessage) return;
        await navigator.clipboard.writeText(linkingMessage);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const formatCountdown = (totalSeconds: number) => {
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
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
            onClick={event => {
                if (event.target === event.currentTarget) onClose();
            }}
        >
            <div
                className="modal-content card"
                style={{
                    width: '100%',
                    maxWidth: '480px',
                    borderRadius: '16px',
                    overflow: 'hidden',
                    background: 'var(--bg)',
                    border: '1px solid var(--border)',
                    boxShadow: '0 20px 40px rgba(0, 0, 0, 0.2)',
                }}
            >
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
                        <h3 style={{ fontSize: '16px', fontWeight: 800, margin: 0 }}>
                            {step === 'success' ? 'WhatsApp Connected' : 'Connect WhatsApp'}
                        </h3>
                    </div>

                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Close"
                        style={{
                            padding: '6px',
                            borderRadius: '8px',
                            border: 'none',
                            background: 'none',
                            cursor: 'pointer',
                            color: 'var(--fg-muted)',
                        }}
                    >
                        <X size={18} />
                    </button>
                </div>

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

                    {step === 'start' && (
                        <div>
                            <h4 style={{ fontSize: '18px', fontWeight: 800, margin: '0 0 8px' }}>
                                Link your WhatsApp number
                            </h4>
                            <p style={{ fontSize: '14px', color: 'var(--fg-muted)', lineHeight: 1.55, margin: '0 0 18px' }}>
                                XerService will create a secure one-time message. Send that message from your WhatsApp number to the XerService business number to link your account.
                            </p>

                            <label
                                style={{
                                    display: 'flex',
                                    alignItems: 'flex-start',
                                    gap: '10px',
                                    fontSize: '13px',
                                    marginBottom: '18px',
                                    cursor: 'pointer',
                                }}
                            >
                                <input
                                    type="checkbox"
                                    checked={orderUpdatesOptIn}
                                    onChange={event => setOrderUpdatesOptIn(event.target.checked)}
                                    style={{ marginTop: '2px' }}
                                />
                                <span>Receive order status updates and receipts through WhatsApp</span>
                            </label>

                            <button
                                type="button"
                                onClick={initiateChallenge}
                                disabled={loading}
                                className="btn btn-accent"
                                style={{ width: '100%', padding: '12px', fontWeight: 800 }}
                            >
                                Continue
                            </button>
                        </div>
                    )}

                    {step === 'loading' && (
                        <div style={{ padding: '34px 0', textAlign: 'center' }}>
                            <div className="spinner" style={{ width: '28px', height: '28px', margin: '0 auto 14px' }} />
                            <p style={{ fontSize: '14px', color: 'var(--fg-muted)', margin: 0 }}>
                                Creating your secure WhatsApp link...
                            </p>
                        </div>
                    )}

                    {step === 'send_message' && (
                        <div>
                            <p style={{ fontSize: '14px', color: 'var(--fg-muted)', lineHeight: 1.55, margin: '0 0 16px' }}>
                                Send this prepared message from the WhatsApp number you want to link.
                            </p>

                            <div
                                style={{
                                    padding: '14px',
                                    borderRadius: '10px',
                                    background: 'var(--bg-secondary)',
                                    border: '1px solid var(--border)',
                                    marginBottom: '16px',
                                }}
                            >
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                                    <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--fg-muted)', textTransform: 'uppercase' }}>
                                        Verification message
                                    </span>
                                    <span style={{ fontSize: '12px', fontWeight: 700, color: secondsLeft < 60 ? '#ef4444' : 'var(--fg-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                        <Clock size={12} />
                                        {formatCountdown(secondsLeft)}
                                    </span>
                                </div>

                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
                                    <code style={{ fontSize: '15px', fontWeight: 900, color: 'var(--accent)', wordBreak: 'break-all' }}>
                                        {linkingMessage}
                                    </code>
                                    <button
                                        type="button"
                                        onClick={handleCopy}
                                        className="btn btn-outline btn-sm"
                                        style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: '4px' }}
                                    >
                                        {copied ? <Check size={12} /> : <Copy size={12} />}
                                        {copied ? 'Copied' : 'Copy'}
                                    </button>
                                </div>
                            </div>

                            {secondsLeft > 0 ? (
                                <a
                                    href={waDirectUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="btn btn-accent"
                                    style={{
                                        width: '100%',
                                        padding: '12px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        gap: '8px',
                                        textDecoration: 'none',
                                        fontWeight: 800,
                                        background: '#16a34a',
                                        borderColor: '#16a34a',
                                        color: '#fff',
                                    }}
                                >
                                    <MessageCircle size={18} />
                                    Send WhatsApp Message
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
                                    Generate New Code
                                </button>
                            )}

                            <div style={{ marginTop: '14px', textAlign: 'center', fontSize: '12px', color: 'var(--fg-muted)' }}>
                                Listening for your verification message...
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
                                    <strong style={{ color: '#16a34a', fontSize: '13px' }}>Message received</strong>
                                </div>
                                <p style={{ fontSize: '13px', margin: 0 }}>
                                    Verification received from <strong>{maskedPhone || 'your WhatsApp number'}</strong>.
                                </p>
                            </div>

                            <button
                                type="button"
                                onClick={handleConfirm}
                                disabled={loading}
                                className="btn btn-accent"
                                style={{ width: '100%', padding: '12px', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                            >
                                {loading ? 'Confirming...' : 'Confirm & Link WhatsApp'}
                                <ArrowRight size={16} />
                            </button>
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
                                    margin: '0 auto 16px',
                                }}
                            >
                                <CheckCircle2 size={32} />
                            </div>

                            <h4 style={{ fontSize: '18px', fontWeight: 900, margin: '0 0 6px' }}>
                                WhatsApp Connected
                            </h4>
                            <p style={{ fontSize: '13px', color: 'var(--fg-muted)', lineHeight: 1.5, margin: '0 0 20px' }}>
                                Your WhatsApp number is linked to XerService. Documents sent to XerService on WhatsApp can now be imported securely.
                            </p>

                            <button
                                type="button"
                                onClick={onClose}
                                className="btn btn-accent"
                                style={{ width: '100%', padding: '12px', fontWeight: 800 }}
                            >
                                Done
                            </button>
                        </div>
                    )}

                    {step === 'error' && (
                        <div style={{ textAlign: 'center' }}>
                            <p style={{ fontSize: '13px', color: 'var(--fg-muted)', marginBottom: '16px' }}>
                                XerService could not start WhatsApp linking.
                            </p>
                            <button
                                type="button"
                                onClick={() => {
                                    setError(null);
                                    setStep('start');
                                }}
                                className="btn btn-outline"
                                style={{ width: '100%', padding: '12px' }}
                            >
                                Try Again
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

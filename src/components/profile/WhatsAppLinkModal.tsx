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
    Sparkles,
    Settings,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';

const TRUSTED_META_ORIGINS = new Set([
    'https://www.facebook.com',
    'https://web.facebook.com',
]);

declare global {
    interface Window {
        FB?: {
            init: (options: Record<string, unknown>) => void;
            login: (
                callback: (response: {
                    status?: string;
                    authResponse?: {
                        code?: string;
                        [key: string]: unknown;
                    };
                    [key: string]: unknown;
                }) => void,
                options: Record<string, unknown>
            ) => void;
        };
        fbAsyncInit?: () => void;
    }
}

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
    const metaAppId = process.env.NEXT_PUBLIC_META_APP_ID || '';
    const configId = process.env.NEXT_PUBLIC_WHATSAPP_CONFIG_ID || '';
    const isMetaConfigured = Boolean(metaAppId && configId);

    const [step, setStep] = useState<
        'embedded_signup' | 'config_advisory' | 'loading' | 'send_message' | 'confirm' | 'success' | 'error'
    >('embedded_signup');
    const [sdkLoaded, setSdkLoaded] = useState(false);
    const [sdkReady, setSdkReady] = useState(false);
    const [isLaunchingMeta, setIsLaunchingMeta] = useState(false);
    const [token, setToken] = useState('');
    const [waDirectUrl, setWaDirectUrl] = useState('');
    const [linkingMessage, setLinkingMessage] = useState('');
    const [, setBusinessPhone] = useState('');
    const [maskedPhone, setMaskedPhone] = useState('');
    const [challengeId, setChallengeId] = useState('');
    const [orderUpdatesOptIn, setOrderUpdatesOptIn] = useState(true);
    const [secondsLeft, setSecondsLeft] = useState(300);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
    const latestSessionRef = useRef<{ wabaId?: string | null; phoneNumberId?: string | null; eventType?: string | null }>({});

    const stopPolling = useCallback(() => {
        if (pollingIntervalRef.current) {
            clearInterval(pollingIntervalRef.current);
            pollingIntervalRef.current = null;
        }
    }, []);

    // 1. Initialize Meta / Facebook SDK for Embedded Signup
    const initFacebookSdk = useCallback(() => {
        if (!metaAppId) return;

        if (typeof window !== 'undefined' && window.FB) {
            try {
                window.FB.init({
                    appId: metaAppId,
                    cookie: true,
                    xfbml: true,
                    version: 'v26.0',
                });
                setSdkReady(true);
            } catch (err) {
                console.error('[WhatsAppLinkModal] FB.init error:', err);
            }
        }
    }, [metaAppId]);

    // Load Meta SDK dynamically when modal is open and Meta is configured
    useEffect(() => {
        if (!open) return;

        if (!isMetaConfigured) {
            setStep('config_advisory');
            return;
        }

        setStep('embedded_signup');

        if (typeof window !== 'undefined') {
            window.fbAsyncInit = function () {
                initFacebookSdk();
            };

            if (window.FB) {
                setSdkLoaded(true);
                initFacebookSdk();
                return;
            }

            if (!document.getElementById('meta-fb-jssdk')) {
                const script = document.createElement('script');
                script.id = 'meta-fb-jssdk';
                script.src = 'https://connect.facebook.net/en_US/sdk.js';
                script.async = true;
                script.defer = true;
                script.onload = () => {
                    setSdkLoaded(true);
                    initFacebookSdk();
                };
                script.onerror = () => {
                    console.warn('[WhatsAppLinkModal] Meta SDK script could not be loaded from connect.facebook.net');
                };
                document.body.appendChild(script);
            }
        }
    }, [open, isMetaConfigured, initFacebookSdk]);

    // Listen for Meta postMessage events during Embedded Signup
    useEffect(() => {
        if (!open) return;

        const handleMessage = (event: MessageEvent) => {
            if (!TRUSTED_META_ORIGINS.has(event.origin)) return;

            let parsed: any = null;
            try {
                parsed = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
            } catch {
                return;
            }

            if (!parsed || parsed.type !== 'WA_EMBEDDED_SIGNUP') return;

            const eventType = parsed.event || 'UNKNOWN_EVENT';
            const eventData = parsed.data || {};
            const wabaId = eventData.waba_id || null;
            const phoneNumberId = eventData.phone_number_id || null;

            latestSessionRef.current = { wabaId, phoneNumberId, eventType };
        };

        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, [open]);

    // 2. Launch Meta Embedded Signup for Coexistence
    const handleLaunchMetaSignup = () => {
        if (!isMetaConfigured) {
            setError('Meta Embedded Signup configuration is missing.');
            return;
        }

        if (!window.FB) {
            setError('Facebook SDK is loading. Please wait a moment and try again.');
            return;
        }

        setIsLaunchingMeta(true);
        setError(null);

        window.FB.login(
            function (response) {
                setIsLaunchingMeta(false);

                if (response?.authResponse?.code) {
                    const authCode = response.authResponse.code;
                    sendMetaCodeToServer(authCode, latestSessionRef.current);
                } else {
                    console.info('[WhatsAppLinkModal] User dismissed or cancelled Meta dialog.');
                }
            },
            {
                config_id: configId,
                response_type: 'code',
                override_default_response_type: true,
                extras: {
                    setup: {},
                    featureType: 'whatsapp_business_app_onboarding',
                },
            }
        );
    };

    // 3. Send authorization code to server callback
    const sendMetaCodeToServer = async (
        authCode: string,
        sessionInfo?: { wabaId?: string | null; phoneNumberId?: string | null; eventType?: string | null }
    ) => {
        setLoading(true);
        setError(null);

        try {
            const { data: sessionData } = await supabase.auth.getSession();
            const authToken = sessionData?.session?.access_token;
            if (!authToken) {
                throw new Error('Please sign in to connect WhatsApp.');
            }

            const res = await fetch('/api/whatsapp/embedded-signup/callback', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${authToken}`,
                },
                body: JSON.stringify({
                    code: authCode,
                    wabaId: sessionInfo?.wabaId || latestSessionRef.current.wabaId || null,
                    phoneNumberId: sessionInfo?.phoneNumberId || latestSessionRef.current.phoneNumberId || null,
                    eventType: sessionInfo?.eventType || latestSessionRef.current.eventType || null,
                }),
            });

            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || 'Server could not complete Meta WhatsApp connection.');
            }

            setStep('success');
            onSuccess();
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Failed to finalize WhatsApp connection.';
            setError(msg);
        } finally {
            setLoading(false);
        }
    };

    // 4. Fallback customer linking challenge
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
            setStep('error');
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

    // Confirm connection for verification message flow
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
                    maxWidth: '480px',
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

                    {/* Step: Meta Embedded Signup (Primary Coexistence Flow) */}
                    {step === 'embedded_signup' && (
                        <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                                <Sparkles size={16} color="#16a34a" />
                                <span style={{ fontSize: '13px', fontWeight: '800', color: '#16a34a', textTransform: 'uppercase' }}>
                                    Meta WhatsApp Coexistence
                                </span>
                            </div>
                            <p style={{ fontSize: '14px', color: 'var(--fg-muted)', lineHeight: '1.5', margin: '0 0 16px 0' }}>
                                Connect your existing WhatsApp Business App number to XerService. Meta’s official Embedded Signup pairs your business number with Cloud API while keeping your mobile WhatsApp Business app active.
                            </p>

                            <div
                                style={{
                                    padding: '14px',
                                    borderRadius: '10px',
                                    background: 'var(--bg-secondary)',
                                    border: '1px solid var(--border)',
                                    marginBottom: '20px',
                                    fontSize: '12px',
                                    lineHeight: '1.6',
                                    color: 'var(--fg-muted)',
                                }}
                            >
                                <div style={{ fontWeight: '700', color: 'var(--fg)', marginBottom: '4px' }}>
                                    How it works:
                                </div>
                                <div>1. Click below to open Meta’s secure login modal.</div>
                                <div>2. Select your WhatsApp Business App phone number.</div>
                                <div>3. Authorization is securely exchanged on the server.</div>
                            </div>

                            <button
                                type="button"
                                onClick={handleLaunchMetaSignup}
                                disabled={isLaunchingMeta || loading}
                                className="btn btn-accent"
                                style={{
                                    width: '100%',
                                    padding: '14px',
                                    borderRadius: '10px',
                                    background: '#16a34a',
                                    borderColor: '#16a34a',
                                    color: '#ffffff',
                                    fontWeight: '800',
                                    fontSize: '15px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: '10px',
                                    cursor: isLaunchingMeta || loading ? 'not-allowed' : 'pointer',
                                    boxShadow: '0 4px 14px rgba(22, 163, 74, 0.3)',
                                }}
                            >
                                <MessageCircle size={18} />
                                <span>
                                    {isLaunchingMeta
                                        ? 'Opening Meta Signup...'
                                        : loading
                                        ? 'Connecting...'
                                        : !sdkReady && !sdkLoaded
                                        ? 'Loading Meta SDK...'
                                        : 'Connect with WhatsApp'}
                                </span>
                            </button>

                            <p style={{ fontSize: '11px', color: 'var(--fg-subtle)', textAlign: 'center', marginTop: '12px', marginBottom: 0 }}>
                                Powered by Meta WhatsApp Cloud API. No phone number configuration required prior to signup.
                            </p>
                        </div>
                    )}

                    {/* Step: Configuration Advisory (When Meta App ID or Config ID are not configured) */}
                    {step === 'config_advisory' && (
                        <div>
                            <div
                                style={{
                                    padding: '16px',
                                    borderRadius: '12px',
                                    background: 'rgba(234, 179, 8, 0.08)',
                                    border: '1px solid rgba(234, 179, 8, 0.25)',
                                    marginBottom: '16px',
                                }}
                            >
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                                    <Settings size={16} color="#eab308" />
                                    <strong style={{ fontSize: '13px', color: '#eab308' }}>
                                        Meta Embedded Signup Configuration Required
                                    </strong>
                                </div>
                                <p style={{ fontSize: '13px', color: 'var(--fg)', margin: '0 0 10px 0', lineHeight: '1.5' }}>
                                    To enable WhatsApp Business App + Cloud API Coexistence, configure the following variables in your Vercel Project Settings:
                                </p>
                                <div style={{ fontFamily: 'monospace', fontSize: '12px', color: 'var(--fg-muted)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                    <div>• <code>NEXT_PUBLIC_META_APP_ID</code></div>
                                    <div>• <code>NEXT_PUBLIC_WHATSAPP_CONFIG_ID</code></div>
                                    <div>• <code>META_APP_SECRET</code></div>
                                    <div>• <code>WHATSAPP_ACCESS_TOKEN</code></div>
                                </div>
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                <button
                                    type="button"
                                    onClick={initiateChallenge}
                                    className="btn btn-outline"
                                    style={{ width: '100%', padding: '12px', fontSize: '13px', fontWeight: '700' }}
                                >
                                    Try Message-Based Linking Challenge
                                </button>
                                <button
                                    type="button"
                                    onClick={onClose}
                                    className="btn btn-ghost"
                                    style={{ width: '100%', padding: '10px', fontSize: '13px' }}
                                >
                                    Close
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Step: Error state */}
                    {step === 'error' && (
                        <div style={{ textAlign: 'center', padding: '12px 0' }}>
                            <p style={{ fontSize: '13px', color: 'var(--fg-muted)', marginBottom: '16px' }}>
                                WhatsApp connection could not be initiated with the current configuration.
                            </p>
                            <div style={{ display: 'flex', gap: '10px' }}>
                                {isMetaConfigured && (
                                    <button
                                        type="button"
                                        onClick={() => { setError(null); setStep('embedded_signup'); }}
                                        className="btn btn-accent"
                                        style={{ flex: 1, padding: '10px' }}
                                    >
                                        Try Meta Embedded Signup
                                    </button>
                                )}
                                <button
                                    type="button"
                                    onClick={onClose}
                                    className="btn btn-outline"
                                    style={{ flex: 1, padding: '10px' }}
                                >
                                    Close
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Step: Loading */}
                    {step === 'loading' && (
                        <div style={{ padding: '36px 0', textAlign: 'center' }}>
                            <div className="spinner" style={{ width: '28px', height: '28px', margin: '0 auto 14px auto' }} />
                            <p style={{ fontSize: '14px', color: 'var(--fg-muted)', margin: 0 }}>
                                Initializing secure WhatsApp connection...
                            </p>
                        </div>
                    )}

                    {/* Step: Send Message Challenge */}
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

                    {/* Step: Confirm Connection */}
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

                    {/* Step: Success */}
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

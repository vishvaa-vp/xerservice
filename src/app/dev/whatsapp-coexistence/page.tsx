'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import Script from 'next/script';
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

interface CapturedEvent {
    timestamp: string;
    event: string;
    wabaId?: string | null;
    phoneNumberId?: string | null;
    rawType?: string;
}

export default function WhatsAppCoexistenceDevPage() {
    const metaAppId = process.env.NEXT_PUBLIC_META_APP_ID || '';
    const configId = process.env.NEXT_PUBLIC_WHATSAPP_CONFIG_ID || '';

    const [sdkLoaded, setSdkLoaded] = useState(false);
    const [sdkInitialized, setSdkInitialized] = useState(false);
    const [sdkError, setSdkError] = useState<string | null>(null);
    const [isLaunching, setIsLaunching] = useState(false);
    const [capturedEvents, setCapturedEvents] = useState<CapturedEvent[]>([]);
    const [coexistenceCompleted, setCoexistenceCompleted] = useState(false);
    const [serverCallbackStatus, setServerCallbackStatus] = useState<{
        status: 'idle' | 'sending' | 'success' | 'error';
        message?: string;
        details?: Record<string, unknown>;
    }>({ status: 'idle' });

    // Store latest session info in refs for callback submission
    const latestSessionRef = useRef<{ wabaId?: string | null; phoneNumberId?: string | null; eventType?: string | null }>({});

    // 1. Initialize Facebook JavaScript SDK when loaded
    const initFacebookSdk = useCallback(() => {
        if (!metaAppId) {
            return;
        }

        if (typeof window !== 'undefined' && window.FB) {
            try {
                window.FB.init({
                    appId: metaAppId,
                    cookie: true,
                    xfbml: true,
                    version: 'v26.0',
                });
                setSdkInitialized(true);
                setSdkError(null);
            } catch (err) {
                const errMsg = err instanceof Error ? err.message : 'FB.init execution failed';
                setSdkError(`FB.init error: ${errMsg}`);
            }
        }
    }, [metaAppId]);

    // Handle script load success
    const handleScriptLoad = () => {
        setSdkLoaded(true);
        setSdkError(null);
        initFacebookSdk();
    };

    // Handle script load error
    const handleScriptError = (err: unknown) => {
        void err;
        setSdkError('Failed to load SDK script from connect.facebook.net. This is usually caused by Content-Security-Policy restrictions (ensure next.config.js is updated and pnpm dev is restarted) or a browser ad blocker.');
    };

    // Fallback detection & pre-declare fbAsyncInit
    useEffect(() => {
        if (typeof window !== 'undefined') {
            window.fbAsyncInit = function () {
                initFacebookSdk();
            };
            if (window.FB) {
                setSdkLoaded(true);
                setSdkError(null);
                initFacebookSdk();
                return;
            }
        }

        // Detect if script loading hung or was silently blocked
        const timer = setTimeout(() => {
            if (typeof window !== 'undefined' && !window.FB && !sdkInitialized) {
                setSdkError('Facebook SDK load timed out (7s). connect.facebook.net may be blocked by CSP (requires dev server restart after next.config.js edit) or an active ad-blocker.');
            }
        }, 7000);

        return () => clearTimeout(timer);
    }, [initFacebookSdk, sdkInitialized]);

    // Retry script loading
    const retryLoadSdk = () => {
        setSdkError(null);
        setSdkLoaded(false);
        setSdkInitialized(false);
        if (typeof window !== 'undefined' && window.FB) {
            initFacebookSdk();
            return;
        }
        const existingScript = document.getElementById('fb-sdk-script');
        if (existingScript) {
            existingScript.remove();
        }
        const script = document.createElement('script');
        script.id = 'fb-sdk-script';
        script.src = 'https://connect.facebook.net/en_US/sdk.js';
        script.async = true;
        script.defer = true;
        script.onload = () => handleScriptLoad();
        script.onerror = (e) => handleScriptError(e);
        document.body.appendChild(script);
    };

    // 2. Send authorization code to server-side endpoint
    const sendCodeToServer = async (authCode: string, extraSession?: { wabaId?: string | null; phoneNumberId?: string | null; eventType?: string | null }) => {
        setServerCallbackStatus({ status: 'sending', message: 'Sending authorization code to server...' });
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session?.access_token) {
                setServerCallbackStatus({ status: 'error', message: 'Sign in with an admin account first.' });
                return;
            }

            const res = await fetch('/api/whatsapp/embedded-signup/callback', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${session.access_token}`,
                },
                body: JSON.stringify({
                    code: authCode,
                    wabaId: extraSession?.wabaId || latestSessionRef.current.wabaId || null,
                    phoneNumberId: extraSession?.phoneNumberId || latestSessionRef.current.phoneNumberId || null,
                    eventType: extraSession?.eventType || latestSessionRef.current.eventType || null,
                }),
            });

            const data = await res.json();
            if (res.ok && data.success) {
                setServerCallbackStatus({
                    status: 'success',
                    message: 'Authorization code successfully received by server!',
                    details: data,
                });
            } else {
                setServerCallbackStatus({
                    status: 'error',
                    message: data.error || 'Server rejected callback.',
                    details: data,
                });
            }
        } catch (err) {
            setServerCallbackStatus({
                status: 'error',
                message: err instanceof Error ? err.message : 'Network error sending code to server.',
            });
        }
    };

    // 3. Listen for Meta session messages (window.addEventListener)
    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            if (!TRUSTED_META_ORIGINS.has(event.origin)) {
                return;
            }

            let parsed: any = null;
            try {
                parsed = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
            } catch {
                return;
            }

            if (!parsed || parsed.type !== 'WA_EMBEDDED_SIGNUP') {
                return;
            }

            const eventType = parsed.event || 'UNKNOWN_EVENT';
            const eventData = parsed.data || {};
            const wabaId = eventData.waba_id || null;
            const phoneNumberId = eventData.phone_number_id || null;

            // Update session ref safely (zero token/secret logging)
            latestSessionRef.current = { wabaId, phoneNumberId, eventType };

            setCapturedEvents(prev => [
                ...prev,
                {
                    timestamp: new Date().toLocaleTimeString(),
                    event: eventType,
                    wabaId,
                    phoneNumberId,
                    rawType: parsed.type,
                },
            ]);

            // Detect coexistence completion
            if (eventType === 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING') {
                setCoexistenceCompleted(true);
            }
        };

        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, []);

    // 4. Launch FB.login synchronously in response to user click
    const handleConnectClick = () => {
        if (!metaAppId) {
            alert('Missing NEXT_PUBLIC_META_APP_ID in .env.local.');
            return;
        }

        if (!configId) {
            alert('Missing NEXT_PUBLIC_WHATSAPP_CONFIG_ID in .env.local.');
            return;
        }

        if (!window.FB) {
            alert('Facebook SDK is not ready yet. Please wait a moment and try again.');
            return;
        }

        setIsLaunching(true);

        /**
         * CRITICAL: WhatsApp Business App Coexistence Configuration
         * Must specify:
         * - featureType: "whatsapp_business_app_onboarding"
         * - response_type: "code"
         * - override_default_response_type: true
         * - config_id: from NEXT_PUBLIC_WHATSAPP_CONFIG_ID
         */
        window.FB.login(
            function (response) {
                setIsLaunching(false);

                if (response?.authResponse?.code) {
                    const code = response.authResponse.code;
                    sendCodeToServer(code, latestSessionRef.current);
                }
            },
            {
                config_id: process.env.NEXT_PUBLIC_WHATSAPP_CONFIG_ID,
                response_type: 'code',
                override_default_response_type: true,
                extras: {
                    setup: {},
                    featureType: 'whatsapp_business_app_onboarding',
                },
            }
        );
    };

    const isReadyToLaunch = Boolean(metaAppId && configId && sdkInitialized);

    return (
        <>
            <Script
                id="fb-sdk-script"
                src="https://connect.facebook.net/en_US/sdk.js"
                strategy="afterInteractive"
                onLoad={handleScriptLoad}
                onError={handleScriptError}
            />

            <div style={{
                minHeight: '100vh',
                backgroundColor: '#0a0d14',
                color: '#f3f4f6',
                fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                padding: '40px 20px',
            }}>
                <div style={{
                    maxWidth: '860px',
                    margin: '0 auto',
                    backgroundColor: '#111827',
                    border: '1px solid #1f2937',
                    borderRadius: '16px',
                    padding: '32px',
                    boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5)',
                }}>
                    {/* Header */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '24px' }}>
                        <div style={{
                            width: '48px',
                            height: '48px',
                            borderRadius: '12px',
                            backgroundColor: '#059669',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '24px',
                            boxShadow: '0 0 20px rgba(5, 150, 105, 0.4)',
                        }}>
                            💬
                        </div>
                        <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <h1 style={{ fontSize: '24px', fontWeight: 700, margin: 0, color: '#ffffff' }}>
                                    WhatsApp Business App Coexistence
                                </h1>
                                <span style={{
                                    backgroundColor: '#374151',
                                    color: '#9ca3af',
                                    fontSize: '11px',
                                    fontWeight: 600,
                                    padding: '2px 8px',
                                    borderRadius: '6px',
                                    letterSpacing: '0.05em',
                                    textTransform: 'uppercase',
                                }}>
                                    Dev Only
                                </span>
                            </div>
                            <p style={{ margin: '4px 0 0', fontSize: '14px', color: '#9ca3af' }}>
                                Meta Embedded Signup configured for Coexistence (Existing WhatsApp Business App Number + Cloud API).
                            </p>
                        </div>
                    </div>

                    {/* Coexistence Warning / Instructions Banner */}
                    <div style={{
                        backgroundColor: '#1e293b',
                        borderLeft: '4px solid #3b82f6',
                        padding: '16px',
                        borderRadius: '8px',
                        marginBottom: '20px',
                        fontSize: '13px',
                        lineHeight: 1.6,
                        color: '#cbd5e1',
                    }}>
                        <strong style={{ color: '#93c5fd', display: 'block', marginBottom: '4px' }}>
                            ℹ️ Coexistence Architecture Rule
                        </strong>
                        This launch requests feature type <code>whatsapp_business_app_onboarding</code>.
                        It binds your existing WhatsApp Business App phone number to the WhatsApp Cloud API while keeping
                        the physical WhatsApp Business mobile app fully functional on your phone.
                    </div>

                    {/* SDK Error Banner */}
                    {sdkError && (
                        <div style={{
                            backgroundColor: '#450a0a',
                            border: '1px solid #dc2626',
                            borderRadius: '10px',
                            padding: '16px',
                            marginBottom: '20px',
                            fontSize: '13px',
                            color: '#fecaca',
                        }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
                                <div style={{ flex: 1 }}>
                                    <strong style={{ color: '#f87171', fontSize: '14px', display: 'block', marginBottom: '6px' }}>
                                        ⚠️ Facebook SDK Load Issue Detected
                                    </strong>
                                    <p style={{ margin: '0 0 10px 0', lineHeight: 1.5 }}>
                                        {sdkError}
                                    </p>
                                    <div style={{ fontSize: '12px', color: '#fca5a5', lineHeight: 1.6 }}>
                                        <div>• <strong>Dev Server Restart:</strong> Next.js security headers in <code>next.config.js</code> require a server restart (<code>pnpm dev</code>) to take effect.</div>
                                        <div>• <strong>Ad Blockers:</strong> Browser extensions like uBlock Origin, Privacy Badger, or Brave Shields block <code>connect.facebook.net</code> by default. Disable them for localhost / ngrok.</div>
                                    </div>
                                </div>
                                <button
                                    onClick={retryLoadSdk}
                                    style={{
                                        backgroundColor: '#dc2626',
                                        color: '#ffffff',
                                        border: 'none',
                                        borderRadius: '6px',
                                        padding: '8px 14px',
                                        fontSize: '12px',
                                        fontWeight: 600,
                                        cursor: 'pointer',
                                        whiteSpace: 'nowrap',
                                    }}
                                >
                                    Retry Loading SDK
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Environment Configuration Check */}
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                        gap: '12px',
                        marginBottom: '28px',
                    }}>
                        <div style={{
                            backgroundColor: '#1f2937',
                            padding: '16px',
                            borderRadius: '10px',
                            border: '1px solid #374151',
                        }}>
                            <div style={{ fontSize: '11px', color: '#9ca3af', textTransform: 'uppercase', fontWeight: 600 }}>
                                Meta App ID
                            </div>
                            <div style={{ fontSize: '15px', fontWeight: 600, marginTop: '4px', color: metaAppId ? '#34d399' : '#f87171' }}>
                                {metaAppId ? `App ID: ${metaAppId}` : 'Missing in .env.local'}
                            </div>
                            <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '2px' }}>
                                NEXT_PUBLIC_META_APP_ID
                            </div>
                        </div>

                        <div style={{
                            backgroundColor: '#1f2937',
                            padding: '16px',
                            borderRadius: '10px',
                            border: '1px solid #374151',
                        }}>
                            <div style={{ fontSize: '11px', color: '#9ca3af', textTransform: 'uppercase', fontWeight: 600 }}>
                                Embedded Signup Config ID
                            </div>
                            <div style={{ fontSize: '15px', fontWeight: 600, marginTop: '4px', color: configId ? '#34d399' : '#f87171' }}>
                                {configId ? `Config: ${configId}` : 'Missing in .env.local'}
                            </div>
                            <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '2px' }}>
                                NEXT_PUBLIC_WHATSAPP_CONFIG_ID
                            </div>
                        </div>

                        <div style={{
                            backgroundColor: '#1f2937',
                            padding: '16px',
                            borderRadius: '10px',
                            border: `1px solid ${sdkError ? '#ef4444' : '#374151'}`,
                        }}>
                            <div style={{ fontSize: '11px', color: '#9ca3af', textTransform: 'uppercase', fontWeight: 600 }}>
                                Facebook JS SDK
                            </div>
                            <div style={{
                                fontSize: '15px',
                                fontWeight: 600,
                                marginTop: '4px',
                                color: sdkInitialized ? '#34d399' : sdkError ? '#f87171' : '#fbbf24',
                            }}>
                                {sdkInitialized
                                    ? 'Initialized (v26.0)'
                                    : sdkError
                                    ? 'Load Failed'
                                    : sdkLoaded
                                    ? 'Loaded, Initializing...'
                                    : 'Loading SDK...'}
                            </div>
                            <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '2px' }}>
                                connect.facebook.net/sdk.js
                            </div>
                        </div>
                    </div>

                    {/* Launch Section */}
                    <div style={{
                        backgroundColor: '#182234',
                        border: '1px solid #2563eb',
                        borderRadius: '12px',
                        padding: '24px',
                        textAlign: 'center',
                        marginBottom: '32px',
                    }}>
                        <h2 style={{ fontSize: '18px', fontWeight: 600, margin: '0 0 8px', color: '#ffffff' }}>
                            Launch Coexistence Embedded Signup
                        </h2>
                        <p style={{ fontSize: '13px', color: '#94a3b8', margin: '0 0 20px', maxWidth: '500px', marginLeft: 'auto', marginRight: 'auto' }}>
                            Clicking launches Meta&apos;s synchronous <code>FB.login</code> popup pre-configured for WhatsApp Business App coexistence onboarding.
                        </p>

                        <button
                            id="btn-connect-whatsapp-coexistence"
                            onClick={handleConnectClick}
                            disabled={!isReadyToLaunch || isLaunching}
                            style={{
                                backgroundColor: isReadyToLaunch ? '#059669' : '#374151',
                                color: '#ffffff',
                                fontSize: '16px',
                                fontWeight: 600,
                                padding: '14px 28px',
                                borderRadius: '10px',
                                border: 'none',
                                cursor: isReadyToLaunch ? 'pointer' : 'not-allowed',
                                boxShadow: isReadyToLaunch ? '0 10px 15px -3px rgba(5, 150, 105, 0.4)' : 'none',
                                transition: 'all 0.2s ease',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '10px',
                            }}
                        >
                            <span>💬</span>
                            <span>{isLaunching ? 'Opening Meta Dialog...' : 'Connect XerService WhatsApp Business'}</span>
                        </button>

                        {!isReadyToLaunch && (
                            <p style={{ fontSize: '12px', color: '#f87171', marginTop: '12px' }}>
                                {!metaAppId || !configId
                                    ? '⚠️ Configure NEXT_PUBLIC_META_APP_ID and NEXT_PUBLIC_WHATSAPP_CONFIG_ID in .env.local to enable.'
                                    : sdkError
                                    ? '❌ Facebook SDK failed to load. See diagnosis above.'
                                    : '⏳ Waiting for Facebook SDK initialization...'}
                            </p>
                        )}
                    </div>

                    {/* Server Callback Status */}
                    {serverCallbackStatus.status !== 'idle' && (
                        <div style={{
                            padding: '16px',
                            borderRadius: '8px',
                            marginBottom: '24px',
                            backgroundColor:
                                serverCallbackStatus.status === 'success' ? '#064e3b' :
                                serverCallbackStatus.status === 'error' ? '#7f1d1d' : '#1e3a8a',
                            border: `1px solid ${
                                serverCallbackStatus.status === 'success' ? '#059669' :
                                serverCallbackStatus.status === 'error' ? '#dc2626' : '#2563eb'
                            }`,
                        }}>
                            <div style={{ fontWeight: 600, fontSize: '14px', marginBottom: '4px' }}>
                                Server Callback Status: {serverCallbackStatus.status.toUpperCase()}
                            </div>
                            <div style={{ fontSize: '13px', opacity: 0.9 }}>
                                {serverCallbackStatus.message}
                            </div>
                            {serverCallbackStatus.details && (
                                <pre style={{
                                    marginTop: '8px',
                                    fontSize: '11px',
                                    backgroundColor: 'rgba(0,0,0,0.3)',
                                    padding: '8px',
                                    borderRadius: '4px',
                                    overflowX: 'auto',
                                }}>
                                    {JSON.stringify(serverCallbackStatus.details, null, 2)}
                                </pre>
                            )}
                        </div>
                    )}

                    {/* Coexistence Completion Alert */}
                    {coexistenceCompleted && (
                        <div style={{
                            backgroundColor: '#064e3b',
                            border: '1px solid #10b981',
                            borderRadius: '10px',
                            padding: '16px',
                            marginBottom: '24px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '12px',
                        }}>
                            <span style={{ fontSize: '24px' }}>🎉</span>
                            <div>
                                <div style={{ fontWeight: 700, fontSize: '15px', color: '#a7f3d0' }}>
                                    Coexistence Onboarding Event Captured!
                                </div>
                                <div style={{ fontSize: '13px', color: '#d1fae5' }}>
                                    Received <code>FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING</code> event from Meta.
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Live Session Event Monitor */}
                    <div style={{
                        backgroundColor: '#1f2937',
                        border: '1px solid #374151',
                        borderRadius: '10px',
                        padding: '18px',
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                            <h3 style={{ fontSize: '14px', fontWeight: 600, margin: 0, textTransform: 'uppercase', color: '#9ca3af' }}>
                                Live Meta Session Events ({capturedEvents.length})
                            </h3>
                            {capturedEvents.length > 0 && (
                                <button
                                    onClick={() => setCapturedEvents([])}
                                    style={{
                                        fontSize: '11px',
                                        backgroundColor: 'transparent',
                                        color: '#9ca3af',
                                        border: '1px solid #4b5563',
                                        borderRadius: '4px',
                                        padding: '2px 8px',
                                        cursor: 'pointer',
                                    }}
                                >
                                    Clear Log
                                </button>
                            )}
                        </div>

                        {capturedEvents.length === 0 ? (
                            <p style={{ fontSize: '12px', color: '#6b7280', fontStyle: 'italic', margin: 0 }}>
                                No session messages captured yet. Click &quot;Connect XerService WhatsApp Business&quot; to begin.
                            </p>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                {capturedEvents.map((evt, idx) => (
                                    <div key={idx} style={{
                                        backgroundColor: '#111827',
                                        padding: '10px 14px',
                                        borderRadius: '6px',
                                        fontSize: '12px',
                                        border: evt.event === 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING'
                                            ? '1px solid #10b981'
                                            : '1px solid #374151',
                                    }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#9ca3af', marginBottom: '4px' }}>
                                            <span style={{ fontWeight: 600, color: '#38bdf8' }}>{evt.event}</span>
                                            <span>{evt.timestamp}</span>
                                        </div>
                                        <div style={{ display: 'flex', gap: '16px', color: '#d1d5db', fontSize: '11px' }}>
                                            {evt.wabaId && <span><strong>WABA ID:</strong> {evt.wabaId}</span>}
                                            {evt.phoneNumberId && <span><strong>Phone Number ID:</strong> {evt.phoneNumberId}</span>}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </>
    );
}

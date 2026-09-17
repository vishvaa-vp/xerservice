'use client';

import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase/client';
import { normalizePhoneNumber, isValidIndianMobile, formatPhoneDisplay } from '@/lib/phone';
import { X, Phone, ShieldCheck, AlertCircle, RotateCw, CheckCircle2 } from 'lucide-react';

interface LinkPhoneModalProps {
    open: boolean;
    currentUserId: string;
    onClose: () => void;
    onSuccess: (linkedPhone: string) => void;
}

export default function LinkPhoneModal({
    open,
    currentUserId,
    onClose,
    onSuccess,
}: LinkPhoneModalProps) {
    const isPhoneAuthEnabled = process.env.NEXT_PUBLIC_PHONE_AUTH_ENABLED === 'true';

    const [step, setStep] = useState<'input' | 'otp' | 'success'>('input');
    const [rawInput, setRawInput] = useState('');
    const [normalizedPhone, setNormalizedPhone] = useState('');
    const [otp, setOtp] = useState(['', '', '', '', '', '']);
    const [countdown, setCountdown] = useState(0);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (open) {
            setStep('input');
            setRawInput('');
            setNormalizedPhone('');
            setOtp(['', '', '', '', '', '']);
            setCountdown(0);
            setError(null);
            setLoading(false);
        }
    }, [open]);

    useEffect(() => {
        if (countdown <= 0) return;
        const timer = setTimeout(() => setCountdown(prev => prev - 1), 1000);
        return () => clearTimeout(timer);
    }, [countdown]);

    if (!open) return null;

    const handleSendOtp = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        setError(null);

        if (!isPhoneAuthEnabled) {
            setError('Mobile verification is currently disabled in this environment.');
            return;
        }

        if (!isValidIndianMobile(rawInput)) {
            setError('Please enter a valid 10-digit Indian mobile number (starting with 6-9).');
            return;
        }

        const normalized = normalizePhoneNumber(rawInput);
        if (!normalized) {
            setError('Invalid phone number format.');
            return;
        }

        setLoading(true);
        try {
            // Authoritative Supabase phone change flow (enforces unique identity on auth.users)
            const { error: updateError } = await supabase.auth.updateUser({
                phone: normalized,
            });

            if (updateError) {
                const msg = updateError.message?.toLowerCase() || '';
                if (msg.includes('already') || msg.includes('exists') || msg.includes('registered') || msg.includes('unique')) {
                    setError('This mobile number is already linked to another account.');
                } else {
                    setError(updateError.message || 'Failed to initiate phone verification.');
                }
                setLoading(false);
                return;
            }

            setNormalizedPhone(normalized);
            setStep('otp');
            setCountdown(60);
        } catch (err: any) {
            setError(err?.message || 'An unexpected error occurred. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    const handleVerifyOtp = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);

        const token = otp.join('');
        if (token.length !== 6) {
            setError('Please enter the full 6-digit OTP.');
            return;
        }

        setLoading(true);
        try {
            // 1. Authoritative Supabase SDK phone_change verification
            const { data: _data, error: verifyError } = await supabase.auth.verifyOtp({
                phone: normalizedPhone,
                token,
                type: 'phone_change',
            });

            if (verifyError) {
                setError(verifyError.message || 'Invalid or expired OTP. Please try again.');
                setLoading(false);
                return;
            }

            // 2. Authoritative server/RPC synchronization: reads auth.users.phone directly
            let syncedPhone: string = normalizedPhone;
            let syncSuccess = false;

            // Primary: Call database RPC sync_verified_phone_to_profile()
            const { data: rpcData, error: rpcError } = await supabase.rpc('sync_verified_phone_to_profile');
            if (!rpcError && rpcData?.success) {
                syncSuccess = true;
                if (rpcData.phone) syncedPhone = rpcData.phone;
            } else {
                // Secondary / pre-push fallback: Call server endpoint POST /api/customer/phone/sync
                try {
                    const { data: { session } } = await supabase.auth.getSession();
                    const res = await fetch('/api/customer/phone/sync', {
                        method: 'POST',
                        headers: {
                            Authorization: `Bearer ${session?.access_token || ''}`,
                        },
                    });
                    const resData = await res.json();
                    if (res.ok && resData.success) {
                        syncSuccess = true;
                        if (resData.phone) syncedPhone = resData.phone;
                    } else if (resData.error?.includes('already linked')) {
                        setError('This mobile number is already linked to another account.');
                        setLoading(false);
                        return;
                    }
                } catch (fallbackErr) {
                    console.error('[LinkPhoneModal] Server sync exception:', fallbackErr);
                }
            }

            if (!syncSuccess) {
                setError('Failed to synchronize verified phone to profile. Please refresh and try again.');
                setLoading(false);
                return;
            }

            setStep('success');
            setTimeout(() => {
                onSuccess(syncedPhone);
            }, 1200);
        } catch (err: any) {
            setError(err?.message || 'Verification failed. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    const handleOtpChange = (index: number, value: string) => {
        if (!/^\d?$/.test(value)) return;
        setError(null);
        const next = [...otp];
        next[index] = value;
        setOtp(next);

        if (value && index < 5) {
            const nextInput = document.getElementById(`link-phone-otp-${index + 1}`);
            nextInput?.focus();
        }
    };

    const handleOtpKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Backspace' && !otp[index] && index > 0) {
            const prevInput = document.getElementById(`link-phone-otp-${index - 1}`) as HTMLInputElement;
            prevInput?.focus();
        }
    };

    return (
        <div
            style={{
                position: 'fixed',
                inset: 0,
                zIndex: 9999,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: 'rgba(0, 0, 0, 0.65)',
                backdropFilter: 'blur(4px)',
                padding: '16px',
            }}
            onClick={onClose}
        >
            <div
                style={{
                    backgroundColor: 'var(--bg)',
                    borderRadius: 'var(--radius)',
                    maxWidth: '440px',
                    width: '100%',
                    padding: '28px',
                    position: 'relative',
                    border: '1px solid var(--border)',
                    boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.3), 0 8px 10px -6px rgba(0, 0, 0, 0.3)',
                }}
                onClick={(e) => e.stopPropagation()}
            >
                <button
                    onClick={onClose}
                    type="button"
                    style={{
                        position: 'absolute',
                        top: '16px',
                        right: '16px',
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        color: 'var(--fg-muted)',
                        padding: '4px',
                        borderRadius: '6px',
                    }}
                >
                    <X size={18} />
                </button>

                {!isPhoneAuthEnabled ? (
                    <div style={{ textAlign: 'center', padding: '16px 8px' }}>
                        <div
                            style={{
                                width: '56px',
                                height: '56px',
                                borderRadius: '50%',
                                background: 'var(--accent-muted)',
                                color: 'var(--accent)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                margin: '0 auto 16px',
                            }}
                        >
                            <Phone size={24} />
                        </div>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                            <h3 style={{ fontSize: '18px', fontWeight: '800', margin: 0 }}>
                                Link Mobile Number
                            </h3>
                            <span style={{
                                fontSize: '11px',
                                fontWeight: '700',
                                textTransform: 'uppercase',
                                letterSpacing: '0.04em',
                                padding: '2px 8px',
                                borderRadius: '999px',
                                background: 'var(--bg-tertiary)',
                                color: 'var(--fg-muted)',
                                border: '1px solid var(--border)'
                            }}>
                                Coming Soon
                            </span>
                        </div>
                        <p style={{ fontSize: '14px', color: 'var(--fg-muted)', lineHeight: 1.5, marginBottom: '24px' }}>
                            Mobile number verification will be available soon.
                        </p>
                        <button type="button" onClick={onClose} className="btn btn-outline btn-full">
                            Close
                        </button>
                    </div>
                ) : step === 'input' ? (
                    <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
                            <div
                                style={{
                                    width: '40px',
                                    height: '40px',
                                    borderRadius: '10px',
                                    background: 'var(--accent-muted)',
                                    color: 'var(--accent)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    flexShrink: 0,
                                }}
                            >
                                <Phone size={20} />
                            </div>
                            <div>
                                <h3 style={{ fontSize: '18px', fontWeight: '800', margin: 0 }}>
                                    Link Mobile Number
                                </h3>
                                <p style={{ fontSize: '13px', color: 'var(--fg-muted)', margin: 0 }}>
                                    Verify your mobile number to link it with your account
                                </p>
                            </div>
                        </div>

                        <form onSubmit={handleSendOtp} style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '20px' }}>
                            <div>
                                <label style={{ display: 'block', fontSize: '13px', fontWeight: '700', marginBottom: '6px' }}>
                                    Mobile Number
                                </label>
                                <div style={{ display: 'flex', gap: '8px' }}>
                                    <div
                                        style={{
                                            padding: '12px 14px',
                                            background: 'var(--bg-tertiary)',
                                            border: '1.5px solid var(--border)',
                                            borderRadius: 'var(--radius)',
                                            fontSize: '15px',
                                            fontWeight: '700',
                                            flexShrink: 0,
                                        }}
                                    >
                                        +91
                                    </div>
                                    <input
                                        className="input"
                                        type="tel"
                                        placeholder="98765 43210"
                                        maxLength={10}
                                        value={rawInput}
                                        onChange={(e) => {
                                            setRawInput(e.target.value.replace(/\D/g, ''));
                                            setError(null);
                                        }}
                                        autoFocus
                                        disabled={loading}
                                    />
                                </div>
                            </div>

                            {error && (
                                <div
                                    style={{
                                        padding: '10px 14px',
                                        borderRadius: '8px',
                                        background: 'rgba(239, 68, 68, 0.08)',
                                        border: '1px solid rgba(239, 68, 68, 0.25)',
                                        color: '#ef4444',
                                        fontSize: '13px',
                                        fontWeight: '600',
                                    }}
                                >
                                    {error}
                                </div>
                            )}

                            <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
                                <button
                                    type="button"
                                    onClick={onClose}
                                    className="btn btn-outline"
                                    style={{ flex: 1 }}
                                    disabled={loading}
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    className="btn btn-accent"
                                    style={{ flex: 1.5 }}
                                    disabled={loading || rawInput.length < 10}
                                >
                                    {loading ? 'Sending OTP...' : 'Send OTP'}
                                </button>
                            </div>
                        </form>
                    </div>
                ) : step === 'otp' ? (
                    <div>
                        <div style={{ textAlign: 'center', marginBottom: '20px' }}>
                            <div
                                style={{
                                    width: '48px',
                                    height: '48px',
                                    borderRadius: '50%',
                                    background: 'var(--accent-muted)',
                                    color: 'var(--accent)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    margin: '0 auto 12px',
                                }}
                            >
                                <ShieldCheck size={24} />
                            </div>
                            <h3 style={{ fontSize: '18px', fontWeight: '800', marginBottom: '6px' }}>
                                Enter Verification Code
                            </h3>
                            <p style={{ fontSize: '13px', color: 'var(--fg-muted)', margin: 0 }}>
                                Enter the 6-digit OTP sent to {formatPhoneDisplay(normalizedPhone)}
                            </p>
                        </div>

                        <form onSubmit={handleVerifyOtp} style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
                            <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                                {otp.map((val, idx) => (
                                    <input
                                        key={idx}
                                        id={`link-phone-otp-${idx}`}
                                        type="text"
                                        inputMode="numeric"
                                        maxLength={1}
                                        value={val}
                                        onChange={(e) => handleOtpChange(idx, e.target.value)}
                                        onKeyDown={(e) => handleOtpKeyDown(idx, e)}
                                        style={{
                                            width: '46px',
                                            height: '52px',
                                            textAlign: 'center',
                                            fontSize: '20px',
                                            fontWeight: '800',
                                            background: 'var(--bg-secondary)',
                                            border: `1.5px solid ${error ? '#ef4444' : val ? 'var(--accent)' : 'var(--border)'}`,
                                            borderRadius: 'var(--radius)',
                                            color: 'var(--fg)',
                                            outline: 'none',
                                        }}
                                    />
                                ))}
                            </div>

                            {error && (
                                <div
                                    style={{
                                        padding: '10px 14px',
                                        borderRadius: '8px',
                                        background: 'rgba(239, 68, 68, 0.08)',
                                        border: '1px solid rgba(239, 68, 68, 0.25)',
                                        color: '#ef4444',
                                        fontSize: '13px',
                                        fontWeight: '600',
                                        textAlign: 'center',
                                    }}
                                >
                                    {error}
                                </div>
                            )}

                            <button
                                type="submit"
                                className="btn btn-accent btn-full"
                                disabled={loading || otp.join('').length !== 6}
                            >
                                {loading ? 'Verifying...' : 'Verify & Link Mobile'}
                            </button>

                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '13px' }}>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setStep('input');
                                        setError(null);
                                    }}
                                    style={{
                                        background: 'none',
                                        border: 'none',
                                        color: 'var(--fg-muted)',
                                        cursor: 'pointer',
                                        padding: 0,
                                        textDecoration: 'underline',
                                    }}
                                >
                                    Change Number
                                </button>

                                {countdown > 0 ? (
                                    <span style={{ color: 'var(--fg-muted)', fontWeight: '600' }}>
                                        Resend OTP in {countdown}s
                                    </span>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={() => handleSendOtp()}
                                        disabled={loading}
                                        style={{
                                            background: 'none',
                                            border: 'none',
                                            color: 'var(--accent)',
                                            fontWeight: '700',
                                            cursor: loading ? 'not-allowed' : 'pointer',
                                            padding: 0,
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '4px',
                                        }}
                                    >
                                        <RotateCw size={12} /> Resend OTP
                                    </button>
                                )}
                            </div>
                        </form>
                    </div>
                ) : (
                    <div style={{ textAlign: 'center', padding: '20px 8px' }}>
                        <div
                            style={{
                                width: '56px',
                                height: '56px',
                                borderRadius: '50%',
                                background: 'rgba(16, 185, 129, 0.1)',
                                color: '#10b981',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                margin: '0 auto 16px',
                            }}
                        >
                            <CheckCircle2 size={32} />
                        </div>
                        <h3 style={{ fontSize: '18px', fontWeight: '800', marginBottom: '8px' }}>
                            Mobile Number Linked!
                        </h3>
                        <p style={{ fontSize: '14px', color: 'var(--fg-muted)', margin: 0 }}>
                            {formatPhoneDisplay(normalizedPhone)} has been successfully linked to your account.
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}

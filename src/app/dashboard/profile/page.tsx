'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useApp } from '@/context/AppContext';
import { supabase } from '@/lib/supabase/client';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import AvatarCropModal from '@/components/profile/AvatarCropModal';
import LinkPhoneModal from '@/components/profile/LinkPhoneModal';
import WhatsAppLinkModal from '@/components/profile/WhatsAppLinkModal';
import LinkEmailModal from '@/components/profile/LinkEmailModal';
import RequestDeleteModal from '@/components/profile/RequestDeleteModal';
import { formatPhoneDisplay } from '@/lib/phone';
import {
    Camera,
    ChevronRight,
    LifeBuoy,
    LogOut,
    Phone,
    ShieldCheck,
    MessageCircle,
    CheckCircle2,
    ExternalLink,
    Lock,
    Trash2,
    Plus,
    AlertTriangle,
} from 'lucide-react';

export default function ProfilePage() {
    const router = useRouter();
    const isPhoneAuthEnabled = process.env.NEXT_PUBLIC_PHONE_AUTH_ENABLED === 'true';
    const { user, logout, updateProfile, refreshProfile, isLoading, authInitialized } = useApp();
    const [editMode, setEditMode] = useState(false);
    const [saving, setSaving] = useState(false);
    const [showLogout, setShowLogout] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [deletingAccount, setDeletingAccount] = useState(false);
    const [deleteError, setDeleteError] = useState<string | null>(null);
    const [showWhatsappModal, setShowWhatsappModal] = useState(false);
    const [showLinkPhoneModal, setShowLinkPhoneModal] = useState(false);
    const [showUnlinkConfirm, setShowUnlinkConfirm] = useState(false);
    const [whatsappStatus, setWhatsappStatus] = useState<{
        status: 'not_linked' | 'pending' | 'awaiting_confirmation' | 'connected';
        maskedPhone: string | null;
        linkedAt: string | null;
        orderUpdatesOptIn: boolean;
    }>({ status: 'not_linked', maskedPhone: null, linkedAt: null, orderUpdatesOptIn: false });

    // Multi-email linking state
    const [linkedEmails, setLinkedEmails] = useState<string[]>([]);
    const [showLinkEmailModal, setShowLinkEmailModal] = useState(false);

    // Account deletion governance state
    const [deleteRequest, setDeleteRequest] = useState<{
        status: string;
        reason: string;
        requested_at: string;
    } | null>(null);
    const [showRequestDeleteModal, setShowRequestDeleteModal] = useState(false);
    const [cancellingDeleteRequest, setCancellingDeleteRequest] = useState(false);
    const [cancelDeleteError, setCancelDeleteError] = useState<string | null>(null);

    const loadWhatsappStatus = useCallback(async () => {
        try {
            const { data: sessionData } = await supabase.auth.getSession();
            const token = sessionData?.session?.access_token;
            if (!token) return;
            const res = await fetch('/api/customer/whatsapp/status', {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                setWhatsappStatus({
                    status: data.status,
                    maskedPhone: data.maskedPhone,
                    linkedAt: data.linkedAt,
                    orderUpdatesOptIn: data.orderUpdatesOptIn,
                });
            }
        } catch {
            // Non-fatal
        }
    }, []);

    const loadLinkedEmails = useCallback(async () => {
        try {
            const { data: sessionData } = await supabase.auth.getSession();
            const token = sessionData?.session?.access_token;
            if (!token) return;
            const res = await fetch('/api/customer/account/linked-emails', {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (res.ok) {
                const data = await res.json();
                setLinkedEmails(data.linkedEmails || []);
            }
        } catch {
            // Non-fatal
        }
    }, []);

    const loadDeleteRequestStatus = useCallback(async () => {
        try {
            const { data: sessionData } = await supabase.auth.getSession();
            const token = sessionData?.session?.access_token;
            if (!token) return;
            const res = await fetch('/api/customer/account/delete-request', {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (res.ok) {
                const data = await res.json();
                setDeleteRequest(data.deleteRequest || null);
            }
        } catch {
            // Non-fatal
        }
    }, []);

    useEffect(() => {
        loadWhatsappStatus();
        loadLinkedEmails();
        loadDeleteRequestStatus();
    }, [loadWhatsappStatus, loadLinkedEmails, loadDeleteRequestStatus]);

    useEffect(() => {
        if (typeof window !== 'undefined') {
            const params = new URLSearchParams(window.location.search);
            const hash = window.location.hash;
            if (params.get('connectWhatsapp') === '1' || hash === '#whatsapp-connect' || hash === '#connect-whatsapp') {
                setShowWhatsappModal(true);
            }
        }
    }, []);

    const handleUnlinkEmail = async (emailToUnlink: string) => {
        try {
            const { data: sessionData } = await supabase.auth.getSession();
            const token = sessionData?.session?.access_token;
            if (!token) return;
            const res = await fetch('/api/customer/account/linked-emails', {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ email: emailToUnlink }),
            });
            if (res.ok) {
                const data = await res.json();
                setLinkedEmails(data.linkedEmails || []);
            }
        } catch {
            // Non-fatal
        }
    };

    const handleCancelDeleteRequest = async () => {
        setCancellingDeleteRequest(true);
        setCancelDeleteError(null);
        try {
            const { data: sessionData } = await supabase.auth.getSession();
            const token = sessionData?.session?.access_token;
            if (!token) throw new Error('Not authenticated.');

            const res = await fetch('/api/customer/account/delete-request', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ action: 'cancel' }),
            });
            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || 'Failed to cancel deletion request.');
            }
            setDeleteRequest(null);
        } catch (err: any) {
            setCancelDeleteError(err?.message || 'Failed to cancel request.');
        } finally {
            setCancellingDeleteRequest(false);
        }
    };
    const [cropImageSrc, setCropImageSrc] = useState<string | null>(null);
    const [showCropModal, setShowCropModal] = useState(false);
    const [name, setName] = useState(user?.name || '');
    const [email, setEmail] = useState(user?.email || '');
    const [profileError, setProfileError] = useState<string | null>(null);
    const avatarInputRef = useRef<HTMLInputElement | null>(null);

    const handleDeleteAccount = async () => {
        setDeletingAccount(true);
        setDeleteError(null);
        try {
            const { data: sessionData } = await supabase.auth.getSession();
            const token = sessionData?.session?.access_token;
            if (!token) throw new Error('Not authenticated.');

            const res = await fetch('/api/customer/account/delete', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`
                }
            });
            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || 'Failed to delete account.');
            }

            setShowDeleteConfirm(false);
            if (logout) {
                await logout();
            }
            router.push('/login?deleted=1');
        } catch (err: any) {
            setDeleteError(err?.message || 'Failed to delete account.');
        } finally {
            setDeletingAccount(false);
        }
    };

    useEffect(() => {
        if (!authInitialized || isLoading) return;
        if (!user) {
            router.push('/login?redirect=/dashboard/profile');
        }
    }, [user, isLoading, authInitialized, router]);

    useEffect(() => {
        setName(user?.name || '');
        setEmail(user?.email || '');
    }, [user?.name, user?.email]);

    const handleSave = async () => {
        if (!user) return;
        const trimmed = name.trim();
        if (!trimmed) {
            setProfileError('Name cannot be empty.');
            return;
        }

        setSaving(true);
        setProfileError(null);
        try {
            await updateProfile({
                name: trimmed,
            });
            setEditMode(false);
        } catch (err: any) {
            setProfileError(err?.message || 'Failed to update profile.');
        } finally {
            setSaving(false);
        }
    };

    const confirmLogout = async () => {
        await logout();
        setShowLogout(false);
        router.push('/');
    };

    const isWhatsappLinked = user?.whatsappLinkStatus === 'linked';
    const linkedMobile = user?.whatsappLinkedMobile || user?.mobile || '';

    const handleConfirmUnlink = async () => {
        try {
            const { data: sessionData } = await supabase.auth.getSession();
            const token = sessionData?.session?.access_token;
            if (token) {
                await fetch('/api/customer/whatsapp/disconnect', {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${token}` }
                });
            }
            await loadWhatsappStatus();
            if (refreshProfile) await refreshProfile();
        } catch {
            // Non-fatal
        } finally {
            setShowUnlinkConfirm(false);
        }
    };

    const onAvatarUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            const rawUrl = typeof reader.result === 'string' ? reader.result : '';
            if (rawUrl) {
                setCropImageSrc(rawUrl);
                setShowCropModal(true);
            }
        };
        reader.readAsDataURL(file);
        event.target.value = '';
    };

    const handleSaveCrop = (croppedUrl: string) => {
        updateProfile({ avatarUrl: croppedUrl });
        setShowCropModal(false);
        setCropImageSrc(null);
    };

    if (!authInitialized || (isLoading && !user)) {
        return (
            <div style={{ minHeight: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span className="spinner spinner-lg" />
            </div>
        );
    }

    if (!user) {
        return (
            <div style={{ textAlign: 'center', padding: '100px 24px', background: 'var(--bg-secondary)', minHeight: '80vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: 'var(--accent-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '24px' }}>
                    <ShieldCheck size={32} color="var(--accent)" />
                </div>
                <p style={{ color: 'var(--fg-muted)', fontSize: '18px', fontWeight: '700', marginBottom: '32px' }}>Please log in to view your profile</p>
                <Link href="/login?redirect=/dashboard/profile" className="btn btn-primary btn-lg">Sign In to Continue</Link>
            </div>
        );
    }

    return (
        <div className="page-wrapper">
            <section className="section-sm">
                <div className="container-sm" style={{ maxWidth: '840px' }}>
                    <div style={{ marginBottom: '32px', textAlign: 'center' }}>
                        <h1 style={{ fontSize: '32px', fontWeight: '900', letterSpacing: '-0.04em', marginBottom: '8px' }}>Profile Settings</h1>
                        <p style={{ fontSize: '15px', color: 'var(--fg-muted)' }}>Manage your account details.</p>
                    </div>

                    {/* Pending Account Deletion Request Banner */}
                    {deleteRequest && (
                        <div
                            style={{
                                padding: '16px 20px',
                                borderRadius: '12px',
                                border: '1px solid rgba(245, 158, 11, 0.4)',
                                background: 'rgba(245, 158, 11, 0.08)',
                                marginBottom: '22px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: '14px',
                                flexWrap: 'wrap',
                            }}
                        >
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                                <AlertTriangle size={20} color="#b45309" style={{ flexShrink: 0, marginTop: '2px' }} />
                                <div>
                                    <h4 style={{ margin: '0 0 2px 0', fontSize: '14px', fontWeight: '800', color: '#b45309' }}>
                                        Account Deletion Requested
                                    </h4>
                                    <p style={{ margin: 0, fontSize: '13px', color: 'var(--fg-muted)' }}>
                                        Submitted on {new Date(deleteRequest.requested_at).toLocaleDateString()}. Reason: <strong>{deleteRequest.reason}</strong>. Pending administrative review.
                                    </p>
                                    {cancelDeleteError && (
                                        <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: '#ef4444', fontWeight: '600' }}>
                                            {cancelDeleteError}
                                        </p>
                                    )}
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={handleCancelDeleteRequest}
                                disabled={cancellingDeleteRequest}
                                className="btn btn-outline btn-sm"
                                style={{
                                    borderColor: 'rgba(180, 83, 9, 0.4)',
                                    color: '#b45309',
                                    fontWeight: '700',
                                    borderRadius: '8px',
                                }}
                            >
                                {cancellingDeleteRequest ? 'Cancelling...' : 'Cancel Deletion Request'}
                            </button>
                        </div>
                    )}

                    <div className="card" style={{ padding: '34px', marginBottom: '22px', background: 'linear-gradient(135deg, var(--bg) 0%, var(--bg-secondary) 100%)' }}>
                        <div style={{ textAlign: 'center' }}>
                            <div style={{ width: '108px', height: '108px', borderRadius: '30px', margin: '0 auto 14px', overflow: 'hidden', border: '4px solid var(--bg)', boxShadow: 'var(--shadow-sm)', background: 'var(--accent-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                {user.avatarUrl ? (
                                    <img src={user.avatarUrl} alt={user.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                ) : (
                                    <span style={{ fontSize: '42px', fontWeight: '900', color: 'var(--accent)' }}>{user.name?.[0] || 'U'}</span>
                                )}
                            </div>

                            <button onClick={() => avatarInputRef.current?.click()} className="btn btn-outline btn-sm" style={{ marginBottom: '16px' }}>
                                <Camera size={14} /> Change Profile Picture
                            </button>
                            <input ref={avatarInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onAvatarUpload} />

                            {editMode ? (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxWidth: '380px', margin: '0 auto' }}>
                                    <div>
                                        <label style={{ display: 'block', fontSize: '13px', fontWeight: '700', textAlign: 'left', marginBottom: '4px' }}>Display Name</label>
                                        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Display name" autoFocus />
                                    </div>
                                    {email && (
                                        <div>
                                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                                                <label style={{ fontSize: '13px', fontWeight: '700', textAlign: 'left' }}>Email Address</label>
                                                <button
                                                    type="button"
                                                    onClick={() => setShowLinkEmailModal(true)}
                                                    className="btn btn-outline btn-xs"
                                                    style={{
                                                        borderRadius: '12px',
                                                        padding: '2px 8px',
                                                        fontSize: '11px',
                                                        fontWeight: '700',
                                                        display: 'inline-flex',
                                                        alignItems: 'center',
                                                        gap: '3px',
                                                        borderColor: 'var(--accent)',
                                                        color: 'var(--accent)',
                                                    }}
                                                    title="Link another Gmail / email address"
                                                >
                                                    <Plus size={12} /> Add Email
                                                </button>
                                            </div>
                                            <input className="input" type="email" value={email} disabled style={{ opacity: 0.7, cursor: 'not-allowed' }} title="Email address is linked to your login and cannot be modified directly" />
                                            {linkedEmails.length > 0 && (
                                                <div style={{ display: 'flex', gap: '6px', marginTop: '6px', flexWrap: 'wrap' }}>
                                                    {linkedEmails.map(em => (
                                                        <span
                                                            key={em}
                                                            style={{
                                                                display: 'inline-flex',
                                                                alignItems: 'center',
                                                                gap: '4px',
                                                                padding: '2px 8px',
                                                                borderRadius: '12px',
                                                                background: 'var(--bg-tertiary)',
                                                                border: '1px solid var(--border)',
                                                                fontSize: '11px',
                                                                color: 'var(--fg)',
                                                            }}
                                                        >
                                                            {em}
                                                            <button
                                                                type="button"
                                                                onClick={() => handleUnlinkEmail(em)}
                                                                style={{ background: 'transparent', border: 'none', color: 'var(--fg-muted)', cursor: 'pointer', padding: 0 }}
                                                                title={`Unlink ${em}`}
                                                            >
                                                                ×
                                                            </button>
                                                        </span>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                    {profileError && (
                                        <div style={{ padding: '10px 12px', borderRadius: '8px', border: '1px solid rgba(239, 68, 68, 0.25)', background: 'rgba(239, 68, 68, 0.08)', color: '#ef4444', fontSize: '13px', fontWeight: '700', textAlign: 'left' }}>
                                            {profileError}
                                        </div>
                                    )}
                                    <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', marginTop: '6px' }}>
                                        <button onClick={handleSave} className="btn btn-accent" disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
                                        <button onClick={() => { setName(user.name); setEmail(user.email || ''); setProfileError(null); setEditMode(false); }} className="btn btn-outline" disabled={saving}>Cancel</button>
                                    </div>
                                </div>
                            ) : (
                                <>
                                    <h2 style={{ fontSize: '28px', fontWeight: '900', letterSpacing: '-0.04em', marginBottom: '4px' }}>{user.name}</h2>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginBottom: '8px', flexWrap: 'wrap' }}>
                                        {user.email && (
                                            <span style={{ fontSize: '14px', color: 'var(--fg-muted)' }}>{user.email}</span>
                                        )}
                                        <button
                                            type="button"
                                            onClick={() => setShowLinkEmailModal(true)}
                                            className="btn btn-outline btn-xs"
                                            style={{
                                                borderRadius: '14px',
                                                padding: '2px 8px',
                                                fontSize: '11px',
                                                fontWeight: '700',
                                                display: 'inline-flex',
                                                alignItems: 'center',
                                                gap: '3px',
                                                borderColor: 'var(--accent)',
                                                color: 'var(--accent)',
                                            }}
                                            title="Link another Gmail / email address to merge with this mobile number"
                                        >
                                            <Plus size={12} /> Add Email
                                        </button>
                                    </div>
                                    {linkedEmails.length > 0 && (
                                        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '6px', marginBottom: '14px', flexWrap: 'wrap' }}>
                                            <span style={{ fontSize: '12px', color: 'var(--fg-muted)', fontWeight: '600' }}>Linked:</span>
                                            {linkedEmails.map(em => (
                                                <span
                                                    key={em}
                                                    style={{
                                                        display: 'inline-flex',
                                                        alignItems: 'center',
                                                        gap: '4px',
                                                        padding: '2px 8px',
                                                        borderRadius: '12px',
                                                        background: 'var(--bg-tertiary)',
                                                        border: '1px solid var(--border)',
                                                        fontSize: '12px',
                                                        color: 'var(--fg)',
                                                    }}
                                                >
                                                    {em}
                                                    <button
                                                        type="button"
                                                        onClick={() => handleUnlinkEmail(em)}
                                                        style={{
                                                            background: 'transparent',
                                                            border: 'none',
                                                            color: 'var(--fg-muted)',
                                                            cursor: 'pointer',
                                                            padding: 0,
                                                            fontSize: '12px',
                                                            lineHeight: 1,
                                                        }}
                                                        title={`Unlink ${em}`}
                                                        onMouseEnter={(e) => (e.currentTarget.style.color = '#ef4444')}
                                                        onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--fg-muted)')}
                                                    >
                                                        ×
                                                    </button>
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '12px', marginBottom: '22px', flexWrap: 'wrap' }}>
                                        {user.mobile ? (
                                            <span
                                                style={{
                                                    display: 'inline-flex',
                                                    alignItems: 'center',
                                                    gap: '6px',
                                                    padding: '5px 14px',
                                                    borderRadius: '20px',
                                                    background: 'rgba(16, 185, 129, 0.1)',
                                                    color: '#10b981',
                                                    fontSize: '13px',
                                                    fontWeight: '700',
                                                    border: '1px solid rgba(16, 185, 129, 0.25)',
                                                }}
                                            >
                                                <ShieldCheck size={14} /> Verified: {formatPhoneDisplay(user.mobile)}
                                            </span>
                                        ) : (
                                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
                                                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', justifyContent: 'center' }}>
                                                    <span style={{ fontSize: '13px', color: 'var(--fg-muted)', fontWeight: '600' }}>
                                                        Mobile Number: Not linked
                                                    </span>
                                                    {!isPhoneAuthEnabled ? (
                                                        <button
                                                            type="button"
                                                            disabled
                                                            className="btn btn-outline btn-xs"
                                                            style={{
                                                                fontSize: '12px',
                                                                padding: '4px 10px',
                                                                borderRadius: '8px',
                                                                opacity: 0.6,
                                                                cursor: 'not-allowed',
                                                                display: 'inline-flex',
                                                                alignItems: 'center',
                                                                gap: '4px'
                                                            }}
                                                            title="Mobile number verification will be available soon."
                                                        >
                                                            <Phone size={12} /> Link Mobile Number — Coming Soon
                                                        </button>
                                                    ) : (
                                                        <button
                                                            type="button"
                                                            onClick={() => setShowLinkPhoneModal(true)}
                                                            className="btn btn-outline btn-xs"
                                                            style={{ fontSize: '12px', padding: '4px 10px', borderRadius: '8px' }}
                                                        >
                                                            <Phone size={12} style={{ marginRight: '4px' }} /> Link Mobile Number
                                                        </button>
                                                    )}
                                                </div>
                                                {!isPhoneAuthEnabled && (
                                                    <span style={{ fontSize: '12px', color: 'var(--fg-subtle)' }}>
                                                        Mobile number verification will be available soon.
                                                    </span>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                    <button onClick={() => setEditMode(true)} className="btn btn-outline btn-sm">Edit Profile Details</button>
                                </>
                            )}
                        </div>
                    </div>

                    <div id="whatsapp" className="card" style={{ padding: '24px 28px', marginTop: '22px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '14px' }}>
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '14px', maxWidth: '640px' }}>
                                <div
                                    style={{
                                        width: '38px',
                                        height: '38px',
                                        borderRadius: '10px',
                                        background: 'rgba(22, 163, 74, 0.1)',
                                        color: '#16a34a',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        flexShrink: 0,
                                        marginTop: '2px',
                                    }}
                                >
                                    <MessageCircle size={20} />
                                </div>
                                <div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                        <h2 style={{ fontSize: '18px', fontWeight: '800', margin: 0, letterSpacing: '-0.01em' }}>
                                            WhatsApp Document Import
                                        </h2>
                                        {whatsappStatus.status === 'connected' ? (
                                            <span className="badge badge-success" style={{ fontSize: '11px', textTransform: 'uppercase' }}>Connected</span>
                                        ) : whatsappStatus.status === 'awaiting_confirmation' ? (
                                            <span className="badge badge-accent" style={{ fontSize: '11px', textTransform: 'uppercase' }}>Awaiting Confirmation</span>
                                        ) : (
                                            <span className="badge badge-outline" style={{ fontSize: '11px' }}>Not linked</span>
                                        )}
                                    </div>
                                    <p style={{ color: 'var(--fg-muted)', fontSize: '13px', lineHeight: '1.5', margin: '6px 0 0 0' }}>
                                        {whatsappStatus.status === 'connected'
                                            ? `Linked to ${whatsappStatus.maskedPhone}${whatsappStatus.linkedAt ? ` on ${new Date(whatsappStatus.linkedAt).toLocaleDateString()}` : ''}. Documents sent to XerService on WhatsApp will automatically sync to your cart.`
                                            : whatsappStatus.status === 'awaiting_confirmation'
                                            ? `Verification message received from ${whatsappStatus.maskedPhone}. Please confirm below to link this number.`
                                            : 'Connect your WhatsApp number to easily import documents and receive real-time print order updates.'}
                                    </p>
                                </div>
                            </div>
                            <div>
                                {whatsappStatus.status === 'connected' ? (
                                    <button
                                        type="button"
                                        onClick={() => setShowUnlinkConfirm(true)}
                                        className="btn btn-outline btn-sm"
                                        style={{ color: '#ef4444', borderColor: 'rgba(239, 68, 68, 0.3)', borderRadius: '8px' }}
                                    >
                                        Disconnect
                                    </button>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={() => setShowWhatsappModal(true)}
                                        className="btn btn-accent btn-sm"
                                        style={{ borderRadius: '8px', fontWeight: '800' }}
                                    >
                                        {whatsappStatus.status === 'awaiting_confirmation' ? 'Confirm Connection' : 'Connect WhatsApp'}
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="card" style={{ padding: '0', overflow: 'hidden', marginTop: '22px' }}>
                        <div style={{ padding: '24px 28px', borderBottom: '1px solid var(--border)' }}>
                            <h2 style={{ fontSize: '18px', fontWeight: '800', letterSpacing: '-0.02em' }}>Account Actions</h2>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column' }}>

                            <Link href="/contact" style={{ padding: '18px 28px', display: 'flex', alignItems: 'center', gap: '16px', borderBottom: '1px solid var(--border)' }} className="btn-ghost">
                                <LifeBuoy size={18} />
                                <span style={{ fontSize: '15px', fontWeight: '600', flex: 1 }}>Help & Support</span>
                                <ChevronRight size={16} color="var(--fg-subtle)" />
                            </Link>

                            <button
                                onClick={() => setShowLogout(true)}
                                style={{
                                    padding: '18px 28px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '16px',
                                    border: 'none',
                                    background: 'transparent',
                                    width: '100%',
                                    textAlign: 'left',
                                    cursor: 'pointer',
                                    color: '#ef4444',
                                    transition: 'background 0.15s ease',
                                }}
                                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.06)')}
                                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                                className="btn-ghost"
                            >
                                <LogOut size={18} color="#ef4444" />
                                <span style={{ fontSize: '15px', fontWeight: '700', flex: 1, color: '#ef4444' }}>Sign Out from Session</span>
                                <ChevronRight size={16} color="#ef4444" />
                            </button>
                        </div>
                    </div>

                    <div style={{ textAlign: 'center', marginTop: '14px', marginBottom: '8px' }}>
                        {deleteRequest?.status === 'PENDING' ? (
                            <button
                                type="button"
                                onClick={handleCancelDeleteRequest}
                                disabled={cancellingDeleteRequest}
                                style={{
                                    background: 'transparent',
                                    border: 'none',
                                    color: '#b45309',
                                    fontSize: '12px',
                                    cursor: 'pointer',
                                    textDecoration: 'underline',
                                    padding: '6px 12px',
                                    fontWeight: '700',
                                }}
                            >
                                {cancellingDeleteRequest ? 'Cancelling Deletion Request...' : 'Cancel Account Deletion Request'}
                            </button>
                        ) : (
                            <button
                                type="button"
                                onClick={() => setShowRequestDeleteModal(true)}
                                style={{
                                    background: 'transparent',
                                    border: 'none',
                                    color: 'var(--fg-muted)',
                                    fontSize: '12px',
                                    cursor: 'pointer',
                                    textDecoration: 'underline',
                                    padding: '6px 12px',
                                    transition: 'color 0.15s ease',
                                }}
                                onMouseEnter={(e) => (e.currentTarget.style.color = '#ef4444')}
                                onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--fg-muted)')}
                            >
                                Delete Account
                            </button>
                        )}
                    </div>
                </div>
            </section>
            <LinkPhoneModal
                open={showLinkPhoneModal}
                currentUserId={user.id}
                onClose={() => setShowLinkPhoneModal(false)}
                onSuccess={async () => {
                    setShowLinkPhoneModal(false);
                    if (refreshProfile) {
                        await refreshProfile();
                    }
                }}
            />
            <LinkEmailModal
                open={showLinkEmailModal}
                onClose={() => setShowLinkEmailModal(false)}
                onSuccess={(newLinked) => {
                    setLinkedEmails(newLinked);
                }}
                primaryEmail={user.email || ''}
                currentEmails={linkedEmails}
            />
            <RequestDeleteModal
                open={showRequestDeleteModal}
                onClose={() => setShowRequestDeleteModal(false)}
                onSuccess={(req) => {
                    setDeleteRequest(req);
                }}
                userEmail={user.email}
            />
            <ConfirmDialog
                open={showUnlinkConfirm}
                title="Disconnect WhatsApp?"
                message={`Are you sure you want to disconnect WhatsApp (${whatsappStatus.maskedPhone || 'your linked number'})? Documents sent to WhatsApp will no longer automatically import into your XerService cart.`}
                confirmLabel="Disconnect"
                destructive
                onConfirm={handleConfirmUnlink}
                onCancel={() => setShowUnlinkConfirm(false)}
            />
            <WhatsAppLinkModal
                open={showWhatsappModal}
                onClose={() => {
                    setShowWhatsappModal(false);
                    if (typeof window !== 'undefined' && window.location.search.includes('connectWhatsapp')) {
                        const url = new URL(window.location.href);
                        url.searchParams.delete('connectWhatsapp');
                        window.history.replaceState({}, '', url.pathname + (url.search ? url.search : '') + url.hash);
                    }
                }}
                onSuccess={async () => {
                    await loadWhatsappStatus();
                    if (refreshProfile) await refreshProfile();
                    if (typeof window !== 'undefined' && window.location.search.includes('connectWhatsapp')) {
                        const url = new URL(window.location.href);
                        url.searchParams.delete('connectWhatsapp');
                        window.history.replaceState({}, '', url.pathname + (url.search ? url.search : '') + url.hash);
                    }
                }}
            />
            <ConfirmDialog
                open={showLogout}
                title="Log out?"
                message="Your XerService session will be closed on this device."
                confirmLabel="Log Out"
                destructive
                onConfirm={confirmLogout}
                onCancel={() => setShowLogout(false)}
            />
            <ConfirmDialog
                open={showDeleteConfirm}
                title="Permanently Delete Account?"
                message={deleteError ? `Error: ${deleteError}` : "Are you sure you want to permanently delete your XerService account? This action is irreversible. All your profile information will be anonymized and your active sessions will be terminated. If you have any print orders currently in progress, deletion cannot proceed until they are fulfilled or cancelled."}
                confirmLabel={deletingAccount ? "Deleting..." : "Permanently Delete"}
                destructive
                onConfirm={handleDeleteAccount}
                onCancel={() => { setShowDeleteConfirm(false); setDeleteError(null); }}
            />
            <AvatarCropModal
                open={showCropModal}
                imageSrc={cropImageSrc}
                onClose={() => {
                    setShowCropModal(false);
                    setCropImageSrc(null);
                }}
                onSave={handleSaveCrop}
            />
        </div>
    );
}

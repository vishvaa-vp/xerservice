'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import LoginActivityHeatmap from '@/components/ui/LoginActivityHeatmap';
import { useApp } from '@/context/AppContext';
import {
    Bell,
    Camera,
    ChevronRight,
    LifeBuoy,
    LogOut,
    MapPin,
    MessageSquare,
    Phone,
    ShieldCheck,
} from 'lucide-react';

export default function ProfilePage() {
    const { user, logout, updateProfile, activity, streak, totalActiveDays } = useApp();
    const [editMode, setEditMode] = useState(false);
    const [name, setName] = useState(user?.name || '');
    const [email, setEmail] = useState(user?.email || '');
    const avatarInputRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
        setName(user?.name || '');
        setEmail(user?.email || '');
    }, [user?.name, user?.email]);

    const handleSave = () => {
        const trimmed = name.trim();
        if (!trimmed) return;
        updateProfile({ name: trimmed, email: email.trim() });
        setEditMode(false);
    };

    const onAvatarUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            const avatarUrl = typeof reader.result === 'string' ? reader.result : '';
            if (avatarUrl) updateProfile({ avatarUrl });
        };
        reader.readAsDataURL(file);
        event.target.value = '';
    };

    if (!user) {
        return (
            <div style={{ textAlign: 'center', padding: '100px 24px', background: 'var(--bg-secondary)', minHeight: '80vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: 'var(--accent-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '24px' }}>
                    <ShieldCheck size={32} color="var(--accent)" />
                </div>
                <p style={{ color: 'var(--fg-muted)', fontSize: '18px', fontWeight: '700', marginBottom: '32px' }}>Please log in to view your profile</p>
                <Link href="/login" className="btn btn-primary btn-lg">Sign In to Continue</Link>
            </div>
        );
    }

    return (
        <div className="page-wrapper">
            <section className="section-sm">
                <div className="container-sm" style={{ maxWidth: '840px' }}>
                    <div style={{ marginBottom: '32px', textAlign: 'center' }}>
                        <h1 style={{ fontSize: '32px', fontWeight: '900', letterSpacing: '-0.04em', marginBottom: '8px' }}>Profile Settings</h1>
                        <p style={{ fontSize: '15px', color: 'var(--fg-muted)' }}>Manage your account and activity.</p>
                    </div>

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
                                    <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Display name" autoFocus />
                                    <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email address" />
                                    <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
                                        <button onClick={handleSave} className="btn btn-accent">Save</button>
                                        <button onClick={() => { setName(user.name); setEmail(user.email || ''); setEditMode(false); }} className="btn btn-outline">Cancel</button>
                                    </div>
                                </div>
                            ) : (
                                <>
                                    <h2 style={{ fontSize: '28px', fontWeight: '900', letterSpacing: '-0.04em', marginBottom: '4px' }}>{user.name}</h2>
                                    <div style={{ display: 'flex', justifyContent: 'center', gap: '16px', marginBottom: '22px', color: 'var(--fg-muted)', fontSize: '14px', fontWeight: '600', flexWrap: 'wrap' }}>
                                        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Phone size={14} /> +91 {user.mobile}</span>
                                        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><MapPin size={14} /> Coimbatore</span>
                                    </div>
                                    <button onClick={() => setEditMode(true)} className="btn btn-outline btn-sm">Edit Profile Details</button>
                                </>
                            )}
                        </div>

                        <div style={{ marginTop: '22px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px', borderRadius: '12px', background: 'var(--bg)' }}>
                                <ShieldCheck size={18} color="var(--accent)" />
                                <span style={{ fontSize: '13px', fontWeight: '700' }}>2FA Ready</span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px', borderRadius: '12px', background: 'var(--bg)' }}>
                                <Bell size={18} color="var(--accent)" />
                                <span style={{ fontSize: '13px', fontWeight: '700' }}>Notifications On</span>
                            </div>
                        </div>
                    </div>

                    <LoginActivityHeatmap activity={activity} streak={streak} totalActiveDays={totalActiveDays} />

                    <div className="card" style={{ padding: '0', overflow: 'hidden', marginTop: '22px' }}>
                        <div style={{ padding: '24px 28px', borderBottom: '1px solid var(--border)' }}>
                            <h2 style={{ fontSize: '18px', fontWeight: '800', letterSpacing: '-0.02em' }}>Account Actions</h2>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <Link href="/community" style={{ padding: '18px 28px', display: 'flex', alignItems: 'center', gap: '16px', borderBottom: '1px solid var(--border)' }} className="btn-ghost">
                                <MessageSquare size={18} />
                                <span style={{ fontSize: '15px', fontWeight: '600', flex: 1 }}>Community Forum</span>
                                <ChevronRight size={16} color="var(--fg-subtle)" />
                            </Link>

                            <Link href="/contact" style={{ padding: '18px 28px', display: 'flex', alignItems: 'center', gap: '16px', borderBottom: '1px solid var(--border)' }} className="btn-ghost">
                                <LifeBuoy size={18} />
                                <span style={{ fontSize: '15px', fontWeight: '600', flex: 1 }}>Help & Support</span>
                                <ChevronRight size={16} color="var(--fg-subtle)" />
                            </Link>

                            <button onClick={logout} style={{ padding: '20px 28px', display: 'flex', alignItems: 'center', gap: '16px', border: 'none', background: 'rgba(239, 68, 68, 0.04)', width: '100%', textAlign: 'left', cursor: 'pointer' }}>
                                <LogOut size={18} color="#ef4444" />
                                <span style={{ fontSize: '15px', fontWeight: '700', flex: 1, color: '#ef4444' }}>Sign Out from Session</span>
                                <ChevronRight size={16} color="#ef4444" style={{ opacity: 0.6 }} />
                            </button>
                        </div>
                    </div>
                </div>
            </section>
        </div>
    );
}

'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
    Bell,
    CheckCircle2,
    Printer,
    Package,
    AlertCircle,
    XCircle,
    RefreshCw,
    CreditCard,
    Check,
    Inbox,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { useApp } from '@/context/AppContext';

export interface NotificationItem {
    id: string;
    user_id: string;
    order_id: string | null;
    shop_id: string | null;
    type: string;
    title: string;
    message: string;
    is_read: boolean;
    metadata: Record<string, any>;
    created_at: string;
    read_at: string | null;
}

function formatRelativeTime(dateString: string): string {
    try {
        const now = new Date();
        const date = new Date(dateString);
        const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

        if (diffInSeconds < 60) return 'Just now';
        const diffInMinutes = Math.floor(diffInSeconds / 60);
        if (diffInMinutes < 60) return `${diffInMinutes}m ago`;
        const diffInHours = Math.floor(diffInMinutes / 60);
        if (diffInHours < 24) return `${diffInHours}h ago`;
        const diffInDays = Math.floor(diffInHours / 24);
        if (diffInDays < 7) return `${diffInDays}d ago`;
        return date.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
    } catch {
        return '';
    }
}

function getNotificationIcon(type: string) {
    switch (type) {
        case 'PAYMENT_SUCCESS':
            return <CreditCard size={16} color="#10b981" />;
        case 'NEW_ORDER':
            return <Package size={16} color="#3b82f6" />;
        case 'PRINTING_STARTED':
            return <Printer size={16} color="#f59e0b" />;
        case 'ORDER_READY':
            return <CheckCircle2 size={16} color="#8b5cf6" />;
        case 'ORDER_COMPLETED':
            return <CheckCircle2 size={16} color="#10b981" />;
        case 'ORDER_CANCELLED':
            return <XCircle size={16} color="#ef4444" />;
        case 'REFUND_SUCCESS':
            return <RefreshCw size={16} color="#06b6d4" />;
        case 'REFUND_FAILED':
            return <AlertCircle size={16} color="#ef4444" />;
        default:
            return <Bell size={16} color="var(--accent)" />;
    }
}

export default function NotificationBell() {
    const { user } = useApp();
    const router = useRouter();
    const [notifications, setNotifications] = useState<NotificationItem[]>([]);
    const [unreadCount, setUnreadCount] = useState<number>(0);
    const [isOpen, setIsOpen] = useState<boolean>(false);
    const [loading, setLoading] = useState<boolean>(false);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const activeChannelRef = useRef<any>(null);
    const isMountedRef = useRef<boolean>(true);

    // Authoritative session-based fetch (independent of AppContext user.id)
    const fetchNotifications = useCallback(async () => {
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session?.access_token) return;

            const res = await fetch('/api/notifications', {
                headers: {
                    Authorization: `Bearer ${session.access_token}`,
                },
                cache: 'no-store',
            });

            if (res.ok && isMountedRef.current) {
                const data = await res.json();
                setNotifications(data.notifications || []);
                setUnreadCount(Number(data.unreadCount || 0));
            }
        } catch (fetchErr) {
            console.error('[NotificationBell] Failed to fetch notifications:', fetchErr);
        }
    }, []);

    // Authoritative session initialization & Realtime subscription
    useEffect(() => {
        isMountedRef.current = true;

        const initializeSession = async () => {
            try {
                const { data: { session } } = await supabase.auth.getSession();
                if (!session?.user?.id || !session?.access_token) {
                    if (activeChannelRef.current) {
                        supabase.removeChannel(activeChannelRef.current);
                        activeChannelRef.current = null;
                    }
                    if (isMountedRef.current) {
                        setNotifications([]);
                        setUnreadCount(0);
                    }
                    return;
                }

                const userId = session.user.id;

                // 1. Initial Fetch on authenticated mount
                if (isMountedRef.current) setLoading(true);
                await fetchNotifications().finally(() => {
                    if (isMountedRef.current) setLoading(false);
                });

                // 2. Realtime Subscription using session.user.id
                if (activeChannelRef.current) {
                    supabase.removeChannel(activeChannelRef.current);
                    activeChannelRef.current = null;
                }

                const channelName = `notifications_realtime:${userId}`;
                const channel = supabase
                    .channel(channelName)
                    .on(
                        'postgres_changes',
                        {
                            event: 'INSERT',
                            schema: 'public',
                            table: 'notifications',
                            filter: `user_id=eq.${userId}`,
                        },
                        (payload: { new: Record<string, any> }) => {
                            const newNotif = payload.new as NotificationItem;
                            setNotifications((prev) => {
                                if (prev.some((n) => n.id === newNotif.id)) return prev;
                                return [newNotif, ...prev];
                            });
                            if (!newNotif.is_read) {
                                setUnreadCount((c) => c + 1);
                            }
                        }
                    )
                    .on(
                        'postgres_changes',
                        {
                            event: 'UPDATE',
                            schema: 'public',
                            table: 'notifications',
                            filter: `user_id=eq.${userId}`,
                        },
                        (payload: { new: Record<string, any> }) => {
                            const updatedNotif = payload.new as NotificationItem;
                            setNotifications((prev) => {
                                const updated = prev.map((n) => (n.id === updatedNotif.id ? updatedNotif : n));
                                const unread = updated.filter((n) => !n.is_read).length;
                                setUnreadCount(unread);
                                return updated;
                            });
                        }
                    )
                    .subscribe();

                activeChannelRef.current = channel;
            } catch (err) {
                console.error('[NotificationBell] Initialization error:', err);
            }
        };

        initializeSession();

        // 3. Listen to auth state changes (sign in, sign out, token refresh)
        const { data: { subscription: authSub } } = supabase.auth.onAuthStateChange(
            (event, session) => {
                if (event === 'SIGNED_OUT' || !session?.user?.id) {
                    if (activeChannelRef.current) {
                        supabase.removeChannel(activeChannelRef.current);
                        activeChannelRef.current = null;
                    }
                    if (isMountedRef.current) {
                        setNotifications([]);
                        setUnreadCount(0);
                    }
                } else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
                    initializeSession();
                }
            }
        );

        return () => {
            isMountedRef.current = false;
            authSub?.unsubscribe();
            if (activeChannelRef.current) {
                supabase.removeChannel(activeChannelRef.current);
                activeChannelRef.current = null;
            }
        };
    }, [fetchNotifications]);

    // Close on click outside
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        }

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isOpen]);

    // Mark single notification as read
    const handleNotificationClick = async (notif: NotificationItem) => {
        if (!notif.is_read) {
            // Optimistic update
            setNotifications((prev) =>
                prev.map((n) => (n.id === notif.id ? { ...n, is_read: true, read_at: new Date().toISOString() } : n))
            );
            setUnreadCount((c) => Math.max(0, c - 1));

            try {
                const { data: { session } } = await supabase.auth.getSession();
                if (session?.access_token) {
                    await fetch(`/api/notifications/${notif.id}/read`, {
                        method: 'POST',
                        headers: {
                            Authorization: `Bearer ${session.access_token}`,
                        },
                    });
                }
            } catch (err) {
                console.error('[NotificationBell] Error marking read:', err);
            }
        }

        setIsOpen(false);

        // Deep link navigation
        if (user?.type === 'vendor') {
            router.push('/vendor/dashboard');
        } else {
            router.push('/dashboard/orders');
        }
    };

    // Mark all as read
    const handleMarkAllRead = async () => {
        if (unreadCount === 0) return;

        // Optimistic update
        setNotifications((prev) =>
            prev.map((n) => ({ ...n, is_read: true, read_at: new Date().toISOString() }))
        );
        setUnreadCount(0);

        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (session?.access_token) {
                await fetch('/api/notifications/read-all', {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${session.access_token}`,
                    },
                });
            }
        } catch (err) {
            console.error('[NotificationBell] Error marking all read:', err);
            fetchNotifications();
        }
    };

    const badgeDisplay = unreadCount > 9 ? '9+' : unreadCount > 0 ? String(unreadCount) : null;

    return (
        <div ref={dropdownRef} style={{ position: 'relative' }}>
            <button
                onClick={() => setIsOpen((prev) => !prev)}
                style={{
                    position: 'relative',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '38px',
                    height: '38px',
                    borderRadius: 'var(--radius)',
                    background: isOpen ? 'var(--bg-secondary)' : 'var(--bg)',
                    border: '1.5px solid var(--border)',
                    cursor: 'pointer',
                    color: 'var(--fg)',
                    transition: 'all 0.2s ease',
                }}
                aria-label="Notifications"
                aria-expanded={isOpen}
                aria-haspopup="true"
            >
                <Bell size={18} color="var(--fg)" />
                {badgeDisplay && (
                    <span
                        style={{
                            position: 'absolute',
                            top: '-4px',
                            right: '-4px',
                            background: '#ef4444',
                            color: '#ffffff',
                            fontSize: '10px',
                            fontWeight: '800',
                            height: '18px',
                            minWidth: '18px',
                            padding: '0 4px',
                            borderRadius: '10px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            boxShadow: '0 2px 5px rgba(239, 68, 68, 0.4)',
                            lineHeight: 1,
                        }}
                    >
                        {badgeDisplay}
                    </span>
                )}
            </button>

            {isOpen && (
                <div
                    style={{
                        position: 'absolute',
                        top: 'calc(100% + 8px)',
                        right: 0,
                        width: '340px',
                        maxWidth: 'calc(100vw - 24px)',
                        background: 'var(--bg)',
                        border: '1px solid var(--border)',
                        borderRadius: '16px',
                        boxShadow: '0 16px 40px rgba(0,0,0,0.2)',
                        zIndex: 1001,
                        overflow: 'hidden',
                        display: 'flex',
                        flexDirection: 'column',
                    }}
                >
                    {/* Header */}
                    <div
                        style={{
                            padding: '12px 16px',
                            borderBottom: '1px solid var(--border)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            background: 'var(--bg-secondary)',
                        }}
                    >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ fontSize: '14px', fontWeight: '800', color: 'var(--fg)' }}>
                                Notifications
                            </span>
                            {unreadCount > 0 && (
                                <span
                                    style={{
                                        fontSize: '11px',
                                        fontWeight: '700',
                                        background: 'rgba(239, 68, 68, 0.12)',
                                        color: '#ef4444',
                                        padding: '2px 7px',
                                        borderRadius: '12px',
                                    }}
                                >
                                    {unreadCount} new
                                </span>
                            )}
                        </div>

                        {unreadCount > 0 && (
                            <button
                                onClick={handleMarkAllRead}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                    background: 'transparent',
                                    border: 'none',
                                    color: 'var(--accent)',
                                    fontSize: '11px',
                                    fontWeight: '700',
                                    cursor: 'pointer',
                                    padding: '4px 6px',
                                    borderRadius: '6px',
                                }}
                            >
                                <Check size={12} />
                                Mark all as read
                            </button>
                        )}
                    </div>

                    {/* List */}
                    <div
                        style={{
                            maxHeight: '380px',
                            overflowY: 'auto',
                            display: 'flex',
                            flexDirection: 'column',
                        }}
                    >
                        {loading && notifications.length === 0 ? (
                            <div
                                style={{
                                    padding: '32px 16px',
                                    textAlign: 'center',
                                    color: 'var(--fg-muted)',
                                    fontSize: '12px',
                                }}
                            >
                                Loading notifications...
                            </div>
                        ) : notifications.length === 0 ? (
                            <div
                                style={{
                                    padding: '40px 16px',
                                    textAlign: 'center',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    alignItems: 'center',
                                    gap: '8px',
                                    color: 'var(--fg-muted)',
                                }}
                            >
                                <Inbox size={32} strokeWidth={1.5} />
                                <span style={{ fontSize: '13px', fontWeight: '600' }}>No notifications yet</span>
                                <span style={{ fontSize: '11px' }}>Updates about your orders will appear here.</span>
                            </div>
                        ) : (
                            notifications.map((notif) => {
                                const isUnread = !notif.is_read;
                                return (
                                    <div
                                        key={notif.id}
                                        onClick={() => handleNotificationClick(notif)}
                                        style={{
                                            padding: '12px 16px',
                                            borderBottom: '1px solid var(--border)',
                                            background: isUnread ? 'rgba(20, 184, 166, 0.05)' : 'transparent',
                                            cursor: 'pointer',
                                            display: 'flex',
                                            gap: '12px',
                                            alignItems: 'flex-start',
                                            transition: 'background 0.15s ease',
                                        }}
                                        className="dropdown-item"
                                    >
                                        <div
                                            style={{
                                                width: '32px',
                                                height: '32px',
                                                borderRadius: '50%',
                                                background: 'var(--bg-secondary)',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                flexShrink: 0,
                                                marginTop: '2px',
                                            }}
                                        >
                                            {getNotificationIcon(notif.type)}
                                        </div>

                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div
                                                style={{
                                                    display: 'flex',
                                                    justifyContent: 'space-between',
                                                    alignItems: 'baseline',
                                                    gap: '8px',
                                                    marginBottom: '2px',
                                                }}
                                            >
                                                <span
                                                    style={{
                                                        fontSize: '12px',
                                                        fontWeight: isUnread ? '800' : '600',
                                                        color: 'var(--fg)',
                                                        overflow: 'hidden',
                                                        textOverflow: 'ellipsis',
                                                        whiteSpace: 'nowrap',
                                                    }}
                                                >
                                                    {notif.title}
                                                </span>
                                                <span
                                                    style={{
                                                        fontSize: '10px',
                                                        color: 'var(--fg-muted)',
                                                        flexShrink: 0,
                                                    }}
                                                >
                                                    {formatRelativeTime(notif.created_at)}
                                                </span>
                                            </div>

                                            <p
                                                style={{
                                                    fontSize: '11px',
                                                    color: 'var(--fg-muted)',
                                                    margin: 0,
                                                    lineHeight: 1.4,
                                                    display: '-webkit-box',
                                                    WebkitLineClamp: 2,
                                                    WebkitBoxOrient: 'vertical',
                                                    overflow: 'hidden',
                                                }}
                                            >
                                                {notif.message}
                                            </p>
                                        </div>

                                        {isUnread && (
                                            <div
                                                style={{
                                                    width: '6px',
                                                    height: '6px',
                                                    borderRadius: '50%',
                                                    background: 'var(--accent)',
                                                    flexShrink: 0,
                                                    marginTop: '6px',
                                                }}
                                            />
                                        )}
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

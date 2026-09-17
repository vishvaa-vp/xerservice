'use client';

import { useReconnectRefresh } from '@/hooks/useReconnectRefresh';
import { useEffect, useState } from 'react';
import { CheckCircle2, Clock3, PackageCheck, Printer } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';

export type DisplayOrderStatus = 'pending' | 'printing' | 'ready' | 'completed' | 'QUEUED' | 'PRINTING' | 'READY' | 'COMPLETED' | 'DRAFT' | 'AWAITING_PAYMENT' | string;

export function OrderStatusChat({ status, orderId, shopName }: { status: DisplayOrderStatus; orderId: string; shopName: string }) {
    const [liveStatus, setLiveStatus] = useState<string>(status);

    useEffect(() => {
        setLiveStatus(status);
    }, [status]);

    useEffect(() => {
        if (!orderId) return;

        // Subscribe to live status changes on the orders table
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId);
        const filter = isUuid ? `id=eq.${orderId}` : `order_number=eq.${orderId}`;

        const channel = supabase
            .channel(`order_tracker_${orderId}`)
            .on('postgres_changes', {
                event: 'UPDATE',
                schema: 'public',
                table: 'orders',
                filter: filter,
            }, (payload) => {
                const updated = payload.new as any;
                if (updated?.status) {
                    setLiveStatus(updated.status);
                }
            })
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [orderId]);

    useReconnectRefresh(async () => {
        const isUuid = /^[0-9a-f-]{36}$/i.test(orderId);
        const { data, error } = await supabase.from('orders').select('status').eq(isUuid ? 'id' : 'order_number', orderId).maybeSingle();
        if (!error && data?.status) setLiveStatus(data.status);
    }, Boolean(orderId), 15_000);

    const normalized = (liveStatus || '').toUpperCase();
    let activeRank = 0;
    if (normalized === 'QUEUED' || normalized === 'PENDING' || normalized === 'AWAITING_PAYMENT' || normalized === 'DRAFT') {
        activeRank = 0;
    } else if (normalized === 'PRINTING') {
        activeRank = 1;
    } else if (normalized === 'READY') {
        activeRank = 2;
    } else if (normalized === 'COMPLETED') {
        activeRank = 3;
    }

    const isCompleted = normalized === 'COMPLETED';

    const steps = [
        {
            label: 'Queued',
            message: `Order #${orderId} is placed. ${shopName} will start printing soon.`,
            icon: Clock3,
        },
        {
            label: 'Printing and finishing',
            message: 'Your file is being printed and checked by the shop.',
            icon: Printer,
        },
        {
            label: 'Ready for pickup',
            message: 'Your print is ready. You can collect it from the shop.',
            icon: PackageCheck,
        },
        { label: 'Collected', message: 'Your print order has been collected. Thank you!', icon: CheckCircle2 },
    ];

    if (['CANCELLED', 'FAILED', 'DRAFT', 'AWAITING_PAYMENT'].includes(normalized)) return <div className="form-feedback" role="status"><strong>{normalized === 'CANCELLED' ? 'Order cancelled' : normalized === 'FAILED' ? 'Order needs attention' : 'Payment not confirmed'}</strong><p>{normalized === 'CANCELLED' ? 'Check your order details for refund updates.' : 'View your order details for the next step.'}</p></div>;

    return (
        <div className="order-chat" aria-live="polite" aria-label="Order status updates">
            <div className="order-chat-head">
                <div>
                    <p className="order-chat-kicker">Live order status</p>
                    <h2>Print progress</h2>
                </div>
                <span className="order-chat-id">#{orderId}</span>
            </div>

            <div className="order-chat-list">
                {steps.map((step, index) => {
                    const Icon = step.icon;
                    const isDone = activeRank > index || (isCompleted && index === steps.length - 1);
                    const isActive = (activeRank === index && !isCompleted);

                    return (
                        <div key={step.label} className={`order-chat-item ${isDone ? 'is-done' : ''} ${isActive ? 'is-active' : ''}`}>
                            <div className="order-chat-icon">
                                {isDone ? <CheckCircle2 size={17} /> : <Icon size={17} />}
                            </div>
                            <div className="order-chat-bubble">
                                <div className="order-chat-title-row">
                                    <h3>{step.label}</h3>
                                    <span>{isDone ? 'Completed' : isActive ? 'In Progress' : 'Waiting'}</span>
                                </div>
                                <p>{step.message}</p>
                            </div>
                        </div>
                    );
                })}
            </div>

            <style jsx>{`
                .order-chat {
                    width: 100%;
                    border: 1px solid var(--border);
                    background: var(--bg);
                    border-radius: 8px;
                    overflow: hidden;
                    box-shadow: var(--shadow-sm);
                    text-align: left;
                }
                .order-chat-head {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    gap: 16px;
                    padding: 18px 20px;
                    border-bottom: 1px solid var(--border);
                    background: var(--bg-secondary);
                }
                .order-chat-kicker {
                    margin: 0 0 3px;
                    font-size: 11px;
                    font-weight: 900;
                    color: var(--fg-subtle);
                    text-transform: uppercase;
                    letter-spacing: 0.08em;
                }
                .order-chat h2 {
                    margin: 0;
                    font-size: 18px;
                    font-weight: 900;
                    letter-spacing: 0;
                }
                .order-chat-id {
                    flex-shrink: 0;
                    border: 1px solid var(--border);
                    border-radius: 999px;
                    padding: 7px 11px;
                    background: var(--bg);
                    color: var(--accent);
                    font-size: 13px;
                    font-weight: 900;
                }
                .order-chat-list {
                    padding: 18px 20px 20px;
                    display: grid;
                    gap: 14px;
                }
                .order-chat-item {
                    display: grid;
                    grid-template-columns: 34px minmax(0, 1fr);
                    gap: 10px;
                    align-items: start;
                    opacity: 0.55;
                }
                .order-chat-item.is-done,
                .order-chat-item.is-active {
                    opacity: 1;
                }
                .order-chat-icon {
                    width: 34px;
                    height: 34px;
                    border-radius: 50%;
                    display: grid;
                    place-items: center;
                    color: var(--fg-muted);
                    background: var(--bg-secondary);
                    border: 1px solid var(--border);
                    margin-top: 3px;
                }
                .order-chat-item.is-done .order-chat-icon {
                    color: #16a34a;
                    background: rgba(34, 197, 94, 0.12);
                    border-color: rgba(34, 197, 94, 0.25);
                }
                .order-chat-item.is-active .order-chat-icon {
                    color: var(--accent);
                    background: var(--accent-muted);
                    border-color: var(--accent-border);
                    box-shadow: 0 0 0 4px var(--accent-muted);
                }
                .order-chat-bubble {
                    position: relative;
                    padding: 13px 14px;
                    border-radius: 8px;
                    background: var(--bg-secondary);
                    border: 1px solid var(--border);
                }
                .order-chat-item.is-active .order-chat-bubble {
                    background: linear-gradient(135deg, var(--accent-muted), var(--bg));
                    border-color: var(--accent-border);
                }
                .order-chat-title-row {
                    display: flex;
                    justify-content: space-between;
                    gap: 10px;
                    align-items: center;
                    margin-bottom: 4px;
                }
                .order-chat-title-row h3 {
                    margin: 0;
                    font-size: 14px;
                    font-weight: 900;
                    letter-spacing: 0;
                }
                .order-chat-title-row span {
                    flex-shrink: 0;
                    color: var(--fg-subtle);
                    font-size: 11px;
                    font-weight: 800;
                }
                .order-chat-bubble p {
                    margin: 0;
                    color: var(--fg-muted);
                    font-size: 13px;
                    line-height: 1.55;
                }
                @media (max-width: 520px) {
                    .order-chat-head {
                        align-items: flex-start;
                        flex-direction: column;
                        padding: 16px;
                    }
                    .order-chat-list {
                        padding: 16px;
                    }
                    .order-chat-item {
                        grid-template-columns: 30px minmax(0, 1fr);
                    }
                    .order-chat-icon {
                        width: 30px;
                        height: 30px;
                    }
                    .order-chat-title-row {
                        align-items: flex-start;
                        flex-direction: column;
                        gap: 2px;
                    }
                }
            `}</style>
        </div>
    );
}

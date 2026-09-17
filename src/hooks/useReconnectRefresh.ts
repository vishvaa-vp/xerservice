'use client';
import { useEffect, useRef } from 'react';

/** Reconcile after tab suspension or lost realtime events without overlapping requests. */
export function useReconnectRefresh(refresh: () => Promise<unknown>, enabled = true, intervalMs = 30_000) {
    const latest = useRef(refresh);
    latest.current = refresh;
    useEffect(() => {
        if (!enabled) return;
        let busy = false;
        let disposed = false;
        const run = async () => {
            if (busy || disposed || document.visibilityState === 'hidden' || !navigator.onLine) return;
            busy = true;
            try { await latest.current(); } catch { /* The owning view retains its recoverable error state. */ }
            finally { busy = false; }
        };
        const timer = window.setInterval(run, intervalMs);
        window.addEventListener('online', run);
        window.addEventListener('focus', run);
        document.addEventListener('visibilitychange', run);
        return () => { disposed = true; clearInterval(timer); window.removeEventListener('online', run); window.removeEventListener('focus', run); document.removeEventListener('visibilitychange', run); };
    }, [enabled, intervalMs]);
}

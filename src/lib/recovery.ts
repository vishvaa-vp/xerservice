/**
 * @src/lib/recovery.ts
 * Web application bridge and client storage adapter for Safe Order Recovery.
 */

export * from '../../packages/shared/src/recovery';
import type { OrderDraft } from '../../packages/shared/src/recovery';

const DRAFT_STORAGE_KEY = 'xerservice_order_draft_cache';

/**
 * Persists an order draft to client-side localStorage safely.
 * Will not throw on quota exceeded or SSR execution.
 */
export function saveLocalOrderDraft(draft: OrderDraft): boolean {
    if (typeof window === 'undefined' || !window.localStorage) return false;
    try {
        const payload = JSON.stringify({
            ...draft,
            updatedAt: new Date().toISOString(),
        });
        window.localStorage.setItem(DRAFT_STORAGE_KEY, payload);
        return true;
    } catch (err) {
        console.warn('[XerService Recovery] Failed to save local order draft to localStorage:', err);
        return false;
    }
}

/**
 * Retrieves the currently saved local order draft from localStorage.
 */
export function getLocalOrderDraft(): OrderDraft | null {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    try {
        const raw = window.localStorage.getItem(DRAFT_STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as OrderDraft;
        return parsed;
    } catch (err) {
        console.warn('[XerService Recovery] Failed to read local order draft:', err);
        return null;
    }
}

/**
 * Clears the order draft from localStorage (e.g. after successful order creation and payment).
 */
export function clearLocalOrderDraft(): void {
    if (typeof window === 'undefined' || !window.localStorage) return;
    try {
        window.localStorage.removeItem(DRAFT_STORAGE_KEY);
    } catch {
        /* ignore */
    }
}

/**
 * Authoritative Add-on Types for XerService
 * Pure domain models for print finishing add-ons (spiral binding, lamination, stapling, etc.).
 */

export interface AddonItem {
    id: string;
    name: string;
    description: string | null;
    imageUrl: string | null;
    estimatedMinutes: number;
    minPages: number;
    maxPages: number;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
}

export interface ShopAddonItem {
    id: string;
    shopId: string;
    addonId: string;
    price: number;
    isAvailable: boolean;
    addon: AddonItem;
}

export interface OrderFileAddonSnapshot {
    id?: string;
    orderId: string;
    orderFileId: string;
    shopAddonId: string;
    addonNameSnapshot: string;
    unitPriceSnapshot: number;
    quantity: number;
    totalPrice: number;
    estimatedMinutesSnapshot: number;
}

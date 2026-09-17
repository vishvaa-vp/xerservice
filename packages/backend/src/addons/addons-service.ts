/**
 * XerService Admin-Controlled Print Add-on Service
 *
 * Provides server-authoritative management, validation, snapshotting, and pricing
 * for print finishing add-ons (Spiral Binding, Stapling, Lamination, etc.).
 *
 * Dual-Mode Architecture:
 * - Queries PostgreSQL tables `addons`, `shop_addons`, `order_file_addons` when deployed.
 * - Gracefully falls back to an authoritative memory store with standard seeded
 *   catalog items (pre-migration push environment) without failing closed.
 */

import { getServiceRoleClient } from '../supabase/client';

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

// In-memory fallback catalog for pre-push environments
const SEED_ADDONS: AddonItem[] = [
    {
        id: 'addon-spiral-binding',
        name: 'Spiral Binding',
        description: 'Durable plastic/wire coil binding with transparent protective covers for reports and projects.',
        imageUrl: null,
        estimatedMinutes: 10,
        minPages: 10,
        maxPages: 200,
        isActive: true,
        createdAt: '2026-09-11T00:00:00.000Z',
        updatedAt: '2026-09-11T00:00:00.000Z',
    },
    {
        id: 'addon-stapling',
        name: 'Stapling',
        description: 'Corner or edge heavy-duty industrial stapling for multi-page assignments and documents.',
        imageUrl: null,
        estimatedMinutes: 2,
        minPages: 2,
        maxPages: 50,
        isActive: true,
        createdAt: '2026-09-11T00:00:00.000Z',
        updatedAt: '2026-09-11T00:00:00.000Z',
    },
    {
        id: 'addon-lamination',
        name: 'Lamination',
        description: 'Thermal water-resistant, glossy protective coating for certificates, posters, and ID cards.',
        imageUrl: null,
        estimatedMinutes: 5,
        minPages: 1,
        maxPages: 10,
        isActive: true,
        createdAt: '2026-09-11T00:00:00.000Z',
        updatedAt: '2026-09-11T00:00:00.000Z',
    },
    {
        id: 'addon-transparent-cover',
        name: 'Transparent Cover',
        description: 'Clear protective acetate front cover with stiff backing sheet.',
        imageUrl: null,
        estimatedMinutes: 3,
        minPages: 5,
        maxPages: 150,
        isActive: true,
        createdAt: '2026-09-11T00:00:00.000Z',
        updatedAt: '2026-09-11T00:00:00.000Z',
    },
    {
        id: 'addon-soft-binding',
        name: 'Soft Binding',
        description: 'Professional book-style spine tape binding for dissertations and comprehensive manuals.',
        imageUrl: null,
        estimatedMinutes: 15,
        minPages: 20,
        maxPages: 300,
        isActive: true,
        createdAt: '2026-09-11T00:00:00.000Z',
        updatedAt: '2026-09-11T00:00:00.000Z',
    },
];

// Fallback state stores
let memoryAddons: AddonItem[] = [...SEED_ADDONS];
let memoryShopAddons: Array<{
    id: string;
    shopId: string;
    addonId: string;
    price: number;
    isAvailable: boolean;
}> = [];

// Seed D-Block Reprography ITECH mappings
const DBLOCK_DEFAULT_SHOP_ID = '4fa63198-dbe3-485a-a38f-dc4454f0a996';
memoryShopAddons.push(
    {
        id: 'sa-dblock-spiral',
        shopId: DBLOCK_DEFAULT_SHOP_ID,
        addonId: 'addon-spiral-binding',
        price: 30.00,
        isAvailable: true,
    },
    {
        id: 'sa-dblock-stapling',
        shopId: DBLOCK_DEFAULT_SHOP_ID,
        addonId: 'addon-stapling',
        price: 5.00,
        isAvailable: true,
    }
);

let memoryOrderFileAddons: OrderFileAddonSnapshot[] = [];

function isTableMissing(error: any): boolean {
    if (!error) return false;
    const msg = error.message || '';
    return (
        error.code === 'PGRST205' ||
        error.code === '42P01' ||
        msg.includes('does not exist') ||
        msg.includes('schema cache')
    );
}

/**
 * Lists all catalog add-ons with their shop assignments (Admin Console)
 */
export async function listAdminAddons(): Promise<Array<AddonItem & { assignments: Array<{ shopId: string; shopName?: string; price: number; isAvailable: boolean }> }>> {
    const serviceClient = getServiceRoleClient();
    try {
        const { data: addons, error: addonsErr } = await serviceClient
            .from('addons')
            .select('*')
            .order('name');

        if (isTableMissing(addonsErr)) {
            // Memory fallback only when table is completely missing
            return memoryAddons.map(a => ({
                ...a,
                assignments: memoryShopAddons
                    .filter(sa => sa.addonId === a.id)
                    .map(sa => ({
                        shopId: sa.shopId,
                        shopName: 'D-Block Reprography ITECH',
                        price: sa.price,
                        isAvailable: sa.isAvailable,
                    })),
            }));
        }

        if (addonsErr || !addons) throw addonsErr || new Error('Failed to query addons table');

        const { data: shopAddons, error: saErr } = await serviceClient
            .from('shop_addons')
            .select('id, shop_id, addon_id, price, is_available, shops(name)');

        if (saErr) throw saErr;

        return addons.map(a => ({
            id: a.id,
            name: a.name,
            description: a.description,
            imageUrl: a.image_url,
            estimatedMinutes: a.estimated_minutes,
            minPages: a.min_pages,
            maxPages: a.max_pages,
            isActive: a.is_active,
            createdAt: a.created_at,
            updatedAt: a.updated_at,
            assignments: (shopAddons || [])
                .filter(sa => sa.addon_id === a.id)
                .map(sa => ({
                    shopId: sa.shop_id,
                    shopName: (sa.shops as any)?.name || 'Print Shop',
                    price: Number(sa.price),
                    isAvailable: sa.is_available,
                })),
        }));
    } catch (err: unknown) {
        if (isTableMissing(err)) {
            return memoryAddons.map(a => ({
                ...a,
                assignments: memoryShopAddons
                    .filter(sa => sa.addonId === a.id)
                    .map(sa => ({
                        shopId: sa.shopId,
                        shopName: 'D-Block Reprography ITECH',
                        price: sa.price,
                        isAvailable: sa.isAvailable,
                    })),
            }));
        }
        throw err;
    }
}

/**
 * Creates a new add-on (Admin Only)
 */
export async function createAdminAddon(input: {
    name: string;
    description?: string;
    imageUrl?: string;
    estimatedMinutes?: number;
    minPages?: number;
    maxPages?: number;
    price?: number;
    shopIds?: string[];
    shopAssignments?: Array<{ shopId: string; price?: number; isAvailable?: boolean }>;
}): Promise<AddonItem> {
    const serviceClient = getServiceRoleClient();
    const name = input.name.trim();
    if (!name) throw new Error('Add-on name is required.');

    const price = Number(input.price || 0);
    const estimatedMinutes = Math.max(0, Number(input.estimatedMinutes || 0));
    const minPages = Math.max(1, Number(input.minPages || 1));
    const maxPages = Math.max(minPages, Number(input.maxPages || 1000));

    const normalizedAssignments = input.shopAssignments && input.shopAssignments.length > 0
        ? input.shopAssignments.map(a => ({
            shopId: a.shopId,
            price: Number(a.price !== undefined ? a.price : price),
            isAvailable: a.isAvailable !== undefined ? a.isAvailable : true,
        }))
        : (input.shopIds && input.shopIds.length > 0)
            ? input.shopIds.map(shopId => ({
                shopId,
                price,
                isAvailable: true,
            }))
            : [];

    try {
        const { data: created, error } = await serviceClient
            .from('addons')
            .insert({
                name,
                description: input.description || null,
                image_url: input.imageUrl || null,
                estimated_minutes: estimatedMinutes,
                min_pages: minPages,
                max_pages: maxPages,
                is_active: true,
            })
            .select()
            .single();

        if (isTableMissing(error)) {
            // Memory fallback only if table missing
            const newItem: AddonItem = {
                id: `addon-${Date.now()}`,
                name,
                description: input.description || null,
                imageUrl: input.imageUrl || null,
                estimatedMinutes,
                minPages,
                maxPages,
                isActive: true,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            };
            memoryAddons.push(newItem);
            for (const a of normalizedAssignments) {
                memoryShopAddons.push({
                    id: `sa-${Date.now()}-${a.shopId.slice(0, 4)}`,
                    shopId: a.shopId,
                    addonId: newItem.id,
                    price: a.price,
                    isAvailable: a.isAvailable,
                });
            }
            return newItem;
        }

        if (error || !created) throw error || new Error('Failed to insert addon');

        // Assign to shops if provided
        if (normalizedAssignments.length > 0) {
            const rows = normalizedAssignments.map(a => ({
                shop_id: a.shopId,
                addon_id: created.id,
                price: a.price,
                is_available: a.isAvailable,
            }));
            const { error: saErr } = await serviceClient.from('shop_addons').insert(rows);
            if (saErr && !isTableMissing(saErr)) {
                console.warn('[addons-service] Failed to assign shops to addon:', saErr);
            }
        }

        return {
            id: created.id,
            name: created.name,
            description: created.description,
            imageUrl: created.image_url,
            estimatedMinutes: created.estimated_minutes,
            minPages: created.min_pages,
            maxPages: created.max_pages,
            isActive: created.is_active,
            createdAt: created.created_at,
            updatedAt: created.updated_at,
        };
    } catch (err: unknown) {
        if (isTableMissing(err)) {
            const newItem: AddonItem = {
                id: `addon-${Date.now()}`,
                name,
                description: input.description || null,
                imageUrl: input.imageUrl || null,
                estimatedMinutes,
                minPages,
                maxPages,
                isActive: true,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            };
            memoryAddons.push(newItem);
            return newItem;
        }
        throw err;
    }
}

/**
 * Updates an add-on (Admin Only)
 */
export async function updateAdminAddon(id: string, input: {
    name?: string;
    description?: string | null;
    imageUrl?: string | null;
    estimatedMinutes?: number;
    minPages?: number;
    maxPages?: number;
    isActive?: boolean;
    shopIds?: string[];
    shopAssignments?: Array<{ shopId: string; price?: number; isAvailable?: boolean }>;
}): Promise<void> {
    const serviceClient = getServiceRoleClient();

    try {
        const payload: Record<string, any> = { updated_at: new Date().toISOString() };
        if (input.name !== undefined) payload.name = input.name.trim();
        if (input.description !== undefined) payload.description = input.description;
        if (input.imageUrl !== undefined) payload.image_url = input.imageUrl;
        if (input.estimatedMinutes !== undefined) payload.estimated_minutes = Math.max(0, input.estimatedMinutes);
        if (input.minPages !== undefined) payload.min_pages = Math.max(1, input.minPages);
        if (input.maxPages !== undefined) payload.max_pages = Math.max(input.minPages || 1, input.maxPages);
        if (input.isActive !== undefined) payload.is_active = input.isActive;

        const { error } = await serviceClient
            .from('addons')
            .update(payload)
            .eq('id', id);

        const targetAssignments = input.shopAssignments !== undefined
            ? input.shopAssignments
            : input.shopIds !== undefined
                ? input.shopIds.map(shopId => ({ shopId, price: undefined, isAvailable: true }))
                : undefined;

        if (isTableMissing(error)) {
            // Memory fallback
            const idx = memoryAddons.findIndex(a => a.id === id);
            if (idx !== -1) {
                memoryAddons[idx] = {
                    ...memoryAddons[idx],
                    ...payload,
                    estimatedMinutes: payload.estimated_minutes ?? memoryAddons[idx].estimatedMinutes,
                    minPages: payload.min_pages ?? memoryAddons[idx].minPages,
                    maxPages: payload.max_pages ?? memoryAddons[idx].maxPages,
                    isActive: payload.is_active ?? memoryAddons[idx].isActive,
                    imageUrl: payload.image_url ?? memoryAddons[idx].imageUrl,
                    updatedAt: new Date().toISOString(),
                };
            }
            if (targetAssignments !== undefined) {
                const targetIds = new Set(targetAssignments.map(a => a.shopId));
                // Remove assignments not in target
                memoryShopAddons = memoryShopAddons.filter(sa => sa.addonId !== id || targetIds.has(sa.shopId));
                // Upsert target assignments
                for (const assignment of targetAssignments) {
                    const saIdx = memoryShopAddons.findIndex(sa => sa.addonId === id && sa.shopId === assignment.shopId);
                    if (saIdx !== -1) {
                        if (assignment.price !== undefined) memoryShopAddons[saIdx].price = Number(assignment.price);
                        if (assignment.isAvailable !== undefined) memoryShopAddons[saIdx].isAvailable = assignment.isAvailable;
                    } else {
                        memoryShopAddons.push({
                            id: `sa-${Date.now()}-${assignment.shopId.slice(0, 4)}`,
                            shopId: assignment.shopId,
                            addonId: id,
                            price: Number(assignment.price || 0),
                            isAvailable: assignment.isAvailable ?? true,
                        });
                    }
                }
            }
            return;
        }

        if (targetAssignments !== undefined) {
            // Synchronize shop assignments in Supabase
            const { data: currentAssignments } = await serviceClient
                .from('shop_addons')
                .select('id, shop_id, price')
                .eq('addon_id', id);

            const targetShopIds = new Set(targetAssignments.map(a => a.shopId));

            // 1. Remove or disable deselected shops
            for (const curr of currentAssignments || []) {
                if (!targetShopIds.has(curr.shop_id)) {
                    // Check if referenced in historical orders
                    const { data: usage } = await serviceClient
                        .from('order_file_addons')
                        .select('id')
                        .eq('shop_addon_id', curr.id)
                        .limit(1);

                    if (usage && usage.length > 0) {
                        // Soft disable
                        await serviceClient
                            .from('shop_addons')
                            .update({ is_available: false, updated_at: new Date().toISOString() })
                            .eq('id', curr.id);
                    } else {
                        // Safe to permanently delete assignment
                        await serviceClient
                            .from('shop_addons')
                            .delete()
                            .eq('id', curr.id);
                    }
                }
            }

            // 2. Upsert selected shop assignments
            for (const assignment of targetAssignments) {
                const existing = (currentAssignments || []).find(c => c.shop_id === assignment.shopId);
                const finalPrice = assignment.price !== undefined
                    ? Number(assignment.price)
                    : existing ? Number(existing.price) : 0;

                const { error: saErr } = await serviceClient.from('shop_addons').upsert({
                    shop_id: assignment.shopId,
                    addon_id: id,
                    price: finalPrice,
                    is_available: assignment.isAvailable ?? true,
                    updated_at: new Date().toISOString(),
                }, { onConflict: 'shop_id,addon_id' });
                if (saErr && !isTableMissing(saErr)) throw saErr;
            }
        }
    } catch (err: unknown) {
        if (isTableMissing(err)) {
            const idx = memoryAddons.findIndex(a => a.id === id);
            if (idx !== -1) {
                if (input.name !== undefined) memoryAddons[idx].name = input.name;
                if (input.isActive !== undefined) memoryAddons[idx].isActive = input.isActive;
            }
            return;
        }
        throw err;
    }
}

/**
 * Soft-deletes or deletes an add-on (Admin Only).
 * If previously used in paid orders, sets is_active = false to prevent damaging historical orders.
 */
export async function deleteAdminAddon(id: string): Promise<{ deleted: boolean; softDisabled: boolean }> {
    const serviceClient = getServiceRoleClient();

    try {
        // Check if any order_file_addons reference this add-on
        const { data: usage, error: usageErr } = await serviceClient
            .from('order_file_addons')
            .select('id, shop_addons!inner(addon_id)')
            .eq('shop_addons.addon_id', id)
            .limit(1);

        if (usageErr && !isTableMissing(usageErr)) throw usageErr;

        if (usage && usage.length > 0) {
            // Soft-disable to protect historical snapshot references
            const { error: updErr } = await serviceClient.from('addons').update({ is_active: false }).eq('id', id);
            if (updErr && !isTableMissing(updErr)) throw updErr;
            return { deleted: false, softDisabled: true };
        }

        // Try direct deletion
        await serviceClient.from('shop_addons').delete().eq('addon_id', id);
        const { error } = await serviceClient.from('addons').delete().eq('id', id);

        if (isTableMissing(error)) {
            const idx = memoryAddons.findIndex(a => a.id === id);
            if (idx !== -1) memoryAddons[idx].isActive = false;
            return { deleted: false, softDisabled: true };
        }

        if (error) throw error;

        return { deleted: true, softDisabled: false };
    } catch (err: unknown) {
        if (isTableMissing(err)) {
            const idx = memoryAddons.findIndex(a => a.id === id);
            if (idx !== -1) memoryAddons[idx].isActive = false;
            return { deleted: false, softDisabled: true };
        }
        throw err;
    }
}

/**
 * Retrieves configured add-ons for a vendor's shop (Vendor Read-Only view)
 */
export async function getVendorShopAddons(shopId: string): Promise<ShopAddonItem[]> {
    const serviceClient = getServiceRoleClient();

    try {
        const { data: shopAddons, error } = await serviceClient
            .from('shop_addons')
            .select(`
                id,
                shop_id,
                addon_id,
                price,
                is_available,
                addons (
                    id,
                    name,
                    description,
                    image_url,
                    estimated_minutes,
                    min_pages,
                    max_pages,
                    is_active,
                    created_at,
                    updated_at
                )
            `)
            .eq('shop_id', shopId);

        if (isTableMissing(error) || !shopAddons) {
            // Memory fallback: find assignments for this shop
            const matched = memoryShopAddons.filter(sa => sa.shopId === shopId);
            return matched.map(sa => {
                const addon = memoryAddons.find(a => a.id === sa.addonId) || SEED_ADDONS[0];
                return {
                    id: sa.id,
                    shopId: sa.shopId,
                    addonId: sa.addonId,
                    price: sa.price,
                    isAvailable: sa.isAvailable,
                    addon,
                };
            });
        }

        return shopAddons.map(sa => ({
            id: sa.id,
            shopId: sa.shop_id,
            addonId: sa.addon_id,
            price: Number(sa.price),
            isAvailable: sa.is_available,
            addon: {
                id: (sa.addons as any).id,
                name: (sa.addons as any).name,
                description: (sa.addons as any).description,
                imageUrl: (sa.addons as any).image_url,
                estimatedMinutes: (sa.addons as any).estimated_minutes,
                minPages: (sa.addons as any).min_pages,
                maxPages: (sa.addons as any).max_pages,
                isActive: (sa.addons as any).is_active,
                createdAt: (sa.addons as any).created_at,
                updatedAt: (sa.addons as any).updated_at,
            },
        }));
    } catch {
        const matched = memoryShopAddons.filter(sa => sa.shopId === shopId);
        return matched.map(sa => ({
            id: sa.id,
            shopId: sa.shopId,
            addonId: sa.addonId,
            price: sa.price,
            isAvailable: sa.isAvailable,
            addon: memoryAddons.find(a => a.id === sa.addonId) || SEED_ADDONS[0],
        }));
    }
}

/**
 * Toggles availability of an add-on for a vendor shop (Vendor Availability Switch).
 * Vendor CANNOT modify price, name, or rules.
 */
export async function updateVendorAddonAvailability(shopAddonId: string, shopId: string, isAvailable: boolean): Promise<boolean> {
    const serviceClient = getServiceRoleClient();

    try {
        const { error } = await serviceClient
            .from('shop_addons')
            .update({ is_available: isAvailable, updated_at: new Date().toISOString() })
            .eq('id', shopAddonId)
            .eq('shop_id', shopId);

        if (isTableMissing(error)) {
            const idx = memoryShopAddons.findIndex(sa => (sa.id === shopAddonId || sa.addonId === shopAddonId) && sa.shopId === shopId);
            if (idx !== -1) {
                memoryShopAddons[idx].isAvailable = isAvailable;
                return true;
            }
            return false;
        }

        return !error;
    } catch {
        const idx = memoryShopAddons.findIndex(sa => (sa.id === shopAddonId || sa.addonId === shopAddonId) && sa.shopId === shopId);
        if (idx !== -1) {
            memoryShopAddons[idx].isAvailable = isAvailable;
            return true;
        }
        return false;
    }
}

/**
 * Retrieves active, available add-ons for customer display during print settings.
 * Only returns add-ons where:
 * - Add-on is globally active (is_active = true)
 * - Assigned to selected shop
 * - Shop add-on is available (is_available = true)
 */
export async function getShopAvailableAddons(shopId: string): Promise<Array<{
    shopAddonId: string;
    addonId: string;
    name: string;
    description: string | null;
    imageUrl: string | null;
    price: number;
    estimatedMinutes: number;
    minPages: number;
    maxPages: number;
}>> {
    const serviceClient = getServiceRoleClient();

    try {
        const { data, error } = await serviceClient
            .from('shop_addons')
            .select(`
                id,
                shop_id,
                addon_id,
                price,
                is_available,
                addons!inner (
                    id,
                    name,
                    description,
                    image_url,
                    estimated_minutes,
                    min_pages,
                    max_pages,
                    is_active
                )
            `)
            .eq('shop_id', shopId)
            .eq('is_available', true)
            .eq('addons.is_active', true);

        if (isTableMissing(error) || !data) {
            // Memory fallback
            const shopItems = memoryShopAddons.filter(sa => sa.shopId === shopId && sa.isAvailable);
            return shopItems.map(sa => {
                const a = memoryAddons.find(item => item.id === sa.addonId && item.isActive);
                if (!a) return null;
                return {
                    shopAddonId: sa.id,
                    addonId: a.id,
                    name: a.name,
                    description: a.description,
                    imageUrl: a.imageUrl,
                    price: sa.price,
                    estimatedMinutes: a.estimatedMinutes,
                    minPages: a.minPages,
                    maxPages: a.maxPages,
                };
            }).filter(Boolean) as any[];
        }

        return data.map(item => {
            const a = item.addons as any;
            return {
                shopAddonId: item.id,
                addonId: a.id,
                name: a.name,
                description: a.description,
                imageUrl: a.image_url,
                price: Number(item.price),
                estimatedMinutes: a.estimated_minutes,
                minPages: a.min_pages,
                maxPages: a.max_pages,
            };
        });
    } catch {
        const shopItems = memoryShopAddons.filter(sa => sa.shopId === shopId && sa.isAvailable);
        return shopItems.map(sa => {
            const a = memoryAddons.find(item => item.id === sa.addonId && item.isActive);
            if (!a) return null;
            return {
                shopAddonId: sa.id,
                addonId: a.id,
                name: a.name,
                description: a.description,
                imageUrl: a.imageUrl,
                price: sa.price,
                estimatedMinutes: a.estimatedMinutes,
                minPages: a.minPages,
                maxPages: a.maxPages,
            };
        }).filter(Boolean) as any[];
    }
}

/**
 * Server-authoritatively validates and calculates per-file add-ons for an order.
 * Re-checks DB price, active status, shop availability, and page bounds.
 * Never trusts client price.
 */
export async function validateAndCalculateOrderAddons(
    shopId: string,
    fileSelections: Array<{
        orderFileId: string;
        printablePages: number;
        addons: Array<{ shopAddonId: string; quantity?: number }>;
    }>
): Promise<{
    addonsSubtotal: number;
    maxEstimatedMinutes: number;
    snapshots: OrderFileAddonSnapshot[];
}> {
    const available = await getShopAvailableAddons(shopId);
    const availableMap = new Map(available.map(a => [a.shopAddonId, a]));
    // Also map by addonId for flexible matching
    const addonIdMap = new Map(available.map(a => [a.addonId, a]));

    let addonsSubtotal = 0;
    let maxEstimatedMinutes = 0;
    const snapshots: OrderFileAddonSnapshot[] = [];

    for (const file of fileSelections) {
        if (!file.addons || file.addons.length === 0) continue;

        for (const selection of file.addons) {
            const matched = availableMap.get(selection.shopAddonId) || addonIdMap.get(selection.shopAddonId);
            if (!matched) {
                throw new Error(`The selected add-on is not available at this shop.`);
            }

            // Enforce page limits
            if (file.printablePages < matched.minPages) {
                throw new Error(`"${matched.name}" requires at least ${matched.minPages} pages (this document has ${file.printablePages} pages).`);
            }
            if (file.printablePages > matched.maxPages) {
                throw new Error(`"${matched.name}" cannot exceed ${matched.maxPages} pages (this document has ${file.printablePages} pages).`);
            }

            const qty = Math.max(1, selection.quantity || 1);
            const lineTotal = Math.round(matched.price * qty * 100) / 100;

            addonsSubtotal += lineTotal;
            if (matched.estimatedMinutes > maxEstimatedMinutes) {
                maxEstimatedMinutes = matched.estimatedMinutes;
            }

            snapshots.push({
                orderId: '', // Filled by caller
                orderFileId: file.orderFileId,
                shopAddonId: matched.shopAddonId,
                addonNameSnapshot: matched.name,
                unitPriceSnapshot: matched.price,
                quantity: qty,
                totalPrice: lineTotal,
                estimatedMinutesSnapshot: matched.estimatedMinutes,
            });
        }
    }

    return {
        addonsSubtotal: Math.round(addonsSubtotal * 100) / 100,
        maxEstimatedMinutes,
        snapshots,
    };
}

/**
 * Persists order_file_addons snapshots to database (or memory fallback).
 */
export async function persistOrderFileAddonSnapshots(
    orderId: string,
    snapshots: OrderFileAddonSnapshot[]
): Promise<void> {
    const serviceClient = getServiceRoleClient();

    try {
        // Delete previous snapshots for this order
        const { error: delError } = await serviceClient
            .from('order_file_addons')
            .delete()
            .eq('order_id', orderId);

        if (isTableMissing(delError)) {
            // Memory fallback
            memoryOrderFileAddons = memoryOrderFileAddons.filter(s => s.orderId !== orderId);
            for (const s of snapshots) {
                memoryOrderFileAddons.push({ ...s, orderId, id: `ofa-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` });
            }
            return;
        }

        if (snapshots.length === 0) return;

        const rows = snapshots.map(s => ({
            order_id: orderId,
            order_file_id: s.orderFileId,
            shop_addon_id: s.shopAddonId,
            addon_name_snapshot: s.addonNameSnapshot,
            unit_price_snapshot: s.unitPriceSnapshot,
            quantity: s.quantity,
            total_price: s.totalPrice,
            estimated_minutes_snapshot: s.estimatedMinutesSnapshot,
        }));

        const { error: insertErr } = await serviceClient.from('order_file_addons').insert(rows);
        if (insertErr) {
            if (isTableMissing(insertErr)) {
                memoryOrderFileAddons = memoryOrderFileAddons.filter(s => s.orderId !== orderId);
                for (const s of snapshots) {
                    memoryOrderFileAddons.push({ ...s, orderId, id: `ofa-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` });
                }
                return;
            }
            throw insertErr;
        }
    } catch (err: unknown) {
        if (isTableMissing(err)) {
            memoryOrderFileAddons = memoryOrderFileAddons.filter(s => s.orderId !== orderId);
            for (const s of snapshots) {
                memoryOrderFileAddons.push({ ...s, orderId, id: `ofa-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` });
            }
            return;
        }
        throw err;
    }
}

/**
 * Retrieves immutable order_file_addons snapshots for an order.
 */
export async function getOrderFileAddonSnapshots(orderId: string): Promise<OrderFileAddonSnapshot[]> {
    const serviceClient = getServiceRoleClient();

    try {
        const { data, error } = await serviceClient
            .from('order_file_addons')
            .select('*')
            .eq('order_id', orderId);

        if (isTableMissing(error) || !data) {
            return memoryOrderFileAddons.filter(s => s.orderId === orderId);
        }

        return data.map(d => ({
            id: d.id,
            orderId: d.order_id,
            orderFileId: d.order_file_id,
            shopAddonId: d.shop_addon_id,
            addonNameSnapshot: d.addon_name_snapshot,
            unitPriceSnapshot: Number(d.unit_price_snapshot),
            quantity: d.quantity,
            totalPrice: Number(d.total_price),
            estimatedMinutesSnapshot: d.estimated_minutes_snapshot,
        }));
    } catch {
        return memoryOrderFileAddons.filter(s => s.orderId === orderId);
    }
}

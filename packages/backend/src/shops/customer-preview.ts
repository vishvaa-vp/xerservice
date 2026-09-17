/**
 * Shop Customer Preview Engine
 * Authoritative generation of customer-view metadata, storefront card representation,
 * and supported settings/capabilities inspection before a shop goes live.
 */

export interface CustomerPreviewAddon {
    name: string;
    price: number;
    priceUnit: string | null;
}

export interface ShopCustomerPreview {
    shopId: string;
    name: string;
    address: string | null;
    contactPhone: string | null;
    openTime: string;
    closeTime: string;
    status: 'OPEN' | 'PAUSED' | 'CLOSED';
    closingSoon: boolean;
    closingMessage: string | null;
    photos: string[];
    imageUrl?: string;
    imageInitials: string;
    startingPrice: number | null;
    startingPriceBasis: string;
    priceColorPerPage: number | null;
    priceBwDoublePerPage: number | null;
    supportedServices: string[];
    supportedCapabilities: {
        paperSizes: string[];
        printModes: string[];
        duplexModes: string[];
        activeAddons: CustomerPreviewAddon[];
    };
}

export interface BuildCustomerPreviewInput {
    shop: {
        id: string;
        name: string;
        open_time?: string | null;
        close_time?: string | null;
        status?: string | null;
        closing_soon?: boolean | null;
        closing_message?: string | null;
        [key: string]: any;
    };
    metadata?: {
        address?: string | null;
        contactPhone?: string | null;
        photos?: string[] | null;
        publishStatus?: string | null;
        [key: string]: any;
    } | null;
    pricingRows?: Array<{
        paper_size: string;
        print_mode: string;
        sides: string;
        price_per_sheet: number;
        active: boolean;
    }> | null;
    addons?: Array<{
        name?: string;
        price: number;
        priceUnit?: string | null;
        available?: boolean;
        addons?: any;
        [key: string]: any;
    }> | null;
}

export function formatPreviewTime(timeStr?: string | null): string {
    if (!timeStr) return '09:00 AM';
    const clean = timeStr.trim();
    const parts = clean.split(':');
    if (parts.length < 2) return clean;
    const hours = parseInt(parts[0], 10);
    const minutes = parseInt(parts[1], 10);
    if (isNaN(hours)) return clean;

    const period = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 === 0 ? 12 : hours % 12;
    const displayMinutes = isNaN(minutes) ? '00' : minutes.toString().padStart(2, '0');
    return `${displayHours}:${displayMinutes} ${period}`;
}

export function getPreviewInitials(name: string): string {
    const parts = (name || '').trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return 'XS';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
}

/**
 * Builds standard customer-facing storefront preview metadata.
 */
export function buildShopCustomerPreview(input: BuildCustomerPreviewInput): ShopCustomerPreview {
    const shop = input.shop;
    const meta = input.metadata || {};
    const pricing = Array.isArray(input.pricingRows) ? input.pricingRows : [];
    const addons = Array.isArray(input.addons) ? input.addons : [];

    const activeRates = pricing.filter(r => r.active && Number(r.price_per_sheet) > 0);

    // Capabilities discovery
    const paperSizesSet = new Set<string>();
    const printModesSet = new Set<string>();
    const duplexModesSet = new Set<string>();

    let bwSinglePrice: number | null = null;
    let bwDoublePrice: number | null = null;
    let colorSinglePrice: number | null = null;
    let colorDoublePrice: number | null = null;

    for (const r of activeRates) {
        paperSizesSet.add(r.paper_size);
        printModesSet.add(r.print_mode);
        duplexModesSet.add(r.sides);

        if (r.paper_size === 'A4') {
            if (r.print_mode === 'BW') {
                if (r.sides === 'SINGLE' && (bwSinglePrice === null || Number(r.price_per_sheet) < bwSinglePrice)) {
                    bwSinglePrice = Number(r.price_per_sheet);
                }
                if ((r.sides === 'DOUBLE_LONG_EDGE' || r.sides === 'DOUBLE_SHORT_EDGE') && (bwDoublePrice === null || Number(r.price_per_sheet) < bwDoublePrice)) {
                    bwDoublePrice = Number(r.price_per_sheet);
                }
            } else if (r.print_mode === 'COLOUR') {
                if (r.sides === 'SINGLE' && (colorSinglePrice === null || Number(r.price_per_sheet) < colorSinglePrice)) {
                    colorSinglePrice = Number(r.price_per_sheet);
                }
                if ((r.sides === 'DOUBLE_LONG_EDGE' || r.sides === 'DOUBLE_SHORT_EDGE') && (colorDoublePrice === null || Number(r.price_per_sheet) < colorDoublePrice)) {
                    colorDoublePrice = Number(r.price_per_sheet);
                }
            }
        }
    }

    // Active Addons discovery
    const activeAddons: CustomerPreviewAddon[] = [];
    for (const a of addons) {
        if (a.available !== false) {
            const rel = Array.isArray(a.addons) ? a.addons[0] : a.addons;
            const name = a.name || rel?.name || 'Add-on';
            const priceUnit = a.priceUnit || rel?.price_unit || null;
            activeAddons.push({
                name,
                price: Number(a.price || 0),
                priceUnit,
            });
        }
    }

    // Supported Services Chips
    const services: string[] = [];
    if (paperSizesSet.has('A4')) services.push('A4');
    if (printModesSet.has('BW')) services.push('B&W');
    if (printModesSet.has('COLOUR')) services.push('Colour');
    if (duplexModesSet.has('DOUBLE_LONG_EDGE') || duplexModesSet.has('DOUBLE_SHORT_EDGE')) services.push('Duplex');
    if (paperSizesSet.has('A3')) services.push('A3');
    if (paperSizesSet.has('LEGAL')) services.push('Legal');
    for (const addon of activeAddons.slice(0, 3)) {
        services.push(addon.name);
    }

    // Starting price basis
    let startingPrice: number | null = null;
    let startingPriceBasis = 'per sheet';

    if (bwSinglePrice !== null) {
        startingPrice = bwSinglePrice;
        startingPriceBasis = 'per sheet A4 B&W';
    } else if (activeRates.length > 0) {
        const lowestRate = activeRates.reduce((min, cur) =>
            Number(cur.price_per_sheet) < Number(min.price_per_sheet) ? cur : min, activeRates[0]);
        startingPrice = Number(lowestRate.price_per_sheet);
        startingPriceBasis = `per sheet ${lowestRate.paper_size} ${lowestRate.print_mode}`;
    }

    const photos = Array.isArray(meta.photos)
        ? meta.photos.filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
        : [];
    const imageUrl = photos[0];
    const imageInitials = getPreviewInitials(shop.name);

    const openTimeFormatted = formatPreviewTime(shop.open_time || '09:00:00');
    const closeTimeFormatted = formatPreviewTime(shop.close_time || '20:00:00');

    const statusUpper = (shop.status || 'CLOSED').toUpperCase();
    const status: 'OPEN' | 'PAUSED' | 'CLOSED' =
        statusUpper === 'OPEN' ? 'OPEN' : (statusUpper === 'PAUSED' ? 'PAUSED' : 'CLOSED');

    return {
        shopId: shop.id,
        name: shop.name,
        address: meta.address || null,
        contactPhone: meta.contactPhone || null,
        openTime: openTimeFormatted,
        closeTime: closeTimeFormatted,
        status,
        closingSoon: Boolean(shop.closing_soon),
        closingMessage: shop.closing_message || null,
        photos,
        imageUrl,
        imageInitials,
        startingPrice,
        startingPriceBasis,
        priceColorPerPage: colorSinglePrice,
        priceBwDoublePerPage: bwDoublePrice,
        supportedServices: services,
        supportedCapabilities: {
            paperSizes: Array.from(paperSizesSet).sort(),
            printModes: Array.from(printModesSet).sort(),
            duplexModes: Array.from(duplexModesSet).sort(),
            activeAddons,
        },
    };
}

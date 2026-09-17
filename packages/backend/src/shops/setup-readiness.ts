/**
 * Shop Setup Readiness Engine
 * Authoritative evaluation of shop onboarding prerequisites to prevent broken customer flows.
 * Evaluates 6 key dimensions: Identity/Address, Contact Phone, Hours, Photos, Rate Matrix, and Commission Rule.
 */

export type ReadinessDimensionId = 'identity' | 'contact' | 'hours' | 'photos' | 'pricing' | 'commission';

export interface ReadinessItem {
    id: ReadinessDimensionId;
    category: string;
    title: string;
    description: string;
    status: 'COMPLETE' | 'MISSING';
    isBlocker: boolean;
    details?: string;
    missingKeys?: string[];
    actionLabel: string;
    actionTab: 'profile' | 'pricing' | 'commission';
}

export interface ShopReadinessReport {
    scorePercent: number;
    isReadyToPublish: boolean;
    blockersCount: number;
    completedCount: number;
    totalChecks: number;
    items: ReadinessItem[];
    summaryMessage: string;
}

export interface ShopPricingRow {
    paper_size: string;
    print_mode: string;
    sides: string;
    price_per_sheet: number;
    active: boolean;
}

export interface ShopCommissionRule {
    id?: string;
    shop_id?: string;
    is_active?: boolean;
    commission_bps?: number;
    [key: string]: any;
}

export interface ShopReadinessInput {
    shop: {
        id?: string;
        name?: string | null;
        open_time?: string | null;
        close_time?: string | null;
        status?: string | null;
        [key: string]: any;
    };
    metadata?: {
        address?: string | null;
        contactPhone?: string | null;
        photos?: string[] | null;
        publishStatus?: string | null;
        [key: string]: any;
    } | null;
    ownerPhone?: string | null;
    pricingRows?: ShopPricingRow[] | null;
    activeCommissionRule?: ShopCommissionRule | null;
}

/**
 * Evaluates whether a shop satisfies all operational prerequisites to safely serve customer print orders.
 */
export function evaluateShopSetupReadiness(input: ShopReadinessInput): ShopReadinessReport {
    const items: ReadinessItem[] = [];

    // 1. Identity & Locality: Shop Name & Address
    const hasName = Boolean(input.shop?.name && input.shop.name.trim().length > 0);
    const hasAddress = Boolean(input.metadata?.address && input.metadata.address.trim().length > 0);
    const identityComplete = hasName && hasAddress;

    let identityDetails = 'Shop name and physical address are both verified.';
    const missingIdentityKeys: string[] = [];
    if (!hasName) missingIdentityKeys.push('Shop Name');
    if (!hasAddress) missingIdentityKeys.push('Physical Address / Locality');
    if (!identityComplete) {
        identityDetails = `Missing required fields: ${missingIdentityKeys.join(', ')}.`;
    }

    items.push({
        id: 'identity',
        category: 'Storefront Identity',
        title: 'Shop Name & Locality',
        description: 'Every shop requires a public display name and physical address for customer pickup.',
        status: identityComplete ? 'COMPLETE' : 'MISSING',
        isBlocker: true,
        details: identityDetails,
        missingKeys: missingIdentityKeys.length > 0 ? missingIdentityKeys : undefined,
        actionLabel: 'Set Name & Address →',
        actionTab: 'profile',
    });

    // 2. Contact Phone: Phone for Customer / Order Alerts
    const contactPhone = input.metadata?.contactPhone?.trim() || input.ownerPhone?.trim();
    const contactComplete = Boolean(contactPhone && contactPhone.length >= 7);
    items.push({
        id: 'contact',
        category: 'Customer Communications',
        title: 'Contact Phone Number',
        description: 'Verified phone number for customer pickup inquiries and urgent printing notices.',
        status: contactComplete ? 'COMPLETE' : 'MISSING',
        isBlocker: true,
        details: contactComplete
            ? `Verified contact phone: ${contactPhone}`
            : 'No contact phone provided in shop profile or owner account.',
        actionLabel: 'Add Contact Phone →',
        actionTab: 'profile',
    });

    // 3. Operating Hours: Open & Close Times
    const openTime = input.shop?.open_time?.trim();
    const closeTime = input.shop?.close_time?.trim();
    const hoursComplete = Boolean(openTime && closeTime);
    items.push({
        id: 'hours',
        category: 'Trading Operations',
        title: 'Daily Operating Hours',
        description: 'Defined opening and closing hours prevent customers from ordering when equipment is offline.',
        status: hoursComplete ? 'COMPLETE' : 'MISSING',
        isBlocker: true,
        details: (hoursComplete && openTime && closeTime)
            ? `Configured schedule: ${openTime.slice(0, 5)} to ${closeTime.slice(0, 5)}`
            : 'Daily opening or closing time is missing.',
        actionLabel: 'Configure Hours →',
        actionTab: 'profile',
    });

    // 4. Storefront Media: Photos
    const photos = Array.isArray(input.metadata?.photos)
        ? input.metadata.photos.filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
        : [];
    const photosComplete = photos.length > 0;
    items.push({
        id: 'photos',
        category: 'Storefront Visuals',
        title: 'Storefront Media & Photos',
        description: 'At least one photo of the shop banner, entrance, or counters for customer recognition.',
        status: photosComplete ? 'COMPLETE' : 'MISSING',
        isBlocker: true,
        details: photosComplete
            ? `${photos.length} storefront photo(s) uploaded.`
            : 'No storefront photos or banners uploaded.',
        actionLabel: 'Upload Photo →',
        actionTab: 'profile',
    });

    // 5. Core Rate Matrix: Essential Print Pricing
    // Core requirements: A4 B&W Single, A4 B&W Double Long Edge, A4 Colour Single
    const pricing = Array.isArray(input.pricingRows) ? input.pricingRows : [];
    const missingRates: string[] = [];

    const hasBwSingle = pricing.some(
        r => r.paper_size === 'A4' && r.print_mode === 'BW' && r.sides === 'SINGLE' && r.active && Number(r.price_per_sheet) > 0
    );
    if (!hasBwSingle) missingRates.push('A4 B&W (Single-sided)');

    const hasBwDouble = pricing.some(
        r => r.paper_size === 'A4' && r.print_mode === 'BW' && (r.sides === 'DOUBLE_LONG_EDGE' || r.sides === 'DOUBLE_SHORT_EDGE') && r.active && Number(r.price_per_sheet) > 0
    );
    if (!hasBwDouble) missingRates.push('A4 B&W (Double-sided)');

    const hasColourSingle = pricing.some(
        r => r.paper_size === 'A4' && r.print_mode === 'COLOUR' && r.sides === 'SINGLE' && r.active && Number(r.price_per_sheet) > 0
    );
    if (!hasColourSingle) missingRates.push('A4 Colour (Single-sided)');

    const pricingComplete = missingRates.length === 0;
    items.push({
        id: 'pricing',
        category: 'Print Capabilities & Pricing',
        title: 'Core Print Rate Matrix',
        description: 'Base pricing must be configured for standard A4 documents (B&W Single/Double & Colour Single).',
        status: pricingComplete ? 'COMPLETE' : 'MISSING',
        isBlocker: true,
        details: pricingComplete
            ? 'All 3 core print rates configured and active.'
            : `Missing rates: ${missingRates.join(', ')}. Customers cannot calculate quotes without these.`,
        missingKeys: missingRates.length > 0 ? missingRates : undefined,
        actionLabel: 'Configure Rates →',
        actionTab: 'pricing',
    });

    // 6. Platform Commission Rule
    const hasCommission = Boolean(input.activeCommissionRule && input.activeCommissionRule.is_active);
    items.push({
        id: 'commission',
        category: 'Commercial Terms',
        title: 'Platform Commission Rule',
        description: 'An active commercial commission rule is required for order revenue splitting and passbook ledger reconciliation.',
        status: hasCommission ? 'COMPLETE' : 'MISSING',
        isBlocker: true,
        details: hasCommission
            ? `Active rule rate: ${typeof input.activeCommissionRule?.commission_bps === 'number' ? (input.activeCommissionRule.commission_bps / 100).toFixed(2) : '10.00'}%`
            : 'No active commission rule assigned. Payouts and financial settlements cannot be generated.',
        actionLabel: 'Assign Commission →',
        actionTab: 'commission',
    });

    // Summary calculations
    const totalChecks = items.length;
    const completedCount = items.filter(i => i.status === 'COMPLETE').length;
    const blockersCount = items.filter(i => i.status === 'MISSING' && i.isBlocker).length;
    const scorePercent = Math.round((completedCount / totalChecks) * 100);
    const isReadyToPublish = blockersCount === 0;

    let summaryMessage = 'Shop is fully configured and ready to publish!';
    if (!isReadyToPublish) {
        summaryMessage = `${blockersCount} setup requirement${blockersCount === 1 ? '' : 's'} remaining before customer storefront launch.`;
    }

    return {
        scorePercent,
        isReadyToPublish,
        blockersCount,
        completedCount,
        totalChecks,
        items,
        summaryMessage,
    };
}

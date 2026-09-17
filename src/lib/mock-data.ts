/**
 * Legacy pricing helper retained for the two upload-flow callers that still
 * use the original per-sheet calculation contract.
 */
export interface PricingConfig {
    bwPerPage: number;
    bwDoublePerSheet: number;
    colorPerPage: number;
    colorDoublePerSheet: number;
}

export const defaultPricingConfig: PricingConfig = {
    bwPerPage: 2,
    bwDoublePerSheet: 3,
    colorPerPage: 7,
    colorDoublePerSheet: 13,
};

export function calculatePrice(
    pages: number,
    color: boolean,
    sides: 'single' | 'double' | 'double_long' | 'double_short',
    copies: number,
    pricing: Partial<PricingConfig> = {}
): number {
    const config = { ...defaultPricingConfig, ...pricing };
    const safePages = Math.max(1, pages || 1);
    const safeCopies = Math.max(1, copies || 1);
    const isDoubleSided = sides === 'double' || sides === 'double_long' || sides === 'double_short';
    const sheets = isDoubleSided ? Math.ceil(safePages / 2) : safePages;
    const ratePerSheet = color
        ? (isDoubleSided ? config.colorDoublePerSheet : config.colorPerPage)
        : (isDoubleSided ? config.bwDoublePerSheet : config.bwPerPage);

    return Math.round(ratePerSheet * sheets * safeCopies * 100) / 100;
}

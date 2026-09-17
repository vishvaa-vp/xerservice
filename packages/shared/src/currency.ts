/**
 * Authoritative Indian Currency & Integer Paise Formatting Utility
 * Pure arithmetic and locale-safe string representation.
 */

/**
 * Converts a rupee decimal amount to integer paise.
 * Safely rounds to avoid floating-point drift.
 */
export function rupeesToPaise(rupees: number): number {
    if (isNaN(rupees) || !isFinite(rupees)) return 0;
    return Math.round(rupees * 100);
}

/**
 * Converts integer paise to a rupee decimal number.
 */
export function paiseToRupees(paise: number): number {
    if (isNaN(paise) || !isFinite(paise)) return 0;
    return paise / 100;
}

/**
 * Formats a rupee amount as Indian currency string with the ₹ symbol.
 * Example: 15 -> "₹15.00" or "₹15" if showDecimals: false
 */
export function formatCurrency(
    amount: number,
    options: { showDecimals?: boolean } = { showDecimals: true }
): string {
    if (isNaN(amount) || !isFinite(amount)) return '₹0.00';
    const num = Math.max(0, amount);
    if (options.showDecimals === false) {
        return `₹${Math.round(num).toLocaleString('en-IN')}`;
    }
    return `₹${num.toLocaleString('en-IN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    })}`;
}

/**
 * Formats integer paise into an Indian currency string with the ₹ symbol.
 * Example: 1500 -> "₹15.00"
 */
export function formatPaise(paise: number): string {
    return formatCurrency(paiseToRupees(paise));
}

/** Only customer destinations may survive an authentication round trip. */
export function customerDestination(value: string | null | undefined): string {
    if (!value || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u001f]/.test(value)) return '/';
    try {
        const url = new URL(value, 'https://customer.invalid');
        const path = decodeURIComponent(url.pathname);
        if (url.origin !== 'https://customer.invalid' || /[\\\u0000-\u001f]/.test(path)) return '/';
        if (!/^\/(?:$|shops(?:\/|$)|order(?:\/|$)|dashboard(?:\/|$)|cart$|contact$|how-it-works$)/.test(path)) return '/';
        return `${url.pathname}${url.search}${url.hash}`;
    } catch { return '/'; }
}

export function isCustomerPrivatePath(path: string): boolean {
    return /^\/(order|dashboard|cart)(\/|$)/.test(path);
}

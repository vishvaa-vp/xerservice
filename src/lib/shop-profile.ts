/**
 * Shop Profile & Visibility Metadata Utility
 * Provides schema-compatible parsing and serialization for shop profiles,
 * ensuring seamless separation of Publish State (DRAFT / PUBLISHED / ARCHIVED)
 * and Trading Status (OPEN / PAUSED / CLOSED).
 */

export type PublishStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
export type TradingStatus = 'OPEN' | 'PAUSED' | 'CLOSED';

export interface ParsedShopProfile {
    address: string | null;
    publishStatus: PublishStatus;
    photos: string[];
    contactPhone: string | null;
}

/**
 * Parses raw description text from shops table into structured profile metadata.
 * Backward compatible: plain text strings are treated as the address with PUBLISHED status.
 */
export function parseShopProfileMetadata(
    rawDescription: string | null | undefined,
    nativePublishStatus?: string | null
): ParsedShopProfile {
    // Default values
    let address: string | null = rawDescription ? rawDescription.trim() : null;
    let publishStatus: PublishStatus = 'PUBLISHED';
    let photos: string[] = [];
    let contactPhone: string | null = null;

    if (rawDescription && rawDescription.trim().startsWith('{')) {
        try {
            const parsed = JSON.parse(rawDescription.trim());
            if (typeof parsed === 'object' && parsed !== null) {
                if ('address' in parsed) {
                    address = typeof parsed.address === 'string' ? parsed.address : null;
                }
                if ('publishStatus' in parsed && ['DRAFT', 'PUBLISHED', 'ARCHIVED'].includes(parsed.publishStatus)) {
                    publishStatus = parsed.publishStatus as PublishStatus;
                }
                if (Array.isArray(parsed.photos)) {
                    photos = parsed.photos.filter((p: unknown): p is string => typeof p === 'string');
                }
                if ('contactPhone' in parsed && typeof parsed.contactPhone === 'string') {
                    contactPhone = parsed.contactPhone;
                }
            }
        } catch {
            // Not valid JSON, keep as plain string address
        }
    }

    // If native column exists on the row, it takes precedence
    if (nativePublishStatus && ['DRAFT', 'PUBLISHED', 'ARCHIVED'].includes(nativePublishStatus)) {
        publishStatus = nativePublishStatus as PublishStatus;
    }

    return {
        address,
        publishStatus,
        photos,
        contactPhone,
    };
}

/**
 * Serializes structured profile metadata into the shops.description column.
 */
export function serializeShopProfileMetadata(meta: {
    address: string | null;
    publishStatus?: PublishStatus;
    photos?: string[];
    contactPhone?: string | null;
}): string {
    const payload = {
        address: meta.address?.trim() || null,
        publishStatus: meta.publishStatus || 'PUBLISHED',
        photos: meta.photos || [],
        contactPhone: meta.contactPhone?.trim() || null,
    };

    return JSON.stringify(payload);
}
